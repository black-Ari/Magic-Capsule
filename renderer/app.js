import { refreshBattery, startBattery } from './battery.js';
import { call, emit, fmtDate, fmtTime, h, icon, listen, load, on, save, state } from './core.js';
import { startExtras } from './extras.js';
import { RANK, mountPill, refreshPill, setActivity, setClock, toast } from './live.js';
import { startPet } from './pet.js';
import ai from './modules/ai.js';
import calendar from './modules/calendar.js';
import clipboard from './modules/clipboard.js';
import control from './modules/control.js';
import drop from './modules/drop.js';
import health from './modules/health.js';
import home from './modules/home.js';
import links from './modules/links.js';
import notes from './modules/notes.js';
import settings from './modules/settings.js';
import shelf from './modules/shelf.js';
import system from './modules/system.js';
import tasks from './modules/tasks.js';
import time from './modules/time.js';
import units from './modules/units.js';
import weather from './modules/weather.js';

const ALL = [home, calendar, tasks, notes, time, weather, clipboard, shelf, drop, units, ai, control, system, health, links, settings];
const byId = Object.fromEntries(ALL.map((module) => [module.id, module]));

const notch = document.getElementById('notch');
const tabs = document.getElementById('tabs');
const views = document.getElementById('views');

let active = null;
let pinned = false;
let pinButton;
let headerClock;
let batteryStatus;
let capsOn = false;

const isOn = (id) => id === 'settings' || state.settings.modules.some((item) => item.id === id && item.on);
const visibleTabs = () => [...state.settings.modules.filter((item) => item.on).map((item) => item.id), 'settings'];

function select(id) {
  const target = byId[id] && isOn(id) ? byId[id] : byId[visibleTabs()[0]];
  if (active !== target) {
    active?.hide?.();
    active?.view.setAttribute('hidden', '');
    active = target;
    if (!target.view) {
      target.view = h('section', { class: 'view' });
      target.view.dataset.tool = target.id;
      views.append(target.view);
      target.render(target.view);
      target.view.querySelector('.view-title')?.prepend(h('span', { class: 'title-badge' }, icon(target.icon, 15)));
    }
    target.view.removeAttribute('hidden');
    target.show?.();
    save('ui', { tab: target.id });
  }
  for (const tab of tabs.querySelectorAll('.tab[data-id]')) tab.classList.toggle('active', tab.dataset.id === target.id);
}

function stepTab(direction) {
  const ids = visibleTabs();
  select(ids[(ids.indexOf(active.id) + direction + ids.length) % ids.length]);
}

function tabButton(module) {
  return h('button', {
    class: 'tab', title: module.title, ariaLabel: module.title, type: 'button', onClick: () => select(module.id),
  }, icon(module.icon, 18));
}

function buildTabs() {
  const items = state.settings.modules.filter((item) => item.on).map((item) => {
    const button = tabButton(byId[item.id]);
    button.dataset.id = item.id;
    return button;
  });
  const settingsTab = tabButton(settings);
  settingsTab.dataset.id = 'settings';
  pinButton = h('button', {
    class: 'tab', title: 'Keep open', ariaLabel: 'Keep open', type: 'button', onClick: () => call('notch.pin', !pinned),
  }, icon('pin', 18));
  pinButton.classList.toggle('active', pinned);
  const hideButton = h('button', {
    class: 'tab', title: 'Hide the notch (click the thin handle to bring it back)', ariaLabel: 'Hide the notch', type: 'button',
    onClick: () => call('notch.tuck', true),
  }, icon('eye', 18));
  tabs.replaceChildren(
    ...items, h('span', { class: 'tab-gap' }), hideButton, pinButton, settingsTab,
    h('span', { class: 'tabs-status' }, batteryStatus, headerClock),
  );
  if (active) select(active.id);
}

function inkFor(color) {
  const value = parseInt(color.slice(1), 16);
  const luminance = (0.299 * (value >> 16) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return luminance > 0.6 ? '#15181e' : '#f5f5f6';
}

function applyAppearance() {
  const root = document.documentElement;
  const {
    theme, edgeLight, look, lookColor, closedOpacity, closedHeight, topGap, autoHide,
  } = state.settings;
  root.dataset.theme = theme;
  root.dataset.edge = edgeLight;
  root.dataset.look = look;
  root.toggleAttribute('data-floating', topGap > 0);
  root.toggleAttribute('data-autohide', autoHide);
  root.style.setProperty('--panel-w', `${state.panel.w}px`);
  root.style.setProperty('--panel-h', `${state.panel.h}px`);
  root.style.setProperty('--pill-h', `${closedHeight}px`);
  root.style.setProperty('--top-gap', `${topGap}px`);
  root.style.setProperty('--closed-opacity', closedOpacity / 100);
  root.style.setProperty('--look-color', lookColor);
  root.style.setProperty('--rest-ink', look === 'color' ? inkFor(lookColor) : '#f5f5f6');
}

function paintClock() {
  const now = Date.now();
  const { closedMiddle } = state.settings;
  const time = fmtTime(now);
  setClock(closedMiddle === 'none' ? '' : closedMiddle === 'daytime' ? `${fmtDate(now, { weekday: 'short' })} ${time}` : time);
  headerClock.textContent = time;
}

function showClock() {
  paintClock();
  setTimeout(showClock, 60000 - (Date.now() % 60000) + 50);
}

function showMessage() {
  const { on: enabled, text, color } = state.settings.message;
  setActivity('message', enabled && text.trim() ? { rank: RANK.message, text: text.trim(), color } : null);
}

function setupFileDrop() {
  const hasFiles = (event) => event.dataTransfer?.types.includes('Files');
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    document.body.classList.add('dragging');
    if (active !== ai && isOn('shelf')) select('shelf');
  });
  document.addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
  document.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    document.body.classList.remove('dragging');
    const paths = [...event.dataTransfer.files].map((file) => window.nook.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    if (active === ai) emit('ai-files', paths); // dropped on the AI: it is a file for the AI
    else await call('shelf.add', paths);
  });
}

function paintCapsMark() {
  notch.classList.toggle('caps-on', capsOn && state.settings.capsMark);
}

async function setupLockKeys() {
  const reading = await call('locks.get').catch(() => '0,0,0');
  capsOn = reading.startsWith('1');
  paintCapsMark();
  on('lockkey', ({ key, on: isActive }) => {
    if (key === 'Caps Lock') {
      capsOn = isActive;
      paintCapsMark();
    }
    if (state.settings.lockKeys) toast(`${key} ${isActive ? 'on' : 'off'}`, 'lock', 1500);
  });
}

function typingInField(target) {
  return target.matches('textarea, select, input:not([type="checkbox"], [type="range"])');
}

function setupKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') call('notch.close');
    if (!state.settings.arrowTabs || !notch.classList.contains('open')) return;
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!direction) return;
    if ((event.altKey && event.shiftKey) || !typingInField(event.target)) {
      event.preventDefault();
      stepTab(direction);
    }
  });
  // Typing keeps the notch open when the mouse wanders off. Clicking a button does not.
  document.addEventListener('focusin', (event) => {
    if (typingInField(event.target)) call('notch.stick');
  });
  document.addEventListener('input', (event) => {
    if (event.target.matches('textarea, input[type="text"], input[type="search"]')) emit('pet-typing');
  });
}

async function main() {
  Object.assign(state, await call('settings.get'));
  batteryStatus = h('span', { class: 'battery-status' });
  headerClock = h('span');
  notch.classList.toggle('tucked', Boolean(state.tucked));
  applyAppearance();
  buildTabs();

  for (const module of ALL) {
    try {
      await module.init?.();
    } catch (err) {
      console.error(`${module.id} failed to start`, err);
    }
  }

  mountPill(document.getElementById('pill'), notch);
  showClock();
  showMessage();
  setupFileDrop();
  setupKeyboard();
  setupLockKeys();
  startBattery(batteryStatus);
  startExtras();
  startPet();
  document.getElementById('pet').addEventListener('click', async () => {
    await call('notch.openTab', 'ai');
    select('ai');
    ai.openChat();
  });

  const { tab } = await load('ui', { tab: state.settings.defaultTab });
  select(state.settings.rememberTab ? tab : state.settings.defaultTab);

  listen('settings', () => {
    applyAppearance();
    buildTabs();
    showMessage();
    paintClock();
    paintCapsMark();
    refreshBattery();
    refreshPill();
  });
  listen('open-tab', select);

  on('notch:state', ({ open, tab: wanted, pinned: isPinned }) => {
    const opening = open && !notch.classList.contains('open');
    notch.classList.toggle('open', open);
    pinned = isPinned;
    pinButton.classList.toggle('active', pinned);
    if (opening && !wanted && !state.settings.rememberTab) select(state.settings.defaultTab);
    if (wanted) select(wanted);
    if (open) active.show?.();
    emit('notch', open);
  });
  on('toast', ({ text, icon: name }) => toast(text, name));
  on('announce', ({ text, icon: name, ttl }) => {
    toast(text, name, ttl);
    emit('pet', 'reminder');
  });
  on('notch:panel', (panel) => {
    state.panel = panel;
    applyAppearance();
  });
  on('notch:leader', (leader) => { state.leader = leader; });
  on('settings:changed', (next) => {
    state.settings = next;
    emit('settings', next);
  });
  on('store:changed', (ns) => emit(`store:${ns}`));
  on('notch:tucked', (tucked) => {
    notch.classList.toggle('tucked', tucked);
    if (tucked) toast(`Hidden. Point at the line at the top, or press ${state.settings.shortcut || 'the tray icon'}`, 'eye', 3500);
  });

  document.getElementById('pill').addEventListener('click', () => call('notch.open'));
  notch.addEventListener('click', () => { if (notch.classList.contains('tucked')) call('notch.tuck', false); });

  call('media.refresh').catch(() => {});
  // Usually another notch app, such as Poni, already holding the same key.
  if (state.shortcutError) toast(state.shortcutError, 'alert', 8000);
}

main().catch((err) => console.error('Magic Capsule failed to start', err));

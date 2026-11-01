import { ICONS } from './icons.js';

export const call = (method, ...args) => window.nook.call(method, ...args);
export const on = (channel, listener) => window.nook.on(channel, listener);
export const load = (ns, fallback) => call('store.get', ns, fallback);
export const save = (ns, value) => call('store.set', ns, value);

export const state = { settings: null, panel: null, shortcutError: '', claudeModels: [], leader: true };

const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const listen = (name, listener) => bus.addEventListener(name, (event) => listener(event.detail));

export async function saveSettings(patch) {
  const { settings, shortcutError } = await call('settings.set', patch);
  state.settings = settings;
  state.shortcutError = shortcutError;
  emit('settings', settings);
  return shortcutError;
}

// Reminders run in one window only, then show on every screen, with the chime sounding once.
export function announce(text, icon, ttl) {
  chime();
  return call('announce', { text, icon, ttl });
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return el;
}

export function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

export function iconButton(name, title, onClick, className = 'btn ghost icon-only') {
  return h('button', { class: className, title, ariaLabel: title, type: 'button', onClick }, icon(name, 16));
}

export function viewTitle(text, ...right) {
  return h('div', { class: 'view-title' }, h('span', {}, text), h('span', { class: 'spacer' }), right);
}

export function meter(percent) {
  const bar = h('span', { style: `width:${percent}%` });
  const el = h('div', { class: 'meter', role: 'progressbar', ariaValueNow: percent }, bar);
  el.setPercent = (value) => {
    bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
    el.setAttribute('aria-valuenow', Math.round(value));
    return el;
  };
  return el;
}

const timeOptions = () => {
  const format = state.settings ? state.settings.timeFormat : 'auto';
  return format === 'auto' ? {} : { hour12: format === '12' };
};

export const fmtTime = (ms, options = {}) => new Intl.DateTimeFormat(undefined, {
  hour: 'numeric', minute: '2-digit', ...timeOptions(), ...options,
}).format(ms);

export const fmtDate = (ms, options = { weekday: 'short', day: 'numeric', month: 'short' }) => (
  new Intl.DateTimeFormat(undefined, options).format(ms)
);

export function fmtClock(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(hours ? 2 : 1, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}

export function fmtDuration(totalSeconds) {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power]}`;
}

export function fmtUntil(ms, now = Date.now()) {
  const minutes = Math.round((ms - now) / 60000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}

export const startOfDay = (ms) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const uid = () => crypto.randomUUID();

let audio;
export function chime() {
  audio ||= new AudioContext();
  const start = audio.currentTime;
  [[660, 0], [880, 0.16]].forEach(([frequency, delay]) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.exponentialRampToValueAtTime(0.14, start + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.5);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + 0.55);
  });
}

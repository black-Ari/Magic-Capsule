// What the resting pill shows: a short alert first, then live activities (taking turns when
// several run), and when nothing is happening the side extras around the clock.
import { call, h, icon, state } from './core.js';

export const RANK = { message: 30, music: 40, task: 45, event: 50, timer: 60, peek: 80, agent: 85, volume: 90, toast: 100 };

const ROTATE_MS = 6000;
const SIDE_PADDING = 26;

const activities = new Map();
const expiries = new Map();
let pill;
let notch;
let clock = '';
let extras = { left: '', right: '' };
let turn = 0;
let lastSize = '';

const byRank = (a, b) => b.rank - a.rank;
const isAlert = (activity) => activity.rank >= RANK.peek;

function liveActivities() {
  const { live } = state.settings;
  if (!live.on) return [];
  return [...activities.values()].filter((activity) => activity.source && live[activity.source]).sort(byRank);
}

function choose() {
  const alert = [...activities.values()].filter(isAlert).sort(byRank)[0];
  if (alert) return alert;
  const running = liveActivities();
  if (!running.length) return activities.get('message') || null;
  return state.settings.live.rotate ? running[turn % running.length] : running[0];
}

function activityParts(activity) {
  const showClock = state.settings.keepClock && !isAlert(activity) && clock;
  return [
    activity.left,
    activity.text ? h('span', { class: 'pill-text', style: activity.color ? `color:${activity.color}` : '' }, activity.text) : null,
    activity.sub ? h('span', { class: 'pill-sub' }, activity.sub) : null,
    activity.right,
    showClock ? h('span', { class: 'pill-sub' }, clock) : null,
  ];
}

function idleParts() {
  return [
    extras.left ? h('span', { class: 'pill-sub' }, extras.left) : null,
    clock ? h('span', { class: 'pill-text' }, clock) : null,
    extras.right ? h('span', { class: 'pill-sub' }, extras.right) : null,
  ];
}

function render() {
  if (!pill || !state.settings) return;
  const top = choose();
  notch.classList.toggle('alert', Boolean(top && isAlert(top)));
  pill.replaceChildren(...(top ? activityParts(top) : idleParts()).filter(Boolean));
  const progress = top && top.progress !== undefined && state.settings.live.progress ? top.progress : null;
  pill.classList.toggle('has-progress', progress !== null);
  if (progress !== null) pill.style.setProperty('--progress', `${progress * 100}%`);

  const { closedWidth, closedHeight } = state.settings;
  const width = Math.max(closedWidth, pill.offsetWidth + SIDE_PADDING);
  const size = `${width}x${closedHeight}`;
  if (size === lastSize) return;
  lastSize = size;
  document.documentElement.style.setProperty('--pill-w', `${width}px`);
  call('notch.pill', { w: width, h: closedHeight });
}

export function mountPill(el, notchElement) {
  pill = el;
  notch = notchElement;
  render();
  setInterval(() => {
    if (liveActivities().length > 1 && !notch.classList.contains('open')) {
      turn += 1;
      render();
    }
  }, ROTATE_MS);
}

export const refreshPill = render;

export function setClock(text) {
  clock = text;
  render();
}

export function setExtras(left, right) {
  extras = { left, right };
  render();
}

export function setActivity(key, activity) {
  clearTimeout(expiries.get(key));
  if (activity) {
    activities.set(key, activity);
    if (activity.ttl) expiries.set(key, setTimeout(() => setActivity(key, null), activity.ttl));
  } else {
    activities.delete(key);
  }
  render();
}

export function toast(text, iconName = 'bell', ttl = 2800) {
  setActivity('toast', { rank: RANK.toast, ttl, text, left: icon(iconName, 16) });
}

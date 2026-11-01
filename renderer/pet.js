// The avatar under the notch reacts to what you are doing. It is plain SVG with CSS animation, so
// it stays light, and the window stays click-through around it.
import { avatarSvg, normalize } from './avatar.mjs';
import { call, h, listen, on, state } from './core.js';
import {
  EVENTS, PROPS, appAct, controlAct, fidgetAct, greeting, weatherAct,
} from './pet-acts.mjs';

// Moves in short bursts: a constantly animated window would keep a small laptop's CPU busy.
const MOVE_MS = 1800;
const REST_MS = 7000;
const FIDGET_CHANCE = 0.7;
const WALK_CHANCE = 0.55;
const WALK_SPEED = 55; // pixels a second
const WALK_FPS = 12; // stop-motion steps: smooth movement would keep a small laptop's CPU busy
const WALK_MAX_MS = 6000;
const WALK_MIN_DISTANCE = 70;
const WALK_EDGE = 8;
const WALK_MOODS = new Set(['idle', 'looking', 'typing', 'chat', 'dance']);
const BUBBLES = { sleep: 'z z', dance: '♪', happy: '♥', alert: '!', worried: '…', chat: '…', bless: 'ॐ', thinking: '?' };
const TYPING_HOLD_MS = 1200;
const PETTED_REST_MS = 6000;
const MEMORY_CHECK_MS = 30000;
const MEMORY_HIGH = 90;
const MEMORY_OK = 85;
const LOUD_PERCENT = 85;
const AI_PROPS = { thinking: 'bulb', working: 'gear', chat: 'ai' };

// Sacred figures stay composed: they never sleep, dance or sit at a laptop. They glow and bless.
export function displayMood(mood, avatar) {
  if (!avatar.calm) return mood;
  return mood === 'happy' || mood === 'nod' ? 'bless' : mood === 'alert' ? 'alert' : 'calm';
}

function showProp(element, name) {
  if (element.dataset.prop === (name || '')) return;
  element.dataset.prop = name || '';
  element.innerHTML = PROPS[name] || '';
}

export function applyAvatar(root, art, avatar, mood, { act = '', prop = '', say = '' } = {}) {
  const stage = root.querySelector('.pet-prop') || root.appendChild(h('div', { class: 'pet-prop' }));
  const bubble = root.querySelector('.pet-bubble') || root.appendChild(h('span', { class: 'pet-bubble', hidden: true }));
  root.dataset.base = avatar.base;
  root.dataset.mood = displayMood(mood, avatar);
  root.dataset.act = avatar.calm ? '' : act;
  showProp(stage, avatar.calm ? '' : prop);
  bubble.textContent = avatar.calm ? '' : say;
  bubble.hidden = avatar.calm || !say;
  art.innerHTML = avatarSvg(avatar);
}

let root;
let art;
let stage;
let bubble;
let drawnKey = '';
let media = false;
let focusing = false;
let app = '';
let idle = 0;
let reaction = null;
let reactionTimer = null;
let fidget = null;
let aiMood = '';
let typingInNook = false;
let typingTimer = null;
let memoryWarned = false;
let wasAsleep = false;
let lastPetted = 0;
let weather = null;
let walking = false;
let walkX = 0;
let walkTimer = null;
let walkSide = '';
let notchOpen = false;
let mouseNear = false;
const mirrors = [];

function ambient() {
  const { reactApps, sleepAfter } = state.settings.pet;
  if (aiMood) return { mood: aiMood, prop: AI_PROPS[aiMood] };
  if (typingInNook) return { mood: 'typing' };
  if (idle >= sleepAfter * 60) return { mood: 'sleep', prop: 'zzz' };
  if (focusing) return { mood: 'focus', prop: 'headband' };
  if (media) return { mood: 'dance', prop: 'notes' };
  return (reactApps && appAct(app)) || { mood: 'idle' };
}

function paint() {
  if (!root) return;
  const { on: enabled, avatar: saved, size, side, bubbles } = state.settings.pet;
  root.hidden = !enabled;
  for (const mirror of mirrors) mirror.hidden = !enabled;
  if (!enabled) return;
  const avatar = normalize(saved);
  const key = JSON.stringify(avatar);
  if (key !== drawnKey) {
    art.innerHTML = avatarSvg(avatar);
    drawnKey = key;
    for (const mirror of mirrors) mirror.firstElementChild.innerHTML = avatarSvg(avatar);
  }
  const base = ambient();
  const quietWalk = walking && !reaction;
  const show = reaction || (quietWalk ? { ...base, act: 'walk', prop: '' } : { ...base, ...(base.mood === 'idle' ? fidget : null) });
  const mood = displayMood(show.mood, avatar);
  const act = avatar.calm ? '' : show.act || '';
  Object.assign(root.dataset, { base: avatar.base, side, mood, act });
  for (const mirror of mirrors) Object.assign(mirror.dataset, { base: avatar.base, mood, act });
  root.style.setProperty('--pet-size', `${size}px`);
  showProp(stage, avatar.calm ? '' : show.prop);
  const text = avatar.calm ? (mood === 'alert' ? '!' : BUBBLES[mood] || '') : show.say || (quietWalk ? '' : BUBBLES[mood] || '');
  art.title = state.settings.pet.name || '';
  bubble.textContent = text;
  bubble.hidden = !bubbles || !text;
}

function start(next) {
  clearTimeout(reactionTimer);
  reaction = next;
  fidget = null;
  paint();
  reactionTimer = setTimeout(() => {
    reaction = null;
    paint();
  }, next.ms);
}

// Takes a name from EVENTS, or a finished reaction.
export function react(event) {
  start(typeof event === 'string' ? EVENTS[event] : event);
}

function clearSoft() {
  if (!reaction?.soft) return;
  clearTimeout(reactionTimer);
  reaction = null;
}

// A live copy of the avatar, shown in the AI tab while the notch is open.
export function addMirror(element) {
  const copy = h('div', { class: 'pet-art' });
  element.append(copy);
  mirrors.push(element);
  drawnKey = '';
  paint();
}

function chooseFidget() {
  const wanted = state.settings.pet.play && !reaction && ambient().mood === 'idle' && Math.random() < FIDGET_CHANCE;
  fidget = wanted ? fidgetAct(new Date().getHours(), weather) : null;
  paint();
}

// Walks to a spot under the notch, given as a shift in pixels from its resting place.
export function walkTo(target) {
  const distance = Math.abs(target - walkX);
  if (distance < 1) return 0;
  const ms = Math.min(WALK_MAX_MS, (distance / WALK_SPEED) * 1000);
  clearTimeout(walkTimer);
  root.dataset.facing = target < walkX ? 'left' : 'right';
  root.style.setProperty('--walk-ms', `${Math.round(ms)}ms`);
  root.style.setProperty('--walk-steps', Math.ceil((ms / 1000) * WALK_FPS));
  root.style.setProperty('--pet-walk', `${target}px`);
  call('notch.petWalk', { from: walkX, to: target, ms }).catch(() => {});
  walkX = target;
  walking = true;
  paint();
  walkTimer = setTimeout(() => {
    walking = false;
    delete root.dataset.facing;
    chooseFidget();
  }, ms);
  return ms;
}

// The mouse is coming to click, and a target that walks away cannot be clicked.
function stopWalk() {
  if (!walking) return;
  const here = parseFloat(getComputedStyle(root).translate) || 0;
  clearTimeout(walkTimer);
  root.style.setProperty('--walk-ms', '0ms');
  root.style.setProperty('--pet-walk', `${here}px`);
  call('notch.petWalk', { from: here, to: here, ms: 0 }).catch(() => {});
  walkX = here;
  walking = false;
  delete root.dataset.facing;
  paint();
}

function randomSpot() {
  const { size } = state.settings.pet;
  const box = root.getBoundingClientRect();
  const home = box.left + box.width / 2 - walkX;
  const low = size / 2 + WALK_EDGE - home;
  const high = innerWidth - size / 2 - WALK_EDGE - home;
  for (let tries = 0; tries < 6; tries += 1) {
    const spot = Math.round(low + Math.random() * (high - low));
    if (Math.abs(spot - walkX) >= WALK_MIN_DISTANCE) return spot;
  }
  return null;
}

// Goes home to sleep, and otherwise wanders off now and then.
function chooseWalk() {
  const { walk, avatar } = state.settings.pet;
  if (walking || reaction || notchOpen || mouseNear || !walk || normalize(avatar).calm) return 0;
  const { mood } = ambient();
  if (mood === 'sleep') return walkTo(0);
  if (!WALK_MOODS.has(mood) || Math.random() >= WALK_CHANCE) return 0;
  const spot = randomSpot();
  return spot === null ? 0 : walkTo(spot);
}

function moveNow() {
  const movers = [root, ...mirrors];
  const walkMs = chooseWalk();
  if (!walkMs) chooseFidget();
  for (const element of movers) element.classList.add('moving');
  setTimeout(() => {
    for (const element of movers) element.classList.remove('moving');
    fidget = null;
    paint();
    setTimeout(moveNow, REST_MS);
  }, MOVE_MS + walkMs);
}

// A new resting place, so the pet starts from it again.
function resetWalk() {
  clearTimeout(walkTimer);
  walking = false;
  walkX = 0;
  delete root.dataset.facing;
  root.style.setProperty('--walk-ms', '0ms');
  root.style.setProperty('--pet-walk', '0px');
  call('notch.petWalk', { from: 0, to: 0, ms: 0 }).catch(() => {});
}

export async function checkMemory() {
  if (!state.settings.pet.on) return;
  const stats = await call('system.stats').catch(() => null);
  if (!stats) return;
  const used = (1 - stats.memFree / stats.memTotal) * 100;
  if (used >= MEMORY_HIGH && !memoryWarned) {
    memoryWarned = true;
    react('memoryFull');
  } else if (used < MEMORY_OK) {
    memoryWarned = false;
  }
}

function watchVolume() {
  let last = null;
  on('volume', (next) => {
    const before = last;
    last = next;
    if (!before) return;
    if (next.muted && !before.muted) react('muted');
    else if (next.percent >= LOUD_PERCENT && next.percent > before.percent) react('tooLoud');
    else react(next.percent < before.percent ? 'softer' : 'louder');
  });
}

function watchForeground() {
  on('foreground', (next) => {
    const limit = state.settings.pet.sleepAfter * 60;
    const asleep = next.idle >= limit;
    const changed = next.app !== app || asleep !== (idle >= limit);
    app = next.app;
    idle = next.idle;
    if (wasAsleep && !asleep) react('welcomeBack');
    else if (changed) paint();
    wasAsleep = asleep;
  });
}

export function startPet() {
  art = h('div', { class: 'pet-art' });
  bubble = h('span', { class: 'pet-bubble' });
  stage = h('div', { class: 'pet-prop' });
  root = document.getElementById('pet');
  root.append(bubble, art, stage);
  art.addEventListener('mouseenter', () => {
    if (Date.now() - lastPetted < PETTED_REST_MS || reaction) return;
    lastPetted = Date.now();
    react('petted');
  });
  on('media', (next) => { media = Boolean(next && next.playing); paint(); });
  watchForeground();
  watchVolume();
  on('copied', () => react('copied'));
  on('lockkey', () => react('lockKey'));
  on('shelf', () => react('shelf'));
  listen('pet', react);
  listen('pet-control', (change) => react(controlAct(change)));
  listen('pet-weather', (code) => { weather = weatherAct(code); });
  listen('pet-ai', (mood) => { clearSoft(); aiMood = mood || ''; paint(); });
  listen('pet-typing', () => {
    clearSoft();
    typingInNook = true;
    paint();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typingInNook = false; paint(); }, TYPING_HOLD_MS);
  });
  listen('pet-focus', (active) => { focusing = active; paint(); });
  listen('notch', (open) => { notchOpen = open; });
  on('pet:near', (near) => { mouseNear = near; if (near) stopWalk(); });
  listen('settings', () => {
    const { side } = state.settings.pet;
    if (side !== walkSide) { walkSide = side; resetWalk(); }
    paint();
  });
  walkSide = state.settings.pet.side;
  resetWalk();
  react(greeting(new Date().getHours(), state.settings.pet.name));
  moveNow();
  setInterval(checkMemory, MEMORY_CHECK_MS);
}

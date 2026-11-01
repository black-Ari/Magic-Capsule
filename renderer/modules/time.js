import { chime, emit, fmtClock, fmtTime, h, icon, iconButton, listen, load, meter, save, state, uid, viewTitle } from '../core.js';
import { RANK, setActivity, toast } from '../live.js';

const pomo = { phase: 'focus', remaining: 1500, total: 1500, endsAt: 0, running: false, done: 0 };
let timers = [];
let clocks = [];
let stopwatch = { startedAt: 0, elapsed: 0 };
let ui = null;
let wasFocusing = false;
let wasBusy = false;

const secondsLeft = (endsAt) => (endsAt - Date.now()) / 1000;
const pomoLeft = () => (pomo.running ? secondsLeft(pomo.endsAt) : pomo.remaining);
const stopwatchSeconds = () => (stopwatch.elapsed + (stopwatch.startedAt ? Date.now() - stopwatch.startedAt : 0)) / 1000;
const PHASE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const phaseSeconds = (phase) => state.settings.pomodoro[phase] * 60;

function setPhase(phase) {
  pomo.phase = phase;
  pomo.total = phaseSeconds(phase);
  pomo.remaining = pomo.total;
  pomo.running = false;
}

function togglePomo() {
  if (pomo.running) {
    pomo.remaining = pomoLeft();
    pomo.running = false;
  } else {
    pomo.endsAt = Date.now() + pomo.remaining * 1000;
    pomo.running = true;
  }
  tick();
}

function nextPhase() {
  if (pomo.phase === 'focus') {
    pomo.done += 1;
    setPhase(pomo.done % state.settings.pomodoro.cycles === 0 ? 'long' : 'short');
  } else {
    setPhase('focus');
  }
}

function finishPomo() {
  const finished = pomo.phase;
  const { autoBreak, autoFocus, sound } = state.settings.pomodoro;
  nextPhase();
  if (sound) chime();
  toast(finished === 'focus' ? 'Focus done. Take a break.' : 'Break over.', 'timer', 6000);
  emit('pet', 'timerDone');
  if (finished === 'focus' ? autoBreak : autoFocus) {
    pomo.endsAt = Date.now() + pomo.remaining * 1000;
    pomo.running = true;
  }
}

function tick() {
  if (pomo.running && pomoLeft() <= 0) finishPomo();
  for (const timer of timers.filter((item) => secondsLeft(item.endsAt) <= 0)) {
    chime();
    toast(`${timer.label} finished`, 'timer', 6000);
    timers = timers.filter((item) => item.id !== timer.id);
    drawTimers();
  }

  const focusing = pomo.running && pomo.phase === 'focus';
  if (focusing !== wasFocusing) {
    wasFocusing = focusing;
    emit('pet-focus', focusing);
  }
  const soonest = [...timers].sort((a, b) => a.endsAt - b.endsAt)[0];
  const timerActivity = (text, sub) => ({ rank: RANK.timer, source: 'timers', left: icon('timer', 16), text, sub });
  if (pomo.running) {
    setActivity('timer', timerActivity(PHASE_LABEL[pomo.phase], fmtClock(pomoLeft())));
  } else if (soonest) {
    setActivity('timer', timerActivity(soonest.label, fmtClock(secondsLeft(soonest.endsAt))));
  } else if (stopwatch.startedAt) {
    setActivity('timer', timerActivity('Stopwatch', fmtClock(Math.floor(stopwatchSeconds()))));
  } else {
    setActivity('timer', null);
  }
  paint();
}

// Runs only while something is counting, with one more pass to clear the notch when it ends.
function heartbeat() {
  const busy = pomo.running || timers.length > 0 || Boolean(stopwatch.startedAt);
  if (busy || wasBusy) tick();
  wasBusy = busy;
}

function paint() {
  if (!ui) return;
  ui.pomoTime.textContent = fmtClock(pomoLeft());
  ui.pomoPhase.textContent = `${PHASE_LABEL[pomo.phase]} · ${pomo.done} done`;
  ui.pomoMeter.setPercent((1 - pomoLeft() / pomo.total) * 100);
  ui.pomoToggle.replaceChildren(icon(pomo.running ? 'pause' : 'play', 16), pomo.running ? 'Pause' : 'Start');
  ui.stopwatch.textContent = fmtClock(Math.floor(stopwatchSeconds()));
  for (const row of ui.timerList.querySelectorAll('[data-id]')) {
    const timer = timers.find((item) => item.id === row.dataset.id);
    if (timer) row.querySelector('.chip').textContent = fmtClock(secondsLeft(timer.endsAt));
  }
  for (const row of ui.clockList.querySelectorAll('[data-zone]')) {
    row.querySelector('.chip').textContent = fmtTime(Date.now(), { timeZone: row.dataset.zone });
  }
}

function addTimer(minutes) {
  timers.push({ id: uid(), label: `${minutes} min timer`, endsAt: Date.now() + minutes * 60000 });
  drawTimers();
  tick();
}

function drawTimers() {
  if (!ui) return;
  ui.timerList.replaceChildren(...timers.map((timer) => {
    const row = h('div', { class: 'list-row' },
      h('span', { class: 'grow truncate' }, timer.label),
      h('span', { class: 'chip' }),
      iconButton('x', 'Cancel timer', () => {
        timers = timers.filter((item) => item.id !== timer.id);
        drawTimers();
        tick();
      }));
    row.dataset.id = timer.id;
    return row;
  }));
}

function drawClocks() {
  if (!ui) return;
  ui.clockList.replaceChildren(...clocks.map((zone) => {
    const row = h('div', { class: 'list-row' },
      h('span', { class: 'grow truncate' }, zone.split('/').pop().replace(/_/g, ' ')),
      h('span', { class: 'chip' }),
      h('span', { class: 'actions' }, iconButton('x', 'Remove clock', () => {
        clocks = clocks.filter((item) => item !== zone);
        save('clocks', clocks);
        drawClocks();
      })));
    row.dataset.zone = zone;
    return row;
  }));
  paint();
}

function pomoCard() {
  ui.pomoTime = h('div', { class: 'pomo-time' });
  ui.pomoPhase = h('div', { class: 'label' });
  ui.pomoMeter = meter(0);
  ui.pomoToggle = h('button', { class: 'btn primary', type: 'button', onClick: togglePomo });
  const skip = iconButton('next', 'Skip phase', () => { nextPhase(); tick(); }, 'btn icon-only');
  const reset = iconButton('refresh', 'Reset', () => { setPhase(pomo.phase); tick(); }, 'btn icon-only');
  return h('div', { class: 'card pomo' }, ui.pomoPhase, ui.pomoTime, ui.pomoMeter, h('div', { class: 'row' }, ui.pomoToggle, skip, reset));
}

function stopwatchRow() {
  ui.stopwatch = h('span', { class: 'value' });
  const toggle = h('button', {
    class: 'btn',
    type: 'button',
    onClick: () => {
      if (stopwatch.startedAt) stopwatch = { startedAt: 0, elapsed: stopwatchSeconds() * 1000 };
      else stopwatch.startedAt = Date.now();
      toggle.textContent = stopwatch.startedAt ? 'Stop' : 'Start';
    },
  }, 'Start');
  const reset = iconButton('refresh', 'Reset stopwatch', () => {
    stopwatch = { startedAt: 0, elapsed: 0 };
    toggle.textContent = 'Start';
    paint();
  });
  return h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Stopwatch'), ui.stopwatch, toggle, reset);
}

function clockForm() {
  const input = h('input', { type: 'text', class: 'grow', list: 'zones', placeholder: 'Add a city, e.g. Europe/London', ariaLabel: 'Time zone' });
  const zones = h('datalist', { id: 'zones' }, Intl.supportedValuesOf('timeZone').map((zone) => h('option', { value: zone })));
  return h('form', {
    class: 'row',
    onSubmit: (event) => {
      event.preventDefault();
      const zone = input.value.trim();
      if (!Intl.supportedValuesOf('timeZone').includes(zone) || clocks.includes(zone)) return;
      clocks.push(zone);
      save('clocks', clocks);
      input.value = '';
      drawClocks();
    },
  }, input, zones, h('button', { class: 'btn', type: 'submit' }, 'Add'));
}

export default {
  id: 'time',
  title: 'Timers',
  icon: 'timer',

  async init() {
    clocks = await load('clocks', []);
    listen('store:clocks', async () => {
      clocks = await load('clocks', []);
      drawClocks();
    });
    setPhase('focus');
    // A running timer keeps its length; new lengths apply from the next phase.
    listen('settings', () => { if (!pomo.running) { setPhase(pomo.phase); paint(); } });
    setInterval(heartbeat, 500);
  },

  render(view) {
    ui = { timerList: h('div', { class: 'col' }), clockList: h('div', { class: 'col' }) };
    const quick = [1, 5, 10, 30].map((minutes) => h('button', {
      class: 'btn', type: 'button', onClick: () => addTimer(minutes),
    }, `${minutes}m`));
    view.append(
      viewTitle('Timers'),
      h('div', { class: 'time-grid' },
        pomoCard(),
        h('div', { class: 'card col scroll' },
          stopwatchRow(),
          h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Quick timer'), quick),
          ui.timerList,
          h('div', { class: 'label' }, 'World clocks'),
          ui.clockList,
          clockForm())),
    );
    drawTimers();
    drawClocks();
    paint();
  },
};

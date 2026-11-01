import { announce, call, emit, fmtDuration, h, icon, listen, load, meter, save, state, viewTitle } from '../core.js';

const BREATH_PHASE_MS = 4000;
const TOP_APPS = 6;

const today = () => new Date().toDateString();
const blank = () => ({ day: today(), water: 0, breaks: 0, mindful: 0 });

let data = blank();
let lastBreak = Date.now();
let lastEye = Date.now();
let lastWater = Date.now();
let ui = null;
let breathing = null;

function persist() {
  save('health', data);
  paint();
}

function rollDay() {
  if (data.day !== today()) data = blank();
}

function bump(key, delta = 1) {
  rollDay();
  data[key] = Math.max(0, data[key] + delta);
  if (delta > 0) emit('pet', key === 'water' ? 'drink' : 'happy');
  if (key === 'breaks') lastBreak = Date.now();
  persist();
}

function remind() {
  if (!state.leader) return;
  const {
    breaks, breakEvery, eyes, eyeEvery, eyeSeconds, water, waterEvery,
  } = state.settings.health;
  const now = Date.now();
  if (breaks && now - lastBreak >= breakEvery * 60000) {
    lastBreak = now;
    announce('Time for a short break', 'heart', 10000);
  }
  if (eyes && now - lastEye >= eyeEvery * 60000) {
    lastEye = now;
    announce(`Look 20 feet away for ${eyeSeconds} seconds`, 'eye', eyeSeconds * 1000);
  }
  if (water && now - lastWater >= waterEvery * 60000) {
    lastWater = now;
    announce('Time for a glass of water', 'drop', 10000);
  }
}

function paint() {
  if (!ui) return;
  const goal = state.settings.health.waterGoal;
  ui.waterText.textContent = `${data.water} of ${goal} glasses`;
  ui.water.setPercent((data.water / goal) * 100);
  ui.breakText.textContent = `${data.breaks} break${data.breaks === 1 ? '' : 's'} today`;
  ui.mindfulText.textContent = `${data.mindful} mindful min today`;
}

function toggleBreath(button, circle) {
  if (breathing) {
    clearInterval(breathing.timer);
    circle.classList.remove('in');
    bump('mindful', Math.round((Date.now() - breathing.since) / 60000));
    breathing = null;
    button.textContent = 'Breathe';
    return;
  }
  breathing = { since: Date.now() };
  button.textContent = 'Stop';
  circle.classList.add('in');
  breathing.timer = setInterval(() => circle.classList.toggle('in'), BREATH_PHASE_MS);
}

async function drawScreenTime() {
  if (!ui) return;
  const { days, today: key } = await call('screentime.get');
  const apps = Object.entries(days[key] || {}).sort((a, b) => b[1] - a[1]);
  const total = apps.reduce((sum, [, seconds]) => sum + seconds, 0);
  const longest = apps[0]?.[1] || 1;
  ui.screenTotal.textContent = fmtDuration(total);
  ui.screenList.replaceChildren(...(apps.length ? apps.slice(0, TOP_APPS).map(([name, seconds]) => h('div', {
    class: 'bar-row', title: `${name}: ${fmtDuration(seconds)}`,
  },
  h('span', { class: 'truncate' }, name),
  h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${(seconds / longest) * 100}%` })),
  h('span', { class: 'value-text' }, fmtDuration(seconds)))) : [h('div', { class: 'faint' }, 'Nothing measured yet today')]));
}

export default {
  id: 'health',
  title: 'Health',
  icon: 'heart',

  async init() {
    data = await load('health', blank());
    rollDay();
    listen('store:health', async () => {
      data = await load('health', blank());
      paint();
    });
    setInterval(remind, 30000);
    listen('settings', paint);
  },

  render(view) {
    const breathButton = h('button', { class: 'btn', type: 'button' }, 'Breathe');
    const circle = h('div', { class: 'breath' });
    breathButton.addEventListener('click', () => toggleBreath(breathButton, circle));
    ui = {
      water: meter(0),
      waterText: h('span', { class: 'grow' }),
      breakText: h('span', { class: 'grow' }),
      mindfulText: h('span', { class: 'grow' }),
      screenList: h('div', { class: 'col' }),
      screenTotal: h('span', { class: 'value' }),
    };
    view.append(
      viewTitle('Health'),
      h('div', { class: 'two' },
        h('div', { class: 'card col' },
          h('div', { class: 'row' }, icon('drop', 16), ui.waterText,
            h('button', { class: 'btn', type: 'button', onClick: () => bump('water', -1) }, '-1'),
            h('button', { class: 'btn primary', type: 'button', onClick: () => bump('water') }, '+1')),
          ui.water,
          h('div', { class: 'row' }, icon('heart', 16), ui.breakText,
            h('button', { class: 'btn', type: 'button', onClick: () => bump('breaks') }, 'I took a break')),
          h('div', { class: 'row' }, icon('eye', 16), ui.mindfulText, breathButton),
          h('div', { class: 'empty' }, circle)),
        h('div', { class: 'card col' },
          h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Screen time today'), ui.screenTotal),
          ui.screenList)),
    );
    paint();
    drawScreenTime();
  },

  show: () => { paint(); drawScreenTime(); },
};

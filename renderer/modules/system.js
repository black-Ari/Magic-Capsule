import { batteryPercent } from '../battery.js';
import { call, fmtBytes, fmtDuration, h, icon, meter, viewTitle } from '../core.js';

const POLL_MS = 2000;
const TOP_APPS_EVERY = 3; // polls; listing every process is the slow part
const HISTORY = 60;
const MIN_WINDOW = 10; // a young chart fills the tile instead of huddling in one corner
const TOP_APPS_SHOWN = 4;
const WARNING_AT = 75;
const DANGER_AT = 90;
const MIN_NET_SCALE = 64 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART = { w: 200, h: 44, pad: 3 };

let timer = null;
let last = null;
let polls = 0;
let ui = null;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

const level = (percent) => (percent >= DANGER_AT ? 'danger' : percent >= WARNING_AT ? 'warning' : '');

// One series over time. Hovering shows the value at that moment in the tile's own readout.
function sparkline({ scale, format }) {
  const values = [];
  const area = svgEl('path', { class: 'spark-area' });
  const line = svgEl('path', { class: 'spark-line' });
  const cross = svgEl('line', { class: 'spark-cross', y1: 0, y2: CHART.h });
  const svg = svgEl('svg', { viewBox: `0 0 ${CHART.w} ${CHART.h}`, preserveAspectRatio: 'none', class: 'spark', role: 'img' });
  svg.append(area, line, cross);
  const tip = h('span', { class: 'spark-tip', hidden: true });
  const el = h('div', { class: 'spark-wrap' }, svg, tip);

  const step = () => CHART.w / (Math.max(MIN_WINDOW, values.length) - 1);
  const x = (index) => CHART.w - (values.length - 1 - index) * step();
  const y = (value, top) => CHART.h - CHART.pad - (Math.min(value, top) / top) * (CHART.h - CHART.pad * 2);

  function draw() {
    if (values.length < 2) return;
    const top = scale(values);
    const points = values.map((value, index) => `${x(index).toFixed(1)} ${y(value, top).toFixed(1)}`);
    line.setAttribute('d', `M${points.join('L')}`);
    area.setAttribute('d', `M${x(0).toFixed(1)} ${CHART.h}L${points.join('L')}L${CHART.w} ${CHART.h}Z`);
  }

  el.addEventListener('mousemove', (event) => {
    if (!values.length) return;
    const box = svg.getBoundingClientRect();
    const position = ((event.clientX - box.left) / box.width) * CHART.w;
    const index = Math.max(0, Math.min(values.length - 1, Math.round(values.length - 1 - (CHART.w - position) / step())));
    const age = (values.length - 1 - index) * (POLL_MS / 1000);
    cross.setAttribute('x1', x(index));
    cross.setAttribute('x2', x(index));
    cross.classList.add('on');
    tip.textContent = `${format(values[index])}${age ? ` · ${age}s ago` : ' · now'}`;
    tip.hidden = false;
  });
  el.addEventListener('mouseleave', () => {
    cross.classList.remove('on');
    tip.hidden = true;
  });

  return {
    el,
    push(value) {
      values.push(value);
      if (values.length > HISTORY) values.shift();
      draw();
    },
    clear() {
      values.length = 0;
      line.removeAttribute('d');
      area.removeAttribute('d');
    },
  };
}

const percentChart = () => sparkline({ scale: () => 100, format: (value) => `${Math.round(value)}%` });
const speedChart = () => sparkline({
  scale: (values) => Math.max(MIN_NET_SCALE, ...values) * 1.15,
  format: (value) => `${fmtBytes(value)}/s`,
});

function usageTile(label, chart) {
  const value = h('span', { class: 'value' }, '-');
  const state = h('span', { class: 'state-chip', hidden: true });
  const detail = h('div', { class: 'faint truncate' });
  const bar = chart ? null : meter(0);
  const el = h('div', { class: 'card tile' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'row' }, value, state),
    chart ? chart.el : bar,
    detail);
  return {
    el,
    set(percent, text, warningText, dangerText) {
      const kind = level(percent);
      value.textContent = `${percent}%`;
      detail.textContent = text;
      detail.title = text;
      el.dataset.level = kind;
      state.hidden = !kind;
      if (kind) state.replaceChildren(icon('alert', 12), kind === 'danger' ? dangerText : warningText);
      if (bar) {
        bar.setPercent(percent);
        bar.classList.toggle('warning', kind === 'warning');
        bar.classList.toggle('danger', kind === 'danger');
      }
      if (chart) chart.push(percent);
    },
  };
}

function speedRow(label, iconName) {
  const value = h('span', { class: 'speed-value' }, '-');
  const chart = speedChart();
  const el = h('div', { class: 'speed' },
    h('div', { class: 'row' }, icon(iconName, 14), h('span', { class: 'label grow' }, label), value),
    chart.el);
  return {
    el,
    set(bytesPerSecond) {
      value.textContent = `${fmtBytes(bytesPerSecond)}/s`;
      chart.push(bytesPerSecond);
    },
    clear: chart.clear,
  };
}

function paintStatus({ cpu, memory, disk }) {
  const problem = (memory >= DANGER_AT && ['Memory is nearly full', 'Close apps you are not using to free some up'])
    || (cpu >= DANGER_AT && ['Processor is very busy', 'Something is working hard right now'])
    || (disk >= DANGER_AT && ['Disk is nearly full', 'Delete files you no longer need'])
    || null;
  ui.status.dataset.level = problem ? 'danger' : 'good';
  ui.status.replaceChildren(
    icon(problem ? 'alert' : 'check', 18),
    h('div', { class: 'grow' },
      h('div', { class: 'status-title' }, problem ? problem[0] : 'Everything looks fine'),
      h('div', { class: 'faint' }, problem ? problem[1] : 'Your PC has room to spare')),
  );
}

function paintFacts(stats) {
  const battery = batteryPercent();
  ui.facts.replaceChildren(
    h('span', {}, h('b', {}, fmtDuration(stats.uptime)), ' uptime'),
    battery === null ? '' : h('span', {}, h('b', {}, `${battery}%`), ' battery'),
    h('span', {}, h('b', {}, stats.cores), ' threads'),
  );
}

async function paintTopApps() {
  const apps = await call('system.top').catch(() => null);
  if (!apps || !ui) return;
  const most = apps[0]?.bytes || 1;
  ui.top.replaceChildren(...apps.slice(0, TOP_APPS_SHOWN).map(({ name, bytes }) => h('div', { class: 'bar-row', title: `${name}: ${fmtBytes(bytes)}` },
    h('span', { class: 'truncate' }, name.charAt(0).toUpperCase() + name.slice(1)),
    h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${(bytes / most) * 100}%` })),
    h('span', { class: 'value-text' }, fmtBytes(bytes)))));
}

async function poll() {
  const stats = await call('system.stats').catch(() => null);
  if (!stats || !ui) return;
  const used = stats.memTotal - stats.memFree;
  const usedDisk = stats.diskTotal - stats.diskFree;
  const memory = Math.round((used / stats.memTotal) * 100);
  const disk = Math.round((usedDisk / stats.diskTotal) * 100);
  ui.cpu.set(stats.cpu, stats.cpuName, 'Busy', 'Very busy');
  ui.memory.set(memory, `${fmtBytes(used)} of ${fmtBytes(stats.memTotal)}`, 'Getting full', 'Nearly full');
  ui.disk.set(disk, `${fmtBytes(stats.diskFree)} free of ${fmtBytes(stats.diskTotal)}`, 'Getting full', 'Nearly full');
  paintStatus({ cpu: stats.cpu, memory, disk });
  paintFacts(stats);
  if (last) {
    const seconds = (stats.at - last.at) / 1000;
    ui.down.set(Math.max(0, (stats.net.rx - last.net.rx) / seconds));
    ui.up.set(Math.max(0, (stats.net.tx - last.net.tx) / seconds));
  }
  last = stats;
  if (polls % TOP_APPS_EVERY === 0) paintTopApps();
  polls += 1;
}

export default {
  id: 'system',
  title: 'System',
  icon: 'chip',

  render(view) {
    ui = {
      status: h('div', { class: 'status-line' }),
      facts: h('div', { class: 'facts' }),
      cpu: usageTile('Processor', percentChart()),
      memory: usageTile('Memory', percentChart()),
      disk: usageTile('Disk'),
      down: speedRow('Download', 'down'),
      up: speedRow('Upload', 'up'),
      top: h('div', { class: 'col' }, h('div', { class: 'faint' }, 'Checking...')),
    };
    view.append(
      viewTitle('System'),
      h('div', { class: 'card status-card' }, ui.status, ui.facts),
      h('div', { class: 'tiles' }, ui.cpu.el, ui.memory.el, ui.disk.el),
      h('div', { class: 'system-lower' },
        h('div', { class: 'card col' }, ui.down.el, ui.up.el),
        h('div', { class: 'card col scroll' }, h('div', { class: 'label' }, 'Using the most memory'), ui.top)),
    );
  },

  show() {
    clearInterval(timer);
    polls = 0;
    poll();
    timer = setInterval(poll, POLL_MS);
  },

  hide() {
    clearInterval(timer);
    timer = null;
    last = null;
  },
};

// The small readouts either side of the clock on the closed notch.
import { batteryPercent } from './battery.js';
import { call, fmtDate, fmtTime, listen, state } from './core.js';
import { setExtras } from './live.js';
import { upcoming } from './modules/calendar.js';
import { openTasks } from './modules/tasks.js';
import { current as currentWeather } from './modules/weather.js';

const REFRESH_MS = 30000;
const EVENT_WINDOW_MS = 12 * 3600000;
const MAX_CHARS = 18;

export const EXTRA_OPTIONS = [
  ['none', 'Nothing'], ['weather', 'Weather'], ['battery', 'Battery'], ['date', 'Date'],
  ['event', 'Next event'], ['task', 'Next task'], ['time', 'Time'], ['cpu', 'CPU'], ['memory', 'Memory'], ['disk', 'Disk'],
];

const shorten = (text) => (text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text);

async function readStats() {
  return call('system.stats').catch(() => null);
}

async function value(kind, stats) {
  switch (kind) {
    case 'weather': {
      const weather = currentWeather();
      return weather ? `${Math.round(weather.temperature_2m)}°` : '';
    }
    case 'battery': return batteryPercent() === null ? '' : `${batteryPercent()}%`;
    case 'date': return fmtDate(Date.now(), { weekday: 'short', day: 'numeric' });
    case 'time': return fmtTime(Date.now());
    case 'event': {
      const next = upcoming(1)[0];
      return next && next.start - Date.now() <= EVENT_WINDOW_MS ? shorten(next.title) : '';
    }
    case 'task': {
      const next = openTasks()[0];
      return next ? shorten(next.text) : '';
    }
    case 'cpu': return stats ? `CPU ${stats.cpu}%` : '';
    case 'memory': return stats ? `RAM ${Math.round((1 - stats.memFree / stats.memTotal) * 100)}%` : '';
    case 'disk': return stats ? `Disk ${Math.round((1 - stats.diskFree / stats.diskTotal) * 100)}%` : '';
    default: return '';
  }
}

export async function refreshExtras() {
  const { closedLeft, closedRight } = state.settings;
  const needsStats = [closedLeft, closedRight].some((kind) => ['cpu', 'memory', 'disk'].includes(kind));
  const stats = needsStats ? await readStats() : null;
  setExtras(await value(closedLeft, stats), await value(closedRight, stats));
}

export function startExtras() {
  refreshExtras();
  setInterval(refreshExtras, REFRESH_MS);
  listen('settings', refreshExtras);
  listen('agenda', refreshExtras);
}

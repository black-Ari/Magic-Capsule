import { call, emit, fmtDate, fmtTime, h, icon, iconButton, listen, saveSettings, state, viewTitle } from '../core.js';

const REFRESH_MS = 30 * 60000;

let data = null;
let error = '';
let body;

export function describe(code, isDay = 1) {
  if (code === 0) return { label: 'Clear', icon: isDay ? 'sun' : 'moon' };
  if (code <= 3) return { label: code === 1 ? 'Mostly clear' : code === 2 ? 'Partly cloudy' : 'Overcast', icon: code === 1 && !isDay ? 'moon' : code === 1 ? 'sun' : 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'fog' };
  if (code >= 95) return { label: 'Thunderstorm', icon: 'bolt' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: 'snow' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'rain' };
  return { label: 'Rain', icon: 'rain' };
}

export const current = () => (data ? { ...data.current, place: state.settings.weather.place } : null);

async function refresh(force = false) {
  const { place, unit } = state.settings.weather;
  if (!place) { data = null; draw(); return; }
  try {
    data = await call('weather.forecast', place, unit, force);
    error = '';
  } catch (err) {
    error = `Weather unavailable: ${err.message}`;
  }
  draw();
  emit('agenda');
}

function citySearch() {
  const input = h('input', { type: 'search', class: 'grow', placeholder: 'Search your city', ariaLabel: 'City' });
  const results = h('div', { class: 'col scroll' });
  const search = async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (name.length < 2) return;
    results.replaceChildren(h('div', { class: 'faint' }, 'Searching...'));
    try {
      const places = await call('weather.search', name);
      results.replaceChildren(...(places.length ? places.map((place) => h('button', {
        class: 'btn', type: 'button',
        onClick: async () => {
          await saveSettings({ weather: { ...state.settings.weather, place } });
          refresh(true);
        },
      }, [place.name, place.region, place.country].filter(Boolean).join(', '))) : [h('div', { class: 'faint' }, 'No match')]));
    } catch (err) {
      results.replaceChildren(h('div', { class: 'error' }, err.message));
    }
  };
  return h('div', { class: 'col grow' },
    h('form', { class: 'row', onSubmit: search }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Find')),
    results);
}

function draw() {
  if (!body) return;
  const { place, unit } = state.settings.weather;
  if (!place || !data) {
    body.replaceChildren(error ? h('div', { class: 'error' }, error) : '', citySearch());
    return;
  }

  const symbol = unit === 'fahrenheit' ? '°F' : '°';
  const now = data.current;
  emit('pet-weather', now.weather_code);
  const look = describe(now.weather_code, now.is_day);
  const first = data.hourly.time.findIndex((time) => new Date(time).getTime() >= Date.now() - 3600000);
  const hours = data.hourly.time.slice(first, first + 12).map((time, index) => {
    const i = first + index;
    return h('div', { class: 'hour', title: `${data.hourly.precipitation_probability[i] ?? 0}% chance of rain` },
      h('span', { class: 'faint' }, fmtTime(new Date(time).getTime(), { hour: 'numeric', minute: undefined })),
      icon(describe(data.hourly.weather_code[i], data.hourly.is_day[i]).icon, 18),
      h('span', {}, `${Math.round(data.hourly.temperature_2m[i])}${symbol}`));
  });
  const week = data.daily.time.map((time, i) => h('div', { class: 'week-day', title: describe(data.daily.weather_code[i]).label },
    h('span', { class: 'faint' }, fmtDate(new Date(`${time}T12:00`).getTime(), { weekday: 'short' })),
    icon(describe(data.daily.weather_code[i]).icon, 20),
    h('span', {}, `${Math.round(data.daily.temperature_2m_max[i])}${symbol}`),
    h('span', { class: 'faint' }, `${Math.round(data.daily.temperature_2m_min[i])}${symbol}`)));

  body.replaceChildren(
    h('div', { class: 'weather-now' },
      icon(look.icon, 44),
      h('div', { class: 'weather-temp' }, `${Math.round(now.temperature_2m)}${symbol}`),
      h('div', {},
        h('div', {}, `${look.label} in ${place.name}`),
        h('div', { class: 'faint' }, `Feels like ${Math.round(now.apparent_temperature)}${symbol} · Humidity ${now.relative_humidity_2m}% · Wind ${Math.round(now.wind_speed_10m)} km/h`))),
    h('div', { class: 'hours' }, hours),
    h('div', { class: 'week' }, week),
    error ? h('div', { class: 'error' }, error) : '',
  );
}

export default {
  id: 'weather',
  title: 'Weather',
  icon: 'cloud',

  async init() {
    refresh();
    setInterval(refresh, REFRESH_MS);
    let key = JSON.stringify(state.settings.weather);
    listen('settings', () => {
      const next = JSON.stringify(state.settings.weather);
      if (next !== key) { key = next; refresh(); }
    });
  },

  render(view) {
    body = h('div', { class: 'col grow' });
    view.append(
      viewTitle('Weather',
        iconButton('search', 'Change city', async () => {
          await saveSettings({ weather: { ...state.settings.weather, place: null } });
          data = null;
          draw();
        }),
        iconButton('refresh', 'Refresh', () => refresh(true))),
      body,
    );
    draw();
  },
};

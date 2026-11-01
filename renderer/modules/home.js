import { call, emit, fmtClock, fmtDuration, fmtTime, fmtUntil, h, icon, iconButton, listen, meter, on, state } from '../core.js';
import { RANK, setActivity } from '../live.js';
import { upcoming } from './calendar.js';
import { openTasks } from './tasks.js';
import { current as currentWeather, describe } from './weather.js';

const PEEK_MS = 3000;
const FRIENDLY_APPS = [[/spotify/i, 'Spotify'], [/chrome/i, 'Chrome'], [/edge/i, 'Edge'], [/firefox/i, 'Firefox'], [/vlc/i, 'VLC'], [/music|zune/i, 'Media Player']];

let media = null;
let art = null;
let positionAt = 0;
let ui = null;
let lyrics = [];
let lyricLine = '';

const position = () => {
  if (!media) return 0;
  const moved = media.playing ? (Date.now() - positionAt) / 1000 : 0;
  return media.duration ? Math.min(media.duration, media.position + moved) : media.position + moved;
};

const appName = (id) => (FRIENDLY_APPS.find(([pattern]) => pattern.test(id)) || [null, 'Media'])[1];

const bars = () => h('span', { class: `bars ${media && media.playing ? 'live' : ''}` }, h('i'), h('i'), h('i'), h('i'));

function dominantColor(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onerror = () => resolve(null);
    image.onload = () => {
      const size = 24;
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, size, size);
      const { data } = context.getImageData(0, 0, size, size);
      let [red, green, blue, weight] = [0, 0, 0, 0];
      for (let i = 0; i < data.length; i += 4) {
        const saturation = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
        const w = saturation * saturation + 1;
        red += data[i] * w;
        green += data[i + 1] * w;
        blue += data[i + 2] * w;
        weight += w;
      }
      const lift = 255 / Math.max(red / weight, green / weight, blue / weight, 1);
      const channel = (value) => Math.round(Math.min(255, (value / weight) * Math.min(lift, 1.6)));
      resolve(`rgb(${channel(red)} ${channel(green)} ${channel(blue)})`);
    };
    image.src = url;
  });
}

function updatePill() {
  if (!media || !media.title) {
    setActivity('music', null);
    return;
  }
  const left = art ? h('img', { class: 'pill-art', src: art, alt: '' }) : icon('play', 14);
  const progress = media.duration ? position() / media.duration : undefined;
  setActivity('music', {
    rank: RANK.music, source: 'music', left, text: lyricLine || media.title, right: bars(), progress,
  });
}

function sneakPeek() {
  if (!state.settings.live.sneakPeek || !media || !media.title) return;
  setActivity('peek', {
    rank: RANK.peek, ttl: PEEK_MS, left: icon('play', 14), text: media.title, sub: media.artist,
  });
}

let notchOpen = false;

const trackKey = () => (media ? `${media.title}|${media.artist}` : '');

async function loadLyrics() {
  lyrics = [];
  lyricLine = '';
  if (!state.settings.lyrics || !media || !media.title) return;
  const key = trackKey();
  const lines = await call('lyrics.get', { title: media.title, artist: media.artist, duration: media.duration }).catch(() => []);
  if (key === trackKey()) lyrics = lines;
}

function paintLyric() {
  if (!lyrics.length && !lyricLine) return;
  const now = position();
  const line = media && media.playing ? [...lyrics].reverse().find((item) => item.at <= now)?.text || '' : '';
  if (line === lyricLine) return;
  lyricLine = line;
  updatePill();
  if (ui) ui.lyric.textContent = line;
}

function drawMusic() {
  if (!ui) return;
  ui.art.replaceChildren(art ? h('img', { class: 'art', src: art, alt: '' }) : h('div', { class: 'art art-empty' }, icon('play', 34)));
  ui.title.textContent = media?.title || 'Nothing playing';
  ui.artist.textContent = media ? [media.artist, appName(media.app)].filter(Boolean).join(' · ') : 'Play something in any app';
  ui.toggle.replaceChildren(icon(media?.playing ? 'pause' : 'play', 18));
  for (const button of [ui.prev, ui.next, ui.toggle]) button.disabled = !media;
  ui.seek.disabled = !media || !media.canSeek || !media.duration;
  paintProgress();
}

// Nothing moves unless music is playing, and nobody can see the panel while the notch is closed, so
// the timer writes to the page only then. Writing every second kept a closed notch redrawing.
function tickProgress() {
  if (!media?.playing) return;
  if (state.settings.live.progress) updatePill();
  if (notchOpen) paintProgress();
}

function paintProgress() {
  if (!ui) return;
  const duration = media?.duration || 0;
  ui.elapsed.textContent = media ? fmtClock(Math.floor(position())) : '';
  ui.total.textContent = duration ? fmtClock(duration) : '';
  if (document.activeElement !== ui.seek) {
    ui.seek.max = duration || 1;
    ui.seek.value = duration ? position() : 0;
  }
}

function action(name, seconds) {
  call('media.action', name, seconds).catch(() => {});
}

function drawGlance() {
  if (!ui) return;
  const events = upcoming(3).map((event) => h('div', { class: 'agenda-item' },
    h('span', { class: 'dot' }),
    h('span', { class: 'grow truncate' }, event.title),
    event.join && h('button', { class: 'btn', type: 'button', onClick: () => call('links.open', event.join) }, 'Join'),
    h('span', { class: 'chip' }, event.start > Date.now() ? fmtUntil(event.start) : 'now')));
  const tasks = openTasks().slice(0, Math.max(1, 3 - events.length)).map((task) => h('div', { class: 'agenda-item' },
    icon('check', 14),
    h('span', { class: 'grow truncate' }, task.text),
    task.due && h('span', { class: 'chip' }, task.due > Date.now() ? fmtUntil(task.due) : 'Overdue')));
  ui.agenda.replaceChildren(...(events.length || tasks.length ? [...events, ...tasks] : [h('div', { class: 'faint' }, 'Nothing coming up')]));

  const weather = currentWeather();
  if (weather) {
    const look = describe(weather.weather_code, weather.is_day);
    ui.weather.replaceChildren(icon(look.icon, 22),
      h('span', { class: 'grow truncate' }, `${look.label}, ${weather.place.name}`),
      h('b', {}, `${Math.round(weather.temperature_2m)}°`));
  } else {
    ui.weather.replaceChildren(h('button', {
      class: 'btn', type: 'button', onClick: () => emit('open-tab', 'weather'),
    }, icon('cloud', 15), 'Set your city'));
  }
  paintDay();
}

const atClock = (text, base) => {
  const [hours, minutes] = text.split(':').map(Number);
  const date = new Date(base);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
};

function paintDay() {
  if (!ui) return;
  const now = Date.now();
  const { wake, bed } = state.settings.day;
  let start = atClock(wake, now);
  if (start > now) start -= 86400000;
  let end = atClock(bed, start);
  if (end <= start) end += 86400000; // a bedtime after midnight belongs to the next day
  const percent = Math.min(100, ((now - start) / (end - start)) * 100);
  ui.dayText.textContent = now >= end
    ? 'Past bedtime, get some rest'
    : `${fmtTime(now)} · ${Math.round(percent)}% of your day · ${fmtDuration((end - now) / 1000)} to bedtime`;
  ui.day.setPercent(percent);
}

function musicCard() {
  ui.art = h('div');
  ui.title = h('div', { class: 'track-title truncate selectable' });
  ui.artist = h('div', { class: 'label truncate' });
  ui.lyric = h('div', { class: 'lyric truncate' });
  ui.prev = iconButton('prev', 'Previous', () => action('prev'), 'btn ghost round');
  ui.toggle = iconButton('play', 'Play or pause', () => action('toggle'), 'btn primary round');
  ui.next = iconButton('next', 'Next', () => action('next'), 'btn ghost round');
  ui.seek = h('input', {
    type: 'range', class: 'seek', min: 0, max: 1, step: 1, ariaLabel: 'Seek',
    onChange: () => { action('seek', Number(ui.seek.value)); ui.seek.blur(); },
  });
  ui.elapsed = h('span');
  ui.total = h('span');
  return h('div', { class: 'card music' },
    ui.art,
    h('div', { class: 'col grow' },
      h('div', {}, ui.title, ui.artist, ui.lyric),
      h('div', {}, ui.seek, h('div', { class: 'progress-time' }, ui.elapsed, ui.total)),
      h('div', { class: 'row' }, ui.prev, ui.toggle, ui.next)));
}

export default {
  id: 'home',
  title: 'Home',
  icon: 'home',

  init() {
    on('media', (next) => {
      const previous = trackKey();
      media = next;
      positionAt = Date.now();
      if (!next) art = null;
      if (trackKey() !== previous) {
        loadLyrics();
        if (previous) sneakPeek();
      }
      updatePill();
      drawMusic();
    });
    on('art', async (next) => {
      art = next;
      const color = next ? await dominantColor(next) : null;
      if (color) document.documentElement.style.setProperty('--art', color);
      else document.documentElement.style.removeProperty('--art');
      updatePill();
      drawMusic();
    });
    listen('agenda', drawGlance);
    listen('settings', () => {
      drawGlance();
      if (Boolean(state.settings.lyrics) !== Boolean(lyrics.length)) loadLyrics();
    });
    listen('notch', (open) => {
      notchOpen = open;
      if (open) paintProgress();
    });
    setInterval(tickProgress, 1000);
    setInterval(paintLyric, 400);
    setInterval(() => { if (notchOpen) drawGlance(); }, 60000);
  },

  render(view) {
    ui = {};
    ui.agenda = h('div', { class: 'col' });
    ui.weather = h('div', { class: 'row' });
    ui.day = meter(0);
    ui.dayText = h('div', { class: 'label' });
    view.append(h('div', { class: 'home' },
      musicCard(),
      h('div', { class: 'glance' },
        h('div', { class: 'card col grow' }, h('div', { class: 'label' }, 'Next up'), ui.agenda),
        h('div', { class: 'card' }, ui.weather),
        h('div', { class: 'card col' }, ui.dayText, ui.day))));
    drawMusic();
    drawGlance();
  },

  show: () => drawGlance(),
};

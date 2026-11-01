'use strict';

const fetch = require('./fetch');
const store = require('./store');

const WEATHER_TTL_MS = 30 * 60000;
const RATES_TTL_MS = 12 * 3600000;
const TIMEOUT_MS = 15000;

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function searchPlaces(name) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, count: '6', language: 'en', format: 'json' });
  const { results = [] } = await getJson(url);
  return results.map(({ name: city, admin1, country, latitude, longitude }) => ({
    name: city, region: admin1 || '', country: country || '', latitude, longitude,
  }));
}

async function forecast(place, unit, force = false) {
  const key = `${place.latitude},${place.longitude},${unit}`;
  const cached = store.get('weather-cache', null);
  if (!force && cached && cached.key === key && Date.now() - cached.at < WEATHER_TTL_MS) return cached.data;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max',
    forecast_days: '7',
    timezone: 'auto',
    temperature_unit: unit,
  });
  const data = await getJson(url);
  store.set('weather-cache', { key, at: Date.now(), data });
  return data;
}

async function rates() {
  const cached = store.get('rates-cache', null);
  if (cached && Date.now() - cached.at < RATES_TTL_MS) return cached;
  try {
    const data = await getJson('https://open.er-api.com/v6/latest/USD');
    if (data.result !== 'success') throw new Error('rate service error');
    const fresh = { at: Date.now(), rates: data.rates };
    store.set('rates-cache', fresh);
    return fresh;
  } catch (err) {
    if (cached) return cached; // stale rates beat no rates; the UI shows their age
    throw err;
  }
}

// Song titles from video sites carry noise like "(Official Video)" that hides the real track.
const cleanTitle = (title) => title.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s+/g, ' ').trim();

function parseLrc(text) {
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (match && match[3].trim()) lines.push({ at: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() });
  }
  return lines.sort((a, b) => a.at - b.at);
}

const lyricsCache = new Map();
const LYRICS_CACHE_SIZE = 30;

async function lrclib(pathAndQuery) {
  const response = await fetch(`https://lrclib.net/api/${pathAndQuery}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Magic Capsule personal notch' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function findLyrics({ title, artist, duration }) {
  const track = cleanTitle(title);
  const exact = new URLSearchParams({ track_name: track, artist_name: artist || '' });
  if (duration) exact.set('duration', duration);
  const direct = artist ? await lrclib(`get?${exact}`) : null;
  if (direct && direct.syncedLyrics) return direct;
  const results = await lrclib(`search?${new URLSearchParams({ q: [track, artist].filter(Boolean).join(' ') })}`);
  return (results || []).find((item) => item.syncedLyrics) || null;
}

// Only runs when lyrics are turned on, and sends just the song name and artist to lrclib.net.
async function lyrics(song) {
  const key = `${song.title}|${song.artist}`;
  if (lyricsCache.has(key)) return lyricsCache.get(key);
  const found = await findLyrics(song);
  const lines = found ? parseLrc(found.syncedLyrics) : [];
  if (lyricsCache.size >= LYRICS_CACHE_SIZE) lyricsCache.delete(lyricsCache.keys().next().value);
  lyricsCache.set(key, lines);
  return lines;
}

module.exports = { searchPlaces, forecast, rates, lyrics, parseLrc, cleanTitle };

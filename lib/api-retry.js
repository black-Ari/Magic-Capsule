'use strict';

const fetch = require('./fetch');

// Free and busy APIs often refuse a request for a moment, which should not end a long task.
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_TRIES = 4;
const BASE_WAIT_MS = 2000;
const MAX_WAIT_MS = 30000;

const pause = (ms, signal) => new Promise((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
});

function waitBefore(response, attempt) {
  const asked = Number(response?.headers.get('retry-after'));
  return asked > 0 ? asked * 1000 : BASE_WAIT_MS * 2 ** (attempt - 1);
}

// Returns the last response, good or bad, so the caller reports the error in its own words.
async function fetchWithRetry(url, options, onRetry) {
  for (let attempt = 1; ; attempt += 1) {
    let response = null;
    try {
      response = await fetch(url, options);
      if (response.ok || !RETRY_STATUS.has(response.status)) return response;
    } catch (err) {
      if (options.signal?.aborted || attempt >= MAX_TRIES) throw err;
    }
    const wait = waitBefore(response, attempt);
    if (attempt >= MAX_TRIES || wait > MAX_WAIT_MS) return response;
    await response?.body?.cancel().catch(() => {});
    onRetry?.(wait);
    await pause(wait, options.signal);
  }
}

module.exports = { fetchWithRetry };

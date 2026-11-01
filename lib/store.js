'use strict';

// One JSON file per namespace in %APPDATA%\Nook\data, so a single tool can be wiped on its own.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const WRITE_DELAY_MS = 300;
const cache = new Map();
const pending = new Map();

const dataDir = () => path.join(app.getPath('userData'), 'data');
const fileFor = (ns) => path.join(dataDir(), `${ns}.json`);

function read(ns, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(ns), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Keep the damaged file so nothing is lost silently.
      try { fs.renameSync(fileFor(ns), `${fileFor(ns)}.corrupt-${Date.now()}`); } catch {}
    }
    return fallback;
  }
}

function get(ns, fallback = null) {
  if (!cache.has(ns)) cache.set(ns, read(ns, fallback));
  return cache.get(ns);
}

function writeNow(ns) {
  clearTimeout(pending.get(ns));
  pending.delete(ns);
  fs.mkdirSync(dataDir(), { recursive: true });
  const target = fileFor(ns);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache.get(ns)));
  fs.renameSync(tmp, target);
}

function set(ns, value) {
  cache.set(ns, value);
  clearTimeout(pending.get(ns));
  pending.set(ns, setTimeout(() => writeNow(ns), WRITE_DELAY_MS));
}

function flush() {
  for (const ns of [...pending.keys()]) writeNow(ns);
}

function clear(ns) {
  clearTimeout(pending.get(ns));
  pending.delete(ns);
  cache.delete(ns);
  fs.rmSync(fileFor(ns), { force: true });
}

// API keys are encrypted with Windows DPAPI and never go back to the renderer.
const secrets = {
  file: () => path.join(dataDir(), 'secrets.json'),
  all() {
    try { return JSON.parse(fs.readFileSync(this.file(), 'utf8')); } catch { return {}; }
  },
  has(name) {
    return Boolean(this.all()[name]);
  },
  get(name) {
    const value = this.all()[name];
    return value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : '';
  },
  set(name, value) {
    if (value && !safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available');
    const all = this.all();
    if (value) all[name] = safeStorage.encryptString(value).toString('base64');
    else delete all[name];
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(this.file(), JSON.stringify(all));
  },
};

module.exports = { get, set, flush, clear, secrets };

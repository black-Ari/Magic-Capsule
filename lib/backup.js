'use strict';

const fs = require('fs');
const store = require('./store');

const FORMAT = 'nook-backup';
const VERSION = 1;
// Left out on purpose: API keys (encrypted for this PC only), clipboard history (may hold private
// text), and shelf paths (they mean nothing on another PC).
const INCLUDED = ['settings', 'tasks', 'notes', 'events', 'links', 'clocks', 'health', 'screentime', 'skills', 'memory'];

// An MCP server can be any program, and a backup file can come from anywhere, so nothing in one runs
// until the person turns it on again. Turbo goes off too: a file should never remove the questions.
function withServersOff(settings) {
  if (!settings?.ai) return settings;
  const servers = settings.ai.mcpServers;
  return {
    ...settings,
    ai: { ...settings.ai, turbo: false, ...(Array.isArray(servers) ? { mcpServers: servers.map((server) => ({ ...server, on: false })) } : {}) },
  };
}

function write(file) {
  const data = {};
  for (const ns of INCLUDED) {
    const value = store.get(ns, null);
    if (value !== null) data[ns] = value;
  }
  fs.writeFileSync(file, JSON.stringify({ format: FORMAT, version: VERSION, at: Date.now(), data }, null, 1));
}

function read(file) {
  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('That file is not a Magic Capsule backup');
  }
  if (backup.format !== FORMAT || typeof backup.data !== 'object' || backup.data === null) {
    throw new Error('That file is not a Magic Capsule backup');
  }
  if (backup.version > VERSION) throw new Error('This backup is from a newer version of Magic Capsule');
  for (const ns of INCLUDED) {
    if (Object.hasOwn(backup.data, ns)) store.set(ns, ns === 'settings' ? withServersOff(backup.data[ns]) : backup.data[ns]);
  }
}

module.exports = { write, read, withServersOff };

'use strict';

// Files given to the AI. Text is included directly, images and PDFs are sent to the provider, and
// anything else is described by name so the agent can still open it. Kept in memory for the session.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_BINARY_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const TEXT_FILE = /\.(txt|md|csv|tsv|json|jsonc|xml|html?|css|js|mjs|ts|tsx|jsx|py|java|kt|c|h|cpp|cs|go|rs|rb|php|sh|bat|ps1|ini|toml|ya?ml|log|sql|srt)$/i;

const kept = new Map();

function looksLikeText(buffer) {
  return !buffer.subarray(0, 4096).includes(0);
}

function prepare(file) {
  const stat = fs.statSync(file);
  const name = path.basename(file);
  const extension = path.extname(file).toLowerCase();
  const base = { id: crypto.randomUUID(), name, path: file, size: stat.size };

  if (stat.isDirectory()) return { ...base, kind: 'other' };
  if (IMAGE_TYPES[extension] && stat.size <= MAX_BINARY_BYTES) {
    return { ...base, kind: 'image', media: IMAGE_TYPES[extension], data: fs.readFileSync(file).toString('base64') };
  }
  if (extension === '.pdf' && stat.size <= MAX_BINARY_BYTES) {
    return { ...base, kind: 'pdf', media: 'application/pdf', data: fs.readFileSync(file).toString('base64') };
  }
  if (stat.size <= MAX_TEXT_BYTES) {
    const buffer = fs.readFileSync(file);
    if (TEXT_FILE.test(name) || looksLikeText(buffer)) return { ...base, kind: 'text', text: buffer.toString('utf8') };
  }
  return { ...base, kind: 'other' };
}

function add(paths) {
  return paths.map((file) => {
    const item = prepare(file);
    kept.set(item.id, item);
    const { data, text, ...summary } = item;
    return summary;
  });
}

const find = (ids = []) => ids.map((id) => kept.get(id)).filter(Boolean);

function asText(item) {
  if (item.kind === 'text') return `<file name=${JSON.stringify(item.name)} path=${JSON.stringify(item.path)}>\n${item.text}\n</file>`;
  if (item.kind === 'other') return `[Attached file ${JSON.stringify(item.name)} at ${item.path}, ${item.size} bytes. Its contents cannot be read directly.]`;
  return `[Attached: ${item.name}]`;
}

function promptWith(text, items) {
  const notes = items.map(asText);
  return [...notes, text].filter(Boolean).join('\n\n');
}

module.exports = { add, find, promptWith };

'use strict';

// File work for the agent. All of it is async, because a blocked main process would freeze the notch.
const fs = require('fs/promises');
const path = require('path');

const MAX_EDIT_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_BYTES = 1024 * 1024;
const MAX_RESULTS = 200;
const MAX_ENTRIES = 50000;
const SEARCH_MS = 20000;
const SKIPPED = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information', 'Windows', 'AppData']);

async function editFile({ path: file, old_text: oldText, new_text: newText }) {
  const stat = await fs.stat(file);
  if (stat.size > MAX_EDIT_BYTES) throw new Error('That file is too large to edit here');
  const raw = await fs.readFile(file);
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) throw new Error('That is not a UTF-8 text file. Change it with run_command instead.');
  if (!oldText) throw new Error('old_text cannot be empty');
  const found = text.split(oldText).length - 1;
  if (found === 0) throw new Error('old_text was not found. Read the file again and copy it exactly.');
  if (found > 1) throw new Error(`old_text appears ${found} times. Include more of the text around it.`);
  await fs.writeFile(file, text.replace(oldText, () => newText));
  return `Changed ${file}.`;
}

function namePattern(name) {
  const escaped = name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(/[*?]/.test(name) ? `^${escaped}$` : escaped, 'i');
}

async function linesWith(file, wanted) {
  const stat = await fs.stat(file);
  if (stat.size > MAX_SEARCH_BYTES) return [];
  const raw = await fs.readFile(file);
  if (raw.subarray(0, 4096).includes(0)) return []; // not text
  const hits = [];
  raw.toString('utf8').split(/\r?\n/).forEach((line, index) => {
    if (line.toLowerCase().includes(wanted)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 200)}`);
  });
  return hits;
}

async function searchFiles({ folder, name, text }, signal) {
  if (!name && !text) throw new Error('Give a file name, some text to find, or both');
  const pattern = name ? namePattern(name) : null;
  const wanted = text ? String(text).toLowerCase() : '';
  const deadline = Date.now() + SEARCH_MS;
  const results = [];
  const queue = [folder];
  let entries = 0;
  let cut = '';

  while (queue.length && results.length < MAX_RESULTS) {
    if (signal?.aborted) break;
    if (Date.now() > deadline || entries > MAX_ENTRIES) { cut = 'The search stopped early. Try a smaller folder.'; break; }
    const current = queue.shift();
    let items;
    try {
      items = await fs.readdir(current, { withFileTypes: true });
    } catch {
      if (current === folder) throw new Error(`Cannot open ${folder}`);
      continue; // a folder Windows will not let us read
    }
    for (const item of items) {
      entries += 1;
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        if (!SKIPPED.has(item.name)) queue.push(full);
        if (!pattern || !pattern.test(item.name) || wanted) continue;
        results.push(`${full}\\`);
      } else if (item.isFile() && (!pattern || pattern.test(item.name))) {
        if (wanted) results.push(...await linesWith(full, wanted).catch(() => []));
        else results.push(full);
      }
      if (results.length >= MAX_RESULTS) { cut = `Showing the first ${MAX_RESULTS}.`; break; }
    }
  }
  if (!results.length) return cut || 'Nothing found.';
  return [...results.slice(0, MAX_RESULTS), cut].filter(Boolean).join('\n');
}

// The Recycle Bin keeps this undoable, and these places are never a sensible thing to bin.
function assertDeletable(file, home) {
  const full = path.resolve(file);
  const blocked = [path.parse(full).root, home, process.env.windir, process.env.ProgramFiles, process.env['ProgramFiles(x86)']];
  if (blocked.some((place) => place && full.toLowerCase() === path.resolve(place).toLowerCase())) {
    throw new Error('That folder is too important to delete');
  }
  return full;
}

module.exports = { assertDeletable, editFile, searchFiles };

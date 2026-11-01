'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const store = require('./store');
const { uniquePath } = require('./shelf-path');

const MAX_CONVERT_BYTES = 60 * 1024 * 1024;

function describe(file) {
  const stat = fs.statSync(file);
  return {
    id: crypto.randomUUID(),
    path: file,
    name: path.basename(file),
    size: stat.size,
    isDir: stat.isDirectory(),
    at: Date.now(),
  };
}

// Paths go through an environment variable so no file name is ever parsed as PowerShell.
function powershell(script, job) {
  const env = { ...process.env, NOOK_JOB: JSON.stringify(job) };
  const prefix = '$ErrorActionPreference="Stop"; $job = $env:NOOK_JOB | ConvertFrom-Json; ';
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', prefix + script], { env, windowsHide: true }, (err, _out, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve();
    });
  });
}

class Shelf {
  constructor({ onChange }) {
    this.onChange = onChange;
  }

  items() {
    return store.get('shelf', []).map((item) => ({ ...item, missing: !fs.existsSync(item.path) }));
  }

  save(items) {
    const clean = items.map(({ missing, ...item }) => item);
    store.set('shelf', clean);
    this.onChange(this.items());
    return this.items();
  }

  find(id) {
    const item = this.items().find((candidate) => candidate.id === id);
    if (!item) throw new Error('That item is no longer on the shelf');
    return item;
  }

  usable(ids) {
    const items = ids.map((id) => this.find(id)).filter((item) => !item.missing);
    if (!items.length) throw new Error('Select at least one file that still exists');
    return items;
  }

  add(paths) {
    const known = new Set(this.items().map((item) => item.path));
    const added = paths.filter((file) => !known.has(file) && fs.existsSync(file)).map(describe);
    return this.save([...added, ...this.items()]);
  }

  remove(id) {
    return this.save(this.items().filter((item) => item.id !== id));
  }

  open(id) {
    return shell.openPath(this.find(id).path);
  }

  reveal(id) {
    shell.showItemInFolder(this.find(id).path);
  }

  async zip(ids) {
    const items = this.usable(ids);
    const name = items.length === 1 ? `${path.parse(items[0].name).name}.zip` : 'Archive.zip';
    const output = uniquePath(path.dirname(items[0].path), name);
    await powershell('Compress-Archive -LiteralPath $job.files -DestinationPath $job.output', {
      files: items.map((item) => item.path), output,
    });
    this.add([output]);
    return output;
  }

  async unzip(ids) {
    const archives = this.usable(ids).filter((item) => /\.zip$/i.test(item.name));
    if (!archives.length) throw new Error('Select a .zip file to extract');
    for (const item of archives) {
      const output = uniquePath(path.dirname(item.path), path.parse(item.name).name);
      await powershell('Expand-Archive -LiteralPath $job.file -DestinationPath $job.output', { file: item.path, output });
      this.add([output]);
    }
  }

  copyTo(ids, folder) {
    for (const item of this.usable(ids)) {
      fs.cpSync(item.path, uniquePath(folder, item.name), { recursive: true, errorOnExist: true, force: false });
    }
  }

  moveTo(ids, folder) {
    const moved = new Map();
    for (const item of this.usable(ids)) {
      const target = uniquePath(folder, item.name);
      try {
        fs.renameSync(item.path, target);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err; // a different drive needs a copy first
        fs.cpSync(item.path, target, { recursive: true, errorOnExist: true, force: false });
        fs.rmSync(item.path, { recursive: true });
      }
      moved.set(item.id, target);
    }
    this.save(this.items().map((item) => (moved.has(item.id)
      ? { ...item, path: moved.get(item.id), name: path.basename(moved.get(item.id)) }
      : item)));
  }

  async trash(ids) {
    const items = this.usable(ids);
    for (const item of items) await shell.trashItem(item.path);
    const gone = new Set(items.map((item) => item.id));
    this.save(this.items().filter((item) => !gone.has(item.id)));
  }

  readForConvert(id) {
    const item = this.find(id);
    if (item.size > MAX_CONVERT_BYTES) throw new Error('That image is too large to convert here');
    return fs.readFileSync(item.path).toString('base64');
  }

  saveConverted(id, extension, base64) {
    const item = this.find(id);
    const name = `${path.parse(item.name).name}.${extension}`;
    const output = uniquePath(path.dirname(item.path), name);
    fs.writeFileSync(output, Buffer.from(base64, 'base64'));
    this.add([output]);
    return output;
  }
}

module.exports = { Shelf };

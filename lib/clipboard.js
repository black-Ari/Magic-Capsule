'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, clipboard, ClipboardItem, nativeImage } = require('electron');
const store = require('./store');

const MAX_ITEMS = 100;
const MAX_IMAGES = 30;
const MAX_TEXT_CHARS = 200000;
const THUMB_WIDTH = 160;
const PNG = 'image/png';

const clipsDir = () => path.join(app.getPath('userData'), 'clips');
const hash = (value) => crypto.createHash('sha1').update(value).digest('hex');

class ClipboardHistory {
  constructor({ onChange, onCopied, onError }) {
    this.onChange = onChange;
    this.onCopied = onCopied;
    this.onError = onError;
    this.ignoreNext = false; // our own write back to the clipboard must not be recorded again
    this.queue = Promise.resolve();
  }

  items() {
    return store.get('clipboard', []);
  }

  // Newest first. Pinned items are exempt from both limits.
  save(items) {
    const kept = [];
    let unpinned = 0;
    let images = 0;
    for (const item of items) {
      if (!item.pinned) unpinned += 1;
      if (!item.pinned && item.type === 'image') images += 1;
      if (item.pinned || (unpinned <= MAX_ITEMS && images <= MAX_IMAGES)) kept.push(item);
      else this.removeFile(item);
    }
    store.set('clipboard', kept);
    this.onChange(kept);
  }

  removeFile(item) {
    if (item.file) fs.rmSync(path.join(clipsDir(), item.file), { force: true });
  }

  add(entry) {
    const previous = this.items().find((item) => item.hash === entry.hash);
    const rest = this.items().filter((item) => item.hash !== entry.hash);
    this.save([{ ...entry, pinned: Boolean(previous && previous.pinned) }, ...rest]);
  }

  // Called when the Windows clipboard sequence number changes. Reads are async, so they queue up.
  check(info) {
    this.queue = this.queue.then(() => this.capture(info)).catch(this.onError);
  }

  async capture({ sensitive }) {
    if (this.ignoreNext) {
      this.ignoreNext = false;
      return;
    }
    if (sensitive) return;
    const [item] = await clipboard.read();
    if (!item) return;

    const entry = await this.readText(item) || await this.readImage(item);
    if (!entry) return;
    this.add(entry);
    this.onCopied(entry.type);
  }

  async readText(item) {
    if (!item.types.includes('text/plain')) return null;
    const text = await clipboard.readText();
    if (!text.trim() || text.length > MAX_TEXT_CHARS) return null;
    return { id: crypto.randomUUID(), type: 'text', text, hash: hash(text), at: Date.now() };
  }

  async readImage(item) {
    if (!item.types.includes(PNG)) return null;
    const blob = await item.getType(PNG);
    const png = Buffer.from(await blob.arrayBuffer());
    const digest = hash(png);
    const existing = this.items().find((other) => other.hash === digest);
    if (existing) return { ...existing, at: Date.now() };

    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) return null;
    const id = crypto.randomUUID();
    const file = `${id}.png`;
    fs.mkdirSync(clipsDir(), { recursive: true });
    fs.writeFileSync(path.join(clipsDir(), file), png);
    const { width, height } = image.getSize();
    return {
      id, type: 'image', file, hash: digest, at: Date.now(), w: width, h: height,
      thumb: image.resize({ width: Math.min(THUMB_WIDTH, width) }).toDataURL(),
    };
  }

  async copy(id) {
    const item = this.items().find((candidate) => candidate.id === id);
    if (!item) return;
    this.ignoreNext = true;
    if (item.type === 'text') {
      await clipboard.writeText(item.text);
    } else {
      const blob = new Blob([fs.readFileSync(this.imagePath(item))], { type: PNG });
      await clipboard.write([new ClipboardItem({ [PNG]: blob })]);
    }
    this.save([{ ...item, at: Date.now() }, ...this.items().filter((other) => other.id !== id)]);
  }

  imagePath(item) {
    return path.join(clipsDir(), item.file);
  }

  togglePin(id) {
    this.save(this.items().map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)));
  }

  remove(id) {
    const item = this.items().find((candidate) => candidate.id === id);
    if (!item) return;
    this.removeFile(item);
    this.save(this.items().filter((other) => other.id !== id));
  }

  clearAll() {
    fs.rmSync(clipsDir(), { recursive: true, force: true });
    store.clear('clipboard');
    this.onChange([]);
  }
}

module.exports = { ClipboardHistory };

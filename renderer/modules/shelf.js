import { call, fmtBytes, h, icon, iconButton, on, viewTitle } from '../core.js';
import { toast } from '../live.js';

const IMAGE = /\.(png|jpe?g|webp|bmp|gif|avif)$/i;
const ZIP = /\.zip$/i;
const FORMATS = [['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp']];
const CHUNK = 0x8000;

let items = [];
const selected = new Set();
let list;
let actions;
let message;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

async function convert(item, extension, mime) {
  const encoded = await call('shelf.read', item.id);
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (mime === 'image/jpeg') {
    context.fillStyle = '#fff'; // JPEG has no transparency
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 });
  return call('shelf.saveConverted', item.id, extension, toBase64(await blob.arrayBuffer()));
}

async function run(work, done) {
  message.textContent = '';
  try {
    await work();
    toast(done, 'shelf');
  } catch (err) {
    message.textContent = err.message.replace(/^Error invoking remote method 'call': (Error: )?/, '');
  }
}

function drawActions() {
  const chosen = items.filter((item) => selected.has(item.id) && !item.missing);
  const images = chosen.filter((item) => IMAGE.test(item.name));
  const ids = chosen.map((item) => item.id);
  actions.replaceChildren(
    h('button', {
      class: 'btn', type: 'button', disabled: !chosen.length,
      onClick: () => run(() => call('shelf.zip', ids), 'Zip created'),
    }, icon('zip', 15), 'Zip'),
    ...FORMATS.map(([extension, mime]) => h('button', {
      class: 'btn', type: 'button', disabled: !images.length,
      onClick: () => run(async () => { for (const item of images) await convert(item, extension, mime); }, `Saved as ${extension.toUpperCase()}`),
    }, `To ${extension.toUpperCase()}`)),
    h('button', {
      class: 'btn', type: 'button', disabled: !chosen.some((item) => ZIP.test(item.name)),
      onClick: () => run(() => call('shelf.unzip', ids), 'Extracted'),
    }, 'Extract'),
    h('button', {
      class: 'btn', type: 'button', disabled: !chosen.length,
      onClick: () => run(() => call('shelf.copyTo', ids), 'Copied'),
    }, 'Copy to'),
    h('button', {
      class: 'btn', type: 'button', disabled: !chosen.length,
      onClick: () => run(() => call('shelf.moveTo', ids), 'Moved'),
    }, 'Move to'),
    iconButton('recycle', 'Move to Recycle Bin', () => {
      if (chosen.length) run(() => call('shelf.trash', ids), 'Moved to Recycle Bin');
    }, 'btn icon-only'),
  );
}

function row(item) {
  return h('div', {
    class: 'list-row',
    draggable: !item.missing,
    title: item.path,
    onDragStart: (event) => {
      event.preventDefault();
      window.nook.dragOut('shelf', item.id);
    },
  },
  h('input', {
    type: 'checkbox', checked: selected.has(item.id), ariaLabel: `Select ${item.name}`,
    onChange: (event) => {
      if (event.target.checked) selected.add(item.id);
      else selected.delete(item.id);
      drawActions();
    },
  }),
  icon(item.isDir ? 'folder' : IMAGE.test(item.name) ? 'image' : 'note', 16),
  h('div', { class: 'grow' },
    h('div', { class: `truncate ${item.missing ? 'file-missing' : ''}` }, item.name),
    h('div', { class: 'faint' }, item.missing ? 'File moved or deleted' : item.isDir ? 'Folder' : fmtBytes(item.size))),
  h('span', { class: 'actions' },
    !item.missing && iconButton('open', 'Open', () => call('shelf.open', item.id)),
    !item.missing && iconButton('folder', 'Show in folder', () => call('shelf.reveal', item.id)),
    iconButton('x', 'Remove from shelf', () => { selected.delete(item.id); call('shelf.remove', item.id); })));
}

function draw() {
  if (!list) return;
  list.replaceChildren(...(items.length ? items.map(row) : [h('div', { class: 'empty' }, 'Files you park here stay in place on disk')]));
  drawActions();
}

export default {
  id: 'shelf',
  title: 'Shelf',
  icon: 'shelf',

  async init() {
    items = await call('shelf.list');
    on('shelf', (next) => { items = next; draw(); });
  },

  render(view) {
    list = h('div', { class: 'grow scroll' });
    actions = h('div', { class: 'row' });
    message = h('div', { class: 'error' });
    view.append(
      viewTitle('Shelf', h('button', { class: 'btn', type: 'button', onClick: () => call('shelf.pick') }, icon('plus', 15), 'Add files')),
      h('div', { class: 'dropzone' }, icon('shelf', 18), 'Drop files anywhere on Magic Capsule'),
      list, message, actions,
    );
    draw();
  },
};

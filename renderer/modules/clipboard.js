import { call, fmtTime, h, icon, iconButton, on, viewTitle } from '../core.js';
import { toast } from '../live.js';

let items = [];
let list;
let search;

function row(item) {
  const el = h('div', {
    class: 'list-row clip',
    title: 'Click to copy, or drag into another window',
    draggable: true,
    onClick: () => call('clipboard.copy', item.id),
    onDragStart: (event) => {
      if (item.type === 'image') {
        event.preventDefault();
        window.nook.dragOut('clip', item.id);
      } else {
        event.dataTransfer.setData('text/plain', item.text);
      }
    },
  },
  item.pinned && h('span', { class: 'pinned-mark' }, icon('pin', 14)),
  item.type === 'image'
    ? h('img', { class: 'clip-thumb', src: item.thumb, alt: 'Copied image' })
    : h('span', { class: 'clip-text' }, item.text),
  h('span', { class: 'faint' }, fmtTime(item.at)),
  h('span', { class: 'actions', onClick: (event) => event.stopPropagation() },
    iconButton('pin', item.pinned ? 'Unpin' : 'Pin', () => call('clipboard.pin', item.id)),
    iconButton('trash', 'Delete', () => call('clipboard.remove', item.id))));
  return el;
}

function draw() {
  if (!list) return;
  const query = search.value.trim().toLowerCase();
  const found = items.filter((item) => !query || (item.type === 'text' && item.text.toLowerCase().includes(query)));
  const ordered = [...found.filter((item) => item.pinned), ...found.filter((item) => !item.pinned)];
  list.replaceChildren(...(ordered.length ? ordered.map(row) : [
    h('div', { class: 'empty' }, query ? 'No match' : 'Copied text and images will appear here'),
  ]));
}

export default {
  id: 'clipboard',
  title: 'Clipboard',
  icon: 'clipboard',

  async init() {
    items = await call('clipboard.list');
    on('clipboard', (next) => { items = next; draw(); });
    on('copied', () => toast('Copied', 'copy', 1200));
  },

  render(view) {
    search = h('input', { type: 'search', class: 'grow', placeholder: 'Search clipboard', ariaLabel: 'Search clipboard', onInput: draw });
    list = h('div', { class: 'grow scroll' });
    view.append(
      viewTitle('Clipboard', iconButton('trash', 'Clear history', () => call('clipboard.clear'))),
      h('div', { class: 'row' }, search),
      list,
    );
    draw();
  },
};

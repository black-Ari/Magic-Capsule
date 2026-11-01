import { call, h, iconButton, listen, load, save, uid, viewTitle } from '../core.js';
import { toast } from '../live.js';

let links = [];
let grid;

const initial = (name) => [...name.trim()][0]?.toUpperCase() || '?';

function draw() {
  grid.replaceChildren(...links.map((link) => h('div', {
    class: 'link', title: link.target, role: 'button', tabIndex: 0,
    onClick: () => call('links.open', link.target).catch(() => toast('Could not open that link', 'alert')),
  },
  h('span', { class: 'link-mark' }, initial(link.name)),
  h('span', { class: 'truncate', style: 'max-width:100%' }, link.name),
  h('span', { class: 'remove', onClick: (event) => event.stopPropagation() }, iconButton('x', 'Remove link', () => {
    links = links.filter((other) => other.id !== link.id);
    save('links', links);
    draw();
  })))));
}

function addForm() {
  const name = h('input', { type: 'text', placeholder: 'Name', ariaLabel: 'Link name', style: 'width:160px' });
  const target = h('input', { type: 'text', class: 'grow', placeholder: 'https://... or C:\\path\\to\\file', ariaLabel: 'Link address' });
  const status = h('div', { class: 'error' });
  return h('form', {
    class: 'col',
    onSubmit: (event) => {
      event.preventDefault();
      const address = target.value.trim();
      status.textContent = '';
      if (!/^https?:\/\//i.test(address) && !/^[a-z]:[\\/]|^\\\\/i.test(address)) {
        status.textContent = 'Use a full https:// address or a full file path';
        return;
      }
      links.push({ id: uid(), name: name.value.trim() || address.replace(/^https?:\/\//i, ''), target: address });
      save('links', links);
      name.value = '';
      target.value = '';
      draw();
    },
  }, h('div', { class: 'row' }, name, target, h('button', { class: 'btn primary', type: 'submit' }, 'Add')), status);
}

export default {
  id: 'links',
  title: 'Links',
  icon: 'link',

  async init() {
    links = await load('links', []);
    listen('store:links', async () => {
      links = await load('links', []);
      if (grid) draw();
    });
  },

  render(view) {
    grid = h('div', { class: 'links grow scroll' });
    view.append(viewTitle('Links'), grid, addForm());
    draw();
  },
};

// The AI's memory and history screens. The memory list also appears in Settings > AI.
import { call, fmtDate, fmtTime, h, icon, iconButton, load, save, state, uid } from './core.js';

const CONFIRM_MS = 3000;
const SEARCH_DELAY_MS = 200;
const MAX_FACT = 300;
const LINE_ICONS = { say: 'spark', action: 'sliders', done: 'check' };

const when = (at) => `${fmtDate(at)}, ${fmtTime(at)}`;

export function memoryList() {
  const list = h('div', { class: 'col' });
  const draw = async () => {
    const facts = await load('memory', []);
    const remove = async (id) => { await save('memory', facts.filter((fact) => fact.id !== id)); draw(); };
    list.replaceChildren(...(facts.length
      ? facts.map((fact) => h('div', { class: 'setting' }, h('span', { class: 'grow selectable' }, fact.text), iconButton('trash', 'Forget this', () => remove(fact.id))))
      : [h('div', { class: 'faint' }, 'Nothing yet. Add something here, or tell the AI "remember that..." and it asks you first.')]));
  };
  const fact = h('input', {
    type: 'text', class: 'grow', maxLength: MAX_FACT, ariaLabel: 'Something to remember', placeholder: 'Something the AI should always know',
    onKeyDown: (event) => { if (event.key === 'Enter') add(); },
  });
  const add = async () => {
    const text = fact.value.trim();
    if (!text) return;
    await save('memory', [...await load('memory', []), { id: uid(), text, at: Date.now() }]);
    fact.value = '';
    draw();
  };
  draw();
  return h('div', { class: 'col' },
    h('div', { class: 'row' }, fact, h('button', { class: 'btn', type: 'button', onClick: add }, 'Remember')),
    list);
}

function taskDetail(item, back) {
  return h('div', { class: 'col grow' },
    h('div', { class: 'row' }, iconButton('left', 'Back to history', back), h('span', { class: 'grow truncate' }, item.title), h('span', { class: 'faint' }, when(item.at))),
    h('div', { class: 'agent-log scroll' }, item.lines.map((line) => h('div', { class: `agent-line ${line.type}` }, icon(LINE_ICONS[line.type] || 'sliders', 14), h('span', { class: 'selectable' }, line.text)))));
}

export function historyPane(openChat) {
  const list = h('div', { class: 'col grow scroll' });
  const page = h('div', { class: 'col grow' });
  const search = h('input', { type: 'search', class: 'grow', ariaLabel: 'Search history', placeholder: 'Search your chats and tasks' });
  const kind = h('select', { ariaLabel: 'Show' },
    h('option', { value: 'all' }, 'Everything'), h('option', { value: 'chat' }, 'Chats'), h('option', { value: 'task' }, 'Agent tasks'));
  const memory = h('div', { class: 'col grow scroll', hidden: true });
  const memoryButton = h('button', { class: 'btn', type: 'button' }, 'Memory');
  let timer = null;
  let armed = false;

  const row = (item) => h('div', {
    class: 'list-row history-row',
    style: 'cursor:pointer',
    onClick: async () => {
      const full = await call('history.get', item.id);
      if (full.kind === 'chat') openChat(full);
      else page.replaceChildren(taskDetail(full, showList));
    },
  },
  icon(item.kind === 'chat' ? 'spark' : item.failed ? 'alert' : 'sliders', 16),
  h('span', { class: 'grow truncate' }, item.title),
  h('span', { class: 'faint' }, when(item.at)),
  iconButton('trash', `Delete ${item.title}`, async (event) => {
    event.stopPropagation();
    await call('history.remove', item.id);
    refresh();
  }));

  async function refresh() {
    const items = await call('history.list', { query: search.value, kind: kind.value });
    list.replaceChildren(...(items.length
      ? items.map(row)
      : [h('div', { class: 'empty' }, search.value ? 'Nothing found' : 'Your chats and agent tasks appear here')]));
  }

  const clearAll = h('button', {
    class: 'btn', type: 'button',
    onClick: async () => {
      if (armed) {
        armed = false;
        clearAll.textContent = 'Clear all';
        await call('history.clear');
        refresh();
        return;
      }
      armed = true;
      clearAll.textContent = 'Sure? Click again';
      setTimeout(() => { armed = false; clearAll.textContent = 'Clear all'; }, CONFIRM_MS);
    },
  }, 'Clear all');

  function showList() {
    page.replaceChildren(h('div', { class: 'row' }, search, kind, memoryButton, clearAll), list, memory);
    refresh();
  }

  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, SEARCH_DELAY_MS);
  });
  kind.addEventListener('change', refresh);
  memoryButton.addEventListener('click', () => {
    memory.hidden = !memory.hidden;
    list.hidden = !memory.hidden;
    memoryButton.classList.toggle('primary', !memory.hidden);
    if (!memory.hidden) memory.replaceChildren(memoryList());
  });

  page.showList = () => {
    if (!state.settings) return;
    showList();
  };
  showList();
  return page;
}

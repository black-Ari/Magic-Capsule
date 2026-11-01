import { fmtDate, h, icon, iconButton, listen, load, save, uid, viewTitle } from '../core.js';

let notes = [];
let selectedId = null;
let list;
let editor;

const titleOf = (note) => note.text.split('\n').find((line) => line.trim())?.trim() || 'New note';
const current = () => notes.find((note) => note.id === selectedId);

function drawList() {
  list.replaceChildren(...notes.map((note) => h('div', {
    class: `note-item ${note.id === selectedId ? 'active' : ''}`,
    onClick: () => { selectedId = note.id; draw(); },
  },
  h('div', { class: 'truncate' }, titleOf(note)),
  h('div', { class: 'faint' }, fmtDate(note.at, { day: 'numeric', month: 'short' })))));
}

function draw() {
  drawList();
  const note = current();
  editor.disabled = !note;
  editor.value = note ? note.text : '';
  editor.placeholder = note ? 'Write here. The first line becomes the title.' : 'Create a note to start';
}

function create() {
  const note = { id: uid(), text: '', at: Date.now() };
  notes.unshift(note);
  selectedId = note.id;
  save('notes', notes);
  draw();
  editor.focus();
}

function removeCurrent() {
  notes = notes.filter((note) => note.id !== selectedId);
  selectedId = notes[0]?.id || null;
  save('notes', notes);
  draw();
}

export default {
  id: 'notes',
  title: 'Notes',
  icon: 'note',

  async init() {
    notes = await load('notes', []);
    selectedId = notes[0]?.id || null;
    listen('store:notes', async () => {
      notes = await load('notes', []);
      if (!list) return;
      if (document.activeElement === editor) drawList(); // never replace what you are typing
      else draw();
    });
  },

  render(view) {
    list = h('div', { class: 'scroll col' });
    editor = h('textarea', {
      class: 'note-editor',
      ariaLabel: 'Note text',
      onInput: () => {
        const note = current();
        if (!note) return;
        note.text = editor.value;
        note.at = Date.now();
        save('notes', notes);
        drawList();
      },
    });
    view.append(
      viewTitle('Notes',
        iconButton('trash', 'Delete note', removeCurrent),
        h('button', { class: 'btn primary', type: 'button', onClick: create }, icon('plus', 15), 'New')),
      h('div', { class: 'notes' }, list, editor),
    );
    draw();
  },
};

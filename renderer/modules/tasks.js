import { announce, emit, fmtDate, fmtTime, fmtUntil, h, iconButton, listen, load, save, startOfDay, state, uid, viewTitle } from '../core.js';
import { RANK, setActivity } from '../live.js';
import { nextOccurrence, parseTask } from '../smart-date.mjs';

const NEAR_MS = 30 * 60000;

let tasks = [];
let list;
let summary;

export const openTasks = () => tasks.filter((task) => !task.done)
  .sort((a, b) => (a.due || Infinity) - (b.due || Infinity));

function dueLabel(due) {
  const now = Date.now();
  if (due < now) return 'Overdue';
  return startOfDay(due) === startOfDay(now) ? fmtTime(due) : `${fmtDate(due, { day: 'numeric', month: 'short' })}, ${fmtTime(due)}`;
}

function check() {
  const now = Date.now();
  let dirty = false;
  for (const task of state.leader ? tasks : []) {
    if (task.due && !task.done && !task.notified && task.due <= now) {
      task.notified = true;
      dirty = true;
      announce(task.text, 'check', 8000);
    }
  }
  const { lateDone } = state.settings.tasks;
  for (const task of lateDone && state.leader ? tasks : []) {
    if (task.due && !task.done && now - task.due >= lateDone * 60000) {
      dirty = true;
      if (task.repeat) Object.assign(task, { due: nextOccurrence(task.repeat, task.repeat, now), notified: false });
      else task.done = true;
    }
  }
  if (dirty) changed();
  const next = openTasks().find((task) => task.due && task.due > now && task.due - now <= NEAR_MS);
  setActivity('task', next ? { rank: RANK.task, source: 'tasks', text: next.text, sub: fmtUntil(next.due, now) } : null);
}

function changed() {
  save('tasks', tasks);
  draw();
  emit('agenda');
}

function update(id, patch) {
  tasks = tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
  changed();
  check();
}

// Ticking a repeating task moves it to its next time instead of finishing it.
function complete(task, done) {
  if (done) emit('pet', 'taskDone');
  if (done && task.repeat) update(task.id, { due: nextOccurrence(task.repeat, task.repeat, Date.now()), notified: false });
  else update(task.id, { done });
}

function row(task) {
  const late = task.due && task.due < Date.now() && !task.done;
  return h('div', { class: `list-row ${task.done ? 'task-done' : ''}` },
    h('input', {
      type: 'checkbox', checked: task.done, ariaLabel: `Done: ${task.text}`,
      onChange: (event) => complete(task, event.target.checked),
    }),
    h('span', { class: 'task-text grow truncate selectable' }, task.text),
    task.repeat && h('span', { class: 'chip', title: 'Repeats' }, 'Repeats'),
    task.due && !task.done && h('span', { class: `chip ${late ? 'late' : ''}` }, dueLabel(task.due)),
    late && iconButton('bell', `Snooze ${state.settings.tasks.snooze} minutes`, () => update(task.id, { due: Date.now() + state.settings.tasks.snooze * 60000, notified: false })),
    h('span', { class: 'actions' }, iconButton('trash', 'Delete task', () => {
      tasks = tasks.filter((other) => other.id !== task.id);
      changed();
    })));
}

function draw() {
  if (!list) return;
  const sorted = [...openTasks(), ...tasks.filter((task) => task.done)];
  summary.textContent = `${openTasks().length} open`;
  list.replaceChildren(...(sorted.length ? sorted.map(row) : [
    h('div', { class: 'empty' }, 'Try: Call mom kal 7 baje, or: standup every mon 10am'),
  ]));
}

function addForm() {
  const text = h('input', { type: 'text', class: 'grow', placeholder: 'Add a task, e.g. Pay rent tomorrow 9am', ariaLabel: 'Task' });
  const due = h('input', { type: 'datetime-local', ariaLabel: 'Remind me at', title: 'Remind me at' });
  const hint = h('div', { class: 'faint' });
  text.addEventListener('input', () => {
    const parsed = parseTask(text.value);
    hint.textContent = text.value.trim() && parsed.due ? `Reminder: ${dueLabel(parsed.due)}${parsed.repeat ? ', repeating' : ''}` : '';
  });
  const add = (event) => {
    event.preventDefault();
    if (!text.value.trim()) return;
    const parsed = parseTask(text.value);
    const picked = due.value ? new Date(due.value).getTime() : null;
    tasks.unshift({
      id: uid(), text: parsed.text || text.value.trim(), due: picked ?? parsed.due, repeat: picked ? null : parsed.repeat, done: false, notified: false,
    });
    text.value = '';
    due.value = '';
    hint.textContent = '';
    changed();
    check();
  };
  return h('form', { class: 'col', onSubmit: add },
    h('div', { class: 'row' }, text, due, h('button', { class: 'btn primary', type: 'submit' }, 'Add')),
    hint);
}

export default {
  id: 'tasks',
  title: 'Tasks',
  icon: 'check',

  async init() {
    tasks = await load('tasks', []);
    listen('store:tasks', async () => {
      tasks = await load('tasks', []);
      draw();
      emit('agenda');
    });
    setInterval(check, 15000);
    check();
  },

  render(view) {
    summary = h('span', { class: 'faint' });
    list = h('div', { class: 'grow scroll' });
    view.append(viewTitle('Tasks', summary), addForm(), list);
    draw();
  },
};

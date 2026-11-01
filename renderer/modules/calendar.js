import { announce, call, emit, fmtDate, fmtTime, fmtUntil, h, icon, iconButton, listen, load, on, save, startOfDay, state, uid, viewTitle } from '../core.js';
import { RANK, setActivity, toast } from '../live.js';
import { parseTask } from '../smart-date.mjs';

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const PILL_WINDOW_MS = 15 * 60000;
const GRID_DAYS = 42;
const MAX_DOTS = 3;
const NOOK_SOURCE = 'Nook';
const COLOR_SLOTS = 6;
const DURATIONS = [[0.5, '30 minutes'], [1, '1 hour'], [2, '2 hours'], [0, 'All day']];

let remote = { events: [], errors: [] };
let local = [];
const reminded = new Set();
let selected = startOfDay(Date.now());
let shownMonth = firstOfMonth(Date.now());
let expanded = '';
let editing = '';
let ui = null;

function firstOfMonth(ms) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

const addDays = (ms, days) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
};

const addMonths = (ms, months) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth() + months, 1).getTime();
};

const toInputValue = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const sources = () => [NOOK_SOURCE, ...state.settings.calendars.map((calendar) => calendar.name)];

// Colour follows the calendar's place in Settings, never how many events it has.
const colorSlot = (source) => Math.max(0, sources().indexOf(source)) % COLOR_SLOTS;

export function allEvents() {
  const mine = local.map((event) => ({ ...event, source: NOOK_SOURCE, local: true }));
  return [...remote.events, ...mine].sort((a, b) => a.start - b.start);
}

export function upcoming(count) {
  const now = Date.now();
  return allEvents().filter((event) => event.end > now && !event.allDay).slice(0, count);
}

function checkReminders() {
  const now = Date.now();
  const next = upcoming(1)[0];
  for (const event of state.leader ? allEvents() : []) {
    if (event.allDay || reminded.has(event.id)) continue;
    if (event.start > now && event.start - now <= state.settings.calendarRemind * 60000) {
      reminded.add(event.id);
      announce(`${event.title} ${fmtUntil(event.start, now)}`, 'calendar', 6000);
    }
  }
  const soon = next && next.start > now && next.start - now <= PILL_WINDOW_MS;
  setActivity('event', soon ? { rank: RANK.event, source: 'calendar', text: next.title, sub: fmtUntil(next.start, now) } : null);
}

const eventsOn = (day) => {
  const end = addDays(day, 1);
  return allEvents().filter((event) => event.start < end && event.end > day);
};

const timeLabel = (event) => (event.allDay ? 'All day' : `${fmtTime(event.start)} – ${fmtTime(event.end)}`);

function daysWithEvents(first) {
  const days = new Map();
  const last = addDays(first, GRID_DAYS);
  for (const event of allEvents()) {
    if (event.start >= last || event.end <= first) continue;
    for (let day = startOfDay(Math.max(event.start, first)); day < Math.min(event.end, last); day = addDays(day, 1)) {
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(colorSlot(event.source));
    }
  }
  return days;
}

function selectDay(day) {
  selected = day;
  expanded = '';
  editing = '';
  shownMonth = firstOfMonth(day);
  draw();
}

function drawMonth() {
  const weekStart = state.settings.calendarWeekStart === 'monday' ? 1 : 0;
  const lead = (new Date(shownMonth).getDay() - weekStart + 7) % 7;
  const first = addDays(shownMonth, -lead);
  const today = startOfDay(Date.now());
  const busy = daysWithEvents(first);
  const month = new Date(shownMonth).getMonth();

  ui.monthName.textContent = fmtDate(shownMonth, { month: 'long', year: 'numeric' });
  ui.weekdays.replaceChildren(...Array.from({ length: 7 }, (_, index) => h('span', {}, fmtDate(addDays(first, index), { weekday: 'narrow' }))));
  ui.grid.replaceChildren(...Array.from({ length: GRID_DAYS }, (_, index) => {
    const day = addDays(first, index);
    const dots = busy.get(day) || [];
    const classes = ['cal-cell'];
    if (new Date(day).getMonth() !== month) classes.push('other');
    if (day === today) classes.push('today');
    if (day === selected) classes.push('selected');
    const label = fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' });
    return h('button', {
      class: classes.join(' '),
      type: 'button',
      title: dots.length ? `${label}, ${dots.length} event${dots.length === 1 ? '' : 's'}` : label,
      ariaLabel: label,
      onClick: () => selectDay(day),
    },
    h('span', { class: 'cal-number' }, new Date(day).getDate()),
    h('span', { class: 'cal-dots' }, [...new Set(dots)].slice(0, MAX_DOTS).map((slot) => h('i', { class: `cal-color-${slot}` }))));
  }));
}

function drawLegend() {
  const names = sources();
  ui.legend.hidden = names.length < 2;
  ui.legend.replaceChildren(...names.map((name) => h('span', { class: 'cal-legend-item' },
    h('i', { class: `cal-color-${colorSlot(name)}` }), h('span', { class: 'truncate' }, name))));
}

function changed() {
  save('events', local);
  draw();
  checkReminders();
  emit('agenda');
}

function removeEvent(id) {
  local = local.filter((event) => event.id !== id);
  expanded = '';
  changed();
}

function editForm(event) {
  const title = h('input', { type: 'text', class: 'grow', value: event.title, ariaLabel: 'Event title' });
  const start = h('input', { type: 'datetime-local', value: toInputValue(event.start), ariaLabel: 'Event start' });
  const length = h('select', { ariaLabel: 'Event length' }, DURATIONS.map(([hours, label]) => h('option', { value: hours }, label)));
  length.value = event.allDay ? 0 : (event.end - event.start) / HOUR_MS;
  if (length.selectedIndex < 0) length.value = 1;
  return h('form', {
    class: 'col',
    onSubmit: (submit) => {
      submit.preventDefault();
      const begins = new Date(start.value).getTime();
      if (!title.value.trim() || Number.isNaN(begins)) return;
      const hours = Number(length.value);
      local = local.map((other) => (other.id !== event.id ? other : {
        ...other,
        title: title.value.trim(),
        start: hours ? begins : startOfDay(begins),
        end: hours ? begins + hours * HOUR_MS : addDays(startOfDay(begins), 1),
        allDay: !hours,
      }));
      editing = '';
      selected = startOfDay(begins);
      shownMonth = firstOfMonth(begins);
      changed();
    },
  }, title, h('div', { class: 'row' }, start, length),
  h('div', { class: 'row' },
    h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
    h('button', { class: 'btn', type: 'button', onClick: () => { editing = ''; drawDay(); } }, 'Cancel')));
}

function eventDetails(event) {
  if (editing === event.id) return editForm(event);
  return h('div', { class: 'cal-details' },
    event.location && h('div', { class: 'selectable' }, event.location),
    h('div', { class: 'faint' }, event.source),
    h('div', { class: 'row' },
      event.join && h('button', { class: 'btn primary', type: 'button', onClick: () => call('links.open', event.join) }, 'Join'),
      event.join && h('button', {
        class: 'btn', type: 'button',
        onClick: async () => {
          await call('text.copy', event.join);
          toast('Meeting link copied', 'copy');
        },
      }, 'Copy link'),
      event.local && h('button', { class: 'btn', type: 'button', onClick: () => { editing = event.id; drawDay(); } }, 'Edit'),
      event.local && h('button', { class: 'btn', type: 'button', onClick: () => removeEvent(event.id) }, 'Delete')));
}

function eventRow(event) {
  const now = Date.now();
  const open = expanded === event.id;
  const running = !event.allDay && event.start <= now && event.end > now;
  return h('div', { class: `cal-event ${open ? 'open' : ''}` },
    h('button', {
      class: 'cal-event-head',
      type: 'button',
      ariaExpanded: open ? 'true' : 'false',
      onClick: () => { expanded = open ? '' : event.id; editing = ''; drawDay(); },
    },
    h('i', { class: `cal-bar cal-color-${colorSlot(event.source)}` }),
    h('span', { class: 'cal-event-text' },
      h('span', { class: 'cal-event-title truncate' }, event.title),
      h('span', { class: 'faint' }, timeLabel(event))),
    running && h('span', { class: 'chip' }, 'Now'),
    !running && event.join && icon('open', 14)),
    open && eventDetails(event));
}

function drawDay() {
  const events = eventsOn(selected);
  ui.dayName.textContent = fmtDate(selected, { weekday: 'long', day: 'numeric', month: 'long' });
  ui.dayCount.textContent = events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : '';
  ui.list.replaceChildren(...(events.length ? events.map(eventRow) : [h('div', { class: 'empty' }, 'Nothing planned')]));
  ui.status.textContent = (remote.errors || []).join(' · ');
}

function draw() {
  if (!ui) return;
  drawMonth();
  drawLegend();
  drawDay();
}

function addForm() {
  const title = h('input', { type: 'text', class: 'grow', placeholder: 'Add: Meeting tomorrow 5pm', ariaLabel: 'New event' });
  const hint = h('div', { class: 'faint cal-hint' });
  // Text without a date goes on the day you have selected.
  const understand = () => {
    const parsed = parseTask(title.value);
    if (parsed.due) return { text: parsed.text, start: parsed.due };
    const nextHour = Math.ceil(Date.now() / HOUR_MS) * HOUR_MS;
    return { text: title.value.trim(), start: selected === startOfDay(Date.now()) ? nextHour : selected + 9 * HOUR_MS };
  };
  title.addEventListener('input', () => {
    if (!title.value.trim()) { hint.textContent = ''; return; }
    const { start } = understand();
    hint.textContent = `${fmtDate(start)}, ${fmtTime(start)}`;
  });
  return h('form', {
    class: 'col',
    onSubmit: (event) => {
      event.preventDefault();
      if (!title.value.trim()) return;
      const { text, start } = understand();
      local.push({ id: uid(), title: text || title.value.trim(), start, end: start + HOUR_MS, allDay: false });
      title.value = '';
      hint.textContent = '';
      selected = startOfDay(start);
      shownMonth = firstOfMonth(start);
      changed();
    },
  }, h('div', { class: 'row' }, title, h('button', { class: 'btn primary', type: 'submit' }, 'Add')), hint);
}

export default {
  id: 'calendar',
  title: 'Calendar',
  icon: 'calendar',

  async init() {
    local = await load('events', []);
    remote = await call('calendar.get');
    listen('store:events', async () => {
      local = await load('events', []);
      draw();
      emit('agenda');
    });
    on('calendar', (next) => {
      remote = next;
      draw();
      checkReminders();
      emit('agenda');
    });
    listen('settings', draw);
    setInterval(checkReminders, 20000);
    checkReminders();
  },

  render(view) {
    ui = {
      monthName: h('span', { class: 'cal-month-name' }),
      weekdays: h('div', { class: 'cal-weekdays' }),
      grid: h('div', { class: 'cal-grid' }),
      legend: h('div', { class: 'cal-legend' }),
      dayName: h('div', { class: 'cal-day-name truncate' }),
      dayCount: h('span', { class: 'faint' }),
      list: h('div', { class: 'grow scroll cal-list' }),
      status: h('div', { class: 'error' }),
    };
    view.append(
      viewTitle('Calendar', iconButton('refresh', 'Refresh calendars', () => call('calendar.refresh'))),
      h('div', { class: 'cal-layout' },
        h('div', { class: 'card col cal-month' },
          h('div', { class: 'row' },
            ui.monthName,
            h('span', { class: 'grow' }),
            h('button', { class: 'btn cal-today', type: 'button', onClick: () => selectDay(startOfDay(Date.now())) }, 'Today'),
            iconButton('left', 'Previous month', () => { shownMonth = addMonths(shownMonth, -1); draw(); }),
            iconButton('right', 'Next month', () => { shownMonth = addMonths(shownMonth, 1); draw(); })),
          ui.weekdays, ui.grid, ui.legend),
        h('div', { class: 'col cal-day' },
          h('div', { class: 'row' }, ui.dayName, h('span', { class: 'grow' }), ui.dayCount),
          ui.list, ui.status, addForm())),
    );
    draw();
  },

  show: () => draw(),
};

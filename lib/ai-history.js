'use strict';

// Past chats and agent tasks. Only the words are kept, on this PC: no screenshots and no attached
// files. It holds a limited number, so it can never grow without end on a small disk.
const STORE = 'aiHistory';
const MAX_ITEMS = 150;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 20000;
const MAX_TASK_LINES = 300;
const MAX_LINE_CHARS = 2000;
const TITLE_CHARS = 70;
const SEARCH_RESULTS = 8;
const SNIPPET_CHARS = 200;

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const titleOf = (text) => oneLine(text).slice(0, TITLE_CHARS) || 'Untitled';

const cleanMessage = ({ role, content, failed, skills }) => ({
  role,
  content: String(content ?? '').slice(0, MAX_MESSAGE_CHARS),
  ...(failed ? { failed: true } : {}),
  ...(skills ? { skills } : {}),
});

const wordsOf = (item) => (item.kind === 'chat' ? item.messages.map((message) => message.content) : [item.title, ...item.lines.map((line) => line.text)]);

function snippet(text, wanted) {
  const flat = oneLine(text);
  const at = flat.toLowerCase().indexOf(wanted);
  const start = Math.max(0, at - SNIPPET_CHARS / 2);
  return flat.slice(start, start + SNIPPET_CHARS);
}

class AiHistory {
  constructor({ store, isOn }) {
    Object.assign(this, { store, isOn });
  }

  items() {
    return this.store.get(STORE, []);
  }

  put(item) {
    if (!this.isOn()) return;
    const others = this.items().filter((other) => other.id !== item.id);
    this.store.set(STORE, [item, ...others].slice(0, MAX_ITEMS));
  }

  // An empty chat is not worth a place in the list.
  saveChat({ id, messages }) {
    const kept = messages.filter((message) => message.content).slice(-MAX_MESSAGES).map(cleanMessage);
    const first = kept.find((message) => message.role === 'user');
    if (!first) return;
    this.put({ id, kind: 'chat', title: titleOf(first.content), at: Date.now(), messages: kept });
  }

  saveTask({ id, text, lines, failed }) {
    this.put({
      id,
      kind: 'task',
      title: titleOf(text),
      at: Date.now(),
      failed: Boolean(failed),
      lines: lines.slice(-MAX_TASK_LINES).map((line) => ({ type: line.type, text: String(line.text).slice(0, MAX_LINE_CHARS) })),
    });
  }

  list({ query = '', kind = 'all' } = {}) {
    const wanted = query.trim().toLowerCase();
    return this.items()
      .filter((item) => (kind === 'all' || item.kind === kind) && (!wanted || wordsOf(item).some((text) => text.toLowerCase().includes(wanted))))
      .map(({ id, kind: type, title, at, failed }) => ({ id, kind: type, title, at, failed: Boolean(failed) }));
  }

  get(id) {
    const item = this.items().find((candidate) => candidate.id === id);
    if (!item) throw new Error('That is no longer in your history');
    return item;
  }

  remove(id) {
    this.store.set(STORE, this.items().filter((item) => item.id !== id));
  }

  clear() {
    this.store.clear(STORE);
  }

  // For the agent, when the person asks about something from before.
  search(query) {
    const wanted = oneLine(query).toLowerCase();
    if (!wanted) throw new Error('Say what to look for');
    const lines = [];
    for (const item of this.items()) {
      const match = wordsOf(item).find((text) => text.toLowerCase().includes(wanted));
      if (match) lines.push(`${new Date(item.at).toISOString().slice(0, 10)} ${item.kind} "${item.title}": ${snippet(match, wanted)}`);
      if (lines.length >= SEARCH_RESULTS) break;
    }
    return lines.join('\n') || 'Nothing about that in the history.';
  }
}

module.exports = { AiHistory, STORE };

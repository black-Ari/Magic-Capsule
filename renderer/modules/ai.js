import { call, emit, fmtBytes, h, icon, iconButton, listen, load, on, save, saveSettings, state, uid, viewTitle } from '../core.js';
import { historyPane } from '../ai-history.js';
import { RANK, setActivity, toast } from '../live.js';
import { addMirror } from '../pet.js';
import { pullSkills, skillMenu } from '../skills.js';

const LANGUAGES = ['English', 'Hindi', 'Gujarati', 'Marathi', 'Bengali', 'Tamil', 'Telugu', 'Spanish', 'French', 'German', 'Japanese', 'Arabic'];

let chat = [];
let chatId = null;
let historyView;
let sessionAll = false;
let permission;
let turboChip;
let mode = 'chat';
let streamId = null;
let onDelta = null;
let onFinish = null;
let log;
let input;
let sendButton;
let chatView;
let translateView;
let segments;
let agentView;
let agentLog;
let agentAsk;
let chatFiles = [];
let chatFileRow;
let agentFiles = [];
let agentFileRow;
let agentRunning = false;
let agentControls;
let activeReply = null;
let chatTurn = null;
let pcReply = null;

const CONFIRM_MS = 3000;
const PROVIDER = { gemini: 'Gemini', claude: 'Claude', openai: 'API', ollama: 'Ollama' };
const providerName = () => {
  const { provider, apis } = state.settings.ai;
  return state.settings.pet.name || PROVIDER[provider] || apis.find((api) => `api:${api.id}` === provider)?.name || 'the AI';
};

function stream(request, delta, finish) {
  streamId = uid();
  onDelta = delta;
  onFinish = finish;
  emit('pet-ai', 'thinking');
  call('ai.start', { id: streamId, ...request });
  paintBusy();
}

function endStream(message) {
  emit('pet-ai', '');
  emit('pet', message ? 'aiFailed' : 'aiDone');
  const finish = onFinish;
  streamId = null;
  onDelta = null;
  onFinish = null;
  paintBusy();
  finish?.(message);
}

function paintBusy() {
  if (!sendButton) return;
  sendButton.replaceChildren(icon(streamId ? 'stop' : 'send', 15));
  sendButton.title = streamId ? 'Stop' : 'Send';
}

const scrollDown = () => { log.scrollTop = log.scrollHeight; };

function keepChat() {
  save('chat', chat);
  save('chatId', chatId);
  call('history.saveChat', { id: chatId, messages: chat });
}

const turboOn = () => state.settings.ai.turbo === true;

function paintPermission() {
  if (turboChip) turboChip.hidden = !turboOn();
  if (permission) {
    if (turboOn()) permission.value = 'turbo';
    else if (sessionAll) permission.value = 'session';
    else if (['turbo', 'session'].includes(permission.value)) permission.value = 'ask';
  }
  if (log && !chat.length && !streamId) drawChat();
}

async function setTurbo(on) {
  await saveSettings({ ai: { ...state.settings.ai, turbo: on } });
  paintPermission();
}

async function setSessionAll(all) {
  sessionAll = all;
  await call('agent.session', all);
  paintPermission();
}

// Asks twice, because Turbo takes away every question that follows.
function turboButton(label, classes) {
  let armed = false;
  const button = h('button', {
    class: classes,
    type: 'button',
    onClick: async () => {
      if (turboOn()) { await setTurbo(false); return; }
      if (!armed) {
        armed = true;
        button.textContent = 'Sure? It will never ask';
        setTimeout(() => { armed = false; button.textContent = label; }, CONFIRM_MS);
        return;
      }
      await setTurbo(true);
    },
  }, label);
  return button;
}

function startChoices() {
  const pick = (label, active, run) => h('button', { class: `btn ${active ? 'primary' : ''}`, type: 'button', onClick: run }, label);
  const turbo = turboOn();
  const all = sessionAll && !turbo;
  return h('div', { class: 'col permission-start' },
    h('div', { class: 'label' }, 'When the AI works on your PC'),
    h('div', { class: 'row' },
      pick('Ask me each time', !all && !turbo, async () => { await setTurbo(false); await setSessionAll(false); }),
      pick('Allow for this session', all, async () => { await setTurbo(false); await setSessionAll(true); }),
      turboButton('Turbo', `btn ${turbo ? 'primary' : ''}`)),
    h('div', { class: 'faint' }, 'This session lasts until you press New chat or close Magic Capsule. Turbo stays on until you turn it off, and runs commands, changes files and deletes without asking, so use it only with an AI and sites you trust.'));
}

function newChat() {
  chat = [];
  chatId = uid();
  sessionAll = false;
  call('agent.session', false);
  paintPermission();
  save('chat', chat);
  save('chatId', chatId);
  drawChat();
}

function reopenChat(item) {
  chat = item.messages.map((message) => ({ ...message }));
  chatId = item.id;
  save('chat', chat);
  save('chatId', chatId);
  setMode('chat');
  drawChat();
  input.focus();
}

function bubble(message) {
  return h('div', { class: `bubble ${message.role} ${message.failed ? 'failed' : ''}` }, message.content);
}

const skillLine = (names) => h('div', { class: 'skill-used' }, icon('spark', 12), `Using ${names.join(', ')}`);

function drawChat() {
  if (!log) return;
  log.replaceChildren(...(chat.length
    ? chat.flatMap((message) => (message.skills ? [skillLine(message.skills), bubble(message)] : [bubble(message)]))
    : [h('div', { class: 'empty' }, h('div', { class: 'col' }, `Ask ${providerName()} anything`, startChoices()))]));
  scrollDown();
}

function fileChips(files, row, remove) {
  row.replaceChildren(...files.map((file) => h('span', { class: 'file-chip', title: file.path },
    h('span', { class: 'truncate' }, file.name), h('span', { class: 'faint' }, fmtBytes(file.size)),
    iconButton('x', `Remove ${file.name}`, () => remove(file), 'file-chip-x'))));
  row.hidden = !files.length;
}

function drawChatFiles() {
  fileChips(chatFiles, chatFileRow, (file) => { chatFiles = chatFiles.filter((other) => other !== file); drawChatFiles(); });
}

function drawAgentFiles() {
  fileChips(agentFiles, agentFileRow, (file) => { agentFiles = agentFiles.filter((other) => other !== file); drawAgentFiles(); });
}

// The box grows with the message up to a limit in the styles, then scrolls.
function fitInput() {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight + 2}px`;
}

async function send() {
  if (streamId) { call('ai.stop', streamId); return; }
  const { text, names: skillNames } = await pullSkills(input.value);
  if (!text && !chatFiles.length) return;
  input.value = '';
  fitInput();
  const names = chatFiles.map((file) => file.name);
  chat.push({
    role: 'user',
    content: names.length ? `${text}${text ? '\n' : ''}[${names.join(', ')}]` : text,
    attachmentIds: chatFiles.map((file) => file.id),
  });
  chatFiles = [];
  drawChatFiles();
  const history = chat.filter((message) => !message.failed).map(({ role, content, attachmentIds }) => ({ role, content, attachmentIds }));
  const reply = { role: 'assistant', content: '' };
  chat.push(reply);
  activeReply = reply;
  chatTurn = { attachmentIds: history[history.length - 1].attachmentIds, skillNames };
  drawChat();
  const live = log.lastElementChild;
  stream({ mode: 'chat', messages: history, skillNames }, (delta) => {
    reply.content += delta;
    live.textContent = reply.content;
    scrollDown();
  }, (error) => {
    if (error) { reply.content = error; reply.failed = true; }
    if (!reply.content) chat.pop();
    drawChat();
    keepChat();
  });
}

function chatPane() {
  log = h('div', { class: 'chat scroll' });
  input = h('textarea', {
    rows: 1, class: 'grow chat-input', placeholder: 'Message', ariaLabel: 'Message',
    onInput: fitInput,
    onKeyDown: (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return; // Shift+Enter makes a new line
      event.preventDefault();
      send();
    },
  });
  sendButton = h('button', { class: 'btn primary icon-only', type: 'button', title: 'Send', onClick: send }, icon('send', 15));
  chatFileRow = h('div', { class: 'file-row', hidden: true });
  const attach = iconButton('plus', 'Add files', async () => {
    chatFiles = [...chatFiles, ...await call('ai.pickFiles')];
    drawChatFiles();
  }, 'btn icon-only');
  const skills = skillMenu(input, () => emit('open-tab', 'settings'));
  return h('div', { class: 'col grow skill-host' }, log, chatFileRow, skills.menu, h('div', { class: 'row chat-row' }, attach, skills.button, input, sendButton));
}

function logLine(type, text, failed) {
  const glyph = { say: 'spark', action: 'sliders', done: failed ? 'alert' : 'check' }[type];
  agentLog.append(h('div', { class: `agent-line ${type} ${failed ? 'failed' : ''}` }, icon(glyph, 14), h('span', {}, text)));
  agentLog.scrollTop = agentLog.scrollHeight;
}

function answerAgent(reply) {
  agentAsk.replaceChildren();
  agentAsk.hidden = true;
  call('agent.answer', reply);
}

function showPermission({ text, once }) {
  agentAsk.hidden = false;
  agentAsk.replaceChildren(
    h('div', { class: 'label' }, 'The AI wants to'),
    h('div', { class: 'agent-action selectable' }, text),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onClick: () => answerAgent({ decision: 'once' }) }, 'Allow once'),
      !once && h('button', { class: 'btn', type: 'button', onClick: () => answerAgent({ decision: 'task' }) }, 'Allow for this task'),
      h('button', { class: 'btn', type: 'button', onClick: () => answerAgent({ decision: 'session' }) }, 'Allow for this session'),
      h('button', { class: 'btn', type: 'button', onClick: () => answerAgent({ decision: 'stop' }) }, 'Stop')),
  );
}

function showQuestion({ text }) {
  const reply = h('input', { type: 'text', class: 'grow', ariaLabel: 'Your answer', placeholder: 'Your answer' });
  agentAsk.hidden = false;
  agentAsk.replaceChildren(
    h('div', { class: 'label' }, 'The AI asks'),
    h('div', { class: 'agent-action selectable' }, text),
    h('form', {
      class: 'row',
      onSubmit: (event) => { event.preventDefault(); answerAgent({ text: reply.value.trim() }); },
    }, reply, h('button', { class: 'btn primary', type: 'submit' }, 'Answer')),
  );
  reply.focus();
}

// Turbo is chosen in a list here, so its second question appears where all the others do.
function askTurbo() {
  const close = () => { agentAsk.hidden = true; agentAsk.replaceChildren(); };
  agentAsk.hidden = false;
  agentAsk.replaceChildren(
    h('div', { class: 'label' }, 'Turn on Turbo?'),
    h('div', { class: 'agent-action' }, 'The AI will run commands, change files and delete without asking, until you turn Turbo off. Text on a website or in a file could mislead it.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onClick: async () => { close(); await setTurbo(true); } }, 'Turn on Turbo'),
      h('button', { class: 'btn', type: 'button', onClick: close }, 'Cancel')),
  );
}

function agentPane() {
  const task = h('textarea', { rows: 2, ariaLabel: 'Task for the AI', placeholder: 'Tell the AI what to do, for example: open Notepad and write a shopping list' });
  const mode = h('select', {
    ariaLabel: 'Permission',
    onChange: async () => {
      const { value } = mode;
      if (value === 'turbo' && !turboOn()) {
        mode.value = 'ask';
        askTurbo();
        return;
      }
      if (value !== 'turbo' && turboOn()) await setTurbo(false);
      await setSessionAll(value === 'session');
      mode.value = value;
    },
  },
  h('option', { value: 'ask' }, 'Ask before every action'),
  h('option', { value: 'task' }, 'Allow actions for this task'),
  h('option', { value: 'session' }, 'Allow everything this session'),
  h('option', { value: 'turbo' }, 'Turbo: never ask'));
  permission = mode;
  agentLog = h('div', { class: 'agent-log scroll' });
  agentAsk = h('div', { class: 'card col agent-ask', hidden: true });
  agentFileRow = h('div', { class: 'file-row', hidden: true });
  const agentSkills = skillMenu(task, () => emit('open-tab', 'settings'));
  const start = async () => {
    const { text, names: skillNames } = await pullSkills(task.value);
    if (!text || agentRunning) return;
    agentLog.replaceChildren();
    await call('agent.start', { id: uid(), text, attachmentIds: agentFiles.map((file) => file.id), mode: mode.value === 'task' ? 'task' : 'ask', skillNames });
    agentFiles = [];
    drawAgentFiles();
  };
  agentControls = h('div', { class: 'row' },
    iconButton('plus', 'Add files', async () => {
      agentFiles = [...agentFiles, ...await call('ai.pickFiles')];
      drawAgentFiles();
    }, 'btn icon-only'),
    mode,
    agentSkills.button,
    h('span', { class: 'grow' }),
    h('button', { class: 'btn primary agent-go', type: 'button', onClick: () => (agentRunning ? call('agent.stop') : start()) }, 'Start'));
  return h('div', { class: 'col grow skill-host' },
    task, agentSkills.menu, agentFileRow, agentControls,
    h('div', { class: 'faint' }, 'While it works, what it sees goes to your AI provider. Moving your mouse during a click or pressing Ctrl+Alt+Q stops it at once. Commands, file changes and deletes ask first, unless you allow them for the session or use Turbo.'),
    agentAsk, agentLog);
}

function translatePane() {
  const source = h('textarea', { placeholder: 'Type or paste text, then press Ctrl+Enter', ariaLabel: 'Text to translate' });
  const output = h('div', { class: 'card translate-out' });
  const language = h('input', { type: 'text', list: 'languages', value: 'English', ariaLabel: 'Translate to', style: 'width:150px' });
  const list = h('datalist', { id: 'languages' }, LANGUAGES.map((name) => h('option', { value: name })));
  const run = () => {
    const text = source.value.trim();
    if (!text || streamId) return;
    output.textContent = '';
    output.classList.remove('error');
    stream({ mode: 'translate', language: language.value.trim() || 'English', messages: [{ role: 'user', content: text }] },
      (delta) => { output.textContent += delta; },
      (error) => {
        if (!error) return;
        output.textContent = error;
        output.classList.add('error');
      });
  };
  source.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); run(); }
  });
  return h('div', { class: 'col grow' },
    h('div', { class: 'row' }, h('span', { class: 'label' }, 'To'), language, list,
      h('button', { class: 'btn primary', type: 'button', onClick: run }, 'Translate')),
    h('div', { class: 'translate' }, source, output));
}

// The chat cannot touch the PC, so a job like "open Excel" goes to the agent. It always asks first
// here, whatever the Agent tab is set to: the task was written by the AI, not typed into that box.
async function handOff(task) {
  pcReply = activeReply;
  pcReply.content = `PC task: ${task}`;
  setMode('agent');
  agentLog.replaceChildren();
  try {
    await call('agent.start', { id: uid(), text: task, ...chatTurn, mode: 'ask', fromChat: true });
  } catch (err) {
    pcReply.content = err.message;
    pcReply.failed = true;
    pcReply = null;
    setMode('chat');
    drawChat();
    keepChat();
  }
}

function setMode(next) {
  mode = next;
  chatView.style.display = next === 'chat' ? '' : 'none';
  translateView.style.display = next === 'translate' ? '' : 'none';
  agentView.style.display = next === 'agent' ? '' : 'none';
  historyView.style.display = next === 'history' ? '' : 'none';
  if (next === 'history') historyView.showList();
  for (const button of segments.children) button.classList.toggle('active', button.dataset.mode === next);
}

export default {
  id: 'ai',
  title: 'AI',
  icon: 'spark',

  async init() {
    chat = await load('chat', []);
    chatId = await load('chatId', null) || uid();
    listen('settings', paintPermission);
    listen('store:chat', async () => {
      chat = await load('chat', []);
      chatId = await load('chatId', null) || chatId;
      if (!streamId) drawChat();
    });
    on('ai:delta', ({ id, text }) => {
      if (id !== streamId) return;
      emit('pet-ai', 'chat');
      onDelta(text);
    });
    on('ai:done', ({ id }) => { if (id === streamId) endStream(); });
    on('ai:error', ({ id, message }) => { if (id === streamId) endStream(message); });
    on('ai:skills', ({ id, names }) => {
      if (id !== streamId || !activeReply || mode !== 'chat') return;
      activeReply.skills = names;
      log.insertBefore(skillLine(names), log.lastElementChild);
    });
    on('ai:handoff', ({ id, task }) => { if (id === streamId) handOff(task); });
    on('agent:update', ({ type, text, failed, finished }) => {
      if (agentLog) logLine(type, text, failed);
      if (pcReply && (type === 'say' || (type === 'done' && !finished))) pcReply.content = text;
      if (pcReply && type === 'done') {
        pcReply.failed = Boolean(failed);
        pcReply = null;
        setMode('chat');
        drawChat();
        keepChat();
      }
      if (type === 'done') emit('pet', failed ? 'aiFailed' : 'aiDone');
      if (type === 'done') toast(failed ? 'The AI could not finish' : 'AI task ended', failed ? 'alert' : 'spark', 4000);
    });
    on('agent:ask', (request) => {
      emit('pet', 'aiAsks');
      setMode('agent');
      if (request.kind === 'question') showQuestion(request);
      else showPermission(request);
    });
    on('agent:asked', () => { if (agentAsk) { agentAsk.hidden = true; agentAsk.replaceChildren(); } });
    on('agent:state', ({ running, stopKey }) => {
      agentRunning = running;
      emit('pet-ai', running ? 'working' : '');
      if (agentControls) agentControls.querySelector('.agent-go').textContent = running ? 'Stop' : 'Start';
      setActivity('agent', running ? { rank: RANK.agent, left: icon('spark', 16), text: 'AI is working', sub: `${stopKey} stops it` } : null);
    });
    listen('ai-files', async (paths) => {
      const added = await call('ai.addFiles', paths);
      if (mode === 'agent') { agentFiles = [...agentFiles, ...added]; drawAgentFiles(); } else { chatFiles = [...chatFiles, ...added]; drawChatFiles(); }
    });
  },

  render(view) {
    const LABELS = { chat: 'Chat', translate: 'Translate', agent: 'Agent', history: 'History' };
    segments = h('div', { class: 'segmented' }, Object.keys(LABELS).map((name) => {
      const button = h('button', { type: 'button', onClick: () => setMode(name) }, LABELS[name]);
      button.dataset.mode = name;
      return button;
    }));
    chatView = chatPane();
    translateView = translatePane();
    agentView = agentPane();
    historyView = historyPane(reopenChat);
    const buddy = h('div', { class: 'pet pet-chat' });
    turboChip = h('button', { class: 'chip turbo-chip', type: 'button', title: 'Turn off Turbo', hidden: true, onClick: () => setTurbo(false) }, 'Turbo on');
    view.append(
      viewTitle('AI',
        turboChip,
        buddy,
        iconButton('gear', 'AI settings', () => emit('open-tab', 'settings')),
        iconButton('plus', 'New chat', newChat),
        segments),
      chatView, translateView, agentView, historyView,
    );
    addMirror(buddy);
    setMode('chat');
    drawChat();
    paintPermission();
  },

  openChat() {
    setMode('chat');
    drawChat();
    input.focus();
  },

  show() {
    if (mode === 'chat') drawChat();
  },
};

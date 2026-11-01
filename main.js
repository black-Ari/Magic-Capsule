'use strict';

const {
  app, dialog, ipcMain, Tray, Menu, globalShortcut, screen, shell, clipboard, nativeImage, powerSaveBlocker,
} = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.env.NOOK_USER_DATA) app.setPath('userData', process.env.NOOK_USER_DATA);

const {
  CLAUDE_MODELS, CLEARABLE, LAYOUT_SETTINGS, MODULE_IDS, NESTED_SETTINGS, RENDERER_STORES, SETTINGS,
} = require('./lib/defaults');
const store = require('./lib/store');
const { NotchFleet } = require('./lib/notch-fleet');
const { Helper } = require('./lib/helper');
const { ClipboardHistory } = require('./lib/clipboard');
const { Shelf } = require('./lib/shelf');
const { PhoneDrop } = require('./lib/drop');
const { AiRunner } = require('./lib/ai');
const { Agent } = require('./lib/agent');
const { createTurns } = require('./lib/agent-models');
const { ComputerTools } = require('./lib/agent-tools');
const { Browser } = require('./lib/agent-browser');
const { AiHistory } = require('./lib/ai-history');
const { capsKey } = require('./lib/ai-profiles');
const { listModels, testApi } = require('./lib/api-test');
const { McpTools, testServer } = require('./lib/mcp');
const { PcControl } = require('./lib/pc-control');
const { PhoneRemote } = require('./lib/phone-remote');
const attachments = require('./lib/attachments');
const { ScreenTime } = require('./lib/screentime');
const backup = require('./lib/backup');
const { skillMode } = require('./lib/skills');
const { SKILL_LIBRARY } = require('./lib/skill-library');
const calendar = require('./lib/calendar');
const online = require('./lib/online');
const wifi = require('./lib/wifi');

const ICON = path.join(__dirname, 'assets', 'icon.png');
const CALENDAR_REFRESH_MS = 15 * 60000;
const VOLUME_STEP = 2;
const AGENT_STOP_KEY = 'Ctrl+Alt+Q';
const AGENT_LOOK_DELAY_MS = 500;
const MAX_MEMORY_FACTS = 100;
const PET_IDLE_STEP_S = 15; // the pet hears about idle time in steps, not every second
const NEW_SKILLS = ['GST filing', 'ITR filing'];

let fleet;
let tray;
let helper;
let history;
let shelf;
let drop;
let ai;
let agent;
let browser;
let aiHistory;
let pc;
let phoneRemote;
let lastForPet = '';
let screenTime;
let settingsCache;
let calendarState = { events: [], errors: [], at: 0 };
let previousCpu = os.cpus();
let shortcutError = '';
let awakeBlocker = null;

const send = (channel, payload) => fleet && fleet.send(channel, payload);
const toast = (text, icon) => send('toast', { text, icon });
// The notch on the screen that made the current request, or the main one.
const here = () => fleet.current || fleet.leader();
const toggleNotch = () => fleet.underCursor().toggle();
const toggleSnooze = () => fleet.each((notch) => notch.toggleSnooze());

function mergeSettings(saved) {
  const merged = { ...SETTINGS, ...saved };
  for (const key of NESTED_SETTINGS) merged[key] = { ...SETTINGS[key], ...saved[key] };
  merged.ai = {
    ...SETTINGS.ai,
    ...saved.ai,
    models: { ...SETTINGS.ai.models, ...(saved.ai || {}).models },
  };
  const savedModules = (saved.modules || []).filter((item) => MODULE_IDS.includes(item.id));
  const seen = new Set(savedModules.map((item) => item.id));
  merged.modules = [...savedModules, ...SETTINGS.modules.filter((item) => !seen.has(item.id))];
  return merged;
}

function settings() {
  settingsCache ||= mergeSettings(store.get('settings', {}));
  return settingsCache;
}

function logError(err) {
  const line = `${new Date().toISOString()} ${err && err.stack ? err.stack : err}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'nook.log'), line); } catch {}
}

function registerShortcut(accelerator, action) {
  try {
    if (globalShortcut.register(accelerator, action)) return '';
    return `${accelerator} is already used by another app`;
  } catch {
    return `"${accelerator}" is not a valid shortcut`;
  }
}

// The old shortcut only goes once the new one works, so a key is never lost. Empty turns it off.
function changeShortcut(next, key, action) {
  const previous = settings()[key];
  if (next[key] === previous) return '';
  const error = next[key] ? registerShortcut(next[key], action) : '';
  if (error) next[key] = previous;
  else if (previous) globalShortcut.unregister(previous);
  return error;
}

function applyKeepAwake() {
  if (settings().keepAwake && awakeBlocker === null) {
    awakeBlocker = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!settings().keepAwake && awakeBlocker !== null) {
    powerSaveBlocker.stop(awakeBlocker);
    awakeBlocker = null;
  }
}

function registerVolumeKeys() {
  const keys = {
    VolumeUp: () => helper.call('volume.step', { delta: VOLUME_STEP }),
    VolumeDown: () => helper.call('volume.step', { delta: -VOLUME_STEP }),
    VolumeMute: () => helper.call('volume.mute'),
  };
  for (const [key, action] of Object.entries(keys)) {
    if (settings().volumeHud) globalShortcut.register(key, () => action().catch(() => {}));
    else globalShortcut.unregister(key);
  }
}

function applyStartup() {
  app.setLoginItemSettings({
    openAtLogin: settings().startWithWindows,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  });
}

function updateSettings(patch) {
  const previous = settings();
  const next = mergeSettings({ ...previous, ...patch });
  shortcutError = changeShortcut(next, 'shortcut', toggleNotch)
    || changeShortcut(next, 'snoozeShortcut', toggleSnooze);
  store.set('settings', next);
  settingsCache = next;
  if (next.volumeHud !== previous.volumeHud) registerVolumeKeys();
  if (next.keepAwake !== previous.keepAwake) applyKeepAwake();
  if (LAYOUT_SETTINGS.some((key) => next[key] !== previous[key])) fleet.sync();
  fleet.sendExcept(fleet.current, 'settings:changed', next);
  if (next.startWithWindows !== previous.startWithWindows) applyStartup();
  if (JSON.stringify(next.calendars) !== JSON.stringify(previous.calendars)) refreshCalendar();
  return { settings: next, shortcutError };
}

async function refreshCalendar() {
  calendarState = await calendar.fetchCalendars(settings().calendars);
  send('calendar', calendarState);
  return calendarState;
}

function cpuPercent() {
  const current = os.cpus();
  let idle = 0;
  let total = 0;
  current.forEach((cpu, index) => {
    const before = previousCpu[index].times;
    const after = cpu.times;
    idle += after.idle - before.idle;
    total += Object.keys(after).reduce((sum, key) => sum + after[key] - before[key], 0);
  });
  previousCpu = current;
  return total ? Math.round((1 - idle / total) * 100) : 0;
}

async function systemStats() {
  const disk = fs.statfsSync(path.parse(os.homedir()).root);
  return {
    cpu: cpuPercent(),
    cpuName: os.cpus()[0].model.trim(),
    cores: os.cpus().length,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    diskTotal: disk.blocks * disk.bsize,
    diskFree: disk.bavail * disk.bsize,
    uptime: os.uptime(),
    net: await helper.call('net.totals'),
    at: Date.now(),
  };
}

function assertRendererStore(ns) {
  if (!RENDERER_STORES.includes(ns)) throw new Error(`Store not allowed: ${ns}`);
}

function openLink(target) {
  if (/^https?:\/\//i.test(target)) return shell.openExternal(target);
  if (/^[a-z]:[\\/]|^\\\\/i.test(target)) return shell.openPath(target);
  throw new Error('Links must start with http(s):// or be a full file path');
}

function clearData(ns) {
  if (!Object.hasOwn(CLEARABLE, ns)) throw new Error(`Unknown data: ${ns}`);
  if (ns === 'clipboard') history.clearAll();
  else store.clear(ns);
  if (ns === 'shelf') shelf.onChange([]);
  fleet.each(restartRenderer);
}

const BACKUP_FILTER = [{ name: 'Nook backup', extensions: ['nook'] }];
const MAX_SKILL_BYTES = 256 * 1024;

async function pickFolder(title) {
  const { canceled, filePaths } = await withDialog((win) => dialog.showOpenDialog(win, {
    title, properties: ['openDirectory', 'createDirectory'],
  }));
  return canceled ? null : filePaths[0];
}

async function shelfToFolder(ids, action, title) {
  const folder = await pickFolder(title);
  if (!folder) return false;
  shelf[action](ids, folder);
  return true;
}

async function addFilesToShelf() {
  const { canceled, filePaths } = await withDialog((win) => dialog.showOpenDialog(win, {
    title: 'Add to Shelf', properties: ['openFile', 'multiSelections'],
  }));
  if (!canceled) shelf.add(filePaths);
}

// The dialog takes focus, which would otherwise close the notch underneath it.
async function withDialog(show) {
  const notch = here();
  const wasPinned = notch.pinned;
  notch.setPinned(true);
  try {
    return await show(notch.win);
  } finally {
    notch.setPinned(wasPinned);
  }
}

async function exportBackup() {
  const { canceled, filePath } = await withDialog((win) => dialog.showSaveDialog(win, {
    title: 'Save Nook backup',
    defaultPath: path.join(app.getPath('documents'), `Nook backup ${new Date().toISOString().slice(0, 10)}.nook`),
    filters: BACKUP_FILTER,
  }));
  if (canceled || !filePath) return false;
  backup.write(filePath);
  return true;
}

async function importBackup() {
  const { canceled, filePaths } = await withDialog((win) => dialog.showOpenDialog(win, {
    title: 'Restore Nook backup', filters: BACKUP_FILTER, properties: ['openFile'],
  }));
  if (canceled || !filePaths.length) return false;
  backup.read(filePaths[0]);
  settingsCache = null;
  store.flush();
  app.relaunch();
  app.quit();
  return true;
}

// A reloaded renderer always boots closed, so the window state has to match it.
async function pickFilesForAi() {
  const { canceled, filePaths } = await withDialog((win) => dialog.showOpenDialog(win, {
    title: 'Give files to the AI', properties: ['openFile', 'multiSelections'],
  }));
  return canceled ? [] : attachments.add(filePaths);
}

async function importSkill() {
  const { canceled, filePaths } = await withDialog((win) => dialog.showOpenDialog(win, {
    title: 'Add a skill', filters: [{ name: 'Skill text', extensions: ['md', 'txt'] }], properties: ['openFile'],
  }));
  if (canceled || !filePaths.length) return null;
  if (fs.statSync(filePaths[0]).size > MAX_SKILL_BYTES) throw new Error('That skill file is too large');
  return { name: path.parse(filePaths[0]).name, text: fs.readFileSync(filePaths[0], 'utf8') };
}

function ownWindows() {
  const handles = [];
  fleet.each((notch) => handles.push(notch.win.getNativeWindowHandle().readBigInt64LE().toString()));
  return handles;
}

function saveFact(text) {
  const facts = [...store.get('memory', []), { id: crypto.randomUUID(), text, at: Date.now() }];
  store.set('memory', facts.slice(-MAX_MEMORY_FACTS));
  send('store:changed', 'memory');
}

// The answer is kept per model, and given back so the page does not overwrite it with its older copy.
async function testActiveApi() {
  const { ai: current } = settings();
  const found = await testApi(current);
  const { provider, apis } = current;
  const custom = apis.find((api) => `api:${api.id}` === provider);
  const key = capsKey(provider, (custom ? custom.model : current.models[provider]).trim());
  const { settings: saved } = updateSettings({ ai: { ...settings().ai, caps: { ...settings().ai.caps, [key]: found } } });
  return { ...found, settings: saved };
}

const mcpServer = (id) => {
  const server = settings().ai.mcpServers.find((item) => item.id === id);
  if (!server) throw new Error('That server is gone');
  return server;
};

function setupAgent() {
  browser = new Browser({ dataDir: app.getPath('userData') });
  agent = new Agent({
    createTurns: (system, tools, options) => createTurns(settings().ai, system, tools, options),
    tools: new ComputerTools({ helper, browser, ownWindows, home: os.homedir(), pc, history: aiHistory }),
    onFinished: (task) => aiHistory.saveTask(task),
    mcp: new McpTools({
      getServers: () => settings().ai.mcpServers,
      getSecret: (id) => store.secrets.get(`mcp.${id}`),
    }),
    send,
    getSkills: () => store.get('skills', []),
    getMemory: () => store.get('memory', []),
    getMaxSteps: () => settings().ai.maxSteps,
    getName: () => settings().pet.name,
    getTurbo: () => settings().ai.turbo === true,
    saveFact,
    getCursor: () => screen.getCursorScreenPoint(),
    onStart: () => {
      globalShortcut.register(AGENT_STOP_KEY, () => agent.stop());
      fleet.each((notch) => {
        notch.win.setContentProtection(true); // the AI should see your screen, not this window
        notch.close();
      });
      send('agent:state', { running: true, stopKey: AGENT_STOP_KEY });
    },
    onEnd: () => {
      globalShortcut.unregister(AGENT_STOP_KEY);
      fleet.each((notch) => notch.applyLayout());
      send('agent:state', { running: false });
    },
    beforeLook: async () => {
      fleet.each((notch) => notch.close());
      await new Promise((resolve) => { setTimeout(resolve, AGENT_LOOK_DELAY_MS); });
    },
    askOnScreen: () => {
      const notch = fleet.underCursor();
      notch.open('key', 'ai');
      notch.setPinned(true);
    },
    afterAsk: () => fleet.each((notch) => { notch.setPinned(false); notch.close(); }),
  });
}

function restartRenderer(notch) {
  notch.close();
  notch.win.webContents.reload();
}

// The window's own tab is remembered per screen. Everything else is shared by all of them.
const storeName = (ns) => (ns === 'ui' ? `ui-${here().display.id}` : ns);

const methods = {
  'settings.get': () => ({
    settings: settings(),
    shortcutError,
    claudeModels: CLAUDE_MODELS,
    tucked: here().tucked,
    panel: here().panel(),
    leader: here().isLeader,
  }),
  'displays.list': () => fleet.listDisplays(),
  'settings.set': updateSettings,
  'settings.reset': () => updateSettings(structuredClone(SETTINGS)),
  'store.get': (ns, fallback) => { assertRendererStore(ns); return store.get(storeName(ns), fallback); },
  'store.set': (ns, value) => {
    assertRendererStore(ns);
    store.set(storeName(ns), value);
    if (ns !== 'ui') fleet.sendExcept(fleet.current, 'store:changed', ns);
  },

  'notch.pill': (size) => here().setPill(size),
  'notch.petWalk': (walk) => here().setPetWalk(walk),
  'notch.open': () => here().open('click'),
  'notch.close': () => here().close(),
  'notch.openTab': (tab) => here().open('key', tab),
  'notch.stick': () => here().stick(),
  'notch.pin': (pinned) => here().setPinned(pinned),
  'notch.tuck': (tucked) => here().setTucked(tucked),
  'announce': (message) => send('announce', message),

  'media.action': (action, seconds) => helper.call('media', { action, seconds }),
  'media.refresh': () => helper.call('media.refresh'),
  'volume.get': () => helper.call('volume.get'),
  'volume.set': (percent) => helper.call('volume.set', { percent }),
  'volume.mute': () => helper.call('volume.mute'),
  'mic.get': () => helper.call('mic.get'),
  'mic.set': (muted) => helper.call('mic.set', { muted }),
  'brightness.get': () => helper.call('brightness.get'),
  'brightness.set': (percent) => helper.call('brightness.set', { percent }),
  'control.state': () => pc.state(),
  'control.set': (name, on) => pc.set(name, on),
  'control.vpn': () => pc.vpnList(),
  'control.vpnConnect': (name) => pc.vpnConnect(name),
  'control.vpnDisconnect': (name) => pc.vpnDisconnect(name),
  'control.power': (mode) => pc.setPowerMode(mode),
  'control.display': (mode) => pc.setDisplayMode(mode),
  'control.bluetooth': () => pc.bluetoothDevices(),
  'control.outputs': () => pc.outputs(),
  'control.output': (id) => pc.setOutput(id),
  'control.action': (name) => pc.action(name),
  'control.open': (name) => pc.open(name),
  'system.stats': systemStats,
  'system.memory': () => ({ memTotal: os.totalmem(), memFree: os.freemem() }),
  'system.top': () => helper.call('top.apps'),

  'wifi.scan': () => wifi.scan(),
  'wifi.connect': (args) => wifi.connect(args),
  'wifi.locationSettings': () => shell.openExternal('ms-settings:privacy-location'),

  'calendar.get': () => calendarState,
  'calendar.refresh': refreshCalendar,
  'weather.search': (name) => online.searchPlaces(name),
  'weather.forecast': (place, unit, force) => online.forecast(place, unit, force),
  'rates.get': () => online.rates(),
  'lyrics.get': (song) => online.lyrics(song),
  'backup.export': exportBackup,
  'backup.import': importBackup,

  'clipboard.list': () => history.items(),
  'clipboard.copy': (id) => history.copy(id),
  'clipboard.pin': (id) => history.togglePin(id),
  'clipboard.remove': (id) => history.remove(id),
  'clipboard.clear': () => history.clearAll(),

  'shelf.list': () => shelf.items(),
  'shelf.add': (paths) => shelf.add(paths),
  'shelf.remove': (id) => shelf.remove(id),
  'shelf.open': (id) => shelf.open(id),
  'shelf.reveal': (id) => shelf.reveal(id),
  'shelf.zip': (ids) => shelf.zip(ids),
  'shelf.unzip': (ids) => shelf.unzip(ids),
  'shelf.copyTo': (ids) => shelfToFolder(ids, 'copyTo', 'Copy to folder'),
  'shelf.moveTo': (ids) => shelfToFolder(ids, 'moveTo', 'Move to folder'),
  'shelf.trash': (ids) => shelf.trash(ids),
  'shelf.pick': addFilesToShelf,
  'shelf.read': (id) => shelf.readForConvert(id),
  'shelf.saveConverted': (id, extension, base64) => shelf.saveConverted(id, extension, base64),

  'drop.status': () => drop.status(),
  'drop.start': (ip) => drop.start(ip),
  'drop.stop': () => drop.stop(),
  'drop.remote': (allowed) => drop.setRemote(allowed),

  'drop.openFolder': () => {
    fs.mkdirSync(drop.saveDir(), { recursive: true });
    return shell.openPath(drop.saveDir());
  },

  'ai.start': (args) => ai.start(args),
  'ai.stop': (id) => ai.stop(id),
  'ai.pickFiles': pickFilesForAi,
  'ai.addFiles': (paths) => attachments.add(paths),
  'agent.start': (args) => agent.start(args),
  'agent.answer': (reply) => agent.answer(reply),
  'agent.stop': () => agent.stop(),
  'agent.session': (all) => agent.setSession(all),
  'skills.import': importSkill,
  'skills.library': () => SKILL_LIBRARY,
  'ai.setKey': (provider, key) => store.secrets.set(`ai.${provider}`, key),
  'ai.keyHint': (provider) => {
    const key = store.secrets.get(`ai.${provider}`);
    return key ? `••••${key.slice(-4)}` : ''; // only the end, so a key can be told apart but not read
  },
  'ai.hasKeys': () => Object.fromEntries(
    ['gemini', 'claude', 'openai'].map((name) => [name, store.secrets.has(`ai.${name}`)]),
  ),
  'history.list': (filter) => aiHistory.list(filter),
  'history.get': (id) => aiHistory.get(id),
  'history.saveChat': (chat) => aiHistory.saveChat(chat),
  'history.remove': (id) => aiHistory.remove(id),
  'history.clear': () => aiHistory.clear(),
  'ai.test': testActiveApi,
  'ai.models': () => listModels(settings().ai),
  'mcp.setSecret': (id, value) => store.secrets.set(`mcp.${id}`, value),
  'mcp.hasSecret': (id) => store.secrets.has(`mcp.${id}`),
  'mcp.test': (id) => testServer(mcpServer(id), store.secrets.get(`mcp.${id}`)),

  'links.open': openLink,
  'text.copy': (text) => clipboard.writeText(String(text)),
  'locks.get': () => helper.call('locks.get'),
  'screentime.get': () => screenTime.summary(),
  'privacy.list': () => CLEARABLE,
  'privacy.clear': clearData,
  'app.quit': () => app.quit(),
};

function setupIpc() {
  ipcMain.handle('call', (event, method, ...args) => {
    fleet.current = fleet.forSender(event.sender);
    if (!fleet.current) throw new Error('Unknown sender');
    if (!Object.hasOwn(methods, method)) throw new Error(`Unknown method: ${method}`);
    return methods[method](...args);
  });

  ipcMain.on('drag-out', (event, kind, id) => {
    if (!fleet.forSender(event.sender)) return;
    let file = null;
    const fromShelf = kind === 'shelf';
    if (fromShelf) file = shelf.find(id).path;
    if (kind === 'clip') {
      const item = history.items().find((candidate) => candidate.id === id && candidate.type === 'image');
      if (item) file = history.imagePath(item);
    }
    if (!file) return;
    event.sender.startDrag({ file, icon: nativeImage.createFromPath(ICON).resize({ width: 32 }) });
    if (fromShelf && settings().shelf.removeAfterDrag) shelf.remove(id);
  });
}

function setupHelper() {
  helper = new Helper();
  helper.on('media', (state) => send('media', state));
  helper.on('art', (art) => send('art', art));
  helper.on('volume', (volume) => send('volume', volume));
  helper.on('lockkey', (change) => send('lockkey', change));
  helper.on('clip', (info) => { if (settings().clipboardHistory) history.check(info); });
  helper.on('foreground', (state) => {
    if (settings().screenTime.on) screenTime.record(state, settings().screenTime.idle);
    fleet.setFullscreen(state.fullscreen, { x: state.x, y: state.y });
    fleet.forHandle(state.handle)?.foregroundIsOurs();
    // Waking the page every second for a pet that has nothing new to do keeps the notch from resting.
    const forPet = `${state.app}|${Math.floor(state.idle / PET_IDLE_STEP_S)}`;
    if (settings().pet.on && forPet !== lastForPet) {
      lastForPet = forPet;
      send('foreground', { app: state.app, idle: state.idle });
    }
  });
  helper.on('failed', (reason) => toast(`Windows helper stopped: ${reason}`.slice(0, 80), 'alert'));
  helper.start();
}

function setupTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16 }));
  tray.setToolTip('Nook');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Nook', click: () => fleet.underCursor().open('key') },
    { label: 'Settings', click: () => fleet.underCursor().open('key', 'settings') },
    { label: 'Show the notch', click: () => fleet.each((notch) => notch.restore()) },
    { label: 'Hide the notch', click: () => fleet.each((notch) => notch.setTucked(true)) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', toggleNotch);
}

// Skills saved with the old on/off switch move to the new modes once.
function upgradeSkills() {
  const skills = store.get('skills', []);
  if (skills.every((skill) => skill.mode)) return;
  store.set('skills', skills.map(({ on, ...skill }) => ({ ...skill, mode: skillMode({ ...skill, on }) })));
}

// Skills that arrive with an update join your list once, on Auto. Delete one and it stays deleted.
function offerNewSkills() {
  const offered = store.get('skillsOffered', []);
  const fresh = SKILL_LIBRARY.filter((skill) => NEW_SKILLS.includes(skill.name) && !offered.includes(skill.name));
  if (!fresh.length) return;
  const skills = store.get('skills', []);
  const missing = fresh.filter((skill) => !skills.some((saved) => saved.name === skill.name));
  store.set('skills', [...skills, ...missing.map(({ name, text, description, keywords }) => ({ name, text, description, keywords, mode: 'auto' }))]);
  store.set('skillsOffered', [...offered, ...fresh.map((skill) => skill.name)]);
}

function setup() {
  upgradeSkills();
  offerNewSkills();
  screenTime = new ScreenTime();
  history = new ClipboardHistory({
    onChange: (items) => send('clipboard', items),
    onCopied: (type) => { if (settings().copiedToast) send('copied', type); },
    onError: logError,
  });
  shelf = new Shelf({ onChange: (items) => send('shelf', items) });
  drop = new PhoneDrop({
    saveDir: () => path.join(app.getPath('downloads'), 'Nook Drop'),
    listFiles: () => shelf.items().filter((item) => !item.isDir && !item.missing),
    onFile: (file) => {
      shelf.add([file]);
      send('drop:received', path.basename(file));
      toast(`Received ${path.basename(file)}`, 'phone');
    },
    onText: (text) => clipboard.writeText(text).then(() => toast('Phone text copied', 'phone'), logError),
    onStop: (reason) => send('drop:stopped', reason),
    onRemote: (action) => phoneRemote.run(action),
    page: path.join(__dirname, 'renderer', 'phone.html'),
  });
  ai = new AiRunner({ getSettings: settings, send, getSkills: () => store.get('skills', []), getMemory: () => store.get('memory', []) });

  fleet = new NotchFleet({
    getSettings: settings,
    preload: path.join(__dirname, 'preload.js'),
    page: path.join(__dirname, 'renderer', 'index.html'),
    onRendererGone: restartRenderer,
  });

  setupIpc();
  setupHelper();
  pc = new PcControl({ helper, shell });
  phoneRemote = new PhoneRemote({ helper, pc });
  aiHistory = new AiHistory({ store, isOn: () => settings().ai.keepHistory });
  setupAgent();
  setupTray();
  shortcutError = registerShortcut(settings().shortcut, toggleNotch);
  if (settings().snoozeShortcut) registerShortcut(settings().snoozeShortcut, toggleSnooze);
  registerVolumeKeys();
  applyKeepAwake();
  refreshCalendar();
  setInterval(refreshCalendar, CALENDAR_REFRESH_MS);
}

// A background notch must not stop on a modal error box: write it down and keep running.
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

if (app.requestSingleInstanceLock()) {
  app.setAppUserModelId('local.personal.nook');
  app.whenReady().then(setup);
  app.on('second-instance', () => fleet && toggleNotch());
  app.on('window-all-closed', (event) => event.preventDefault());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (drop) drop.stop();
    if (agent) agent.stop('Nook closed.');
    if (browser) browser.close();
    if (helper) helper.stop();
    store.flush();
  });
} else {
  app.quit();
}

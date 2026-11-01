'use strict';

const MODULE_IDS = [
  'home', 'calendar', 'tasks', 'notes', 'time', 'weather', 'clipboard', 'shelf',
  'drop', 'units', 'ai', 'control', 'system', 'health', 'links',
];

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];

const SETTINGS = {
  // Look
  theme: 'onyx',
  edgeLight: 'music', // off | accent | music
  look: 'black', // black | color | glass
  lookColor: '#1c2b4d',
  closedOpacity: 100,
  timeFormat: 'auto', // auto | 12 | 24

  // Size and place
  displayMode: 'primary', // primary | all | one | follow
  displayId: null,
  fitScreen: true,
  closedWidth: 150,
  closedHeight: 32,
  panelWidth: 780,
  panelHeight: 480,
  position: 50,
  topGap: 0,

  // Opening and hiding
  openOnHover: true,
  hoverDelay: 120,
  defaultTab: 'home',
  rememberTab: true,
  shortcut: 'Alt+N',
  arrowTabs: true,
  snoozeShortcut: 'Alt+Shift+H',
  snoozeMinutes: 30,
  autoHide: false,
  hideInFullscreen: true,
  showInScreenshots: true,
  startWithWindows: false,
  keepAwake: false,

  // Closed notch
  closedLeft: 'none',
  closedRight: 'none',
  closedMiddle: 'time', // time | daytime | none
  keepClock: false,
  live: {
    on: true, rotate: true, music: true, timers: true, calendar: true, tasks: true, sneakPeek: true, progress: false,
  },

  // Alerts
  volumeHud: true,
  lockKeys: true,
  capsMark: false,
  copiedToast: true,
  battery: { show: true, percent: true, charger: true, lowAt: 20 },

  // Tools
  pet: {
    on: true, name: '', avatar: {}, saved: [], size: 64, side: 'right', reactApps: true, sleepAfter: 2, bubbles: true, play: true, walk: true,
  },
  clipboardHistory: true,
  lyrics: false,
  modules: MODULE_IDS.map((id) => ({ id, on: true })),
  message: { on: false, text: '', color: '#a78bfa' },
  weather: { place: null, unit: 'celsius' },
  calendars: [],
  calendarRemind: 5,
  calendarWeekStart: 'sunday',
  ai: {
    provider: 'gemini',
    models: {
      gemini: 'gemini-3.5-flash-lite',
      claude: 'claude-opus-5-5',
      openai: '',
      ollama: '',
    },
    openaiUrl: 'https://api.openai.com/v1',
    ollamaUrl: 'http://127.0.0.1:11434/v1',
    apis: [], // the person's own list: { id, name, url, model }
    caps: {}, // what the Test button found, by "provider:model": { tools, vision }
    maxSteps: 40,
    keepHistory: true,
    turbo: false, // the agent never asks, only ever turned on by the person
    mcpServers: [], // { id, name, kind: 'command' | 'url', command, args, url, on, trusted }
  },
  health: {
    breaks: true, breakEvery: 50, eyes: false, eyeEvery: 20, eyeSeconds: 20, water: false, waterEvery: 60, waterGoal: 8,
  },
  pomodoro: { focus: 25, short: 5, long: 15, cycles: 4, autoBreak: true, autoFocus: false, sound: true },
  tasks: { snooze: 10, lateDone: 0 },
  shelf: { removeAfterDrag: false },
  screenTime: { on: true, idle: 300 },
  day: { wake: '07:00', bed: '23:00' },
};

// Settings objects merged key by key, so a new default appears without losing saved values.
const NESTED_SETTINGS = ['pet', 'live', 'battery', 'message', 'weather', 'health', 'pomodoro', 'tasks', 'shelf', 'screenTime', 'day'];

// Changing one of these moves or resizes the window.
const LAYOUT_SETTINGS = ['panelWidth', 'panelHeight', 'position', 'topGap', 'showInScreenshots', 'fitScreen', 'displayMode', 'displayId'];

// Namespaces the renderer may read and write directly. Everything else stays in the main process.
const RENDERER_STORES = ['tasks', 'notes', 'events', 'timers', 'clocks', 'links', 'health', 'chat', 'chatId', 'ui', 'skills', 'memory'];

// What the Privacy page can wipe, one entry per tool.
const CLEARABLE = {
  tasks: 'Tasks', notes: 'Notes', events: 'Calendar events', chat: 'AI chat', memory: 'AI memory', aiHistory: 'AI history',
  health: 'Health rings', links: 'Links', clocks: 'World clocks',
  clipboard: 'Clipboard history', shelf: 'Shelf list', screentime: 'Screen time',
};

module.exports = { MODULE_IDS, CLAUDE_MODELS, SETTINGS, NESTED_SETTINGS, LAYOUT_SETTINGS, RENDERER_STORES, CLEARABLE };

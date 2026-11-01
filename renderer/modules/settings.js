import { call, emit, h, icon, iconButton, saveSettings, state, uid } from '../core.js';
import { EXTRA_OPTIONS } from '../extras.js';
import {
  COLOR_FIELDS, OPTIONS, PRESETS, avatarSvg, normalize, randomAvatar,
} from '../avatar.mjs';
import { memoryList } from '../ai-history.js';
import { applyAvatar } from '../pet.js';
import { TRY_EVENTS } from '../pet-acts.mjs';

const THEMES = [['onyx', 'Onyx'], ['ember', 'Ember'], ['aurora', 'Aurora'], ['silver', 'Silver']];
const PROVIDERS = [['gemini', 'Gemini'], ['claude', 'Claude'], ['openai', 'OpenAI-compatible'], ['ollama', 'Ollama (local)']];
const API_ADDRESSES = [
  ['OpenRouter', 'https://openrouter.ai/api/v1'], ['Groq', 'https://api.groq.com/openai/v1'], ['DeepSeek', 'https://api.deepseek.com/v1'],
  ['Mistral', 'https://api.mistral.ai/v1'], ['xAI', 'https://api.x.ai/v1'], ['Together', 'https://api.together.xyz/v1'],
];
const TOOL_NAMES = {
  home: 'Home', calendar: 'Calendar', tasks: 'Tasks', notes: 'Notes', time: 'Timers', weather: 'Weather',
  clipboard: 'Clipboard', shelf: 'Shelf', drop: 'Phone Drop', units: 'Units', ai: 'AI', control: 'Control',
  system: 'System', health: 'Health', links: 'Links',
};

let content;
let menu;
let search;
let page = 'general';
let dragged = null;

const s = () => state.settings;
const cleanError = (err) => err.message.replace(/^Error invoking remote method 'call': (Error: )?/, '');
const setNested = (key) => (patch) => saveSettings({ [key]: { ...s()[key], ...patch } });

const section = (title, ...rows) => h('div', { class: 'setting-section' }, h('h3', {}, title), rows);
const setting = (label, control, hint) => h('label', { class: 'setting' },
  h('span', { class: 'grow' }, label, hint && h('div', { class: 'faint' }, hint)), control);

function toggle(label, checked, change, hint) {
  return setting(label, h('input', { type: 'checkbox', checked, onChange: (event) => change(event.target.checked) }), hint);
}

function choice(label, options, value, change, hint) {
  const select = h('select', { onChange: () => change(select.value) },
    options.map(([key, name]) => h('option', { value: key }, name)));
  select.value = value;
  return setting(label, select, hint);
}

function text(label, value, change, { type = 'text', placeholder = '', hint } = {}) {
  return setting(label, h('input', { type, value, placeholder, onChange: (event) => change(event.target.value.trim()) }), hint);
}

function slider(label, value, min, max, unit, change, { step = 1, hint } = {}) {
  const readout = h('span', { class: 'chip slider-value' }, `${value}${unit}`);
  const input = h('input', {
    type: 'range', min, max, step, value, ariaLabel: label,
    onInput: () => { readout.textContent = `${input.value}${unit}`; },
    onChange: () => change(Number(input.value)),
  });
  return setting(label, h('span', { class: 'slider-control' }, input, readout), hint);
}

async function generalPage() {
  const screens = await call('displays.list');
  const status = h('div', { class: 'error' }, state.shortcutError);
  const shortcut = (key) => async (value) => { status.textContent = await saveSettings({ [key]: value }); };
  const enabled = s().modules.filter((item) => item.on).map((item) => [item.id, TOOL_NAMES[item.id]]);
  const screenRows = [
    choice('Show Nook on', [
      ['primary', 'Main screen only'], ['all', 'Every screen'], ['one', 'One screen I choose'], ['follow', 'The screen my mouse is on'],
    ], s().displayMode, async (displayMode) => { await saveSettings({ displayMode }); draw(); },
    'Every screen gives each its own notch and tab, and uses more memory. Your data stays the same on all.'),
  ];
  if (s().displayMode === 'one') {
    const chosen = screens.some((item) => item.id === String(s().displayId)) ? String(s().displayId) : screens[0].id;
    screenRows.push(choice('Which screen', screens.map(({ id, label }) => [id, label]), chosen, (displayId) => saveSettings({ displayId })));
  }
  screenRows.push(toggle('Fit to each screen', s().fitScreen, async (fitScreen) => { await saveSettings({ fitScreen }); draw(); }, 'Sizes the open notch for that screen by itself'));
  return [
    section('Screens', screenRows),
    section('Opening',
      toggle('Open on hover', s().openOnHover, (openOnHover) => saveSettings({ openOnHover })),
      choice('Open this tool by default', enabled, s().defaultTab, (defaultTab) => saveSettings({ defaultTab })),
      toggle('Remember the last tool', s().rememberTab, (rememberTab) => saveSettings({ rememberTab })),
      toggle('Start with Windows', s().startWithWindows, (startWithWindows) => saveSettings({ startWithWindows }))),
    section('Keyboard shortcuts',
      text('Open or close Nook', s().shortcut, shortcut('shortcut'), { hint: 'For example Alt+N or Ctrl+Shift+Space. Leave empty to turn off.' }),
      text('Snooze Nook', s().snoozeShortcut, shortcut('snoozeShortcut'), { hint: 'Hides it for a while. Press again to bring it back.' }),
      status,
      slider('Snooze duration', s().snoozeMinutes, 5, 240, ' min', (snoozeMinutes) => saveSettings({ snoozeMinutes }), { step: 5 }),
      toggle('Switch tools with left and right arrows', s().arrowTabs, (arrowTabs) => saveSettings({ arrowTabs }), 'Alt+Shift+arrows also work while typing')),
    section('Performance',
      toggle('Use the graphics card', s().useGraphicsCard, (useGraphicsCard) => saveSettings({ useGraphicsCard }), 'Off uses less memory. Restart Nook after changing this.')),
    section('Hiding',
      toggle('Auto-hide', s().autoHide, (autoHide) => saveSettings({ autoHide }), 'Leaves a thin line at the top. Alerts still come down.'),
      toggle('Step aside for full-screen apps', s().hideInFullscreen, (hideInFullscreen) => saveSettings({ hideInFullscreen })),
      toggle('Show Nook in screenshots and recordings', s().showInScreenshots, (showInScreenshots) => saveSettings({ showInScreenshots }), 'Off hides it from screen sharing too')),
  ];
}

function appearancePage() {
  const look = [
    choice('Look when closed', [['black', 'Black'], ['color', 'Colour'], ['glass', 'Glass']], s().look, async (value) => { await saveSettings({ look: value }); draw(); }),
  ];
  if (s().look === 'color') {
    look.push(setting('Colour', h('input', { type: 'color', value: s().lookColor, onChange: (event) => saveSettings({ lookColor: event.target.value }) }), 'The text turns dark on a light colour'));
  }
  return [
    section('Style',
      choice('Theme', THEMES, s().theme, (theme) => saveSettings({ theme })),
      look,
      slider('Opacity when closed', s().closedOpacity, 20, 100, '%', (closedOpacity) => saveSettings({ closedOpacity }), { hint: 'Solid again on hover, when open and for alerts' }),
      choice('Edge light', [['off', 'Off'], ['accent', 'Theme colour'], ['music', 'Album art colour']], s().edgeLight, (edgeLight) => saveSettings({ edgeLight })),
      choice('Time format', [['auto', 'Windows default'], ['12', '12-hour'], ['24', '24-hour']], s().timeFormat, (timeFormat) => saveSettings({ timeFormat }))),
    section('Size',
      slider('Closed width', s().closedWidth, 120, 320, ' px', (closedWidth) => saveSettings({ closedWidth }), { hint: 'It grows when there is more to show' }),
      slider('Closed height', s().closedHeight, 22, 44, ' px', (closedHeight) => saveSettings({ closedHeight })),
      s().fitScreen
        ? h('div', { class: 'setting' }, h('span', { class: 'grow faint' }, 'Open size follows each screen. Turn off Fit to each screen in General to set it by hand.'))
        : [
          slider('Open width', s().panelWidth, 680, 960, ' px', (panelWidth) => saveSettings({ panelWidth }), { step: 10 }),
          slider('Open height', s().panelHeight, 400, 620, ' px', (panelHeight) => saveSettings({ panelHeight }), { step: 10 }),
        ]),
    section('Place',
      slider('Left or right', s().position, 0, 100, '%', (position) => saveSettings({ position }), { hint: '50% is the centre of the screen' }),
      slider('Gap from the top', s().topGap, 0, 120, ' px', (topGap) => saveSettings({ topGap }), { hint: 'Floats Nook as a rounded pill' })),
  ];
}

function closedPage() {
  const { live } = s();
  const setLive = setNested('live');
  return [
    section('When nothing is happening',
      choice('Left side', EXTRA_OPTIONS, s().closedLeft, (closedLeft) => saveSettings({ closedLeft })),
      choice('Middle', [['time', 'Time'], ['daytime', 'Day and time'], ['none', 'Nothing']], s().closedMiddle, (closedMiddle) => saveSettings({ closedMiddle })),
      choice('Right side', EXTRA_OPTIONS, s().closedRight, (closedRight) => saveSettings({ closedRight })),
      toggle('Keep the time while music or a timer plays', s().keepClock, (keepClock) => saveSettings({ keepClock }))),
    section('Live activities',
      toggle('Show live activities while closed', live.on, (on) => setLive({ on })),
      toggle('Take turns every 6 seconds', live.rotate, (rotate) => setLive({ rotate })),
      toggle('Music', live.music, (music) => setLive({ music })),
      toggle('Timers and stopwatch', live.timers, (timers) => setLive({ timers })),
      toggle('Events starting soon', live.calendar, (calendar) => setLive({ calendar })),
      toggle('Task deadlines', live.tasks, (tasks) => setLive({ tasks })),
      toggle('Show the new song when it changes', live.sneakPeek, (sneakPeek) => setLive({ sneakPeek })),
      toggle('Thin progress bar under music', live.progress, (progress) => setLive({ progress })),
      toggle('Show synced lyrics', s().lyrics, (lyrics) => saveSettings({ lyrics }), 'Sends the song name and artist to lrclib.net')),
    section('Your message',
      toggle('Show on the notch', s().message.on, (on) => setNested('message')({ on })),
      text('Text', s().message.text, (value) => setNested('message')({ text: value })),
      setting('Colour', h('input', { type: 'color', value: s().message.color, onChange: (event) => setNested('message')({ color: event.target.value }) }))),
  ];
}

function alertsPage() {
  const { battery } = s();
  const setBattery = setNested('battery');
  return [
    section('Volume and keys',
      toggle('Replace the Windows volume pop-up', s().volumeHud, (volumeHud) => saveSettings({ volumeHud })),
      toggle('Show Caps Lock, Num Lock and Scroll Lock', s().lockKeys, (lockKeys) => saveSettings({ lockKeys }), 'Only reads whether these keys are on or off'),
      toggle('Keep a mark while Caps Lock is on', s().capsMark, (capsMark) => saveSettings({ capsMark })),
      toggle('Show "Copied" on the notch', s().copiedToast, (copiedToast) => saveSettings({ copiedToast }))),
    section('Battery',
      toggle('Show battery in the open notch', battery.show, (show) => setBattery({ show })),
      toggle('Show percentage', battery.percent, (percent) => setBattery({ percent })),
      toggle('Alert when the charger is plugged in or out', battery.charger, (charger) => setBattery({ charger })),
      slider('Low battery warning', battery.lowAt, 5, 50, '%', (lowAt) => setBattery({ lowAt }))),
  ];
}

const TRY_MOODS = [['idle', 'Rest'], ['typing', 'Work'], ['dance', 'Music'], ['happy', 'Happy'], ['alert', 'Alert'], ['sleep', 'Sleep']];
const FIELD_NAMES = {
  base: 'Character', eyes: 'Eyes', mouth: 'Mouth', hair: 'Hair', head: 'On the head', face: 'On the face',
  neck: 'Around the neck', outfit: 'Outfit', emblem: 'Emblem', cape: 'Cape', item: 'Holding', aura: 'Aura',
};
const MAX_SAVED = 12;

const setPet = setNested('pet');
const useAvatar = async (avatar) => { await setPet({ avatar }); draw(); };

function avatarCard(name, avatar, remove) {
  const art = h('span', { class: 'avatar-art' });
  art.innerHTML = avatarSvg(avatar);
  const active = JSON.stringify(normalize(avatar)) === JSON.stringify(normalize(s().pet.avatar));
  return h('span', { class: 'avatar-slot' },
    h('button', { class: `avatar-card ${active ? 'active' : ''}`, type: 'button', title: name, onClick: () => useAvatar(normalize(avatar)) },
      art, h('span', { class: 'truncate' }, name)),
    remove && iconButton('x', `Delete ${name}`, remove, 'avatar-remove'));
}

function avatarPreview() {
  const avatar = normalize(s().pet.avatar);
  const art = h('div', { class: 'pet-art' });
  const preview = h('div', { class: 'pet pet-preview moving' }, art);
  applyAvatar(preview, art, avatar, 'idle');
  const play = (mood, extra) => {
    preview.classList.remove('moving');
    applyAvatar(preview, art, avatar, mood, extra);
    requestAnimationFrame(() => preview.classList.add('moving'));
  };
  const tryOut = TRY_MOODS.map(([mood, label]) => h('button', { class: 'btn', type: 'button', onClick: () => play(mood) }, label));
  const more = h('select', {
    ariaLabel: 'More reactions',
    onChange: () => {
      const picked = TRY_EVENTS[Number(more.value)];
      if (picked) play(picked[1].mood, picked[1]);
    },
  }, h('option', { value: '' }, 'More reactions...'), TRY_EVENTS.map(([label], index) => h('option', { value: index }, label)));
  const saved = s().pet.saved;
  return h('div', { class: 'avatar-top' }, preview,
    h('div', { class: 'col grow' },
      h('input', {
        type: 'text', maxLength: 24, value: s().pet.name, ariaLabel: "Your pet's name", placeholder: 'Give it a name',
        onChange: (event) => setPet({ name: event.target.value.trim() }),
      }),
      h('div', { class: 'label' }, 'Try a reaction'),
      h('div', { class: 'avatar-actions' }, tryOut, more),
      h('div', { class: 'avatar-actions' },
        h('button', { class: 'btn primary', type: 'button', onClick: () => useAvatar(randomAvatar()) }, 'Surprise me'),
        h('button', {
          class: 'btn', type: 'button', disabled: saved.length >= MAX_SAVED,
          onClick: async () => {
            await setPet({ saved: [...saved, { name: `My avatar ${saved.length + 1}`, avatar }] });
            draw();
          },
        }, 'Save this avatar'))));
}

function avatarGallery() {
  const { saved } = s().pet;
  const groups = Object.entries(PRESETS).map(([group, items]) => section(group,
    h('div', { class: 'avatar-grid' }, items.map(([name, avatar]) => avatarCard(name, avatar)))));
  if (saved.length) {
    groups.unshift(section('My avatars', h('div', { class: 'avatar-grid' }, saved.map((item, index) => avatarCard(item.name, item.avatar, async () => {
      await setPet({ saved: saved.filter((_, other) => other !== index) });
      draw();
    })))));
  }
  return groups;
}

function avatarBuilder() {
  const avatar = normalize(s().pet.avatar);
  const update = (patch) => useAvatar({ ...avatar, ...patch });
  return section('Build your own',
    Object.entries(OPTIONS).map(([key, options]) => choice(FIELD_NAMES[key], options, avatar[key], (value) => update({ [key]: value }))),
    COLOR_FIELDS.map(([key, label]) => setting(label, h('input', { type: 'color', value: avatar[key], ariaLabel: label, onChange: (event) => update({ [key]: event.target.value }) }))),
    toggle('Calm, respectful reactions', avatar.calm, (calm) => update({ calm }), 'Never sleeps, dances or types. Glows and blesses instead.'));
}

function petPage() {
  const { pet } = s();
  const set = setPet;
  return [
    avatarPreview(),
    ...avatarGallery(),
    avatarBuilder(),
    section('Pet',
      toggle('Show the pet', pet.on, (on) => set({ on }), 'It sits under the closed notch and never blocks clicks'),
      slider('Size', pet.size, 28, 96, ' px', (size) => set({ size }), { step: 4 }),
      choice('Place', [['left', 'Left of the notch'], ['center', 'Under the middle'], ['right', 'Right of the notch']], pet.side, (side) => set({ side }))),
    section('How it reacts',
      toggle('React to the app you are using', pet.reactApps, (reactApps) => set({ reactApps }), 'Uses only the app name, on this PC'),
      slider('Fall asleep after no input for', pet.sleepAfter, 1, 30, ' min', (sleepAfter) => set({ sleepAfter })),
      toggle('Walk around under the notch', pet.walk, (walk) => set({ walk }), 'Uses very little power. Sacred figures stay in their place.'),
      toggle('Play by itself when nothing is happening', pet.play, (play) => set({ play }), 'Yawns, stretches, plays with a ball, and has tea or lunch at the right time'),
      toggle('Show little bubbles', pet.bubbles, (bubbles) => set({ bubbles }))),
  ];
}

function toolsPage() {
  const rows = s().modules.map((item, index) => {
    const row = h('div', {
      class: 'setting module-row',
      draggable: true,
      onDragStart: () => { dragged = index; },
      onDragOver: (event) => { event.preventDefault(); row.classList.add('over'); },
      onDragLeave: () => row.classList.remove('over'),
      onDrop: async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dragged === null || dragged === index) return;
        const modules = [...s().modules];
        modules.splice(index, 0, ...modules.splice(dragged, 1));
        dragged = null;
        await saveSettings({ modules });
        draw();
      },
    },
    h('span', { class: 'grow' }, TOOL_NAMES[item.id]),
    h('input', {
      type: 'checkbox', checked: item.on, ariaLabel: `Show ${TOOL_NAMES[item.id]}`,
      onChange: (event) => saveSettings({
        modules: s().modules.map((other) => (other.id === item.id ? { ...other, on: event.target.checked } : other)),
      }),
    }));
    return row;
  });
  return [section('Tools (drag to reorder)', rows)];
}

function timersPage() {
  const { pomodoro, tasks } = s();
  const setPomodoro = setNested('pomodoro');
  const setTasks = setNested('tasks');
  return [
    section('Pomodoro',
      slider('Focus', pomodoro.focus, 5, 90, ' min', (focus) => setPomodoro({ focus }), { step: 5 }),
      slider('Short break', pomodoro.short, 1, 30, ' min', (short) => setPomodoro({ short })),
      slider('Long break', pomodoro.long, 5, 60, ' min', (long) => setPomodoro({ long }), { step: 5 }),
      slider('Focus sessions before a long break', pomodoro.cycles, 2, 8, '', (cycles) => setPomodoro({ cycles })),
      toggle('Start breaks automatically', pomodoro.autoBreak, (autoBreak) => setPomodoro({ autoBreak })),
      toggle('Start focus automatically after a break', pomodoro.autoFocus, (autoFocus) => setPomodoro({ autoFocus })),
      toggle('Completion sound', pomodoro.sound, (sound) => setPomodoro({ sound }))),
    section('Tasks',
      choice('Snooze a due task for', [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']], tasks.snooze, (snooze) => setTasks({ snooze: Number(snooze) })),
      choice('Mark late tasks as done', [[0, 'Off'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour']], tasks.lateDone, (lateDone) => setTasks({ lateDone: Number(lateDone) }))),
    section('Day',
      text('Day starts', s().day.wake, (wake) => setNested('day')({ wake }), { type: 'time' }),
      text('Bedtime', s().day.bed, (bed) => setNested('day')({ bed }), { type: 'time', hint: 'Times after midnight count as the next day' })),
  ];
}

function healthPage() {
  const { health, screenTime } = s();
  const set = setNested('health');
  return [
    section('Reminders',
      toggle('Break reminders', health.breaks, (breaks) => set({ breaks })),
      slider('Break every', health.breakEvery, 10, 120, ' min', (breakEvery) => set({ breakEvery }), { step: 5 }),
      toggle('Water reminders', health.water, (water) => set({ water })),
      slider('Water every', health.waterEvery, 15, 180, ' min', (waterEvery) => set({ waterEvery }), { step: 15 }),
      slider('Water goal', health.waterGoal, 1, 16, ' glasses', (waterGoal) => set({ waterGoal })),
      toggle('20-20-20 eye reminders', health.eyes, (eyes) => set({ eyes })),
      slider('Eye reminder every', health.eyeEvery, 10, 60, ' min', (eyeEvery) => set({ eyeEvery }), { step: 5 }),
      slider('Eye break length', health.eyeSeconds, 10, 60, ' sec', (eyeSeconds) => set({ eyeSeconds }), { step: 5 })),
    section('Screen time',
      toggle('Measure screen time', screenTime.on, (on) => setNested('screenTime')({ on }), 'Only app names, on this PC'),
      slider('Stop counting after no input for', screenTime.idle, 60, 900, ' sec', (idle) => setNested('screenTime')({ idle }), { step: 30 })),
  ];
}

function calendarPage() {
  const save = async (next) => { await saveSettings({ calendars: next }); draw(); };
  const name = h('input', { type: 'text', placeholder: 'Name', ariaLabel: 'Calendar name', style: 'width:130px' });
  const url = h('input', { type: 'url', class: 'grow', placeholder: 'Secret iCal link (.ics)', ariaLabel: 'Calendar link' });
  return [
    section('Calendars',
      s().calendars.map((calendar) => h('div', { class: 'setting' },
        h('span', { class: 'grow truncate' }, calendar.name),
        iconButton('trash', 'Remove calendar', () => save(s().calendars.filter((other) => other !== calendar))))),
      h('form', {
        class: 'setting',
        onSubmit: (event) => {
          event.preventDefault();
          if (!url.value.trim()) return;
          save([...s().calendars, { name: name.value.trim() || 'Calendar', url: url.value.trim() }]);
        },
      }, name, url, h('button', { class: 'btn', type: 'submit' }, 'Add')),
      slider('Remind me before an event', s().calendarRemind, 0, 30, ' min', (calendarRemind) => saveSettings({ calendarRemind })),
      choice('Week starts on', [['sunday', 'Sunday'], ['monday', 'Monday']], s().calendarWeekStart, (calendarWeekStart) => saveSettings({ calendarWeekStart }))),
    section('Weather',
      choice('Temperature', [['celsius', 'Celsius'], ['fahrenheit', 'Fahrenheit']], s().weather.unit, (unit) => setNested('weather')({ unit }))),
  ];
}

function shelfPage() {
  return [
    section('Shelf',
      toggle('Remove from the shelf after dragging out', s().shelf.removeAfterDrag, (removeAfterDrag) => setNested('shelf')({ removeAfterDrag }))),
    section('Clipboard',
      toggle('Keep clipboard history', s().clipboardHistory, (clipboardHistory) => saveSettings({ clipboardHistory }), 'Items marked private by password managers are skipped')),
  ];
}

const setAi = (patch) => saveSettings({ ai: { ...s().ai, ...patch } });

function apiAddressRow(value, change) {
  const list = h('datalist', { id: 'api-addresses' }, API_ADDRESSES.map(([name, url]) => h('option', { value: url }, name)));
  const input = h('input', {
    type: 'url', value, list: 'api-addresses', placeholder: 'https://.../v1', ariaLabel: 'API address',
    onChange: () => change(input.value.trim()),
  });
  return setting('API address', h('span', {}, input, list), 'Most APIs accept the OpenAI format. Pick one or paste its address.');
}

function modelRow(value, change, canList) {
  const names = h('datalist', { id: 'api-models' });
  const status = h('div', { class: 'error' });
  const input = h('input', {
    type: 'text', value, list: 'api-models', placeholder: 'Model name', ariaLabel: 'Model',
    onChange: () => change(input.value.trim()),
  });
  const fetchNames = async () => {
    status.textContent = '';
    try {
      const models = await call('ai.models');
      names.replaceChildren(...models.map((model) => h('option', { value: model })));
      status.textContent = models.length ? '' : 'This API gave no model names.';
      input.focus();
    } catch (err) {
      status.textContent = cleanError(err);
    }
  };
  return setting('Model', h('span', { class: 'row' }, input, names, canList && h('button', { class: 'btn', type: 'button', onClick: fetchNames }, 'Find')), status);
}

function apiTestRow() {
  const status = h('div', { class: 'faint api-test-status selectable' }, 'Finds out what this model can do. Sends three small requests to it.');
  const word = (found) => ({ true: 'yes', false: 'no' }[found] ?? 'could not check');
  const test = async () => {
    button.disabled = true;
    status.textContent = 'Testing...';
    try {
      const { tools, vision, settings } = await call('ai.test');
      state.settings = settings;
      status.textContent = `It works. Tools: ${word(tools)}. Pictures: ${word(vision)}.`
        + `${tools === false ? ' Nook will use text tools for this model.' : ''}${vision === false ? ' It will read the screen as text.' : ''}`;
    } catch (err) {
      status.textContent = cleanError(err);
    }
    button.disabled = false;
  };
  const button = h('button', { class: 'btn', type: 'button', onClick: test }, 'Test this API');
  return h('div', { class: 'setting' }, h('span', { class: 'grow' }, 'Check', status), button);
}

const memorySection = () => section('What the AI remembers (sent with every chat and task)', memoryList());

function mcpRow(server) {
  const servers = () => s().ai.mcpServers;
  const save = async (mcpServers) => { await setAi({ mcpServers }); draw(); };
  const change = (patch) => save(servers().map((item) => (item.id === server.id ? { ...item, ...patch } : item)));
  const status = h('div', { class: 'faint selectable' }, server.kind === 'url' ? server.url : `${server.command} ${server.args || ''}`);
  const test = async () => {
    status.textContent = 'Connecting...';
    try {
      const tools = await call('mcp.test', server.id);
      status.textContent = `Works, ${tools.length} tool${tools.length === 1 ? '' : 's'}: ${tools.slice(0, 8).join(', ')}`;
    } catch (err) {
      status.textContent = cleanError(err);
    }
  };
  return h('div', { class: 'setting' },
    h('span', { class: 'grow' }, server.name, status),
    (() => {
      const ask = h('select', { class: 'skill-mode', ariaLabel: `Permission for ${server.name}`, onChange: () => change({ trusted: ask.value === 'task' }) },
        h('option', { value: 'every' }, 'Ask every time'), h('option', { value: 'task' }, 'Ask per task'));
      ask.value = server.trusted ? 'task' : 'every';
      return ask;
    })(),
    h('button', { class: 'btn', type: 'button', onClick: test }, 'Test'),
    h('input', { type: 'checkbox', checked: server.on, ariaLabel: `Use ${server.name}`, onChange: (event) => change({ on: event.target.checked }) }),
    iconButton('trash', `Delete ${server.name}`, async () => {
      await call('mcp.setSecret', server.id, '');
      save(servers().filter((item) => item.id !== server.id));
    }));
}

function mcpSection() {
  const name = h('input', { type: 'text', ariaLabel: 'Tool server name', placeholder: 'Name' });
  const target = h('input', { type: 'text', ariaLabel: 'Command or address', placeholder: 'Command such as npx, or an https address' });
  const args = h('input', { type: 'text', ariaLabel: 'Arguments', placeholder: 'Arguments, for a command' });
  const secret = h('textarea', { rows: 2, ariaLabel: 'Secret', placeholder: 'Optional and encrypted. A token for an address, or NAME=value lines for a command.' });
  const status = h('div', { class: 'error' });
  const add = async () => {
    const value = target.value.trim();
    if (!name.value.trim() || !value) { status.textContent = 'Give it a name and a command or address.'; return; }
    const id = uid();
    const isUrl = /^https?:\/\//i.test(value);
    if (secret.value.trim()) await call('mcp.setSecret', id, secret.value.trim());
    await setAi({
      mcpServers: [...s().ai.mcpServers, {
        id, name: name.value.trim(), kind: isUrl ? 'url' : 'command', url: isUrl ? value : '', command: isUrl ? '' : value, args: args.value.trim(), on: true, trusted: false,
      }],
    });
    draw();
  };
  return section('Tool servers (MCP)',
    h('div', { class: 'faint' }, 'Adds tools for every AI. A server is a program with the power you give it, so only add ones you trust.'),
    s().ai.mcpServers.map(mcpRow),
    h('div', { class: 'col skill-form' }, name, target, args, secret, status,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onClick: add }, 'Add server'))));
}

function aiPage() {
  const ai = s().ai;
  const provider = ai.provider;
  const custom = ai.apis.find((api) => `api:${api.id}` === provider);
  const updateApi = (patch) => setAi({ apis: s().ai.apis.map((api) => (api.id === custom.id ? { ...api, ...patch } : api)) });
  const setModel = (model) => (custom ? updateApi({ model }) : setAi({ models: { ...s().ai.models, [provider]: model } }));
  const addApi = async () => {
    const id = uid().slice(0, 8);
    await setAi({ apis: [...s().ai.apis, { id, name: 'My API', url: API_ADDRESSES[0][1], model: '' }], provider: `api:${id}` });
    draw();
  };
  const removeApi = async () => {
    await call('ai.setKey', provider, '');
    await setAi({ apis: s().ai.apis.filter((api) => api.id !== custom.id), provider: 'gemini' });
    draw();
  };
  const providers = [...PROVIDERS, ...ai.apis.map((api) => [`api:${api.id}`, api.name || 'My API'])];
  const rows = [choice('Provider', providers, custom || !provider.startsWith('api:') ? provider : 'gemini', async (next) => { await setAi({ provider: next }); draw(); })];

  if (custom) {
    rows.push(text('Name', custom.name, async (name) => { await updateApi({ name }); draw(); }, { placeholder: 'Your name for this API' }));
    rows.push(apiAddressRow(custom.url, (url) => updateApi({ url })));
  }
  if (provider !== 'ollama') {
    const keyStatus = h('span', { class: 'faint' });
    call('ai.keyHint', provider).then((hint) => { keyStatus.textContent = hint ? `Saved ${hint}, encrypted on this PC` : 'Not set'; });
    rows.push(text('API key', '', async (value) => {
      if (!value) return;
      await call('ai.setKey', provider, value);
      draw();
    }, { type: 'password', placeholder: 'Paste, then press Enter', hint: 'For safety only the last 4 characters are ever shown' }));
    rows.push(h('div', { class: 'setting' }, h('span', { class: 'grow' }, 'Key status'), keyStatus,
      iconButton('trash', 'Remove key', async () => { await call('ai.setKey', provider, ''); draw(); })));
  }
  if (provider === 'claude') {
    rows.push(choice('Model', state.claudeModels.map((model) => [model, model]), ai.models.claude, setModel));
  } else {
    rows.push(modelRow(custom ? custom.model : ai.models[provider], setModel, provider !== 'gemini'));
  }
  if (provider === 'openai') rows.push(text('Base URL', ai.openaiUrl, (openaiUrl) => setAi({ openaiUrl }), { type: 'url' }));
  if (provider === 'ollama') rows.push(text('Ollama URL', ai.ollamaUrl, (ollamaUrl) => setAi({ ollamaUrl }), { type: 'url' }));
  rows.push(apiTestRow());
  rows.push(h('div', { class: 'row' },
    h('button', { class: 'btn', type: 'button', onClick: addApi }, 'Add another API'),
    custom && h('button', { class: 'btn', type: 'button', onClick: removeApi }, 'Remove this API')));
  return [
    section('AI', rows),
    section('Agent',
      slider('Most steps in one task', ai.maxSteps, 10, 200, '', (maxSteps) => setAi({ maxSteps }), { step: 10, hint: 'Long jobs need more, and each step is one AI request.' }),
      toggle('Turbo mode', ai.turbo, (turbo) => setAi({ turbo }), 'The Agent never asks before it acts. It runs commands, changes files and deletes by itself, so use it only with an AI and sites you trust. Ctrl+Alt+Q still stops it.'),
      toggle('Keep a history of chats and tasks', ai.keepHistory, (keepHistory) => setAi({ keepHistory }), 'Only the words, on this PC. See it in the AI tab, and clear it there or in Privacy.')),
    memorySection(),
    mcpSection(),
    ...skillsSection(),
  ];
}

function skillRow(skill, skills) {
  const save = async (next) => { await call('store.set', 'skills', next); draw(); };
  return h('div', { class: 'setting' },
    h('span', { class: 'grow truncate', title: skill.text }, skill.name),
    (() => {
      const select = h('select', {
        class: 'skill-mode',
        ariaLabel: `When to use ${skill.name}`,
        onChange: () => save(skills.map((other) => (other === skill ? { ...other, mode: select.value } : other))),
      }, [['auto', 'Auto'], ['always', 'Always'], ['off', 'Off']].map(([value, label]) => h('option', { value }, label)));
      select.value = skill.mode;
      return select;
    })(),
    iconButton('trash', `Delete ${skill.name}`, () => save(skills.filter((other) => other !== skill))));
}

const wordCount = (text) => text.trim().split(/\s+/).length;

function skillSummary(skills) {
  if (!skills.length) return 'No skills yet. Add a ready one below or write your own.';
  const always = skills.filter((skill) => skill.mode === 'always');
  const automatic = skills.filter((skill) => skill.mode === 'auto').length;
  const words = always.reduce((sum, skill) => sum + wordCount(skill.text), 0);
  return `${automatic} automatic, used only when your message needs them. ${always.length} always on, about ${words} words with every message.`;
}

function suggestionRow(item, skills, add) {
  const added = skills.some((skill) => skill.name === item.name);
  return h('div', { class: 'setting' },
    h('span', { class: 'grow' }, item.name, h('div', { class: 'faint' }, item.description)),
    h('button', { class: 'btn', type: 'button', disabled: added, title: item.text, onClick: () => add(item) }, added ? 'Added' : 'Add'));
}

function skillsSection() {
  const list = h('div', { class: 'col' });
  const summary = h('div', { class: 'faint' });
  const suggestions = h('div', { class: 'col' });
  const name = h('input', { type: 'text', ariaLabel: 'Skill name', placeholder: 'Skill name' });
  const when = h('input', { type: 'text', ariaLabel: 'Use when', placeholder: 'Use when I say (words, with commas): invoice, bill, kharcha' });
  const body = h('textarea', { rows: 3, ariaLabel: 'Skill instructions', placeholder: 'What should the AI know or do? For example: always reply in Hinglish, and save my invoices in D:\\Invoices' });
  const status = h('div', { class: 'error' });
  const load = () => call('store.get', 'skills', []);
  const add = async (skill) => {
    await call('store.set', 'skills', [...await load(), {
      name: skill.name, text: skill.text, description: skill.description, keywords: skill.keywords || [], mode: skill.mode || 'auto',
    }]);
    draw();
  };
  Promise.all([load(), call('skills.library')]).then(([skills, library]) => {
    summary.textContent = skillSummary(skills);
    list.replaceChildren(...skills.map((skill) => skillRow(skill, skills)));
    suggestions.replaceChildren(...library.map((item) => suggestionRow(item, skills, add)));
  });
  return [section('Skills (used by Chat and Agent)', summary, list,
    h('div', { class: 'col skill-form' }, name, when, body, status,
      h('div', { class: 'row' },
        h('button', {
          class: 'btn primary', type: 'button',
          onClick: () => {
            if (!name.value.trim() || !body.value.trim()) return;
            const keywords = when.value.split(',').map((word) => word.trim()).filter(Boolean);
            add({ name: name.value.trim(), text: body.value.trim(), keywords });
          },
        }, 'Add skill'),
        h('button', {
          class: 'btn', type: 'button',
          onClick: async () => {
            try {
              const skill = await call('skills.import');
              if (skill) await add(skill);
            } catch (err) {
              status.textContent = cleanError(err);
            }
          },
        }, 'Import .md or .txt')))), section('Ready-made skills', suggestions)];
}

async function privacyPage() {
  const entries = Object.entries(await call('privacy.list'));
  return [section('Clear data (immediately, cannot be undone)',
    entries.map(([key, name]) => h('div', { class: 'setting' },
      h('span', { class: 'grow' }, name),
      h('button', { class: 'btn', type: 'button', onClick: () => call('privacy.clear', key) }, 'Clear'))))];
}

function backupSection() {
  const status = h('div', { class: 'faint' });
  const run = (method, done) => async () => {
    status.textContent = '';
    try {
      if (await call(method)) status.textContent = done;
    } catch (err) {
      status.textContent = cleanError(err);
    }
  };
  return section('Backup',
    h('div', { class: 'setting' },
      h('span', { class: 'grow' }, 'Tasks, notes, links and settings in one file', h('div', { class: 'faint' }, 'API keys and clipboard history are not included')),
      h('button', { class: 'btn', type: 'button', onClick: run('backup.export', 'Backup saved') }, 'Export'),
      h('button', { class: 'btn', type: 'button', onClick: run('backup.import', 'Backup restored') }, 'Import')),
    status);
}

function resetButton() {
  let armed = false;
  const button = h('button', {
    class: 'btn',
    type: 'button',
    onClick: async () => {
      if (!armed) {
        armed = true;
        button.textContent = 'Click again to reset';
        return;
      }
      const { settings } = await call('settings.reset');
      state.settings = settings;
      emit('settings', settings);
      draw();
    },
  }, 'Reset all settings');
  return button;
}

function aboutPage() {
  return [
    backupSection(),
    section('Nook',
      h('div', { class: 'setting' },
        h('span', { class: 'grow' }, 'Put every setting back to its default', h('div', { class: 'faint' }, 'Removes calendar links. Tasks, notes and API keys stay.')),
        resetButton()),
      h('div', { class: 'setting' },
        h('span', { class: 'grow faint' }, 'All data stays on this PC in %APPDATA%\\Nook'),
        h('button', { class: 'btn', type: 'button', onClick: () => call('app.quit') }, icon('x', 15), 'Quit Nook'))),
  ];
}

const PAGES = [
  { id: 'general', title: 'General', icon: 'gear', color: '#9aa3b2', build: generalPage },
  { id: 'appearance', title: 'Look and size', icon: 'image', color: '#a78bfa', build: appearancePage },
  { id: 'closed', title: 'Closed notch', icon: 'pin', color: '#fb7185', build: closedPage },
  { id: 'alerts', title: 'Alerts', icon: 'bell', color: '#fbbf24', build: alertsPage },
  { id: 'pet', title: 'Pet', icon: 'heart', color: '#fb923c', build: petPage },
  { id: 'tools', title: 'Tools', icon: 'sliders', color: '#818cf8', build: toolsPage },
  { id: 'timers', title: 'Tasks and timers', icon: 'timer', color: '#f97362', build: timersPage },
  { id: 'health', title: 'Health', icon: 'heart', color: '#4ade80', build: healthPage },
  { id: 'calendar', title: 'Calendar', icon: 'calendar', color: '#f87171', build: calendarPage },
  { id: 'shelf', title: 'Shelf', icon: 'shelf', color: '#2dd4bf', build: shelfPage },
  { id: 'ai', title: 'AI', icon: 'spark', color: '#c084fc', build: aiPage },
  { id: 'privacy', title: 'Privacy', icon: 'lock', color: '#60a5fa', build: privacyPage },
  { id: 'about', title: 'About', icon: 'note', color: '#94a3b8', build: aboutPage },
];

function drawMenu(query) {
  menu.replaceChildren(...PAGES.map((item) => h('button', {
    class: `settings-link ${!query && item.id === page ? 'active' : ''}`,
    type: 'button',
    onClick: () => { page = item.id; search.value = ''; draw(); },
  }, h('span', { class: 'menu-tile', style: `--tool:${item.color}` }, icon(item.icon, 13)), item.title)));
}

async function drawSearch(query) {
  const groups = await Promise.all(PAGES.map((item) => item.build()));
  const sections = groups.flat();
  for (const block of sections) {
    let found = 0;
    for (const row of block.querySelectorAll('.setting')) {
      const match = row.textContent.toLowerCase().includes(query);
      row.hidden = !match;
      found += match ? 1 : 0;
    }
    block.hidden = !found;
  }
  const shown = sections.filter((block) => !block.hidden);
  content.replaceChildren(...(shown.length ? shown : [h('div', { class: 'empty' }, 'No setting matches that')]));
}

async function draw() {
  if (!content) return;
  const query = search.value.trim().toLowerCase();
  const top = content.scrollTop;
  drawMenu(query);
  if (query) await drawSearch(query);
  else content.replaceChildren(...await PAGES.find((item) => item.id === page).build());
  content.scrollTop = query ? 0 : top;
}

export default {
  id: 'settings',
  title: 'Settings',
  icon: 'gear',

  render(view) {
    search = h('input', { type: 'search', placeholder: 'Search settings', ariaLabel: 'Search settings', onInput: draw });
    menu = h('nav', { class: 'settings-menu scroll', ariaLabel: 'Settings pages' });
    content = h('div', { class: 'settings-content scroll' });
    view.append(h('div', { class: 'settings' }, h('div', { class: 'settings-side' }, search, menu), content));
    draw();
  },

  show: () => draw(),
};

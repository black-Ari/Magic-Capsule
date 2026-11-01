'use strict';

// What the agent can do on this PC. "risk" decides the permission: look runs freely during a task,
// act needs approval once or for the whole task, and always asks every single time. "sees" marks
// tools that show the AI what is on screen, and "hands" those that use the real mouse or keyboard.
const fs = require('fs');
const path = require('path');
const { desktopCapturer, screen, shell } = require('electron');
const { assertDeletable, editFile, searchFiles } = require('./agent-files');
const { runCommand } = require('./agent-shell');
const { webFetch, webSearch } = require('./agent-web');
const { uniquePath } = require('./shelf-path');

const MAX_SCREENSHOT_WIDTH = 1280;
const JPEG_QUALITY = 70;
const MAX_READ_BYTES = 256 * 1024;
const MAX_FOLDER_ITEMS = 200;
const SETTLE_MS = 450;
const UI_LIMIT = 200;
const UI_BUDGET_MS = 6000;
const UI_TIMEOUT_MS = 20000; // the first use also compiles the code, which is slow on a small PC
const NO_WAIT_TOOLS = new Set(['run_command', 'search_files', 'web_search', 'web_fetch', 'read_file', 'list_folder', 'list_windows', 'read_ui', 'browser_read', 'pc_status', 'pc_setting', 'search_history']);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const number = (description) => ({ type: 'number', description });
const string = (description) => ({ type: 'string', description });
const point = { x: number('Pixels from the left of the latest screenshot'), y: number('Pixels from the top of the latest screenshot') };
const windowName = string('Part of the window title, or its app name. Leave out for the window in front.');

const TOOLS = [
  { name: 'screenshot', risk: 'look', sees: true, description: 'See a screen as it is now. Use it when text tools cannot show what you need.', input: object({ screen: number('Which screen, 1 is the main one. Leave out for the main screen.') }) },
  { name: 'click', risk: 'act', hands: true, description: 'Click at a point on the screen in the latest screenshot.', input: object({ ...point, button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button, left if not given' }, double: { type: 'boolean', description: 'Double-click' } }, ['x', 'y']) },
  { name: 'drag', risk: 'act', hands: true, description: 'Press at one point, move to another and release.', input: object({ from_x: number('Start x'), from_y: number('Start y'), to_x: number('End x'), to_y: number('End y') }, ['from_x', 'from_y', 'to_x', 'to_y']) },
  { name: 'scroll', risk: 'act', hands: true, description: 'Scroll at a point.', input: object({ ...point, direction: { type: 'string', enum: ['up', 'down'] }, amount: number('Wheel notches, usually 3 to 10') }, ['x', 'y', 'direction', 'amount']) },
  { name: 'type_text', risk: 'act', hands: true, description: 'Type text into whatever has keyboard focus. Click the field first.', input: object({ text: string('The text to type') }, ['text']) },
  { name: 'press_keys', risk: 'act', hands: true, description: 'Press a key or combination such as enter, ctrl+s, alt+tab or win.', input: object({ keys: string('Keys joined by +') }, ['keys']) },
  { name: 'open_app', risk: 'act', description: 'Open an installed app by name from the Start menu.', input: object({ name: string('App name, such as Notepad') }, ['name']) },
  { name: 'open_url', risk: 'act', description: 'Open a web address in the default browser, for the person to use.', input: object({ url: string('Full http or https address') }, ['url']) },
  { name: 'list_windows', risk: 'look', sees: true, description: 'List the open windows, the one in front first.', input: object({}) },
  { name: 'focus_window', risk: 'act', description: 'Bring a window to the front.', input: object({ window: windowName }, ['window']) },
  { name: 'close_window', risk: 'act', description: 'Close a window, like pressing its X. It can still ask to save.', input: object({ window: windowName }, ['window']) },
  { name: 'read_ui', risk: 'look', sees: true, description: 'Read a window as text: its buttons, boxes, menus and lists, each with an id. Faster and more exact than a screenshot, so try this first for apps.', input: object({ window: windowName }) },
  { name: 'click_element', risk: 'act', hands: true, description: 'Click something by the id from the latest read_ui.', input: object({ id: number('The id from read_ui') }, ['id']) },
  { name: 'pc_status', risk: 'look', description: 'See the quick settings: Wi-Fi, Bluetooth, flight mode, dark mode, night light, do not disturb, camera, hotspot, power mode and saved VPNs.', input: object({}) },
  { name: 'pc_setting', risk: 'act', description: 'Change a quick setting, the way the person would in the Control tab. Turning off wifi or flight on cuts your own connection, so only do that when asked.', input: object({ setting: { type: 'string', enum: ['wifi', 'bluetooth', 'flight', 'dark', 'nightLight', 'quiet', 'camera', 'hotspot', 'vpn', 'power'] }, on: { type: 'boolean', description: 'On or off. For vpn, on connects and off disconnects.' }, name: string('For vpn, the saved VPN name. For power: saver, balanced or performance.') }, ['setting']) },
  { name: 'run_command', risk: 'always', description: 'Run a PowerShell script on this PC and get its output and exit code. Use it for anything a terminal can do, such as running programs, git, downloads, system information, and Excel or Word through COM. Nothing can type into it, so it cannot answer prompts.', input: object({ command: string('The PowerShell script'), folder: string('Folder to run in. Your home folder if not given.'), seconds: number('Time limit, 60 if not given, at most 600') }, ['command']) },
  { name: 'list_folder', risk: 'act', description: 'List what is inside a folder.', input: object({ path: string('Full folder path') }, ['path']) },
  { name: 'search_files', risk: 'act', description: 'Find files by name, by the text inside them, or both. Wildcards such as *.pdf work in the name.', input: object({ folder: string('Full folder path to search in'), name: string('Part of the file name, or a pattern'), text: string('Text to find inside files') }, ['folder']) },
  { name: 'read_file', risk: 'act', description: 'Read a text file.', input: object({ path: string('Full file path'), start: number('Character to start from, for long files') }, ['path']) },
  { name: 'save_file', risk: 'always', description: 'Save text as a new file. It never overwrites: a taken name gets a number.', input: object({ path: string('Full file path'), text: string('File contents') }, ['path', 'text']) },
  { name: 'edit_file', risk: 'always', description: 'Change an existing text file by replacing exact text. old_text must appear exactly once.', input: object({ path: string('Full file path'), old_text: string('The exact text to replace'), new_text: string('The text to put there') }, ['path', 'old_text', 'new_text']) },
  { name: 'delete_file', risk: 'always', description: 'Move a file or folder to the Recycle Bin.', input: object({ path: string('Full path') }, ['path']) },
  { name: 'web_search', risk: 'act', description: 'Search the web and get titles, links and short summaries.', input: object({ query: string('What to search for') }, ['query']) },
  { name: 'web_fetch', risk: 'act', description: 'Read a web page as plain text, without opening it.', input: object({ url: string('Full http or https address') }, ['url']) },
  { name: 'browser_open', risk: 'act', description: 'Open a page in your own browser window. Use this family of tools for websites you must click or type on. Sign-ins made there are kept for next time.', input: object({ url: string('Full http or https address') }, ['url']) },
  { name: 'browser_read', risk: 'act', description: 'Read the current page: its text, and everything usable with a number.', input: object({}) },
  { name: 'browser_click', risk: 'act', description: 'Click a numbered thing from the latest browser_read.', input: object({ ref: number('The number from browser_read') }, ['ref']) },
  { name: 'browser_type', risk: 'act', description: 'Fill a numbered box from the latest browser_read. It refuses password boxes.', input: object({ ref: number('The number from browser_read'), text: string('The text'), submit: { type: 'boolean', description: 'Press Enter afterwards' } }, ['ref', 'text']) },
  { name: 'wait', risk: 'look', description: 'Wait for something to finish loading.', input: object({ seconds: number('1 to 10') }, ['seconds']) },
  { name: 'update_plan', risk: 'look', description: 'Write down or update your plan for a job with several steps. It survives when older steps are forgotten.', input: object({ plan: string('The steps, with the done ones marked') }, ['plan']) },
  { name: 'remember', risk: 'always', description: 'Keep a lasting fact for future tasks and chats. Only use it when the person asks you to remember something.', input: object({ fact: string('One short fact') }, ['fact']) },
  { name: 'search_history', risk: 'look', description: 'Search the person\'s earlier chats and agent tasks on this PC, when they ask about something from before.', input: object({ query: string('A word or phrase to find') }, ['query']) },
  { name: 'use_skill', risk: 'look', description: 'Load one of the skills listed in your instructions when it fits the task.', input: object({ name: string('The exact skill name') }, ['name']) },
  { name: 'ask_user', risk: 'look', description: 'Ask the person a question and wait for the answer. Use it for passwords, payments and anything unclear.', input: object({ question: string('The question') }, ['question']) },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool]));

const clip = (text, size = 200) => {
  const value = String(text ?? '');
  return value.length > size ? `${value.slice(0, size)}...` : value;
};

function describe(name, input) {
  switch (name) {
    case 'click': return `${input.double ? 'Double-click' : 'Click'} at ${Math.round(input.x)}, ${Math.round(input.y)}`;
    case 'drag': return `Drag from ${Math.round(input.from_x)}, ${Math.round(input.from_y)} to ${Math.round(input.to_x)}, ${Math.round(input.to_y)}`;
    case 'scroll': return `Scroll ${input.direction}`;
    case 'type_text': return `Type: ${input.text}`;
    case 'press_keys': return `Press ${input.keys}`;
    case 'open_app': return `Open ${input.name}`;
    case 'open_url': return `Open ${input.url}`;
    case 'list_windows': return 'See the list of open windows';
    case 'focus_window': return `Bring "${input.window}" to the front`;
    case 'close_window': return `Close "${input.window}"`;
    case 'read_ui': return `Read ${input.window ? `"${input.window}"` : 'the window in front'}`;
    case 'click_element': return `Click item ${input.id} in the window`;
    case 'run_command': return `Run this command${input.folder ? ` in ${input.folder}` : ''}:\n${input.command}`; // always in full: this is what gets approved
    case 'list_folder': return `Look inside ${input.path}`;
    case 'search_files': return `Search ${input.folder} for ${[input.name, input.text].filter(Boolean).join(' and ')}`;
    case 'read_file': return `Read ${input.path}`;
    case 'save_file': return `Save a new file at ${input.path}`;
    case 'edit_file': return `Change ${input.path}\nFrom: ${clip(input.old_text)}\nTo: ${clip(input.new_text)}`;
    case 'delete_file': return `Move to the Recycle Bin: ${input.path}`;
    case 'web_search': return `Search the web for ${input.query}`;
    case 'web_fetch': return `Read ${input.url}`;
    case 'browser_open': return `Open ${input.url} in the agent's browser`;
    case 'browser_read': return 'Read the browser page';
    case 'browser_click': return `Click item ${input.ref} on the page`;
    case 'browser_type': return `Type on the page: ${input.text}`;
    case 'pc_status': return 'Check the quick settings';
    case 'pc_setting': return ['vpn', 'power'].includes(input.setting)
      ? `${input.setting === 'vpn' ? `${input.on === false ? 'Disconnect' : 'Connect'} VPN` : 'Set power mode to'} ${input.name}`
      : `Turn ${input.setting} ${input.on === false ? 'off' : 'on'}`;
    case 'remember': return `Remember: ${input.fact}`;
    case 'update_plan': return `Plan:\n${input.plan}`;
    default: return Object.keys(input || {}).length ? `${name}\n${clip(JSON.stringify(input), 600)}` : name;
  }
}

class ComputerTools {
  constructor({ helper, browser, ownWindows, home, pc, history }) {
    Object.assign(this, { helper, browser, ownWindows, home, pc, history });
    this.scale = 1;
    this.origin = { x: 0, y: 0 };
  }

  // The screenshot is smaller than the real screen, so its coordinates are scaled back up.
  real(x, y) {
    const values = [x, y];
    if (!values.every(Number.isFinite)) throw new Error('That needs a position on the screen');
    return [Math.round(x * this.scale) + this.origin.x, Math.round(y * this.scale) + this.origin.y];
  }

  displays() {
    const main = screen.getPrimaryDisplay();
    return [main, ...screen.getAllDisplays().filter((display) => display.id !== main.id)];
  }

  async screenshot({ screen: wanted = 1 } = {}) {
    const displays = this.displays();
    const display = displays[Number(wanted) - 1];
    if (!display) throw new Error(`This PC has ${displays.length} screen${displays.length > 1 ? 's' : ''}`);
    const width = Math.round(display.size.width * display.scaleFactor);
    const height = Math.round(display.size.height * display.scaleFactor);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const source = sources.find((item) => item.display_id === String(display.id)) || sources[0];
    if (!source) throw new Error('Could not capture the screen');
    const shotWidth = Math.min(MAX_SCREENSHOT_WIDTH, width);
    this.scale = width / shotWidth;
    this.origin = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y });
    const image = source.thumbnail.resize({ width: shotWidth });
    const others = displays.length > 1 ? ` Screen ${wanted} of ${displays.length}.` : '';
    return {
      text: `Screenshot ${shotWidth} x ${image.getSize().height} pixels.${others}`,
      image: { media: 'image/jpeg', data: image.toJPEG(JPEG_QUALITY).toString('base64') },
    };
  }

  async run(name, input, { signal } = {}) {
    if (name === 'screenshot') return this.screenshot(input);
    const result = await this.act(name, input, signal);
    if (!NO_WAIT_TOOLS.has(name)) await sleep(SETTLE_MS);
    return { text: result };
  }

  async windows() {
    const own = new Set(this.ownWindows());
    const list = await this.helper.call('windows.list', {}, UI_TIMEOUT_MS);
    return list.filter((item) => !own.has(String(item.handle)));
  }

  async findWindow(name) {
    const list = await this.windows();
    if (!name) {
      const front = list.find((item) => item.active && !item.minimized) || list.find((item) => !item.minimized);
      if (!front) throw new Error('No window is open');
      return front;
    }
    const wanted = String(name).toLowerCase();
    const match = list.find((item) => item.title.toLowerCase().includes(wanted)) || list.find((item) => item.app.toLowerCase().includes(wanted));
    if (!match) throw new Error(`No open window matches "${name}". Use list_windows.`);
    return match;
  }

  async readUi(name) {
    const target = await this.findWindow(name);
    const elements = await this.helper.call('ui.read', { handle: target.handle, limit: UI_LIMIT, budget: UI_BUDGET_MS }, UI_TIMEOUT_MS);
    if (!elements.length) return `"${target.title}" shows nothing readable. It may draw its own controls or run as administrator, so use a screenshot.`;
    const lines = elements.map((item) => `[${item.id}] ${item.type} "${item.name}"${item.value ? ` value "${item.value}"` : ''}${item.enabled ? '' : ' (disabled)'}`);
    return `Window "${target.title}" (${target.app})\n${lines.join('\n')}`;
  }

  async pcStatus() {
    const [state, vpns] = await Promise.all([this.pc.state(), this.pc.vpnList()]);
    const words = Object.entries(state).map(([key, value]) => `${key}: ${value === true ? 'on' : value === false ? 'off' : value ?? 'not available'}`);
    return `${words.join('\n')}\nSaved VPNs: ${vpns.map((vpn) => `${vpn.name.trim()}${vpn.connected ? ' (connected)' : ''}`).join(', ') || 'none'}`;
  }

  async pcSetting({ setting, on, name }) {
    if (setting === 'power') {
      await this.pc.setPowerMode(String(name));
      return `Power mode is ${name}.`;
    }
    if (setting === 'vpn') {
      const saved = this.pc.vpnNames().find((vpn) => vpn.trim().toLowerCase() === String(name).trim().toLowerCase());
      if (!saved) throw new Error(`No saved VPN is called ${name}`);
      await (on === false ? this.pc.vpnDisconnect(saved) : this.pc.vpnConnect(saved));
      return `VPN ${saved.trim()} is ${on === false ? 'disconnected' : 'connected'}.`;
    }
    await this.pc.set(setting, on !== false);
    return `${setting} is ${on === false ? 'off' : 'on'}.`;
  }

  async act(name, input, signal) {
    switch (name) {
      case 'click': {
        const [x, y] = this.real(input.x, input.y);
        await this.helper.call('input.click', { x, y, button: input.button || 'left', double: Boolean(input.double) });
        return 'Clicked.';
      }
      case 'drag': {
        const [fromX, fromY] = this.real(input.from_x, input.from_y);
        const [toX, toY] = this.real(input.to_x, input.to_y);
        await this.helper.call('input.drag', { fromX, fromY, toX, toY });
        return 'Dragged.';
      }
      case 'scroll': {
        const [x, y] = this.real(input.x, input.y);
        const notches = Math.max(1, Math.min(30, Math.round(input.amount) || 3));
        await this.helper.call('input.scroll', { x, y, notches: input.direction === 'up' ? notches : -notches });
        return 'Scrolled.';
      }
      case 'type_text':
        await this.helper.call('input.type', { text: String(input.text) });
        return 'Typed.';
      case 'press_keys':
        await this.helper.call('input.keys', { keys: String(input.keys) });
        return 'Pressed.';
      case 'open_app':
        return `Opened ${await this.helper.call('apps.open', { name: String(input.name) })}.`;
      case 'open_url':
        if (!/^https?:\/\//i.test(input.url)) throw new Error('Only http and https addresses can be opened');
        await shell.openExternal(input.url);
        return 'Opened in the browser.';
      case 'list_windows': {
        const list = await this.windows();
        return list.map((item) => `${item.active ? '(in front) ' : ''}${item.minimized ? '(minimized) ' : ''}"${item.title}" - ${item.app}`).join('\n') || 'No windows are open.';
      }
      case 'focus_window': {
        const target = await this.findWindow(input.window);
        const done = await this.helper.call('windows.focus', { handle: target.handle }, UI_TIMEOUT_MS);
        if (!done) throw new Error(`Windows would not bring "${target.title}" to the front`);
        return `"${target.title}" is in front.`;
      }
      case 'close_window': {
        const target = await this.findWindow(input.window);
        await this.helper.call('windows.close', { handle: target.handle }, UI_TIMEOUT_MS);
        return `Asked "${target.title}" to close.`;
      }
      case 'read_ui': return this.readUi(input.window);
      case 'click_element':
        await this.helper.call('ui.click', { element: Number(input.id) }, UI_TIMEOUT_MS);
        return 'Clicked.';
      case 'search_history': return this.history.search(input.query);
      case 'pc_status': return this.pcStatus();
      case 'pc_setting': return this.pcSetting(input);
      case 'run_command': return runCommand(input, signal);
      case 'list_folder': {
        const entries = fs.readdirSync(input.path, { withFileTypes: true }).slice(0, MAX_FOLDER_ITEMS);
        return entries.map((entry) => `${entry.isDirectory() ? '[folder] ' : ''}${entry.name}`).join('\n') || 'The folder is empty.';
      }
      case 'search_files': return searchFiles(input, signal);
      case 'read_file': {
        const { size } = fs.statSync(input.path);
        const start = Math.max(0, Number(input.start) || 0);
        if (size > MAX_READ_BYTES * 8) throw new Error('That file is too large to read here. Use run_command for parts of it.');
        return fs.readFileSync(input.path, 'utf8').slice(start, start + MAX_READ_BYTES);
      }
      case 'save_file': {
        const target = uniquePath(path.dirname(input.path), path.basename(input.path));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, String(input.text));
        return `Saved as ${target}.`;
      }
      case 'edit_file': return editFile(input);
      case 'delete_file':
        await shell.trashItem(assertDeletable(input.path, this.home));
        return 'Moved to the Recycle Bin.';
      case 'web_search': return webSearch(input, signal);
      case 'web_fetch': return webFetch(input, signal);
      case 'browser_open': return this.browser.open(input);
      case 'browser_read': return this.browser.read();
      case 'browser_click': return this.browser.click(input);
      case 'browser_type': return this.browser.type(input);
      case 'wait':
        await sleep(Math.max(1, Math.min(10, Number(input.seconds) || 1)) * 1000);
        return 'Waited.';
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

module.exports = { TOOLS, TOOL_BY_NAME, ComputerTools, describe };

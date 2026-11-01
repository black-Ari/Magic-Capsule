'use strict';

// One NotchWindow per chosen screen. Each keeps its own open state, tab and hiding, while saved data
// stays shared. The "leader" is the one window that runs reminders, so a chime sounds only once.
const { screen } = require('electron');
const { NotchWindow } = require('./notch-window');
const { describeDisplays, pickDisplays } = require('./display-layout');

const FOLLOW_MS = 250;

class NotchFleet {
  constructor({ getSettings, preload, page, onRendererGone }) {
    Object.assign(this, { getSettings, preload, page, onRendererGone });
    this.windows = new Map();
    this.current = null;
    for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) {
      screen.on(event, () => this.sync());
    }
    this.followTimer = setInterval(() => this.follow(), FOLLOW_MS);
    this.sync();
  }

  all() {
    return [...this.windows.values()];
  }

  each(action) {
    this.all().forEach(action);
  }

  cursorDisplay() {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  listDisplays() {
    return describeDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  }

  create(display) {
    const notch = new NotchWindow({
      display, getSettings: this.getSettings, preload: this.preload, page: this.page,
    });
    notch.win.webContents.on('render-process-gone', () => this.onRendererGone(notch));
    return notch;
  }

  // Works out which screens need a notch and makes it so, reusing windows wherever it can.
  sync() {
    const targets = pickDisplays(
      screen.getAllDisplays(), screen.getPrimaryDisplay().id, this.getSettings(), this.cursorDisplay().id,
    );
    const next = new Map();
    const spare = this.all().filter((notch) => !targets.some((display) => display.id === notch.display.id));
    for (const display of targets) {
      const existing = this.windows.get(display.id) || spare.shift();
      if (existing) existing.placeOn(display);
      next.set(display.id, existing || this.create(display));
    }
    for (const notch of spare) {
      if (this.current === notch) this.current = null;
      notch.destroy();
    }
    this.windows = next;
    this.chooseLeader();
  }

  chooseLeader() {
    const leader = this.windows.get(screen.getPrimaryDisplay().id) || this.all()[0];
    this.each((notch) => notch.setLeader(notch === leader));
  }

  leader() {
    return this.all().find((notch) => notch.isLeader) || this.all()[0];
  }

  // With "Follow the mouse" the one notch moves when it is closed.
  follow() {
    if (this.getSettings().displayMode !== 'follow') return;
    const [notch] = this.all();
    const display = this.cursorDisplay();
    if (notch && !notch.isOpen && notch.display.id !== display.id) this.sync();
  }

  underCursor() {
    return this.windows.get(this.cursorDisplay().id) || this.leader();
  }

  forSender(webContents) {
    return this.all().find((notch) => notch.win.webContents === webContents);
  }

  forHandle(handle) {
    return this.all().find((notch) => notch.handle === String(handle));
  }

  send(channel, payload) {
    this.each((notch) => notch.send(channel, payload));
  }

  sendExcept(owner, channel, payload) {
    this.each((notch) => { if (notch !== owner) notch.send(channel, payload); });
  }

  // Only the screen with the full-screen app steps aside.
  setFullscreen(active, point) {
    const display = active ? screen.getDisplayNearestPoint(screen.screenToDipPoint(point)) : null;
    this.each((notch) => notch.setFullscreen(Boolean(display) && notch.display.id === display.id));
  }

  destroy() {
    clearInterval(this.followTimer);
    this.each((notch) => notch.destroy());
  }
}

module.exports = { NotchFleet };

'use strict';

// The window is a transparent sheet at the top of the screen; the renderer animates the notch
// inside it. Hover comes from polling the cursor rather than DOM events, because the sheet is
// click-through most of the time and polling also keeps working during an OS file drag.
const { BrowserWindow, screen } = require('electron');
const { fitPanel, sheetFor, walkOffset } = require('./display-layout');

const TICK_MS = 50;
const LEAVE_DELAY_MS = 350;
const RESTORE_DELAY_MS = 60;
const OPEN_GRACE_MS = 400;
const TUCKED = { w: 120, h: 12 };
const HANDLE_DWELL_MS = 500;
const AUTO_HIDDEN_HEIGHT = 6;
const HIT_SLOP = { closedX: 12, closedY: 6, openX: 14, openY: 14 };
const PET_SLOP = 6; // a little beyond the avatar still counts as a click on it
const PET_NEAR = 60; // how close the mouse comes before a walking avatar stops and waits

class NotchWindow {
  constructor({ display, getSettings, preload, page }) {
    this.display = display;
    this.getSettings = getSettings;
    this.isLeader = false;
    this.isOpen = false;
    this.sticky = false; // opened by keyboard or typing in it: stays until blur, Esc or the shortcut
    this.pinned = false;
    this.tucked = false;
    this.interactive = false;
    this.pill = { w: 190, h: 32 };
    this.hoverSince = 0;
    this.outsideSince = 0;
    this.fullscreen = false;
    this.snoozeTimer = null;
    this.openedAt = 0;
    this.petWalk = { from: 0, to: 0, ms: 0, at: 0 };
    this.petNear = false;

    this.win = new BrowserWindow({
      ...this.sheetBounds(),
      type: 'toolbar', // keeps it out of Alt+Tab
      focusable: false, // until opened, or Windows gives it focus whenever another app closes
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      thickFrame: false,
      roundedCorners: false,
      resizable: false,
      movable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false, // timers and reminders run while the notch is closed
        autoplayPolicy: 'no-user-gesture-required', // reminder chimes
      },
    });

    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setIgnoreMouseEvents(true);
    this.win.setContentProtection(!getSettings().showInScreenshots);
    this.win.webContents.on('will-navigate', (event) => event.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.on('blur', () => {
      if (!this.isOpen || !this.sticky || this.pinned) return;
      // Making the window focusable drops focus for a moment while it opens, and on a busy PC that
      // moment can come late. With the mouse still on the notch, that is not you leaving.
      if (Date.now() - this.openedAt < OPEN_GRACE_MS) this.win.focus();
      else if (this.cursorInside()) this.sticky = false; // now closes when the mouse leaves
      else this.close();
    });
    this.win.loadFile(page);
    this.win.once('ready-to-show', () => {
      this.applyLayout(); // a window made for another screen's scale lands slightly off until placed again
      this.win.showInactive();
    });
    this.handle = this.win.getNativeWindowHandle().readBigInt64LE().toString();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  get mustHide() {
    return (this.fullscreen && this.getSettings().hideInFullscreen) || Boolean(this.snoozeTimer);
  }

  panel() {
    return fitPanel(this.display.bounds, this.getSettings());
  }

  sheetBounds() {
    return sheetFor(this.display.bounds, this.panel(), this.getSettings());
  }

  applyLayout() {
    this.win.setBounds(this.sheetBounds());
    this.win.setContentProtection(!this.getSettings().showInScreenshots);
    this.send('notch:panel', this.panel());
  }

  placeOn(display) {
    this.display = display;
    this.applyLayout();
  }

  setLeader(leader) {
    if (leader === this.isLeader) return;
    this.isLeader = leader;
    this.send('notch:leader', leader);
  }

  send(channel, payload) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  closedSize() {
    if (this.tucked) return TUCKED;
    return this.getSettings().autoHide ? { w: this.pill.w, h: AUTO_HIDDEN_HEIGHT } : this.pill;
  }

  cursorInside() {
    const { topGap } = this.getSettings();
    const panel = this.panel();
    const point = screen.getCursorScreenPoint();
    const bounds = this.win.getBounds();
    const dx = Math.abs(point.x - (bounds.x + bounds.width / 2));
    const dy = point.y - bounds.y;
    const closed = this.closedSize();
    const halfW = this.isOpen ? panel.w / 2 + HIT_SLOP.openX : closed.w / 2 + HIT_SLOP.closedX;
    const height = this.isOpen ? panel.h + HIT_SLOP.openY : closed.h + HIT_SLOP.closedY;
    return dx <= halfW && dy >= -2 && dy <= height + topGap;
  }

  cursorOverPet(margin = PET_SLOP) {
    const { pet, closedHeight, topGap, autoHide } = this.getSettings();
    if (!pet.on || this.isOpen || this.tucked || autoHide) return false;
    const point = screen.getCursorScreenPoint();
    const bounds = this.win.getBounds();
    const shift = { left: (pet.size - this.pill.w) / 2, right: (this.pill.w - pet.size) / 2, center: 0 }[pet.side] + walkOffset(this.petWalk, Date.now());
    const top = bounds.y + topGap + closedHeight - 2;
    return Math.abs(point.x - (bounds.x + bounds.width / 2 + shift)) <= pet.size / 2 + margin
      && point.y >= top - margin && point.y <= top + pet.size + margin;
  }

  // The pet walks under the notch, and the area that takes its clicks walks with it.
  setPetWalk({ from, to, ms }) {
    if (![from, to, ms].every(Number.isFinite)) return;
    this.petWalk = { from, to, ms, at: Date.now() };
  }

  tick() {
    if (this.win.isDestroyed() || !this.win.isVisible()) return;
    const inside = this.cursorInside();
    const overPet = this.cursorOverPet();
    const takesClicks = inside || overPet;
    const nearPet = this.cursorOverPet(PET_NEAR);
    if (nearPet !== this.petNear) {
      this.petNear = nearPet;
      this.send('pet:near', nearPet);
    }
    if (takesClicks !== this.interactive) {
      this.interactive = takesClicks;
      this.win.setIgnoreMouseEvents(!takesClicks);
    }

    const now = Date.now();
    if (!this.isOpen) {
      const { openOnHover, hoverDelay } = this.getSettings();
      // The top of the avatar overlaps the notch's hover area. Pointing at it is a click coming.
      if (!inside || overPet || (!openOnHover && !this.tucked)) { this.hoverSince = 0; return; }
      this.hoverSince ||= now;
      if (this.tucked) {
        if (now - this.hoverSince >= HANDLE_DWELL_MS) this.setTucked(false);
      } else if (now - this.hoverSince >= hoverDelay) {
        this.open('hover');
      }
      return;
    }

    if (inside || this.sticky || this.pinned) { this.outsideSince = 0; return; }
    this.outsideSince ||= now;
    if (now - this.outsideSince >= LEAVE_DELAY_MS) this.close();
  }

  setActivatable(activatable) {
    this.win.setFocusable(activatable);
    this.win.setSkipTaskbar(true); // setFocusable changes this as a side effect on Windows
  }

  open(reason, tab) {
    this.hoverSince = 0;
    this.outsideSince = 0;
    if (this.mustHide) this.win.showInactive();
    this.openedAt = Date.now();
    this.setActivatable(true);
    this.isOpen = true;
    this.sticky = reason === 'key';
    this.send('notch:state', { open: true, tab, pinned: this.pinned });
    if (this.sticky) {
      this.interactive = true;
      this.win.setIgnoreMouseEvents(false);
      this.win.focus();
    }
  }

  stick() {
    if (this.isOpen) this.sticky = true;
  }

  close() {
    if (!this.isOpen) return;
    const hadFocus = this.win.isFocused();
    this.isOpen = false;
    this.sticky = false;
    this.pinned = false;
    this.outsideSince = 0;
    this.send('notch:state', { open: false, pinned: false });
    if (this.mustHide) this.win.hide();
    if (hadFocus) this.releaseFocus();
    else this.setActivatable(false);
  }

  // Minimizing is what hands focus back to the app you were using. win.blur() activates the next
  // window in Z-order (usually the taskbar) and win.hide() leaves focus where it was.
  releaseFocus() {
    this.win.minimize();
    setTimeout(() => {
      if (this.isOpen || this.win.isDestroyed()) return;
      this.setActivatable(false);
      if (!this.mustHide) this.win.showInactive();
    }, RESTORE_DELAY_MS);
  }

  toggle(tab) {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.restore();
    this.open('key', tab);
  }

  // Undoes every way of hiding by hand.
  restore() {
    if (this.tucked) this.setTucked(false);
    if (this.snoozeTimer) this.wake();
  }

  // Windows can still put the closed notch in front when another app dies. Hand that focus back.
  foregroundIsOurs() {
    if (!this.isOpen && !this.win.isMinimized()) this.releaseFocus();
  }

  setPinned(pinned) {
    this.pinned = pinned;
    this.send('notch:state', { open: this.isOpen, pinned });
  }

  setPill(size) {
    this.pill = size;
  }

  setTucked(tucked) {
    this.tucked = tucked;
    this.hoverSince = 0;
    if (tucked) this.close();
    this.send('notch:tucked', tucked);
  }

  // Hides the notch for a while. Pressing the shortcut again brings it back early.
  toggleSnooze() {
    if (this.snoozeTimer) {
      this.wake();
      return;
    }
    this.close();
    this.snoozeTimer = setTimeout(() => this.wake(), this.getSettings().snoozeMinutes * 60000);
    this.win.hide();
  }

  wake() {
    clearTimeout(this.snoozeTimer);
    this.snoozeTimer = null;
    if (!this.mustHide) this.win.showInactive();
  }

  setFullscreen(active) {
    if (active === this.fullscreen) return;
    this.fullscreen = active;
    if (this.mustHide && !this.isOpen) this.win.hide();
    else if (!this.mustHide) this.win.showInactive();
  }

  destroy() {
    clearInterval(this.timer);
    clearTimeout(this.snoozeTimer);
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}

module.exports = { NotchWindow };

'use strict';

const store = require('./store');

const KEEP_DAYS = 14;
const SAVE_EVERY_S = 30;

function dayKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

class ScreenTime {
  constructor() {
    this.last = Date.now();
    this.unsaved = 0;
  }

  // Only the app name is kept. Window titles are never read.
  record({ app, idle }, idleLimit) {
    const now = Date.now();
    const seconds = Math.min(5, (now - this.last) / 1000);
    this.last = now;
    if (!app || idle >= idleLimit) return;

    const days = store.get('screentime', {});
    const today = dayKey();
    days[today] ||= {};
    days[today][app] = (days[today][app] || 0) + seconds;
    this.unsaved += seconds;
    if (this.unsaved < SAVE_EVERY_S) return;

    this.unsaved = 0;
    for (const key of Object.keys(days).sort().slice(0, -KEEP_DAYS)) delete days[key];
    store.set('screentime', days);
  }

  summary() {
    return { days: store.get('screentime', {}), today: dayKey() };
  }
}

module.exports = { ScreenTime };

'use strict';

// The Control tab and the agent's pc_setting tool share this. Every name that reaches Windows comes
// from a list here, so a page or a model can only ask for what is listed.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SLOW_MS = 30000;
const VPN_MS = 60000;
const SHUTDOWN_SECONDS = '20'; // time to change your mind, with a Cancel button

const POWER_MODES = {
  saver: '961cc777-2547-4f9d-8174-7d86181b8a7a',
  balanced: '00000000-0000-0000-0000-000000000000',
  performance: 'ded574b5-45a0-4f42-8737-46345c09c238',
};
const DISPLAY_MODES = { internal: '/internal', clone: '/clone', extend: '/extend', external: '/external' };
const TOGGLES = ['wifi', 'bluetooth', 'dark', 'nightLight', 'quiet', 'camera', 'hotspot'];
const PAGES = {
  settings: 'ms-settings:', wifi: 'ms-settings:network-wifi', vpn: 'ms-settings:network-vpn', hotspot: 'ms-settings:network-mobilehotspot',
  bluetooth: 'ms-settings:bluetooth', display: 'ms-settings:display', sound: 'ms-settings:sound', nightLight: 'ms-settings:nightlight',
  notifications: 'ms-settings:notifications', power: 'ms-settings:powersleep', storage: 'ms-settings:storagesense', apps: 'ms-settings:appsfeatures',
  update: 'ms-settings:windowsupdate', location: 'ms-settings:privacy-location', camera: 'ms-settings:privacy-webcam', snip: 'ms-screenclip:',
};
const PROGRAMS = { taskManager: 'Taskmgr.exe', controlPanel: 'control.exe' };

const run = (file, args, timeout = SLOW_MS) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }));
});

const parsePhonebook = (text) => [...text.matchAll(/^\[(.+)\]\s*$/gm)].map((match) => match[1]);

// rasdial speaks the language of Windows, so its lines are matched against known names only.
function connectedNames(text, names) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return names.filter((name) => lines.includes(name.trim()));
}

class PcControl {
  constructor({ helper, shell, env = process.env }) {
    Object.assign(this, { helper, shell, env });
  }

  async state() {
    const { powerOverlay, ...state } = await this.helper.call('control.state', {}, SLOW_MS);
    const power = Object.keys(POWER_MODES).find((mode) => POWER_MODES[mode] === powerOverlay) || 'balanced';
    return { ...state, power, flight: state.wifi === false && state.bluetooth !== true };
  }

  async set(name, on) {
    if (name === 'flight') {
      for (const radio of ['wifi', 'bluetooth']) await this.helper.call('control.set', { name: radio, on: !on }, SLOW_MS);
      return;
    }
    if (!TOGGLES.includes(name)) throw new Error(`Unknown setting: ${name}`);
    await this.helper.call('control.set', { name, on: Boolean(on) }, SLOW_MS);
  }

  vpnNames() {
    const books = [path.join(this.env.APPDATA || '', 'Microsoft', 'Network', 'Connections', 'Pbk', 'rasphone.pbk'),
      path.join(this.env.ProgramData || '', 'Microsoft', 'Network', 'Connections', 'Pbk', 'rasphone.pbk')];
    const names = books.flatMap((book) => { try { return parsePhonebook(fs.readFileSync(book, 'utf8')); } catch { return []; } });
    return [...new Set(names)];
  }

  async vpnList() {
    const names = this.vpnNames();
    const { out } = await run('rasdial', []);
    const connected = connectedNames(out, names);
    return names.map((name) => ({ name, connected: connected.includes(name) }));
  }

  assertVpn(name) {
    if (!this.vpnNames().includes(name)) throw new Error(`No saved VPN is called ${name}`);
  }

  async vpnConnect(name) {
    this.assertVpn(name);
    const { ok, out } = await run('rasdial', [name], VPN_MS);
    if (!ok) throw new Error(out.split(/\r?\n/).find((line) => /\d{3}/.test(line)) || 'The VPN did not connect. Check it in Windows Settings.');
  }

  async vpnDisconnect(name) {
    this.assertVpn(name);
    const { ok, out } = await run('rasdial', [name, '/disconnect']);
    if (!ok) throw new Error(out || 'The VPN did not disconnect');
  }

  async setPowerMode(mode) {
    if (!Object.hasOwn(POWER_MODES, mode)) throw new Error(`Unknown power mode: ${mode}`);
    const { ok, out } = await run('powercfg', ['/overlaysetactive', POWER_MODES[mode]]);
    if (!ok) throw new Error(out || 'Windows would not change the power mode');
  }

  async setDisplayMode(mode) {
    if (!Object.hasOwn(DISPLAY_MODES, mode)) throw new Error(`Unknown screen mode: ${mode}`);
    await run('DisplaySwitch.exe', [DISPLAY_MODES[mode]]);
  }

  bluetoothDevices() {
    return this.helper.call('control.bluetooth', {}, SLOW_MS);
  }

  outputs() {
    return this.helper.call('control.outputs', {}, SLOW_MS);
  }

  setOutput(id) {
    return this.helper.call('control.output', { device: String(id) }, SLOW_MS);
  }

  async action(name) {
    switch (name) {
      case 'lock': return run('rundll32.exe', ['user32.dll,LockWorkStation']).then(() => true);
      case 'sleep': return this.helper.call('control.sleep', {}, SLOW_MS).catch(() => true); // the reply arrives after waking up
      case 'screenOff': return this.helper.call('control.screenOff');
      case 'emptyBin': return this.helper.call('control.emptyBin', {}, SLOW_MS);
      case 'signOut': return run('shutdown.exe', ['/l']).then(() => true);
      case 'restart': return run('shutdown.exe', ['/r', '/t', SHUTDOWN_SECONDS]).then(() => true);
      case 'shutDown': return run('shutdown.exe', ['/s', '/t', SHUTDOWN_SECONDS]).then(() => true);
      case 'cancelShutdown': return run('shutdown.exe', ['/a']).then(() => true);
      default: throw new Error(`Unknown action: ${name}`);
    }
  }

  open(name) {
    if (Object.hasOwn(PAGES, name)) return this.shell.openExternal(PAGES[name]);
    if (Object.hasOwn(PROGRAMS, name)) return run('cmd.exe', ['/c', 'start', '', PROGRAMS[name]]).then(() => true);
    throw new Error(`Unknown page: ${name}`);
  }
}

module.exports = {
  POWER_MODES, TOGGLES, PcControl, connectedNames, parsePhonebook,
};

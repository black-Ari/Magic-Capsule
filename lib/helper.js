'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Neither PowerShell nor Windows can run a file from inside app.asar.
const unpacked = (name) => path.join(__dirname, name).replace('app.asar', 'app.asar.unpacked');
const SERVICE = unpacked('helper-service.exe');
const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', unpacked('helper.ps1')];
const CALL_TIMEOUT_MS = 8000;
const MAX_RESTARTS = 5;
const SERVICE_TRIES = 2; // then PowerShell takes over, slower but able to do everything
const RESTART_DELAY_MS = 2000;
const WAKE_TIMEOUT_MS = 30000; // starting PowerShell on a busy PC can take many seconds
const REST_AFTER_MS = 180000;

// The always-running program answers these. PowerShell costs about 50 MB, so it starts only for the
// other commands and stops when they go quiet.
const SERVICE_COMMANDS = new Set([
  'media', 'media.refresh', 'locks.get', 'volume.get', 'volume.set', 'volume.step', 'volume.mute',
  'mic.get', 'mic.set', 'net.totals',
]);

// One running process that speaks JSON lines.
class Link {
  constructor(file, args, onEvent, onEnd) {
    this.nextId = 1;
    this.pending = new Map();
    this.onEvent = onEvent;
    this.onEnd = onEnd;
    this.lastError = '';
    this.proc = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this.onLine(line));
    this.proc.stderr.on('data', (chunk) => { this.lastError = chunk.toString().slice(0, 500); });
    this.proc.stdin.on('error', () => {}); // writing to a dead process: the end below reports it
    this.proc.on('error', (err) => {
      this.lastError = err.message;
      this.end(); // a process that could not start never sends 'exit'
    });
    this.proc.on('exit', () => this.end());
  }

  onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.event) {
      this.onEvent(message.event, message.data);
      return;
    }
    const call = this.pending.get(message.id);
    if (!call) return;
    this.pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.ok) call.resolve(message.data);
    else call.reject(new Error(message.error));
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('Windows helper stopped'));
    }
    this.pending.clear();
    this.onEnd(this.lastError);
  }

  call(cmd, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (this.ended || !this.proc.stdin.writable) {
        reject(new Error('Windows helper is not running'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${cmd} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ ...args, id, cmd })}\n`);
    });
  }

  stop() {
    this.proc.stdin.end();
  }
}

class Helper extends EventEmitter {
  constructor({ service = SERVICE } = {}) {
    super();
    this.service = service;
    this.useService = fs.existsSync(service);
    this.restarts = 0;
    this.stopping = false;
    this.busy = 0;
    this.waking = null;
  }

  start() {
    const [file, args] = this.useService ? [this.service, []] : ['powershell.exe', POWERSHELL];
    try {
      this.main = new Link(file, args, (event, data) => {
        if (event === 'ready') this.restarts = 0;
        this.emit(event, data);
      }, (reason) => this.onExit(reason));
    } catch (err) {
      this.onExit(err.message); // Windows refused the file outright
    }
  }

  onExit(reason) {
    this.main = null;
    if (this.stopping) return;
    if (this.useService && this.restarts + 1 >= SERVICE_TRIES) {
      this.useService = false;
      this.restarts = 0;
    }
    if (this.restarts++ < MAX_RESTARTS) {
      setTimeout(() => { if (!this.stopping) this.start(); }, RESTART_DELAY_MS);
    } else {
      this.emit('failed', reason);
    }
  }

  call(cmd, args = {}, timeoutMs = CALL_TIMEOUT_MS) {
    if (this.useService && !SERVICE_COMMANDS.has(cmd)) return this.callPowerShell(cmd, args, timeoutMs);
    if (!this.main) return Promise.reject(new Error('Windows helper is not running'));
    return this.main.call(cmd, args, timeoutMs);
  }

  async callPowerShell(cmd, args, timeoutMs) {
    clearTimeout(this.restTimer);
    this.busy += 1;
    try {
      const link = await this.wakePowerShell();
      return await link.call(cmd, args, timeoutMs);
    } finally {
      this.busy -= 1;
      if (this.busy === 0 && !this.stopping) this.restTimer = setTimeout(() => this.restPowerShell(), REST_AFTER_MS).unref();
    }
  }

  wakePowerShell() {
    if (this.waking) return this.waking;
    const waking = new Promise((resolve, reject) => {
      const link = new Link('powershell.exe', [...POWERSHELL, '-OnDemand'], (event) => {
        if (event !== 'ready') return;
        clearTimeout(timer);
        resolve(link);
      }, (reason) => {
        clearTimeout(timer);
        if (this.waking === waking) this.waking = null;
        reject(new Error(reason || 'Windows helper stopped'));
      });
      const timer = setTimeout(() => {
        link.proc.kill();
        reject(new Error('PowerShell took too long to start'));
      }, WAKE_TIMEOUT_MS);
    });
    this.waking = waking;
    return waking;
  }

  restPowerShell() {
    const { waking } = this;
    this.waking = null;
    if (waking) waking.then((link) => link.stop()).catch(() => {});
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.restTimer);
    if (this.main) this.main.stop();
    this.restPowerShell();
  }
}

module.exports = { Helper };

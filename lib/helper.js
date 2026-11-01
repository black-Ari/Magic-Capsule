'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const readline = require('readline');

// PowerShell cannot execute a script from inside app.asar.
const SCRIPT = path.join(__dirname, 'helper.ps1').replace('app.asar', 'app.asar.unpacked');
const CALL_TIMEOUT_MS = 8000;
const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 2000;

class Helper extends EventEmitter {
  constructor() {
    super();
    this.nextId = 1;
    this.pending = new Map();
    this.restarts = 0;
    this.stopping = false;
    this.lastError = '';
  }

  start() {
    this.proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this.onLine(line));
    this.proc.stderr.on('data', (chunk) => { this.lastError = chunk.toString().slice(0, 500); });
    this.proc.on('error', (err) => { this.lastError = err.message; });
    this.proc.on('exit', () => this.onExit());
  }

  onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.event) {
      if (message.event === 'ready') this.restarts = 0;
      this.emit(message.event, message.data);
      return;
    }
    const call = this.pending.get(message.id);
    if (!call) return;
    this.pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.ok) call.resolve(message.data);
    else call.reject(new Error(message.error));
  }

  onExit() {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('Windows helper stopped'));
    }
    this.pending.clear();
    if (this.stopping) return;
    if (this.restarts++ < MAX_RESTARTS) {
      setTimeout(() => this.start(), RESTART_DELAY_MS);
    } else {
      this.emit('failed', this.lastError);
    }
  }

  call(cmd, args = {}, timeoutMs = CALL_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) {
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
    this.stopping = true;
    if (this.proc) this.proc.stdin.end();
  }
}

module.exports = { Helper };

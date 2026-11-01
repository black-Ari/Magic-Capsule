'use strict';

// Runs one PowerShell script for the agent, with a time limit and a cap on what comes back.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_SECONDS = 60;
const MAX_SECONDS = 600;
const KEEP_START = 20000;
const KEEP_END = 10000;
const DRAIN_MS = 300; // a program left running in the background can hold the output open for ever

const SETUP = "$ProgressPreference='SilentlyContinue'\n[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)\n";
const FINISH = '\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }';

const killTree = (pid) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});

class Output {
  constructor() {
    this.head = '';
    this.tail = '';
    this.dropped = 0;
  }

  add(text) {
    const room = KEEP_START - this.head.length;
    this.head += text.slice(0, Math.max(0, room));
    const rest = text.slice(Math.max(0, room));
    if (!rest) return;
    this.tail += rest;
    if (this.tail.length > KEEP_END) {
      this.dropped += this.tail.length - KEEP_END;
      this.tail = this.tail.slice(-KEEP_END);
    }
  }

  text() {
    return this.dropped ? `${this.head}\n[${this.dropped} characters cut]\n${this.tail}` : this.head + this.tail;
  }
}

function runCommand({ command, folder, seconds }, signal) {
  if (!String(command || '').trim()) throw new Error('No command was given');
  if (folder && !fs.statSync(folder).isDirectory()) throw new Error('That is not a folder');
  const limit = Math.max(1, Math.min(MAX_SECONDS, Number(seconds) || DEFAULT_SECONDS));
  const script = path.join(os.tmpdir(), `nook-agent-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(script, `﻿${SETUP}${command}${FINISH}`); // the mark lets PowerShell 5.1 read Unicode

  return new Promise((resolve) => {
    const output = new Output();
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-File', script,
    ], { cwd: folder || os.homedir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8').on('data', (text) => output.add(text));
    child.stderr.setEncoding('utf8').on('data', (text) => output.add(text));

    let reason = '';
    const stop = (why) => { reason = why; killTree(child.pid); };
    const onAbort = () => stop('Stopped by the person.');
    const timer = setTimeout(() => stop(`Stopped after ${limit} seconds. Give it more time with seconds, or run it in the background.`), limit * 1000);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fs.rmSync(script, { force: true });
      resolve(`${reason || `Exit code ${code}`}\n${output.text().trim() || '(no output)'}`);
    };
    child.on('error', (err) => { output.add(err.message); finish(-1); });
    child.on('exit', (code) => setTimeout(() => finish(code), DRAIN_MS));
  });
}

module.exports = { runCommand };

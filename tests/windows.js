'use strict';

// The agent's real Windows and browser tools. Opens a small test window and a browser window, but
// never moves the mouse or presses keys on your desktop. Usage: node tests/windows.js
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  return request === 'electron' ? {} : originalLoad.call(this, request, ...rest);
};

const { Browser } = require('../lib/agent-browser');
const { ComputerTools } = require('../lib/agent-tools');
const { Helper } = require('../lib/helper');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const TITLE = 'NookWindowsProbe';
const PROBE = `
  Add-Type -AssemblyName System.Windows.Forms
  $form = New-Object System.Windows.Forms.Form
  $form.Text = '${TITLE}'; $form.StartPosition = 'Manual'; $form.Width = 380; $form.Height = 220
  $form.Location = New-Object System.Drawing.Point(30, 300)
  $button = New-Object System.Windows.Forms.Button; $button.Text = 'Save report'; $button.Top = 10; $button.Left = 10; $button.Width = 120
  $box = New-Object System.Windows.Forms.TextBox; $box.Text = 'Visible text'; $box.Top = 50; $box.Left = 10; $box.Width = 200; $box.Name = 'Amount'
  $secret = New-Object System.Windows.Forms.TextBox; $secret.Text = 'hunter2'; $secret.UseSystemPasswordChar = $true; $secret.Top = 90; $secret.Left = 10; $secret.Width = 200
  $form.Controls.AddRange(@($button, $box, $secret))
  [void]$form.ShowDialog()`;

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`ok    ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').slice(0, 10).join('\n      ')}`);
  }
}

async function ready(helper) {
  await new Promise((resolve, reject) => {
    helper.once('ready', resolve);
    helper.once('failed', reject);
    helper.start();
  });
}

(async () => {
  const helper = new Helper();
  await ready(helper);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-windows-'));
  const browser = new Browser({ dataDir: folder });
  const tools = new ComputerTools({ helper, browser, ownWindows: () => [], home: os.homedir() });
  const act = (name, input = {}) => tools.act(name, input);
  const probe = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', PROBE], { stdio: 'ignore' });

  await step('list_windows finds the window, the first call compiles in time', async () => {
    const start = Date.now();
    let list = '';
    for (let i = 0; i < 40 && !list.includes(TITLE); i += 1) {
      list = await act('list_windows');
      if (!list.includes(TITLE)) await sleep(400);
    }
    assert.ok(list.includes(TITLE), list);
    console.log(`      took ${Date.now() - start} ms`);
  });

  await step('read_ui reads buttons and boxes, and never a password', async () => {
    const start = Date.now();
    const text = await act('read_ui', { window: TITLE });
    console.log(`      took ${Date.now() - start} ms\n      ${text.replace(/\n/g, '\n      ')}`);
    assert.match(text, /\[\d+\] Button "Save report"/);
    assert.match(text, /value "Visible text"/);
    assert.ok(!text.includes('hunter2'), 'the password box was read');
  });

  await step('focus_window brings it to the front', async () => {
    assert.match(await act('focus_window', { window: TITLE }), /is in front/);
    assert.ok((await act('list_windows')).split('\n')[0].startsWith(`(in front) "${TITLE}"`));
  });

  await step('a window that is not there gives a clear message', async () => {
    await assert.rejects(act('read_ui', { window: 'no window has this name' }), /No open window matches/);
  });

  await step('close_window closes it', async () => {
    await act('close_window', { window: TITLE });
    for (let i = 0; i < 20 && probe.exitCode === null; i += 1) await sleep(200);
    assert.notEqual(probe.exitCode, null, 'the window stayed open');
  });

  const site = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url.startsWith('/done')) res.end(`<title>Done</title><p>You sent ${new URL(req.url, 'http://x').searchParams.get('q')}</p>`);
    else res.end('<title>Test page</title><p>Welcome here</p><form action="/done"><input name="q" placeholder="Your name"><input type="password" name="p"><button>Send</button></form><a href="/done?q=link">Go there</a><button style="display:none">Hidden</button>');
  });
  await new Promise((resolve) => { site.listen(0, '127.0.0.1', resolve); });
  const root = `http://127.0.0.1:${site.address().port}`;
  const refOf = (text, words) => new RegExp(`\\[(\\d+)\\] [^\\n]*${words}`).exec(text)?.[1];

  await step('browser: opens with Chrome or Edge, reads text and numbers what can be used', async () => {
    assert.match(await act('browser_open', { url: `${root}/` }), /^Opened/);
    const text = await act('browser_read');
    assert.match(text, /Test page[\s\S]*Welcome here/);
    assert.ok(refOf(text, 'Your name') && refOf(text, 'Go there'));
    assert.ok(!text.includes('Hidden'));
  });

  await step('browser: refuses to type a password', async () => {
    const text = await act('browser_read');
    await assert.rejects(act('browser_type', { ref: refOf(text, 'password box'), text: 'secret' }), /Never type passwords/);
  });

  await step('browser: types, sends and reads the next page', async () => {
    const text = await act('browser_read');
    await act('browser_type', { ref: refOf(text, 'Your name'), text: 'Asha', submit: true });
    await sleep(500);
    assert.match(await act('browser_read'), /You sent Asha/);
  });

  await step('browser: clicks a link', async () => {
    await act('browser_open', { url: `${root}/` });
    const text = await act('browser_read');
    await act('browser_click', { ref: refOf(text, 'Go there') });
    await sleep(300);
    assert.match(await act('browser_read'), /You sent link/);
  });

  await step('browser: only web addresses open', async () => {
    await assert.rejects(act('browser_open', { url: 'file:///C:/Windows/win.ini' }), /Only http/);
  });

  await browser.close();
  site.close();
  probe.kill();
  helper.stop();
  await sleep(500);
  fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

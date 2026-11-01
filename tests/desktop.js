'use strict';

// Real-desktop checks: moves the actual mouse, presses real keys, and briefly shows a full-screen
// window, so do not use the PC while it runs. Usage: node tests/desktop.js <screenshot folder>
const assert = require('assert');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const dep = require('../lib/deps');

const { _electron: electron } = dep('playwright-core');
const WORKSPACE = path.join(os.homedir(), '.build_workspaces', 'poni');
const PROJECT = path.join(__dirname, '..');
const shots = process.argv[2] || path.join(os.tmpdir(), 'nook-desktop');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Screen coordinates here are physical pixels, the app works in DIPs.
const NATIVE = `
using System; using System.Runtime.InteropServices;
public static class T {
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(P p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
  public static IntPtr RootAt(int x, int y) { P p = new P(); p.X = x; p.Y = y; return GetAncestor(WindowFromPoint(p), 2); }
  public static string TitleOf(IntPtr h) { var s = new System.Text.StringBuilder(128); GetWindowText(h, s, 128); return s.ToString(); }
  public static string TitleAt(int x, int y) { return TitleOf(RootAt(x, y)); }
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  public static void Key(byte k) { keybd_event(k, 0, 0, UIntPtr.Zero); keybd_event(k, 0, 2, UIntPtr.Zero); }
  public static void Chord3(byte a, byte b, byte c) { keybd_event(a,0,0,UIntPtr.Zero); keybd_event(b,0,0,UIntPtr.Zero); Key(c); keybd_event(b,0,2,UIntPtr.Zero); keybd_event(a,0,2,UIntPtr.Zero); }
  public static void Chord(byte a, byte b) { keybd_event(a,0,0,UIntPtr.Zero); keybd_event(b,0,0,UIntPtr.Zero); keybd_event(b,0,2,UIntPtr.Zero); keybd_event(a,0,2,UIntPtr.Zero); }
}`;

function native(body) {
  const script = `$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${NATIVE}\n'@\n[void][T]::SetProcessDPIAware()\n${body}`;
  const file = path.join(os.tmpdir(), `nook-native-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(file, script);
  try {
    // A visible console would take the foreground and skew every focus check.
    return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', windowsHide: true }).trim();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const moveTo = (x, y) => native(`[void][T]::SetCursorPos(${x}, ${y})`);
const windowAt = (x, y) => native(`[T]::RootAt(${x}, ${y}).ToInt64()`);
const titleAt = (x, y) => native(`[T]::TitleAt(${x}, ${y})`);
const foreground = () => native('[T]::GetForegroundWindow().ToInt64()');

const results = [];
async function step(name, fn) {
  try {
    const note = await fn();
    results.push(true);
    console.log(`ok    ${name}${note ? ` (${note})` : ''}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}

(async () => {
  require('./guard')();
  fs.mkdirSync(shots, { recursive: true });
  const original = native('$p = New-Object T+P; [void][T]::GetCursorPos([ref]$p); "$($p.X),$($p.Y)"').split(',').map(Number);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-desktop-'));
  const app = await electron.launch({
    executablePath: path.join(WORKSPACE, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [PROJECT],
    env: { ...process.env, NOOK_USER_DATA: userData },
  });
  let page = await app.firstWindow();
  await page.waitForSelector('#pill .pill-text', { timeout: 15000 });
  await sleep(1500);

  const call = (method, ...args) => page.evaluate(([m, a]) => window.nook.call(m, ...a), [method, args]);
  await call('settings.set', { pet: { ...(await call('settings.get')).settings.pet, walk: false, play: false } }); // a moving target would make real clicks a guess
  const isOpen = () => page.evaluate(() => document.getElementById('notch').classList.contains('open'));
  const waitFor = async (want, timeout, what) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await isOpen() === want) return Date.now() - start;
      await sleep(25);
    }
    throw new Error(`notch never became ${what}`);
  };

  const geometry = await app.evaluate(({ BrowserWindow, screen }) => {
    global.notchWindow = BrowserWindow.getAllWindows()[0];
    const display = screen.getPrimaryDisplay();
    return { hwnd: global.notchWindow.getNativeWindowHandle().readBigInt64LE().toString(), scale: display.scaleFactor, width: display.bounds.width, height: display.bounds.height };
  });
  const px = (dip) => Math.round(dip * geometry.scale);
  const centerX = px(geometry.width / 2);
  const away = [px(geometry.width / 2), px(geometry.height - 120)];
  console.log(`display ${geometry.width}x${geometry.height} DIP at ${geometry.scale * 100}%`);

  await step('closed notch does not block the desktop', async () => {
    moveTo(...away);
    await sleep(300);
    assert.notEqual(windowAt(centerX, px(200)), geometry.hwnd, 'transparent sheet caught the mouse');
    assert.notEqual(windowAt(px(geometry.width / 2 + 300), px(10)), geometry.hwnd);
  });

  await step('moving to the top edge opens it', async () => {
    moveTo(centerX, 2);
    return `${await waitFor(true, 1500, 'open')} ms`;
  });

  const cursorIsAt = async (x, y) => {
    const point = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    assert.ok(Math.abs(px(point.x) - x) < 8 && Math.abs(px(point.y) - y) < 8, `the mouse was moved by hand during the test (${point.x},${point.y})`);
  };

  await step('stays open while the mouse is inside the panel', async () => {
    moveTo(centerX, px(300));
    await sleep(900);
    await cursorIsAt(centerX, px(300));
    assert.equal(await isOpen(), true);
    assert.equal(windowAt(centerX, px(300)), geometry.hwnd, 'panel should take clicks');
  });

  await step('leaving closes it', async () => {
    moveTo(...away);
    return `${await waitFor(false, 1500, 'closed')} ms`;
  });

  await step('after closing, the area is click-through again', async () => {
    await sleep(200);
    assert.notEqual(windowAt(centerX, px(300)), geometry.hwnd);
  });

  await step('Alt+N opens with keyboard focus, Esc closes and gives focus back', async () => {
    const probe = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
      Add-Type -AssemblyName System.Windows.Forms
      $form = New-Object System.Windows.Forms.Form
      $form.Text = 'NookFocusProbe'; $form.StartPosition = 'Manual'
      $form.Location = New-Object System.Drawing.Point(20, 500); $form.Size = New-Object System.Drawing.Size(220, 120)
      [void]$form.ShowDialog()`], { stdio: 'ignore' });
    const foregroundTitle = () => native('[T]::TitleOf([T]::GetForegroundWindow())');
    try {
      let title = '';
      for (let i = 0; i < 40 && title !== 'NookFocusProbe'; i += 1) {
        await sleep(250);
        title = foregroundTitle();
      }
      assert.equal(title, 'NookFocusProbe', 'probe window never reached the foreground');
      native('[T]::Chord(0x12, 0x4E)');
      await waitFor(true, 1500, 'open');
      await sleep(300);
      assert.equal(await app.evaluate(() => global.notchWindow.isFocused()), true);
      await sleep(600);
      assert.equal(await isOpen(), true, 'keyboard open must not auto-close while the mouse is away');
      native('[T]::Key(0x1B)');
      await waitFor(false, 1500, 'closed');
      await sleep(400);
      assert.equal(foregroundTitle(), 'NookFocusProbe');
      const state = await app.evaluate(() => ({ visible: global.notchWindow.isVisible(), minimized: global.notchWindow.isMinimized(), top: global.notchWindow.isAlwaysOnTop() }));
      assert.deepEqual(state, { visible: true, minimized: false, top: true }, 'the pill must come straight back');
      native('[T]::Chord(0x12, 0x73)'); // Alt+F4, the way an app is really closed
      await sleep(900);
      assert.notEqual(foregroundTitle(), 'NookFocusProbe', 'probe should have closed');
      assert.notEqual(foregroundTitle(), 'Magic Capsule', 'closing an app must not hand focus to the hidden pill');
    } finally {
      probe.kill();
    }
  });

  await step('if an app crashes and Windows picks the closed notch, Magic Capsule hands focus back', async () => {
    const crash = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
      Add-Type -AssemblyName System.Windows.Forms
      $form = New-Object System.Windows.Forms.Form
      $form.Text = 'NookCrashProbe'; $form.StartPosition = 'Manual'
      $form.Location = New-Object System.Drawing.Point(20, 500); $form.Size = New-Object System.Drawing.Size(220, 120)
      [void]$form.ShowDialog()`], { stdio: 'ignore' });
    const title = () => native('[T]::TitleOf([T]::GetForegroundWindow())');
    let seen = '';
    for (let i = 0; i < 40 && seen !== 'NookCrashProbe'; i += 1) {
      await sleep(250);
      seen = title();
    }
    assert.equal(seen, 'NookCrashProbe', 'probe window never reached the foreground');
    crash.kill();
    await sleep(2800); // the helper reports the foreground once a second
    assert.notEqual(title(), 'Magic Capsule');
  });

  await step('clicking a tab does not keep it open, and focus returns when it closes', async () => {
    const before = foreground();
    moveTo(centerX, 2);
    await waitFor(true, 1500, 'open');
    await sleep(450);
    const box = await page.locator('.tab[data-id="home"]').boundingBox();
    const bounds = await app.evaluate(() => global.notchWindow.getBounds());
    moveTo(px(bounds.x + box.x + box.width / 2), px(bounds.y + box.y + box.height / 2));
    await sleep(150);
    native('[T]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [T]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)');
    await sleep(250);
    moveTo(...away);
    await waitFor(false, 1800, 'closed');
    await sleep(300);
    const after = foreground();
    const title = (handle) => native(`[T]::TitleOf([IntPtr]${handle})`);
    assert.equal(after, before, `focus should return to "${title(before)}" but went to "${title(after)}"`);
  });

  await step('typing in a text box keeps it open after the mouse leaves', async () => {
    moveTo(centerX, 2);
    await waitFor(true, 1500, 'open');
    await sleep(450);
    await page.click('.tab[data-id="tasks"]');
    const box = await page.locator('.view:not([hidden]) input[aria-label="Task"]').boundingBox();
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    moveTo(px(bounds.x + box.x + 30), px(bounds.y + box.y + box.height / 2));
    await sleep(150);
    native('[T]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [T]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)');
    await sleep(250);
    moveTo(...away);
    await sleep(900);
    assert.equal(await isOpen(), true);
    await app.evaluate(() => global.notchWindow.blur());
    await waitFor(false, 1500, 'closed');
  });

  await step('volume key never reaches Windows, so its pop-up cannot appear', async () => {
    const before = await call('volume.get');
    await app.evaluate(({ globalShortcut }) => {
      global.volumeHits = 0;
      globalShortcut.unregister('VolumeUp');
      globalShortcut.register('VolumeUp', () => { global.volumeHits += 1; });
    });
    native('[T]::Key(0xAF)');
    await sleep(800);
    const hits = await app.evaluate(() => global.volumeHits);
    const after = await call('volume.get');
    await call('settings.set', { volumeHud: false });
    await call('settings.set', { volumeHud: true }); // puts the real handler back
    assert.equal(hits, 1, 'the key should reach Magic Capsule exactly once');
    assert.equal(after.percent, before.percent, 'Windows changed the volume, so it saw the key too');
  });

  await step('volume key: Magic Capsule steps the volume and shows the level', async () => {
    const before = await call('volume.get');
    const key = before.percent >= 98 ? 0xAE : 0xAF;
    const delta = key === 0xAF ? 2 : -2;
    native(`[T]::Key(${key})`);
    await sleep(900);
    const after = await call('volume.get');
    await page.screenshot({ path: path.join(shots, 'hud.png'), omitBackground: true });
    const pill = await page.locator('#pill').textContent();
    await call('volume.set', before.percent);
    await sleep(300);
    assert.equal(after.percent - before.percent, delta);
    assert.match(pill, /\d+%/);
    return `${before.percent}% -> ${after.percent}% -> restored`;
  });

  // Uses whatever is playing, and only seeks to the current spot, so the music is not interrupted.
  await step('media: live session on the pill, album art colour, position, command reaches the player', async () => {
    const media = await page.evaluate(() => new Promise((resolve) => {
      const stop = window.nook.on('media', (state) => { stop(); resolve(state); });
      window.nook.call('media.refresh');
      setTimeout(() => resolve(null), 3000);
    }));
    if (!media || !media.playing) return 'skipped: nothing is playing';
    await sleep(1200);
    await page.screenshot({ path: path.join(shots, 'pill-music.png'), omitBackground: true });
    assert.equal(await page.locator('#pill .pill-text').textContent(), media.title);
    assert.equal(await page.locator('#pill img.pill-art').count(), 1, 'album art missing on the pill');
    const glow = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--art').trim());
    assert.match(glow, /^rgb/, 'edge light did not take the album colour');
    assert.ok(media.duration > 0 && media.position <= media.duration);
    assert.equal(await call('media.action', 'seek', media.position + 2), true, 'the player refused the command');
    return `"${media.title}" at ${media.position}s of ${media.duration}s, glow ${glow}`;
  });

  await step('steps aside for a full-screen app and comes back', async () => {
    const before = foreground();
    assert.equal(await app.evaluate(() => global.notchWindow.isVisible()), true, 'should start visible');
    const handle = await app.evaluate(({ BrowserWindow }) => {
      global.testFull = new BrowserWindow({ fullscreen: true, backgroundColor: '#101014', show: true });
      global.testFull.loadURL('about:blank');
      return global.testFull.getNativeWindowHandle().readBigInt64LE().toString();
    });
    await sleep(500);
    native(`[T]::SwitchToThisWindow([IntPtr]${handle}, $true)`); // Windows refuses a plain focus()
    const visible = () => app.evaluate(() => global.notchWindow.isVisible());
    let hidden = false;
    for (let i = 0; i < 40 && !hidden; i += 1) {
      await sleep(100);
      hidden = !(await visible());
    }
    await app.evaluate(() => { global.testFull.destroy(); delete global.testFull; });
    native(`[T]::SwitchToThisWindow([IntPtr]${before}, $true)`);
    assert.equal(hidden, true, 'pill stayed visible over the full-screen app');
    let back = false;
    for (let i = 0; i < 40 && !back; i += 1) {
      await sleep(100);
      back = await visible();
    }
    assert.equal(back, true, 'pill did not come back');
  });

  await step('a real file drag from another app lands on the shelf', async () => {
    const file = path.join(os.tmpdir(), `nook drag test ${process.pid}.txt`);
    fs.writeFileSync(file, 'dragged');
    const source = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -Namespace Dpi -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
      [void][Dpi.U]::SetProcessDPIAware()
      $form = New-Object System.Windows.Forms.Form
      $form.Text = 'NookDragSource'
      $form.StartPosition = 'Manual'; $form.TopMost = $true; $form.ShowInTaskbar = $false
      $form.FormBorderStyle = 'None'; $form.Location = New-Object System.Drawing.Point(40, 400)
      $form.Size = New-Object System.Drawing.Size(160, 160); $form.BackColor = 'DarkSlateGray'
      $form.Add_MouseDown({
        $data = New-Object System.Windows.Forms.DataObject
        $list = New-Object System.Collections.Specialized.StringCollection
        [void]$list.Add($env:NOOK_DRAG_FILE)
        $data.SetFileDropList($list)
        [void]$form.DoDragDrop($data, 'Copy')
        $form.Close()
      })
      [void]$form.ShowDialog()`], { env: { ...process.env, NOOK_DRAG_FILE: file }, windowsHide: false, stdio: 'ignore' });
    try {
      for (let i = 0; i < 12 && titleAt(100, 480) !== 'NookDragSource'; i += 1) await sleep(500);
      moveTo(100, 480);
      await sleep(200);
      // Safety: never press the mouse on anything except the test's own form.
      assert.equal(titleAt(100, 480), 'NookDragSource', 'drag source is not under the cursor, not pressing');
      native('[T]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)');
      await sleep(300);
      for (const [x, y] of [[300, 300], [centerX - 80, 60], [centerX, 3]]) { moveTo(x, y); await sleep(200); }
      await waitFor(true, 1500, 'open during the drag');
      await sleep(500);
      moveTo(centerX, px(250));
      await sleep(500);
      native('[T]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)');
      await sleep(900);
      const items = await call('shelf.list');
      assert.deepEqual(items.map((item) => item.path), [file]);
      assert.equal(await page.locator('.tab.active[data-id="shelf"]').count(), 1, 'should switch to the shelf');
    } finally {
      source.kill();
      fs.rmSync(file, { force: true });
    }
  });

  await step('hide with a real click, then pointing at the line brings it back', async () => {
    moveTo(centerX, 2);
    await waitFor(true, 1500, 'open');
    await sleep(450);
    const eye = await page.locator('.tab[aria-label="Hide the notch"]').boundingBox();
    const bounds = await app.evaluate(() => global.notchWindow.getBounds());
    moveTo(px(bounds.x + eye.x + eye.width / 2), px(bounds.y + eye.y + eye.height / 2));
    await sleep(150);
    native('[T]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [T]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)');
    await sleep(300);
    moveTo(...away);
    const tucked = () => page.evaluate(() => document.getElementById('notch').classList.contains('tucked'));
    assert.equal(await tucked(), true, 'the eye button should hide it');
    await sleep(3800);
    assert.equal(await isOpen(), false);
    moveTo(centerX, 3);
    await sleep(900);
    assert.equal(await tucked(), false, 'pointing at the line should bring it back');
    moveTo(...away);
    await waitFor(false, 1800, 'closed');
    await sleep(400);
  });

  await step('hidden notch: Alt+N brings it back for good', async () => {
    await call('notch.tuck', true);
    await sleep(500);
    native('[T]::Chord(0x12, 0x4E)');
    await waitFor(true, 1500, 'open');
    await sleep(300);
    native('[T]::Key(0x1B)');
    await waitFor(false, 1500, 'closed');
    await sleep(400);
    assert.equal(await page.evaluate(() => document.getElementById('notch').classList.contains('tucked')), false);
  });

  // The AI's replies are scripted, so this tests Magic Capsule's hands and eyes, not a real model.
  const scriptedAi = async (answers) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen.push(JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...(answers.shift() || { content: 'Done' }) } }] }));
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { settings } = await call('settings.get');
    await call('settings.set', { ai: { ...settings.ai, provider: 'openai', openaiUrl: `http://127.0.0.1:${server.address().port}/v1`, models: { ...settings.ai.models, openai: 'test-model' } } });
    await call('ai.setKey', 'openai', 'test');
    const finish = async () => {
      server.close();
      await call('ai.setKey', 'openai', '');
      await call('settings.set', { ai: settings.ai });
    };
    return { seen, finish };
  };
  const tool = (id, name, input = {}) => ({ content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(input) } }] });
  const startTask = async (text) => {
    await call('notch.open');
    await call('notch.pin', true);
    await sleep(450);
    await page.click('.tab[data-id="ai"]');
    await page.click('.view:not([hidden]) .segmented button:has-text("Agent")');
    await page.selectOption('.view:not([hidden]) select[aria-label="Permission"]', 'task');
    await page.fill('.view:not([hidden]) textarea[aria-label="Task for the AI"]', text);
    await page.click('.view:not([hidden]) .agent-go');
  };
  const agentEnded = (pattern, timeout = 30000) => page.waitForFunction((source) => (
    [...document.querySelectorAll('.agent-line.done')].some((line) => new RegExp(source).test(line.textContent))
  ), pattern, { timeout });

  await step('agent: sees the screen, really clicks and really types in another app', async () => {
    const box = path.join(os.tmpdir(), `nook-agent-${process.pid}.txt`);
    const form = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -Namespace Dpi -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
      [void][Dpi.U]::SetProcessDPIAware()
      $form = New-Object System.Windows.Forms.Form
      $form.Text = 'NookInputProbe'; $form.StartPosition = 'Manual'; $form.TopMost = $true; $form.AutoScaleMode = 'None'
      $form.Location = New-Object System.Drawing.Point(60, 420); $form.Size = New-Object System.Drawing.Size(420, 160)
      $text = New-Object System.Windows.Forms.TextBox
      $text.Location = New-Object System.Drawing.Point(20, 30); $text.Size = New-Object System.Drawing.Size(360, 30)
      $form.Controls.Add($text)
      $form.Add_Shown({ $form.Activate(); $form.ActiveControl = $null })
      $form.Add_FormClosing({ [IO.File]::WriteAllText($env:NOOK_BOX, $text.Text, [Text.Encoding]::UTF8) })
      [void]$form.ShowDialog()`], { env: { ...process.env, NOOK_BOX: box }, stdio: 'ignore' });
    let ai;
    try {
      for (let i = 0; i < 50 && titleAt(240, 490) !== 'NookInputProbe'; i += 1) await sleep(400);
      assert.equal(titleAt(240, 490), 'NookInputProbe', 'test window never appeared, nothing was pressed');
      const scale = Math.round(geometry.width * geometry.scale) / 1280;
      // The text box sits near 240, 490 on the real screen. The AI speaks in screenshot pixels.
      const target = { x: 240 / scale, y: 490 / scale };
      ai = await scriptedAi([
        tool('a', 'screenshot'), tool('b', 'click', target), tool('c', 'type_text', { text: 'Magic Capsule नमस्ते 123' }),
        tool('d', 'screenshot'), tool('e', 'press_keys', { keys: 'alt+f4' }), { content: 'Typed it' },
      ]);
      await startTask('Type in the box');
      await agentEnded('Task finished', 40000);
      await sleep(600);
      assert.equal(fs.readFileSync(box, 'utf8').replace(/^\uFEFF/, ''), 'Magic Capsule नमस्ते 123');
      const image = ai.seen[1].messages.flatMap((message) => (Array.isArray(message.content) ? message.content : [])).find((part) => part.type === 'image_url');
      assert.ok(image && image.image_url.url.length > 5000, 'a real screenshot reached the AI');
    } finally {
      form.kill();
      if (ai) await ai.finish();
      fs.rmSync(box, { force: true });
    }
  });

  await step('agent: the stop shortcut ends a running task at once', async () => {
    const ai = await scriptedAi([tool('a', 'wait', { seconds: 8 }), tool('b', 'press_keys', { keys: 'f24' }), { content: 'Should never get here' }]);
    try {
      await startTask('Wait');
      await sleep(1500);
      native('[T]::Chord3(0x11, 0x12, 0x51)');
      await agentEnded('You stopped the task', 15000);
      assert.equal(ai.seen.length, 1, 'no further step ran after stopping');
    } finally {
      await ai.finish();
    }
  });

  await step('a real click on the avatar opens AI Chat, and clicks beside it pass through', async () => {
    // An alert widens the pill and shifts the avatar, so wait for it to settle before measuring.
    await page.waitForFunction(() => !document.getElementById('notch').classList.contains('alert'), null, { timeout: 8000 });
    await sleep(700);
    const pet = await page.locator('#pet').boundingBox();
    const bounds = await app.evaluate(() => global.notchWindow.getBounds());
    const x = px(bounds.x + pet.x + pet.width / 2);
    const y = px(bounds.y + pet.y + pet.height / 2);
    assert.notEqual(windowAt(px(bounds.x + pet.x + pet.width + 60), y), geometry.hwnd, 'beside the avatar stays click-through');
    moveTo(x, y);
    await sleep(350);
    assert.equal(await isOpen(), false, 'pointing at the avatar must not open the notch');
    // Safety: never press the mouse unless the avatar itself is under the cursor.
    const cursor = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    const live = await page.locator('#pet').boundingBox();
    const local = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    assert.ok(local.x >= live.x && local.x <= live.x + live.width && local.y >= live.y && local.y <= live.y + live.height, 'avatar is not under the cursor, not pressing');
    native('[T]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [T]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)');
    await waitFor(true, 1500, 'open');
    await sleep(1200);
    assert.equal(await isOpen(), true, 'the chat must stay open after the click');
    assert.equal(await page.locator('.tab.active[data-id]').getAttribute('data-id'), 'ai');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Message');
    native('[T]::Key(0x1B)');
    await waitFor(false, 1500, 'closed');
    moveTo(...away);
    await sleep(400);
  });

  await step('a walking avatar stops when the mouse comes near, and then a click opens the chat', async () => {
    const petBox = () => page.locator('#pet').boundingBox();
    const bounds = await app.evaluate(() => global.notchWindow.getBounds());
    await page.evaluate(async () => { const pet = await import('./pet.js'); pet.walkTo(200); });
    await sleep(1200);
    const moving = await petBox();
    assert.equal(await page.getAttribute('#pet', 'data-facing'), 'right', 'it should be walking');
    moveTo(px(bounds.x + moving.x + moving.width / 2 + 40), px(bounds.y + moving.y + moving.height / 2));
    await sleep(600);
    assert.equal(await page.getAttribute('#pet', 'data-facing'), null, 'it should stop for the mouse');
    const stopped = await petBox();
    await sleep(900);
    assert.ok(Math.abs((await petBox()).x - stopped.x) < 1, 'and stay stopped');
    const x = px(bounds.x + stopped.x + stopped.width / 2);
    const y = px(bounds.y + stopped.y + stopped.height / 2);
    moveTo(x, y);
    await sleep(350);
    // Safety: never press the mouse unless the avatar itself is under the cursor.
    const cursor = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    const live = await petBox();
    const local = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    assert.ok(local.x >= live.x && local.x <= live.x + live.width && local.y >= live.y && local.y <= live.y + live.height, 'avatar is not under the cursor, not pressing');
    native('[T]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [T]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)');
    await waitFor(true, 1500, 'open');
    await sleep(1000);
    assert.equal(await isOpen(), true, 'the chat must stay open');
    assert.equal(await page.locator('.tab.active[data-id]').getAttribute('data-id'), 'ai');
    native('[T]::Key(0x1B)');
    await waitFor(false, 1500, 'closed');
    moveTo(...away);
    await sleep(500);
    await page.evaluate(async () => { const pet = await import('./pet.js'); pet.walkTo(0); });
    await sleep(4500);
  });

  await step('agent: opens an app, scrolls and drags for real', async () => {
    const box = path.join(os.tmpdir(), `nook-agent-events-${process.pid}.txt`);
    const form = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -Namespace Dpi -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
      [void][Dpi.U]::SetProcessDPIAware()
      $script:seen = New-Object System.Collections.ArrayList
      $form = New-Object System.Windows.Forms.Form
      $form.Text = 'NookEventProbe'; $form.StartPosition = 'Manual'; $form.TopMost = $true; $form.AutoScaleMode = 'None'
      $form.Location = New-Object System.Drawing.Point(60, 420); $form.Size = New-Object System.Drawing.Size(420, 160)
      $form.Add_MouseWheel({ [void]$script:seen.Add("wheel $($_.Delta)") })
      $form.Add_MouseDown({ [void]$script:seen.Add("down $($_.X)") })
      $form.Add_MouseUp({ [void]$script:seen.Add("up $($_.X)") })
      $form.Add_FormClosing({ [IO.File]::WriteAllText($env:NOOK_BOX, ($script:seen -join ';')) })
      [void]$form.ShowDialog()`], { env: { ...process.env, NOOK_BOX: box }, stdio: 'ignore' });
    const before = native("@(Get-Process notepad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','");
    const appName = before ? 'Calculator' : 'Notepad';
    let ai;
    try {
      for (let i = 0; i < 50 && titleAt(240, 490) !== 'NookEventProbe'; i += 1) await sleep(400);
      assert.equal(titleAt(240, 490), 'NookEventProbe', 'test window never appeared, nothing was pressed');
      const scale = Math.round(geometry.width * geometry.scale) / 1280;
      const at = (x, y) => ({ x: x / scale, y: y / scale });
      ai = await scriptedAi([
        tool('a', 'click', at(240, 500)),
        tool('b', 'scroll', { ...at(240, 500), direction: 'down', amount: 3 }),
        tool('c', 'drag', { from_x: 140 / scale, from_y: 500 / scale, to_x: 360 / scale, to_y: 500 / scale }),
        tool('d', 'press_keys', { keys: 'alt+f4' }),
        tool('e', 'open_app', { name: appName }),
        { content: 'Done' },
      ]);
      await startTask('Use the window');
      await agentEnded('Task finished', 40000);
      const events = fs.readFileSync(box, 'utf8');
      assert.match(events, /^down \d+;up \d+;wheel -360;down \d+;up \d+/, `the click, scroll and drag did not arrive in order: ${events}`);
      const toolReply = ai.seen[ai.seen.length - 1].messages.filter((message) => message.role === 'tool').pop().content;
      assert.match(toolReply, /^Opened /, toolReply);
      return `${toolReply}`;
    } finally {
      form.kill();
      if (ai) await ai.finish();
      fs.rmSync(box, { force: true });
      await sleep(1500);
      native(`$keep = '${before}' -split ','; Get-Process notepad, CalculatorApp, Calculator -ErrorAction SilentlyContinue | Where-Object { $keep -notcontains "$($_.Id)" } | Stop-Process -Force`);
    }
  });

  await step('agent: reads a window as text and clicks a button by its id', async () => {
    const box = path.join(os.tmpdir(), `nook-agent-button-${process.pid}.txt`);
    const form = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -Namespace Dpi -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
      [void][Dpi.U]::SetProcessDPIAware()
      $form = New-Object System.Windows.Forms.Form
      $form.Text = 'NookButtonProbe'; $form.StartPosition = 'Manual'; $form.TopMost = $true; $form.AutoScaleMode = 'None'
      $form.Location = New-Object System.Drawing.Point(60, 420); $form.Size = New-Object System.Drawing.Size(420, 160)
      $button = New-Object System.Windows.Forms.Button; $button.Text = 'Save report'; $button.Top = 30; $button.Left = 60; $button.Width = 200; $button.Height = 50
      $button.Add_Click({ [IO.File]::WriteAllText($env:NOOK_BOX, 'pressed'); $form.Close() })
      $form.Controls.Add($button)
      [void]$form.ShowDialog()`], { env: { ...process.env, NOOK_BOX: box }, stdio: 'ignore' });
    let ai;
    try {
      for (let i = 0; i < 50 && titleAt(240, 490) !== 'NookButtonProbe'; i += 1) await sleep(400);
      assert.equal(titleAt(240, 490), 'NookButtonProbe', 'test window never appeared, nothing was pressed');
      ai = await scriptedAi([tool('a', 'read_ui', { window: 'NookButtonProbe' }), tool('b', 'click_element', { id: 1 }), { content: 'Pressed it' }]);
      await startTask('Press Save report');
      await agentEnded('Task finished', 40000);
      const reply = ai.seen[1].messages.find((message) => message.role === 'tool').content;
      assert.match(reply, /\[1\] Button "Save report"/);
      assert.equal(fs.readFileSync(box, 'utf8'), 'pressed');
    } finally {
      form.kill();
      if (ai) await ai.finish();
      fs.rmSync(box, { force: true });
    }
    await call('notch.pin', false);
    await call('notch.close');
    moveTo(...away);
    await sleep(600);
  });

  await step('Caps Lock shows on the notch, then goes back to how it was', async () => {
    native('[T]::Key(0x14)');
    await sleep(700);
    const first = await page.locator('#pill').textContent();
    native('[T]::Key(0x14)');
    await sleep(500);
    assert.match(first, /Caps Lock (on|off)/);
  });

  await step('snooze hides the notch, pressing again brings it back', async () => {
    assert.equal(await app.evaluate(() => global.notchWindow.isVisible()), true);
    native('[T]::Chord3(0x12, 0x10, 0x48)');
    await sleep(500);
    assert.equal(await app.evaluate(() => global.notchWindow.isVisible()), false);
    native('[T]::Chord3(0x12, 0x10, 0x48)');
    await sleep(500);
    assert.equal(await app.evaluate(() => global.notchWindow.isVisible()), true);
  });

  await step('auto-hide leaves a line, the top edge still opens it', async () => {
    await call('settings.set', { autoHide: true });
    await page.reload(); // a direct call skips the page, the Settings switch updates it itself
    await page.waitForSelector('#pill .pill-text', { state: 'attached' });
    await sleep(900);
    const box = await page.locator('#notch').boundingBox();
    assert.ok(box.y < 0, 'should be slid up');
    moveTo(centerX, 2);
    await waitFor(true, 1500, 'open');
    moveTo(...away);
    await waitFor(false, 1800, 'closed');
    await call('settings.set', { autoHide: false });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
  });

  await step('a second launch toggles the notch instead of starting a copy', async () => {
    moveTo(...away);
    await sleep(600);
    const open = await isOpen();
    const second = spawn(path.join(WORKSPACE, 'node_modules', 'electron', 'dist', 'electron.exe'), [PROJECT], { env: { ...process.env, NOOK_USER_DATA: userData } });
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => { second.kill(); resolve(false); }, 6000);
      second.on('exit', () => { clearTimeout(timer); resolve(true); });
    });
    assert.equal(exited, true, 'second instance should exit');
    await waitFor(!open, 1500, 'toggled');
  });

  const callIn = (target, method, ...args) => target.evaluate(([m, a]) => window.nook.call(m, ...a), [method, args]);
  const windowBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.getBounds()));
  // Changing screens can replace a window, and with it the page and any call still running in it.
  const adoptOnlyWindow = async () => {
    await sleep(900);
    page = app.windows().find((candidate) => !candidate.isClosed());
    await page.waitForSelector('#pill', { state: 'attached', timeout: 8000 });
    await app.evaluate(({ BrowserWindow }) => { global.notchWindow = BrowserWindow.getAllWindows()[0]; });
  };

  await step('two screens: every screen works on its own, data stays shared', async () => {
    const shown = await app.evaluate(({ screen }) => screen.getAllDisplays().map((display) => ({ id: display.id, bounds: display.bounds })));
    if (shown.length < 2) return 'SKIPPED: only one screen connected';
    const mainId = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().id);
    const side = shown.find((display) => display.id !== mainId);
    const sideTop = await app.evaluate(({ screen }, point) => screen.dipToScreenPoint(point), { x: side.bounds.x + side.bounds.width / 2, y: side.bounds.y + 2 });
    const sideFar = await app.evaluate(({ screen }, point) => screen.dipToScreenPoint(point), { x: side.bounds.x + side.bounds.width / 2, y: side.bounds.y + side.bounds.height - 90 });

    const opened = app.waitForEvent('window', { timeout: 15000 });
    await call('settings.set', { displayMode: 'all' });
    const second = await opened;
    await second.waitForSelector('#pill', { state: 'attached', timeout: 15000 });
    await sleep(1200);
    const windows = await windowBounds();
    assert.equal(windows.length, 2);
    const onSide = windows.find((bounds) => bounds.x >= side.bounds.x);
    const offCentre = Math.abs(onSide.x + onSide.width / 2 - (side.bounds.x + side.bounds.width / 2));
    assert.ok(offCentre <= 1.5, `${offCentre} off centre`);

    // Real mouse on the second screen opens only that notch.
    moveTo(sideTop.x, sideTop.y);
    const secondOpen = () => second.evaluate(() => document.getElementById('notch').classList.contains('open'));
    for (let i = 0; i < 30 && !(await secondOpen()); i += 1) await sleep(50);
    assert.equal(await secondOpen(), true, 'hover on the second screen should open its notch');
    assert.equal(await isOpen(), false, 'the main notch stays closed');
    moveTo(sideFar.x, sideFar.y);
    await sleep(900);
    assert.equal(await secondOpen(), false, 'leaving closes it');

    // Separate tabs, one set of data.
    await callIn(page, 'store.set', 'tasks', [{ id: 'shared', text: 'Shared task', done: false, due: null }]);
    for (const target of [page, second]) { await callIn(target, 'notch.open'); await callIn(target, 'notch.pin', true); }
    await sleep(600);
    await page.click('.tab[data-id="notes"]');
    await second.click('.tab[data-id="tasks"]');
    await second.waitForSelector('.view:not([hidden]) .task-text:has-text("Shared task")', { timeout: 4000 });
    assert.equal(await page.locator('.tab.active[data-id]').getAttribute('data-id'), 'notes', 'each screen keeps its own tab');
    await second.locator('.view:not([hidden]) input[aria-label="Task"]').fill('Added on screen two');
    await second.keyboard.press('Enter');
    await page.click('.tab[data-id="tasks"]');
    await page.waitForSelector('.view:not([hidden]) .task-text:has-text("Added on screen two")', { timeout: 4000 });
    await second.screenshot({ path: path.join(shots, 'second-screen.png'), omitBackground: true });
    for (const target of [page, second]) { await callIn(target, 'notch.pin', false); await callIn(target, 'notch.close'); }
    await callIn(page, 'store.set', 'tasks', []);
    await sleep(500);

    // A full-screen app hides only the notch on its own screen.
    const handle = await app.evaluate(({ BrowserWindow }, bounds) => {
      global.testFull = new BrowserWindow({ ...bounds, fullscreen: true, backgroundColor: '#101014', show: true });
      global.testFull.loadURL('about:blank');
      return global.testFull.getNativeWindowHandle().readBigInt64LE().toString();
    }, side.bounds);
    await sleep(600);
    const front = foreground();
    native(`[T]::SwitchToThisWindow([IntPtr]${handle}, $true)`);
    const visibility = () => app.evaluate(({ BrowserWindow }, sideX) => {
      const all = BrowserWindow.getAllWindows().filter((win) => win !== global.testFull);
      return all.map((win) => ({ side: win.getBounds().x >= sideX, visible: win.isVisible() }));
    }, side.bounds.x);
    let states = [];
    for (let i = 0; i < 40; i += 1) {
      await sleep(100);
      states = await visibility();
      if (!states.find((item) => item.side).visible) break;
    }
    await app.evaluate(() => { global.testFull.destroy(); delete global.testFull; });
    native(`[T]::SwitchToThisWindow([IntPtr]${front}, $true)`);
    assert.equal(states.find((item) => item.side).visible, false, 'the notch on that screen should step aside');
    assert.equal(states.find((item) => !item.side).visible, true, 'the other screen is not affected');
    await sleep(1500);
    assert.ok((await visibility()).every((item) => item.visible), 'both come back');

    // One screen.
    await callIn(page, 'settings.set', { displayMode: 'one', displayId: String(side.id) }).catch(() => {});
    await adoptOnlyWindow();
    let now = await windowBounds();
    assert.equal(now.length, 1, 'one screen means one notch');
    assert.ok(now[0].x >= side.bounds.x, 'and it sits on the chosen screen');

    // Follow the mouse, with the real mouse.
    await callIn(page, 'settings.set', { displayMode: 'follow' }).catch(() => {});
    await adoptOnlyWindow();
    moveTo(...away);
    await sleep(1200);
    now = await windowBounds();
    assert.equal(now.length, 1);
    assert.ok(now[0].x < side.bounds.x, 'the notch follows the mouse to the main screen');
    moveTo(sideFar.x, sideFar.y);
    await sleep(1200);
    now = await windowBounds();
    assert.ok(now[0].x >= side.bounds.x, 'and back to the second screen');
    moveTo(...away);
    await sleep(800);

    await callIn(page, 'settings.set', { displayMode: 'primary', displayId: null }).catch(() => {});
    await adoptOnlyWindow();
    now = await windowBounds();
    assert.ok(now[0].x < side.bounds.x, 'back on the main screen');
    return `second screen ${side.bounds.width} x ${side.bounds.height}`;
  });

  await step('no errors were logged by the main process', () => {
    const log = path.join(userData, 'nook.log');
    assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', '');
  });

  moveTo(...original);
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

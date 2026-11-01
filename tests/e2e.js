'use strict';

// Drives the real app. Usage: node tests/e2e.js <folder for screenshots>
// Runs against a throwaway data folder, so it never touches your real Magic Capsule data.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dep = require('../lib/deps');

const { _electron: electron } = dep('playwright-core');
const WORKSPACE = path.join(os.homedir(), '.build_workspaces', 'poni');
const PROJECT = path.join(__dirname, '..');
const shots = process.argv[2] || path.join(os.tmpdir(), 'nook-shots');
const TABS = ['home', 'calendar', 'tasks', 'notes', 'time', 'weather', 'clipboard', 'shelf', 'drop', 'units', 'ai', 'control', 'system', 'health', 'links', 'settings'];

// NOOK_ONLY=words runs just the steps that match, for checking one thing quickly.
const only = process.env.NOOK_ONLY ? new RegExp(process.env.NOOK_ONLY, 'i') : null;
const results = [];
async function step(name, fn) {
  if (only && !only.test(name)) return;
  try {
    await fn();
    results.push(true);
    console.log(`ok    ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').slice(0, 24).join('\n      ')}`);
  }
}

(async () => {
  require('./guard')();
  fs.mkdirSync(shots, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-e2e-'));
  const app = await electron.launch({
    executablePath: path.join(WORKSPACE, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [PROJECT],
    env: { ...process.env, NOOK_USER_DATA: userData },
  });

  const problems = [];
  const page = await app.firstWindow();
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`); });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), omitBackground: true });
  const call = (method, ...args) => page.evaluate(([m, a]) => window.nook.call(m, ...a), [method, args]);
  const tab = (id) => page.click(`.tab[data-id="${id}"]`);
  const view = '.view:not([hidden])';
  const until = async (check, what, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await check()) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const writeImage = (file) => app.evaluate(async ({ clipboard, ClipboardItem }, source) => {
    const bytes = process.mainModule.require('fs').readFileSync(source);
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  }, file);

  await step('boots and shows the resting pill', async () => {
    await page.waitForSelector('#pill .pill-text', { timeout: 15000 });
    await shot('00-closed');
  });

  await step('opens and stays open when pinned', async () => {
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForFunction(() => document.getElementById('notch').classList.contains('open'));
    await page.waitForTimeout(500);
    const box = await page.locator('#notch').boundingBox();
    assert.equal(Math.round(box.width), 780);
    assert.equal(Math.round(box.height), 480);
  });

  await step('settings: menu pages open and search finds options across pages', async () => {
    await tab('settings');
    for (const name of ['General', 'Look and size', 'Closed notch', 'Alerts', 'Tools', 'Tasks and timers', 'Health', 'Calendar', 'Shelf', 'AI', 'Privacy', 'About']) {
      await page.click(`${view} .settings-link:has-text("${name}")`);
      await page.waitForTimeout(120);
      assert.ok(await page.locator(`${view} .setting-section`).count() > 0, name);
    }
    await page.fill(`${view} input[aria-label="Search settings"]`, 'bedtime');
    await page.waitForSelector(`${view} .setting:visible:has-text("Bedtime")`);
    assert.equal(await page.locator(`${view} .setting:visible`).count(), 1);
    await page.fill(`${view} input[aria-label="Search settings"]`, '');
  });

  await step('settings: size, look, position and closed notch apply at once', async () => {
    await call('settings.set', { fitScreen: false, panelWidth: 680, panelHeight: 400, position: 30, topGap: 20, look: 'color', lookColor: '#f0f0f0', closedOpacity: 40 });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(600);
    const size = await page.locator('#notch').boundingBox();
    assert.deepEqual([Math.round(size.width), Math.round(size.height)], [680, 400]);
    const overflow = [];
    for (const id of TABS) {
      await tab(id);
      await page.waitForTimeout(120);
      if (await page.evaluate(() => { const v = document.getElementById('views'); return v.scrollHeight > v.clientHeight + 1 || v.scrollWidth > v.clientWidth + 1; })) overflow.push(id);
    }
    assert.deepEqual(overflow, []); // tools must fit the smallest open size
    await shot('40-smallest-size');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--rest-ink').trim()), '#15181e', 'dark text on a light colour');
    await call('settings.set', { fitScreen: true, panelWidth: 780, panelHeight: 480, position: 50, topGap: 0, look: 'black', closedOpacity: 100, closedMiddle: 'daytime', closedLeft: 'date', closedRight: 'memory', keepClock: true });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await page.waitForFunction(() => /RAM \d+%/.test(document.getElementById('pill').textContent), null, { timeout: 6000 });
    await shot('41-closed-extras');
    await call('settings.set', { closedMiddle: 'time', closedLeft: 'none', closedRight: 'none', keepClock: false });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(500);
  });

  await step('settings: arrow keys switch tools, default tool applies', async () => {
    await tab('notes');
    const before = await page.locator('.tab.active[data-id]').getAttribute('data-id');
    await page.locator('.tab.active[data-id]').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    assert.notEqual(await page.locator('.tab.active[data-id]').getAttribute('data-id'), before);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.tab.active[data-id]').getAttribute('data-id'), before);
  });

  await step('settings: pomodoro length follows Settings, reset restores defaults', async () => {
    await call('settings.set', { pomodoro: { ...(await call('settings.get')).settings.pomodoro, focus: 40 } });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
    await tab('time');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.pomo-time').textContent(), '40:00');
    const { settings } = await call('settings.reset');
    assert.equal(settings.pomodoro.focus, 25);
    assert.equal(settings.shortcut, 'Alt+N');
    await page.reload(); // a direct call skips the page, the Settings button updates it itself
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
  });

  for (const [index, id] of TABS.entries()) {
    await step(`tab renders: ${id}`, async () => {
      await tab(id);
      await page.waitForTimeout(id === 'control' || id === 'system' ? 2500 : 350);
      assert.equal(await page.locator(`${view} .view-title, ${view} .home, ${view} .settings`).count() > 0, true);
      const overflow = await page.evaluate(() => {
        const views = document.getElementById('views');
        return views.scrollHeight > views.clientHeight + 1 || views.scrollWidth > views.clientWidth + 1;
      });
      assert.equal(overflow, false, 'view overflows the panel');
      await shot(`${String(index + 1).padStart(2, '0')}-${id}`);
    });
  }

  await step('tasks: add, complete, survives restart of the view', async () => {
    await tab('tasks');
    await page.fill(`${view} input[aria-label="Task"]`, 'Pay electricity bill');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${view} .task-text:has-text("Pay electricity bill")`);
    await page.check(`${view} input[aria-label="Done: Pay electricity bill"]`);
    await page.waitForSelector(`${view} .task-done`);
    assert.deepEqual((await call('store.get', 'tasks', [])).map((task) => task.done), [true]);
  });

  await step('tasks: due reminder fires and shows on the notch', async () => {
    const soon = new Date(Date.now() + 61000);
    const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.fill(`${view} input[aria-label="Task"]`, 'Call the bank');
    await page.fill(`${view} input[aria-label="Remind me at"]`, local);
    await page.click(`${view} button[type="submit"]`);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#pill .pill-text').textContent(), 'Call the bank');
  });

  await step('tasks: smart text sets the reminder, repeating task moves on when ticked', async () => {
    await page.fill(`${view} input[aria-label="Task"]`, 'Water the plants every day 8am');
    await page.waitForSelector(`${view} .faint:has-text("repeating")`);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${view} .task-text:has-text("Water the plants")`);
    const before = (await call('store.get', 'tasks', [])).find((task) => task.text === 'Water the plants');
    assert.ok(before.repeat && before.due > Date.now());
    await page.click(`${view} input[aria-label="Done: Water the plants"]`); // it unticks itself, so no page.check
    await page.waitForTimeout(300);
    const after = (await call('store.get', 'tasks', [])).find((task) => task.text === 'Water the plants');
    assert.equal(after.done, false);
    assert.ok(after.due > Date.now());
  });

  await step('notes: first line becomes the title', async () => {
    await tab('notes');
    await page.click(`${view} button:has-text("New")`);
    await page.fill(`${view} textarea`, 'Shopping list\nmilk\neggs');
    await page.waitForSelector(`${view} .note-item.active:has-text("Shopping list")`);
  });

  await step('timers: pomodoro runs and appears on the notch', async () => {
    await tab('time');
    await page.click(`${view} .pomo .btn.primary`);
    await page.waitForFunction(() => document.querySelector('#pill .pill-text')?.textContent === 'Focus');
    await page.waitForTimeout(2200);
    const left = await page.locator('.pomo-time').textContent();
    assert.match(left, /^24:5\d$/);
    await page.click(`${view} .pomo .btn.primary`);
    await page.click(`${view} button[title="Reset"]`);
    await page.click(`${view} button:has-text("1m")`);
    await page.waitForSelector(`${view} .list-row:has-text("1 min timer")`);
    await page.click(`${view} button[title="Cancel timer"]`);
  });

  await step('weather: live search, forecast renders', async () => {
    await tab('weather');
    await page.fill(`${view} input[aria-label="City"]`, 'Ahmedabad');
    await page.click(`${view} button:has-text("Find")`);
    await page.click(`${view} button:has-text("Ahmedabad")`, { timeout: 15000 });
    await page.waitForSelector(`${view} .weather-temp`, { timeout: 15000 });
    assert.equal(await page.locator(`${view} .week-day`).count(), 7);
    assert.equal(await page.locator(`${view} .hour`).count(), 12);
    await shot('20-weather-filled');
  });

  await step('units: length, temperature, live currency', async () => {
    await tab('units');
    await page.fill(`${view} input[aria-label="Amount"]`, '5');
    await page.selectOption(`${view} select[aria-label="From"]`, 'Kilometre');
    await page.selectOption(`${view} select[aria-label="To"]`, 'Mile');
    assert.match(await page.locator(`${view} .value`).textContent(), /^3[.,]1068/);
    await page.selectOption(`${view} select[aria-label="Category"]`, 'Temperature');
    await page.selectOption(`${view} select[aria-label="From"]`, 'Celsius');
    await page.selectOption(`${view} select[aria-label="To"]`, 'Fahrenheit');
    await page.fill(`${view} input[aria-label="Amount"]`, '100');
    assert.equal(await page.locator(`${view} .value`).textContent(), '212');
    await page.selectOption(`${view} select[aria-label="Category"]`, 'Currency');
    await page.waitForFunction(() => document.querySelector('.view:not([hidden]) select[aria-label="To"]').value === 'INR', null, { timeout: 15000 });
    await page.fill(`${view} input[aria-label="Amount"]`, '1');
    const rate = Number((await page.locator(`${view} .value`).textContent()).replace(/,/g, ''));
    assert.ok(rate > 50 && rate < 200, `USD to INR looks wrong: ${rate}`);
  });

  await step('clipboard: records text, unicode, and copies back without duplicating', async () => {
    await tab('clipboard');
    await app.evaluate(({ clipboard }) => clipboard.writeText('नमस्ते from the test'));
    await page.waitForSelector(`${view} .clip-text:has-text("नमस्ते from the test")`, { timeout: 5000 });
    await app.evaluate(({ clipboard }) => clipboard.writeText('second item'));
    await page.waitForSelector(`${view} .clip-text:has-text("second item")`, { timeout: 5000 });
    await page.click(`${view} .clip-text:has-text("नमस्ते")`);
    await page.waitForTimeout(900);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'नमस्ते from the test');
    assert.equal((await call('clipboard.list')).length, 2);
    await shot('21-clipboard-filled');
  });

  await step('clipboard: image is captured with a thumbnail, copying back adds no duplicate', async () => {
    await writeImage(path.join(PROJECT, 'assets', 'icon.png'));
    await until(async () => (await call('clipboard.list'))[0]?.type === 'image', 'image in history');
    const [image] = await call('clipboard.list');
    assert.ok(image.thumb.startsWith('data:image/png') && image.w === 256);
    await call('clipboard.copy', (await call('clipboard.list'))[1].id);
    await page.waitForTimeout(700);
    await call('clipboard.copy', image.id);
    await page.waitForTimeout(900);
    assert.equal((await call('clipboard.list')).filter((item) => item.type === 'image').length, 1);
  });

  await step('clipboard: items marked private are not recorded', async () => {
    const before = (await call('clipboard.list')).length;
    const script = path.join(os.tmpdir(), `nook-private-${process.pid}.ps1`);
    fs.writeFileSync(script, [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$data = New-Object System.Windows.Forms.DataObject',
      '$data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, "my-secret-password")',
      '$data.SetData("ExcludeClipboardContentFromMonitorProcessing", [byte[]](0))',
      '[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)',
    ].join('\r\n'));
    require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script]);
    fs.rmSync(script);
    await page.waitForTimeout(1200);
    const items = await call('clipboard.list');
    assert.equal(items.length, before);
    assert.ok(!items.some((item) => item.text === 'my-secret-password'));
  });

  await step('clipboard: picture copied by another app (like a screenshot) is captured', async () => {
    const script = path.join(os.tmpdir(), `nook-bitmap-${process.pid}.ps1`);
    fs.writeFileSync(script, [
      'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
      '$bitmap = New-Object System.Drawing.Bitmap 64, 48',
      '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
      '$graphics.Clear([System.Drawing.Color]::Crimson)',
      '[System.Windows.Forms.Clipboard]::SetImage($bitmap)',
    ].join('\r\n'));
    require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script]);
    fs.rmSync(script);
    await until(async () => (await call('clipboard.list')).some((item) => item.w === 64), 'bitmap from another app');
  });

  await step('shelf: add, zip, convert, missing file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nook shelf '));
    const text = path.join(dir, "it's a [test].txt");
    fs.writeFileSync(text, 'parked file');
    const image = path.join(dir, 'pic.png');
    fs.copyFileSync(path.join(PROJECT, 'assets', 'icon.png'), image);
    const gone = path.join(dir, 'gone.txt');
    fs.writeFileSync(gone, 'x');

    await tab('shelf');
    await call('shelf.add', [text, image, gone]);
    await page.waitForSelector(`${view} .list-row:has-text("pic.png")`);
    fs.rmSync(gone);
    const items = await call('shelf.list');
    assert.equal(items.find((item) => item.name === 'gone.txt').missing, true);
    assert.equal(await call('shelf.zip', [items.find((item) => item.path === text).id]).then((out) => fs.existsSync(out) && fs.statSync(out).size > 0), true);

    await page.check(`${view} input[aria-label="Select pic.png"]`);
    await page.click(`${view} button:has-text("To JPG")`);
    await until(async () => (await call('shelf.list')).some((item) => item.name === 'pic.jpg'), 'pic.jpg');
    const jpg = fs.readFileSync(path.join(dir, 'pic.jpg'));
    assert.deepEqual([...jpg.subarray(0, 2)], [0xff, 0xd8]);
    await page.click(`${view} button:has-text("To WEBP")`);
    await until(async () => (await call('shelf.list')).some((item) => item.name === 'pic.webp'), 'pic.webp');
    await shot('22-shelf-filled');
    for (const item of await call('shelf.list')) await call('shelf.remove', item.id);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await step('ai: missing key shows a helpful error, no crash', async () => {
    await tab('ai');
    await page.fill(`${view} [aria-label="Message"]`, 'Hello');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${view} .bubble.failed:has-text("API key")`, { timeout: 5000 });
  });

  await step('ai: key is stored encrypted and never returned', async () => {
    await call('ai.setKey', 'gemini', 'secret-test-key-123');
    assert.deepEqual(await call('ai.hasKeys'), { gemini: true, claude: false, openai: false });
    const raw = fs.readFileSync(path.join(userData, 'data', 'secrets.json'), 'utf8');
    assert.ok(raw.includes('ai.gemini') && !raw.includes('secret-test-key-123'));
    await call('ai.setKey', 'gemini', '');
    assert.deepEqual(await call('ai.hasKeys'), { gemini: false, claude: false, openai: false });
  });

  await step('settings: themes apply, tools can be hidden, shortcut validated', async () => {
    await tab('settings');
    for (const theme of ['ember', 'aurora', 'silver', 'onyx']) {
      await page.evaluate((value) => document.documentElement.dataset.theme !== value, theme);
      await call('settings.set', { theme });
      await page.reload();
      await page.waitForSelector('#pill .pill-text');
      await call('notch.open');
      await call('notch.pin', true);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      await tab('home');
      await page.waitForTimeout(200);
      await shot(`30-theme-${theme}`);
    }
    const before = await page.locator('.tab[data-id]').count();
    const { settings } = await call('settings.get');
    await call('settings.set', { modules: settings.modules.map((item) => (item.id === 'links' ? { ...item, on: false } : item)) });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    assert.equal(await page.locator('.tab[data-id]').count(), before - 1);
    const rejected = await call('settings.set', { shortcut: 'Not A Key' });
    assert.ok(rejected.shortcutError.length > 0);
    assert.equal(rejected.settings.shortcut, 'Alt+N', 'a bad shortcut must not replace the working one');
    const moved = await call('settings.set', { shortcut: 'Alt+Shift+F9' });
    assert.equal(moved.shortcutError, '');
    assert.equal((await call('settings.set', { shortcut: 'Alt+N' })).shortcutError, '');
  });

  await step('no errors were logged by the main process', async () => {
    const log = path.join(userData, 'nook.log');
    assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', '');
  });

  await step('shelf: extract, copy, move and Recycle Bin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nook shelf2 '));
    const target = path.join(dir, 'target');
    fs.mkdirSync(target);
    const file = path.join(dir, 'report.txt');
    fs.writeFileSync(file, 'report body');
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, target);
    await call('shelf.add', [file]);
    const id = () => call('shelf.list').then((items) => items.find((item) => item.name === 'report.txt').id);
    await call('shelf.copyTo', [await id()]);
    assert.equal(fs.readFileSync(path.join(target, 'report.txt'), 'utf8'), 'report body');
    await call('shelf.copyTo', [await id()]);
    assert.ok(fs.existsSync(path.join(target, 'report (2).txt')), 'copies must never overwrite');
    const zipped = await call('shelf.zip', [await id()]);
    const zipItem = (await call('shelf.list')).find((item) => item.path === zipped);
    await call('shelf.unzip', [zipItem.id]);
    assert.equal(fs.readFileSync(path.join(dir, 'report', 'report.txt'), 'utf8'), 'report body');
    await call('shelf.moveTo', [await id()]);
    assert.ok(!fs.existsSync(file) && fs.existsSync(path.join(target, 'report (3).txt')));
    const moved = (await call('shelf.list')).find((item) => item.name === 'report (3).txt');
    assert.equal(moved.missing, false, 'the shelf follows the moved file');
    await call('shelf.trash', [moved.id]);
    assert.ok(!fs.existsSync(moved.path));
    for (const item of await call('shelf.list')) await call('shelf.remove', item.id);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await step('backup: exports without secrets, rejects a wrong file', async () => {
    const file = path.join(userData, 'test.nook');
    await call('ai.setKey', 'gemini', 'secret-test-key-123');
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [`${target}.bad`] });
    }, file);
    await page.waitForTimeout(500); // lets pending writes reach the store
    assert.equal(await call('backup.export'), true);
    const saved = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(saved);
    assert.equal(parsed.format, 'nook-backup');
    assert.ok(parsed.data.tasks.length > 0 && parsed.data.notes.length > 0);
    assert.ok(!saved.includes('secret-test-key-123') && !('clipboard' in parsed.data));
    fs.writeFileSync(`${file}.bad`, '{"hello":1}');
    await assert.rejects(call('backup.import'), /not a Magic Capsule backup/);
    await call('ai.setKey', 'gemini', '');
  });

  await step('hide: tucks to a thin handle, hover stays closed, click restores', async () => {
    await call('notch.open');
    await page.waitForTimeout(200);
    await call('notch.tuck', true);
    await page.waitForTimeout(600);
    const box = await page.locator('#notch').boundingBox();
    await page.waitForTimeout(3600); // the hint on the notch goes first
    const box2 = await page.locator('#notch').boundingBox();
    assert.deepEqual([Math.round(box2.width), Math.round(box2.height)], [120, 12]);
    await shot('60-hidden-handle');
    const bounds = await page.evaluate(() => { const r = document.getElementById('notch').getBoundingClientRect(); return { x: r.x + r.width / 2, bottom: r.bottom }; });
    await page.mouse.click(bounds.x, bounds.bottom + 5); // just under the line must still work
    await page.waitForTimeout(600);
    assert.ok((await page.locator('#notch').boundingBox()).height > 20, 'clicking near the line brings it back');
    await call('notch.tuck', true);
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForSelector('#pill', { state: 'attached' });
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => document.getElementById('notch').classList.contains('tucked')), true, 'a reloaded page must agree it is hidden');
    await call('notch.tuck', false);
    await page.waitForTimeout(400);
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
  });

  await step('system: status, live charts, and which apps use the most memory', async () => {
    await tab('system');
    await page.waitForSelector(`${view} .status-title`, { timeout: 6000 });
    await page.waitForFunction(() => document.querySelectorAll('.view:not([hidden]) .system-lower .bar-row').length >= 3, null, { timeout: 8000 });
    await page.waitForTimeout(4500);
    assert.ok(await page.locator(`${view} .tile .spark-line[d]`).count() >= 2, 'processor and memory charts draw');
    assert.ok(await page.locator(`${view} .speed .spark-line[d]`).count() >= 1, 'network charts draw');
    const chart = page.locator(`${view} .tile .spark-wrap`).first();
    await chart.hover();
    await page.waitForSelector(`${view} .spark-tip:visible`);
    assert.match(await page.locator(`${view} .spark-tip:visible`).textContent(), /\d+%/);
    await shot('61-system');
  });

  await step('lyrics: finds synced lines for a known song', async () => {
    const lines = await call('lyrics.get', { title: 'Tumsa Koi Pyaara (Official Video)', artist: 'Kumar Sanu', duration: 342 });
    assert.ok(lines.length > 10 && typeof lines[0].at === 'number' && lines[0].text);
  });

  await step('microphone state can be read', async () => {
    const muted = await call('mic.get').catch((err) => err.message);
    assert.ok(typeof muted === 'boolean' || /not found|element|device|0x8/i.test(String(muted)), `unexpected: ${muted}`);
  });

  await step('pet: settings apply and it reacts to work, music, focus, tasks and idle', async () => {
    const { settings: current } = await call('settings.get');
    await call('settings.set', { pet: { ...current.pet, avatar: { base: 'dog', skin: '#e9c48a', accent: '#b98d52', belly: '#fbeedb', mouth: 'smile' }, size: 80, side: 'center' } });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await page.waitForSelector('#pet svg', { state: 'attached' });
    await page.waitForFunction(() => document.getElementById('pet').querySelector('.pet-bubble').hidden, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(2000); // the hello at startup has to finish, or the real foreground app arrives first
    const pet = page.locator('#pet');
    let lastApp = null;
    const send = (channel, data) => {
      if (channel === 'foreground') lastApp = data;
      return app.evaluate(({ BrowserWindow }, [name, payload]) => {
        BrowserWindow.getAllWindows()[0].webContents.send(name, payload);
      }, [channel, data]);
    };
    // The real app in front is reported every second, and a real alert such as full memory can arrive
    // at any moment on a busy PC, so the pretend app is repeated until the pet has answered it.
    const mood = async (expected) => {
      const end = Date.now() + 8000;
      while (Date.now() < end) {
        if (lastApp) await send('foreground', lastApp);
        if (await pet.getAttribute('data-mood') === expected) return;
        await page.waitForTimeout(150);
      }
      throw new Error(`the pet never became ${expected}, it is ${await pet.getAttribute('data-mood')}`);
    };
    assert.equal(await pet.getAttribute('data-base'), 'dog');
    assert.equal(Math.round((await pet.boundingBox()).width), 80);

    await send('media', null);
    await send('foreground', { app: 'Visual Studio Code', idle: 0 });
    await mood('typing');
    await shot('50-pet-typing');
    await send('foreground', { app: 'Google Chrome', idle: 0 });
    await mood('looking');
    await send('foreground', { app: 'WhatsApp', idle: 0 });
    await mood('chat');
    await send('foreground', { app: 'Calculator', idle: 0 });
    await mood('idle');
    await send('media', { title: 'Song', artist: 'A', playing: true, position: 1, duration: 100, app: 'x' });
    await mood('dance');
    await shot('51-pet-dance');
    await send('media', null);
    await send('foreground', { app: 'Calculator', idle: 9999 });
    await mood('sleep');
    await shot('52-pet-sleep');
    await send('foreground', { app: 'Calculator', idle: 0 });
    await mood('idle');

    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
    await tab('tasks');
    await page.fill(`${view} input[aria-label="Task"]`, 'Pet test task');
    await page.keyboard.press('Enter');
    await page.check(`${view} input[aria-label="Done: Pet test task"]`);
    await mood('happy');
    await page.waitForTimeout(300);
    await call('notch.close');
    await page.waitForTimeout(500);
    await shot('53-pet-happy');
    await call('settings.set', { pet: { ...current.pet, on: false } });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    assert.equal(await pet.isVisible(), false);
    await call('settings.set', { pet: current.pet });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
  });

  await step('calendar: month paging, smart add, details, edit, delete, and a real iCal link', async () => {
    const pad = (n) => String(n).padStart(2, '0');
    const later = new Date(Date.now() + 2 * 86400000);
    const stamp = `${later.getFullYear()}${pad(later.getMonth() + 1)}${pad(later.getDate())}`;
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:team1', 'SUMMARY:Team sync', `DTSTART:${stamp}T100000`, `DTEND:${stamp}T103000`,
      'LOCATION:Room 4', 'DESCRIPTION:Join https://meet.google.com/abc-defg-hij', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const server = require('http').createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(ics); });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const feed = `http://127.0.0.1:${server.address().port}/team.ics`;

    await tab('calendar');
    await page.waitForSelector(`${view} .cal-cell.today`);
    assert.equal(await page.locator(`${view} .cal-cell`).count(), 42);
    const month = await page.locator(`${view} .cal-month-name`).textContent();
    await page.click(`${view} button[title="Next month"]`);
    assert.notEqual(await page.locator(`${view} .cal-month-name`).textContent(), month);
    await page.click(`${view} button:has-text("Today")`);
    assert.equal(await page.locator(`${view} .cal-month-name`).textContent(), month);

    await page.fill(`${view} input[aria-label="New event"]`, 'Dentist tomorrow 5pm');
    await page.waitForFunction(() => /5:00|17:00/.test(document.querySelector('.view:not([hidden]) .cal-hint').textContent));
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${view} .cal-event-title:has-text("Dentist")`);
    await page.click(`${view} .cal-event-head:has-text("Dentist")`);
    await page.click(`${view} .cal-details button:has-text("Edit")`);
    await page.fill(`${view} .cal-event form input[aria-label="Event title"]`, 'Dentist visit');
    await page.selectOption(`${view} .cal-event form select`, '2');
    await page.click(`${view} .cal-event form button:has-text("Save")`);
    await page.waitForSelector(`${view} .cal-event-title:has-text("Dentist visit")`);
    const stored = (await call('store.get', 'events', [])).find((event) => event.title === 'Dentist visit');
    assert.equal(stored.end - stored.start, 2 * 3600000);

    const { settings } = await call('settings.get');
    await call('settings.set', { calendars: [{ name: 'Work', url: feed }] });
    await call('calendar.refresh');
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
    await tab('calendar');
    await page.click(`${view} .cal-cell[aria-label*="${later.toLocaleDateString('en-GB', { day: 'numeric' })}"]:not(.other)`);
    await page.waitForSelector(`${view} .cal-event-title:has-text("Team sync")`);
    await page.click(`${view} .cal-event-head:has-text("Team sync")`);
    await page.waitForSelector(`${view} .cal-details button:has-text("Join")`);
    await app.evaluate(({ shell }) => {
      global.opened = [];
      shell.openExternal = async (url) => { global.opened.push(url); };
    });
    await page.click(`${view} .cal-details button:has-text("Join")`);
    await page.waitForTimeout(200);
    assert.deepEqual(await app.evaluate(() => global.opened), ['https://meet.google.com/abc-defg-hij']);
    await page.click(`${view} .cal-details button:has-text("Copy link")`);
    await page.waitForTimeout(200);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'https://meet.google.com/abc-defg-hij');
    assert.equal(await page.locator(`${view} .cal-details button:has-text("Edit")`).count(), 0, 'linked events are read-only');
    assert.equal(await page.locator(`${view} .cal-legend-item`).count(), 2);
    await shot('80-calendar');

    await page.click(`${view} button:has-text("Today")`);
    await page.locator(`${view} .cal-cell.today`).click();
    await page.click(`${view} .cal-cell[title*="event"]:not(.other)`);
    await page.click(`${view} .cal-event-head:has-text("Dentist visit")`).catch(() => {});
    for (const event of await call('store.get', 'events', [])) void event;
    await call('store.set', 'events', []);
    await call('settings.set', { calendars: settings.calendars });
    await call('calendar.refresh');
    server.close();
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
  });

  await step('agent: asks permission, runs tools, skills and files, stops when told', async () => {
    const answers = [
      { content: 'Looking at the screen', tool_calls: [{ id: 'a', type: 'function', function: { name: 'screenshot', arguments: '{}' } }] },
      { content: null, tool_calls: [{ id: 'b', type: 'function', function: { name: 'list_folder', arguments: JSON.stringify({ path: userData }) } }] },
      { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Which colour?' }) } }] },
      { content: 'Finished the job' },
    ];
    const seen = [];
    const server = require('http').createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen.push(JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...answers.shift() } }] }));
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { settings } = await call('settings.get');
    await call('settings.set', { ai: { ...settings.ai, provider: 'openai', openaiUrl: `http://127.0.0.1:${server.address().port}/v1`, models: { ...settings.ai.models, openai: 'test-model' } } });
    await call('ai.setKey', 'openai', 'test');
    await call('store.set', 'skills', [{ name: 'House style', text: 'Always be brief', mode: 'always' }]);
    await tab('ai');
    await page.click(`${view} .segmented button:has-text("Agent")`);
    await page.fill(`${view} textarea[aria-label="Task for the AI"]`, 'Check my folder');
    await page.click(`${view} .agent-go`);
    await page.waitForSelector(`${view} .agent-ask:has-text("Look inside")`, { timeout: 15000 });
    await shot('90-agent-permission');
    await page.click(`${view} .agent-ask button:has-text("Allow once")`);
    await page.waitForSelector(`${view} .agent-ask:has-text("Which colour?")`, { timeout: 8000 });
    await page.fill(`${view} input[aria-label="Your answer"]`, 'Blue');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${view} .agent-line:has-text("Finished the job")`, { timeout: 8000 });
    assert.ok(seen[0].messages[0].content.includes('Always be brief'), 'skills reach the AI');
    assert.ok(seen[0].messages[0].content.includes('never instructions'), 'screen text is not treated as orders');
    assert.ok(seen[1].messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')), 'the screenshot reaches the AI');
    assert.equal(seen[3].messages.find((message) => message.role === 'tool' && message.tool_call_id === 'c').content, 'Blue');
    server.close();
    await call('ai.setKey', 'openai', '');
    await call('store.set', 'skills', []);
    await call('settings.set', { ai: settings.ai });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
  });

  await step('avatar click opens chat; skills, typing and AI replies all move the avatar', async () => {
    const seen = [];
    const server = require('http').createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        seen.push(JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        await new Promise((resolve) => { setTimeout(resolve, 900); });
        res.write('data: {"choices":[{"delta":{"content":"Namaste"}}]}\n\n');
        await new Promise((resolve) => { setTimeout(resolve, 900); });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { settings } = await call('settings.get');
    await call('settings.set', { ai: { ...settings.ai, provider: 'openai', openaiUrl: `http://127.0.0.1:${server.address().port}/v1`, models: { ...settings.ai.models, openai: 'test-model' } } });
    await call('ai.setKey', 'openai', 'sk-test-abcd1234');
    assert.equal(await call('ai.keyHint', 'openai'), '••••1234', 'only the end of the key is shown');
    await call('store.set', 'skills', [
      { name: 'Business documents', text: 'Use GST format', mode: 'off' },
      { name: 'Kharcha tracker', text: 'Track every rupee', mode: 'auto', keywords: ['kharcha'] },
    ]);
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await page.waitForSelector('#pet svg', { state: 'attached' });

    await page.locator('#pet .pet-art').click({ force: true });
    await page.waitForFunction(() => document.getElementById('notch').classList.contains('open'));
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.tab.active[data-id]').getAttribute('data-id'), 'ai');
    await call('notch.pin', true);
    const buddy = page.locator(`${view} .pet-chat`);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Message');

    await page.keyboard.type('/bus');
    await page.waitForSelector(`${view} .skill-menu:not([hidden]) .skill-use:has-text("/business-documents")`);
    assert.equal(await buddy.getAttribute('data-mood'), 'typing', 'typing in Magic Capsule');
    await shot('96-skill-menu');
    await page.click(`${view} .skill-use:has-text("/business-documents")`);
    assert.equal(await page.inputValue(`${view} [aria-label="Message"]`), '/business-documents ');
    await page.keyboard.type('invoice banao');
    await page.waitForTimeout(1400);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.view:not([hidden]) .pet-chat').dataset.mood === 'thinking', null, { timeout: 2000 });
    await page.waitForFunction(() => document.querySelector('.view:not([hidden]) .pet-chat').dataset.mood === 'chat', null, { timeout: 3000 });
    await page.waitForFunction(() => document.querySelector('.view:not([hidden]) .pet-chat').dataset.mood === 'happy', null, { timeout: 3000 });
    await shot('97-chat-happy');
    assert.ok(seen[0].messages[0].content.includes('Use GST format'), 'the skill was used for this message');
    const lastUser = seen[0].messages.filter((message) => message.role === 'user').pop().content;
    assert.equal(lastUser, 'invoice banao', 'the /command itself is not sent to the AI');

    await page.fill(`${view} [aria-label="Message"]`, 'plain question');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.view:not([hidden]) .pet-chat').dataset.mood === 'happy', null, { timeout: 5000 });
    assert.ok(!seen[1].messages[0].content.includes('Use GST format'), 'a switched-off skill stays off next time');
    assert.ok(!seen[1].messages[0].content.includes('Track every rupee'), 'an Auto skill stays out of unrelated messages');

    await page.waitForFunction(() => document.querySelector('.view:not([hidden]) button[title="Send"]'), null, { timeout: 5000 });
    await page.fill(`${view} [aria-label="Message"]`, 'aaj ka kharcha likho');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${view} .skill-used:has-text("Kharcha tracker")`, { timeout: 4000 });
    await page.waitForFunction(() => document.querySelector('.view:not([hidden]) .pet-chat').dataset.mood === 'happy', null, { timeout: 5000 });
    assert.ok(seen[2].messages[0].content.includes('Track every rupee'), 'the Auto skill was chosen from the words');
    await shot('98-auto-skill');

    server.close();
    await call('ai.setKey', 'openai', '');
    await call('store.set', 'skills', []);
    await call('store.set', 'chat', []);
    await call('settings.set', { ai: settings.ai });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
  });

  await step('microphone button mutes and comes back', async () => {
    const before = await call('mic.get').catch(() => null);
    if (before === null) return;
    await tab('control');
    await page.click(`${view} .segmented button:has-text("Sound")`);
    await page.waitForTimeout(600);
    const label = before ? 'Unmute' : 'Mute';
    try {
      await page.click(`${view} .btn:text-is("${label}")`);
      await page.waitForTimeout(500);
      assert.equal(await call('mic.get'), !before);
    } finally {
      await call('mic.set', before);
    }
    assert.equal(await call('mic.get'), before);
  });

  await step('files reach the AI, and a skill file can be imported', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nook ai files '));
    const note = path.join(dir, 'sales.csv');
    const skill = path.join(dir, 'Team rules.md');
    fs.writeFileSync(note, 'item,amount\ntea,450\n');
    fs.writeFileSync(skill, 'Always add a thank you line.');
    const seen = [];
    const server = require('http').createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen.push(JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"Got it"}}]}\n\n');
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { settings } = await call('settings.get');
    await call('settings.set', { ai: { ...settings.ai, provider: 'openai', openaiUrl: `http://127.0.0.1:${server.address().port}/v1`, models: { ...settings.ai.models, openai: 'test-model' } } });
    await call('ai.setKey', 'openai', 'test');
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);

    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, skill);
    await tab('settings');
    await page.click(`${view} .settings-link:has-text("AI")`);
    await page.click(`${view} button:has-text("Import .md or .txt")`);
    await page.waitForSelector(`${view} .setting:has-text("Team rules")`);
    const imported = (await call('store.get', 'skills', []))[0];
    assert.equal(imported.text, 'Always add a thank you line.');
    assert.equal(imported.mode, 'auto');
    await page.selectOption(`${view} select[aria-label="When to use Team rules"]`, 'always');
    await page.waitForTimeout(300);

    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, note);
    await tab('ai');
    await page.click(`${view} .segmented button:has-text("Chat")`);
    await page.click(`${view} .skill-host:visible button[title="Add files"]`);
    await page.waitForSelector(`${view} .file-chip:has-text("sales.csv")`);
    await page.fill(`${view} [aria-label="Message"]`, 'Total kitna hai');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${view} .bubble.assistant:has-text("Got it")`, { timeout: 5000 });
    const sent = seen[0].messages;
    assert.ok(sent[0].content.includes('Always add a thank you line.'), 'imported skill reached the AI');
    assert.ok(sent[sent.length - 1].content.includes('tea,450'), 'file contents reached the AI');
    assert.ok(!sent.some((message) => message.role === 'user' && String(message.content).includes(skill)), 'skill files are not sent as attachments');
    server.close();
    await call('ai.setKey', 'openai', '');
    await call('store.set', 'skills', []);
    await call('store.set', 'chat', []);
    await call('settings.set', { ai: settings.ai });
    fs.rmSync(dir, { recursive: true, force: true });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
  });

  await step('backup: a real restore brings your data back', async () => {
    const file = path.join(userData, 'restore.nook');
    await call('store.set', 'notes', [{ id: 'keep', text: 'Keep this note', at: 1 }]);
    await app.evaluate(({ app: electronApp, dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
      global.relaunched = 0;
      global.realApp = { relaunch: electronApp.relaunch, quit: electronApp.quit };
      electronApp.relaunch = () => { global.relaunched += 1; };
      electronApp.quit = () => {};
    }, file);
    await page.waitForTimeout(500);
    assert.equal(await call('backup.export'), true);
    await call('store.set', 'notes', [{ id: 'other', text: 'Changed afterwards', at: 2 }]);
    assert.equal(await call('backup.import'), true);
    assert.equal((await call('store.get', 'notes', []))[0].text, 'Keep this note');
    assert.equal(await app.evaluate(() => global.relaunched), 1, 'Magic Capsule restarts to load it');
    await app.evaluate(({ app: electronApp }) => Object.assign(electronApp, global.realApp)); // or the test can never quit
    await call('store.set', 'notes', []);
  });

  await step('avatar: volume, shelf, charger and full memory all move it', async () => {
    const mood = () => page.evaluate(() => document.getElementById('pet').dataset.mood);
    const send = (channel, data) => app.evaluate(({ BrowserWindow }, [name, payload]) => {
      BrowserWindow.getAllWindows()[0].webContents.send(name, payload);
    }, [channel, data]);
    await send('volume', { percent: 20, muted: false });
    await send('volume', { percent: 22, muted: false });
    await page.waitForFunction(() => document.getElementById('pet').dataset.mood === 'nod', null, { timeout: 2000 });
    await page.waitForTimeout(1000);
    await send('lockkey', { key: 'Caps Lock', on: true });
    await page.waitForFunction(() => document.getElementById('pet').dataset.mood === 'nod', null, { timeout: 2000 });
    await page.waitForTimeout(1000);
    await send('shelf', []);
    await page.waitForFunction(() => document.getElementById('pet').dataset.mood === 'nod', null, { timeout: 2000 });
    await page.waitForTimeout(1000);

    const charging = await page.evaluate(async () => {
      const battery = await navigator.getBattery();
      battery.dispatchEvent(new Event('chargingchange'));
      return battery.charging;
    });
    if (charging) await page.waitForFunction(() => document.getElementById('pet').dataset.mood === 'happy', null, { timeout: 2000 });
    await page.waitForTimeout(3200);

    const stats = await call('system.stats');
    const used = (1 - stats.memFree / stats.memTotal) * 100;
    await page.evaluate(async () => { const pet = await import('./pet.js'); await pet.checkMemory(); });
    if (used >= 90) assert.equal(await mood(), 'worried', `memory is ${Math.round(used)}%`);
    else assert.notEqual(await mood(), 'worried', `memory is only ${Math.round(used)}%`);
  });

  await step('avatars: gallery, builder, surprise, save, and sacred figures stay calm', async () => {
    await tab('settings');
    await page.click(`${view} .settings-link:has-text("Pet")`);
    await page.waitForSelector(`${view} .avatar-card`);
    assert.equal(await page.locator(`${view} .avatar-card`).count(), 23);
    const broken = await page.evaluate(() => [...document.querySelectorAll('.avatar-art svg')].filter((svg) => (
      new DOMParser().parseFromString(new XMLSerializer().serializeToString(svg), 'image/svg+xml').querySelector('parsererror'))).length);
    assert.equal(broken, 0, 'every preset must be valid SVG');
    await shot('70-avatar-gallery');

    await page.click(`${view} .avatar-card:has-text("Bal Ganesh")`);
    await page.waitForSelector(`${view} .avatar-card.active:has-text("Bal Ganesh")`);
    const saved = (await call('settings.get')).settings.pet.avatar;
    assert.equal(saved.base, 'elephant');
    assert.equal(saved.calm, true);
    await page.click(`${view} .avatar-actions button:has-text("Music")`);
    await page.waitForTimeout(200);
    assert.equal(await page.locator(`${view} .pet-preview`).getAttribute('data-mood'), 'calm', 'no dancing');
    await page.click(`${view} .avatar-actions button:has-text("Happy")`);
    await page.waitForTimeout(200);
    assert.equal(await page.locator(`${view} .pet-preview`).getAttribute('data-mood'), 'bless');
    await shot('71-avatar-ganesh');

    await page.selectOption(`${view} .setting:has-text("Holding") select`, 'lotus');
    await page.waitForTimeout(300);
    assert.equal((await call('settings.get')).settings.pet.avatar.item, 'lotus');
    await page.click(`${view} button:has-text("Save this avatar")`);
    await page.waitForSelector(`${view} .avatar-card:has-text("My avatar 1")`);
    await page.click(`${view} button:has-text("Surprise me")`);
    await page.waitForTimeout(300);
    assert.ok(await page.locator(`${view} .pet-preview svg`).count() === 1);
    await page.click(`${view} button[aria-label="Delete My avatar 1"]`);
    await page.waitForTimeout(300);
    assert.equal((await call('settings.get')).settings.pet.saved.length, 0);
    await page.click(`${view} .avatar-card:has-text("Volt Runner")`);
    await page.waitForTimeout(300);
    await shot('72-avatar-hero');
    await page.click(`${view} .avatar-card:has-text("Ginger cat")`);
    await page.waitForTimeout(300);
  });

  await step('pet: it has a name, walks around, and stays home while the notch is open', async () => {
    const { settings } = await call('settings.get');
    await call('notch.pin', false);
    await call('notch.close');
    await call('settings.set', { pet: { ...settings.pet, name: 'Mochi', side: 'center', walk: false, play: false } });
    await page.reload();
    await page.waitForSelector('#pet svg', { state: 'attached' });
    assert.match(await page.locator('#pet .pet-bubble').textContent(), /Mochi/, 'it says its name');
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#pet .pet-art').getAttribute('title'), 'Mochi');
    const before = (await page.locator('#pet').boundingBox()).x;
    await page.evaluate(async () => { const pet = await import('./pet.js'); pet.walkTo(110); });
    await page.waitForFunction(() => document.getElementById('pet').dataset.facing === 'right', null, { timeout: 1500 });
    await shot('54-pet-walking');
    await page.waitForFunction(() => !document.getElementById('pet').dataset.facing, null, { timeout: 5000 });
    await page.waitForTimeout(300);
    assert.equal(Math.round((await page.locator('#pet').boundingBox()).x - before), 110, 'it really moved');
    assert.equal(await page.getAttribute('#pet', 'data-facing'), null);
    await page.evaluate(async () => { const pet = await import('./pet.js'); pet.walkTo(0); });
    await page.waitForFunction(() => !document.getElementById('pet').dataset.facing, null, { timeout: 5000 });
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(500);
    await tab('ai');
    assert.match(await page.locator(`${view} .chat`).textContent(), /Ask Mochi anything|./);
    await call('settings.set', { pet: settings.pet });
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
  });

  await step('chat: Shift+Enter makes a new line, the box grows, Enter sends it all', async () => {
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
    await tab('ai');
    await page.click(`${view} .segmented button:has-text("Chat")`);
    const box = page.locator(`${view} [aria-label="Message"]`);
    await box.click();
    const small = (await box.boundingBox()).height;
    await page.keyboard.type('first line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('third line');
    assert.equal(await box.inputValue(), 'first line\n\nthird line');
    const tall = (await box.boundingBox()).height;
    assert.ok(tall > small + 20, `the box grows: ${small} to ${tall}`);
    assert.equal(await page.locator(`${view} .bubble.user:has-text("first line")`).count(), 0, 'nothing was sent yet');
    await shot('99-chat-lines');
    await page.keyboard.press('Enter');
    const sent = page.locator(`${view} .bubble.user:has-text("first line")`).last();
    await sent.waitFor({ timeout: 4000 });
    assert.equal(await sent.textContent(), 'first line\n\nthird line', 'the lines stay in the message');
    assert.equal(await box.inputValue(), '');
    await page.waitForTimeout(200);
    assert.ok((await box.boundingBox()).height <= small + 2, 'the box shrinks back');
    for (let i = 0; i < 12; i += 1) await box.evaluate((el) => { el.value += 'line\n'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.ok((await box.boundingBox()).height <= 134, 'a very long message scrolls instead of filling the panel');
    await box.fill('');
    await call('store.set', 'chat', []);
    await call('history.clear');
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
  });

  await step('history: past chats and tasks are listed, searched, reopened and deleted', async () => {
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
    await tab('ai');
    await call('history.saveChat', { id: 'old-chat', messages: [{ role: 'user', content: 'Plan my Goa trip' }, { role: 'assistant', content: 'Go in December' }] });
    await call('store.set', 'chat', [{ role: 'user', content: 'Something else' }]);
    await page.click(`${view} .segmented button:has-text("History")`);
    const row = `${view} .history-row:has-text("Plan my Goa trip")`;
    await page.waitForSelector(row);
    await page.fill(`${view} input[aria-label="Search history"]`, 'december');
    await page.waitForTimeout(400);
    assert.equal(await page.locator(`${view} .history-row`).count(), 1, 'search looks inside the chat');
    await page.fill(`${view} input[aria-label="Search history"]`, 'nothing like this');
    await page.waitForSelector(`${view} .empty:has-text("Nothing found")`);
    await page.fill(`${view} input[aria-label="Search history"]`, '');
    await page.waitForSelector(row);
    await shot('98-history');
    await page.click(row);
    await page.waitForSelector(`${view} .bubble:has-text("Go in December")`);
    assert.equal(await call('store.get', 'chatId', null), 'old-chat', 'it continues the same chat');

    await page.click(`${view} .segmented button:has-text("History")`);
    await page.click(`${view} button:has-text("Memory")`);
    await page.fill(`${view} input[aria-label="Something to remember"]`, 'My shop is Asha Traders');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${view} .setting:has-text("Asha Traders")`);
    assert.equal((await call('store.get', 'memory', []))[0].text, 'My shop is Asha Traders');
    await call('store.set', 'memory', []);
    await page.click(`${view} button:has-text("Memory")`);
    await page.click(`${row} button[aria-label^="Delete"]`);
    await page.waitForSelector(row, { state: 'detached' });
    await call('history.clear');
    await call('store.set', 'chat', []);
    await page.click(`${view} .segmented button:has-text("Chat")`);
  });

  await step('permissions: Allow for this session and Turbo stop the questions, and can be undone', async () => {
    let answers = [];
    const server = require('http').createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...(answers.shift() || { content: 'All done' }) } }] }));
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { settings } = await call('settings.get');
    await call('settings.set', { ai: { ...settings.ai, provider: 'openai', openaiUrl: `http://127.0.0.1:${server.address().port}/v1`, models: { ...settings.ai.models, openai: 'test-model' } } });
    await call('ai.setKey', 'openai', 'test');
    await call('store.set', 'chat', []);
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
    const openAi = async () => {
      await call('notch.open');
      await call('notch.pin', true);
      await page.waitForTimeout(500);
      await tab('ai');
    };
    const command = (id) => ({ content: null, tool_calls: [{ id, type: 'function', function: { name: 'run_command', arguments: '{"command":"Write-Output hi"}' } }] });
    const runTask = async (text) => {
      await page.click(`${view} .segmented button:has-text("Agent")`);
      await page.fill(`${view} textarea[aria-label="Task for the AI"]`, text);
      await page.click(`${view} .agent-go`);
    };
    await openAi();
    await page.click(`${view} .segmented button:has-text("Chat")`);
    await page.waitForSelector(`${view} .permission-start`);
    await shot('99-new-chat-choices');

    answers = [command('a'), { content: 'First done' }];
    await runTask('First');
    await page.waitForSelector(`${view} .agent-ask button:has-text("Allow for this session")`, { timeout: 15000 });
    await page.click(`${view} .agent-ask button:has-text("Allow for this session")`);
    await page.waitForSelector(`${view} .agent-line:has-text("First done")`, { timeout: 15000 });

    await openAi();
    answers = [command('b'), { content: 'Second done' }];
    await runTask('Second');
    await page.waitForSelector(`${view} .agent-line:has-text("Second done")`, { timeout: 15000 });
    assert.equal(await page.locator(`${view} .agent-ask:visible`).count(), 0, 'it did not ask again in this session');

    await openAi();
    await page.click(`${view} .segmented button:has-text("Chat")`);
    await page.click(`${view} button[aria-label="New chat"]`);
    await page.waitForSelector(`${view} .permission-start button:has-text("Turbo")`);
    await page.click(`${view} .permission-start button:has-text("Turbo")`);
    await page.waitForSelector(`${view} button:has-text("Sure? It will never ask")`);
    assert.equal((await call('settings.get')).settings.ai.turbo, false, 'one click is not enough');
    await page.click(`${view} button:has-text("Sure? It will never ask")`);
    await page.waitForSelector(`${view} .turbo-chip:visible`);
    assert.equal((await call('settings.get')).settings.ai.turbo, true);
    await shot('99-turbo-on');

    answers = [command('c'), { content: 'Turbo done' }];
    await runTask('Third');
    await page.waitForSelector(`${view} .agent-line:has-text("Turbo done")`, { timeout: 15000 });

    await openAi();
    await page.click(`${view} .turbo-chip`);
    await page.waitForSelector(`${view} .turbo-chip`, { state: 'hidden' });
    assert.equal((await call('settings.get')).settings.ai.turbo, false, 'the badge turns it off');
    server.close();
    await call('ai.setKey', 'openai', '');
    await call('settings.set', { ai: settings.ai });
    await call('store.set', 'chat', []);
    await page.reload();
    await page.waitForSelector('#pill .pill-text');
  });

  await step('control panel: every page opens, shows real state, and only listed names get through', async () => {
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
    await tab('control');
    const open = (name) => page.click(`${view} .segmented button:has-text("${name}")`);
    await open('Quick');
    await until(async () => (await page.locator(`${view} .control-tile:not(:disabled)`).count()) >= 8, 'the tiles to read Windows', 20000);
    const real = await call('control.state');
    const tile = page.locator(`${view} .control-tile[title="Wi-Fi"]`);
    await until(async () => await tile.getAttribute('aria-pressed') === String(real.wifi === true), `the Wi-Fi tile to match ${JSON.stringify(real)}`, 10000);
    assert.equal(await page.evaluate(() => { const v = document.getElementById('views'); return v.scrollWidth > v.clientWidth + 1; }), false);
    await shot('60-control-quick');
    await open('VPN');
    await page.waitForFunction(() => document.querySelector('.view:not([hidden]) .card:not([hidden]) .list-row, .view:not([hidden]) .card:not([hidden]) .faint'));
    await shot('61-control-vpn');
    await open('Bluetooth');
    await until(async () => !(await page.locator(`${view} .card:not([hidden])`).first().textContent()).includes('Looking...'), 'the device list', 20000);
    await shot('62-control-bluetooth');
    await open('Sound');
    await page.waitForSelector(`${view} .card:not([hidden]) .list-row`, { timeout: 15000 });
    await shot('63-control-sound');
    await open('PC');
    await page.click(`${view} .control-actions .btn:text-is("Shut down")`);
    await page.waitForSelector(`${view} .btn:has-text("Sure? Click again")`);
    await shot('64-control-pc');
    await page.waitForFunction(() => [...document.querySelectorAll('.view:not([hidden]) .btn')].some((button) => button.textContent === 'Shut down'), null, { timeout: 5000 });
    await open('Quick');

    await assert.rejects(call('control.set', 'format-disk', true), /Unknown setting/);
    await assert.rejects(call('control.action', 'format-disk'), /Unknown action/);
    await assert.rejects(call('control.open', 'calc.exe'), /Unknown page/);
    await assert.rejects(call('control.power', 'turbo'), /Unknown power mode/);
    await assert.rejects(call('control.display', '/x'), /Unknown screen mode/);
    await assert.rejects(call('control.vpnConnect', 'no such vpn'), /No saved VPN/);
  });

  await step('phone: the page offers phone control, only after it is allowed', async () => {
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
    await tab('drop');
    await page.click(`${view} button:has-text("Start sharing")`);
    await page.waitForSelector(`${view} input[aria-label="Let the phone control this PC"]`);
    const { url } = await call('drop.status');
    const post = () => fetch(`${url}remote`, { method: 'POST', body: '{"type":"nothing"}' });
    assert.equal((await post()).status, 403, 'the phone cannot control the PC until allowed');
    await page.check(`${view} input[aria-label="Let the phone control this PC"]`);
    await page.waitForTimeout(200);
    assert.equal((await post()).status, 400, 'allowed, and an unknown action is still refused');
    assert.match(await (await fetch(url)).text(), /Control PC/);
    await shot('55-phone-remote');
    await call('drop.stop');
  });

  await step('your own API: add it, find models, test it, run the agent on it, remove it', async () => {
    const seen = [];
    let answers = [];
    const server = require('http').createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'small-model' }, { id: 'big-model' }] })); return; }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        seen.push({ body, auth: req.headers.authorization });
        const sent = JSON.stringify(body);
        let message = { content: 'OK' };
        if (answers.length) message = answers.shift();
        else if (sent.includes('"ping"')) message = { content: null, tool_calls: [{ id: 'p', type: 'function', function: { name: 'ping', arguments: '{"word":"hi"}' } }] };
        else if (sent.includes('image_url')) message = { content: 'Red' };
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...message } }] }));
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const before = (await call('settings.get')).settings.ai;
    await call('notch.open');
    await call('notch.pin', true);
    await page.waitForTimeout(400);
    await tab('settings');
    await page.click(`${view} .settings-link:has-text("AI")`);
    await page.click(`${view} button:has-text("Add another API")`);
    await page.fill(`${view} input[aria-label="API address"]`, `http://127.0.0.1:${server.address().port}/v1`);
    await page.keyboard.press('Tab');
    await page.locator(`${view} .setting:has-text("Name") input`).first().fill('Test Cloud');
    await page.keyboard.press('Tab');
    await page.waitForSelector(`${view} select option:has-text("Test Cloud")`, { state: 'attached' });
    await page.locator(`${view} input[type="password"]`).first().fill('secret-key-1234');
    await page.keyboard.press('Tab');
    await page.waitForSelector(`${view} .setting:has-text("Saved ••••1234")`);
    await page.click(`${view} .setting button:has-text("Find")`);
    await page.waitForFunction(() => document.querySelectorAll('#api-models option').length === 2);
    await page.fill(`${view} input[aria-label="Model"]`, 'small-model');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await shot('95-your-own-api');
    await page.click(`${view} button:has-text("Test this API")`);
    await until(async () => /It works\. Tools: yes\. Pictures: yes\./.test(await page.locator(`${view} .api-test-status`).textContent()), 'the test result', 15000);
    const provider = (await call('settings.get')).settings.ai.provider;
    assert.equal(seen[0].auth, 'Bearer secret-key-1234');
    assert.equal(seen[0].body.model, 'small-model');
    assert.ok(!JSON.stringify(await call('settings.get')).includes('secret-key'), 'the key never reaches the page');
    await page.locator(`${view} .setting:has-text("Name") input`).first().fill('Test Cloud 2');
    await page.keyboard.press('Tab');
    await page.waitForSelector(`${view} select option:has-text("Test Cloud 2")`, { state: 'attached' });
    assert.deepEqual((await call('settings.get')).settings.ai.caps[`${provider}:small-model`], { tools: true, vision: true }, 'a later change keeps the result');

    await tab('ai');
    await page.click(`${view} .segmented button:has-text("Chat")`);
    await page.click(`${view} .segmented button:has-text("Agent")`);
    await page.selectOption(`${view} select[aria-label="Permission"]`, 'task');
    answers = [
      { content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'update_plan', arguments: '{"plan":"Say hello"}' } }] },
      { content: null, tool_calls: [{ id: 'b', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: "Write-Output 'hello from the terminal'" }) } }] },
      { content: 'All done here' },
    ];
    const count = seen.length;
    await page.fill(`${view} textarea[aria-label="Task for the AI"]`, 'Say hello');
    await page.click(`${view} .agent-go`);
    await page.waitForSelector(`${view} .agent-ask:has-text("hello from the terminal")`, { timeout: 15000 });
    await shot('96-command-permission');
    assert.equal(await page.locator(`${view} .agent-ask button:has-text("Allow for this task")`).count(), 0, 'a command always asks');
    await page.click(`${view} .agent-ask button:has-text("Allow once")`);
    await page.waitForSelector(`${view} .agent-line:has-text("All done here")`, { timeout: 15000 });
    const final = seen.at(-1).body.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'b').content;
    assert.match(final, /^Exit code 0\nhello from the terminal/);
    assert.ok(seen[count].body.tools.some((tool) => tool.function.name === 'run_command'));
    await call('notch.open'); // a finished task closes the notch
    await call('notch.pin', true);
    await page.waitForTimeout(500);
    await page.selectOption(`${view} select[aria-label="Permission"]`, 'ask');
    await page.click(`${view} .segmented button:has-text("Chat")`);

    await tab('settings');
    await page.click(`${view} .settings-link:has-text("AI")`);
    await page.click(`${view} button:has-text("Remove this API")`);
    await page.waitForFunction(() => !document.querySelector('.view:not([hidden]) button.btn:not([hidden])')?.textContent.includes('Remove this API'));
    assert.equal(await call('ai.keyHint', provider), '', 'its key is deleted too');
    server.close();
    await call('settings.set', { ai: before });
  });

  await step('settings: what the AI remembers can be read and deleted, tool servers can be added', async () => {
    await call('store.set', 'memory', [{ id: 'm1', text: 'My shop is Asha Traders', at: 1 }]);
    await page.click(`${view} .settings-link:has-text("Privacy")`);
    await page.click(`${view} .settings-link:has-text("AI")`);
    await page.waitForSelector(`${view} .setting:has-text("Asha Traders")`);
    await page.click(`${view} .setting:has-text("Asha Traders") button[aria-label="Forget this"]`);
    await page.waitForSelector(`${view} .setting:has-text("Asha Traders")`, { state: 'detached' });
    assert.deepEqual(await call('store.get', 'memory', []), []);

    await page.fill(`${view} input[aria-label="Tool server name"]`, 'Calculator');
    await page.fill(`${view} input[aria-label="Command or address"]`, process.execPath);
    await page.fill(`${view} input[aria-label="Arguments"]`, `"${path.join(__dirname, 'mcp-server.js')}"`);
    await page.click(`${view} button:has-text("Add server")`);
    await page.waitForSelector(`${view} .setting:has-text("Calculator")`);
    await page.click(`${view} .setting:has-text("Calculator") button:has-text("Test")`);
    await page.waitForSelector(`${view} .setting:has-text("Works, 2 tools")`, { timeout: 20000 });
    await shot('97-tool-servers');
    await page.click(`${view} .setting:has-text("Calculator") button[aria-label="Delete Calculator"]`);
    await page.waitForSelector(`${view} .setting:has-text("Calculator")`, { state: 'detached' });
    await call('notch.pin', false);
    await call('notch.close');
  });

  await step('security: unknown methods and stores are refused', async () => {
    await assert.rejects(call('fs.read', 'C:/Windows/win.ini'), /Unknown method/);
    await assert.rejects(call('store.get', 'secrets'), /not allowed/);
    await assert.rejects(call('links.open', 'javascript:alert(1)'), /Links must/);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
  });

  await step('no console errors or warnings', async () => {
    assert.deepEqual(problems.filter((text) => !/Electron Security Warning/.test(text)), []);
  });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed. Screenshots: ${shots}`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

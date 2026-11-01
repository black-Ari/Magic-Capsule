'use strict';

// A tiny check against your real AI provider, using the key saved in Magic Capsule. It costs one or two small
// requests, prints the key's last 4 characters at most, and does not touch your chat history.
// node tests/live-ai.js          one short chat message
// node tests/live-ai.js agent    also one agent task, which sends one screenshot to your provider
const os = require('os');
const path = require('path');
const dep = require('../lib/deps');

const { _electron: electron } = dep('playwright-core');
const WORKSPACE = path.join(os.homedir(), '.build_workspaces', 'poni');
const TIMEOUT_MS = 60000;

(async () => {
  require('./guard')();
  const app = await electron.launch({
    executablePath: path.join(WORKSPACE, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(__dirname, '..')],
  });
  let failed = false;
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#pill', { state: 'attached', timeout: 15000 });
    const call = (method, ...args) => page.evaluate(([m, a]) => window.nook.call(m, ...a), [method, args]);
    const { settings } = await call('settings.get');
    const provider = settings.ai.provider;
    console.log(`provider ${provider}, model ${settings.ai.models[provider] || '(none)'}, key ${await call('ai.keyHint', provider) || '(none)'}`);

    const chat = await page.evaluate((limit) => new Promise((resolve) => {
      const id = crypto.randomUUID();
      let text = '';
      const stop = setTimeout(() => resolve({ error: 'no answer in time' }), limit);
      window.nook.on('ai:delta', (event) => { if (event.id === id) text += event.text; });
      window.nook.on('ai:done', (event) => { if (event.id === id) { clearTimeout(stop); resolve({ text }); } });
      window.nook.on('ai:error', (event) => { if (event.id === id) { clearTimeout(stop); resolve({ error: event.message }); } });
      window.nook.call('ai.start', { id, mode: 'chat', messages: [{ role: 'user', content: 'Reply with exactly the word OK.' }] });
    }), TIMEOUT_MS);
    if (chat.error) failed = true;
    console.log(chat.error ? `chat FAILED: ${chat.error}` : `chat ok: ${chat.text.trim().slice(0, 80)}`);

    if (process.argv[2] === 'agent' && !chat.error) {
      const task = await page.evaluate((limit) => new Promise((resolve) => {
        const id = crypto.randomUUID();
        const lines = [];
        const stop = setTimeout(() => resolve({ lines, error: 'no end in time' }), limit);
        window.nook.on('agent:ask', () => window.nook.call('agent.answer', { decision: 'stop' })); // never allow an action here
        window.nook.on('agent:update', (event) => {
          if (event.id !== id) return;
          lines.push(`${event.type}: ${event.text}`);
          if (event.type === 'done') { clearTimeout(stop); resolve({ lines, failed: event.failed }); }
        });
        window.nook.call('agent.start', { id, text: 'Take one screenshot, then say in one short sentence how many windows you can see. Do nothing else.', attachmentIds: [], mode: 'ask' });
      }), TIMEOUT_MS * 2);
      if (task.error || task.failed) failed = true;
      for (const line of task.lines) console.log(`agent ${line.slice(0, 160)}`);
      if (task.error) console.log(`agent FAILED: ${task.error}`);
    }
  } finally {
    await app.close();
  }
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error(err.message.split('\n').slice(0, 5).join('\n'));
  process.exitCode = 1;
});

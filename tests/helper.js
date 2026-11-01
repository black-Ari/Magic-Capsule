'use strict';

// Checks that the compiled helper and PowerShell answer alike, that other commands wake PowerShell and let
// it rest, and that a broken helper program hands over to PowerShell. Reads from Windows and writes back
// the same volume and microphone values, so nothing changes. Needs no mouse or keyboard.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Helper } = require('../lib/helper');

const SERVICE = path.join(__dirname, '..', 'lib', 'helper-service.exe');
const WATCH_MS = 3500;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function started(helper) {
  return new Promise((resolve, reject) => {
    helper.once('ready', resolve);
    helper.once('failed', reject);
    helper.start();
  });
}

async function stopped(proc) {
  for (let i = 0; i < 50 && proc.exitCode === null; i += 1) await sleep(100);
  assert.notEqual(proc.exitCode, null, 'the process should end when asked');
}

async function sample(helper) {
  const events = {};
  for (const name of ['foreground', 'media', 'volume']) helper.on(name, (data) => { events[name] = data; });
  await started(helper);
  await helper.call('media.refresh');
  await sleep(WATCH_MS);
  const volume = await helper.call('volume.get');
  await helper.call('volume.set', { percent: volume.percent });
  const mic = await helper.call('mic.get').catch((err) => err.message);
  if (typeof mic === 'boolean') await helper.call('mic.set', { muted: mic });
  return {
    events,
    volume,
    mic,
    locks: await helper.call('locks.get'),
    net: await helper.call('net.totals'),
  };
}

const shape = (value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item]));

(async () => {
  assert.ok(fs.existsSync(SERVICE), 'run node scripts\\build-helper.js first');

  const service = new Helper();
  assert.equal(service.useService, true);
  const fast = await sample(service);
  console.log('compiled helper:', JSON.stringify({ ...fast, events: { ...fast.events, media: fast.events.media?.title ?? null } }));

  const powershell = new Helper({ service: path.join(os.tmpdir(), 'no-such-helper.exe') });
  assert.equal(powershell.useService, false);
  const slow = await sample(powershell);
  const { proc: slowProc } = powershell.main;

  assert.deepEqual(fast.volume, slow.volume);
  assert.deepEqual(fast.events.volume, slow.events.volume);
  assert.deepEqual(fast.mic, slow.mic);
  assert.equal(fast.locks, slow.locks);
  assert.deepEqual(shape(fast.net), shape(slow.net));
  assert.deepEqual(shape(fast.events.foreground), shape(slow.events.foreground));
  assert.equal(fast.events.foreground.app, slow.events.foreground.app);
  assert.equal(fast.events.foreground.fullscreen, slow.events.foreground.fullscreen);
  if (fast.events.media) {
    assert.deepEqual(shape(fast.events.media), shape(slow.events.media));
    for (const key of ['app', 'title', 'artist', 'album', 'playing', 'duration', 'canSeek']) assert.equal(fast.events.media[key], slow.events.media[key], key);
  } else {
    assert.equal(slow.events.media ?? null, null);
  }
  console.log('ok   both give the same answers');

  await assert.rejects(powershell.call('no.such.command'), /unknown command/);
  await assert.rejects(service.main.call('no.such.command', {}, 3000), /unknown command/);
  powershell.stop();
  await stopped(slowProc);

  let readyCount = 0;
  service.on('ready', () => { readyCount += 1; });
  const wokeAt = Date.now();
  const apps = await service.call('top.apps');
  const wakeMs = Date.now() - wokeAt;
  assert.ok(Array.isArray(apps) && apps[0].name && apps[0].bytes > 0);
  const secondAt = Date.now();
  await service.call('top.apps');
  console.log(`ok   other commands wake PowerShell: first answer ${wakeMs} ms, next ${Date.now() - secondAt} ms`);

  const link = await service.waking;
  assert.ok(service.restTimer, 'a rest should be planned');
  service.restPowerShell();
  await stopped(link.proc);
  assert.equal(service.waking, null);
  assert.ok((await service.call('top.apps')).length > 0, 'it should wake again');
  assert.equal(readyCount, 0, 'PowerShell waking is not the helper starting');
  console.log('ok   PowerShell rests and wakes again');

  const { proc } = service.main;
  const secondLink = await service.waking;
  service.stop();
  await Promise.all([stopped(proc), stopped(secondLink.proc)]);
  console.log('ok   both end when asked');

  const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'helper-test-')), 'broken.exe');
  fs.writeFileSync(broken, 'not a program');
  const rescued = new Helper({ service: broken });
  assert.equal(rescued.useService, true);
  await started(rescued);
  assert.equal(rescued.useService, false);
  assert.ok((await rescued.call('volume.get')).percent >= 0);
  rescued.stop();
  fs.rmSync(path.dirname(broken), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  console.log('ok   a broken helper program hands over to PowerShell');
  process.exit(0);
})().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});

'use strict';

// node tests/unit.js
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');

// These modules only touch Electron at run time, so plain Node just needs the import to resolve.
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  return request === 'electron' ? {} : originalLoad.call(this, request, ...rest);
};

const { expand, wallToUtc } = require('../lib/calendar');
const wifi = require('../lib/wifi');
const { PhoneDrop, lanAddresses, safeFileName } = require('../lib/drop');
const { streamGemini, streamOpenAi } = require('../lib/ai');
const { streamClaude } = require('../lib/ai-claude');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const ical = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const event = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const utc = (text) => new Date(text).getTime();
const FROM = utc('2026-01-01T00:00:00Z');
const TO = utc('2027-06-01T00:00:00Z');

test('calendar: named zone converts to UTC', () => {
  const [found] = expand(ical(event('UID:a', 'SUMMARY:Standup', 'DTSTART;TZID=Asia/Kolkata:20261103T100000', 'DTEND;TZID=Asia/Kolkata:20261103T103000')), FROM, TO, 'Work');
  assert.equal(found.start, utc('2026-11-03T04:30:00Z'));
  assert.equal(found.end - found.start, 30 * 60000);
  assert.equal(found.source, 'Work');
});

test('calendar: Outlook Windows zone name', () => {
  const [found] = expand(ical(event('UID:a', 'SUMMARY:x', 'DTSTART;TZID=India Standard Time:20261103T100000')), FROM, TO);
  assert.equal(found.start, utc('2026-11-03T04:30:00Z'));
});

test('calendar: UTC and all-day events', () => {
  const found = expand(ical(
    event('UID:a', 'SUMMARY:utc', 'DTSTART:20261103T100000Z'),
    event('UID:b', 'SUMMARY:day', 'DTSTART;VALUE=DATE:20261104', 'DTEND;VALUE=DATE:20261105'),
  ), FROM, TO);
  assert.equal(found[0].start, utc('2026-11-03T10:00:00Z'));
  assert.equal(found[1].allDay, true);
  assert.equal(found[1].start, new Date(2026, 10, 4).getTime());
});

test('calendar: folded lines and escapes', () => {
  const [found] = expand(ical(event('UID:a', 'SUMMARY:Long tit\r\n le\\, with comma', 'LOCATION:Room\\; 4', 'DTSTART:20261103T100000Z')), FROM, TO);
  assert.equal(found.title, 'Long title, with comma');
  assert.equal(found.location, 'Room; 4');
});

test('calendar: weekly BYDAY with COUNT and EXDATE', () => {
  const found = expand(ical(event('UID:w', 'SUMMARY:Gym', 'DTSTART:20261102T100000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', 'EXDATE:20261104T100000Z')), FROM, TO);
  assert.deepEqual(found.map((item) => new Date(item.start).toISOString().slice(0, 10)), ['2026-11-02', '2026-11-09', '2026-11-11']);
});

test('calendar: monthly last Friday and yearly', () => {
  const lastFriday = expand(ical(event('UID:m', 'SUMMARY:Review', 'DTSTART:20261030T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3')), FROM, TO);
  assert.deepEqual(lastFriday.map((item) => new Date(item.start).toISOString().slice(0, 10)), ['2026-10-30', '2026-11-27', '2026-12-25']);
  const yearly = expand(ical(event('UID:y', 'SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20260315', 'RRULE:FREQ=YEARLY')), FROM, TO);
  assert.equal(yearly.length, 2);
});

test('calendar: UNTIL stops the series and INTERVAL skips', () => {
  const found = expand(ical(event('UID:d', 'SUMMARY:x', 'DTSTART:20261101T100000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261107T100000Z')), FROM, TO);
  assert.deepEqual(found.map((item) => new Date(item.start).getUTCDate()), [1, 3, 5, 7]);
});

test('calendar: repeating event keeps wall clock across daylight saving', () => {
  const found = expand(ical(event('UID:ny', 'SUMMARY:x', 'DTSTART;TZID=America/New_York:20261026T090000', 'RRULE:FREQ=WEEKLY;COUNT=3')), FROM, TO);
  const hours = found.map((item) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(item.start));
  assert.deepEqual(hours, ['09', '09', '09']);
  assert.equal(new Date(found[0].start).getUTCHours(), 13);
  assert.equal(new Date(found[2].start).getUTCHours(), 14);
});

test('calendar: moved and cancelled occurrences', () => {
  const found = expand(ical(
    event('UID:r', 'SUMMARY:Sync', 'DTSTART:20261102T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=3'),
    event('UID:r', 'SUMMARY:Sync moved', 'RECURRENCE-ID:20261109T100000Z', 'DTSTART:20261110T150000Z'),
    event('UID:r', 'STATUS:CANCELLED', 'RECURRENCE-ID:20261116T100000Z', 'DTSTART:20261116T100000Z'),
  ), FROM, TO);
  assert.deepEqual(found.map((item) => item.title), ['Sync', 'Sync moved']);
  assert.equal(found[1].start, utc('2026-11-10T15:00:00Z'));
});

test('calendar: cancelled and out-of-window events are dropped', () => {
  const found = expand(ical(
    event('UID:c', 'SUMMARY:gone', 'STATUS:CANCELLED', 'DTSTART:20261103T100000Z'),
    event('UID:o', 'SUMMARY:old', 'DTSTART:20200103T100000Z'),
  ), FROM, TO);
  assert.equal(found.length, 0);
});

test('calendar: unknown zone falls back to local time without crashing', () => {
  const ms = wallToUtc({ y: 2026, m: 10, d: 3, h: 10, mi: 0, s: 0 }, 'Not/AZone');
  assert.equal(ms, new Date(2026, 10, 3, 10).getTime());
});

test('calendar: finds the meeting link to join', () => {
  const found = expand(ical(
    event('UID:a', 'SUMMARY:x', 'DTSTART:20261103T100000Z', 'DESCRIPTION:Join: https://meet.google.com/abc-defg-hij\\nThanks'),
    event('UID:b', 'SUMMARY:y', 'DTSTART:20261104T100000Z', 'LOCATION:https://us02web.zoom.us/j/123?pwd=x'),
    event('UID:c', 'SUMMARY:z', 'DTSTART:20261105T100000Z', 'DESCRIPTION:see https://example.com/page'),
  ), FROM, TO);
  assert.deepEqual(found.map((item) => item.join), ['https://meet.google.com/abc-defg-hij', 'https://us02web.zoom.us/j/123?pwd=x', '']);
});

test('smart tasks: English and Hinglish phrases', async () => {
  const { parseTask } = await import('../renderer/smart-date.mjs');
  const now = new Date(2026, 10, 2, 15, 0).getTime(); // Monday 2 Nov 2026, 3 pm
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
  const cases = [
    ['Pay rent tomorrow 9am', 'Pay rent', at(3, 9)],
    ['Call mom kal 7 baje', 'Call mom', at(3, 7)],
    ['Call mom kal sham 7 baje', 'Call mom', at(3, 19)],
    ['Meeting aaj 5pm', 'Meeting', at(2, 17)],
    ['Gym parso subah 6', 'Gym', at(4, 6)],
    ['Dinner at 7', 'Dinner', at(2, 19)],
    ['Early call at 2pm', 'Early call', at(3, 14)],
    ['Dentist friday 4:30pm', 'Dentist', at(6, 16, 30)],
    ['Client call shukravar 11am', 'Client call', at(6, 11)],
    ['Review on mon', 'Review', at(9, 9)],
    ['Take medicine in 30 min', 'Take medicine', now + 30 * 60000],
    ['Chai 2 ghante baad', 'Chai', now + 2 * 3600000],
    ['Train 18:45', 'Train', at(2, 18, 45)],
  ];
  for (const [input, text, due] of cases) {
    const parsed = parseTask(input, now);
    assert.equal(parsed.text, text, input);
    assert.equal(parsed.due, due, `${input}: got ${new Date(parsed.due)}`);
  }
});

test('smart tasks: ordinary text is left alone', async () => {
  const { parseTask } = await import('../renderer/smart-date.mjs');
  const now = new Date(2026, 10, 2, 15, 0).getTime();
  for (const input of ['Buy 7 mangoes', 'Read chapter 12', 'Call Sunil', 'Watch 2 hours of lectures', 'Fix the Monday report']) {
    const parsed = parseTask(input, now);
    if (input === 'Fix the Monday report') continue; // a named weekday is a date on purpose
    assert.deepEqual(parsed, { text: input, due: null, repeat: null }, input);
  }
});

test('smart tasks: repeats move to the next matching time', async () => {
  const { nextOccurrence, parseTask } = await import('../renderer/smart-date.mjs');
  const now = new Date(2026, 10, 2, 15, 0).getTime(); // Monday
  const daily = parseTask('Vitamins every day 8am', now);
  assert.equal(daily.text, 'Vitamins');
  assert.equal(daily.due, new Date(2026, 10, 3, 8).getTime());
  const weekly = parseTask('Standup every mon 10am', now);
  assert.equal(weekly.due, new Date(2026, 10, 9, 10).getTime(), 'this Monday 10am has already gone');
  assert.deepEqual(weekly.repeat.days, [1]);
  assert.equal(nextOccurrence(weekly.repeat, weekly.repeat, weekly.due), new Date(2026, 10, 16, 10).getTime());
  assert.equal(parseTask('Yoga har somvar subah 6', now).repeat.days[0], 1);
  assert.equal(parseTask('Pani roz 9am', now).text, 'Pani');
});

test('avatar: saved data cannot inject markup, every option draws', async () => {
  const { OPTIONS, PRESETS, avatarSvg, normalize, randomAvatar } = await import('../renderer/avatar.mjs');
  const evil = '"><script>alert(1)</script>';
  const markup = avatarSvg({ skin: evil, base: evil, item: evil, outfitColor: 'red"/>', calm: 'yes' });
  assert.ok(!markup.includes('script') && !markup.includes('alert('));
  assert.equal(normalize({ calm: 'yes' }).calm, false);
  assert.equal(normalize({ base: 'nothing' }).base, 'cat');
  for (const [key, choices] of Object.entries(OPTIONS)) {
    for (const [value] of choices) {
      const svg = avatarSvg({ outfit: 'hero', [key]: value });
      assert.ok(svg.startsWith('<svg') && !svg.includes('undefined') && !svg.includes('NaN'), `${key}=${value}`);
    }
  }
  assert.equal(PRESETS.Gods.length, 7);
  assert.ok(PRESETS.Gods.every(([, avatar]) => avatar.calm === true), 'sacred figures stay composed');
  for (let i = 0; i < 50; i += 1) assert.ok(!avatarSvg(randomAvatar()).includes('undefined'));
});

const fakeTools = () => {
  const ran = [];
  return { ran, run: async (name, input) => { ran.push(name); return name === 'screenshot' ? { text: 'shot', image: { media: 'image/jpeg', data: 'AAAA' } } : { text: `${name} ok ${JSON.stringify(input)}` }; } };
};

function testAgent({ script, decisions = [], cursors = [], extra = {} }) {
  const { Agent } = require('../lib/agent');
  const events = [];
  const tools = fakeTools();
  const turns = {
    addUser(text) { turns.users.push(text); }, addResults(results) { turns.results.push(results); }, results: [], users: [],
    next: async () => script.shift() || { text: 'All done', calls: [] },
  };
  const agent = new Agent({
    createTurns: (system) => { turns.system = system; return turns; }, tools, getSkills: () => [], ...extra,
    send: (channel, data) => {
      events.push([channel, data]);
      if (channel === 'agent:ask') setImmediate(() => agent.answer(decisions.shift() || { decision: 'stop' }));
    },
    getCursor: () => cursors.shift() || { x: 0, y: 0 },
    onStart() {}, onEnd() {}, beforeLook: async () => {}, askOnScreen() {}, afterAsk() {},
  });
  return { agent, events, tools, turns };
}

const finished = (run) => new Promise((resolve) => {
  const poll = setInterval(() => { if (!run.agent.running) { clearInterval(poll); resolve(); } }, 5);
});
const call = (name, input = {}) => ({ id: name, name, input });

test('agent: asks before acting, stops when declined', async () => {
  const run = testAgent({ script: [{ text: '', calls: [call('screenshot'), call('click', { x: 1, y: 2 })] }, { text: '', calls: [call('type_text', { text: 'x' })] }], decisions: [{ decision: 'stop' }] });
  run.agent.start({ id: 't', text: 'go', mode: 'ask' });
  await finished(run);
  assert.deepEqual(run.tools.ran, ['screenshot'], 'looking is free, the declined click never ran');
  assert.ok(run.events.some(([channel, data]) => channel === 'agent:update' && /declined/.test(data.text)));
});

test('agent: allow for this task skips later prompts, but save_file always asks', async () => {
  const run = testAgent({
    script: [{ text: '', calls: [call('click', { x: 1, y: 2 })] }, { text: '', calls: [call('press_keys', { keys: 'a' })] }, { text: '', calls: [call('save_file', { path: 'x', text: 'y' })] }],
    decisions: [{ decision: 'task' }, { decision: 'once' }],
  });
  run.agent.start({ id: 't', text: 'go', mode: 'ask' });
  await finished(run);
  assert.deepEqual(run.tools.ran, ['click', 'press_keys', 'save_file']);
  assert.equal(run.events.filter(([channel]) => channel === 'agent:ask').length, 2);
});

test('agent: moving the mouse hands control back', async () => {
  const run = testAgent({
    script: [{ text: '', calls: [call('click', { x: 1, y: 2 })] }, { text: '', calls: [call('click', { x: 3, y: 4 })] }],
    cursors: [{ x: 100, y: 100 }, { x: 400, y: 400 }],
  });
  run.agent.start({ id: 't', text: 'go', mode: 'task' });
  await finished(run);
  assert.deepEqual(run.tools.ran, ['click']);
  assert.ok(run.events.some(([, data]) => /moved the mouse/.test(data.text || '')));
});

test('agent: a step limit ends a task that never finishes', async () => {
  const run = testAgent({ script: Array.from({ length: 60 }, () => ({ text: '', calls: [call('wait', { seconds: 1 })] })) });
  run.agent.start({ id: 't', text: 'go', mode: 'task' });
  await finished(run);
  assert.equal(run.tools.ran.length, 40);
});

test('agent: skills reach the prompt, switched-off ones do not', () => {
  const { withSkills } = require('../lib/skills');
  const prompt = withSkills('BASE', [{ name: 'Invoices', text: 'Save in D:', mode: 'always' }, { name: 'Off', text: 'secret', mode: 'off' }]);
  assert.ok(prompt.startsWith('BASE') && prompt.includes('Save in D:') && !prompt.includes('secret'));
});

test('agent: Claude tool loop through the SDK keeps history append-only', async () => {
  const { ClaudeTurns } = require('../lib/ai-claude');
  const replies = [
    { content: [{ type: 'text', text: 'Looking' }, { type: 'tool_use', id: 'u1', name: 'screenshot', input: {} }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' },
  ];
  const mock = await mockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 }, ...replies.shift() }));
  });
  const turns = new ClaudeTurns({ apiKey: 'k', model: 'claude-opus-5-5', system: 'S', tools: [{ name: 'screenshot', description: 'd', input: { type: 'object', properties: {} } }], baseURL: mock.url });
  turns.addUser('Do it', []);
  const first = await turns.next();
  assert.equal(first.text, 'Looking');
  assert.deepEqual(first.calls, [{ id: 'u1', name: 'screenshot', input: {} }]);
  turns.addResults([{ call: first.calls[0], text: 'shot', image: { media: 'image/jpeg', data: 'AAAA' } }]);
  assert.deepEqual((await turns.next()).calls, []);
  const sent = mock.seen[1].body.messages;
  assert.equal(sent[1].role, 'assistant');
  assert.equal(sent[2].content[0].tool_use_id, 'u1');
  assert.equal(sent[2].content[0].content[1].type, 'image');
  assert.equal(mock.seen[0].body.tool_choice, undefined, 'forced tool choice is not allowed on this model');
  assert.equal(mock.seen[0].body.fallbacks, 'default');
  mock.close();
});

test('agent: Gemini returns model content unchanged and sends images back', async () => {
  const { GeminiTurns } = require('../lib/agent-models');
  const model = { role: 'model', parts: [{ functionCall: { name: 'screenshot', args: {} }, thoughtSignature: 'sig' }] };
  const mock = await mockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: mock.seen.length === 1 ? model : { role: 'model', parts: [{ text: 'Done' }] } }] }));
  });
  const turns = new GeminiTurns({ apiKey: 'k', model: 'm', system: 'S', tools: [{ name: 'screenshot', description: 'd', input: { type: 'object', properties: {}, additionalProperties: false } }], baseURL: mock.url });
  turns.addUser('Do it', []);
  const first = await turns.next();
  assert.equal(first.calls[0].name, 'screenshot');
  turns.addResults([{ call: first.calls[0], text: 'shot', image: { media: 'image/jpeg', data: 'AAAA' } }]);
  assert.equal((await turns.next()).text, 'Done');
  assert.equal(mock.seen[0].body.tools[0].functionDeclarations[0].parameters, undefined, 'a tool with no arguments has no parameters');
  const contents = mock.seen[1].body.contents;
  assert.equal(contents[1].parts[0].thoughtSignature, 'sig');
  assert.ok(contents[2].parts[0].functionResponse && contents[2].parts[1].inlineData);
  mock.close();
});

test('agent: a job from Chat asks before its first look at the screen', async () => {
  const run = testAgent({ script: [{ text: '', calls: [call('screenshot')] }, { text: '', calls: [call('screenshot')] }], decisions: [{ decision: 'task' }] });
  run.agent.start({ id: 't', text: 'go', mode: 'ask', fromChat: true });
  await finished(run);
  assert.deepEqual(run.tools.ran, ['screenshot', 'screenshot']);
  assert.equal(run.events.filter(([channel]) => channel === 'agent:ask').length, 1);
});

test('chat: a PC job is caught even when split, normal replies pass untouched', () => {
  const { HandoffWatch } = require('../lib/ai');
  const job = new HandoffWatch();
  assert.equal(['  [[', 'PC', ']] open', ' Excel'].map((chunk) => job.push(chunk)).join(''), '');
  assert.deepEqual(job.finish(), { task: 'open Excel' });
  const normal = new HandoffWatch();
  assert.equal(['[', 'see this', ' link'].map((chunk) => normal.push(chunk)).join(''), '[see this link');
  assert.deepEqual(normal.finish(), {});
  const short = new HandoffWatch();
  assert.equal(short.push('['), '');
  assert.deepEqual(short.finish(), { text: '[' });
  const empty = new HandoffWatch();
  empty.push('[[PC]]');
  assert.deepEqual(empty.finish(), { text: '[[PC]]' });
});

test('attachments: text is read, binaries are described, nothing crashes', () => {
  const attachments = require('../lib/attachments');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-att-'));
  const text = path.join(dir, 'notes.xyz');
  const binary = path.join(dir, 'data.bin');
  fs.writeFileSync(text, 'hello');
  fs.writeFileSync(binary, Buffer.from([1, 0, 2, 0, 3]));
  const [first, second] = attachments.add([text, binary]);
  assert.equal(first.kind, 'text');
  assert.equal(second.kind, 'other');
  assert.equal(first.text, undefined, 'contents stay in the main process');
  const prompt = attachments.promptWith('Summarise', attachments.find([first.id, second.id]));
  assert.ok(prompt.includes('hello') && prompt.includes('data.bin') && prompt.endsWith('Summarise'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('skills: a skill named in a message applies even when switched off', () => {
  const { withSkills } = require('../lib/skills');
  const skills = [{ name: 'Invoices', text: 'GST rules', mode: 'off' }];
  assert.ok(!withSkills('BASE', skills).includes('GST rules'));
  assert.ok(withSkills('BASE', skills, ['Invoices']).includes('GST rules'));
});

test('skills: Auto picks the right skill from the message', () => {
  const { chooseSkills } = require('../lib/skills');
  const { SKILL_LIBRARY } = require('../lib/skill-library');
  const skills = SKILL_LIBRARY.map((skill) => ({ ...skill, mode: skill.mode || 'auto' }));
  const pick = (text) => chooseSkills(skills, text);
  assert.deepEqual(pick('ek invoice banao GST ke saath'), ['Business documents']);
  assert.deepEqual(pick('mera pc bahut slow hai'), ['PC speed check']);
  assert.deepEqual(pick('Downloads folder sort kar do'), ['File organiser']);
  assert.deepEqual(pick('customer ko whatsapp message likh do'), ['Message writer']);
  assert.deepEqual(pick('python me ye bug fix karo'), ['Coding helper']);
  assert.deepEqual(pick('ye otp wala message scam hai kya'), ['Scam check', 'Message writer']);
  assert.deepEqual(pick('एक बिल बनाओ'), ['Business documents'], 'Hindi works');
  assert.deepEqual(pick('hello kaise ho'), [], 'small talk uses no skill');
  assert.deepEqual(pick('billing'), ['Business documents']);
  assert.deepEqual(pick('happy'), [], 'a keyword inside another word does not count');
});

test('skills: modes, your own words, and the limit', () => {
  const { chooseSkills, findSkill, skillCatalog, skillMode } = require('../lib/skills');
  const own = { name: 'Kharcha tracker', text: 'x', mode: 'auto', keywords: ['kharcha', 'expense report'] };
  assert.deepEqual(chooseSkills([own], 'aaj ka kharcha likho'), ['Kharcha tracker']);
  assert.deepEqual(chooseSkills([own], 'make an expense report'), ['Kharcha tracker'], 'phrases work');
  assert.deepEqual(chooseSkills([{ ...own, mode: 'off' }], 'kharcha'), [], 'off stays off');
  assert.deepEqual(chooseSkills([{ ...own, mode: 'always' }], 'kharcha'), [], 'always is not reported as automatic');
  assert.deepEqual(chooseSkills([{ name: 'Wedding planner', text: 'x', mode: 'auto' }], 'wedding venue dekho'), ['Wedding planner'], 'with no words given, the name is used');
  const many = Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, text: 'x', mode: 'auto', keywords: ['tax'] }));
  assert.equal(chooseSkills(many, 'tax').length, 3, 'never more than three at once');
  assert.equal(skillMode({ name: 'Hinglish replies', on: true }), 'always', 'old saved skills keep working');
  assert.equal(skillMode({ name: 'Mine', on: true }), 'auto');
  assert.equal(skillMode({ name: 'Mine', on: false }), 'off');
  assert.equal(findSkill([{ ...own, mode: 'off' }], own.name), undefined, 'the agent cannot load an off skill');
  assert.ok(skillCatalog([own], []).includes('Kharcha tracker'));
  assert.equal(skillCatalog([own], [own.name]), '');
});

test('skills: the ready-made library is complete and short', async () => {
  const { SKILL_LIBRARY } = require('../lib/skill-library');
  assert.equal(SKILL_LIBRARY.length, 12);
  assert.equal(new Set(SKILL_LIBRARY.map((skill) => skill.name)).size, 12, 'names are unique');
  for (const skill of SKILL_LIBRARY) {
    assert.ok(skill.name && skill.description && skill.text, skill.name);
    assert.ok(skill.text.split(/\s+/).length <= 80, `${skill.name} is sent with every message, so it stays short`);
  }
});

test('screens: the open size fits each screen', () => {
  const { fitPanel, sheetFor } = require('../lib/display-layout');
  const auto = { fitScreen: true, topGap: 0, panelWidth: 780, panelHeight: 480, position: 50 };
  const screen = (width, height, x = 0) => ({ x, y: 0, width, height });
  assert.deepEqual(fitPanel(screen(1397, 786), auto), { w: 780, h: 480 }, 'this laptop keeps its size');
  assert.deepEqual(fitPanel(screen(3840, 2160), auto), { w: 960, h: 620 }, 'a big screen stops at the maximum');
  assert.deepEqual(fitPanel(screen(1024, 600), auto), { w: 680, h: 400 }, 'a small screen stops at the minimum');
  assert.deepEqual(fitPanel(screen(640, 420), auto), { w: 616, h: 356 }, 'never larger than the screen');
  assert.deepEqual(fitPanel(screen(800, 600), { ...auto, fitScreen: false, panelWidth: 960, panelHeight: 620 }), { w: 776, h: 536 }, 'a hand-set size is still kept on screen');
  const sheet = sheetFor(screen(1360, 768, 1397), { w: 760, h: 470 }, auto);
  assert.equal(sheet.x + sheet.width / 2, 1397 + 1360 / 2, 'centred on its own screen, not the main one');
  const left = sheetFor(screen(1360, 768, 1397), { w: 760, h: 470 }, { ...auto, position: 0 });
  assert.equal(left.x, 1397, 'never spills onto the next screen');
});

test('screens: Magic Capsule appears only where you asked', () => {
  const { describeDisplays, pickDisplays } = require('../lib/display-layout');
  const main = { id: 1, bounds: { x: 0, width: 1397, height: 786 } };
  const side = { id: 2, bounds: { x: 1397, width: 1360, height: 768 } };
  const displays = [main, side];
  const ids = (settings, cursor = 1) => pickDisplays(displays, 1, settings, cursor).map((display) => display.id);
  assert.deepEqual(ids({ displayMode: 'primary' }), [1]);
  assert.deepEqual(ids({ displayMode: 'all' }), [1, 2]);
  assert.deepEqual(ids({ displayMode: 'one', displayId: '2' }), [2]);
  assert.deepEqual(ids({ displayMode: 'one', displayId: '9' }), [1], 'an unplugged screen falls back to the main one');
  assert.deepEqual(ids({ displayMode: 'follow' }, 2), [2]);
  assert.deepEqual(describeDisplays(displays, 1).map((item) => item.label), ['Screen 1, 1397 x 786 (main)', 'Screen 2, 1360 x 768']);
});

test('lyrics: LRC parsing and title cleanup', () => {
  const { cleanTitle, parseLrc } = require('../lib/online');
  assert.deepEqual(parseLrc('[00:12.50] Pehli line\n[01:03.00]Doosri line\n[01:05.00]\nno stamp'), [
    { at: 12.5, text: 'Pehli line' }, { at: 63, text: 'Doosri line' },
  ]);
  assert.equal(cleanTitle('Tumsa Koi Pyaara (Official Video) [HD]'), 'Tumsa Koi Pyaara');
});

const NETSH_NETWORKS = `
Interface name : Wi-Fi
There are 3 networks currently visible.

SSID 1 : Home 5G
    Network type            : Infrastructure
    Authentication          : WPA2-Personal
    Encryption              : CCMP
    BSSID 1                 : aa:bb:cc:dd:ee:ff
         Signal             : 62%
         Radio type         : 802.11ac
    BSSID 2                 : aa:bb:cc:dd:ee:00
         Signal             : 91%

SSID 2 : Cafe Free
    Network type            : Infrastructure
    Authentication          : Open
    Encryption              : None
    BSSID 1                 : 11:22:33:44:55:66
         Signal             : 40%

SSID 3 :
    Network type            : Infrastructure
    Authentication          : WPA2-Personal
`;

test('wifi: parses networks, best signal first', () => {
  const networks = wifi.parseNetworks(NETSH_NETWORKS);
  assert.deepEqual(networks, [
    { ssid: 'Home 5G', signal: 91, secure: true },
    { ssid: 'Cafe Free', signal: 40, secure: false },
  ]);
});

test('wifi: current network and saved profiles', () => {
  assert.equal(wifi.parseCurrent('    State                  : connected\r\n    SSID                   : Home 5G\r\n    BSSID                  : aa'), 'Home 5G');
  assert.equal(wifi.parseCurrent('    State                  : disconnected\r\n'), '');
  assert.deepEqual(wifi.parseProfiles('    All User Profile     : Home 5G\r\n    All User Profile     : Office\r\n'), ['Home 5G', 'Office']);
});

test('wifi: profile XML escapes names and passwords', () => {
  const xml = wifi.profileXml(`Tom & "Jerry's" <net>`, 'p&ss<word>');
  assert.ok(xml.includes('Tom &amp; &quot;Jerry&apos;s&quot; &lt;net&gt;'));
  assert.ok(xml.includes('<keyMaterial>p&amp;ss&lt;word&gt;</keyMaterial>'));
});

test('drop: file names cannot escape or hit reserved names', () => {
  assert.equal(safeFileName('..\\..\\Windows\\evil.exe'), 'evil.exe');
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('a:b?c.txt'), 'a_b_c.txt');
  assert.equal(safeFileName('report. '), 'report');
  assert.match(safeFileName('CON'), /^file-\d+$/);
  assert.match(safeFileName('nul.txt'), /^file-\d+$/);
  assert.match(safeFileName('..'), /^file-\d+$/);
  assert.equal(safeFileName('फोटो 1.jpg'), 'फोटो 1.jpg');
});

test('drop: only real private adapters are offered, Wi-Fi first', () => {
  const addresses = lanAddresses({
    Ethernet: [{ family: 'IPv4', address: '192.168.1.5', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '10.0.0.8', internal: false }],
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    Public: [{ family: 'IPv4', address: '8.8.8.8', internal: false }],
  });
  assert.deepEqual(addresses.map((item) => item.ip), ['10.0.0.8', '192.168.1.5']);
});

function raw({ port, method = 'GET', path: target, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('drop: server flow and rejections', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-drop-'));
  const shelfFile = path.join(dir, 'on-shelf.txt');
  fs.writeFileSync(shelfFile, 'hello from pc');
  const received = [];
  const texts = [];
  const stops = [];
  const drop = new PhoneDrop({
    saveDir: () => path.join(dir, 'in'),
    listFiles: () => [{ id: 'abc', name: 'on-shelf.txt', size: 13, path: shelfFile }],
    onFile: (file) => received.push(file),
    onText: (text) => texts.push(text),
    onStop: (reason) => stops.push(reason),
    page: path.join(__dirname, '..', 'renderer', 'phone.html'),
  });

  const status = await drop.start('127.0.0.1');
  try {
    assert.ok(status.running && status.qr.includes('<svg'));
    const port = Number(new URL(status.url).port);
    const token = new URL(status.url).pathname.split('/')[1];
    assert.ok(token.length >= 24);
    const good = { host: `127.0.0.1:${port}` };

    assert.equal((await raw({ port, path: '/', headers: good })).status, 404);
    assert.equal((await raw({ port, path: '/wrong-token/', headers: good })).status, 404);
    assert.equal((await raw({ port, path: `/${token}/`, headers: { host: 'evil.example' } })).status, 404, 'Host check');

    const page = await raw({ port, path: `/${token}/`, headers: good });
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Magic Capsule Drop'));

    const list = await raw({ port, path: `/${token}/list`, headers: good });
    assert.deepEqual(JSON.parse(list.body), [{ id: 'abc', name: 'on-shelf.txt', size: 13 }], 'list exposes no paths');

    const file = await raw({ port, path: `/${token}/file/abc`, headers: good });
    assert.equal(file.body, 'hello from pc');
    assert.match(file.headers['content-disposition'], /attachment/);
    assert.equal((await raw({ port, path: `/${token}/file/..%2f..%2fsecret`, headers: good })).status, 404);

    const upload = (name, body) => raw({ port, method: 'POST', path: `/${token}/upload`, body, headers: { ...good, 'x-file-name': encodeURIComponent(name), 'content-length': Buffer.byteLength(body) } });
    assert.equal((await upload('photo.jpg', 'first')).status, 200);
    assert.equal(JSON.parse((await upload('photo.jpg', 'second')).body).name, 'photo (2).jpg');
    assert.equal(JSON.parse((await upload('..\\..\\evil.bat', 'x')).body).name, 'evil.bat');
    const saved = fs.readdirSync(path.join(dir, 'in')).sort();
    assert.deepEqual(saved, ['evil.bat', 'photo (2).jpg', 'photo.jpg'], 'nothing outside the folder, no .part left');
    assert.equal(fs.readFileSync(path.join(dir, 'in', 'photo.jpg'), 'utf8'), 'first');
    assert.equal(received.length, 3);

    assert.equal((await raw({ port, method: 'POST', path: `/${token}/text`, headers: good, body: 'नमस्ते' })).status, 200);
    assert.deepEqual(texts, ['नमस्ते']);
    assert.equal((await raw({ port, method: 'POST', path: `/${token}/text`, headers: good, body: 'x'.repeat(300 * 1024) })).status, 413);
  } finally {
    drop.stop();
  }
  assert.equal(drop.running, false);
  assert.deepEqual(stops, ['stopped']);
  fs.rmSync(dir, { recursive: true, force: true });
});

function mockServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const request = { url: req.url, headers: req.headers, body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null };
      seen.push(request);
      handler(request, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() }));
  });
}

async function collect(stream) {
  let text = '';
  for await (const part of stream) text += part;
  return text;
}

const COMMON = { apiKey: 'test-key', system: 'Be brief', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Again' }] };

test('ai: OpenAI-compatible stream, split across packets', async () => {
  const mock = await mockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choi');
    setTimeout(() => {
      res.write('ces":[{"delta":{"content":"lo"}}]}\n\n');
      res.end('data: [DONE]\n\n');
    }, 10);
  });
  const text = await collect(streamOpenAi({ ...COMMON, model: 'm', baseURL: `${mock.url}/v1/`, name: 'API' }));
  assert.equal(text, 'Hello');
  assert.equal(mock.seen[0].url, '/v1/chat/completions');
  assert.equal(mock.seen[0].headers.authorization, 'Bearer test-key');
  assert.equal(mock.seen[0].body.messages[0].role, 'system');
  mock.close();
});

test('ai: API errors carry the provider message', async () => {
  const mock = await mockServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":{"message":"Invalid key"}}');
  });
  await assert.rejects(collect(streamOpenAi({ ...COMMON, model: 'm', baseURL: mock.url, name: 'API' })), /API error 401: Invalid key/);
  mock.close();
});

test('ai: Gemini stream maps roles and skips thoughts', async () => {
  const mock = await mockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"candidates":[{"content":{"parts":[{"text":"hmm","thought":true}]}}]}\n\n');
    res.write('data: {"candidates":[{"content":{"parts":[{"text":"Nama"}]}}]}\n\n');
    res.end('data: {"candidates":[{"content":{"parts":[{"text":"ste"}]}}]}\n\n');
  });
  const text = await collect(streamGemini({ ...COMMON, model: 'gemini-x', baseURL: mock.url }));
  assert.equal(text, 'Namaste');
  const [request] = mock.seen;
  assert.equal(request.url, '/models/gemini-x:streamGenerateContent?alt=sse');
  assert.equal(request.headers['x-goog-api-key'], 'test-key');
  assert.deepEqual(request.body.contents.map((item) => item.role), ['user', 'model', 'user']);
  mock.close();
});

const claudeEvents = (stopReason, text) => [
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ...text.map((part) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } }]),
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 3 } }],
  ['message_stop', { type: 'message_stop' }],
].map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');

test('ai: Claude streams through the SDK with fallback on supported models', async () => {
  const mock = await mockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(claudeEvents('end_turn', ['Hello ', 'there']));
  });
  const text = await collect(streamClaude({ ...COMMON, model: 'claude-opus-5-5', baseURL: mock.url }));
  assert.equal(text, 'Hello there');
  const [request] = mock.seen;
  assert.ok(request.url.startsWith('/v1/messages'));
  assert.match(request.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(request.body.fallbacks, 'default');
  assert.equal(request.body.stream, true);
  assert.deepEqual(request.body.output_config, { effort: 'low' });
  assert.equal(request.body.thinking, undefined);
  mock.close();
});

test('ai: Claude Haiku sends no fallback, refusals surface as errors', async () => {
  const mock = await mockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(claudeEvents('refusal', []));
  });
  await assert.rejects(collect(streamClaude({ ...COMMON, model: 'claude-haiku-5-5', baseURL: mock.url })), /declined/);
  assert.equal(mock.seen[0].body.fallbacks, undefined);
  assert.equal(mock.seen[0].headers['anthropic-beta'], undefined);
  mock.close();
});

test('ai: Claude auth failure gets a clear message', async () => {
  const mock = await mockServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
  });
  await assert.rejects(collect(streamClaude({ ...COMMON, model: 'claude-opus-5-5', baseURL: mock.url })), /rejected the API key/);
  mock.close();
});

const okReply = (res, message) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...message } }] }));
};
const screenResult = (id) => ({ call: { id, name: 'screenshot' }, text: 'shot', image: { media: 'image/jpeg', data: 'AAAA' } });
const localAi = (url, caps = {}) => ({ provider: 'ollama', models: { ollama: 'm' }, ollamaUrl: url, apis: [], caps });

test('api: a busy API is tried again, a wrong key is not', async () => {
  const { OpenAiTurns } = require('../lib/agent-models');
  const mock = await mockServer((_req, res) => {
    if (mock.seen.length < 3) { res.writeHead(429, { 'Retry-After': '0.01' }); res.end('slow down'); return; }
    okReply(res, { content: 'Hi' });
  });
  const waits = [];
  const turns = new OpenAiTurns({ apiKey: 'k', model: 'm', system: 'S', tools: [], baseURL: mock.url, name: 'API', onRetry: (ms) => waits.push(ms) });
  turns.addUser('hi', []);
  assert.equal((await turns.next()).text, 'Hi');
  assert.equal(mock.seen.length, 3);
  assert.equal(waits.length, 2, 'the person is told about each wait');
  assert.equal(mock.seen[0].body.tools, undefined, 'an empty tool list is not sent');
  mock.close();

  const refused = await mockServer((_req, res) => { res.writeHead(401); res.end('bad key'); });
  const second = new OpenAiTurns({ apiKey: 'k', model: 'm', system: 'S', tools: [], baseURL: refused.url, name: 'API' });
  second.addUser('hi', []);
  await assert.rejects(second.next(), /API error 401: bad key/);
  assert.equal(refused.seen.length, 1);
  refused.close();
});

test('api: only the latest screenshots are sent again', async () => {
  const { GeminiTurns, OpenAiTurns } = require('../lib/agent-models');
  const mock = await mockServer((_req, res) => okReply(res, { content: 'ok' }));
  const openai = new OpenAiTurns({ apiKey: 'k', model: 'm', system: 'S', tools: [], baseURL: mock.url, name: 'API' });
  openai.addUser('go', []);
  for (const id of ['a', 'b', 'c', 'd', 'e']) openai.addResults([screenResult(id)]);
  await openai.next();
  assert.equal(JSON.stringify(mock.seen[0].body).split('image_url').length - 1, 6, 'three images, each named twice');
  mock.close();

  const google = await mockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }));
  });
  const gemini = new GeminiTurns({ apiKey: 'k', model: 'm', system: 'S', tools: [], baseURL: google.url });
  gemini.addUser('go', []);
  for (const id of ['a', 'b', 'c', 'd', 'e']) gemini.addResults([screenResult(id)]);
  await gemini.next();
  const sent = JSON.stringify(google.seen[0].body);
  assert.equal(sent.split('inlineData').length - 1, 3);
  assert.equal(sent.split('older screenshot').length - 1, 2);
  assert.equal(google.seen[0].body.tools, undefined);
  google.close();
});

test('api: a model that refuses pictures carries on with text', async () => {
  const { OpenAiTurns } = require('../lib/agent-models');
  const mock = await mockServer((_req, res) => {
    if (JSON.stringify(mock.seen.at(-1).body).includes('image_url')) { res.writeHead(400); res.end('{"error":"image input is not supported"}'); return; }
    okReply(res, { content: 'ok' });
  });
  const turns = new OpenAiTurns({ apiKey: 'k', model: 'm', system: 'S', tools: [], baseURL: mock.url, name: 'API' });
  turns.addUser('go', []);
  turns.addResults([screenResult('a')]);
  assert.equal((await turns.next()).text, 'ok');
  assert.equal(turns.blind, true);
  turns.addResults([screenResult('b')]);
  await turns.next();
  assert.ok(!JSON.stringify(mock.seen.at(-1).body).includes('image_url'));
  assert.match(JSON.stringify(mock.seen.at(-1).body), /cannot see pictures/);
  mock.close();
});

test('api: a model without tools gets text tools, found out on the first request', async () => {
  const { createTurns } = require('../lib/agent-models');
  const { TOOLS } = require('../lib/agent-tools');
  const mock = await mockServer((_req, res) => {
    if (mock.seen.at(-1).body.tools) { res.writeHead(400); res.end('{"error":"this model does not support tools"}'); return; }
    okReply(res, { content: 'Clicking.\n```tool\n{"name":"click","input":{"x":1,"y":2}}\n```' });
  });
  const turns = createTurns(localAi(mock.url), 'System', TOOLS);
  turns.addUser('go', []);
  const reply = await turns.next();
  assert.deepEqual(reply.calls.map(({ name, input }) => [name, input]), [['click', { x: 1, y: 2 }]]);
  assert.equal(reply.text, 'Clicking.');
  assert.match(mock.seen[1].body.messages[0].content, /no tool calling[\s\S]*run_command/);
  assert.equal(mock.seen[1].body.messages[1].content, 'go', 'the task is sent again');
  turns.addResults([{ call: reply.calls[0], text: 'Clicked.' }]);
  await turns.next();
  assert.match(mock.seen[2].body.messages.at(-1).content, /Result of click:\nClicked\./);
  mock.close();
});

test('api: what the Test button found changes what is offered', async () => {
  const { createTurns } = require('../lib/agent-models');
  const { TOOLS } = require('../lib/agent-tools');
  const mock = await mockServer((_req, res) => okReply(res, { content: 'Done' }));
  const turns = createTurns(localAi(mock.url, { 'ollama:m': { tools: false, vision: false } }), 'System', TOOLS);
  turns.addUser('go', []);
  await turns.next();
  const { messages, tools } = mock.seen[0].body;
  assert.equal(tools, undefined);
  assert.equal(mock.seen.length, 1, 'no failed try first');
  assert.ok(!/- screenshot:/.test(messages[0].content));
  assert.match(messages[0].content, /cannot see pictures/);
  mock.close();
});

test('api: text tools read a block, and a broken block is reported, not lost', () => {
  const { parseTextTools } = require('../lib/agent-models');
  assert.deepEqual(parseTextTools('All finished, nothing else to do.').calls, []);
  assert.equal(parseTextTools('```json\n{"name":"wait","input":{"seconds":1}}\n```').calls[0].name, 'wait');
  assert.equal(parseTextTools('```tool\n{"name":"wait", oops}\n```').calls[0].input, null);
  assert.match(parseTextTools('Here is data:\n```json\n{"a":1}\n```').text, /"a":1/);
});

test('api: your own list of APIs, and keys never go over plain http', () => {
  const { activeApi, checkUrl } = require('../lib/ai-profiles');
  const ai = {
    provider: 'api:a', models: {}, apis: [{ id: 'a', name: 'Groq', url: 'https://example.test/v1', model: ' fast ' }], caps: { 'api:a:fast': { vision: false } },
  };
  const api = activeApi(ai);
  assert.deepEqual([api.kind, api.name, api.model, api.baseURL, api.caps.vision], ['openai', 'Groq', 'fast', 'https://example.test/v1', false]);
  assert.throws(() => activeApi({ ...ai, apis: [] }), /was removed/);
  assert.throws(() => activeApi({ ...ai, apis: [{ ...ai.apis[0], model: '' }] }), /model name/);
  assert.throws(() => activeApi({ ...ai, apis: [{ ...ai.apis[0], url: 'nonsense' }] }), /API address/);
  assert.throws(() => checkUrl('http://example.test/v1', true), /plain http/);
  assert.doesNotThrow(() => checkUrl('http://127.0.0.1:1234/v1', true));
  assert.doesNotThrow(() => checkUrl('http://192.168.1.9:1234/v1', true));
  assert.doesNotThrow(() => checkUrl('http://example.test/v1', false));
});

test('api: the Test button reports tools and pictures from real replies', async () => {
  const { testApi, listModels } = require('../lib/api-test');
  const mock = await mockServer((req, res) => {
    const { body } = req;
    if (!body) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"id":"z"},{"id":"a"}]}'); return; }
    if (body.tools) { okReply(res, { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'ping', arguments: '{"word":"hi"}' } }] }); return; }
    if (JSON.stringify(body).includes('image_url')) { res.writeHead(400); res.end('no images here'); return; }
    okReply(res, { content: 'OK' });
  });
  assert.deepEqual(await testApi(localAi(mock.url)), { tools: true, vision: false });
  assert.deepEqual(await listModels(localAi(mock.url)), ['a', 'z']);
  mock.close();
  const down = await mockServer((_req, res) => { res.writeHead(401); res.end('bad key'); });
  await assert.rejects(testApi(localAi(down.url)), /401/);
  down.close();
});

test('agent: broken tool input goes back to the model and the task carries on', async () => {
  const run = testAgent({ script: [{ text: '', calls: [{ id: 'a', name: 'click', input: null }] }] });
  run.agent.start({ id: 't', text: 'go', mode: 'task' });
  await finished(run);
  assert.match(run.turns.results[0][0].text, /not valid JSON/);
  assert.deepEqual(run.tools.ran, []);
  assert.ok(run.events.some(([, data]) => data.finished));
});

test('agent: commands, file changes and memory ask every time, even when the task is allowed', async () => {
  const saved = [];
  const script = [
    { text: '', calls: [call('run_command', { command: 'Get-Date' })] },
    { text: '', calls: [call('run_command', { command: 'Get-Host' })] },
    { text: '', calls: [call('edit_file', { path: 'a', old_text: 'b', new_text: 'c' })] },
    { text: '', calls: [call('delete_file', { path: 'a' })] },
    { text: '', calls: [call('remember', { fact: 'My GST number is on file' })] },
    { text: '', calls: [call('read_file', { path: 'a' })] },
  ];
  const run = testAgent({ script, decisions: Array(5).fill({ decision: 'once' }), extra: { saveFact: (text) => saved.push(text) } });
  run.agent.start({ id: 't', text: 'go', mode: 'task' });
  await finished(run);
  const asks = run.events.filter(([channel]) => channel === 'agent:ask').map(([, data]) => data);
  assert.equal(asks.length, 5, 'read_file is covered by allowing the task');
  assert.ok(asks.every((ask) => ask.once), 'no "allow for this task" button');
  assert.match(asks[0].text, /Get-Date/, 'the person sees the whole command');
  assert.deepEqual(run.tools.ran, ['run_command', 'run_command', 'edit_file', 'delete_file', 'read_file']);
  assert.deepEqual(saved, ['My GST number is on file']);
});

test('agent: Allow for this session stops the questions for that tool, until the session ends', async () => {
  const script = [{ text: '', calls: [call('run_command', { command: 'a' })] }, { text: '', calls: [call('run_command', { command: 'b' })] }, { text: '', calls: [call('delete_file', { path: 'x' })] }];
  const run = testAgent({ script, decisions: [{ decision: 'session' }, { decision: 'stop' }] });
  run.agent.start({ id: 't', text: 'go', mode: 'ask' });
  await finished(run);
  assert.deepEqual(run.tools.ran, ['run_command', 'run_command'], 'the second command did not ask, and a different tool still does');
  assert.equal(run.events.filter(([channel]) => channel === 'agent:ask').length, 2);

  run.agent.setSession(false);
  script.push({ text: '', calls: [call('run_command', { command: 'c' })] });
  run.tools.ran.length = 0;
  run.agent.start({ id: 't2', text: 'go', mode: 'ask' });
  await finished(run);
  assert.deepEqual(run.tools.ran, [], 'a new chat starts asking again');
});

test('agent: allowing everything for the session, and Turbo, skip every permission', async () => {
  const risky = () => [{ text: '', calls: [call('run_command', { command: 'a' }), call('delete_file', { path: 'x' }), call('click', { x: 1, y: 2 }), call('screenshot')] }];
  const session = testAgent({ script: risky() });
  session.agent.setSession(true);
  session.agent.start({ id: 't', text: 'go', mode: 'ask', fromChat: true });
  await finished(session);
  assert.equal(session.events.filter(([channel]) => channel === 'agent:ask').length, 0);
  assert.equal(session.tools.ran.length, 4);

  const run = testAgent({ script: [...risky(), { text: '', calls: [call('ask_user', { question: 'Which account?' })] }], decisions: [{ text: 'Main' }], extra: { getTurbo: () => true } });
  run.agent.start({ id: 't', text: 'go', mode: 'ask', fromChat: true });
  await finished(run);
  assert.equal(run.tools.ran.length, 4, 'nothing waited for permission');
  const asks = run.events.filter(([channel]) => channel === 'agent:ask').map(([, data]) => data.kind);
  assert.deepEqual(asks, ['question'], 'the AI can still ask a real question, such as before a payment');
});

test('agent: a restored backup never turns Turbo on', () => {
  const { withServersOff } = require('../lib/backup');
  assert.equal(withServersOff({ ai: { turbo: true } }).ai.turbo, false);
});

test('agent: a job from Chat asks before reading windows too', async () => {
  const run = testAgent({ script: [{ text: '', calls: [call('read_ui')] }, { text: '', calls: [call('list_windows')] }], decisions: [{ decision: 'task' }] });
  run.agent.start({ id: 't', text: 'go', mode: 'ask', fromChat: true });
  await finished(run);
  const asks = run.events.filter(([channel]) => channel === 'agent:ask');
  assert.equal(asks.length, 1);
  assert.match(asks[0][1].text, /See your screen/);
});

test('agent: moving the mouse only stops what uses the mouse', async () => {
  const run = testAgent({
    script: [{ text: '', calls: [call('read_file', { path: 'a' })] }, { text: '', calls: [call('read_file', { path: 'b' })] }],
    cursors: [{ x: 100, y: 100 }, { x: 900, y: 900 }],
  });
  run.agent.start({ id: 't', text: 'go', mode: 'task' });
  await finished(run);
  assert.deepEqual(run.tools.ran, ['read_file', 'read_file']);
});

test('agent: a long task restarts from its notes, the limit comes from Settings', async () => {
  const script = [{ text: 'Starting', calls: [call('update_plan', { plan: '1. first\n2. second' })] }];
  for (let i = 0; i < 40; i += 1) script.push({ text: '', calls: [call('read_file', { path: `file${i}` })] });
  const run = testAgent({ script, extra: { getMaxSteps: () => 30 } });
  run.agent.start({ id: 't', text: 'The task', mode: 'task' });
  await finished(run);
  assert.equal(run.turns.users.length, 2);
  assert.match(run.turns.users[1], /^The task\n[\s\S]*already working[\s\S]*1\. first\n2\. second[\s\S]*Read file23 -> /);
  assert.ok(run.events.some(([, data]) => /Stopped after 30 steps/.test(data.text || '')));
});

test('agent: long results are cut, memory reaches the prompt', async () => {
  const run = testAgent({
    script: [{ text: '', calls: [call('read_file', { path: 'a' })] }],
    extra: { getMemory: () => [{ id: '1', text: 'My shop is called Asha Traders' }] },
  });
  run.tools.run = async () => ({ text: 'x'.repeat(50000) });
  run.agent.start({ id: 't', text: 'go', mode: 'task' });
  await finished(run);
  assert.match(run.turns.system, /remember:\n- My shop is called Asha Traders/);
  assert.ok(run.turns.results[0][0].text.length < 31000);
  assert.match(run.turns.results[0][0].text, /characters cut/);
});

test('mcp: a real server: tools listed, called, errors shown, broken ones skipped', async () => {
  const { McpTools, parseEnv, testServer } = require('../lib/mcp');
  const server = {
    id: '1', name: 'My Server', kind: 'command', command: process.execPath, args: `"${path.join(__dirname, 'mcp-server.js')}"`, on: true,
  };
  const notes = [];
  const mcp = new McpTools({
    getServers: () => [server, { ...server, id: '2', name: 'Off', on: false }, { ...server, id: '3', name: 'Broken', command: 'no-such-program-here' }],
    getSecret: () => '',
  });
  const tools = await mcp.open((note) => notes.push(note));
  assert.deepEqual(tools.map((tool) => tool.name), ['mcp_my_server_add_numbers', 'mcp_my_server_fail']);
  assert.equal(tools[0].risk, 'always', 'asks each time unless trusted');
  assert.match(notes.join(), /Could not use Broken/);
  assert.equal((await mcp.call('mcp_my_server_add_numbers', { a: 2, b: 3 })).text, '5');
  assert.match((await mcp.call('mcp_my_server_fail', {})).text, /That failed: broken/);
  await mcp.close();
  await assert.rejects(mcp.call('mcp_my_server_add_numbers', { a: 1, b: 1 }), /Unknown tool/);
  assert.deepEqual(await testServer(server, ''), ['add numbers', 'fail']);
  assert.deepEqual(parseEnv('TOKEN=a=b\n\nnot a line\nNAME = x\nKEY=v'), { TOKEN: 'a=b', KEY: 'v' });
});

test('agent: MCP tools run through the same permission and reach the model', async () => {
  const called = [];
  const mcp = {
    open: async () => [{ name: 'mcp_s_go', risk: 'always', description: 'd', input: { type: 'object', properties: {} } }],
    call: async (name, input) => { called.push([name, input]); return { text: 'server said hi' }; },
    close: async () => {},
  };
  const run = testAgent({ script: [{ text: '', calls: [call('mcp_s_go', { a: 1 })] }], decisions: [{ decision: 'once' }], extra: { mcp } });
  run.agent.start({ id: 't', text: 'go', mode: 'task' });
  await finished(run);
  assert.deepEqual(called, [['mcp_s_go', { a: 1 }]]);
  assert.equal(run.turns.results[0][0].text, 'server said hi');
  assert.equal(run.events.filter(([channel]) => channel === 'agent:ask').length, 1);
  assert.deepEqual(run.tools.ran, [], 'not sent to the PC tools');
});

test('skills: tax skills come up by themselves, and never let the AI file or pay', () => {
  const { chooseSkills } = require('../lib/skills');
  const { SKILL_LIBRARY } = require('../lib/skill-library');
  const skills = SKILL_LIBRARY.filter((skill) => ['GST filing', 'ITR filing', 'Web research', 'Hinglish replies'].includes(skill.name)).map((skill) => ({ ...skill, mode: skill.name.endsWith('filing') ? 'auto' : 'off' }));
  for (const words of ['GST return bharna hai', 'mera GSTR-3B check karo', 'is mahine ka ITC kitna hai']) assert.deepEqual(chooseSkills(skills, words), ['GST filing'], words);
  for (const words of ['ITR bharna hai', 'income tax return file karni hai', 'Form 16 aur 26AS dekho', 'आयकर रिटर्न']) assert.deepEqual(chooseSkills(skills, words), ['ITR filing'], words);
  assert.deepEqual(chooseSkills(skills, 'aaj ka mausam kaisa hai'), []);
  for (const skill of skills.filter((item) => item.mode === 'auto')) {
    assert.match(skill.text, /official/, 'rules come from the official site');
    assert.match(skill.text, /OTPs, pay/, 'the person pays and types OTPs');
    assert.match(skill.text, /Never invent/);
    assert.match(skill.text, /my CA/);
  }
});

test('pet: every app, event and control has a reaction, and every prop exists', async () => {
  const {
    APPS, EVENTS, PROPS, TRY_EVENTS, appAct, controlAct, fidgetAct, greeting, weatherAct,
  } = await import('../renderer/pet-acts.mjs');
  for (const [name, svg] of Object.entries(PROPS)) assert.ok(svg.startsWith('<svg') && !/undefined|NaN/.test(svg), name);
  const props = [...APPS.map(([, , extra]) => extra), ...Object.values(EVENTS), ...TRY_EVENTS.map(([, extra]) => extra)];
  for (const { prop } of props) assert.ok(!prop || PROPS[prop], `missing prop ${prop}`);

  const expected = {
    'Visual Studio Code': 'code', 'Windows PowerShell': 'terminal', 'Microsoft Excel': 'sheet', 'Microsoft Word': 'write', WhatsApp: 'phone',
    Zoom: 'call', 'VLC media player': 'watch', Steam: 'game', 'Google Chrome': 'browse', 'File Explorer': 'files', Photoshop: 'draw', Spotify: 'notes',
  };
  for (const [app, prop] of Object.entries(expected)) assert.equal(appAct(app)?.prop, prop, app);
  assert.equal(appAct('Some unknown app'), null);

  for (const id of ['wifi', 'bluetooth', 'flight', 'hotspot', 'vpn', 'dark', 'nightLight', 'quiet', 'camera', 'keepAwake', 'power']) {
    assert.notDeepEqual(controlAct({ id, on: true }), controlAct({ id, on: false }), `${id} on and off differ`);
  }
  assert.match(greeting(8).say, /morning/);
  assert.match(greeting(23).say, /night/);
  assert.equal(weatherAct(61).prop, 'umbrella');
  assert.equal(weatherAct(0).prop, 'shades');
  assert.equal(weatherAct(3), null);
  for (let i = 0; i < 200; i += 1) {
    const { prop } = fidgetAct(i % 24, i % 2 ? { act: 'peek', prop: 'umbrella' } : null);
    assert.ok(!prop || PROPS[prop]);
  }
  assert.ok(Object.values(EVENTS).every((event) => event.mood && event.ms > 0), 'each event has a pose and an end');
});

test('history: chats and tasks are kept, found, limited, and only the words are saved', () => {
  const { AiHistory, STORE } = require('../lib/ai-history');
  const data = new Map();
  const memoryStore = { get: (ns, fallback) => (data.has(ns) ? data.get(ns) : fallback), set: (ns, value) => data.set(ns, value), clear: (ns) => data.delete(ns) };
  let on = true;
  const history = new AiHistory({ store: memoryStore, isOn: () => on });

  history.saveChat({ id: 'empty', messages: [] });
  assert.equal(history.list().length, 0, 'an empty chat is not saved');
  history.saveChat({ id: 'c1', messages: [{ role: 'user', content: 'Mera GST kitna hai', attachmentIds: ['x'] }, { role: 'assistant', content: 'Thoda sa' }] });
  history.saveTask({ id: 't1', text: 'Open Excel and make a bill', lines: [{ type: 'action', text: 'Open Excel' }, { type: 'done', text: 'Task finished.' }], failed: false });
  assert.deepEqual(history.list().map((item) => [item.id, item.kind]), [['t1', 'task'], ['c1', 'chat']], 'newest first');
  assert.equal(history.get('c1').messages[0].attachmentIds, undefined, 'files are not kept');
  history.saveChat({ id: 'c1', messages: [{ role: 'user', content: 'Mera GST kitna hai' }, { role: 'assistant', content: 'Changed' }] });
  assert.equal(history.list().length, 2, 'the same chat updates, it does not repeat');
  assert.equal(history.list()[0].id, 'c1', 'and moves to the top');

  assert.deepEqual(history.list({ query: 'gst' }).map((item) => item.id), ['c1']);
  assert.deepEqual(history.list({ query: 'excel' }).map((item) => item.id), ['t1']);
  assert.deepEqual(history.list({ kind: 'task' }).map((item) => item.id), ['t1']);
  assert.match(history.search('gst'), /chat "Mera GST kitna hai": Mera GST kitna hai/);
  assert.equal(history.search('no such words'), 'Nothing about that in the history.');
  assert.throws(() => history.get('gone'), /no longer/);

  on = false;
  history.saveChat({ id: 'c2', messages: [{ role: 'user', content: 'Private' }] });
  assert.equal(history.list().length, 2, 'off means nothing new is saved');
  on = true;
  for (let i = 0; i < 200; i += 1) history.saveChat({ id: `n${i}`, messages: [{ role: 'user', content: `Chat ${i}` }] });
  assert.equal(history.list().length, 150, 'it cannot grow for ever');
  history.remove('n199');
  assert.equal(history.list().length, 149);
  history.clear();
  assert.equal(data.has(STORE), false);
});

test('agent: every task reaches the history, and it can search it', async () => {
  const saved = [];
  const run = testAgent({
    script: [{ text: 'Looking', calls: [call('search_history', { query: 'bill' })] }, { text: '', calls: [] }],
    extra: { onFinished: (task) => saved.push(task) },
  });
  run.agent.start({ id: 't', text: 'What did we do', mode: 'task' });
  await finished(run);
  assert.deepEqual(run.tools.ran, ['search_history'], 'searching needs no permission');
  assert.equal(saved[0].text, 'What did we do');
  assert.deepEqual(saved[0].lines.map((line) => line.type), ['say', 'action', 'done']);
});

test('pet: its name reaches the AI and its greeting, and the click area follows a walk', async () => {
  const { withName } = require('../lib/skills');
  const { walkOffset } = require('../lib/display-layout');
  const { greeting } = await import('../renderer/pet-acts.mjs');
  assert.match(withName('S', ' Mochi\n '), /named you Mochi\./);
  assert.equal(withName('S', ''), 'S');
  assert.equal(withName('S', 'x'.repeat(50)).split('x').length - 1, 24, 'a long name is cut');
  assert.match(greeting(9, 'Mochi').say, /Mochi/);
  assert.equal(greeting(9).say, 'Good morning!');
  const walk = { from: 0, to: 100, ms: 1000, at: 5000 };
  assert.equal(walkOffset(walk, 5000), 0);
  assert.equal(walkOffset(walk, 5500), 50);
  assert.equal(walkOffset(walk, 9000), 100, 'it stays where it stopped');
  assert.equal(walkOffset({ from: 40, to: 40, ms: 0, at: 0 }, 1), 40);
});

test('phone: the remote only does what is listed, and only after you allow it', async () => {
  const { PhoneRemote } = require('../lib/phone-remote');
  const calls = [];
  const helper = { call: async (cmd, args) => { calls.push([cmd, args]); } };
  const remote = new PhoneRemote({ helper, pc: { action: async (name) => calls.push(['pc', name]) } });
  await remote.run({ type: 'move', dx: 9999, dy: -3.4 });
  await remote.run({ type: 'key', keys: 'alt+tab' });
  await remote.run({ type: 'media', action: 'toggle' });
  await remote.run({ type: 'lock' });
  assert.deepEqual(calls, [['remote.move', { dx: 400, dy: -3 }], ['input.keys', { keys: 'alt+tab' }], ['media', { action: 'toggle' }], ['pc', 'lock']]);
  assert.throws(() => remote.run({ type: 'key', keys: 'win+r' }), /not available/);
  assert.throws(() => remote.run({ type: 'run', command: 'format c:' }), /Unknown action/);
  assert.throws(() => remote.run(null), /Unknown action/);

  const { PhoneDrop } = require('../lib/drop');
  const done = [];
  const drop = new PhoneDrop({
    saveDir: () => os.tmpdir(), listFiles: () => [], onFile() {}, onText() {}, onStop() {}, onRemote: async (action) => done.push(action), page: __filename,
  });
  await drop.start('127.0.0.1');
  const send = (body) => fetch(`${drop.url}remote`, { method: 'POST', body });
  assert.equal(drop.setRemote(true), true);
  assert.equal(drop.status().remote, true);
  drop.setRemote(false);
  assert.equal((await send('{"type":"lock"}')).status, 403, 'off by default');
  drop.setRemote(true);
  assert.equal((await send('{"type":"lock"}')).status, 200);
  assert.equal((await send('not json')).status, 400);
  assert.equal((await send('x'.repeat(5000))).status, 413);
  assert.equal((await fetch(`${drop.url.replace(drop.token, 'wrong')}remote`, { method: 'POST', body: '{}' })).status, 404, 'a wrong link gets nothing');
  assert.deepEqual(done, [{ type: 'lock' }]);
  drop.stop();
  assert.equal(drop.setRemote(true), false, 'off again once sharing stops');
});

test('control: saved VPNs are read, and only listed names ever reach Windows', async () => {
  const { PcControl, connectedNames, parsePhonebook } = require('../lib/pc-control');
  const names = parsePhonebook('[Japan]\nEncoding=1\nType=2\n\n[Russian ]\nType=2\n');
  assert.deepEqual(names, ['Japan', 'Russian ']);
  assert.deepEqual(connectedNames('Connected to\nRussian\nCommand completed successfully.\n', names), ['Russian ']);
  assert.deepEqual(connectedNames('No connections\nCommand completed successfully.', names), []);

  const calls = [];
  const helper = { call: async (cmd, args) => { calls.push([cmd, args]); return { wifi: false, bluetooth: false, powerOverlay: '961cc777-2547-4f9d-8174-7d86181b8a7a' }; } };
  const pc = new PcControl({ helper, shell: {}, env: {} });
  await pc.set('flight', true);
  assert.deepEqual(calls.map(([, args]) => [args.name, args.on]), [['wifi', false], ['bluetooth', false]], 'flight mode turns both radios off');
  const state = await pc.state();
  assert.deepEqual([state.flight, state.power], [true, 'saver']);
  await assert.rejects(pc.set('anything', true), /Unknown setting/);
  await assert.rejects(pc.action('format'), /Unknown action/);
  assert.throws(() => pc.open('calc.exe'), /Unknown page/);
  await assert.rejects(pc.vpnConnect('Japan'), /No saved VPN/, 'nothing is saved in this test');
});

test('agent: quick settings are a tool, and each change shows what it will do', async () => {
  const { describe, ComputerTools } = require('../lib/agent-tools');
  assert.equal(describe('pc_setting', { setting: 'dark', on: true }), 'Turn dark on');
  assert.equal(describe('pc_setting', { setting: 'vpn', name: 'Japan', on: false }), 'Disconnect VPN Japan');
  const done = [];
  const pc = {
    set: async (name, on) => done.push([name, on]), vpnNames: () => ['Russian '], vpnConnect: async (name) => done.push(['vpn', name]), setPowerMode: async (mode) => done.push(['power', mode]),
  };
  const tools = new ComputerTools({ pc });
  await tools.act('pc_setting', { setting: 'dark', on: true });
  await tools.act('pc_setting', { setting: 'vpn', name: 'russian', on: true });
  await tools.act('pc_setting', { setting: 'power', name: 'saver' });
  assert.deepEqual(done, [['dark', true], ['vpn', 'Russian '], ['power', 'saver']]);
  await assert.rejects(tools.act('pc_setting', { setting: 'vpn', name: 'nothing' }), /No saved VPN/);
});

test('mcp: a restored backup cannot start a program by itself', () => {
  const { withServersOff } = require('../lib/backup');
  const restored = withServersOff({ theme: 'x', ai: { provider: 'gemini', mcpServers: [{ id: '1', command: 'evil.exe', on: true }] } });
  assert.deepEqual(restored.ai.mcpServers, [{ id: '1', command: 'evil.exe', on: false }]);
  assert.equal(restored.theme, 'x');
  assert.deepEqual(withServersOff({ theme: 'x' }), { theme: 'x' }, 'old backups are fine');
});

test('tools: run_command gives output and exit code, handles Unicode, time limits and stop', async () => {
  const { runCommand } = require('../lib/agent-shell');
  assert.match(await runCommand({ command: "Write-Output 'नमस्ते'" }), /^Exit code 0\nनमस्ते/);
  assert.match(await runCommand({ command: 'cmd /c exit 7' }), /^Exit code 7/);
  assert.match(await runCommand({ command: "Write-Error 'it broke'; exit 3" }), /^Exit code 3[\s\S]*it broke/);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nook unit '));
  assert.ok((await runCommand({ command: '(Get-Location).Path', folder })).includes(path.basename(folder)));
  const started = Date.now();
  assert.match(await runCommand({ command: 'Start-Sleep 30', seconds: 1 }), /Stopped after 1 seconds/);
  assert.ok(Date.now() - started < 10000);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 500);
  assert.match(await runCommand({ command: 'Start-Sleep 30' }, controller.signal), /Stopped by the person/);
  const long = await runCommand({ command: "Write-Output ('x' * 100000)" });
  assert.ok(long.length < 31000 && /characters cut/.test(long));
  fs.rmSync(folder, { recursive: true, force: true });
});

test('tools: edit_file changes one exact match and refuses anything unsure', async () => {
  const { editFile } = require('../lib/agent-files');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-unit-'));
  const file = path.join(folder, 'a.txt');
  const input = (old_text, new_text = 'new') => ({ path: file, old_text, new_text });
  fs.writeFileSync(file, 'one two two $& three');
  await editFile(input('one', 'नया $& one'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'नया $& one two two $& three', 'the new text is used exactly');
  await assert.rejects(editFile(input('two')), /appears 2 times/);
  await assert.rejects(editFile(input('missing')), /not found/);
  await assert.rejects(editFile(input('')), /cannot be empty/);
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0x41, 0x00]));
  await assert.rejects(editFile(input('A')), /not a UTF-8/);
  assert.deepEqual([...fs.readFileSync(file)], [0xff, 0xfe, 0x41, 0x00], 'left as it was');
  fs.rmSync(folder, { recursive: true, force: true });
});

test('tools: search_files finds names and text, skips heavy folders', async () => {
  const { searchFiles } = require('../lib/agent-files');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-unit-'));
  fs.mkdirSync(path.join(folder, 'sub'));
  fs.mkdirSync(path.join(folder, 'node_modules'));
  fs.writeFileSync(path.join(folder, 'bill.pdf'), 'x');
  fs.writeFileSync(path.join(folder, 'sub', 'notes.txt'), 'first\nThe Total is 500\n');
  fs.writeFileSync(path.join(folder, 'node_modules', 'hidden.txt'), 'The Total is 900');
  fs.writeFileSync(path.join(folder, 'data.bin'), Buffer.from([0, 1, 2, 84, 111, 116, 97, 108]));
  assert.ok((await searchFiles({ folder, name: '*.pdf' })).endsWith('bill.pdf'));
  assert.ok((await searchFiles({ folder, name: 'NOTES' })).endsWith('notes.txt'));
  assert.match(await searchFiles({ folder, text: 'total is' }), /notes\.txt:2: The Total is 500$/);
  assert.equal(await searchFiles({ folder, name: 'nothing-like-this' }), 'Nothing found.');
  await assert.rejects(searchFiles({ folder }), /Give a file name/);
  await assert.rejects(searchFiles({ folder: path.join(folder, 'gone'), name: 'a' }), /Cannot open/);
  fs.rmSync(folder, { recursive: true, force: true });
});

test('tools: delete refuses the places that must never go', () => {
  const { assertDeletable } = require('../lib/agent-files');
  const home = os.homedir();
  for (const place of ['C:\\', home, process.env.windir, process.env.ProgramFiles]) assert.throws(() => assertDeletable(place, home), /too important/);
  assert.equal(assertDeletable(path.join(home, 'old.txt'), home), path.join(home, 'old.txt'));
});

test('tools: web pages become text, search results are read', async () => {
  const { htmlToText, parseResults, webFetch, webSearch } = require('../lib/agent-web');
  assert.equal(htmlToText('<style>a{}</style><p>One &amp; two</p><script>x()</script><div>&#2344;</div>'), 'One & two\nन');
  const page = '<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">An <b>example</b></a><a class="result__snippet" href="x">Short <b>text</b></a></div>';
  assert.deepEqual(parseResults(page), [{ url: 'https://example.com/a', title: 'An example', snippet: 'Short text' }]);
  const mock = await mockServer((req, res) => {
    if (req.url.startsWith('/search')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
    if (req.url === '/file') { res.writeHead(200, { 'Content-Type': 'application/zip' }); res.end('x'); return; }
    if (req.url === '/gone') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Hello</title><p>Body text</p>');
  });
  assert.match(await webFetch({ url: `${mock.url}/page` }), /^Hello\n\nHello\s+Body text/);
  await assert.rejects(webFetch({ url: `${mock.url}/file` }), /not a page/);
  await assert.rejects(webFetch({ url: `${mock.url}/gone` }), /answered 404/);
  await assert.rejects(webFetch({ url: 'file:///C:/Windows/win.ini' }), /Only http/);
  assert.match(await webSearch({ query: 'a b' }, undefined, `${mock.url}/search`), /1\. An example\nhttps:\/\/example\.com\/a\nShort text/);
  mock.close();
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok    ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${name}\n      ${err.message.split('\n').slice(0, 12).join('\n      ')}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();

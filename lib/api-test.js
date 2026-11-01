'use strict';

// The Test button in Settings > AI. Finds out what a model can really do, because the same request
// works on one model and fails on another, whatever the API's name says.
const { baseTurns, rejected } = require('./agent-models');
const { activeApi } = require('./ai-profiles');

const RED_SQUARE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsAtx/ZMZxgi+hcEKLNO+FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBywKqxUDxqh7TUQAAAABJRU5ErkJggg==';
const TIMEOUT_MS = 90000;
const MODELS_TIMEOUT_MS = 15000;
const MAX_MODELS = 300;
const ANYTHING = /./;
const PING = {
  name: 'ping',
  description: 'Checks that tools work.',
  input: {
    type: 'object', properties: { word: { type: 'string', description: 'Any short word' } }, required: ['word'], additionalProperties: false,
  },
};

async function ask(api, system, tools, text, files, signal) {
  const turns = baseTurns(api, system, tools);
  turns.addUser(text, files);
  return turns.next(signal);
}

// True or false when the model answered, null when something else got in the way, such as a rate limit.
async function check(run) {
  try {
    return await run();
  } catch (err) {
    return rejected(err, ANYTHING) ? false : null;
  }
}

async function testApi(ai) {
  const api = activeApi(ai);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  await ask(api, 'Reply briefly.', [], 'Reply with the word OK.', [], signal); // a wrong key or model stops here, in the API's own words
  const tools = await check(async () => {
    const reply = await ask(api, 'Use the ping tool.', [PING], 'Call the ping tool now.', [], signal);
    return reply.calls.some((call) => call.name === 'ping');
  });
  const vision = await check(async () => {
    const picture = { kind: 'image', name: 'test.png', media: 'image/png', data: RED_SQUARE };
    const reply = await ask(api, 'Answer with one word.', [], 'What colour fills this picture?', [picture], signal);
    return /red|लाल|laal/i.test(reply.text);
  });
  return { tools, vision };
}

// Only OpenAI-style APIs publish their model names in one known way.
async function listModels(ai) {
  const api = activeApi(ai, { needModel: false });
  if (api.kind !== 'openai') return [];
  const response = await fetch(`${api.baseURL.replace(/\/+$/, '')}/models`, {
    headers: api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {},
    signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${api.name} error ${response.status}. Check the key and address.`);
  const { data } = await response.json();
  return (data || []).map((item) => item.id).filter(Boolean).sort().slice(0, MAX_MODELS);
}

module.exports = { listModels, testApi };

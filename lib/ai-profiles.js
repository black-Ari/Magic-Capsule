'use strict';

// Turns the choice in Settings > AI into what is needed to call that API. A provider is one of the
// built-in names, or "api:<id>" for an API the person added to their own list.
const { CLAUDE_MODELS } = require('./defaults');
const store = require('./store');

const LOCAL_HOST = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]$)/;

function checkUrl(url, hasKey) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Check the API address in Settings > AI.');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('An API address must start with http or https.');
  if (hasKey && parsed.protocol === 'http:' && !LOCAL_HOST.test(parsed.hostname)) {
    throw new Error('This address uses plain http, which would send your key unprotected. Use https.');
  }
}

const capsKey = (provider, model) => `${provider}:${model}`;

function activeApi(ai, { needModel = true } = {}) {
  const {
    provider, models, openaiUrl, ollamaUrl, apis = [], caps = {},
  } = ai;
  const isCustom = provider.startsWith('api:');
  const custom = isCustom ? apis.find((api) => `api:${api.id}` === provider) : null;
  if (isCustom && !custom) throw new Error('That API was removed. Choose another in Settings > AI.');

  const model = ((isCustom ? custom.model : models[provider]) || '').trim();
  if (!model && needModel) throw new Error('Choose a model name in Settings > AI first.');
  const apiKey = provider === 'ollama' ? '' : store.secrets.get(`ai.${provider}`);
  if (!isCustom && provider !== 'ollama' && !apiKey) throw new Error('Add your API key in Settings > AI first.');

  const base = { apiKey, model, caps: caps[capsKey(provider, model)] || {} };
  if (isCustom) {
    checkUrl(custom.url, Boolean(apiKey));
    return { ...base, kind: 'openai', baseURL: custom.url, name: custom.name || 'API' };
  }
  switch (provider) {
    case 'gemini': return { ...base, kind: 'gemini', name: 'Gemini' };
    case 'claude':
      if (needModel && !CLAUDE_MODELS.includes(model)) throw new Error('Pick a Claude model in Settings > AI.');
      return { ...base, kind: 'claude', name: 'Claude' };
    case 'openai':
      checkUrl(openaiUrl, Boolean(apiKey));
      return { ...base, kind: 'openai', baseURL: openaiUrl, name: 'API' };
    case 'ollama':
      checkUrl(ollamaUrl, false);
      return { ...base, kind: 'openai', baseURL: ollamaUrl, name: 'Ollama' };
    default: throw new Error(`Unknown AI provider: ${provider}`);
  }
}

module.exports = { activeApi, capsKey, checkUrl };

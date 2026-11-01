'use strict';

// One conversation per task. Each provider has its own message format, so each gets a small class
// with the same three methods: addUser, next and addResults.
const { ClaudeTurns } = require('./ai-claude');
const { activeApi } = require('./ai-profiles');
const { fetchWithRetry } = require('./api-retry');
const { promptWith } = require('./attachments');

const KEEP_SHOTS = 3; // older screenshots are dropped, or every step resends them all
const OLD_SHOT = '[An older screenshot was removed to save space.]';
const BLIND_NOTE = 'This model cannot see pictures. Use list_windows and read_ui to read the screen as text.';
const REJECTED = new Set([400, 404, 415, 422, 501]);
const TOOL_ERROR = /tool|function/i;
const IMAGE_ERROR = /image|vision|multi-?modal|content.*(string|array)/i;
const UNSUPPORTED_SCHEMA_KEYS = new Set(['additionalProperties', '$schema', '$id', '$defs', 'definitions', 'default']);

class ApiError extends Error {
  constructor(name, status, body) {
    super(`${name} error ${status}: ${body.slice(0, 200)}`);
    Object.assign(this, { status, body });
  }
}

const rejected = (err, pattern) => REJECTED.has(err.status) && pattern.test(err.body || '');

async function postJson(url, headers, body, signal, name, onRetry) {
  const response = await fetchWithRetry(url, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }, onRetry);
  const text = await response.text();
  if (!response.ok) throw new ApiError(name, response.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} sent a reply that is not JSON. Check the API address.`);
  }
}

function forgetOldShots(shots, drop) {
  while (shots.length > KEEP_SHOTS) drop(shots.shift());
}

function parseArguments(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null; // the agent tells the model, instead of the whole task failing
  }
}

class GeminiTurns {
  constructor({ apiKey, model, system, tools, baseURL, onRetry }) {
    Object.assign(this, { apiKey, model, system, onRetry });
    this.root = baseURL || 'https://generativelanguage.googleapis.com/v1beta';
    // A tool with no arguments is declared without parameters.
    this.declarations = tools.map(({ name, description, input }) => ({
      name,
      description,
      ...(Object.keys(input.properties || {}).length ? { parameters: JSON.parse(JSON.stringify(input, (key, value) => (UNSUPPORTED_SCHEMA_KEYS.has(key) ? undefined : value))) } : {}),
    }));
    this.contents = [];
    this.shots = [];
  }

  addUser(text, attachments) {
    const parts = attachments.filter((item) => item.data).map((item) => ({ inlineData: { mimeType: item.media, data: item.data } }));
    this.contents.push({ role: 'user', parts: [...parts, { text: promptWith(text, attachments) }] });
  }

  async next(signal) {
    const url = `${this.root}/models/${encodeURIComponent(this.model)}:generateContent`;
    const reply = await postJson(url, { 'x-goog-api-key': this.apiKey }, {
      systemInstruction: { parts: [{ text: this.system }] },
      contents: this.contents,
      ...(this.declarations.length ? { tools: [{ functionDeclarations: this.declarations }] } : {}),
    }, signal, 'Gemini', this.onRetry);
    const content = reply.candidates?.[0]?.content;
    if (!content) throw new Error(`Gemini gave no answer (${reply.promptFeedback?.blockReason || reply.candidates?.[0]?.finishReason || 'unknown'}).`);
    this.contents.push(content); // sent back exactly as received, signatures included
    const parts = content.parts || [];
    return {
      text: parts.filter((part) => part.text && !part.thought).map((part) => part.text).join(''),
      calls: parts.filter((part) => part.functionCall).map((part) => ({ id: part.functionCall.name, name: part.functionCall.name, input: part.functionCall.args || {} })),
    };
  }

  addResults(results) {
    const parts = results.map(({ call, text }) => ({ functionResponse: { name: call.name, response: { result: text } } }));
    for (const { image } of results) {
      if (!image) continue;
      const part = { inlineData: { mimeType: image.media, data: image.data } };
      parts.push(part);
      this.shots.push({ parts, part });
    }
    this.contents.push({ role: 'user', parts });
    forgetOldShots(this.shots, (shot) => { shot.parts[shot.parts.indexOf(shot.part)] = { text: OLD_SHOT }; });
  }
}

class OpenAiTurns {
  constructor({ apiKey, model, system, tools, baseURL, name, blind, onRetry }) {
    Object.assign(this, { apiKey, model, name, blind: Boolean(blind), onRetry });
    this.url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
    this.tools = tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input } }));
    this.messages = [{ role: 'system', content: system }];
    this.shots = [];
  }

  addUser(text, attachments) {
    const images = this.blind ? [] : attachments.filter((item) => item.kind === 'image')
      .map((item) => ({ type: 'image_url', image_url: { url: `data:${item.media};base64,${item.data}` } }));
    const prompt = promptWith(text, attachments);
    const message = { role: 'user', content: images.length ? [{ type: 'text', text: prompt }, ...images] : prompt };
    this.messages.push(message);
    if (images.length && attachments.some((item) => item.shot)) this.shots.push(message);
    this.forget();
  }

  forget() {
    forgetOldShots(this.shots, (message) => { message.content = OLD_SHOT; });
  }

  async ask(signal) {
    const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
    const body = { model: this.model, messages: this.messages, ...(this.tools.length ? { tools: this.tools } : {}) };
    const reply = await postJson(this.url, headers, body, signal, this.name, this.onRetry);
    const message = reply.choices?.[0]?.message;
    if (!message) throw new Error(`${this.name} gave no answer.`);
    this.messages.push(message);
    return {
      text: message.content || '',
      calls: (message.tool_calls || []).map((call) => ({ id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) })),
    };
  }

  hasImages() {
    return this.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'));
  }

  // A model that refuses pictures carries on with the text it has.
  goBlind() {
    this.blind = true;
    this.shots = [];
    for (const message of this.messages) {
      if (Array.isArray(message.content)) message.content = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') || BLIND_NOTE;
    }
  }

  async next(signal) {
    try {
      return await this.ask(signal);
    } catch (err) {
      if (this.blind || !this.hasImages() || !rejected(err, IMAGE_ERROR)) throw err;
      this.goBlind();
      return this.ask(signal);
    }
  }

  addResults(results) {
    for (const { call, text, image } of results) {
      this.messages.push({ role: 'tool', tool_call_id: call.id, content: image && this.blind ? `${text} ${BLIND_NOTE}` : text });
    }
    const images = this.blind ? [] : results.filter((result) => result.image).map(({ image }) => ({
      type: 'image_url', image_url: { url: `data:${image.media};base64,${image.data}` },
    }));
    if (images.length) {
      const message = { role: 'user', content: [{ type: 'text', text: 'The screen now:' }, ...images] };
      this.messages.push(message);
      this.shots.push(message);
      this.forget();
    }
  }
}

const textToolRules = (tools) => `

This model has no tool calling, so use this form instead. To use a tool, reply with one block exactly like this and write nothing after it:
\`\`\`tool
{"name": "tool_name", "input": {}}
\`\`\`
The result comes back in the next message. When the task is finished, reply in plain words with no block.

Tools:
${tools.map((tool) => `- ${tool.name}: ${tool.description} Input: ${JSON.stringify(tool.input.properties || {})}`).join('\n')}`;

function parseTextTools(text) {
  const calls = [];
  const rest = text.replace(/```(tool|json)?\s*(\{[\s\S]*?\})\s*```/g, (whole, label, body) => {
    const parsed = parseArguments(body);
    if (typeof parsed?.name === 'string') {
      calls.push({ id: `text-${calls.length}`, name: parsed.name, input: parsed.input || {} });
      return '';
    }
    if (label !== 'tool') return whole;
    calls.push({ id: `text-${calls.length}`, name: 'unknown', input: null });
    return '';
  });
  return { text: rest.trim(), calls };
}

// For models without tool calling: they write a small JSON block, and Magic Capsule reads it.
class TextToolTurns {
  constructor(inner) {
    this.inner = inner;
  }

  addUser(text, files) {
    this.inner.addUser(text, files);
  }

  async next(signal) {
    return parseTextTools((await this.inner.next(signal)).text);
  }

  addResults(results) {
    const text = results.map((result) => `Result of ${result.call.name}:\n${result.text}`).join('\n\n');
    this.inner.addUser(text, results.filter((result) => result.image).map(({ image }) => ({ kind: 'image', name: 'screen', shot: true, ...image })));
  }
}

// When nobody has tested a model yet, a refusal of tools on the first request switches to text tools.
class ToolFallback {
  constructor(make) {
    this.make = make;
    this.current = make(false);
    this.sent = [];
  }

  addUser(text, files) {
    this.sent.push([text, files]);
    this.current.addUser(text, files);
  }

  async next(signal) {
    try {
      return await this.current.next(signal);
    } catch (err) {
      if (this.switched || !rejected(err, TOOL_ERROR)) throw err;
      this.switched = true;
      this.current = this.make(true);
      for (const [text, files] of this.sent) this.current.addUser(text, files);
      return this.current.next(signal);
    }
  }

  addResults(results) {
    this.switched = true; // a model that got this far can call tools
    this.current.addResults(results);
  }
}

function baseTurns(api, system, tools, { blind, onRetry } = {}) {
  const common = { apiKey: api.apiKey, model: api.model, system, tools, onRetry };
  switch (api.kind) {
    case 'gemini': return new GeminiTurns(common);
    case 'claude': return new ClaudeTurns(common);
    default: return new OpenAiTurns({ ...common, baseURL: api.baseURL, name: api.name, blind });
  }
}

function createTurns(ai, system, tools, { onRetry } = {}) {
  const api = activeApi(ai);
  const blind = api.caps.vision === false;
  const offered = blind ? tools.filter((tool) => tool.name !== 'screenshot') : tools;
  const prompt = blind ? `${system}\n\n${BLIND_NOTE}` : system;
  const make = (textTools) => {
    if (!textTools) return baseTurns(api, prompt, offered, { blind, onRetry });
    return new TextToolTurns(baseTurns(api, prompt + textToolRules(offered), [], { blind, onRetry }));
  };
  if (api.caps.tools === false) return make(true);
  return api.kind === 'claude' ? make(false) : new ToolFallback(make);
}

module.exports = {
  ApiError, GeminiTurns, OpenAiTurns, TextToolTurns, ToolFallback, baseTurns, createTurns, parseTextTools, rejected, TOOL_ERROR, IMAGE_ERROR,
};

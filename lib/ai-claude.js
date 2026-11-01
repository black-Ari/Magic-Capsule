'use strict';

const { promptWith } = require('./attachments');
const dep = require('./deps');

// Loaded on first use, so it takes no memory for someone using another AI.
const sdk = () => dep('@anthropic-ai/sdk');

// These models accept the server-side fallback for requests a safety classifier declines.
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5']);
const MAX_TOKENS = 64000;
const AGENT_MAX_TOKENS = 16000;

function friendlyError(err) {
  const Anthropic = sdk();
  if (err instanceof Anthropic.AuthenticationError) return new Error('Claude rejected the API key. Check it in Settings.');
  if (err instanceof Anthropic.PermissionDeniedError) return new Error('This API key cannot use that Claude model.');
  if (err instanceof Anthropic.RateLimitError) return new Error('Claude rate limit reached. Try again shortly.');
  if (err instanceof Anthropic.APIConnectionError) return new Error('Could not reach Claude. Check your connection.');
  return err;
}

async function* streamClaude({ apiKey, model, system, messages, signal, baseURL }) {
  const Anthropic = sdk();
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const params = { model, max_tokens: MAX_TOKENS, system, messages, output_config: { effort: 'low' } };
  const stream = FALLBACK_MODELS.has(model)
    ? client.beta.messages.stream(
      { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
      { signal },
    )
    : client.messages.stream(params, { signal });

  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  } catch (err) {
    throw friendlyError(err);
  }
}

function imageBlock({ media, data }) {
  return { type: 'image', source: { type: 'base64', media_type: media, data } };
}

// One agent task. The whole response goes back into the history unchanged, thinking blocks included.
class ClaudeTurns {
  constructor({ apiKey, model, system, tools, baseURL }) {
    const Anthropic = sdk();
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.params = {
      model,
      max_tokens: AGENT_MAX_TOKENS,
      system,
      ...(tools.length ? { tools: tools.map(({ name, description, input }) => ({ name, description, input_schema: input })) } : {}),
      output_config: { effort: 'medium' },
    };
    this.messages = [];
  }

  addUser(text, attachments) {
    const blocks = attachments.filter((item) => item.data).map((item) => (item.kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: item.media, data: item.data } }
      : imageBlock(item)));
    this.messages.push({ role: 'user', content: [...blocks, { type: 'text', text: promptWith(text, attachments) }] });
  }

  async next(signal) {
    const params = { ...this.params, messages: this.messages };
    let message;
    try {
      message = FALLBACK_MODELS.has(params.model)
        ? await this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
        : await this.client.messages.create(params, { signal });
    } catch (err) {
      throw friendlyError(err);
    }
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this request.');
    this.messages.push({ role: 'assistant', content: message.content });
    return {
      text: message.content.filter((block) => block.type === 'text').map((block) => block.text).join(''),
      calls: message.content.filter((block) => block.type === 'tool_use').map(({ id, name, input }) => ({ id, name, input })),
    };
  }

  // All results of one turn go back in a single message.
  addResults(results) {
    this.messages.push({
      role: 'user',
      content: results.map(({ call, text, image }) => ({
        type: 'tool_result',
        tool_use_id: call.id,
        content: [{ type: 'text', text }, ...(image ? [imageBlock(image)] : [])],
      })),
    });
  }
}

module.exports = { streamClaude, ClaudeTurns };

'use strict';

// MCP is a common way to plug in tools. Servers from Settings > AI connect when a task starts, their
// tools work with every AI provider, and they disconnect when the task ends.
const dep = require('./deps');

const CONNECT_MS = 20000;
const CALL_MS = 120000;
const MAX_NAME = 64;

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'server';
const withLimit = (promise, ms, what) => {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took too long`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
};

// "NAME=value" lines become environment variables for a local server.
function parseEnv(secret) {
  return Object.fromEntries(String(secret || '').split(/\r?\n/).map((line) => /^\s*([A-Za-z_]\w*)=(.*)$/.exec(line)).filter(Boolean).map(([, key, value]) => [key, value]));
}

function transportFor(server, secret) {
  if (server.kind === 'url') {
    const { StreamableHTTPClientTransport } = dep('@modelcontextprotocol/sdk/client/streamableHttp.js');
    return new StreamableHTTPClientTransport(new URL(server.url), secret ? { requestInit: { headers: { Authorization: `Bearer ${secret}` } } } : {});
  }
  const { StdioClientTransport, getDefaultEnvironment } = dep('@modelcontextprotocol/sdk/client/stdio.js');
  return new StdioClientTransport({
    command: server.command,
    args: String(server.args || '').match(/"[^"]*"|\S+/g)?.map((part) => part.replace(/^"|"$/g, '')) || [],
    env: { ...getDefaultEnvironment(), ...parseEnv(secret) },
    stderr: 'ignore',
  });
}

async function connect(server, secret) {
  const { Client } = dep('@modelcontextprotocol/sdk/client/index.js');
  const client = new Client({ name: 'Magic Capsule', version: '0.1.0' });
  await withLimit(client.connect(transportFor(server, secret)), CONNECT_MS, server.name);
  return client;
}

async function listAll(client) {
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

class McpTools {
  constructor({ getServers, getSecret }) {
    Object.assign(this, { getServers, getSecret });
    this.clients = [];
    this.routes = new Map();
  }

  // One broken server must not stop the task, so it is reported and skipped.
  async open(report) {
    const tools = [];
    for (const server of this.getServers().filter((item) => item.on)) {
      try {
        const client = await connect(server, this.getSecret(server.id));
        this.clients.push(client);
        for (const tool of await withLimit(listAll(client), CONNECT_MS, server.name)) {
          const name = `mcp_${slug(server.name)}_${slug(tool.name)}`.slice(0, MAX_NAME);
          this.routes.set(name, { client, tool: tool.name });
          tools.push({
            name,
            risk: server.trusted ? 'act' : 'always',
            description: `${tool.description || tool.name} (from ${server.name})`.slice(0, 900),
            input: { type: 'object', properties: {}, ...tool.inputSchema },
          });
        }
      } catch (err) {
        report(`Could not use ${server.name}: ${err.message}`);
      }
    }
    return tools;
  }

  async call(name, input, signal) {
    const route = this.routes.get(name);
    if (!route) throw new Error(`Unknown tool: ${name}`);
    const reply = await route.client.callTool({ name: route.tool, arguments: input }, undefined, { signal, timeout: CALL_MS });
    const parts = reply.content || [];
    const text = parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
      || (parts.length ? '(no text)' : 'Done.');
    const picture = parts.find((part) => part.type === 'image');
    return {
      text: reply.isError ? `That failed: ${text}` : text,
      ...(picture ? { image: { media: picture.mimeType, data: picture.data } } : {}),
    };
  }

  async close() {
    const { clients } = this;
    this.clients = [];
    this.routes.clear();
    await Promise.all(clients.map((client) => client.close().catch(() => {})));
  }
}

// For the Test button in Settings.
async function testServer(server, secret) {
  const client = await connect(server, secret);
  try {
    return (await withLimit(listAll(client), CONNECT_MS, server.name)).map((tool) => tool.name);
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { McpTools, testServer, parseEnv };

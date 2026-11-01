'use strict';

// A tiny real MCP server, started by tests/unit.js.
const dep = require('../lib/deps');

const { Server } = dep('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = dep('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = dep('@modelcontextprotocol/sdk/types.js');

const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'add numbers', description: 'Adds two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
    { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => (params.name === 'fail'
  ? { isError: true, content: [{ type: 'text', text: 'broken' }] }
  : { content: [{ type: 'text', text: String(params.arguments.a + params.arguments.b) }] }));

server.connect(new StdioServerTransport());

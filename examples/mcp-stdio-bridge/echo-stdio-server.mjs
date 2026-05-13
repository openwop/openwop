// Minimal stdio MCP server — the canonical transport for
// `modelcontextprotocol/servers` references. Used to smoke-test
// `bridge.mjs` end-to-end against the openwop probe without needing
// to install a third-party stdio server.
//
// Wire shape: JSON-RPC framed by newlines on stdin/stdout. One tool
// `greet({name})` returns "Hello, <name>!" — same surface as the
// HTTP reference in `/tmp/openwop-interop/mcp/server.mjs` so the
// probe assertions stay shape-only across both transports.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  { name: 'openwop-example-mcp-stdio-echo', version: '1.0.0' },
  { capabilities: { logging: {} } },
);

server.registerTool(
  'greet',
  {
    description: 'A simple greeting tool',
    inputSchema: { name: z.string().describe('Name to greet') },
  },
  async ({ name }) => ({
    content: [{ type: 'text', text: `Hello, ${name}!` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

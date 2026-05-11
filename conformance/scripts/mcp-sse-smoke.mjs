#!/usr/bin/env node
/**
 * Smoke for the MCP SSE-frame parser in `mcp-tool-roundtrip.test.ts`.
 *
 * Boots a tiny SSE-emitting MCP-style server (responds to JSON-RPC
 * POSTs with `Content-Type: text/event-stream` framing) and runs the
 * conformance scenario against it. This proves the auto-detect path
 * works against a real streamable-http+SSE wire shape without needing
 * to install `modelcontextprotocol/servers/everything` etc.
 *
 * Run: node conformance/scripts/mcp-sse-smoke.mjs
 *
 * Expected output: "mcp-sse-smoke: PASS" + exit code 0.
 */

import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (c) => {
    body += c.toString('utf8');
  });
  req.on('end', () => {
    const parsed = JSON.parse(body);
    const responses = (() => {
      if (parsed.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: parsed.id,
          result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } },
        };
      }
      if (parsed.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: parsed.id,
          result: { tools: [{ name: 'sse-smoke-tool', description: 'test tool', inputSchema: { type: 'object' } }] },
        };
      }
      if (parsed.method === 'tools/call') {
        return {
          jsonrpc: '2.0',
          id: parsed.id,
          result: { content: [{ type: 'text', text: `via-sse:${parsed.params?.name ?? ''}` }] },
        };
      }
      return { jsonrpc: '2.0', id: parsed.id, error: { code: -32601, message: 'method not found' } };
    })();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Emit a notification frame first (to exercise the "skip until id
    // matches" path), then the matching response, then close.
    res.write(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notification/log', params: { level: 'info', message: 'before-response' } })}\n\n`,
    );
    res.write(`event: message\ndata: ${JSON.stringify(responses)}\n\n`);
    res.end();
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

// Replicate the postJsonRpc function from mcp-tool-roundtrip.test.ts.
async function readSseUntilId(res, wantId, timeoutMs = 5_000) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let sepIndex;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const dataLines = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      if (dataLines.length === 0) continue;
      try {
        const parsed = JSON.parse(dataLines.join('\n'));
        if (parsed.id === wantId) {
          void reader.cancel().catch(() => undefined);
          return parsed;
        }
      } catch {
        // skip
      }
    }
    if (done) break;
  }
  throw new Error(`SSE stream closed before frame with id=${wantId} arrived`);
}

async function postJsonRpc(endpoint, method, params, id) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return { status: res.status, json: await readSseUntilId(res, id) };
  }
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) };
}

try {
  const init = await postJsonRpc(url, 'initialize', {}, 1);
  if (init.json.id !== 1 || init.json.result?.protocolVersion !== '2024-11-05') {
    throw new Error(`initialize bad: ${JSON.stringify(init.json)}`);
  }

  const list = await postJsonRpc(url, 'tools/list', {}, 2);
  if (list.json.id !== 2 || !Array.isArray(list.json.result?.tools)) {
    throw new Error(`tools/list bad: ${JSON.stringify(list.json)}`);
  }
  const toolName = list.json.result.tools[0].name;

  const call = await postJsonRpc(url, 'tools/call', { name: toolName, arguments: {} }, 3);
  if (call.json.id !== 3 || call.json.result?.content?.[0]?.text !== `via-sse:${toolName}`) {
    throw new Error(`tools/call bad: ${JSON.stringify(call.json)}`);
  }

  console.log('mcp-sse-smoke: PASS');
} finally {
  server.close();
  await sleep(100);
}

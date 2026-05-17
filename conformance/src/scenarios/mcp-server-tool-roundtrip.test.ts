/**
 * mcp-server-tool-roundtrip — RFC 0020 §A points 1-2 (workflow → MCP tool).
 *
 * Status: ACTIVE (advertisement + behavioral). The behavioral half registers
 * a workflow with `core.openwop.mcp.expose-tool` via the host's workflow
 * registration endpoint, then issues JSON-RPC `tools/list` + `tools/call`
 * against the reference-host MCP server mount at `/v1/host/sample/mcp`
 * (env-gated on `OPENWOP_MCP_SERVER_ENABLED=true`). Hosts that don't expose
 * the seam (HTTP 404) soft-skip the behavioral assertions and verify
 * advertisement shape only.
 *
 * @see RFCS/0020-host-mcp-server-composition.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
  const cur = (top && typeof top === 'object') ? (top as Record<string, unknown>)["mcp"] : undefined;
  const final = (cur && typeof cur === 'object') ? (cur as Record<string, unknown>)["serverMount"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

async function rpc(method: string, params?: Record<string, unknown>): Promise<{ status: number; body: { result?: unknown; error?: { code: number; message: string } } }> {
  const id = Math.floor(Math.random() * 1e6);
  const req: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) req.params = params;
  const res = await driver.post('/v1/host/sample/mcp', req);
  return { status: res.status, body: res.json as { result?: unknown; error?: { code: number; message: string } } };
}

const TEST_TOOL_NAME = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function registerToolWorkflow(): Promise<boolean> {
  const res = await driver.post('/v1/host/sample/workflows', {
    workflowId: `mcp.scenario.${TEST_TOOL_NAME}`,
    nodes: [
      {
        nodeId: 'expose',
        typeId: 'core.openwop.mcp.expose-tool',
        config: {
          name: TEST_TOOL_NAME,
          description: 'Conformance-test tool',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          },
        },
      },
    ],
  });
  return res.status === 200 || res.status === 201;
}

describe('mcp-server-tool-roundtrip: advertisement shape (RFC 0020)', () => {
  it('capabilities.mcp.serverMount is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return;
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §mcp.serverMount',
        'capabilities.mcp.serverMount.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('mcp-server-tool-roundtrip: behavioral (RFC 0020 §A points 1-2)', () => {
  it('tools/list returns the exposed workflow + tools/call returns a CallToolResult', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const registered = await registerToolWorkflow();
    if (!registered) return; // host doesn't expose workflow registration

    const list = await rpc('tools/list');
    if (list.status === 404) return; // host doesn't expose the seam
    expect(list.status, 'tools/list MUST 200').toBe(200);
    const tools = (list.body.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
    const found = tools.find((t) => t.name === TEST_TOOL_NAME);
    expect(
      found,
      driver.describe(
        'RFC 0020 §A point 2',
        'tools/list MUST include workflows exposed via core.openwop.mcp.expose-tool',
      ),
    ).toBeDefined();

    const call = await rpc('tools/call', { name: TEST_TOOL_NAME, arguments: { text: 'hello' } });
    expect(call.status, 'tools/call MUST 200').toBe(200);
    const result = call.body.result as { content?: Array<{ type: string }>; isError?: boolean } | undefined;
    expect(
      Array.isArray(result?.content),
      driver.describe('RFC 0020 §C', 'CallToolResult MUST contain content[]'),
    ).toBe(true);
    expect(typeof result?.isError, 'CallToolResult.isError MUST be boolean').toBe('boolean');
  });
});

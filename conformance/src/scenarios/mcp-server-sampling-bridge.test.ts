/**
 * mcp-server-sampling-bridge — RFC 0020 §A point 3 (bidirectional sampling).
 *
 * Status: ACTIVE (advertisement + behavioral). Asserts that when a workflow
 * has a `core.openwop.mcp.handle-sampling` node, inbound `sampling/createMessage`
 * is bridged into the workflow's `ctx.callAI` and returns a sampling result.
 * Gated on `capabilities.mcp.serverMount.samplingBridge: true`.
 *
 * Acceptance test: dispatch produces either a sampling response (when AI
 * keys are provisioned) OR a clean error envelope (proves bridge dispatched
 * but BYOK is absent). Either outcome proves the bridge wired up correctly;
 * a method_not_found (-32601) means the bridge did NOT dispatch.
 *
 * @see RFCS/0020-host-mcp-server-composition.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { seamAbsent } from '../lib/soft-skip.js';
import { mcpServerMount } from '../lib/mcp-mount.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
  const cur = (top && typeof top === 'object') ? (top as Record<string, unknown>)["mcp"] : undefined;
  const final = (cur && typeof cur === 'object') ? (cur as Record<string, unknown>)["serverMount"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

async function rpc(method: string, params?: Record<string, unknown>) {
  const id = Math.floor(Math.random() * 1e6);
  const req: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) req.params = params;
  const res = await driver.post(await mcpServerMount(), req);
  return { status: res.status, body: res.json as { result?: unknown; error?: { code: number; message: string } } };
}

async function registerSamplingHandlerWorkflow(): Promise<boolean> {
  const res = await driver.post('/v1/host/sample/workflows', {
    workflowId: `mcp.sampling.${Date.now()}`,
    nodes: [
      { nodeId: 'sample', typeId: 'core.openwop.mcp.handle-sampling' },
    ],
  });
  return res.status === 200 || res.status === 201;
}

describe('mcp-server-sampling-bridge: advertisement shape (RFC 0020)', () => {
  it('samplingBridge is a boolean when serverMount.supported', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    if (cap.samplingBridge === undefined) return;
    expect(
      typeof cap.samplingBridge,
      driver.describe('RFC 0020 §B', 'mcp.serverMount.samplingBridge MUST be boolean when present'),
    ).toBe('boolean');
  });
});

describe('mcp-server-sampling-bridge: behavioral (RFC 0020 §A point 3)', () => {
  it('sampling/createMessage bridges into a handle-sampling workflow', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true || cap.samplingBridge !== true) return;
    if (!(await registerSamplingHandlerWorkflow())) return;

    const r = await rpc('sampling/createMessage', {
      messages: [{ role: 'user', content: { type: 'text', text: 'ping' } }],
      maxTokens: 16,
    });
    if (r.status === 404) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${r.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    expect(r.status, 'JSON-RPC envelope MUST 200').toBe(200);
    const dispatched = !!r.body.result || (!!r.body.error && r.body.error.code !== -32601);
    expect(
      dispatched,
      driver.describe(
        'RFC 0020 §A point 3',
        'sampling/createMessage MUST dispatch to handle-sampling workflow (not return method_not_found)',
      ),
    ).toBe(true);
  });
});

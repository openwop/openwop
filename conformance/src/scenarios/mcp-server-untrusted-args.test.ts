/**
 * mcp-server-untrusted-args — RFC 0020 §D + SECURITY/invariants.yaml
 * `mcp-server-untrusted-args`.
 *
 * Status: ACTIVE (advertisement + behavioral). Asserts that tools/call
 * with arguments violating the registered inputSchema is rejected with
 * JSON-RPC `-32602 invalid params` BEFORE any workflow side-effects.
 *
 * @see RFCS/0020-host-mcp-server-composition.md
 * @see SECURITY/invariants.yaml — mcp-server-untrusted-args
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { mcpServerMount } from '../lib/mcp-mount.js';
import { req } from '../lib/requirement-ids.js';

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
  const reqBody: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) reqBody.params = params;
  const res = await driver.post(await mcpServerMount(), reqBody);
  return { status: res.status, body: res.json as { result?: unknown; error?: { code: number; message: string; data?: unknown } } };
}

const TEST_TOOL_NAME = `inj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function registerStrictWorkflow(): Promise<boolean> {
  const res = await driver.post('/v1/host/sample/workflows', {
    workflowId: `mcp.untrusted.${Date.now()}`,
    nodes: [
      {
        nodeId: 'expose',
        typeId: 'core.openwop.mcp.expose-tool',
        config: {
          name: TEST_TOOL_NAME,
          description: 'Strict-schema tool',
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

describe('mcp-server-untrusted-args: advertisement shape (RFC 0020)', () => {
  it('capabilities.mcp.serverMount is well-formed when present', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early');
    expect(typeof cap.supported, req('openwop.it.mcp-server-untrusted-args.capabilities-mcp-servermount-is-well-formed-when-present', 'RFC 0020 §D', 'capabilities.mcp.serverMount is well-formed when present')).toBe('boolean');
  });
});

describe('mcp-server-untrusted-args: behavioral (RFC 0020 §D)', () => {
  it('tools/call with malformed arguments is rejected with JSON-RPC -32602 BEFORE workflow start', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    if (!(await registerStrictWorkflow())) return softSkip('blocked', 'precondition not met — `!(await registerStrictWorkflow())` returned early (seam, prior step, or fixture unavailable)');

    const r = await rpc('tools/call', {
      name: TEST_TOOL_NAME,
      arguments: { wrongField: 'no' },
    });
    if (r.status === 404) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${r.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    expect(r.status, req('openwop.it.mcp-server-untrusted-args.tools-call-with-malformed-arguments-is-rejected-with-json-rpc-32602-before-workf', 'SECURITY/invariants.yaml mcp-server-untrusted-args', 'JSON-RPC envelope MUST 200')).toBe(200);
    expect(
      r.body.error?.code,
      req('openwop.it.mcp-server-untrusted-args.tools-call-with-malformed-arguments-is-rejected-with-json-rpc-32602-before-workf', 
        'SECURITY/invariants.yaml mcp-server-untrusted-args',
        'malformed arguments MUST be rejected with -32602 invalid params before workflow start',
      ),
    ).toBe(-32602);
    expect(r.body.error?.data, req('openwop.it.mcp-server-untrusted-args.tools-call-with-malformed-arguments-is-rejected-with-json-rpc-32602-before-workf', 'SECURITY/invariants.yaml mcp-server-untrusted-args', 'error.data MUST carry validation violations')).toBeDefined();
  });

  it('tools/call with valid arguments is accepted', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    const r = await rpc('tools/call', {
      name: TEST_TOOL_NAME,
      arguments: { text: 'hello' },
    });
    if (r.status === 404) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${r.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    expect(r.status).toBe(200);
    if (r.body.error) {
      expect(r.body.error.code, req('openwop.it.mcp-server-untrusted-args.tools-call-with-valid-arguments-is-accepted', 'RFC 0020 §D', 'valid args MUST NOT trigger -32602')).not.toBe(-32602);
    }
  });
});

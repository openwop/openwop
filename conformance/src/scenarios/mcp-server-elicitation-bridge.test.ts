/**
 * mcp-server-elicitation-bridge — RFC 0020 §A point 3 (bidirectional elicitation).
 *
 * Status: ACTIVE (advertisement + behavioral). Asserts that when a workflow
 * has a `core.openwop.mcp.handle-elicitation` node, inbound `elicitation/create`
 * is bridged into the workflow's `ctx.suspend({kind: 'clarification', profile:
 * 'openwop-mcp-elicitation'})`. The host returns either a `pending` action
 * (run suspended awaiting input) OR an accept/decline/cancel response (run
 * completed without suspending).
 *
 * @see RFCS/0020-host-mcp-server-composition.md
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
  return { status: res.status, body: res.json as { result?: unknown; error?: { code: number; message: string } } };
}

async function registerElicitationHandlerWorkflow(): Promise<boolean> {
  const res = await driver.post('/v1/host/sample/workflows', {
    workflowId: `mcp.elicit.${Date.now()}`,
    nodes: [
      { nodeId: 'elicit', typeId: 'core.openwop.mcp.handle-elicitation' },
    ],
  });
  return res.status === 200 || res.status === 201;
}

describe('mcp-server-elicitation-bridge: advertisement shape (RFC 0020)', () => {
  it('elicitationBridge is a boolean when serverMount.supported', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    if (cap.elicitationBridge === undefined) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap.elicitationBridge === undefined` returned early');
    expect(
      typeof cap.elicitationBridge,
      req('openwop.it.mcp-server-elicitation-bridge.elicitationbridge-is-a-boolean-when-servermount-supported', 'RFC 0020 §B', 'mcp.serverMount.elicitationBridge MUST be boolean when present'),
    ).toBe('boolean');
  });
});

describe('mcp-server-elicitation-bridge: behavioral (RFC 0020 §A point 3)', () => {
  it('elicitation/create bridges into a handle-elicitation workflow', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true || cap.elicitationBridge !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true || cap.elicitationBridge !== true` returned early');
    if (!(await registerElicitationHandlerWorkflow())) return softSkip('blocked', 'precondition not met — `!(await registerElicitationHandlerWorkflow())` returned early (seam, prior step, or fixture unavailable)');

    const r = await rpc('elicitation/create', {
      message: 'What is your name?',
      requestedSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    });
    if (r.status === 404) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${r.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    expect(r.status, req('openwop.it.mcp-server-elicitation-bridge.elicitation-create-bridges-into-a-handle-elicitation-workflow', 'RFC 0020 §A point 3', 'JSON-RPC envelope MUST 200')).toBe(200);
    const dispatched = !!r.body.result || (!!r.body.error && r.body.error.code !== -32601);
    expect(
      dispatched,
      req('openwop.it.mcp-server-elicitation-bridge.elicitation-create-bridges-into-a-handle-elicitation-workflow', 
        'RFC 0020 §A point 3',
        'elicitation/create MUST dispatch to handle-elicitation workflow (not return method_not_found)',
      ),
    ).toBe(true);
    if (r.body.result) {
      const result = r.body.result as { action?: string };
      expect(
        ['pending', 'accept', 'decline', 'cancel'].includes(result.action ?? ''),
        req('openwop.it.mcp-server-elicitation-bridge.elicitation-create-bridges-into-a-handle-elicitation-workflow', 'RFC 0020 §A point 3', 'elicitation response action MUST be one of {pending,accept,decline,cancel}'),
      ).toBe(true);
    }
  });
});

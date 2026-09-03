/**
 * mcp-server-resource-roundtrip — RFC 0020 §A (resources/list + resources/read).
 *
 * Status: ACTIVE (advertisement + behavioral). Registers a workflow with
 * `core.openwop.mcp.expose-resource`, then asserts the resource appears
 * in `resources/list` and yields bound content from `resources/read`.
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

const RESOURCE_URI = `mcp://test/${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function registerResourceWorkflow(): Promise<boolean> {
  const res = await driver.post('/v1/host/sample/workflows', {
    workflowId: `mcp.resource.${Date.now()}`,
    nodes: [
      {
        nodeId: 'expose',
        typeId: 'core.openwop.mcp.expose-resource',
        config: {
          uri: RESOURCE_URI,
          name: 'conformance-test-resource',
          mimeType: 'text/plain',
        },
      },
    ],
  });
  return res.status === 200 || res.status === 201;
}

describe('mcp-server-resource-roundtrip: advertisement shape (RFC 0020)', () => {
  it('capabilities.mcp.serverMount is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early');
    expect(typeof cap.supported, req('openwop.it.mcp-server-resource-roundtrip.capabilities-mcp-servermount-is-either-absent-or-a-well-formed-object', 'RFC 0020 §A', 'mcp.serverMount.supported MUST be boolean')).toBe('boolean');
  });
});

describe('mcp-server-resource-roundtrip: behavioral (RFC 0020)', () => {
  it('resources/list returns the exposed resource and resources/read returns content', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    if (!(await registerResourceWorkflow())) return softSkip('blocked', 'precondition not met — `!(await registerResourceWorkflow())` returned early (seam, prior step, or fixture unavailable)');

    const list = await rpc('resources/list');
    if (list.status === 404) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${list.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    const resources = (list.body.result as { resources?: Array<{ uri: string }> } | undefined)?.resources ?? [];
    expect(
      resources.find((r) => r.uri === RESOURCE_URI),
      req('openwop.it.mcp-server-resource-roundtrip.resources-list-returns-the-exposed-resource-and-resources-read-returns-content', 'RFC 0020 §A', 'resources/list MUST include exposed resources'),
    ).toBeDefined();

    const read = await rpc('resources/read', { uri: RESOURCE_URI });
    expect(read.status).toBe(200);
    const contents = (read.body.result as { contents?: Array<{ uri: string }> } | undefined)?.contents;
    expect(Array.isArray(contents), req('openwop.it.mcp-server-resource-roundtrip.resources-list-returns-the-exposed-resource-and-resources-read-returns-content', 'RFC 0020 §A', 'resources/read MUST return contents[]')).toBe(true);
  });
});

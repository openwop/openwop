/**
 * RFC 0153 §D — cache scope follows the tenant boundary (invariant
 * `mcp-cache-tenant-scoped`, named by RFC 0153 §E).
 *
 * `mcp-integration.md` §D: an OpenWOP host acting as MCP server derives its
 * lists from a tenant-scoped registry, so `cacheScope` MUST be `"private"`
 * whenever the result depends on the caller's tenant/workspace/principal/
 * authorization — on a multi-tenant host, always. `"public"` is permitted only
 * when the result is byte-identical for every caller.
 *
 * Non-vacuity: with a second credential (`OPENWOP_TEST_SECONDARY_API_KEY`) the
 * leg lists tools under both callers; if the lists DIFFER the host MUST have
 * said `private` — a `public` list that differs per caller is exactly the
 * cross-context cache poisoning the invariant forbids. Without a second key the
 * leg can only check the shape and says so (`blocked` for the cross-caller
 * half via the ledger note).
 *
 * Gate: `mcp.profiles ∋ mcp-2026-07-28` + `serverMount.supported`.
 *
 * @see spec/v1/mcp-integration.md §"MCP 2026-07-28 versioned composition" §D
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const PROFILE = 'mcp-2026-07-28';
const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';

interface McpCaps { readonly supported?: boolean; readonly profiles?: readonly string[]; readonly serverMount?: { supported?: boolean } }
async function claimsCurrent(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps = capabilityFamily<McpCaps>(disco.json, 'mcp');
  return caps?.supported === true && (caps.profiles ?? []).includes(PROFILE) && caps.serverMount?.supported === true;
}
async function listAs(bearer?: string) {
  const headers: Record<string, string> = { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  const res = await driver.post('/v1/host/sample/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [META_V]: '2026-07-28', [META_C]: {} } } }, { headers });
  return { status: res.status, body: res.json as { result?: { tools?: unknown[]; cacheScope?: string; ttlMs?: number } } };
}

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §D — mcp-cache-tenant-scope (host as server, gated)', () => {
  it('a per-caller list is cacheScope private; a public list is byte-identical across callers', async () => {
    if (!behaviorGate(PROFILE, await claimsCurrent())) return;
    const mine = await listAs();
    if (mine.status === 404 || mine.status === 403) return;
    expect(['public', 'private'], driver.describe('mcp-integration.md §D', 'cacheScope MUST be present on tools/list')).toContain(mine.body.result?.cacheScope);
    const other = process.env.OPENWOP_TEST_SECONDARY_API_KEY;
    if (!other) {
      // Shape only; the cross-caller half is unobservable without a second credential.
      // eslint-disable-next-line no-console
      console.warn('[mcp-cache-tenant-scope] OPENWOP_TEST_SECONDARY_API_KEY not set — cross-caller half not exercised (blocked)');
      return;
    }
    const theirs = await listAs(other);
    if (theirs.status !== 200) return;
    const same = JSON.stringify(mine.body.result?.tools) === JSON.stringify(theirs.body.result?.tools);
    if (!same) {
      expect(mine.body.result?.cacheScope, driver.describe('mcp-integration.md §D', 'a list that differs per caller MUST be cacheScope private — a public list that differs is cross-context cache poisoning (mcp-cache-tenant-scoped)')).toBe('private');
      expect(theirs.body.result?.cacheScope).toBe('private');
    }
  });
});

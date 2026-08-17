/**
 * RFC 0153 §B — the host as a 2026-07-28 MCP server answers a core request
 * with NO prior `initialize` and NO session header (invariant
 * `mcp-header-body-consistent`, named by RFC 0153 §E — the agreement half is
 * witnessed in `mcp-2026-07-28-discover.test.ts`).
 *
 * `mcp-integration.md` §B: under the current profile a host MUST NOT require
 * `initialize` / `notifications/initialized` or any `Mcp-Session-Id` for a core
 * request; every request self-describes in `_meta`; list results are stable per
 * caller (not per connection) and carry `resultType` + cache hints (§D).
 *
 * Gate: `mcp.profiles ∋ mcp-2026-07-28` and `serverMount.supported`. A
 * 2025-06-18 host soft-skips (`blocked`). Hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. Non-vacuity: the leg issues `tools/list`
 * twice on two independent connections and asserts byte-equal tool lists —
 * per-connection state would show up as drift.
 *
 * @see spec/v1/mcp-integration.md §"MCP 2026-07-28 versioned composition" §B, §D
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { mcpServerMount } from '../lib/mcp-mount.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';

const PROFILE = 'mcp-2026-07-28';
const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';
const META_I = 'io.modelcontextprotocol/clientInfo';

interface McpCaps { readonly supported?: boolean; readonly profiles?: readonly string[]; readonly serverMount?: { supported?: boolean } }
async function claimsCurrent(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps = capabilityFamily<McpCaps>(disco.json, 'mcp');
  return caps?.supported === true && (caps.profiles ?? []).includes(PROFILE) && caps.serverMount?.supported === true;
}
async function list() {
  const res = await driver.post(
    await mcpServerMount(),
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [META_V]: '2026-07-28', [META_C]: {}, [META_I]: { name: 'openwop-conformance', version: 'suite' } } } },
    { headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' } },
  );
  return { status: res.status, body: res.json as { result?: { resultType?: string; tools?: unknown[]; ttlMs?: number; cacheScope?: string }; error?: { code: number } } };
}

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §B — mcp-header-body-consistent, the method/name half (host as server, gated on mcp.profiles ∋ mcp-2026-07-28)', () => {
  it('Mcp-Method ≠ body method, and Mcp-Name ≠ params.name, are refused 400 + -32020 (HeaderMismatchError) — the same fail-closed rule as the version header', async () => {
    if (!behaviorGate(PROFILE, await claimsCurrent())) return;
    const meta = { [META_V]: '2026-07-28', [META_C]: {}, [META_I]: { name: 'openwop-conformance', version: 'suite' } };
    // (a) Mcp-Method header disagrees with the JSON-RPC method
    const m = await driver.post(await mcpServerMount(), { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } }, { headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'resources/list' } });
    if (m.status === 404 || m.status === 403) return softSkip('blocked', `MCP server mount /v1/host/sample/mcp answered ${m.status}`);
    expect(m.status, driver.describe('mcp-integration.md §B', 'Mcp-Method MUST equal the body method; disagreement MUST be refused 400 (mcp-header-body-consistent)')).toBe(400);
    expect((m.json as { error?: { code?: number } }).error?.code, driver.describe('mcp-integration.md §B', 'the refusal is HeaderMismatchError -32020')).toBe(-32020);
    // (b) Mcp-Name header disagrees with params.name on tools/call
    const n = await driver.post(await mcpServerMount(), { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: {}, _meta: meta } }, { headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'not-echo' } });
    expect(n.status, driver.describe('mcp-integration.md §B', 'Mcp-Name MUST equal params.name; disagreement MUST be refused 400 (mcp-header-body-consistent)')).toBe(400);
    expect((n.json as { error?: { code?: number } }).error?.code, driver.describe('mcp-integration.md §B', 'the refusal is HeaderMismatchError -32020')).toBe(-32020);
  });
});

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §B — mcp-stateless-request (host as server, gated on mcp.profiles ∋ mcp-2026-07-28)', () => {
  it('tools/list succeeds with no initialize and no session; result carries resultType + cache hints; two connections agree', async () => {
    if (!behaviorGate(PROFILE, await claimsCurrent())) return;
    const a = await list();
    if (a.status === 404 || a.status === 403) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${a.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    expect(a.status, driver.describe('mcp-integration.md §B', 'a core request MUST succeed without a prior initialize or a session header')).toBe(200);
    expect(a.body.error, driver.describe('mcp-integration.md §B', `stateless tools/list MUST NOT error: ${JSON.stringify(a.body.error)}`)).toBeUndefined();
    expect(a.body.result?.resultType, driver.describe('mcp-integration.md §B', 'every current-revision result carries resultType')).toBe('complete');
    expect(typeof a.body.result?.ttlMs, driver.describe('mcp-integration.md §D', 'tools/list MUST carry ttlMs (>= 0)')).toBe('number');
    expect((a.body.result?.ttlMs ?? -1) >= 0).toBe(true);
    expect(['public', 'private'], driver.describe('mcp-integration.md §D', 'cacheScope MUST be public|private')).toContain(a.body.result?.cacheScope);
    const b = await list();
    expect(JSON.stringify(b.body.result?.tools), driver.describe('mcp-integration.md §B', 'list results MUST NOT vary per connection — two independent requests from the same caller MUST agree')).toBe(JSON.stringify(a.body.result?.tools));
  });
});

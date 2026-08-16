/**
 * RFC 0153 §E — an anonymous MCP principal MUST NOT be the production default
 * for an advertised current profile (invariant `mcp-peer-no-authority-escalation`
 * is the sibling; this leg is the authentication boundary).
 *
 * `mcp-integration.md` §E: a host that advertises `mcp-2026-07-28` MUST require
 * authentication on its MCP endpoint in production, unless it advertises RFC
 * 0132 `anonymousActor` and routes anonymous MCP callers through that surface's
 * rules. Black-box: an UNAUTHENTICATED `tools/list` at the current-profile mount
 * MUST be refused (`401`/`403`), or the host MUST advertise `anonymousActor`.
 *
 * Gate: `mcp.profiles ∋ mcp-2026-07-28` + `serverMount.supported`. Non-vacuous:
 * the leg first proves the authenticated call succeeds at the same path, so a
 * refusal cannot be a wrong-path 404.
 *
 * @see spec/v1/mcp-integration.md §"MCP 2026-07-28 versioned composition" §E
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const PROFILE = 'mcp-2026-07-28';
const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';

interface McpCaps { readonly supported?: boolean; readonly profiles?: readonly string[]; readonly serverMount?: { supported?: boolean } }
async function disco() {
  const d = await driver.get('/.well-known/openwop');
  return { mcp: capabilityFamily<McpCaps>(d.json, 'mcp'), anon: capabilityFamily<{ supported?: boolean }>(d.json, 'anonymousActor') };
}
const REQ = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [META_V]: '2026-07-28', [META_C]: {} } } };
const HDR = { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' };

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §E — mcp-current-auth-boundary (host as server, gated)', () => {
  it('an unauthenticated current-profile request is refused, unless anonymousActor is advertised', async () => {
    const { mcp, anon } = await disco();
    const claims = mcp?.supported === true && (mcp.profiles ?? []).includes(PROFILE) && mcp.serverMount?.supported === true;
    if (!behaviorGate(PROFILE, claims)) return;
    const authed = await driver.post('/v1/host/sample/mcp', REQ, { headers: HDR });
    if (authed.status === 404 || authed.status === 403) return; // mount not at the sample path
    expect(authed.status, driver.describe('mcp-integration.md §E', 'the authenticated call MUST succeed at the same path, so a refusal below is not a wrong path')).toBe(200);
    const anonymous = await driver.post('/v1/host/sample/mcp', REQ, { headers: HDR, authenticated: false });
    if (anon?.supported === true) {
      // Anonymous is permitted only through the RFC 0132 surface; a 200 here is that surface answering.
      expect([200, 401, 403]).toContain(anonymous.status);
      return;
    }
    expect(
      [401, 403],
      driver.describe('mcp-integration.md §E', 'an anonymous MCP principal MUST NOT be the production default for an advertised current profile — refuse (401/403) or advertise anonymousActor'),
    ).toContain(anonymous.status);
  });
});

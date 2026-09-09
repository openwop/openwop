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
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { mcpServerMount } from '../lib/mcp-mount.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

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

/** Set-Cookie values from a fetch Headers (Node ≥ 19.7 exposes them un-joined via getSetCookie). */
function setCookies(h: Headers): string[] {
  const g = (h as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof g === 'function') return g.call(h);
  const one = h.get('set-cookie');
  return one ? [one] : [];
}

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §E — mcp-current-auth-boundary (host as server, gated)', () => {
  it('an unauthenticated current-profile request is refused, unless anonymousActor is advertised', async () => {
    const { mcp, anon } = await disco();
    const claims = mcp?.supported === true && (mcp.profiles ?? []).includes(PROFILE) && mcp.serverMount?.supported === true;
    if (!behaviorGate(PROFILE, claims)) return;
    const authed = await driver.post(await mcpServerMount(), REQ, { headers: HDR });
    if (authed.status === 404 || authed.status === 403) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${authed.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    expect(authed.status, req('openwop.it.mcp-current-auth-boundary.an-unauthenticated-current-profile-request-is-refused-unless-anonymousactor-is-a', 'mcp-integration.md §E', 'the authenticated call MUST succeed at the same path, so a refusal below is not a wrong path')).toBe(200);
    const anonymous = await driver.post(await mcpServerMount(), REQ, { headers: HDR, authenticated: false });
    if (anon?.supported === true) {
      // Anonymous is permitted only through the RFC 0132 surface; a 200 here is that surface answering.
      expect([200, 401, 403]).toContain(anonymous.status);
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `anon?.supported === true` returned early');
    }
    expect(
      [401, 403],
      req('openwop.it.mcp-current-auth-boundary.an-unauthenticated-current-profile-request-is-refused-unless-anonymousactor-is-a', 'mcp-integration.md §E', 'an anonymous MCP principal MUST NOT be the production default for an advertised current profile — refuse (401/403) or advertise anonymousActor'),
    ).toContain(anonymous.status);

    // S30 (2026-08-17, openwop-app H43): a cookie-posture host may MINT an anonymous
    // session for a credential-less caller and then treat "has a principal" as
    // "is authenticated". The bare probe above never carries a cookie, so it can
    // only observe the first request; replay with whatever the host just minted
    // (from this response or from a credential-less discovery GET) and hold the
    // same rule — an anonymous SESSION is still an anonymous principal.
    const minted = [
      ...setCookies(anonymous.headers),
      ...setCookies((await driver.get('/.well-known/openwop', { authenticated: false })).headers),
    ];
    if (minted.length === 0) return softSkip('blocked', 'precondition not met — `minted.length === 0` returned early (host mints no anonymous session; the bare probe was the whole observation) (seam, prior step, or fixture unavailable)'); // host mints no anonymous session; the bare probe was the whole observation
    const cookie = minted.map((c) => c.split(';')[0]).join('; ');
    const withSession = await driver.post(await mcpServerMount(), REQ, { headers: { ...HDR, Cookie: cookie }, authenticated: false });
    expect(
      [401, 403],
      req('openwop.it.mcp-current-auth-boundary.an-unauthenticated-current-profile-request-is-refused-unless-anonymousactor-is-a', 'mcp-integration.md §E', 'a caller holding only a host-minted anonymous session cookie is still an anonymous principal — refuse (401/403) unless anonymousActor is advertised (S30)'),
    ).toContain(withSession.status);
  });
});

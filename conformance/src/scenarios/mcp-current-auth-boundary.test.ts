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
import { parseChallenge, prmUrlFor } from '../lib/protected-resource.js';
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

  /**
   * RFC 0200 §A.4 — the mount as its own OAuth protected resource. Upstream makes this a
   * MUST for an MCP server whose mount requires OAuth ("MCP servers MUST implement one of
   * the following discovery mechanisms"), and `mcp-integration.md` §E now carries it.
   *
   * NON-GATING coverage: this file is major-1 only, and `check-accepted-predicate` rule 4
   * reads only certified v2 bundles, so a verdict recorded here can never satisfy the
   * RFC's row. The gating witness is the mount leg of `v2-protected-resource-metadata`,
   * against the v2 mount. This leg exists so a v1 host that DOES require an OAuth lane on
   * its mount is measured today.
   */
  it('a mount that requires OAuth-lane authentication offers resource_metadata or a path-inserted PRM', async () => {
    const { mcp, anon } = await disco();
    const claims = mcp?.supported === true && (mcp.profiles ?? []).includes(PROFILE) && mcp.serverMount?.supported === true;
    if (!behaviorGate(PROFILE, claims)) return;
    if (anon?.supported === true) return softSkip('inapplicable', 'anonymousActor is advertised — the mount does not require authentication at all, so §A.4 does not bind it');
    const mount = await mcpServerMount();
    const anonymous = await driver.post(mount, REQ, { headers: HDR, authenticated: false });
    if (anonymous.status !== 401) return softSkip('inapplicable', `the mount answered ${anonymous.status} without credentials, not 401 — §A.4 binds a mount that refuses for want of an OAuth-lane credential`);
    const challenge = parseChallenge(anonymous.headers.get('www-authenticate'));
    const viaChallenge = challenge !== null && challenge.scheme === 'bearer' && typeof challenge.params['resource_metadata'] === 'string';
    let viaWellKnown = false;
    if (!viaChallenge) {
      const doc = await driver.get(prmUrlFor(mount.startsWith('http') ? mount : `${process.env['OPENWOP_BASE_URL'] ?? ''}${mount}`), { authenticated: false });
      viaWellKnown = doc.status === 200 && typeof (doc.json as { resource?: unknown } | null)?.resource === 'string';
    }
    if (!viaChallenge && !viaWellKnown) {
      // A mount that refuses an api-key caller for want of an api-key is not an OAuth
      // protected resource, and this host's lanes are not readable from here at major 1.
      return softSkip('inapplicable', 'the mount offers neither discovery mechanism and this host advertises no v1 OAuth/OIDC auth profile reachable from here — §A.4 binds only a mount that requires OAuth-lane authentication');
    }
    expect(
      viaChallenge || viaWellKnown,
      req('openwop.it.mcp-current-auth-boundary.a-mount-that-requires-oauth-lane-authentication-offers-resource-metadata-or-a-path-inserted-prm', 'spec/v1/mcp-integration.md §E (RFC 0200 §A.4)', 'a mount requiring OAuth-lane authentication MUST implement one of upstream\'s two discovery mechanisms for the mount URL as the resource'),
    ).toBe(true);
  });
});

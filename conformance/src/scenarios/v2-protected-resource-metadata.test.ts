/**
 * RFC 0200 §A — the host serves RFC 9728 Protected Resource Metadata, derived from the
 * lanes it already advertises (suite 2.36.0, target major 2).
 *
 * **Gate:** an `auth.lanes[]` member with `lane ∈ {oauth2, oidc}`. A host with neither
 * records `inapplicable` — §A.1 does not bind it. A host WITH one that answers `404` at
 * the derived URL records an `executed-fail`: the lane is the advertisement, the document
 * is owed, and a soft-skip here would let the advertisement cost nothing.
 *
 * Three legs, one requirement id each:
 *
 *   1. `prm-served` — the URL RFC 9728 §3/§3.1 forms from the resource identifier answers
 *      `200` with a JSON object, fetched with NO credential (§A.2: the document is served
 *      without authentication).
 *   2. `prm-consistent` — it is a PROJECTION, not a second declaration: `resource` is
 *      identical to the resource identifier used to form the URL; `authorization_servers`
 *      is set-equal to the URL-form issuers of those lanes; `scopes_supported`, when
 *      present, is a non-empty array of strings; and neither binding claim is `true`
 *      unless EVERY such lane requires that binding — a bearer lane advertised as
 *      sender-constrained is `sender-constraint-no-bearer-downgrade`.
 *   3. `mcp-mount-prm` — §A.4, the MCP mount as its own resource. Gated further on a
 *      mount that REQUIRES OAuth-lane authentication, which the suite can only establish
 *      when every advertised lane is `oauth2`/`oidc`: a host whose api-key lane also
 *      opens the mount records `inapplicable` with that reason rather than passing a leg
 *      whose premise does not hold.
 *
 * How each FAILS (the sabotage run before citing a row):
 *   (a) the host serves nothing at the derived URL      → leg 1 (404)
 *   (b) a sub-path host serves only the ROOT well-known → leg 1 (404 at the inserted path)
 *   (c) `authorization_servers` adds an issuer no lane names → leg 2
 *   (d) `resource` carries a trailing slash / another origin → leg 2
 *   (e) `dpop_bound_access_tokens_required: true` on a bearer lane → leg 2
 *
 * @see spec/v2/core/identity.md §2.5
 * @see RFCS/0200-host-as-oauth-protected-resource.md §A
 * @see SECURITY/invariants.yaml id: auth-challenge-no-oracle (the §B.3 sibling)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { allLanes, parseChallenge, prmGate, prmUrlFor, urlIssuers } from '../lib/protected-resource.js';

const DOC = 'spec/v2/core/identity.md §2.5 (RFC 0200 §A)';
const SERVED = 'openwop.requirement.0200.prm-served';
const CONSISTENT = 'openwop.requirement.0200.prm-consistent';
const MOUNT = 'openwop.requirement.0200.mcp-mount-prm';

describe('RFC 0200 §A — v2-protected-resource-metadata (gated on an advertised oauth2/oidc lane)', () => {
  it('serves RFC 9728 metadata, unauthenticated, at the URI derived from its resource identifier', async () => {
    const g = await prmGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const res = await driver.get(g.prmUrl, { authenticated: false });
    expect(
      res.status,
      req(SERVED, `${DOC} §A.1–§A.2`, `a host advertising an oauth2/oidc lane MUST serve RFC 9728 metadata at ${g.prmUrl} — served without authentication (got ${res.status}; a 404 is a failure, not a skip: the lane is advertised, so the document is owed)`),
    ).toBe(200);
    expect(
      res.json !== null && typeof res.json === 'object' && !Array.isArray(res.json),
      req(SERVED, `${DOC} §A.2`, `the metadata MUST be a JSON object (got ${typeof res.json}: ${res.text.slice(0, 120)})`),
    ).toBe(true);
  }, 30_000);

  it('the metadata is a projection of auth.lanes[], not a second declaration', async () => {
    const g = await prmGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const res = await driver.get(g.prmUrl, { authenticated: false });
    if (res.status !== 200 || res.json === null || typeof res.json !== 'object') {
      // The served leg already recorded the failure; this leg has nothing to project from.
      return softSkip('blocked', `the metadata did not parse (status ${res.status}) — the prm-served leg carries that verdict`);
    }
    const prm = res.json as Record<string, unknown>;

    expect(
      prm['resource'],
      req(CONSISTENT, `${DOC} §A.3`, `\`resource\` MUST be identical to the resource identifier the URL was formed from (RFC 9728 §3.3): expected ${g.resource}`),
    ).toBe(g.resource);

    const expected = urlIssuers(g.lanes);
    const got = [...new Set((Array.isArray(prm['authorization_servers']) ? (prm['authorization_servers'] as unknown[]) : []).map(String))].sort();
    expect(
      got,
      req(CONSISTENT, `${DOC} §A.3`, `\`authorization_servers\` MUST list exactly the URL-form issuers of the oauth2/oidc lanes — an issuer the lanes do not name is a second declaration, and a lane issuer left out hides an authorization server the caller must reach (lanes name [${expected.join(', ')}])`),
    ).toEqual(expected);

    if ('scopes_supported' in prm) {
      const scopes = prm['scopes_supported'];
      expect(
        Array.isArray(scopes) && scopes.length > 0 && scopes.every((s) => typeof s === 'string' && s.length > 0),
        req(CONSISTENT, `${DOC} §A.3`, `\`scopes_supported\`, when present, MUST list the scopes the host enforces — a non-empty array of strings (got ${JSON.stringify(scopes)})`),
      ).toBe(true);
    }

    // §A.3: a binding claim MAY be true only where EVERY oauth2/oidc lane's
    // minimumAssurance requires that binding. A bearer lane advertised as
    // sender-constrained is the `sender-constraint-no-bearer-downgrade` violation, and it
    // is exactly the claim a host is tempted to make because it reads as "more secure".
    const everyConstrained = g.lanes.every((l) => l.minimumAssurance === 'sender-constrained' || l.minimumAssurance === 'key-bound');
    const proofs = new Set(g.lanes.flatMap((l) => (Array.isArray(l.delegationProofs) ? l.delegationProofs.map(String) : [])));
    if (prm['dpop_bound_access_tokens_required'] === true) {
      expect(
        everyConstrained && proofs.has('dpop'),
        req(CONSISTENT, `${DOC} §A.3`, 'dpop_bound_access_tokens_required MAY be true only where EVERY oauth2/oidc lane requires that binding (minimumAssurance above bearer with dpop in delegationProofs) — invariant sender-constraint-no-bearer-downgrade'),
      ).toBe(true);
    }
    if (prm['tls_client_certificate_bound_access_tokens'] === true) {
      expect(
        everyConstrained && proofs.has('mtls-key-binding'),
        req(CONSISTENT, `${DOC} §A.3`, 'tls_client_certificate_bound_access_tokens MAY be true only where EVERY oauth2/oidc lane requires mTLS key binding — invariant sender-constraint-no-bearer-downgrade'),
      ).toBe(true);
    }
  }, 30_000);

  it('an MCP mount that requires OAuth-lane authentication implements one of upstream\'s two discovery mechanisms', async () => {
    const g = await prmGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const mcp = g.doc['mcp'] as { serverUrls?: unknown; serverMount?: unknown } | undefined;
    const urls = Array.isArray(mcp?.serverUrls) ? (mcp.serverUrls as unknown[]).map(String) : [];
    if (urls.length === 0) return softSkip('inapplicable', 'no mcp.serverUrls[] — this host mounts no MCP server, so §A.4 does not bind it');
    // §A.4 binds a mount that REQUIRES OAuth-lane authentication. From outside, that holds
    // only when every advertised lane is oauth2/oidc: otherwise an api-key credential opens
    // the mount and the mount's resource server is not an OAuth one. Recording the honest
    // `inapplicable` is the point — a leg that passed on a mount an api-key opens would be
    // measuring nothing.
    const every = allLanes(g.doc);
    const onlyOauth = every.length > 0 && every.every((l) => l.lane === 'oauth2' || l.lane === 'oidc');
    if (!onlyOauth) {
      return softSkip('inapplicable', `the mount does not require an oauth2/oidc lane: this host also advertises [${every.map((l) => String(l.lane)).join(', ')}], any of which opens the mount, so §A.4's premise does not hold`);
    }
    const mount = urls[0] as string;
    const unauth = await driver.post(mount, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { authenticated: false, headers: { 'MCP-Protocol-Version': '2026-07-28' } });
    const challenge = parseChallenge(unauth.headers.get('www-authenticate'));
    const viaChallenge = unauth.status === 401 && challenge !== null && challenge.scheme === 'bearer' && typeof challenge.params['resource_metadata'] === 'string';
    let viaWellKnown = false;
    if (!viaChallenge) {
      const doc = await driver.get(prmUrlFor(mount), { authenticated: false });
      viaWellKnown = doc.status === 200 && (doc.json as { resource?: unknown } | null)?.resource === mount;
    }
    expect(
      viaChallenge || viaWellKnown,
      req(MOUNT, 'spec/v1/mcp-integration.md §E; spec/v2/interop-map.json mcp.authorization (RFC 0200 §A.4)', `a mount requiring OAuth-lane authentication MUST implement one of upstream's two discovery mechanisms for the mount URL as resource — resource_metadata in its 401 challenge, or PRM at ${prmUrlFor(mount)} with resource === ${mount} (mount answered ${unauth.status}, WWW-Authenticate ${unauth.headers.get('www-authenticate') ?? 'absent'})`),
    ).toBe(true);
  }, 30_000);
});

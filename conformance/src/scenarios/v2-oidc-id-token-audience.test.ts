/**
 * RFC 0200 §D — on the `oidc` lane an ID token MAY be a bearer only when its `aud` equals
 * the host's configured audience (suite 2.36.0, target major 2).
 *
 * The corpus never retired ID tokens as bearers, and retiring them would break both
 * production hosts (MyndHyve's `oidc` lane names `securetoken.google.com/…`; openwop-app
 * verifies Firebase ID tokens). The actual risk was never the ID token — it is the
 * AUDIENCE: an ID token minted for some OTHER relying party at the same IdP, presented
 * here, is the substitution attack `threat-model-auth-profiles.md` A2 names. §D names the
 * ID-token case explicitly as admissible under the audience MUST `identity.md` §2.1
 * already carries, and refuses everything else.
 *
 * **Gate:** an advertised `oidc` lane whose `issuers[]` lists `OPENWOP_TEST_OIDC_ISSUER_URL`,
 * the synthetic issuer the suite holds the key for. A lane that does not list it (every
 * production host, which must not trust a test issuer) records `inapplicable`, naming the
 * issuers it does trust — the harness is a suite instrument the host claims by advertising
 * it, RFC 0168 §C.1's reading for the seams profile (lib/harness-issuer.ts; corrected in
 * 2.39.3, when this was `blocked` and denied certification to every production bundle).
 * A claimed harness that cannot be served, or whose same-audience control is refused, is
 * `blocked`: an assertion that a random string is refused would witness nothing.
 *
 * `HOST_CALLBACK_NOT_REQUIRED`: the suite stands the issuer up itself and the host reaches
 * it for JWKS; nothing calls back into the suite's own API.
 *
 * How it FAILS (the sabotage run before citing the row):
 *   (a) the host skips the `aud` check for ID tokens (the "tempted to relax" case — an ID
 *       token is not an access token, so its audience feels like the IdP's business) → the
 *       foreign-audience leg is served instead of refused.
 *
 * @see spec/v2/core/identity.md §2.1
 * @see RFCS/0200-host-as-oauth-protected-resource.md §D
 */

import { afterAll, describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { createSyntheticOIDCIssuer, type SyntheticOIDCIssuer } from '../lib/oidc-issuer.js';
import { prmGate } from '../lib/protected-resource.js';
import { harnessClaimed, serveHarnessIssuer } from '../lib/harness-issuer.js';

export const HOST_CALLBACK_NOT_REQUIRED =
  'the suite stands up the synthetic OIDC issuer and the host fetches its JWKS; no request returns to the suite\'s own API, so no host-reachable callback is needed';

const DOC = 'spec/v2/core/identity.md §2.1 (RFC 0200 §D)';
const ID = 'openwop.requirement.0200.id-token-aud';

let server: Server | null = null;
let issuer: SyntheticOIDCIssuer | null = null;
afterAll(async () => {
  if (server !== null) { const s = server; server = null; await new Promise<void>((r) => s.close(() => r())); }
  issuer = null;
});

/** Stand the issuer up on the URL the host's oidc lane lists (the claim is checked by the caller). */
async function harness(url: string, audience: string): Promise<{ url: string; issuer: SyntheticOIDCIssuer } | string> {
  if (issuer !== null) return { url, issuer };
  const made = createSyntheticOIDCIssuer({ issuer: url, audience, algorithm: 'RS256' });
  try { server = await serveHarnessIssuer(made, url); } catch (e) { return `the harness issuer could not be served for ${url}: ${(e as Error).message}`; }
  issuer = made;
  return { url, issuer: made };
}

describe('RFC 0200 §D — v2-oidc-id-token-audience (gated on an oidc lane and a trusted harness issuer)', () => {
  it('a same-audience ID token is admissible, and one minted for another relying party is audience_mismatch', async () => {
    const g = await prmGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const oidc = g.lanes.find((l) => l.lane === 'oidc');
    if (oidc === undefined) return softSkip('inapplicable', 'no oidc lane advertised — §D names the ID-token case ON that lane and binds no other');
    // The harness is an instrument the host claims by listing it in the lane's issuers[]
    // (RFC 0168 §C.1's reading; lib/harness-issuer.ts). A production host lists its real
    // IdP and must never list a test issuer, so that host records `inapplicable` with the
    // issuers it does trust, not `blocked` — before 2.39.3 this was `blocked` and denied
    // certification to every honest production bundle with an oidc lane.
    const claim = harnessClaimed(oidc as unknown as Record<string, unknown>, process.env['OPENWOP_TEST_OIDC_ISSUER_URL']);
    if (!claim.ok) return softSkip(claim.kind, claim.reason);
    const audience = process.env['OPENWOP_TEST_OIDC_AUDIENCE']?.trim() ?? 'openwop-conformance';
    const h = await harness(claim.url, audience);
    if (typeof h === 'string') return softSkip('blocked', `the oidc lane lists the harness issuer, but ${h}`);

    // An ID token, not an access token: `nonce` and `auth_time` are what make it one.
    const good = h.issuer.mint({ sub: `conformance-${randomBytes(6).toString('hex')}`, nonce: randomBytes(8).toString('hex'), auth_time: Math.floor(Date.now() / 1000) });
    const probe = await driver.post('/runs', { workflowId: 'conformance-noop' }, { authenticated: false, headers: { Authorization: `Bearer ${good.token}` } });
    // The ADMISSIBLE half of §D is the gate, not an assertion, and deliberately: from
    // outside, "this host does not trust the harness issuer" and "this host refuses ID
    // tokens" are the same observation — a 401. Recording `blocked` says which was not
    // established rather than reporting a configuration gap as a host defect. What the
    // acceptance DOES establish, once it holds, is that the refusal below is caused by the
    // audience and by nothing else: same issuer, same key, same token shape.
    if (probe.status === 401) {
      return softSkip('blocked', `a same-audience ID token from ${h.url} was refused (401 ${readErrorCode(probe.json) ?? ''}) although the oidc lane lists that issuer — either the host's trust configuration does not match its advertisement, or OPENWOP_TEST_OIDC_AUDIENCE does not name the audience it is configured with; with no accepted token the foreign-audience refusal would prove nothing`);
    }

    const foreign = h.issuer.mint({ sub: `conformance-${randomBytes(6).toString('hex')}`, aud: `other-client-${randomBytes(6).toString('hex')}`, nonce: randomBytes(8).toString('hex'), auth_time: Math.floor(Date.now() / 1000) });
    const bad = await driver.post('/runs', { workflowId: 'conformance-noop' }, { authenticated: false, headers: { Authorization: `Bearer ${foreign.token}` } });
    expect(
      bad.status,
      req(ID, DOC, `an ID token minted for ANOTHER relying party at the same IdP MUST be refused 401 — it verifies against the same trust root, so only the audience check stops the substitution (got ${bad.status})`),
    ).toBe(401);
    expect(
      readErrorCode(bad.json),
      req(ID, `${DOC}; spec/v2/errors.json`, 'the refusal code MUST be audience_mismatch — the credential verified, its audience is not this host'),
    ).toBe('audience_mismatch');
  }, 60_000);
});

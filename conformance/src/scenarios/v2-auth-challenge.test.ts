/**
 * RFC 0200 §B.1 — the `WWW-Authenticate` challenge on a refusal (suite 2.36.0, target
 * major 2; gated on an advertised `oauth2`/`oidc` lane).
 *
 * HTTP itself has always required it ("The server generating a 401 response MUST send a
 * WWW-Authenticate header field", RFC 9110 §15.5.2) and no OpenWOP host sent one. §B.1
 * makes it a MUST on a host bound by §A, and pins the two things a generic client needs
 * that a bare `Bearer` does not give: where the metadata is, and — on a scope refusal —
 * EVERY scope the operation requires, because `auth.md` §Scopes says `runs:cancel` does
 * not imply `runs:read`, so a single-scope hint can send a client to ask for the wrong
 * grant.
 *
 * Two legs, one requirement id each:
 *
 *   1. `challenge-401` — a no-credential read carries `Bearer` with `resource_metadata`
 *      equal to the §A.2 URL and NO `error` code (RFC 6750 §3.1: an error code is for a
 *      credential that was presented and refused); a garbage bearer carries
 *      `error="invalid_token"`.
 *   2. `challenge-403-scope` — harness-gated on `OPENWOP_TEST_LOW_SCOPE_KEY`: an
 *      operation that key lacks scope for answers `403` with
 *      `error="insufficient_scope"` and a `scope` parameter containing the scope the
 *      operation requires.
 *
 * How each FAILS (the sabotage run before citing a row):
 *   (a) the host sends no WWW-Authenticate                  → leg 1
 *   (b) the host adds error="invalid_token" when NO credential was sent → leg 1
 *   (c) resource_metadata points at the root on a sub-path host → leg 1
 *   (d) the 403 omits `scope`, or names only one of two      → leg 2
 *
 * @see spec/v2/core/identity.md §2.5
 * @see RFCS/0200-host-as-oauth-protected-resource.md §B
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { parseChallenge, prmGate } from '../lib/protected-resource.js';
import { projectBoundId } from '../lib/bound-id.js';

const DOC = 'spec/v2/core/identity.md §2.5 (RFC 0200 §B.1)';
const C401 = 'openwop.requirement.0200.challenge-401';
const C403 = 'openwop.requirement.0200.challenge-403-scope';

/** A tenant-bound id the host certainly did not mint, so the read is a refusal about the CREDENTIAL, not the resource. */
function unknownRunId(tenant: string): string {
  return projectBoundId(`${tenant}/${randomBytes(12).toString('hex')}`);
}

describe('RFC 0200 §B — v2-auth-challenge (gated on an advertised oauth2/oidc lane)', () => {
  it('a 401 names Bearer and the metadata, and carries an error code only when a credential was presented', async () => {
    const g = await prmGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const tenant = String((g.doc['host'] as { tenant?: unknown } | undefined)?.tenant ?? 'unknown-tenant');

    const none = await driver.get(`/runs/${unknownRunId(tenant)}`, { authenticated: false });
    expect(
      none.status,
      req(C401, `${DOC}`, `a request with no credential MUST be refused 401 before the resource is looked up (got ${none.status})`),
    ).toBe(401);
    const c1 = parseChallenge(none.headers.get('www-authenticate'));
    expect(
      c1?.scheme,
      req(C401, `${DOC}`, `a 401 MUST carry WWW-Authenticate naming Bearer (RFC 9110 §15.5.2; got ${none.headers.get('www-authenticate') ?? 'no header'})`),
    ).toBe('bearer');
    expect(
      c1?.params['resource_metadata'],
      req(C401, `${DOC}`, `the challenge MUST carry resource_metadata naming the §A.2 URL, so a generic OAuth client can discover the authorization server from the refusal alone`),
    ).toBe(g.prmUrl);
    expect(
      c1?.params['error'],
      req(C401, `${DOC} (RFC 6750 §3.1)`, `a 401 for a request that presented NO credential MUST NOT carry an error code — an error code describes a credential that was refused, and inventing one tells a client its (absent) token was rejected`),
    ).toBeUndefined();

    const bad = await driver.get(`/runs/${unknownRunId(tenant)}`, { authenticated: false, headers: { Authorization: `Bearer not-a-real-credential-${randomBytes(8).toString('hex')}` } });
    expect(
      bad.status,
      req(C401, `${DOC}`, `a garbage bearer MUST be refused 401 (got ${bad.status})`),
    ).toBe(401);
    const c2 = parseChallenge(bad.headers.get('www-authenticate'));
    expect(
      c2?.params['error'],
      req(C401, `${DOC} (RFC 6750 §3.1)`, `a 401 for a credential that WAS presented and refused MUST carry error="invalid_token" (got ${bad.headers.get('www-authenticate') ?? 'no header'})`),
    ).toBe('invalid_token');
    expect(
      c2?.params['resource_metadata'],
      req(C401, `${DOC}`, 'the invalid_token challenge MUST also carry resource_metadata'),
    ).toBe(g.prmUrl);
  }, 30_000);

  it('a 403 for insufficient scope names every scope the operation requires', async () => {
    const g = await prmGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const low = process.env['OPENWOP_TEST_LOW_SCOPE_KEY']?.trim();
    if (!low) {
      return softSkip('blocked', 'OPENWOP_TEST_LOW_SCOPE_KEY is not set — a scope 403 needs a credential that LACKS a scope, and the suite will not infer one; without it the insufficient_scope clause never runs');
    }
    const auth = { authenticated: false as const, headers: { Authorization: `Bearer ${low}` } };
    const res = await driver.post('/runs', { workflowId: 'conformance-noop' }, auth);
    if (res.status === 401) {
      return softSkip('blocked', 'OPENWOP_TEST_LOW_SCOPE_KEY did not authenticate (401) — it must be a valid credential that merely lacks runs:create');
    }
    expect(
      res.status,
      req(C403, `${DOC}`, `a credential that lacks runs:create MUST be refused 403, not 401 and not 201 (got ${res.status}) — OPENWOP_TEST_LOW_SCOPE_KEY names a key without it`),
    ).toBe(403);
    const c = parseChallenge(res.headers.get('www-authenticate'));
    expect(
      c?.params['error'],
      req(C403, `${DOC}`, `a 403 for insufficient scope MUST carry error="insufficient_scope" (got ${res.headers.get('www-authenticate') ?? 'no header'})`),
    ).toBe('insufficient_scope');
    const scopes = (c?.params['scope'] ?? '').split(/\s+/).filter((s) => s.length > 0);
    expect(
      scopes.includes('runs:create'),
      req(C403, `${DOC}`, `the challenge MUST carry \`scope\` listing EVERY scope the operation requires, space-delimited — runs:create for POST /runs (got "${c?.params['scope'] ?? ''}"); a partial list sends the client to request the wrong grant, because runs:cancel does not imply runs:read`),
    ).toBe(true);
  }, 30_000);
});

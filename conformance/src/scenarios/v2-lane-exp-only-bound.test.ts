/**
 * RFC 0210 §B — an `exp-only` lane's advertised window is a bound the host enforces,
 * not a number it prints (suite 2.36.0, target major 2).
 *
 * `exp-only` is the one member of `identity.md` §2.2's revocation vocabulary that
 * describes a host which re-checks the trust root NEVER: it honours `exp` and consults
 * no introspection endpoint, no userinfo endpoint, no revocation list and no host-side
 * epoch. A credential revoked upstream therefore survives for its full remaining life,
 * and `revocationWindowSeconds` is the ONLY thing standing between "revoked" and "still
 * accepted". That is why this member, alone among the nine it joins, costs something:
 * the host MUST refuse a credential whose total lifetime (`exp − iat`) or remaining
 * lifetime (`exp − now`) exceeds the window it advertised, with a code of its own.
 *
 * **Both bounds are load-bearing and neither implies the other.** `exp − iat` alone
 * accepts a ten-year token minted ten years ago (its remaining life is short, its
 * lifetime is not); `exp − now` alone accepts a freshly minted ten-year token in its
 * ninth year. A host enforcing one and advertising `exp-only` is over-claiming.
 *
 * **The control leg is what makes the two refusals mean anything.** A host that refuses
 * every token passes both sabotage legs and witnesses nothing — the vacuous-witness trap
 * this corpus keeps catching. The control runs in the same `describe`, against the same
 * issuer, the same key and the same token shape, and differs only in the claim under
 * test.
 *
 * **Gate:** an advertised `auth.lanes[]` member with `revocation: "exp-only"`
 * (`inapplicable`, naming that, otherwise) whose `issuers[]` lists
 * `OPENWOP_TEST_OIDC_ISSUER_URL`, the synthetic issuer the suite holds the key for. A lane
 * that does not list it records `inapplicable` naming the issuers it does trust: the
 * harness is a suite instrument the host claims by advertising it (RFC 0168 §C.1's reading
 * for the seams profile; lib/harness-issuer.ts), and a production host must never trust a
 * test issuer. Corrected in 2.39.3; this was `blocked`, which denied certification to
 * every honest production bundle. A claimed harness that cannot be served is `blocked` —
 * without a token the host would ever accept, "it refused a string" witnesses nothing.
 * A window under 120 s is `blocked`: the control token needs room inside it.
 *
 * **Each refusal leg is skewed so it isolates ONE bound.** A token minted at `now` with
 * `exp` past the window is outside BOTH bounds, so a host enforcing either one refuses it
 * and the leg cannot tell them apart — measured, not assumed: with the `exp − iat`
 * comparison deleted from the reference host, such a leg stayed green. So the
 * total-lifetime leg dates its `iat` BEHIND the host's clock (§B.4's "ten-year token
 * minted ten years ago": `exp − iat` outside, `exp − now` inside) and the
 * remaining-lifetime leg dates it AHEAD ("a freshly minted ten-year token in its ninth
 * year": `exp − iat` inside, `exp − now` outside).
 *
 * How it FAILS (the sabotage run before citing the rows):
 *   (a) delete the `exp − iat` comparison in the host verifier → the total-lifetime leg
 *       is served instead of refused;
 *   (b) keep only the `exp − iat` comparison → the remaining-lifetime leg is served;
 *   (c) refuse with a generic `unauthenticated` → the code leg fails, which is the whole
 *       reason §B.6 registers a distinct code: under a generic refusal a sabotage cannot
 *       tell "the bound was enforced" from "the host refused for some other reason";
 *   (d) refuse every token → the control leg fails, and the two refusal legs stop
 *       counting as evidence.
 *
 * @see spec/v2/core/identity.md §2.2
 * @see RFCS/0210-lane-revocation-rule-is-measured.md §B
 * @see SECURITY/invariants.yaml `lane-exp-only-lifetime-bounded`
 */

import { afterAll, describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { createSyntheticOIDCIssuer, type SyntheticOIDCIssuer } from '../lib/oidc-issuer.js';
import { harnessClaimed, serveHarnessIssuer } from '../lib/harness-issuer.js';

export const HOST_CALLBACK_NOT_REQUIRED =
  'the suite stands up the synthetic OIDC issuer and the host fetches its JWKS; no request returns to the suite\'s own API, so no host-reachable callback is needed';

const DOC = 'spec/v2/core/identity.md §2.2 (RFC 0210 §B)';
const CODE = 'credential_lifetime_exceeded';
/** Room inside the window for the control token, and outside it for the two sabotages. */
const MARGIN = 60;

let server: Server | null = null;
let issuer: SyntheticOIDCIssuer | null = null;
afterAll(async () => {
  if (server !== null) { const s = server; server = null; await new Promise<void>((r) => s.close(() => r())); }
  issuer = null;
});

interface Gate {
  readonly issuer: SyntheticOIDCIssuer;
  readonly url: string;
  readonly window: number;
  readonly lane: string;
}

/**
 * The lane, the harness issuer and the window — or the reason this host is not measured.
 *
 * Resolved once per leg rather than in a shared `beforeAll`, so a leg that cannot run
 * records WHY on its own row instead of inheriting a suite-level failure.
 */
async function gate(): Promise<Gate | { readonly kind: 'inapplicable' | 'blocked'; readonly reason: string }> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (doc === null) return { kind: 'blocked', reason: 'v2 discovery unreachable — the lanes cannot be read, so nothing is gated' };
  const auth = await familyAdvertised('auth');
  if (auth === null) return { kind: 'inapplicable', reason: 'the host does not advertise the `auth` family at the v2 root' };
  const lanes = Array.isArray(auth['lanes']) ? (auth['lanes'] as Array<Record<string, unknown>>) : [];
  const expOnly = lanes.filter((l) => l !== null && typeof l === 'object' && l['revocation'] === 'exp-only');
  if (expOnly.length === 0) {
    return {
      kind: 'inapplicable',
      reason: `no advertised lane names revocation "exp-only" (advertised: ${lanes.map((l) => `${String(l['lane'])}=${String(l['revocation'])}`).join(', ') || 'none'}) — §B binds the host that advertises the member and binds no other`,
    };
  }
  const lane = expOnly[0] as Record<string, unknown>;
  const w = lane['revocationWindowSeconds'];
  if (!Number.isInteger(w) || (w as number) < 1) {
    return { kind: 'blocked', reason: `lane ${String(lane['lane'])} advertises exp-only with no integer revocationWindowSeconds — the window IS the bound, and v2-lane-issuer-advertised fails that document; there is nothing here to measure against` };
  }
  const window = w as number;
  if (window < 2 * MARGIN) {
    return { kind: 'blocked', reason: `lane ${String(lane['lane'])} advertises a ${window}s window; the control token needs ${MARGIN}s of room inside it and the sabotage tokens ${MARGIN}s outside, so a window under ${2 * MARGIN}s cannot be probed without the two cases overlapping` };
  }
  // The harness is an instrument the host claims by listing it in THIS lane's issuers[]
  // (RFC 0168 §C.1's reading; lib/harness-issuer.ts). A production host lists its real
  // IdP and must never list a test issuer, so it records `inapplicable` naming the issuers
  // it does trust. Before 2.39.3 this was `blocked`, which denied certification to every
  // honest production bundle advertising an exp-only lane.
  const claim = harnessClaimed(lane, process.env['OPENWOP_TEST_OIDC_ISSUER_URL']);
  if (!claim.ok) return { kind: claim.kind, reason: claim.reason };
  const url = claim.url;
  const audience = process.env['OPENWOP_TEST_OIDC_AUDIENCE']?.trim() ?? 'openwop-conformance';
  if (issuer === null) {
    const made = createSyntheticOIDCIssuer({ issuer: url, audience, algorithm: 'RS256' });
    try { server = await serveHarnessIssuer(made, url); } catch (e) {
      return { kind: 'blocked', reason: `lane ${String(lane['lane'])} lists the harness issuer, but it could not be served for ${url}: ${(e as Error).message}` };
    }
    issuer = made;
  }
  return { issuer, url, window, lane: String(lane['lane']) };
}

/** A token with the exact `iat`/`exp` pair under test; every other claim is the control's. */
function mint(g: Gate, iat: number, exp: number): string {
  return g.issuer.mint({ sub: `conformance-${randomBytes(6).toString('hex')}`, iat, exp }).token;
}

async function present(token: string): Promise<{ status: number; code: string | undefined }> {
  const r = await driver.post('/runs', { workflowId: 'conformance-noop' }, { authenticated: false, headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, code: readErrorCode(r.json) };
}

describe('RFC 0210 §B — v2-lane-exp-only-bound (gated on an exp-only lane and a trusted harness issuer)', () => {
  it('a credential inside the advertised window is accepted — the control the two refusals rest on', async () => {
    const g = await gate();
    if (!('issuer' in g)) return softSkip(g.kind, g.reason);
    const now = Math.floor(Date.now() / 1000);
    const r = await present(mint(g, now, now + g.window - MARGIN));
    expect(
      r.status,
      req(
        'openwop.requirement.0210.exp-only-control-accepted',
        DOC,
        `a correctly signed, unexpired credential with exp − iat = ${g.window - MARGIN}s and exp − now = ${g.window - MARGIN}s — INSIDE the ${g.window}s window lane ${g.lane} advertises — MUST NOT be refused; a host that refuses this one refuses everything, and the two lifetime legs below would then witness nothing (got ${r.status} ${r.code ?? ''})`,
      ),
    ).not.toBe(401);
  }, 60_000);

  it('a credential whose TOTAL lifetime exceeds the window is refused 401, and so is one carrying no iat', async () => {
    const g = await gate();
    if (!('issuer' in g)) return softSkip(g.kind, g.reason);
    const now = Math.floor(Date.now() / 1000);

    // exp − iat = window + MARGIN (outside); exp − now = window − MARGIN (inside). The
    // `iat` is BEHIND the host's clock, which is §B.4's "ten-year token minted ten years
    // ago". Minting it at `now` instead would put it outside BOTH bounds, and a host
    // enforcing only `exp − now` would pass this leg — the row would be measuring the
    // other bound. Verified by sabotage: with the `exp − iat` comparison deleted, a
    // token minted at `now` is still refused and this leg goes green over a broken host.
    const over = await present(mint(g, now - 2 * MARGIN, now + g.window - MARGIN));
    expect(
      over.status,
      req(
        'openwop.requirement.0210.exp-only-lifetime-bound',
        DOC,
        `a correctly signed, UNEXPIRED credential with exp − iat = ${g.window + MARGIN}s — beyond the ${g.window}s window lane ${g.lane} advertises, though its exp − now of ${g.window - MARGIN}s is inside it — MUST be refused 401: on an exp-only lane the window is the only bound on how long a revoked subject keeps access (got ${over.status} ${over.code ?? ''})`,
      ),
    ).toBe(401);

    // §B.4's second sentence: the first bound cannot be evaluated without `iat`, so the
    // fail-closed rule of §2.1 applies and the refusal carries the same code.
    const noIat = g.issuer.mint({ sub: `conformance-${randomBytes(6).toString('hex')}`, exp: now + g.window - MARGIN, iat: undefined }).token;
    const bare = await present(noIat);
    expect(
      `${bare.status} ${bare.code ?? ''}`.trim(),
      req(
        'openwop.requirement.0210.exp-only-lifetime-bound',
        DOC,
        `a credential carrying NO iat MUST be refused 401 ${CODE} — exp − iat is unevaluable without it, and §2.1 fails closed rather than skipping the bound (got ${bare.status} ${bare.code ?? ''})`,
      ),
    ).toBe(`401 ${CODE}`);
  }, 60_000);

  it('the over-lifetime refusal names credential_lifetime_exceeded, not a generic unauthenticated', async () => {
    const g = await gate();
    if (!('issuer' in g)) return softSkip(g.kind, g.reason);
    const now = Math.floor(Date.now() / 1000);
    // Its own `it()` because it is its own requirement (§B.6): one row per id, or the
    // ledger keeps only the last id an assertion cited and the other goes unrecorded.
    // Same token shape as the leg above, re-minted so this row stands on its own run.
    const over = await present(mint(g, now - 2 * MARGIN, now + g.window - MARGIN));
    expect(
      over.code,
      req(
        'openwop.requirement.0210.credential-lifetime-code',
        `${DOC}; spec/v2/errors.json`,
        `a credential with exp − iat = ${g.window + MARGIN}s on the ${g.window}s exp-only lane ${g.lane} MUST be refused with ${CODE}, not a generic unauthenticated — a distinct code is what lets an outside party tell "the bound was enforced" from "the host refused for some other reason" (§B.6) (got ${over.status} ${over.code ?? ''})`,
      ),
    ).toBe(CODE);
  }, 60_000);

  it('a credential whose REMAINING lifetime exceeds the window is refused, though its total lifetime does not', async () => {
    const g = await gate();
    if (!('issuer' in g)) return softSkip(g.kind, g.reason);
    const now = Math.floor(Date.now() / 1000);
    // exp − iat = window − MARGIN (inside); exp − now = window + MARGIN (outside). The
    // only way to separate the two bounds is an `iat` ahead of the host's clock, which
    // is the skew case §B.4 names — a host enforcing only `exp − iat` serves this one.
    const iat = now + 2 * MARGIN;
    const skewed = await present(mint(g, iat, iat + g.window - MARGIN));
    expect(
      `${skewed.status} ${skewed.code ?? ''}`.trim(),
      req(
        'openwop.requirement.0210.exp-only-remaining-bound',
        DOC,
        `a credential whose exp − iat is ${g.window - MARGIN}s (inside the ${g.window}s window) but whose exp − now is ${g.window + MARGIN}s (outside it) MUST be refused 401 ${CODE}: enforcing only the total lifetime accepts a freshly minted long-lived token in its ninth year (got ${skewed.status} ${skewed.code ?? ''})`,
      ),
    ).toBe(`401 ${CODE}`);
  }, 60_000);
});

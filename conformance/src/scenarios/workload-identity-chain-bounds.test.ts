/**
 * RFC 0154 §B "Bounds" — the delegation chain is bounded, acyclic, and cannot
 * amplify scope hop-to-hop (`auth.md` §"Workload identity and delegated actor
 * chain" → Bounds; threat model A4 "chain launderer").
 *
 * `workload-identity-behavior.test.ts` proves the resolver verifies audience and
 * expiry. It does not touch the chain's SHAPE as a source of authority, and that
 * is where laundering lives: a chain that is one hop longer than the host said
 * it would accept, a chain that loops back through a subject it already passed,
 * or a chain whose second hop claims a scope its first hop never held. Each is a
 * verified-looking presentation that a passthrough resolver accepts and a real
 * one refuses, which is what makes the legs non-vacuous — `resolved: true` on
 * any of them is the finding.
 *
 * All three go through the §20 seam (`host-sample-test-seams.md`) with the
 * three closed reasons added for them: `delegation_chain_too_long`,
 * `delegation_chain_cyclic`, `delegation_scope_amplified`. Every leg is gated on
 * `auth.workloadIdentity.delegation.supported` via `behaviorGate` (a host doing
 * §A-only identity resolution has not claimed §B) — soft-skips without it,
 * HARD-FAILS under `OPENWOP_REQUIRE_BEHAVIOR=true`, and records the RFC 0148 §A
 * disposition either way. A seam that answers 404/403 is `blocked`, not a pass.
 *
 * Per-hop `scopes` on the wire are OPTIONAL (`workload-identity.schema.json`,
 * 2026-08-16); the amplification leg presents them explicitly, so a host that
 * ignores the field will resolve the chain and fail the leg — which is the
 * honest outcome, because a host that cannot see hop scopes cannot enforce the
 * MUST NOT either.
 *
 * Registered invariants: `delegation-chain-acyclic`,
 * `delegation-no-scope-amplification` (`SECURITY/invariants.yaml`), and the
 * length half of `delegation-chain-bounded`.
 */

import { describe, it, expect } from 'vitest';
import { readErrorCode, readRetriable } from '../lib/error-envelope.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DELEGATION_PROFILE = 'openwop-workload-identity-delegation';
const SEAM = '/v1/host/sample/test/workload-identity/resolve';

interface AuthCaps {
  readonly workloadIdentity?: {
    readonly supported?: boolean;
    readonly delegation?: { readonly supported?: boolean; readonly maxChainDepth?: number };
  };
}

async function delegationCaps(): Promise<{ supported: boolean; maxChainDepth: number | null }> {
  const disco = await driver.get('/.well-known/openwop');
  const d = capabilityFamily<AuthCaps>(disco.json, 'auth')?.workloadIdentity?.delegation;
  return {
    supported: d?.supported === true,
    maxChainDepth: typeof d?.maxChainDepth === 'number' && Number.isInteger(d.maxChainDepth) && d.maxChainDepth > 0 ? d.maxChainDepth : null,
  };
}

async function resolve(body: Record<string, unknown>): Promise<{ status: number; json: unknown } | null> {
  const r = await driver.post(SEAM, body);
  if (r.status === 404 || r.status === 403) {
    seamAbsent(`host advertises \`auth.workloadIdentity.delegation.supported: true\` but ${SEAM} answered ${r.status} — RFC 0154 §B chain bounds are unobservable (host-sample-test-seams.md §20)`);
    return null;
  }
  return { status: r.status, json: r.json };
}

const IDENTITY = { scheme: 'spiffe', subject: 'spiffe://example/dispatcher', issuer: 'spiffe://example', audience: 'openwop-host' };
const LIVE = '2099-01-01T00:00:00Z';

function hop(n: number, scopes?: readonly string[]): Record<string, unknown> {
  const h: Record<string, unknown> = { subject: `spiffe://example/hop-${n}`, issuer: 'spiffe://example' };
  if (scopes !== undefined) h['scopes'] = [...scopes];
  return h;
}

/** A refusal: 4xx, non-retriable, the named closed reason. */
function expectRefusal(requirementId: string, r: { status: number; json: unknown }, reason: string, why: string): void {
  expect(r.status >= 400, req(requirementId, 'RFCS/0154 §B', why)).toBe(true);
  expect(readErrorCode(r.json), req(requirementId, 'spec/v1/host-sample-test-seams.md §20', `closed reason \`${reason}\``)).toBe(reason);
  expect(readRetriable(r.json), req(requirementId, 'spec/v1/host-sample-test-seams.md §20', 'a chain the host refuses will be refused on retry')).toBe(false);
}

describe('RFC 0154 §B — delegation chain bounds (capability-gated behavior)', () => {
  it('a chain longer than the advertised maxChainDepth is refused', async () => {
    const caps = await delegationCaps();
    if (!behaviorGate(DELEGATION_PROFILE, caps.supported)) return;
    expect(
      caps.maxChainDepth,
      req('openwop.it.workload-identity-chain-bounds.a-chain-longer-than-the-advertised-maxchaindepth-is-refused', 'spec/v1/auth.md §Bounds', 'a host advertising delegation MUST advertise a positive integer `maxChainDepth`'),
    ).not.toBeNull();
    const depth = caps.maxChainDepth as number;
    const chain = Array.from({ length: depth + 1 }, (_, i) => hop(i + 1));
    const r = await resolve({ identity: { ...IDENTITY, delegation: { chain, audience: 'openwop-host', expiresAt: LIVE } }, expectedAudience: 'openwop-host' });
    if (r === null) return softSkip('blocked', 'precondition not met — `r === null` returned early (seam, prior step, or fixture unavailable)');
    expectRefusal('openwop.it.workload-identity-chain-bounds.a-chain-longer-than-the-advertised-maxchaindepth-is-refused', r, 'delegation_chain_too_long', `a chain of ${depth + 1} hops exceeds the advertised bound of ${depth} — each hop is another party the host trusts transitively`);
  });

  it('a chain that revisits a subject is refused as cyclic', async () => {
    const caps = await delegationCaps();
    if (!behaviorGate(DELEGATION_PROFILE, caps.supported)) return;
    // Two distinct hops then the first subject again: length 3, so on any
    // host with maxChainDepth >= 3 the ONLY reason to refuse it is the cycle.
    // On a host with maxChainDepth < 3 the too-long leg already covers refusal
    // and this leg accepts either reason, saying so.
    const chain = [hop(1), hop(2), hop(1)];
    const r = await resolve({ identity: { ...IDENTITY, delegation: { chain, audience: 'openwop-host', expiresAt: LIVE } }, expectedAudience: 'openwop-host' });
    if (r === null) return softSkip('blocked', 'precondition not met — `r === null` returned early (seam, prior step, or fixture unavailable)');
    const bound = caps.maxChainDepth ?? Number.POSITIVE_INFINITY;
    if (bound < 3) {
      expect(r.status >= 400, req('openwop.it.workload-identity-chain-bounds.a-chain-that-revisits-a-subject-is-refused-as-cyclic', 'RFCS/0154 §B', 'a cyclic chain is refused')).toBe(true);
      expect(['delegation_chain_cyclic', 'delegation_chain_too_long'], req('openwop.it.workload-identity-chain-bounds.a-chain-that-revisits-a-subject-is-refused-as-cyclic', 'spec/v1/host-sample-test-seams.md §20', 'cyclic or too-long — the bound is below the cycle length')).toContain(readErrorCode(r.json));
      expect(readRetriable(r.json)).toBe(false);
      return softSkip('blocked', 'precondition not met — `bound < 3` returned early (seam, prior step, or fixture unavailable)');
    }
    expectRefusal('openwop.it.workload-identity-chain-bounds.a-chain-that-revisits-a-subject-is-refused-as-cyclic', r, 'delegation_chain_cyclic', 'a subject appearing twice is a chain that loops back through authority it already spent — unbounded laundering with a bounded length');
  });

  it('a later hop claiming a scope the previous hop did not hold is refused', async () => {
    const caps = await delegationCaps();
    if (!behaviorGate(DELEGATION_PROFILE, caps.supported)) return;
    const chain = [hop(1, ['runs:read']), hop(2, ['runs:read', 'runs:write'])];
    const r = await resolve({ identity: { ...IDENTITY, delegation: { chain, audience: 'openwop-host', expiresAt: LIVE } }, expectedAudience: 'openwop-host' });
    if (r === null) return softSkip('blocked', 'precondition not met — `r === null` returned early (seam, prior step, or fixture unavailable)');
    expectRefusal('openwop.it.workload-identity-chain-bounds.a-later-hop-claiming-a-scope-the-previous-hop-did-not-hold-is-refused', r, 'delegation_scope_amplified', 'the effective scopes at any hop MUST NOT exceed the hop before it — a chain is provenance, and provenance cannot mint `runs:write` from `runs:read`');
  });

  it('a well-formed bounded, acyclic, non-amplifying chain still resolves (the negatives are not a blanket refusal)', async () => {
    const caps = await delegationCaps();
    if (!behaviorGate(DELEGATION_PROFILE, caps.supported)) return;
    const chain = [hop(1, ['runs:read', 'manifest:read']), hop(2, ['runs:read'])];
    const r = await resolve({ identity: { ...IDENTITY, delegation: { chain, audience: 'openwop-host', expiresAt: LIVE } }, expectedAudience: 'openwop-host' });
    if (r === null) return softSkip('blocked', 'precondition not met — `r === null` returned early (seam, prior step, or fixture unavailable)');
    // A host that refuses EVERY chain passes the three negatives vacuously; this
    // is the positive that keeps them honest. Scopes narrow hop-to-hop, which
    // is the one direction §B permits.
    expect(r.status, req('openwop.it.workload-identity-chain-bounds.a-well-formed-bounded-acyclic-non-amplifying-chain-still-resolves-the-negatives', 'RFCS/0154 §B', 'a compliant chain resolves; the bounds refuse laundering, not delegation')).toBe(200);
    expect((r.json as { resolved?: unknown }).resolved).toBe(true);
  });
});

/**
 * v2 — `assurance-downgrade-audited` (suite 2.0.0; RFC 0170 §B.4;
 * `spec/v2/core/identity.md` §2.3 "Minimum assurance"; RFC 0154 R3).
 *
 * Witness class: seam-gated (`openwop-conformance-seams-v2`). A request below
 * the lane's `minimumAssurance` MUST be refused with
 * `401 sender_constraint_missing`, and an audit fact MUST record the assurance
 * actually used; a bearer fallback never inherits a sender-constrained label.
 * Driven through the §20 workload-identity seam
 * (`POST /conformance/seams/sample/test/workload-identity/resolve`, the
 * v1-shaped path through `seamPath()`): an identity presented WITHOUT
 * `keyBinding` on a `workload` lane whose floor is above `bearer` MUST be
 * refused; an identity WITH a key binding resolves, and the seam's response is
 * expected to surface `assurance` (the audited fact) — §20 does not yet declare
 * that field, so its absence records `blocked` rather than a pass.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamPath, seamsProfileAdvertised } from '../lib/seams.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/identity.md §2.3';
const SEAM = seamPath('/v1/host/sample/test/workload-identity/resolve');
const IDENTITY = { scheme: 'spiffe', subject: 'spiffe://example/dispatcher', issuer: 'spiffe://example', audience: 'openwop-host' };
const ASSURANCE = new Set(['bearer', 'sender-constrained', 'key-bound']);

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** The advertised workload lane when its floor is above bearer, else a reason. */
async function gate(): Promise<{ floor: string } | { kind: 'blocked' | 'inapplicable'; reason: string }> {
  const doc = await discovery();
  if (!doc) return { kind: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  if (!seamsProfileAdvertised(doc)) return { kind: 'blocked', reason: 'seams profile not advertised (conformance.seamsProfile !== openwop-conformance-seams-v2) — the assurance floor is seam-gated' };
  const auth = await familyAdvertised('auth');
  const lanes = Array.isArray(auth?.['lanes']) ? (auth['lanes'] as Array<Record<string, unknown>>) : [];
  const workload = lanes.find((l) => l['lane'] === 'workload');
  if (workload === undefined) return { kind: 'inapplicable', reason: 'the host does not advertise a `workload` lane' };
  const floor = String(workload['minimumAssurance']);
  if (floor === 'bearer') return { kind: 'inapplicable', reason: 'the workload lane advertises minimumAssurance: bearer — no request can be below the floor' };
  return { floor };
}

describe('v2 assurance-downgrade-audited (RFC 0170 §B.4 — seam-gated)', () => {
  it('an identity below the lane floor is refused with sender_constraint_missing', async () => {
    const g = await gate();
    if ('kind' in g) return softSkip(g.kind, g.reason);
    const res = await http(() => driver.post(SEAM, { identity: IDENTITY, expectedAudience: 'openwop-host' }));
    if (res === null) return softSkip('blocked', `${SEAM} unreachable (fetch failed)`);
    if (res.status === 404 || res.status === 403) return seamAbsent(`${SEAM} not mounted (${res.status}) — host-sample-test-seams.md §20`);
    expect(res.status, req('openwop.requirement.0170.assurance-downgrade-audited.refused', DOC, `the workload lane advertises minimumAssurance: ${g.floor}; an identity presented without a key binding is below the floor and MUST be refused with 401`)).toBe(401);
    expect(readErrorCode(res.json), req('openwop.requirement.0170.assurance-downgrade-audited.refused', DOC, 'the refusal code MUST be sender_constraint_missing')).toBe('sender_constraint_missing');
  });

  it('a resolved identity records the assurance actually used, never a downgraded bearer under a sender-constrained label', async () => {
    const g = await gate();
    if ('kind' in g) return softSkip(g.kind, g.reason);
    const res = await http(() => driver.post(SEAM, { identity: { ...IDENTITY, keyBinding: { method: 'mtls', thumbprintRef: 'openwop-conformance-thumbprint' } }, expectedAudience: 'openwop-host' }));
    if (res === null) return softSkip('blocked', `${SEAM} unreachable (fetch failed)`);
    if (res.status === 404 || res.status === 403) return seamAbsent(`${SEAM} not mounted (${res.status}) — host-sample-test-seams.md §20`);
    if (res.status !== 200) return softSkip('blocked', `the seam refused the key-bound identity (${res.status} ${readErrorCode(res.json) ?? ''}) — the audit fact of a resolved request cannot be read`);
    const assurance = (res.json as { assurance?: unknown } | undefined)?.assurance;
    if (assurance === undefined) return seamAbsent('the §20 seam response carries no `assurance` field — RFC 0170 §B.4 "an audit fact MUST record the assurance actually used" is unobservable until the seam surfaces it (RFC 0154 R3)');
    expect(ASSURANCE.has(String(assurance)), req('openwop.requirement.0170.assurance-downgrade-audited.audited', DOC, `the audited assurance MUST be one of bearer | sender-constrained | key-bound (got ${String(assurance)})`)).toBe(true);
    expect(assurance !== 'bearer', req('openwop.requirement.0170.assurance-downgrade-audited.audited', DOC, `a key-bound presentation resolved above the ${g.floor} floor MUST NOT be recorded as bearer, and a bearer fallback MUST NOT inherit a sender-constrained label (invariant sender-constraint-no-bearer-downgrade)`)).toBe(true);
  });
});

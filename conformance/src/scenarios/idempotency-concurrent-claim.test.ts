/**
 * RFC 0150 §B / `idempotency.md` §"Concurrent duplicates (Layer 2)" — the
 * atomic-claim witness. Gap **G17**.
 *
 * The rule: the persist that guards a side effect MUST be an **atomic claim** —
 * a compare-and-set / insert-if-absent that at most one executor can win — not a
 * read-then-write. It is unconditional, and the spec says it MUST hold *within a
 * single-instance deployment*, naming the case where an orphan sweeper
 * re-dispatches a run whose owner is stalled but still alive.
 *
 * It had no witness of any kind. `layer2-invocation-claim-atomic` was registered
 * reference-impl tier with an EMPTY `tests` list, because driving the rule needs
 * two executors of one run concurrently reaching one effect chokepoint and the
 * black-box suite cannot cause that. Per RFC 0148 §A an unobservable requirement
 * resolves to `blocked` — and a wire probe asserting it would pass on a host that
 * has the defect, which is the vacuous-witness pattern §A exists to close.
 *
 * `host-sample-test-seams.md` §25 is what makes it drivable. This file drives it.
 *
 * **Two assertions, and the second is the point.** `delivered === 1` alone is not
 * evidence: a host passes it by minting DIFFERENT identities per executor and
 * never colliding — one effect, because nothing raced. So the seam reports the
 * id each executor minted and this scenario asserts they are identical BEFORE
 * asserting the delivery count. That is the observable projection of
 * `idempotency.md` §"Idempotency key composition" → "Across a recovery boundary":
 * the ordinal reproduces iff the resumed unit re-executes the node's logical
 * activities from the start, and a host that resumes mid-node shifts every
 * downstream identity and defeats Layer-2 dedup on exactly the crash it most
 * needs to survive.
 *
 * Reproducing the race is the hard part, and a true statement can stand in the
 * way of it: a tier-1 host carried the note "the shared ordinal counter hands the
 * second emit a DIFFERENT identity, so it is not reproducible single-instance" —
 * true of two SEQUENTIAL emits, and it became a reason nobody tried. Identity
 * minting runs synchronously before the first `await`, so two un-awaited calls
 * both mint the same ordinal. That host then measured 2 effects without the
 * claim and 1 with it.
 *
 * A host that does not mount the seam records `blocked` (unwitnessed), never
 * `inapplicable`: the requirement binds every host, so absence is missing
 * evidence rather than a requirement that does not apply.
 *
 * **Deliberately NOT `behaviorGate`, and therefore not opt-out-able.** A profile
 * gate exists to separate "host claims X and fails" from "host does not claim X",
 * and it lets an operator flip strict-mode failure into pass-by-opt-out. Neither
 * move is available here: this obligation is UNCONDITIONAL, so no host may
 * declare it does not apply, and converting an unwitnessed MUST into a pass is
 * precisely the dishonesty the opt-out list must never be used for. `blocked` is
 * already the correct RFC 0148 §A disposition — it applies, it was not witnessed,
 * and it is NOT certifiable. That keeps the reference-host soak green without
 * anyone claiming the requirement was met.
 */
import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const SEAM = '/v1/host/sample/test/idempotency/concurrent-claim';

type ClaimResult = {
  logicalInvocationId?: unknown;
  mintedIds?: unknown;
  attempted?: unknown;
  delivered?: unknown;
};

/** Is the §25 seam mounted? 404/403/501 mean not mounted — anything else is a real answer. */
async function seamPresent(requirementId: string): Promise<ClaimResult | null> {
  const res = await driver.post(SEAM, { executors: 2 });
  if (res.status === 404 || res.status === 403 || res.status === 501) return null;
  expect(
    res.status,
    req(requirementId, 
      'host-sample-test-seams.md §25',
      'a mounted concurrent-claim seam MUST answer 200; a non-200 that is not 404/403/501 is a broken seam, not an absent one',
    ),
  ).toBe(200);
  return res.json as ClaimResult;
}

describe('idempotency-concurrent-claim: two executors of one run, one effect (RFC 0150 §B, G17)', () => {
  it('every executor mints the SAME logicalInvocationId — without this, one delivery proves nothing', async () => {
    const out = await seamPresent('openwop.it.idempotency-concurrent-claim.every-executor-mints-the-same-logicalinvocationid-without-this-one-delivery-prov');
    if (out === null) return softSkip('blocked', `${SEAM} not mounted (host-sample-test-seams.md §25)`);

    const minted = out.mintedIds;
    expect(
      Array.isArray(minted),
      req('openwop.it.idempotency-concurrent-claim.every-executor-mints-the-same-logicalinvocationid-without-this-one-delivery-prov', 'host-sample-test-seams.md §25', 'the seam MUST report mintedIds, one per executor'),
    ).toBe(true);
    const ids = minted as unknown[];
    expect(
      ids.length,
      req('openwop.it.idempotency-concurrent-claim.every-executor-mints-the-same-logicalinvocationid-without-this-one-delivery-prov', 'host-sample-test-seams.md §25', 'mintedIds length MUST equal the executors that reached the chokepoint'),
    ).toBe(out.attempted);
    expect(
      ids.length >= 2,
      req('openwop.it.idempotency-concurrent-claim.every-executor-mints-the-same-logicalinvocationid-without-this-one-delivery-prov', 'host-sample-test-seams.md §25', 'fewer than two executors is not a race and cannot witness the rule'),
    ).toBe(true);

    const unique = new Set(ids.map((x) => JSON.stringify(x)));
    expect(
      unique.size,
      req('openwop.it.idempotency-concurrent-claim.every-executor-mints-the-same-logicalinvocationid-without-this-one-delivery-prov', 
        'idempotency.md §"Idempotency key composition" (Across a recovery boundary)',
        'all executors MUST mint one identity — differing ids mean they never collided, so a single delivery is a vacuous pass rather than a working claim',
      ),
    ).toBe(1);
  });

  it('exactly one effect escapes, however many executors attempt it', async () => {
    const out = await seamPresent('openwop.it.idempotency-concurrent-claim.exactly-one-effect-escapes-however-many-executors-attempt-it');
    if (out === null) return softSkip('blocked', `${SEAM} not mounted (host-sample-test-seams.md §25)`);

    expect(
      typeof out.attempted === 'number' && (out.attempted as number) >= 2,
      req('openwop.it.idempotency-concurrent-claim.exactly-one-effect-escapes-however-many-executors-attempt-it', 'host-sample-test-seams.md §25', 'the seam MUST report how many executors attempted the effect'),
    ).toBe(true);
    expect(
      out.delivered,
      req('openwop.it.idempotency-concurrent-claim.exactly-one-effect-escapes-however-many-executors-attempt-it', 
        'idempotency.md §"Concurrent duplicates (Layer 2)"',
        'the engine MUST ensure at most one concurrent executor performs the external effect — the guarding persist MUST be an atomic claim, not a read-then-write',
      ),
    ).toBe(1);
  });

  it('the race is real at higher concurrency too — a claim that only holds at 2 is not a claim', async () => {
    const probe = await seamPresent('openwop.it.idempotency-concurrent-claim.the-race-is-real-at-higher-concurrency-too-a-claim-that-only-holds-at-2-is-not-a');
    if (probe === null) return softSkip('blocked', `${SEAM} not mounted (host-sample-test-seams.md §25)`);

    const res = await driver.post(SEAM, { executors: 5 });
    // A host MAY cap `executors`; what it MUST NOT do is deliver more than once.
    // Say so — an unclassified return records `blocked` with no reason, which is
    // the same thing this file exists to stop happening to the requirement.
    if (res.status !== 200) {
      return softSkip('skipped', `${SEAM} declined executors: 5 (status ${res.status}) — a host MAY cap concurrency`);
    }
    const out = res.json as ClaimResult;
    expect(
      out.delivered,
      req('openwop.it.idempotency-concurrent-claim.the-race-is-real-at-higher-concurrency-too-a-claim-that-only-holds-at-2-is-not-a', 
        'idempotency.md §"Concurrent duplicates (Layer 2)"',
        'exactly one effect regardless of how many executors race — at most one wins the compare-and-set, the rest observe the hit',
      ),
    ).toBe(1);
    const ids = Array.isArray(out.mintedIds) ? (out.mintedIds as unknown[]) : [];
    if (ids.length >= 2) {
      expect(
        new Set(ids.map((x) => JSON.stringify(x))).size,
        req('openwop.it.idempotency-concurrent-claim.the-race-is-real-at-higher-concurrency-too-a-claim-that-only-holds-at-2-is-not-a', 'idempotency.md §"Idempotency key composition"', 'one identity across all executors at any concurrency'),
      ).toBe(1);
    }
  });
});

/**
 * Multi-region idempotency convergence-rule smoke (Track 13).
 *
 * Verifies that `resolveCrossRegionConflict` honors the annex per
 * `spec/v1/idempotency.md` §"Multi-region idempotency":
 *
 *   1. Lex-min(runId) wins regardless of caller order or region.
 *   2. Same input → same output (determinism — two regions running
 *      this resolver independently arrive at the same survivor
 *      without coordination).
 *   3. Losers are tagged with `loserCancelReason: 'cross_region_dedup_loss'`
 *      so the caller emits the spec-mandated `run.cancelled` reason.
 *   4. Every region's cache (including the winner's) gets a redirect
 *      to the winning runId — subsequent retries with the same key
 *      converge regardless of which region they hit.
 *   5. Conflicting `(tenantId, endpoint, key)` tuples are rejected
 *      with a clear error (programming error in the caller).
 *   6. `crossRegionConflictLabels` produces a deterministic
 *      lexicographic region-pair label so the metric counter
 *      aggregates symmetrically across regions.
 *
 * This is an algorithmic smoke — the resolver is a pure function,
 * so the test doesn't need to boot the host or simulate partition
 * replication. Future multi-region hosts adopt the resolver into
 * their reconcile loop and claim `crossRegion: 'best-effort'`
 * honestly; the Postgres reference host stays single-region and
 * advertises `crossRegion: 'single-region'`.
 *
 * @see examples/hosts/postgres/src/multi-region.ts
 * @see spec/v1/idempotency.md §"Multi-region idempotency"
 */

import assert from 'node:assert/strict';

import {
  resolveCrossRegionConflict,
  crossRegionConflictLabels,
  type ConflictClaim,
} from '../src/multi-region.js';

function claim(runId: string, region: string): ConflictClaim {
  return {
    runId,
    tenantId: 'tenant-acme',
    endpoint: 'POST /v1/runs',
    key: 'idemp-key-42',
    region,
  };
}

function main(): void {
  // 1. Lex-min wins regardless of input order.
  {
    const a = claim('run-aaa-111', 'us-east-1');
    const b = claim('run-bbb-222', 'eu-west-1');
    const fromAFirst = resolveCrossRegionConflict([a, b]);
    const fromBFirst = resolveCrossRegionConflict([b, a]);
    assert.equal(fromAFirst.winner.runId, 'run-aaa-111');
    assert.equal(fromBFirst.winner.runId, 'run-aaa-111',
      'lex-min winner MUST NOT depend on input order');
    assert.equal(fromAFirst.losers.length, 1);
    assert.equal(fromAFirst.losers[0]?.runId, 'run-bbb-222');
  }

  // 2. Determinism across regions: two regions calling the resolver
  //    with the same inputs arrive at the same survivor without
  //    coordination.
  {
    const claims = [
      claim('run-zzz-999', 'ap-southeast-2'),
      claim('run-mmm-555', 'eu-west-1'),
      claim('run-aaa-111', 'us-east-1'),
    ];
    const r1 = resolveCrossRegionConflict(claims);
    const r2 = resolveCrossRegionConflict([...claims].reverse());
    assert.equal(r1.winner.runId, r2.winner.runId);
    assert.equal(r1.winner.runId, 'run-aaa-111');
    assert.deepEqual(
      r1.losers.map((l) => l.runId).sort(),
      r2.losers.map((l) => l.runId).sort(),
    );
  }

  // 3. Loser cancel reason matches the spec.
  {
    const result = resolveCrossRegionConflict([
      claim('run-xxx-888', 'us-east-1'),
      claim('run-yyy-999', 'eu-west-1'),
    ]);
    assert.equal(result.loserCancelReason, 'cross_region_dedup_loss',
      "spec annex §'Convergence rule' MUST emit reason 'cross_region_dedup_loss'");
  }

  // 4. Cache redirect: every region (including the winner's) MUST
  //    redirect to the winning runId.
  {
    const result = resolveCrossRegionConflict([
      claim('run-aaa-111', 'us-east-1'),
      claim('run-bbb-222', 'eu-west-1'),
      claim('run-ccc-333', 'ap-southeast-2'),
    ]);
    assert.equal(result.cacheRedirects.length, 3,
      'every region in the conflict set MUST receive a redirect entry');
    for (const redirect of result.cacheRedirects) {
      assert.equal(redirect.redirectToRunId, 'run-aaa-111',
        `region ${redirect.region} MUST redirect to winning runId`);
      assert.equal(redirect.cacheKey, 'POST /v1/runs:idemp-key-42');
    }
  }

  // 5. Mismatched tuples → error.
  {
    assert.throws(
      () => resolveCrossRegionConflict([
        claim('run-1', 'us-east-1'),
        { ...claim('run-2', 'eu-west-1'), tenantId: 'tenant-other' },
      ]),
      /share \(tenantId, endpoint, key\)/,
    );
    assert.throws(
      () => resolveCrossRegionConflict([claim('run-1', 'us-east-1')]),
      /need ≥2 conflicting claims/,
    );
  }

  // 6. Metric labels deterministic regardless of caller-side region
  //    ordering — symmetric aggregation.
  {
    const r1 = resolveCrossRegionConflict([
      claim('run-aaa', 'us-east-1'),
      claim('run-bbb', 'eu-west-1'),
    ]);
    const r2 = resolveCrossRegionConflict([
      claim('run-aaa', 'eu-west-1'),
      claim('run-bbb', 'us-east-1'),
    ]);
    const l1 = crossRegionConflictLabels(r1);
    const l2 = crossRegionConflictLabels(r2);
    assert.equal(l1.regionPair, l2.regionPair,
      'crossRegionConflictLabels MUST produce deterministic region-pair labels');
    assert.equal(l1.regionPair, 'eu-west-1|us-east-1');
    assert.equal(l1.tenant, 'tenant-acme');
    assert.equal(l1.route, 'POST /v1/runs');
  }

  // eslint-disable-next-line no-console
  console.log('ok multi-region-idempotency — 6 paths verified (annex convergence rule + label determinism)');
}

main();

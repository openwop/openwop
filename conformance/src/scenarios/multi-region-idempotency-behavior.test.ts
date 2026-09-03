/**
 * multi-region-idempotency-behavior — RFC 0036 §C convergence-rule behavioral probe.
 *
 * Companion to `multi-region-idempotency.test.ts` which carries the
 * advertisement-shape probes. This file exercises the canonical convergence
 * algorithm specified by `spec/v1/idempotency.md` §"Multi-region idempotency
 * annex" via the host-extension test seam at:
 *
 *   POST /v1/host/sample/test/multi-region/simulate-partition
 *
 * The seam is conformance-only (host-extension namespace), gated on the
 * host's `OPENWOP_TEST_MULTI_REGION_SIMULATOR=true` env var. The seam itself
 * is OPTIONAL — hosts that don't expose it soft-skip; hosts that DO expose
 * it MUST honor the annex's convergence rule:
 *
 *   1. Given ≥2 conflicting `ConflictClaim` records sharing
 *      `(tenantId, endpoint, key)`, the host's resolver MUST return the
 *      lex-min `runId` as the winner.
 *   2. Every region (including the winner's) gets a cache redirect entry
 *      pointing at the winner's runId.
 *   3. The loser's cancel reason MUST be the canonical string
 *      `cross_region_dedup_loss`.
 *   4. The resolver MUST be order-invariant — shuffling the input claims
 *      MUST produce the same winner.
 *   5. Cross-region partition simulation: same idempotency-key submitted
 *      to 2+ regions simultaneously converges to ONE survivor per the
 *      lex-min rule, with no coordination required.
 *
 * @see RFCS/0036-multi-region-and-cross-engine-guarantees.md §C
 * @see spec/v1/idempotency.md §"Multi-region idempotency annex"
 */

import { describe, it, expect } from 'vitest';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface ConflictClaim {
  runId: string;
  tenantId: string;
  endpoint: string;
  key: string;
  region: string;
}

interface ConvergenceResult {
  winner?: ConflictClaim;
  losers?: ConflictClaim[];
  cacheRedirects?: Array<{ region: string; cacheKey: string; redirectToRunId: string }>;
  loserCancelReason?: string;
}

async function simulatePartition(claims: ConflictClaim[]): Promise<{ status: number; body: ConvergenceResult }> {
  const res = await driver.post('/v1/host/sample/test/multi-region/simulate-partition', { claims });
  return { status: res.status, body: (res.json as ConvergenceResult) ?? {} };
}

/**
 * The multi-region simulator seam answered 404. `blocked` when the host advertises
 * a cross-region posture (`idempotency.crossRegion` present) it has made
 * unobservable, `inapplicable` when it advertises none (RFC 0148 §A).
 */
async function noteSimulatorAbsent(): Promise<void> {
  const disco = await driver.get('/.well-known/openwop');
  const idem = capabilityFamily<{ crossRegion?: unknown }>(disco.json, 'idempotency');
  if (idem?.crossRegion !== undefined) {
    seamAbsent(`host advertises \`idempotency.crossRegion: ${String(idem.crossRegion)}\` but \`POST /v1/host/sample/test/multi-region/simulate-partition\` answered 404 — the convergence rule is unobservable (host-sample-test-seams.md §6)`);
  } else {
    softSkip('inapplicable', 'optional advertisement — `idempotency.crossRegion` not advertised by this host, and the multi-region simulator seam is absent (RFC 0036 §C)');
  }
}

describe.skipIf(HTTP_SKIP)('multi-region-idempotency-behavior: convergence rule (RFC 0036 §C)', () => {
  it('two-region conflict resolves to the lex-min runId per annex §"Convergence rule"', async (ctx) => {
    const probe = await simulatePartition([
      { runId: 'run-b-east', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-1', region: 'us-east-1' },
      { runId: 'run-a-west', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-1', region: 'eu-west-1' },
    ]);
    if (probe.status === 404) {
      await noteSimulatorAbsent();
      ctx.skip(); // host doesn't expose the simulator seam
      return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(
      probe.status,
      req('openwop.it.multi-region-idempotency-behavior.two-region-conflict-resolves-to-the-lex-min-runid-per-annex-convergence-rule', 
        'idempotency.md §"Multi-region idempotency annex"',
        'simulate-partition seam MUST return 200 when ≥2 conflicting claims are submitted',
      ),
    ).toBe(200);
    expect(
      probe.body.winner?.runId,
      req('openwop.it.multi-region-idempotency-behavior.two-region-conflict-resolves-to-the-lex-min-runid-per-annex-convergence-rule', 
        'idempotency.md §"Convergence rule"',
        'winner MUST be the lex-min runId (run-a-west < run-b-east)',
      ),
    ).toBe('run-a-west');
  });

  it('three-region partition resolves to a single winner', async (ctx) => {
    const probe = await simulatePartition([
      { runId: 'zzz-3', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-2', region: 'r1' },
      { runId: 'aaa-1', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-2', region: 'r2' },
      { runId: 'mmm-2', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-2', region: 'r3' },
    ]);
    if (probe.status === 404) {
      await noteSimulatorAbsent();
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(probe.status).toBe(200);
    expect(
      probe.body.winner?.runId,
      req('openwop.it.multi-region-idempotency-behavior.three-region-partition-resolves-to-a-single-winner', 
        'idempotency.md §"Convergence rule"',
        'winner MUST be the lex-min runId across all conflicting claims',
      ),
    ).toBe('aaa-1');
    expect(
      probe.body.losers?.length,
      req('openwop.it.multi-region-idempotency-behavior.three-region-partition-resolves-to-a-single-winner', 
        'idempotency.md §"Convergence rule"',
        'losers array MUST contain N-1 entries when N claims conflict',
      ),
    ).toBe(2);
  });

  it('every region gets a cache redirect entry pointing at the winner', async (ctx) => {
    const probe = await simulatePartition([
      { runId: 'run-x', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-3', region: 'r1' },
      { runId: 'run-a', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-3', region: 'r2' },
    ]);
    if (probe.status === 404) {
      await noteSimulatorAbsent();
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(probe.status).toBe(200);
    const redirects = probe.body.cacheRedirects ?? [];
    expect(
      redirects.length,
      req('openwop.it.multi-region-idempotency-behavior.every-region-gets-a-cache-redirect-entry-pointing-at-the-winner', 
        'idempotency.md §"Convergence rule"',
        'cacheRedirects MUST contain one entry per claim (including the winner)',
      ),
    ).toBe(2);
    for (const redirect of redirects) {
      expect(
        redirect.redirectToRunId,
        req('openwop.it.multi-region-idempotency-behavior.every-region-gets-a-cache-redirect-entry-pointing-at-the-winner', 
          'idempotency.md §"Convergence rule"',
          'every cache redirect MUST point at the winner runId',
        ),
      ).toBe('run-a');
    }
  });

  it('loser cancel reason MUST be the canonical `cross_region_dedup_loss` string', async (ctx) => {
    const probe = await simulatePartition([
      { runId: 'run-b', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-4', region: 'r1' },
      { runId: 'run-a', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-4', region: 'r2' },
    ]);
    if (probe.status === 404) {
      await noteSimulatorAbsent();
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(probe.status).toBe(200);
    expect(
      probe.body.loserCancelReason,
      req('openwop.it.multi-region-idempotency-behavior.loser-cancel-reason-must-be-the-canonical-cross-region-dedup-loss-string', 
        'idempotency.md §"Convergence rule"',
        'loserCancelReason MUST be the canonical `cross_region_dedup_loss` string',
      ),
    ).toBe('cross_region_dedup_loss');
  });

  it('resolver is order-invariant — shuffled inputs produce the same winner', async (ctx) => {
    const claims: ConflictClaim[] = [
      { runId: 'c', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-5', region: 'r1' },
      { runId: 'a', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-5', region: 'r2' },
      { runId: 'b', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-5', region: 'r3' },
    ];
    const p1 = await simulatePartition(claims);
    if (p1.status === 404) {
      await noteSimulatorAbsent();
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `p1.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(p1.status).toBe(200);
    const p2 = await simulatePartition([claims[2]!, claims[0]!, claims[1]!]);
    expect(p2.status).toBe(200);
    const p3 = await simulatePartition([...claims].reverse());
    expect(p3.status).toBe(200);
    expect(
      p1.body.winner?.runId,
      req('openwop.it.multi-region-idempotency-behavior.resolver-is-order-invariant-shuffled-inputs-produce-the-same-winner', 
        'idempotency.md §"Convergence rule" — determinism',
        'resolver MUST be order-invariant; all permutations MUST produce the same lex-min winner',
      ),
    ).toBe('a');
    expect(p2.body.winner?.runId).toBe('a');
    expect(p3.body.winner?.runId).toBe('a');
  });

  it('mismatched tuple rejects with 400 validation_error', async (ctx) => {
    const probe = await simulatePartition([
      { runId: 'r1', tenantId: 't1', endpoint: 'POST /v1/runs', key: 'idem-6', region: 'r1' },
      { runId: 'r2', tenantId: 't2', endpoint: 'POST /v1/runs', key: 'idem-6', region: 'r2' },
    ]);
    if (probe.status === 404) {
      await noteSimulatorAbsent();
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(
      probe.status,
      req('openwop.it.multi-region-idempotency-behavior.mismatched-tuple-rejects-with-400-validation-error', 
        'idempotency.md §"Convergence rule"',
        'claims with non-matching (tenantId, endpoint, key) MUST be rejected — it would be a programming error in the caller',
      ),
    ).toBe(400);
  });
});

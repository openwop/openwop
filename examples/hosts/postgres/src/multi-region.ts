/**
 * Multi-region idempotency convergence rule per
 * `spec/v1/idempotency.md` §"Multi-region idempotency" (annex).
 *
 * Cross-region replays during partition MAY succeed in both regions
 * independently. After the partition heals, the host MUST resolve to
 * a single survivor per the convergence rule:
 *
 *   1. Lower `runId` lexicographic order wins (deterministic without
 *      coordination).
 *   2. The losing run is force-cancelled (`run.cancelled` with
 *      reason `'cross_region_dedup_loss'`).
 *   3. The losing run's `Idempotency-Key` cache entry is updated to
 *      point at the winning `runId`.
 *   4. Subsequent retries with that key return the winning run.
 *
 * This module ships the **algorithm** for the rule. Wiring the
 * algorithm into a live multi-region replication path is a
 * deployment-specific concern (cache fabric choice, partition
 * detection, replication lag tolerances). Single-region hosts MAY
 * keep the canonical `crossRegion: 'single-region'` advertisement and
 * never invoke this resolver; multi-region deployments adopt the
 * resolver into their reconcile loop and may then claim
 * `crossRegion: 'best-effort'` honestly.
 *
 * **Why a standalone module.** Per the protocol annex, the
 * convergence rule is normative — every multi-region host MUST
 * produce the same outcome given the same inputs. Factoring the
 * algorithm out of the request path lets us prove that property in
 * tests against synthetic inputs (no actual partition required).
 *
 * @see spec/v1/idempotency.md §"Multi-region idempotency"
 */

/**
 * One region's claim on a shared `(tenantId, endpoint, key)` tuple.
 * Two or more claims with overlapping tuples constitute the cross-
 * region conflict that this resolver converges.
 */
export interface ConflictClaim {
  /** Engine-assigned run id. The convergence rule sorts on this. */
  readonly runId: string;
  /** Tenant scope — only claims in the same tenant collide. */
  readonly tenantId: string;
  /**
   * Endpoint scope — `'POST /v1/runs'` for the v1 run-create path.
   * Other Layer-1 endpoints get their own keyspace.
   */
  readonly endpoint: string;
  /** Caller-supplied `Idempotency-Key`. */
  readonly key: string;
  /**
   * Stable region identifier (e.g., `'us-east-1'`, `'eu-west-1'`).
   * Used for the `cross_region_conflicts_total` metric labels and
   * for the operator-facing log line.
   */
  readonly region: string;
}

/**
 * Convergence outcome: the single survivor plus the list of losers
 * whose runs MUST be force-cancelled with reason
 * `'cross_region_dedup_loss'` and whose regional cache entries MUST
 * be redirected at the winner.
 */
export interface ConvergenceResult {
  readonly winner: ConflictClaim;
  readonly losers: ConflictClaim[];
  /**
   * Per-region cache redirect instructions. Operators apply these
   * to their regional idempotency caches so subsequent retries
   * return the winning runId regardless of region.
   */
  readonly cacheRedirects: Array<{
    region: string;
    cacheKey: string;
    redirectToRunId: string;
  }>;
  /**
   * Spec-mandated reason field for the loser's `run.cancelled`
   * event per idempotency.md §"Convergence rule".
   */
  readonly loserCancelReason: 'cross_region_dedup_loss';
}

/**
 * Apply the convergence rule per `idempotency.md` §"Convergence rule".
 *
 * **Pure function.** Given the same set of claims it produces the
 * same result regardless of caller order, region, or wall clock —
 * lexicographic min(runId) is fully deterministic, so two regions
 * applying this resolver independently arrive at the same survivor
 * without any coordination.
 *
 * **Throws** when `claims.length < 2` (no conflict to resolve) OR
 * when the claims do not share a `(tenantId, endpoint, key)` tuple
 * (would be a programming error in the caller).
 */
export function resolveCrossRegionConflict(
  claims: ReadonlyArray<ConflictClaim>,
): ConvergenceResult {
  if (claims.length < 2) {
    throw new Error(
      `resolveCrossRegionConflict: need ≥2 conflicting claims (got ${claims.length})`,
    );
  }

  const head = claims[0]!;
  for (const c of claims.slice(1)) {
    if (
      c.tenantId !== head.tenantId ||
      c.endpoint !== head.endpoint ||
      c.key !== head.key
    ) {
      throw new Error(
        `resolveCrossRegionConflict: all claims MUST share (tenantId, endpoint, key) — ` +
          `got ${head.tenantId}/${head.endpoint}/${head.key} vs ${c.tenantId}/${c.endpoint}/${c.key}`,
      );
    }
  }

  // Lex-sort runIds; the first wins per the annex.
  const sorted = [...claims].sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  const winner = sorted[0]!;
  const losers = sorted.slice(1);

  const cacheKey = `${head.endpoint}:${head.key}`;
  // Every region (including the winner's) MUST resolve its cache
  // entry to the winning runId. Idempotent if the region already
  // pointed there.
  const cacheRedirects = sorted.map((c) => ({
    region: c.region,
    cacheKey,
    redirectToRunId: winner.runId,
  }));

  return {
    winner,
    losers,
    cacheRedirects,
    loserCancelReason: 'cross_region_dedup_loss',
  };
}

/**
 * Construct the canonical metric label tuple for the
 * `openwop.idempotency.cross_region_conflicts_total` counter per
 * `idempotency.md` §"Operator surface". Used by the operator's
 * metrics emission layer; this module does NOT touch any metric
 * runtime directly (kept SDK-free per the host's zero-runtime-deps
 * convention).
 */
export function crossRegionConflictLabels(
  result: ConvergenceResult,
): { tenant: string; route: string; regionPair: string } {
  const tenant = result.winner.tenantId;
  const route = result.winner.endpoint;
  // Region pair MUST be deterministic — sort lexicographically so
  // `(us-east-1, eu-west-1)` and `(eu-west-1, us-east-1)` produce
  // the same label, allowing operators to aggregate symmetrically.
  const regions = [result.winner.region, ...result.losers.map((l) => l.region)]
    .sort()
    .join('|');
  return { tenant, route, regionPair: regions };
}

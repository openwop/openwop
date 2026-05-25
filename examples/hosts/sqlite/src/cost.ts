/**
 * RFC 0026 cost attribution (sample-grade, in-process).
 *
 * Mirrors the reference workflow-engine's `observability/costEmitter.ts`:
 * an allowlist sanitizer + a per-run rollup that surfaces on
 * `RunSnapshot.metrics.openwopCost` (`run-snapshot.schema.json`). Real
 * deployers wire the rollup to their billing pipeline; the SQLite
 * reference keeps it process-local.
 *
 * The allowlist is the canonical set from `spec/v1/observability.md
 * §"Cost attribution attributes"`. Non-allowlisted keys — including
 * credential-shaped values smuggled under unfamiliar names — are dropped
 * before they reach a span or the rollup (the
 * `cost-attribution-allowlist-redaction` SECURITY invariant).
 */

/** Canonical `openwop.cost.*` attribute names. Mutating this list is a
 *  wire-shape change (needs an RFC). */
export const OPENWOP_COST_ATTRIBUTE_NAMES: readonly string[] = [
  'openwop.cost.tokens.input',
  'openwop.cost.tokens.output',
  'openwop.cost.tokens.total',
  'openwop.cost.usd',
  'openwop.cost.currency',
  'openwop.cost.estimated',
  'openwop.cost.provider',
];

const ALLOW = new Set<string>(OPENWOP_COST_ATTRIBUTE_NAMES);

/** Keep only allowlisted, primitive-typed attributes. Pure function. */
export function sanitizeCostAttrs(attrs: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!ALLOW.has(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** Per-run rollup shape — mirrors `run-snapshot.schema.json
 *  §metrics.openwopCost`. */
export interface CostRollup {
  usd?: number;
  tokens?: { input?: number; output?: number };
  provider?: string;
}

const runCostRollups = new Map<string, CostRollup>();

/** Fold a sanitized cost-attr map into the per-run rollup. Accumulates
 *  numeric usd/tokens; last-write-wins for `provider` (per the schema's
 *  description). Folds only the subset the snapshot schema declares —
 *  `tokens.total` / `currency` / `estimated` are span-only. */
export function applyCostRollup(runId: string, sanitized: Record<string, string | number | boolean>): void {
  if (!runId) return;
  const cur = runCostRollups.get(runId) ?? {};
  for (const [k, v] of Object.entries(sanitized)) {
    if (k === 'openwop.cost.usd' && typeof v === 'number') {
      cur.usd = (cur.usd ?? 0) + v;
    } else if (k === 'openwop.cost.tokens.input' && typeof v === 'number') {
      cur.tokens = cur.tokens ?? {};
      cur.tokens.input = (cur.tokens.input ?? 0) + v;
    } else if (k === 'openwop.cost.tokens.output' && typeof v === 'number') {
      cur.tokens = cur.tokens ?? {};
      cur.tokens.output = (cur.tokens.output ?? 0) + v;
    } else if (k === 'openwop.cost.provider' && typeof v === 'string') {
      cur.provider = v;
    }
  }
  runCostRollups.set(runId, cur);
}

/** Returns the run's rollup, or `null` when no cost was recorded (the
 *  snapshot then omits `metrics.openwopCost` entirely — spec-allowed). */
export function snapshotCostRollup(runId: string): CostRollup | null {
  return runCostRollups.get(runId) ?? null;
}

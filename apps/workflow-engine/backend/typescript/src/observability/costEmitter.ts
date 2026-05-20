/**
 * Cost emitter. Records per-node + per-run cost attributes onto the
 * active OTel span under the `openwop.cost.*` namespace.
 *
 * Sample-grade: stores totals in-process (no metering integration).
 * Real deployers wire to their billing pipeline (Stripe usage records,
 * BigQuery, etc.).
 *
 * Allowlist enforcement (`spec/v1/observability.md §"Cost attribution
 * attributes"`): when a caller passes arbitrary record fields, only
 * attribute names in `OPENWOP_COST_ATTRIBUTE_NAMES` are forwarded to the
 * span. Non-allowlisted keys — including credential-shaped values
 * smuggled under unfamiliar key names — are dropped. The sanitizer is a
 * pure function (`sanitizeCostForOtel`) so it can be unit-tested
 * independent of the OTel runtime, and the conformance suite asserts
 * against it end-to-end via the in-suite OTel collector.
 */

import { trace } from '@opentelemetry/api';
import {
  OPENWOP_COST_ATTRIBUTE_NAMES as SDK_OPENWOP_COST_ATTRIBUTE_NAMES,
  sanitizeCostAttributes,
} from '@openwop/openwop';

/** Canonical allowlist of cost-attribute names per
 *  `spec/v1/observability.md §"Cost attribution attributes"`.
 *  Re-exported from the published SDK (`@openwop/openwop`) so the
 *  host runtime + the conformance suite + downstream packs share one
 *  source of truth. Mutating this list is a wire-shape change — needs
 *  an RFC. */
export const OPENWOP_COST_ATTRIBUTE_NAMES: readonly string[] = SDK_OPENWOP_COST_ATTRIBUTE_NAMES;

/** Pure-function sanitizer. Thin re-export of the SDK helper so host
 *  code keeps its existing import surface stable. */
export const sanitizeCostForOtel = sanitizeCostAttributes;

interface CostRecord {
  promptTokens?: number;
  completionTokens?: number;
  usdCost?: number;
  provider?: string;
  model?: string;
}

/** Back-compat shim for callers that pre-date the allowlist refactor
 *  (`aiProvidersHost.ts` still calls `emitCost` with the typed record).
 *  Maps the legacy field names onto the canonical attribute names and
 *  routes through the sanitizer. */
export function emitCost(record: CostRecord): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  const mapped: Record<string, unknown> = {};
  if (record.promptTokens != null) mapped['openwop.cost.tokens.input'] = record.promptTokens;
  if (record.completionTokens != null) mapped['openwop.cost.tokens.output'] = record.completionTokens;
  if (record.usdCost != null) mapped['openwop.cost.usd'] = record.usdCost;
  if (record.provider) mapped['openwop.cost.provider'] = record.provider;
  if (record.model) {
    // `model` is NOT in the cost allowlist — it's an AI-namespace
    // attribute. Emit it directly under `openwop.ai.model` so existing
    // dashboards keep working; it bypasses the cost sanitizer because
    // the allowlist is scoped to `openwop.cost.*` only.
    span.setAttribute('openwop.ai.model', record.model);
  }
  for (const [k, v] of Object.entries(sanitizeCostForOtel(mapped))) {
    span.setAttribute(k, v);
  }
}

/** Conformance-only entry point. Accepts an open-shape attribute map
 *  (typically driven by a fixture node — see `conformance.cost.emit`
 *  registered in `bootstrap/nodes.ts`) and writes ONLY the
 *  allowlisted, primitive-typed attributes onto the active span.
 *  Non-allowlisted keys are silently dropped per
 *  `spec/v1/observability.md §"Cost attribution attributes"` and the
 *  `cost-attribution-allowlist-redaction` SECURITY invariant. */
export function emitRawCostAttrs(attrs: Record<string, unknown>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [k, v] of Object.entries(sanitizeCostForOtel(attrs))) {
    span.setAttribute(k, v);
  }
}

/** Per-run rollup keyed by runId. Process-local; same posture as the
 *  variables runtime (`host/variablesRuntime.ts`). Shape mirrors
 *  `schemas/run-snapshot.schema.json §metrics.openwopCost` — populated
 *  lazily as nodes emit cost attrs. Multi-provider runs report the
 *  LAST contributing call's `provider` / `model` per the schema. */
export interface CostRollup {
  usd?: number;
  tokens?: { input?: number; output?: number };
  model?: string;
  provider?: string;
  duration_ms?: number;
}
const runCostRollups = new Map<string, CostRollup>();

/** Apply a sanitized cost-attr map to the per-run rollup. Accumulates
 *  numeric tokens / usd / duration; overwrites string `provider` /
 *  `model` (last-write-wins per the schema's `description`).
 *
 *  Folds only the SUBSET of allowlisted keys that
 *  `run-snapshot.schema.json §metrics.openwopCost` declares: `usd`,
 *  `tokens.{input,output}`, `provider`, `model`, `duration_ms`.
 *  Deliberate omissions:
 *    - `openwop.cost.tokens.total` — derivable from input+output; the
 *      schema's `tokens` object only carries the two primitives.
 *    - `openwop.cost.currency` / `openwop.cost.estimated` — span-only
 *      attributes; the snapshot rollup omits them (clients that need
 *      them read OTel spans directly per the schema's `description`).
 *
 *  The sanitizer (`sanitizeCostForOtel`) accepts all seven allowlisted
 *  keys for span emission; the rollup folds the documented subset.
 *  The two surfaces are intentionally not 1:1. */
export function applyCostRollup(runId: string, sanitized: Record<string, number | string | boolean>): void {
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
    // tokens.total / currency / estimated intentionally not folded —
    // see header docblock for the snapshot-vs-span surface split.
  }
  runCostRollups.set(runId, cur);
}

/** Snapshot for the run-snapshot projection. Returns `null` when no
 *  cost has been recorded — projectRunSnapshot then omits the field
 *  entirely (spec-allowed per `run-snapshot.schema.json §metrics`). */
export function snapshotCostRollup(runId: string): CostRollup | null {
  return runCostRollups.get(runId) ?? null;
}

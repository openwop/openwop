/**
 * Shared helpers for the RFC 0084 `budget` conformance scenarios. Lives in lib/
 * (not a `*.test.ts`) so scenarios import it via `../lib/budgetPolicy.js`.
 *
 * Budget enforcement is a BEHAVIOR over the RFC 0026 `provider.usage` stream
 * (consumption is tracked OFF `provider.usage` — no double-counting). It is
 * driven through the host-sample budget seam (`POST /v1/host/sample/budget/run`):
 * a run with a `configurable.budget` policy accrues spend, emits the four
 * content-free `budget.*` events, and on a hard dimension's exhaustion reuses
 * `cap.breached { kind: "budget-*" }` → `run.failed { error: "budget_exhausted" }`
 * (the §D enforcement). A model that violates `modelDeny`/`modelAllow` is refused
 * with `budget_model_denied` BEFORE the provider call (§D model policy). The seam
 * is OPTIONAL — scenarios soft-skip on 404/501.
 *
 * Gating uses the `budget.supported` (+ `enforce`) capability flag from the live
 * discovery doc (root-first per RFC 0073).
 *
 * @see RFCS/0084-budget-quota-and-cost-policy.md
 * @see spec/v1/budget-policy.md
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `budget` from discovery (root-first per RFC 0073); null when unadvertised. */
export async function readBudgetCap(): Promise<Record<string, unknown> | null> {
  const b = await readCapabilityFamily<Record<string, unknown>>('budget');
  return b && typeof b === 'object' ? b : null;
}

export interface BudgetRunResult {
  runId?: string;
  outcome?: string;
  /** Set by the `model-denied` seam leg when the host refused before the call. */
  error?: string;
  modelCalled?: boolean;
  [k: string]: unknown;
}

/**
 * Drive one budget-policy run through the host-sample seam (RFC 0084 §C/§D).
 * `scenario`:
 *   - `hard-cost-exhaust`  — `enforce:"hard"`, `dimensions:["cost"]`; accrue to
 *     exhaustion: reserved → consumed → threshold.crossed(80%) → exhausted →
 *     cap.breached{budget-cost} → run.failed{budget_exhausted}.
 *   - `model-denied`       — a model violating `modelDeny`/`modelAllow`; MUST be
 *     refused `budget_model_denied` BEFORE the provider call.
 *   - `advisory`           — `enforce:"advisory"`; emits the budget.* events but
 *     MUST NOT stop the run.
 * Returns null when the seam is unwired (404/501).
 */
export async function driveBudgetRun(
  body: { scenario: 'hard-cost-exhaust' | 'model-denied' | 'advisory' },
): Promise<BudgetRunResult | null> {
  const res = await driver.post('/v1/host/sample/budget/run', body);
  if (res.status === 404 || res.status === 501) return null;
  return (res.json as BudgetRunResult | undefined) ?? {};
}

/** The closed budget `cap.breached` kinds (RFC 0084 §D). */
export const BUDGET_CAP_KINDS = ['budget-tokens', 'budget-cost', 'budget-tool-calls', 'budget-retries'];
/** Content keys a `budget.*` payload MUST NEVER carry (SR-1 / `budget-no-pricing-leak`):
 *  no provider pricing tables, per-token rates, or cost-model internals. */
export const BUDGET_CONTENT_FORBIDDEN = ['pricing', 'priceTable', 'prices', 'rate', 'rates', 'unitPrice', 'costModel', 'tokenPrice', 'secret', 'apiKey'];

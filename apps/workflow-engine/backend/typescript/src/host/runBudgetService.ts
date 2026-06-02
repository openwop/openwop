/**
 * Autonomous-run budget guardrail.
 *
 * The scheduler + heartbeat daemons fire runs on their own — without a ceiling,
 * a misconfigured cadence or a large fleet could spawn runs (and model spend)
 * without bound. This caps autonomous runs per (tenant, rolling window) using a
 * storage-backed atomic counter, so the limit holds across the max-instance
 * fleet. Only the AUTONOMOUS daemons consult it — human-initiated runs ("Run
 * now", "Check now", kanban drags, POST /v1/runs) are never throttled here.
 *
 * Limit + window are env-configurable; `OPENWOP_AUTONOMOUS_RUN_LIMIT <= 0`
 * disables the cap (unlimited). Defaults: 120 runs / 1h / tenant.
 *
 * @see src/host/scheduleDaemon.ts, src/host/heartbeatService.ts — the consumers
 */

import type { Storage } from '../storage/storage.js';

export interface RunBudgetConfig {
  /** Max autonomous runs per tenant per window. <= 0 ⇒ unlimited. */
  limit: number;
  /** Rolling window length in ms. */
  windowMs: number;
}

function defaultConfig(): RunBudgetConfig {
  const limit = Number(process.env.OPENWOP_AUTONOMOUS_RUN_LIMIT);
  const windowMs = Number(process.env.OPENWOP_AUTONOMOUS_RUN_WINDOW_MS);
  return {
    limit: Number.isFinite(limit) ? limit : 120,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 3_600_000,
  };
}

export interface BudgetDecision {
  allowed: boolean;
  current: number;
  limit: number;
}

/**
 * Atomically consume one unit of `tenantId`'s autonomous-run budget for the
 * current window and decide whether the run may proceed. Consuming on every
 * check (including denials) is intentional: it keeps the decision a single
 * atomic write (no read-then-write race across instances); over-budget denials
 * just keep the counter climbing until the window rolls over.
 *
 * `cfg` overrides the env-derived config (tests pass it explicitly).
 */
export async function checkAutonomousRunBudget(
  storage: Storage,
  tenantId: string,
  now: number = Date.now(),
  cfg: RunBudgetConfig = defaultConfig(),
): Promise<BudgetDecision> {
  if (cfg.limit <= 0) return { allowed: true, current: 0, limit: cfg.limit }; // unlimited
  const windowStart = Math.floor(now / cfg.windowMs) * cfg.windowMs;
  const bucket = `${tenantId}:${windowStart}`;
  const current = await storage.consumeRunBudget(bucket, windowStart);
  return { allowed: current <= cfg.limit, current, limit: cfg.limit };
}

/** Best-effort prune of budget rows for windows older than the current one.
 *  Called opportunistically from the daemon ticks. */
export async function pruneRunBudget(
  storage: Storage,
  now: number = Date.now(),
  cfg: RunBudgetConfig = defaultConfig(),
): Promise<number> {
  if (cfg.limit <= 0) return 0;
  const currentWindowStart = Math.floor(now / cfg.windowMs) * cfg.windowMs;
  try {
    return await storage.pruneRunBudget(currentWindowStart);
  } catch {
    return 0;
  }
}

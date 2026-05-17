/**
 * In-process pub/sub for run-terminal notifications.
 *
 * Sites that need to know when a run reaches a terminal state
 * (`run.completed`, `run.failed`, `run.cancelled`) register via
 * `onRunTerminal(runId, fn)`. The executor's terminal-emission
 * paths call `notifyRunTerminal(runId)` exactly once per run.
 *
 * Used by the rate-limit middleware (P0.4) to release the
 * "concurrent runs" slot accurately, rather than relying on the
 * 60s TTL safety-net workaround called out in `rateLimit.ts`
 * header. Other subscribers can hang off the same hook for
 * cleanup / metrics / cache invalidation.
 *
 * Listeners auto-unsubscribe after firing — a run's terminal
 * event is fire-once. Re-registering on the same runId after a
 * fire is harmless but ignored (the runId is no longer tracked
 * once it fires).
 *
 * Pure in-process: a Cloud Run cold start drops every pending
 * subscriber. That's fine — the rate-limit state itself is also
 * per-process, so a cold start re-balances everything together.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function onRunTerminal(runId: string, fn: Listener): void {
  let s = listeners.get(runId);
  if (!s) { s = new Set(); listeners.set(runId, s); }
  s.add(fn);
}

export function notifyRunTerminal(runId: string): void {
  const s = listeners.get(runId);
  if (!s) return;
  listeners.delete(runId);
  for (const fn of s) {
    try { fn(); } catch { /* listener errors must not block other listeners */ }
  }
}

/** Test seam. */
export function _resetRunLifecycle(): void {
  listeners.clear();
}

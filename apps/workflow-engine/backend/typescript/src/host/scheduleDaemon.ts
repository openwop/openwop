/**
 * Background scheduler daemon (RFC 0052 §B) — fires durable scheduled jobs on
 * their wall-clock cadence.
 *
 * The durable job store (schedulingService.ts) carries a `nextFireAt` epoch-ms
 * computed from each job's `cronExpr` (+ `timezone`) by cronSchedule.ts. This
 * daemon polls for jobs whose `nextFireAt` is due and starts their workflow via
 * the shared run-starter — the same recipe the "Run now" trigger uses, so
 * replay/fork/observability are inherited.
 *
 * MULTI-INSTANCE FIRE-ONCE: the app scales to max=10 instances, each running
 * this poll loop. A naive loop would fire each due job up to 10×. We guard every
 * fire with `storage.claimIdempotency(key)` — an atomic insert-if-absent where
 * exactly one concurrent caller gets `claimed: true` (Postgres
 * `INSERT … ON CONFLICT DO NOTHING RETURNING`; a single write txn on sqlite).
 * The key is `(jobId, nextFireAt-slot)`, so the job fires exactly once per slot
 * across the whole fleet; the losers skip and re-read the advanced `nextFireAt`
 * on their next poll. This mirrors how runDispatchSweeper / webhookDeliveryWorker
 * lease their work per-row rather than electing a leader.
 *
 * MISSED-WINDOW: when the daemon (or the whole fleet) was down, a job's
 * `nextFireAt` is in the past. It fires once now and `markJobFired` advances
 * `nextFireAt` to the next FUTURE slot — collapsing the backlog to a single
 * recovery run (§B.4), never N.
 *
 * `processDueSchedules` is exported for deterministic tests (pass a fixed
 * `now`); `startScheduleDaemon` runs it on a slow poll for the live server.
 *
 * @see src/host/runDispatchSweeper.ts — the daemon pattern this follows
 * @see src/host/runStarter.ts — the shared run dispatch
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 */

import type { StartRunDeps } from './runStarter.js';
import { startWorkflowRun } from './runStarter.js';
import { listJobs, markJobFired, recordJobRun, currentTick } from './schedulingService.js';
import { checkAutonomousRunBudget, pruneRunBudget } from './runBudgetService.js';
import { getInstanceId } from './instanceId.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('scheduleDaemon');

/** Poll cadence. Schedules align to minute boundaries, so a sub-minute poll
 *  keeps fire latency well under one cadence step. */
const POLL_INTERVAL_MS = 30_000;
/** Most jobs fired per pass — a backstop against a misconfiguration flooding
 *  the dispatcher; remaining due jobs fire on the next tick. */
const FIRE_BATCH = 50;
/** Per-(job, slot) claim keys are only needed for the brief concurrent-poll
 *  window; prune ones older than this each tick so the idempotency table stays
 *  bounded (an hourly job would otherwise leave a permanent row per fire). */
const CLAIM_KEY_PREFIX = 'schedule-fire:';
const CLAIM_PRUNE_AGE_MS = 10 * 60_000;

/**
 * Fire every due scheduled job exactly once across the fleet. Returns the number
 * of runs this instance started (0 when nothing was due or every due job was
 * claimed by another instance). Exported for deterministic tests — pass a fixed
 * `now`; the running daemon passes `Date.now()`.
 */
export async function processDueSchedules(
  deps: StartRunDeps,
  now: number = Date.now(),
): Promise<number> {
  // Scan every tenant's jobs (the store has no cross-tenant "due" query — same
  // prefix-scan posture as the rest of the host-ext surfaces).
  const due = (await listJobs())
    .filter((j) => j.enabled && j.workflowId && typeof j.nextFireAt === 'number' && j.nextFireAt <= now)
    .sort((a, b) => (a.nextFireAt ?? 0) - (b.nextFireAt ?? 0))
    .slice(0, FIRE_BATCH);

  let fired = 0;
  for (const job of due) {
    const slot = job.nextFireAt!;
    const claimKey = `${CLAIM_KEY_PREFIX}${job.jobId}:${slot}`;
    const claim = await deps.storage.claimIdempotency(claimKey, new Date(now).toISOString());
    if (!claim.claimed) {
      // Another instance is firing (or already fired) this slot — skip. We'll
      // see the advanced nextFireAt once the winner's markJobFired lands.
      continue;
    }
    // Advance nextFireAt to the next slot BEFORE dispatching. The claim row is
    // permanent, so if we advanced only after dispatch, a crash in between would
    // leave the slot perpetually due AND un-claimable → a permanently wedged
    // schedule. Advancing first means a crash loses at most one fire; the next
    // poll sees a future nextFireAt and carries on. Cross-instance dedup still
    // holds: a racing instance advances to the same value (idempotent) and the
    // claim already serialized the single fire.
    await markJobFired(job.jobId, currentTick(), undefined, now);
    // Autonomous-run budget: drop (don't queue) a fire that would exceed the
    // tenant's window ceiling. nextFireAt already advanced, so the schedule just
    // skips this slot and resumes next window — it cannot run away on cost.
    const budget = await checkAutonomousRunBudget(deps.storage, job.tenantId, now);
    if (!budget.allowed) {
      log.warn('schedule fire dropped — tenant over autonomous-run budget', {
        jobId: job.jobId, tenantId: job.tenantId, current: budget.current, limit: budget.limit,
      });
      continue;
    }
    try {
      const runId = await startWorkflowRun(deps, {
        tenantId: job.tenantId,
        workflowId: job.workflowId!,
        metadata: {
          schedule: {
            jobId: job.jobId,
            source: 'schedule',
            ...(job.rosterId !== undefined ? { rosterId: job.rosterId } : {}),
            ...(job.agentId !== undefined ? { agentId: job.agentId } : {}),
          },
        },
      });
      if (runId) {
        await recordJobRun(job.jobId, runId, now);
        fired++;
        log.info('schedule fired', { jobId: job.jobId, workflowId: job.workflowId, runId, slot });
      } else {
        log.warn('schedule due but workflow did not resolve — advanced past slot', {
          jobId: job.jobId,
          workflowId: job.workflowId,
          slot,
        });
      }
    } catch (err) {
      // nextFireAt already advanced above, so a dispatch error can't wedge the
      // schedule; just log for triage.
      log.error('schedule fire failed', {
        jobId: job.jobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return fired;
}

/** Delete this daemon's stale per-(job, slot) claim keys so the idempotency
 *  table stays bounded. Best-effort: a prune failure must not fail the tick. */
export async function pruneStaleScheduleClaims(deps: StartRunDeps, now: number = Date.now()): Promise<number> {
  try {
    return await deps.storage.pruneIdempotencyByPrefix(CLAIM_KEY_PREFIX, new Date(now - CLAIM_PRUNE_AGE_MS).toISOString());
  } catch (err) {
    log.warn('schedule claim prune failed', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

export interface ScheduleDaemon {
  stop(): void;
}

/**
 * Start the polling scheduler daemon for the running server. One pass at a time
 * (a slow pass never overlaps the next tick). Returns a handle whose `stop()`
 * clears the timer (call on graceful shutdown).
 */
export function startScheduleDaemon(deps: StartRunDeps): ScheduleDaemon {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await processDueSchedules(deps);
      await pruneStaleScheduleClaims(deps);
      await pruneRunBudget(deps.storage);
    } catch (err) {
      log.warn('schedule daemon tick error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  log.info('schedule daemon started', { pollIntervalMs: POLL_INTERVAL_MS, instanceId: getInstanceId() });
  return { stop: () => clearInterval(timer) };
}

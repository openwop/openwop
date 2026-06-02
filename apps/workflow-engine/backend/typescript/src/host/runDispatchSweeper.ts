/**
 * Multi-instance run-dispatch crash-recovery sweeper.
 *
 * Every dispatch path funnels through `executor.executeRun`, which stamps a
 * dispatch lease (`setRunDispatchLease`) on the run for this instance. The lease
 * outlives the maximum legal runtime (`RUN_DISPATCH_LEASE_MS`), so an alive run
 * is never re-dispatched.
 *
 * When an instance crashes mid-run, the run is left `pending`/`running` with a
 * lease that eventually expires. This sweeper claims those orphans
 * (`claimOrphanedRuns` — atomic, multi-instance-safe) and re-dispatches them via
 * `executeRun`, which is idempotent against the Layer-2 invocation log (completed
 * nodes replay from cache rather than re-executing). A `createdAt` grace window
 * ensures freshly-dispatched runs are never raced by the sweep; `waiting-*` and
 * terminal runs are excluded by status (they are not stuck — they are parked or
 * done).
 *
 * `sweepOrphanedRuns` is exported so tests can drive one pass deterministically;
 * `startRunDispatchSweeper` runs it on a slow poll for the live server.
 */

import type { Storage } from '../storage/storage.js';
import type { HostAdapterSuite } from './index.js';
import { executeRun, RUN_DISPATCH_LEASE_MS } from '../executor/executor.js';
import { getInstanceId } from './instanceId.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('runDispatchSweeper');

/** Runs younger than this are never swept (avoids racing a fresh dispatch). */
const GRACE_MS = 120_000;
/** Orphans re-claimed per pass. */
const CLAIM_BATCH = 10;
/** Poll cadence. Crash recovery isn't latency-critical — a slow sweep is fine. */
const POLL_INTERVAL_MS = 30_000;

export interface RunSweeperDeps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
}

/**
 * Claim and re-dispatch one batch of orphaned runs. Returns the number
 * re-dispatched (0 when none are orphaned). Exported for deterministic tests —
 * pass a fixed `now`; the running sweeper passes `Date.now()`.
 */
export async function sweepOrphanedRuns(
  deps: RunSweeperDeps,
  workerId: string,
  now: number = Date.now(),
): Promise<number> {
  const { storage, hostSuite } = deps;
  const staleBeforeIso = new Date(now - GRACE_MS).toISOString();
  const orphans = await storage.claimOrphanedRuns(workerId, now, staleBeforeIso, RUN_DISPATCH_LEASE_MS, CLAIM_BATCH);
  let redispatched = 0;
  for (const run of orphans) {
    const wf = await hostSuite.workflowCatalog.getWorkflow(run.workflowId);
    if (!wf) {
      log.warn('orphan run workflow not found — skipping re-dispatch', { runId: run.runId, workflowId: run.workflowId });
      continue;
    }
    log.warn('re-dispatching orphaned run (owning instance presumed crashed)', {
      runId: run.runId,
      status: run.status,
      previousOwner: run.dispatchOwner ?? null,
    });
    redispatched++;
    setImmediate(() => {
      executeRun(storage, run, wf.definition, { policyResolver: hostSuite.providerPolicyResolver }).catch((err) => {
        log.error('orphan run re-dispatch failed', { runId: run.runId, error: err instanceof Error ? err.message : String(err) });
      });
    });
  }
  return redispatched;
}

export interface RunDispatchSweeper {
  stop(): void;
}

/**
 * Start the polling sweeper for the running server. One pass at a time (a slow
 * pass never overlaps the next tick). Returns a handle whose `stop()` clears the
 * timer (call on graceful shutdown).
 */
export function startRunDispatchSweeper(deps: RunSweeperDeps, workerId: string = getInstanceId()): RunDispatchSweeper {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await sweepOrphanedRuns(deps, workerId);
    } catch (err) {
      log.warn('run dispatch sweeper tick error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  log.info('run dispatch sweeper started', { workerId, pollIntervalMs: POLL_INTERVAL_MS });
  return { stop: () => clearInterval(timer) };
}

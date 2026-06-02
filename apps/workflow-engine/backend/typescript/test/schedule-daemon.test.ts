/**
 * Background scheduler daemon (host/scheduleDaemon.ts) — wall-clock firing.
 *
 *   - a due job fires once and advances nextFireAt to a future slot
 *   - a job whose nextFireAt is in the future does not fire
 *   - a disabled job does not fire
 *   - MULTI-INSTANCE: two concurrent passes over the same due slot fire exactly
 *     once (claimIdempotency dedup)
 *   - MISSED-WINDOW: a long-stale job fires ONCE on recovery, not once per
 *     missed slot, and lands a future nextFireAt (RFC 0052 §B.4)
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStorage } from '../src/storage/index.js';
import type { Storage } from '../src/storage/storage.js';
import type { StartRunDeps } from '../src/host/runStarter.js';
import { initHostExtPersistence, __resetHostExtPersistence } from '../src/host/hostExtPersistence.js';
import { registerJob, setJobEnabled, getJob, resetScheduling } from '../src/host/schedulingService.js';
import { processDueSchedules, pruneStaleScheduleClaims } from '../src/host/scheduleDaemon.js';

// Empty-node workflow → executeRun completes immediately; we only assert the
// run row is inserted (startWorkflowRun awaits insertRun before dispatch).
// Fully typed against the narrowed StartRunDeps['hostSuite'] — no cast.
const hostSuite: StartRunDeps['hostSuite'] = {
  workflowCatalog: { getWorkflow: async (id) => ({ workflowId: id, definition: { workflowId: id, nodes: [] } }) },
  providerPolicyResolver: { resolveForRun: async () => [] },
};

const T0 = Date.parse('2026-06-02T10:15:00Z'); // anchor; hourly → next slot 11:00Z
const SLOT = Date.parse('2026-06-02T11:00:00Z');

let storage: Storage;
let deps: StartRunDeps;

beforeEach(async () => {
  storage = await openStorage('memory://');
  initHostExtPersistence(storage);
  await resetScheduling();
  deps = { storage, hostSuite };
});
afterEach(() => {
  __resetHostExtPersistence();
});

/** Runs whose metadata.schedule names the given job. */
async function scheduleRunsFor(jobId: string) {
  const runs = await storage.listRuns({ limit: 100 });
  return runs.filter((r) => {
    const block = (r.metadata as Record<string, unknown>)?.schedule as Record<string, unknown> | undefined;
    return block?.jobId === jobId;
  });
}

describe('scheduleDaemon — wall-clock firing', () => {
  it('fires a due job once and advances nextFireAt to a future slot', async () => {
    await registerJob({ jobId: 'j1', tenantId: 't1', cronExpr: '0 * * * *', workflowId: 'wf-1', timezone: 'UTC' }, T0);
    expect((await getJob('j1'))?.nextFireAt).toBe(SLOT);

    const now = SLOT + 30_000;
    expect(await processDueSchedules(deps, now)).toBe(1);

    const runs = await scheduleRunsFor('j1');
    expect(runs).toHaveLength(1);

    const job = await getJob('j1');
    expect(job?.nextFireAt).toBeGreaterThan(now); // advanced to the next hour
    expect(job?.lastRunId).toBe(runs[0]!.runId);
  });

  it('does not fire a job whose nextFireAt is still in the future', async () => {
    await registerJob({ jobId: 'j2', tenantId: 't1', cronExpr: '0 * * * *', workflowId: 'wf-1', timezone: 'UTC' }, T0);
    // now is before the 11:00 slot
    expect(await processDueSchedules(deps, SLOT - 60_000)).toBe(0);
    expect(await scheduleRunsFor('j2')).toHaveLength(0);
  });

  it('does not fire a disabled job', async () => {
    await registerJob({ jobId: 'j3', tenantId: 't1', cronExpr: '0 * * * *', workflowId: 'wf-1', timezone: 'UTC' }, T0);
    await setJobEnabled('j3', false);
    expect(await processDueSchedules(deps, SLOT + 30_000)).toBe(0);
    expect(await scheduleRunsFor('j3')).toHaveLength(0);
  });

  it('does not fire a job with no workflow bound', async () => {
    await registerJob({ jobId: 'j4', tenantId: 't1', cronExpr: '0 * * * *', timezone: 'UTC' }, T0);
    expect(await processDueSchedules(deps, SLOT + 30_000)).toBe(0);
  });

  it('fires exactly once across two concurrent instances (claim dedup)', async () => {
    await registerJob({ jobId: 'j5', tenantId: 't1', cronExpr: '0 * * * *', workflowId: 'wf-1', timezone: 'UTC' }, T0);
    const now = SLOT + 30_000;
    const [a, b] = await Promise.all([processDueSchedules(deps, now), processDueSchedules(deps, now)]);
    expect(a + b).toBe(1); // one instance won the slot claim
    expect(await scheduleRunsFor('j5')).toHaveLength(1);
  });

  it('advances nextFireAt BEFORE dispatch — a dispatch error cannot wedge the schedule', async () => {
    // A hostSuite whose catalog throws makes startWorkflowRun reject inside the
    // fire. The wedge bug would leave nextFireAt on the due slot (claimed +
    // un-advanced ⇒ never fires again). Advance-first must move it forward anyway.
    const throwingDeps: StartRunDeps = {
      storage,
      hostSuite: {
        workflowCatalog: { getWorkflow: async () => { throw new Error('catalog down'); } },
        providerPolicyResolver: { resolveForRun: async () => [] },
      },
    };
    await registerJob({ jobId: 'jx', tenantId: 't1', cronExpr: '0 * * * *', workflowId: 'wf-1', timezone: 'UTC' }, T0);
    const before = (await getJob('jx'))!.nextFireAt!;
    const now = SLOT + 30_000;
    await processDueSchedules(throwingDeps, now);
    const after = (await getJob('jx'))!.nextFireAt!;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(now); // future slot — not wedged on the due one
  });

  it('pruneStaleScheduleClaims deletes only stale schedule-fire claim rows', async () => {
    const now = Date.parse('2026-06-02T12:00:00Z');
    const stale = new Date(now - 20 * 60_000).toISOString(); // older than the 10m window
    const fresh = new Date(now).toISOString();
    await storage.claimIdempotency('schedule-fire:j:1', stale);
    await storage.claimIdempotency('schedule-fire:j:2', fresh);
    await storage.claimIdempotency('other-key:keep', stale); // wrong prefix — untouched

    expect(await pruneStaleScheduleClaims(deps, now)).toBe(1);
    // The stale schedule-fire key is gone (re-claimable); the fresh one and the
    // unrelated key remain (re-claim returns claimed:false).
    expect((await storage.claimIdempotency('schedule-fire:j:1', fresh)).claimed).toBe(true);
    expect((await storage.claimIdempotency('schedule-fire:j:2', fresh)).claimed).toBe(false);
    expect((await storage.claimIdempotency('other-key:keep', fresh)).claimed).toBe(false);
  });

  it('missed-window: a long-stale job fires ONCE on recovery with a future slot', async () => {
    // Register a week in the past so nextFireAt is far behind "now" — a week of
    // hourly slots was missed. Recovery must collapse to ONE run.
    const weekAgo = Date.parse('2026-05-26T10:15:00Z');
    await registerJob({ jobId: 'j6', tenantId: 't1', cronExpr: '0 * * * *', workflowId: 'wf-1', timezone: 'UTC' }, weekAgo);
    const now = Date.parse('2026-06-02T11:05:00Z');
    expect(await processDueSchedules(deps, now)).toBe(1);
    expect(await scheduleRunsFor('j6')).toHaveLength(1); // not ~168
    expect((await getJob('j6'))?.nextFireAt).toBeGreaterThan(now);
  });
});

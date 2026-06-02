/**
 * Autonomous-run budget guardrail (host/runBudgetService.ts) +
 * its enforcement in the scheduler daemon.
 *
 *   - allows runs up to the limit, denies past it (atomic counter)
 *   - per-tenant isolation; window rollover resets the count
 *   - limit <= 0 ⇒ unlimited
 *   - scheduleDaemon drops over-budget fires but still advances nextFireAt
 *     (the schedule resumes next window — it cannot run away)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStorage } from '../src/storage/index.js';
import type { Storage } from '../src/storage/storage.js';
import type { StartRunDeps } from '../src/host/runStarter.js';
import { initHostExtPersistence, __resetHostExtPersistence } from '../src/host/hostExtPersistence.js';
import { registerJob, getJob, resetScheduling } from '../src/host/schedulingService.js';
import { processDueSchedules } from '../src/host/scheduleDaemon.js';
import { checkAutonomousRunBudget, type RunBudgetConfig } from '../src/host/runBudgetService.js';

const hostSuite: StartRunDeps['hostSuite'] = {
  workflowCatalog: { getWorkflow: async (id) => ({ workflowId: id, definition: { workflowId: id, nodes: [] } }) },
  providerPolicyResolver: { resolveForRun: async () => [] },
};
const CFG: RunBudgetConfig = { limit: 3, windowMs: 3_600_000 };

let storage: Storage;
let deps: StartRunDeps;
beforeEach(async () => {
  storage = await openStorage('memory://');
  initHostExtPersistence(storage);
  await resetScheduling();
  deps = { storage, hostSuite };
});
afterEach(() => __resetHostExtPersistence());

describe('checkAutonomousRunBudget', () => {
  it('allows up to the limit then denies', async () => {
    const now = Date.parse('2026-06-02T12:00:00Z');
    const r = [];
    for (let i = 0; i < 5; i++) r.push((await checkAutonomousRunBudget(storage, 't1', now, CFG)).allowed);
    expect(r).toEqual([true, true, true, false, false]); // 3 allowed, rest denied
  });

  it('is per-tenant', async () => {
    const now = Date.parse('2026-06-02T12:00:00Z');
    for (let i = 0; i < 3; i++) await checkAutonomousRunBudget(storage, 't1', now, CFG);
    expect((await checkAutonomousRunBudget(storage, 't1', now, CFG)).allowed).toBe(false);
    expect((await checkAutonomousRunBudget(storage, 't2', now, CFG)).allowed).toBe(true); // fresh tenant
  });

  it('resets when the window rolls over', async () => {
    const w1 = Date.parse('2026-06-02T12:00:00Z');
    for (let i = 0; i < 3; i++) await checkAutonomousRunBudget(storage, 't1', w1, CFG);
    expect((await checkAutonomousRunBudget(storage, 't1', w1, CFG)).allowed).toBe(false);
    const w2 = w1 + CFG.windowMs; // next window
    expect((await checkAutonomousRunBudget(storage, 't1', w2, CFG)).allowed).toBe(true);
  });

  it('limit <= 0 means unlimited (no counter touched)', async () => {
    const now = Date.parse('2026-06-02T12:00:00Z');
    for (let i = 0; i < 100; i++) {
      expect((await checkAutonomousRunBudget(storage, 't1', now, { limit: 0, windowMs: CFG.windowMs })).allowed).toBe(true);
    }
  });
});

describe('scheduleDaemon honors the run budget', () => {
  it('drops over-budget fires but keeps advancing nextFireAt', async () => {
    // Pre-consume the tenant's whole budget so the schedule's fire is denied.
    const now = Date.parse('2026-06-02T11:00:30Z');
    for (let i = 0; i < CFG.limit; i++) await checkAutonomousRunBudget(storage, 't1', now, CFG);

    await registerJob({ jobId: 'j', tenantId: 't1', cronExpr: '0 * * * *', workflowId: 'wf-1', timezone: 'UTC' },
      Date.parse('2026-06-02T10:15:00Z'));
    const before = (await getJob('j'))!.nextFireAt!;

    // Env limit defaults to 120, so the daemon's own check would allow it — but
    // the tenant is already at the CFG limit of 3 via the pre-consume above only
    // if the daemon uses the same default. Set the env limit to 3 for this pass.
    process.env.OPENWOP_AUTONOMOUS_RUN_LIMIT = '3';
    const fired = await processDueSchedules(deps, now);
    delete process.env.OPENWOP_AUTONOMOUS_RUN_LIMIT;

    expect(fired).toBe(0); // dropped — over budget
    const after = (await getJob('j'))!.nextFireAt!;
    expect(after).toBeGreaterThan(now); // advanced anyway — no wedge, resumes next window
    expect(after).toBeGreaterThan(before);
  });
});

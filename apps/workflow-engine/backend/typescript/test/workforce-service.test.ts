/**
 * Integration test for the Workforce host-ext service + demo seeding
 * (`src/host/workforceService.ts`) against an in-memory sqlite storage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import { initHostExtPersistence } from '../src/host/hostExtPersistence.js';
import {
  __clearWorkforces,
  aggregateWorkforceMetrics,
  getWorkforce,
  listWorkforces,
  seedWorkforceEntities,
  seedWorkforceHistory,
} from '../src/host/workforceService.js';
import type { Storage } from '../src/storage/storage.js';

const HERO = 'workforce.finance.invoice-exception';
const NOW = 1_700_000_000_000;

describe('workforceService', () => {
  let storage: Storage;

  beforeEach(async () => {
    storage = openSqliteStorage(':memory:');
    initHostExtPersistence(storage);
    await __clearWorkforces();
  });

  it('seeds the hero workforce entity idempotently', async () => {
    const first = await seedWorkforceEntities();
    expect(first).toBeGreaterThan(0);
    const second = await seedWorkforceEntities();
    expect(second).toBe(0); // already present

    const wf = await getWorkforce(HERO);
    expect(wf?.name).toBe('Invoice Exception Workforce');
    expect(wf?.agents.some((a) => a.role === 'supervisor')).toBe(true);
    expect((await listWorkforces()).length).toBeGreaterThan(0);
  });

  it('seeds history runs + event logs into the tenant', async () => {
    await seedWorkforceEntities();
    const res = await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 40 });
    expect(res.runs).toBe(40);

    const runs = await storage.listRuns({ tenantId: 'demo', limit: 1000 });
    const heroRuns = runs.filter(
      (r) => (r.metadata as { workforceId?: string }).workforceId === HERO,
    );
    expect(heroRuns.length).toBe(40);

    // every run has an event log starting with run.started
    const sample = heroRuns[0]!;
    const events = await storage.listEvents(sample.runId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.type).toBe('run.started');
    // appendEvent assigned monotone, strictly-increasing sequences
    for (let k = 1; k < events.length; k++) {
      expect(events[k]!.sequence).toBeGreaterThan(events[k - 1]!.sequence);
    }

    // the approval queue is non-empty (open runs at the head)
    const open = runs.filter((r) => r.status === 'waiting-approval');
    expect(open.length).toBeGreaterThan(0);
  });

  it('history seeding is idempotent per tenant', async () => {
    await seedWorkforceEntities();
    const a = await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 20 });
    expect(a.runs).toBe(20);
    const b = await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 20 });
    expect(b.runs).toBe(0); // already seeded for this tenant
  });

  it('does not write history when only entities are seeded (anon-safe path)', async () => {
    await seedWorkforceEntities();
    const runs = await storage.listRuns({ tenantId: 'anon:xyz', limit: 100 });
    expect(runs.length).toBe(0);
  });

  it('aggregates the 8 telemetry metrics from seeded runs (no event fan-out)', async () => {
    await seedWorkforceEntities();
    await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 300 });
    const runs = await storage.listRuns({ tenantId: 'demo', limit: 5000 });

    const m = aggregateWorkforceMetrics(runs, HERO);
    expect(m.totalRuns).toBe(300);
    expect(m.openApprovals).toBeGreaterThan(0);
    expect(m.terminalRuns).toBe(300 - m.openApprovals);
    expect(m.cycleTimeP50Ms).not.toBeNull();
    expect(m.costPerClearedUsd).toBeGreaterThan(0);
    expect(m.overrideRate).toBeGreaterThan(0);
    expect(m.escalationRate).toBeGreaterThan(0);

    // weekly override rate trends DOWN across the window (the graduation curve)
    const withApprovals = m.weekly.filter((w) => w.overrideRate > 0);
    expect(withApprovals.length).toBeGreaterThan(1);
    expect(m.weekly[0]!.overrideRate).toBeGreaterThan(m.weekly[m.weekly.length - 1]!.overrideRate);
  });

  it('scopes metrics to the requested workforce only', async () => {
    await seedWorkforceEntities();
    await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 20 });
    const runs = await storage.listRuns({ tenantId: 'demo', limit: 5000 });
    const other = aggregateWorkforceMetrics(runs, 'workforce.nonexistent');
    expect(other.totalRuns).toBe(0);
  });
});

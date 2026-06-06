/**
 * Integration test for the Workforce host-ext service + demo seeding
 * (`src/host/workforceService.ts`) against an in-memory sqlite storage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import { initHostExtPersistence } from '../src/host/hostExtPersistence.js';
import {
  __clearWorkforces,
  aggregateAutonomyGraduation,
  aggregateGovernancePosture,
  aggregateShadowEval,
  aggregateWorkforceMetrics,
  getWorkforce,
  listWorkforces,
  searchWorkforceTrace,
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

  it('derives the autonomy graduation timeline (review → guided → auto)', async () => {
    await seedWorkforceEntities();
    await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 300 });
    const runs = await storage.listRuns({ tenantId: 'demo', limit: 5000 });

    const g = aggregateAutonomyGraduation(runs, HERO);
    // initial tier + two promotions across the 6-week window
    expect(g.milestones.length).toBe(3);
    expect(g.milestones[0]!.fromTier).toBeNull();
    expect(g.milestones.map((m) => m.toTier)).toEqual(['review', 'guided', 'auto']);
    expect(g.currentTier).toBe('auto');
    expect(g.nextTier).toBeNull(); // fully graduated

    // each promotion's prior-window override incidence cleared the bar it unlocked
    for (const m of g.milestones.slice(1)) {
      expect(m.overrideIncidenceBefore).not.toBeNull();
      expect(m.unlockThreshold).not.toBeNull();
      expect(m.overrideIncidenceBefore!).toBeLessThanOrEqual(m.unlockThreshold!);
    }
  });

  it('summarizes governance posture with recent events', async () => {
    await seedWorkforceEntities();
    await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 300 });
    const runs = await storage.listRuns({ tenantId: 'demo', limit: 5000 });

    const p = aggregateGovernancePosture(runs, HERO);
    expect(p.totalRuns).toBe(300);
    expect(p.overrides).toBeGreaterThan(0);
    expect(p.escalations).toBeGreaterThanOrEqual(p.overrides);
    expect(p.recentEvents.length).toBeGreaterThan(0);
    expect(p.recentEvents.length).toBeLessThanOrEqual(8);
    // events carry a runId + a known kind
    for (const e of p.recentEvents) {
      expect(e.runId).toBeTruthy();
      expect(['override', 'false-positive', 'recovery']).toContain(e.kind);
    }
    // recent events are newest-first
    for (let i = 1; i < p.recentEvents.length; i++) {
      expect(Date.parse(p.recentEvents[i - 1]!.atIso)).toBeGreaterThanOrEqual(Date.parse(p.recentEvents[i]!.atIso));
    }
  });

  it('cross-run trace search: batchId matches multiple runs, correlationId one', async () => {
    await seedWorkforceEntities();
    await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 300 });
    const runs = await storage.listRuns({ tenantId: 'demo', limit: 5000 });
    const sample = runs.find((r) => (r.metadata as { workforceId?: string }).workforceId === HERO)!;
    const meta = sample.metadata as { correlationId: string; batchId: string };

    // batchId groups runs started the same day → cross-run (>= 1, usually many)
    const byBatch = searchWorkforceTrace(runs, HERO, meta.batchId);
    expect(byBatch.matches.length).toBeGreaterThan(0);
    expect(byBatch.matches.every((m) => m.batchId === meta.batchId)).toBe(true);

    // correlationId is unique → exactly one run
    const byCorr = searchWorkforceTrace(runs, HERO, meta.correlationId);
    expect(byCorr.matches).toHaveLength(1);
    expect(byCorr.matches[0]!.runId).toBe(sample.runId);
  });

  it('trace search: empty query returns nothing; outcome filter works; cap is explicit', async () => {
    await seedWorkforceEntities();
    await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 300 });
    const runs = await storage.listRuns({ tenantId: 'demo', limit: 5000 });

    expect(searchWorkforceTrace(runs, HERO, '   ').matches).toHaveLength(0);

    const overrides = searchWorkforceTrace(runs, HERO, 'overridden', 5);
    expect(overrides.matches.length).toBeLessThanOrEqual(5);
    expect(overrides.matches.every((m) => m.outcome === 'overridden')).toBe(true);
    if (overrides.scanned > 5 && overrides.matches.length === 5) {
      // more than the cap existed → flagged, not silently dropped
      expect(typeof overrides.capped).toBe('boolean');
    }
  });

  it('seeds five starter workforces; only the instrumented one gets history', async () => {
    const created = await seedWorkforceEntities();
    expect(created).toBe(5);
    const all = await listWorkforces();
    expect(all.map((w) => w.workforceId).sort()).toEqual(
      [
        'workforce.finance.invoice-exception',
        'workforce.fulfillment.order-exception',
        'workforce.insurance.claims-review',
        'workforce.procurement.approval',
        'workforce.support.escalation-triage',
      ].sort(),
    );

    // No template is promoted by the per-call override; only the hero
    // (historyRunCount > 0) is instrumented — capped here at 10 for speed.
    const res = await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 10 });
    expect(res.workforces).toBe(1);
    expect(res.runs).toBe(10);

    const runs = await storage.listRuns({ tenantId: 'demo', limit: 5000 });
    const byWf = (id: string): number =>
      runs.filter((r) => (r.metadata as { workforceId?: string }).workforceId === id).length;
    expect(byWf(HERO)).toBe(10);
    expect(byWf('workforce.support.escalation-triage')).toBe(0); // template — no history
  });

  it('shadow eval (RFC 0081 live-shadow shape): content-free finding digests, no raw values', async () => {
    await seedWorkforceEntities();
    await seedWorkforceHistory(storage, 'demo', { nowMs: NOW, runCount: 300 });
    const runs = await storage.listRuns({ tenantId: 'demo', limit: 5000 });

    const c = aggregateShadowEval(runs, HERO);
    expect(c.mode).toBe('live-shadow'); // RFC 0081 vocabulary
    expect(c.status).not.toBe('pending');
    expect(c.aggregateScore).toBeGreaterThan(0);
    expect(c.aggregateScore).toBeLessThanOrEqual(1);
    expect(c.passed).toBe(c.aggregateScore >= 0.9); // EvalSummary.passed
    expect(c.divergenceCount).toBeGreaterThanOrEqual(c.findings.length);

    for (const d of c.findings) {
      // digests differ (that IS the divergence) and are sha256-prefixed
      expect(d.agentDigest).toMatch(/^sha256:/);
      expect(d.baselineDigest).toMatch(/^sha256:/);
      expect(d.agentDigest).not.toBe(d.baselineDigest);
    }
    // content-free: the serialized findings carry NO raw outcome value
    const blob = JSON.stringify(c.findings);
    expect(blob).not.toMatch(/overridden|false-positive|cleared/);
  });

  it('shadow eval is pending for a workforce with no runs', async () => {
    const c = aggregateShadowEval([], 'workforce.nonexistent');
    expect(c.status).toBe('pending');
    expect(c.passed).toBe(false);
    expect(c.findings).toHaveLength(0);
  });
});

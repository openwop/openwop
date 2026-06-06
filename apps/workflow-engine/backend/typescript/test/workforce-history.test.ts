/**
 * Verifies the deterministic Workforce history generator
 * (`src/host/workforceHistory.ts`) against the replay.md determinism contract.
 */
import { describe, expect, it } from 'vitest';
import {
  generateWorkforceHistory,
  type RunOutcome,
  type WorkforceHistoryOptions,
} from '../src/host/workforceHistory.js';

const BASE: WorkforceHistoryOptions = {
  workforceId: 'workforce.finance.invoice-exception',
  tenantId: 'demo',
  workflowId: 'sample.agents.invoice-exception',
  seed: 'ep0-fixed-seed',
  epochMs: 1_700_000_000_000, // fixed logical epoch — never the wall clock
  runCount: 240,
  weeks: 6,
};

describe('generateWorkforceHistory', () => {
  it('is byte-identical across re-runs (replay.md §C determinism)', () => {
    const a = generateWorkforceHistory(BASE);
    const b = generateWorkforceHistory(BASE);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('emits the requested number of runs', () => {
    const h = generateWorkforceHistory(BASE);
    expect(h.runs).toHaveLength(240);
    expect(h.stats.total).toBe(240);
  });

  it('every event carries its own eventId + timestamp (fixed history, replay.md L112)', () => {
    const h = generateWorkforceHistory(BASE);
    for (const run of h.runs) {
      for (const e of run.events) {
        expect(e.eventId).toMatch(/^evt_/);
        expect(typeof e.timestamp).toBe('string');
        expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false);
        expect(e.runId).toBe(run.record.runId);
      }
      // first event is always run.started
      expect(run.events[0]?.type).toBe('run.started');
    }
  });

  it('event timestamps are monotonically non-decreasing within a run', () => {
    const h = generateWorkforceHistory(BASE);
    for (const run of h.runs) {
      let prev = 0;
      for (const e of run.events) {
        const t = Date.parse(e.timestamp);
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
    }
  });

  it('leaves a non-empty open-approval queue at the head of the timeline', () => {
    const h = generateWorkforceHistory(BASE);
    const open = h.runs.filter((r) => r.record.status === 'waiting-approval');
    expect(open.length).toBeGreaterThan(0);
    expect(h.stats.openApprovals).toBe(open.length);
    for (const r of open) {
      expect(r.events.some((e) => e.type === 'approval.requested')).toBe(true);
      expect(r.events.some((e) => e.type.startsWith('approval.granted'))).toBe(false);
    }
  });

  it('terminal runs are completed or failed and stamp completedAt', () => {
    const h = generateWorkforceHistory(BASE);
    for (const r of h.runs) {
      if (r.record.status === 'completed' || r.record.status === 'failed') {
        expect(r.record.completedAt).toBeTruthy();
      }
    }
  });

  it('override rate per run declines as the agent earns autonomy (the graduation curve)', () => {
    const h = generateWorkforceHistory(BASE);
    const third = Math.floor(h.runs.length / 3);
    // Per-run override rate (design: 8% → 4% → 2% across the 3 autonomy bands).
    // Measured per run, not conditioned on having an approval, so it tracks the
    // graduation curve robustly rather than amplifying small-sample noise.
    const overrideRate = (slice: typeof h.runs): number =>
      slice.filter((r) => r.events.some((e) => e.type === 'approval.overridden')).length /
      Math.max(slice.length, 1);
    const early = overrideRate(h.runs.slice(0, third));
    const late = overrideRate(h.runs.slice(2 * third));
    expect(early).toBeGreaterThan(late);
  });

  it('produces provider.usage cost events on every run for the telemetry dashboard', () => {
    const h = generateWorkforceHistory(BASE);
    for (const r of h.runs) {
      const usage = r.events.filter((e) => e.type === 'provider.usage');
      expect(usage.length).toBeGreaterThan(0);
      for (const u of usage) {
        const p = u.payload as { costEstimateUsd: number };
        expect(p.costEstimateUsd).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('aggregate outcome distribution is seed-independent (clean curve every deploy)', () => {
    const a = generateWorkforceHistory(BASE);
    const b = generateWorkforceHistory({ ...BASE, seed: 'a-different-seed' });
    const sig = (h: ReturnType<typeof generateWorkforceHistory>): string =>
      (Object.keys(h.stats.byOutcome) as RunOutcome[])
        .map((k) => `${k}:${h.stats.byOutcome[k]}`)
        .join(',');
    // Counts are allocated by construction, so they match across seeds...
    expect(sig(a)).toEqual(sig(b));
    // ...but the seed still varies placement + ids (so it's not a constant).
    const order = (h: ReturnType<typeof generateWorkforceHistory>): string =>
      h.runs.map((r) => r.record.metadata.outcome).join(',');
    expect(order(a)).not.toEqual(order(b));
    expect(a.runs[0]?.record.runId).not.toEqual(b.runs[0]?.record.runId);
  });
});

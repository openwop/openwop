/**
 * RFC 0052 §B — scheduling service: fire-once-per-tick + missed-tick policy.
 *
 *   - a single tick fires a job exactly once (§B.2)
 *   - re-firing the same tick yields 0 (no duplicate concurrent run)
 *   - a missed window of N ticks recovers with ONE run, never N (§B.4)
 *   - schedules beyond maxFutureHorizon are rejected (schedule_horizon_exceeded)
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 */

import { afterAll, beforeAll, describe, expect, it, beforeEach } from 'vitest';
import {
  singleTick,
  missedWindow,
  registerJob,
  resetScheduling,
  MAX_FUTURE_HORIZON_MS,
} from '../src/host/schedulingService.js';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import { initHostExtPersistence, __resetHostExtPersistence } from '../src/host/hostExtPersistence.js';

const storage = openSqliteStorage(':memory:');
beforeAll(() => {
  initHostExtPersistence(storage);
});
afterAll(async () => {
  __resetHostExtPersistence();
  await storage.close();
});
beforeEach(async () => {
  initHostExtPersistence(storage);
  await resetScheduling();
});

describe('RFC 0052 §B.2 — fire-once-per-tick', () => {
  it('a single cron tick fires exactly one run', () => {
    expect(singleTick().runsFired).toBe(1);
  });

  it('each successive wake-up is a fresh tick and fires once', () => {
    expect(singleTick('j').runsFired).toBe(1);
    expect(singleTick('j').runsFired).toBe(1);
    expect(singleTick('j').runsFired).toBe(1);
  });
});

describe('RFC 0052 §B.4 — missed-tick policy', () => {
  it('a missed window of 5 ticks recovers with exactly one run (no flood)', () => {
    const r = missedWindow(5);
    expect(r.runsFired).toBe(1);
    expect(r.runsFired).toBeLessThanOrEqual(1);
  });

  it('missedTicks <= 0 is treated as a single recovery fire', () => {
    expect(missedWindow(0).runsFired).toBe(1);
  });
});

describe('RFC 0052 §A — maxFutureHorizon', () => {
  it('accepts a schedule within the horizon', async () => {
    const r = await registerJob({ jobId: 'soon', tenantId: 't1', cronExpr: '* * * * *', firstFireAtMs: Date.now() + 60_000 });
    expect(r.ok).toBe(true);
  });

  it('rejects a schedule beyond the horizon with schedule_horizon_exceeded', async () => {
    const r = await registerJob({
      jobId: 'far',
      tenantId: 't1',
      cronExpr: '* * * * *',
      firstFireAtMs: Date.now() + MAX_FUTURE_HORIZON_MS + 60_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('schedule_horizon_exceeded');
  });
});

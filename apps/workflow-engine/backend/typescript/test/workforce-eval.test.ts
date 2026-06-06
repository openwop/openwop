/**
 * RFC 0081 live-shadow eval for the Workforce demo (host-ext, deterministic seam).
 * A REAL eval — dispatches the supervisor agent over the embedded suite and
 * scores each task against the human baseline — vs the runs-derived `/shadow`
 * stand-in. Verifies the EvalSummary, the persisted eval run + `eval.*` events,
 * the content-free guarantee (no scenario prose in the events), and that the
 * deterministic suite lands at the designed 0.8.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import { EVAL_SUITE_ID, runWorkforceLiveShadowEval } from '../src/host/workforceEval.js';
import type { Storage } from '../src/storage/storage.js';

const HERO = 'workforce.finance.invoice-exception';
const NOW = 1_750_000_000_000;

describe('workforce live-shadow eval (RFC 0081 §C, host-ext)', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = openSqliteStorage(':memory:');
  });

  it('dispatches the supervisor over the suite, scores it, and returns a spec-shaped EvalSummary', async () => {
    const s = await runWorkforceLiveShadowEval(storage, 'demo', HERO, NOW);
    expect(s.suiteId).toBe(EVAL_SUITE_ID);
    expect(s.mode).toBe('live-shadow');
    expect(s.evaluatedModelClass).toBe('reasoning');
    expect(s.taskCount).toBe(5);
    expect(s.tasks).toHaveLength(5);
    expect(s.aggregateScore).toBeGreaterThanOrEqual(0);
    expect(s.aggregateScore).toBeLessThanOrEqual(1);
    expect(s.passedCount).toBe(s.tasks.filter((t) => t.passed).length);
    expect(s.passed).toBe(s.aggregateScore >= 0.8);
    // designed: 4/5 agree with baseline → 0.8, a credible pass (not a trivial 1.0)
    expect(s.aggregateScore).toBe(0.8);
    expect(s.passed).toBe(true);
  });

  it('persists a real eval run with eval.started / eval.scored×N / eval.completed events', async () => {
    const s = await runWorkforceLiveShadowEval(storage, 'demo', HERO, NOW);
    const events = await storage.listEvents(s.runId);
    const types = events.map((e) => e.type);
    expect(types).toContain('eval.started');
    expect(types.filter((t) => t === 'eval.scored')).toHaveLength(5);
    expect(types).toContain('eval.completed');

    const run = (await storage.listRuns({ tenantId: 'demo', limit: 100 })).find((r) => r.runId === s.runId);
    expect(run?.status).toBe('completed');
    expect((run?.metadata as { mode?: string }).mode).toBe('eval');
  });

  it('is content-free (eval-summary-no-content-leak): no scenario prose in the events', async () => {
    const s = await runWorkforceLiveShadowEval(storage, 'demo', HERO, NOW);
    const events = await storage.listEvents(s.runId);
    const blob = JSON.stringify(events.map((e) => e.payload));
    // distinctive scenario phrases (never taskIds) must NOT appear
    expect(blob).not.toMatch(/tolerance|goods receipt|vendor master|already-posted|auto-clear band/i);
  });

  it('is deterministic — identical inputs reproduce the same scores', async () => {
    const a = await runWorkforceLiveShadowEval(storage, 'demo', HERO, NOW);
    const b = await runWorkforceLiveShadowEval(openSqliteStorage(':memory:'), 'demo', HERO, NOW);
    expect(b.aggregateScore).toBe(a.aggregateScore);
    expect(b.tasks).toEqual(a.tasks);
    expect(b.runId).toBe(a.runId); // id derived from (tenant, workforce, nowMs)
  });
});

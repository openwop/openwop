/**
 * Self-tests for `eval-recorded-fixtures-witness.ts` (RFC 0252). The judges
 * pass a host that served the source's answers and kept every miss off the
 * live counter, and FAIL a host that ran the replay live, served other
 * answers, counted no miss, passed the drift, or let the missed inc P run.
 * Counters that did not persist, or moved more than the scenario can cause,
 * are `blocked`.
 */

import { describe, it, expect } from 'vitest';
import type { CounterCall } from './eval-counter-witness.js';
import { judgeDriftFailsClosed, judgeEchoed, judgeReplayed, recordTask, type RecordedVerdict } from './eval-recorded-fixtures-witness.js';

const call = (key: string, op: string, count: number): CounterCall => ({ key, op, outcome: { key, count }, error: undefined, returned: true });
const live = (p: number, r: number): CounterCall[] => [call('P', 'read', p), call('R', 'inc', r), call('R', 'read', r)];
const failed = (v: RecordedVerdict): string[] => (v.kind === 'judged' ? v.findings.filter((x) => !x.ok).map((x) => x.message) : [`blocked: ${v.reason}`]);

const source = live(4, 10);
const probe = live(4, 11);

describe('judgeEchoed (RFC 0252 §E)', () => {
  const sent = { record: 'run-1' };
  it('passes the map echoed verbatim on one eval.started', () => {
    expect(judgeEchoed([{ type: 'eval.started', payload: { fixtureRuns: { record: 'run-1' } } }], sent).every((f) => f.ok)).toBe(true);
  });
  it('fails a missing or different map', () => {
    expect(judgeEchoed([{ type: 'eval.started', payload: {} }], sent).every((f) => f.ok)).toBe(false);
    expect(judgeEchoed([{ type: 'eval.started', payload: { fixtureRuns: { record: 'run-2' } } }], sent).every((f) => f.ok)).toBe(false);
  });
});

describe('judgeReplayed (RFC 0252 §D)', () => {
  it('passes recorded answers, no miss, and one live inc R between source and probe', () => {
    expect(failed(judgeReplayed(source, live(4, 10), { fixtureMissCount: 0 }, probe))).toEqual([]);
  });
  it('fails a replay that reached the live counter', () => {
    expect(failed(judgeReplayed(source, live(4, 11), { fixtureMissCount: 0 }, live(4, 12)))).toHaveLength(2);
  });
  it('fails a counted miss', () => {
    expect(failed(judgeReplayed(source, live(4, 10), { fixtureMissCount: 1 }, probe))).toHaveLength(1);
  });
  it('is blocked when the counter did not persist or moved more than the scenario explains', () => {
    expect(judgeReplayed(source, live(4, 10), { fixtureMissCount: 0 }, live(4, 1)).kind).toBe('blocked');
    expect(judgeReplayed(source, live(4, 10), { fixtureMissCount: 0 }, live(4, 15)).kind).toBe('blocked');
    expect(judgeReplayed(source.slice(0, 2), live(4, 10), { fixtureMissCount: 0 }, probe).kind).toBe('blocked');
  });
});

describe('judgeDriftFailsClosed (RFC 0252 §D)', () => {
  it('passes one miss, a failed task, and P unchanged', () => {
    expect(failed(judgeDriftFailsClosed(source, { fixtureMissCount: 1 }, false, probe))).toEqual([]);
  });
  it('fails no miss, a passed task, or a live inc P', () => {
    expect(failed(judgeDriftFailsClosed(source, { fixtureMissCount: 0 }, false, probe))).toHaveLength(1);
    expect(failed(judgeDriftFailsClosed(source, { fixtureMissCount: 1 }, true, probe))).toHaveLength(1);
    expect(failed(judgeDriftFailsClosed(source, { fixtureMissCount: 1 }, false, live(5, 11)))).toHaveLength(1);
  });
  it('is blocked when the counter did not persist', () => {
    expect(judgeDriftFailsClosed(source, { fixtureMissCount: 1 }, false, live(4, 10)).kind).toBe('blocked');
  });
});

describe('recordTask', () => {
  it('finds task record and nothing else', () => {
    expect(recordTask({ tasks: [{ taskId: 'other' }, { taskId: 'record', passed: false }] })).toEqual({ taskId: 'record', passed: false });
    expect(recordTask({ tasks: [] })).toBeUndefined();
  });
});

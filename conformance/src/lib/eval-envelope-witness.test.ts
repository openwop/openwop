/**
 * Self-tests for `eval-envelope-witness.ts` (RFC 0081 §C). The judges pass the
 * log and summary a conforming host serves and FAIL each wrong answer: no
 * `eval.completed`, two of them, one emitted before the last task or after
 * `run.completed`, `eval.started` after a score, aggregates that disagree with
 * the summary, and a summary whose counts disagree with its own rows.
 */

import { describe, it, expect } from 'vitest';
import { judgeEvalEnvelope, judgeSummaryServed, type EnvelopeFinding } from './eval-envelope-witness.js';

const failed = (fs: readonly EnvelopeFinding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);
const valid = () => ({ ok: true, errors: '' });
const ev = (sequence: number, type: string, payload: Record<string, unknown> = {}) => ({ type, sequence, payload });
const AGG = { aggregateScore: 0.5, passed: false, taskCount: 2, passedCount: 1 };
const SUMMARY = { suiteId: 's', suiteVersion: '1.0.0', aggregateScore: 0.5, passed: false, taskCount: 2, passedCount: 1, tasks: [{ taskId: 'a', score: 1, passed: true }, { taskId: 'b', score: 0, passed: false }] };
const good = () => [
  ev(1, 'run.started'),
  ev(2, 'eval.started', { suiteId: 's', suiteVersion: '1.0.0', taskCount: 2, modes: ['golden'] }),
  ev(3, 'eval.scored', { taskId: 'a', score: 1, passed: true }),
  ev(4, 'eval.scored', { taskId: 'b', score: 0, passed: false }),
  ev(5, 'eval.completed', AGG),
  ev(6, 'run.completed'),
];
const judge = (events: ReturnType<typeof good>, summary: Record<string, unknown> = SUMMARY, completedValid = valid) => failed(judgeEvalEnvelope(events, summary, { completedValid }));

describe('judgeEvalEnvelope (RFC 0081 §C)', () => {
  it('a conforming log passes, in any delivery order', () => {
    expect(judge(good())).toEqual([]);
    expect(judge([...good()].reverse())).toEqual([]);
  });

  it('fails a run with no eval.completed', () => {
    expect(judge(good().filter((e) => e.type !== 'eval.completed'))).toEqual(['eval.completed MUST be emitted once (got 0)']);
  });

  it('fails two eval.completed', () => {
    expect(judge([...good(), ev(7, 'eval.completed', AGG)])[0]).toMatch(/eval.completed MUST be emitted once \(got 2\)/);
  });

  it('fails eval.completed emitted before the last task', () => {
    const e = good().map((x) => (x.type === 'eval.completed' ? { ...x, sequence: 3.5 } : x));
    expect(judge(e)).toContain('eval.completed MUST follow every eval.scored ("after all tasks")');
  });

  it('fails eval.completed emitted after run.completed', () => {
    const e = good().map((x) => (x.type === 'eval.completed' ? { ...x, sequence: 9 } : x));
    expect(judge(e)).toContain('eval.completed MUST precede run.completed');
  });

  it('fails eval.started after a score', () => {
    const e = good().map((x) => (x.type === 'eval.started' ? { ...x, sequence: 3.5 } : x));
    expect(judge(e)).toContain('eval.started MUST precede every eval.scored');
  });

  it('fails aggregates that disagree with the summary', () => {
    const e = good().map((x) => (x.type === 'eval.completed' ? { ...x, payload: { ...AGG, passedCount: 2 } } : x));
    expect(judge(e)[0]).toMatch(/eval.completed.passedCount MUST equal/);
  });

  it('fails an eval.completed payload the schema refuses', () => {
    expect(judge(good(), SUMMARY, () => ({ ok: false, errors: 'missing aggregateScore' }))).toEqual(['eval.completed MUST validate: missing aggregateScore']);
  });

  it('fails a run with no eval.scored', () => {
    expect(judge(good().filter((e) => e.type !== 'eval.scored'))).toEqual(['the run MUST emit eval.scored for its tasks']);
  });
});

describe('judgeSummaryServed (RFC 0081 §C)', () => {
  it('a conforming summary passes', () => {
    expect(failed(judgeSummaryServed(SUMMARY, valid))).toEqual([]);
  });

  it('fails a summary the schema refuses', () => {
    expect(failed(judgeSummaryServed(SUMMARY, () => ({ ok: false, errors: 'x' })))).toEqual(['the served EvalSummary MUST validate: x']);
  });

  it('fails counts that disagree with the rows', () => {
    const got = failed(judgeSummaryServed({ ...SUMMARY, taskCount: 3, passedCount: 2 }, valid));
    expect(got).toHaveLength(2);
  });
});

/**
 * Self-tests for `eval-efficiency-witness.ts` (RFC 0244 §C). The judge passes
 * the counts a correct host serves and FAILS each wrong answer a host can give:
 * counting judge or other-agent calls (too many), counting only the first trial
 * or dropping calls (too few), and a sum of means that disagrees with the log.
 */

import { describe, it, expect } from 'vitest';
import { judgeToolCallCount, type EfficiencyVerdict } from './eval-efficiency-witness.js';

const failed = (v: EfficiencyVerdict): string[] => v.findings.filter((x) => !x.ok).map((x) => x.message);
const TASKS = [{ taskId: 'a', scriptLength: 3 }, { taskId: 'b', scriptLength: 2 }];
const summary = (a: unknown, b: unknown) => ({
  tasks: [
    { taskId: 'a', score: 1, passed: true, ...(a === undefined ? {} : { efficiency: { toolCallCount: a, modelCallCount: 0, inputTokens: 0, outputTokens: 0 } }) },
    { taskId: 'b', score: 0, passed: false, ...(b === undefined ? {} : { efficiency: { toolCallCount: b, modelCallCount: 0, inputTokens: 0, outputTokens: 0 } }) },
  ],
});

describe('judgeToolCallCount (RFC 0244 §C)', () => {
  it('a correct host passes, and the counts sum to the log', () => {
    const v = judgeToolCallCount(summary(3, 2), TASKS, 5);
    expect(v.applicable).toBe(true);
    expect(failed(v)).toEqual([]);
  });
  it('no efficiency block is not evidence either way', () => {
    expect(judgeToolCallCount(summary(undefined, undefined), TASKS, 5)).toEqual({ applicable: false, findings: [] });
  });
  it('counting a judge call fails', () => {
    expect(failed(judgeToolCallCount(summary(4, 2), TASKS, 5)).some((m) => /task a: .*got 4/.test(m))).toBe(true);
  });
  it('dropping a call fails', () => {
    expect(failed(judgeToolCallCount(summary(3, 1), TASKS, undefined)).some((m) => /task b: .*got 1/.test(m))).toBe(true);
  });
  it('a non-numeric count fails', () => {
    expect(failed(judgeToolCallCount(summary('3', 2), TASKS, undefined)).some((m) => /task a/.test(m))).toBe(true);
  });
  it('counts that disagree with the log fail the sum check', () => {
    expect(failed(judgeToolCallCount(summary(3, 2), TASKS, 6)).some((m) => /MUST sum/.test(m))).toBe(true);
  });
  it('on a multi-trial run the sum check is not made', () => {
    expect(failed(judgeToolCallCount(summary(3, 2), TASKS, undefined))).toEqual([]);
  });
  it('a partial report is judged on the tasks that carry it, without the sum check', () => {
    const v = judgeToolCallCount(summary(3, undefined), TASKS, 99);
    expect(v.applicable).toBe(true);
    expect(failed(v)).toEqual([]);
  });
});

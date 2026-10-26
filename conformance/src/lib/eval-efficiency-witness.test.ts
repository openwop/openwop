/**
 * Self-tests for `eval-efficiency-witness.ts` (RFC 0244 §C). The judge passes
 * the counts a correct host serves and FAILS each wrong answer a host can give:
 * counting judge or other-agent calls (too many), counting only the first trial
 * or dropping calls (too few), and a sum of means that disagrees with the log.
 * The model-usage and cost judges fail a judge's or a single trial's usage
 * counted as the agent's, and pass nothing on a run with no usage at all.
 * The never-gated judge fails a host that fails the many-call task or the
 * suite, and is `blocked` when the calls never ran or the control task failed.
 */

import { describe, it, expect } from 'vitest';
import { agentUsage, judgeCostEveryTrial, judgeModelUsage, judgeNeverGated, judgeToolCallCount, type EfficiencyVerdict } from './eval-efficiency-witness.js';

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

const AGENT = 'core.conformance.agents.scripted';
const usage = (inputTokens: number, outputTokens: number, costEstimateUsd?: number) => ({ type: 'provider.usage', payload: { provider: 'p', model: 'm', inputTokens, outputTokens, ...(costEstimateUsd === undefined ? {} : { costEstimateUsd }) } });
const bracket = (id: string, agentId: string, inner: Array<{ type: string; payload: Record<string, unknown> }>) => [
  { type: 'agent.invocation.started', payload: { invocationId: id, agentId, source: 'eval' } },
  ...inner,
  { type: 'agent.invocation.completed', payload: { invocationId: id, agentId, outcome: 'completed' } },
];
const eff = (m: number, i: number, o: number) => ({ toolCallCount: 1, modelCallCount: m, inputTokens: i, outputTokens: o });
const sum2 = (a: ReturnType<typeof eff> | undefined, b: ReturnType<typeof eff> | undefined, extra: Record<string, unknown> = {}) => ({
  ...extra,
  tasks: [{ taskId: 'a', score: 1, passed: true, ...(a ? { efficiency: a } : {}) }, { taskId: 'b', score: 1, passed: true, ...(b ? { efficiency: b } : {}) }],
});
// Two tasks, one model call each, plus a judge call nested in task b's bracket and one host call outside.
const LOG = [
  ...bracket('i1', AGENT, [usage(10, 2, 0.01)]),
  ...bracket('i2', AGENT, [usage(20, 4, 0.02), ...bracket('j1', 'judge', [usage(99, 99, 0.5)])]),
  usage(7, 7, 0.07),
];

describe('agentUsage', () => {
  it('counts only usage inside the agent\'s own brackets', () => {
    const u = agentUsage(LOG, AGENT);
    expect(u.bracketed).toBe(true);
    expect(u.usage.map((x) => x['inputTokens'])).toEqual([10, 20]);
  });
  it('with no brackets it returns every usage event', () => expect(agentUsage([usage(1, 1), usage(2, 2)], AGENT)).toMatchObject({ bracketed: false, usage: [{}, {}] }));
});

describe('judgeModelUsage (RFC 0244 §C)', () => {
  it('a correct host passes', () => expect(failed(judgeModelUsage(sum2(eff(1, 10, 2), eff(1, 20, 4)), ['a', 'b'], agentUsage(LOG, AGENT), 1))).toEqual([]));
  it('counting the judge call fails', () => expect(failed(judgeModelUsage(sum2(eff(1, 10, 2), eff(2, 119, 103)), ['a', 'b'], agentUsage(LOG, AGENT), 1)).length).toBe(3));
  it('means over trials are scaled by the trial count', () => {
    const three = [...LOG, ...LOG, ...LOG];
    expect(failed(judgeModelUsage(sum2(eff(1, 10, 2), eff(1, 20, 4)), ['a', 'b'], agentUsage(three, AGENT), 3))).toEqual([]);
    expect(failed(judgeModelUsage(sum2(eff(1 / 3, 10 / 3, 2 / 3), eff(1 / 3, 20 / 3, 4 / 3)), ['a', 'b'], agentUsage(three, AGENT), 3)).length).toBe(3);
  });
  it('without brackets an over-count fails and an under-count is not judged', () => {
    const flat = agentUsage([usage(10, 2), usage(20, 4)], AGENT);
    expect(failed(judgeModelUsage(sum2(eff(1, 10, 2), eff(0, 0, 0)), ['a', 'b'], flat, 1))).toEqual([]);
    expect(failed(judgeModelUsage(sum2(eff(2, 10, 2), eff(1, 20, 4)), ['a', 'b'], flat, 1)).some((m) => /modelCallCount .*MUST NOT exceed/.test(m))).toBe(true);
  });
  it('no usage and zero counts witness nothing', () => expect(judgeModelUsage(sum2(eff(0, 0, 0), eff(0, 0, 0)), ['a', 'b'], agentUsage([], AGENT), 1)).toEqual({ applicable: false, findings: [] }));
  it('reported calls with no usage in the log fail', () => expect(failed(judgeModelUsage(sum2(eff(1, 0, 0), eff(0, 0, 0)), ['a', 'b'], agentUsage(bracket('i1', AGENT, []), AGENT), 1)).length).toBe(1));
  it('a field one task omits is not judged', () => expect(judgeModelUsage(sum2(eff(1, 10, 2), undefined), ['a', 'b'], agentUsage(LOG, AGENT), 1).applicable).toBe(false));
});

describe('judgeCostEveryTrial (RFC 0244 §B)', () => {
  const three = agentUsage([...LOG, ...LOG, ...LOG], AGENT);
  it('a total over every trial passes', () => expect(failed(judgeCostEveryTrial(sum2(undefined, undefined, { totalCostUsd: 0.09 }), three))).toEqual([]));
  it('a total priced on one trial fails', () => expect(failed(judgeCostEveryTrial(sum2(undefined, undefined, { totalCostUsd: 0.03 }), three)).length).toBe(1));
  it('a total that also prices the judge and host calls is not a failure', () => expect(failed(judgeCostEveryTrial(sum2(undefined, undefined, { totalCostUsd: 1.80 }), three))).toEqual([]));
  it('no total, no brackets, or an unpriced call is not evidence', () => {
    expect(judgeCostEveryTrial(sum2(undefined, undefined), three).applicable).toBe(false);
    expect(judgeCostEveryTrial(sum2(undefined, undefined, { totalCostUsd: 0.03 }), agentUsage([usage(1, 1, 0.03)], AGENT)).applicable).toBe(false);
    expect(judgeCostEveryTrial(sum2(undefined, undefined, { totalCostUsd: 0.03 }), agentUsage(bracket('i1', AGENT, [usage(1, 1)]), AGENT)).applicable).toBe(false);
  });
});

describe('judgeNeverGated (RFC 0244 §C)', () => {
  const LEAN = { taskId: 'lean', scriptLength: 1 };
  const BUSY = { taskId: 'busy', scriptLength: 8 };
  const run = (busy: Record<string, unknown>, suitePassed = true, lean: Record<string, unknown> = { score: 1, passed: true }) => ({
    passed: suitePassed,
    tasks: [{ taskId: 'lean', ...lean }, { taskId: 'busy', ...busy }],
  });
  const findings = (v: ReturnType<typeof judgeNeverGated>): string[] => ('blocked' in v ? [`blocked: ${v.blocked}`] : failed(v));
  it('a host that ignores efficiency passes', () => expect(findings(judgeNeverGated(run({ score: 1, passed: true }), LEAN, BUSY, 9))).toEqual([]));
  it('failing the many-call task fails', () => expect(findings(judgeNeverGated(run({ score: 1, passed: false }, false), LEAN, BUSY, 9)).some((m) => /busy .*MUST pass/.test(m))).toBe(true));
  it('docking the many-call task\'s score fails', () => expect(findings(judgeNeverGated(run({ score: 0.5, passed: true }), LEAN, BUSY, 9)).some((m) => /MUST score what lean scores/.test(m))).toBe(true));
  it('failing the suite on efficiency fails', () => expect(findings(judgeNeverGated(run({ score: 1, passed: true }, false), LEAN, BUSY, 9)).some((m) => /suite MUST pass/.test(m))).toBe(true));
  it('calls that never ran are blocked', () => expect('blocked' in judgeNeverGated(run({ score: 1, passed: true }), LEAN, BUSY, 2)).toBe(true));
  it('a failing control task is blocked', () => expect('blocked' in judgeNeverGated(run({ score: 0, passed: false }, false, { score: 0, passed: false }), LEAN, BUSY, 9)).toBe(true));
});

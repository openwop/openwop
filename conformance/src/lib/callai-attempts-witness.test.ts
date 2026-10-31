/**
 * Self-tests for `callai-attempts-witness.ts` (RFC 0248). Each judge passes
 * what a conforming host serves and FAILS each wrong answer a host can give:
 * counting one call as one attempt after a retry, reporting the final
 * attempt's tokens instead of the sum, claiming complete usage, mislabelling
 * the structured-output mode, retrying past maxAttempts, growing the budget,
 * ignoring a malformed policy, and recomputing attempts on replay.
 */

import { describe, it, expect } from 'vitest';
import {
  CASES, judgeCount, judgeSum, judgeIncomplete, judgeStructuredOutput, judgeCap, judgeNoGrowth, judgeMalformed, judgeReplayed,
  type CaseRun, type Finding,
} from './callai-attempts-witness.js';

const failed = (fs: readonly Finding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);
const run = (over: Partial<CaseRun> = {}): CaseRun => ({
  runId: 'r', status: 'completed', attempts: undefined, errorCode: null, errorField: undefined, usage: [], exhaustedTotal: undefined, startedSeq: 3, types: [], capBreachedKinds: [], ...over,
});
const usage = (...t: number[]) => t.map((outputTokens) => ({ provider: 'mock', model: 'mock-mini', inputTokens: 1, outputTokens }));

const good = run({ attempts: { count: 2, outputTokens: 30, usageComplete: true, structuredOutput: 'prompt' }, usage: usage(10, 20) });

describe('judgeCount (§A.1)', () => {
  it('a conforming host passes, with and without provider.usage', () => {
    expect(failed(judgeCount(good, true))).toEqual([]);
    expect(failed(judgeCount({ ...good, usage: [] }, false))).toEqual([]);
  });
  it('counting the call as one attempt after a retry fails', () => {
    expect(failed(judgeCount(run({ attempts: { count: 1, outputTokens: 30, usageComplete: true }, usage: usage(10, 20) }), true)).some((m) => /one provider\.usage each/.test(m))).toBe(true);
  });
  it('a missing record or a non-integer count fails', () => {
    expect(failed(judgeCount(run(), false)).some((m) => /MUST carry attempts/.test(m))).toBe(true);
    expect(failed(judgeCount(run({ attempts: { count: 1.5, outputTokens: 30, usageComplete: true } }), false)).some((m) => /integer ≥ 1/.test(m))).toBe(true);
  });
});

describe('judgeSum (§A.2)', () => {
  it('a conforming host passes, with and without provider.usage', () => {
    expect(failed(judgeSum(good, CASES.count, true))).toEqual([]);
    expect(failed(judgeSum({ ...good, usage: [] }, CASES.count, false))).toEqual([]);
  });
  it("reporting only the final attempt's tokens fails", () => {
    expect(failed(judgeSum(run({ attempts: { count: 2, outputTokens: 20, usageComplete: true }, usage: usage(10, 20) }), CASES.count, true)).some((m) => /sum over the 2 requests/.test(m))).toBe(true);
  });
  it('a sum that disagrees with the provider.usage log fails', () => {
    expect(failed(judgeSum({ ...good, usage: usage(10, 25) }, CASES.count, true)).some((m) => /summed provider\.usage/.test(m))).toBe(true);
  });
  it('a missing record fails rather than passing vacuously', () => {
    expect(failed(judgeSum(run(), CASES.count, false)).some((m) => /MUST carry attempts/.test(m))).toBe(true);
  });
  it('claiming incomplete usage when every reply reported fails', () => {
    expect(failed(judgeSum({ ...good, attempts: { ...good.attempts, usageComplete: false } }, CASES.count, false)).some((m) => /MUST be true/.test(m))).toBe(true);
  });
});

describe('judgeIncomplete (§A.2)', () => {
  it('usageComplete false passes; claiming complete usage fails', () => {
    expect(failed(judgeIncomplete(run({ attempts: { count: 1, usageComplete: false } })))).toEqual([]);
    expect(failed(judgeIncomplete(run({ attempts: { count: 1, outputTokens: 0, usageComplete: true } }))).some((m) => /usageComplete false/.test(m))).toBe(true);
  });
});

describe('judgeStructuredOutput (§A.3)', () => {
  const plain = run({ attempts: { count: 1, outputTokens: 5, usageComplete: true } });
  const native = run({ attempts: { count: 1, outputTokens: 5, usageComplete: true, structuredOutput: 'native' } });
  it('a conforming host passes', () => { expect(failed(judgeStructuredOutput(plain, native))).toEqual([]); });
  it('structuredOutput on a call without responseSchema fails', () => {
    expect(failed(judgeStructuredOutput(run({ attempts: { ...plain.attempts, structuredOutput: 'prompt' } }), native)).some((m) => /MUST be absent/.test(m))).toBe(true);
  });
  it('mislabelling native as prompt fails', () => {
    expect(failed(judgeStructuredOutput(plain, run({ attempts: { ...native.attempts, structuredOutput: 'prompt' } }))).some((m) => /MUST be "native"/.test(m))).toBe(true);
  });
});

describe('judgeCap (§B.1)', () => {
  it('one request then failure passes', () => {
    expect(failed(judgeCap(run({ status: 'failed', errorCode: 'envelope_invalid', usage: usage(10), exhaustedTotal: 1 }), true))).toEqual([]);
  });
  it('retrying past maxAttempts fails', () => {
    const fs = failed(judgeCap(run({ status: 'completed', usage: usage(10, 20), exhaustedTotal: undefined }), true));
    expect(fs.some((m) => /MUST fail, since a completion needs a second request/.test(m))).toBe(true);
    expect(fs.some((m) => /MUST NOT send more than maxAttempts/.test(m))).toBe(true);
    expect(failed(judgeCap(run({ status: 'failed', errorCode: 'envelope_invalid', usage: usage(10), exhaustedTotal: 3 }), true)).some((m) => /totalAttempts MUST be 1/.test(m))).toBe(true);
  });
  it('refusing a well-formed policy fails', () => {
    expect(failed(judgeCap(run({ status: 'failed', errorCode: 'validation_error' }), false)).some((m) => /MUST NOT be refused/.test(m))).toBe(true);
  });
});

describe('judgeNoGrowth (§B.2)', () => {
  it('staying within the budget and failing on truncation passes', () => {
    expect(failed(judgeNoGrowth(run({ status: 'failed', errorCode: 'envelope_truncation_unrecoverable', usage: usage(100, 100) }), true))).toEqual([]);
  });
  it('growing the budget fails, on the outcome and on the log', () => {
    const fs = failed(judgeNoGrowth(run({ status: 'completed', usage: usage(100, 150) }), true));
    expect(fs.some((m) => /MUST NOT complete/.test(m))).toBe(true);
    expect(fs.some((m) => /MAY exceed the request's maxTokens/.test(m))).toBe(true);
  });
});

describe('judgeMalformed (§B.5)', () => {
  it('validation_error naming the key passes', () => {
    expect(failed(judgeMalformed(run({ status: 'failed', errorCode: 'validation_error', errorField: 'retry.maxAttempts' })))).toEqual([]);
  });
  it('ignoring the policy, or not naming the key, fails', () => {
    expect(failed(judgeMalformed(run({ status: 'completed' }))).some((m) => /never ignored/.test(m))).toBe(true);
    expect(failed(judgeMalformed(run({ status: 'failed', errorCode: 'validation_error', errorField: 'retry' }))).some((m) => /details\.field/.test(m))).toBe(true);
  });
});

describe('judgeReplayed (§A.5)', () => {
  const src = run({ attempts: { count: 2, outputTokens: 30, usageComplete: true } });
  it('a byte-equal record passes', () => { expect(failed(judgeReplayed(src, run({ attempts: { count: 2, outputTokens: 30, usageComplete: true } })))).toEqual([]); });
  it('a recomputed record fails', () => {
    expect(failed(judgeReplayed(src, run({ attempts: { count: 1, outputTokens: 20, usageComplete: true } }))).some((m) => /MUST equal the recorded value/.test(m))).toBe(true);
  });
});

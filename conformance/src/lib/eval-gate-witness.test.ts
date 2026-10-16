/**
 * Self-tests for `eval-gate-witness.ts` (RFC 0246). Each judge passes the
 * summary a corrected host serves and FAILS the two wrong answers a host can
 * give: the unmigrated RFC 0244 answer (`passed: true` on the output score),
 * and the over-correction (zeroing the reported `score`, which §C forbids).
 */

import { describe, it, expect } from 'vitest';
import { judgeMeanGated, judgeSuiteGated, type GateFinding } from './eval-gate-witness.js';

const failed = (fs: readonly GateFinding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);

const scored = (n: number, score = 1) => Array.from({ length: n }, (_, i) => ({ taskId: 'path-wrong', trialIndex: i, score, passed: false }));
const meanSummary = (over: Record<string, unknown> = {}, taskOver: Record<string, unknown> = {}) => ({
  aggregateScore: 1, gatedAggregateScore: 0, passed: false,
  tasks: [{ taskId: 'path-wrong', score: 1, gatedScore: 0, passed: false, trials: { n: 2, passedCount: 0, meanScore: 1, passAtK: 0, passHatK: 0 }, ...taskOver }],
  ...over,
});
const suiteSummary = (over: Record<string, unknown> = {}, wrongOver: Record<string, unknown> = {}) => ({
  aggregateScore: 1, gatedAggregateScore: 0.5, passed: false,
  tasks: [
    { taskId: 'path-matched', score: 1, gatedScore: 1, passed: true },
    { taskId: 'path-wrong', score: 1, gatedScore: 0, passed: false, ...wrongOver },
  ],
  ...over,
});

describe('judgeMeanGated (RFC 0246 §B, passRule "mean")', () => {
  it('a corrected host passes', () => {
    expect(failed(judgeMeanGated(meanSummary(), scored(2), 2))).toEqual([]);
  });
  it('the unmigrated RFC 0244 host fails: passed on meanScore, no gatedScore', () => {
    const fs = failed(judgeMeanGated(meanSummary({ gatedAggregateScore: undefined }, { gatedScore: undefined, passed: true }), scored(2), 2));
    expect(fs.some((m) => /MUST NOT pass on the gating score/.test(m))).toBe(true);
    expect(fs.some((m) => /MUST carry gatedScore/.test(m))).toBe(true);
    expect(fs.some((m) => /gatedAggregateScore/.test(m))).toBe(true);
  });
  it('zeroing the reported score fails §C even with passed false', () => {
    const fs = failed(judgeMeanGated(meanSummary({}, { score: 0, trials: { n: 2, passedCount: 0, meanScore: 0, passAtK: 0, passHatK: 0 } }), scored(2, 0), 2));
    expect(fs.some((m) => /meanScore MUST stay/.test(m))).toBe(true);
    expect(fs.some((m) => /eval\.scored\.score MUST stay/.test(m))).toBe(true);
  });
  it('a missing trial is a finding', () => {
    expect(failed(judgeMeanGated(meanSummary(), scored(1), 2)).some((m) => /one eval\.scored per trial/.test(m))).toBe(true);
  });
});

describe('judgeSuiteGated (RFC 0246 §B, suite passed)', () => {
  it('a corrected host passes', () => {
    expect(failed(judgeSuiteGated(suiteSummary(), 0.6))).toEqual([]);
  });
  it('the unmigrated RFC 0244 host fails: suite passed on aggregateScore', () => {
    const fs = failed(judgeSuiteGated({ aggregateScore: 1, passed: true, tasks: [{ taskId: 'path-matched', score: 1, passed: true }, { taskId: 'path-wrong', score: 1, passed: false }] }, 0.6));
    expect(fs.some((m) => /suite passed MUST read the gating aggregate/.test(m))).toBe(true);
    expect(fs.some((m) => /MUST carry gatedScore, matched or not/.test(m))).toBe(true);
  });
  it('omitting gatedScore on the matched task fails §D', () => {
    const s = suiteSummary();
    delete (s.tasks[0] as Record<string, unknown>)['gatedScore'];
    expect(failed(judgeSuiteGated(s, 0.6)).some((m) => /matched or not/.test(m))).toBe(true);
  });
  it('zeroing path-wrong\'s reported score fails §C', () => {
    const fs = failed(judgeSuiteGated(suiteSummary({ aggregateScore: 0.5 }, { score: 0 }), 0.6));
    expect(fs.some((m) => /keep the output score 1/.test(m))).toBe(true);
    expect(fs.some((m) => /aggregateScore MUST stay/.test(m))).toBe(true);
  });
  it('a wrong gating aggregate fails §A', () => {
    expect(failed(judgeSuiteGated(suiteSummary({ gatedAggregateScore: 1, passed: false }), 0.6)).some((m) => /aggregate the gating scores/.test(m))).toBe(true);
  });
});

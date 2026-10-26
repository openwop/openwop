/**
 * Self-tests for `eval-regression-witness.ts` (RFC 0251, RFC 0244 §F). Each
 * judge passes what a conforming host serves and FAILS each wrong answer: a
 * baseline not echoed, a `scoreDelta` off the aggregates, unpaired tasks
 * counted, an aggregate-driven `improved`, a refusal that echoes the id or
 * tells another tenant's run apart from an id that never existed.
 */

import { describe, it, expect } from 'vitest';
import { judgeBaselineEchoed, judgeNoFalseVerdict, judgePaired, judgeRefused, judgeUniform, type Answer, type RegressionFinding } from './eval-regression-witness.js';

const failed = (f: RegressionFinding[]): string[] => f.filter((x) => !x.ok).map((x) => x.message);
const BASE = 'run-base-1';
const base = { aggregateScore: 2 / 3 };
const cand = (reg: Record<string, unknown>) => ({ aggregateScore: 1, regression: { baselineRunId: BASE, scoreDelta: 1 / 3, pairedTaskCount: 2, verdict: 'unchanged', method: 'sign-test', alpha: 0.05, ...reg } });
const started = (id: unknown) => [{ type: 'eval.started', payload: { baselineRunId: id } }];
const ans = (status: number, error: string, text = ''): Answer => ({ status, json: { error, message: 'nope' }, text: text || JSON.stringify({ error, message: 'nope' }) });

describe('judgeBaselineEchoed (RFC 0251 §D)', () => {
  it('a conforming host passes', () => expect(failed(judgeBaselineEchoed(BASE, started(BASE), cand({}), base))).toEqual([]));
  it('a missing eval.started baseline fails', () => expect(failed(judgeBaselineEchoed(BASE, started(undefined), cand({}), base))).toHaveLength(1));
  it('another baseline in the summary fails', () => expect(failed(judgeBaselineEchoed(BASE, started(BASE), cand({ baselineRunId: 'run-other' }), base))).toHaveLength(1));
  it('a scoreDelta off the aggregates fails', () => expect(failed(judgeBaselineEchoed(BASE, started(BASE), cand({ scoreDelta: 0 }), base)).some((m) => /scoreDelta/.test(m))).toBe(true));
});

describe('judgePaired and judgeNoFalseVerdict (RFC 0244 §F)', () => {
  it('a conforming host passes', () => { expect(failed(judgePaired(cand({})))).toEqual([]); expect(failed(judgeNoFalseVerdict(cand({})))).toEqual([]); });
  it('pairing every task fails', () => expect(failed(judgePaired(cand({ pairedTaskCount: 3 })))).toHaveLength(1));
  it('inconclusive passes', () => expect(failed(judgeNoFalseVerdict(cand({ verdict: 'inconclusive' })))).toEqual([]));
  it('an aggregate-driven improved fails', () => expect(failed(judgeNoFalseVerdict(cand({ verdict: 'improved' })))).toHaveLength(1));
  it('no verdict fails', () => expect(failed(judgeNoFalseVerdict(cand({ verdict: undefined })))).toHaveLength(1));
});

describe('judgeRefused and judgeUniform (RFC 0251 §B, §C)', () => {
  it('a plain 400 validation_error passes', () => expect(failed(judgeRefused(ans(400, 'validation_error'), 'run-x', 'an unknown baseline'))).toEqual([]));
  it('a 404, another code, or an echoed id fails', () => {
    expect(failed(judgeRefused(ans(404, 'not_found'), 'run-x', 'an unknown baseline'))).toHaveLength(2);
    expect(failed(judgeRefused(ans(400, 'validation_error', '{"error":"validation_error","message":"run-x not found"}'), 'run-x', 'an unknown baseline'))).toHaveLength(1);
  });
  it('a foreign run refused like an unknown id passes', () => expect(failed(judgeUniform(ans(400, 'validation_error'), ans(400, 'validation_error'), 'run-b'))).toEqual([]));
  it('a foreign run told apart from an unknown id fails', () => {
    expect(failed(judgeUniform(ans(400, 'validation_error'), ans(403, 'forbidden'), 'run-b'))).toHaveLength(2);
    expect(failed(judgeUniform(ans(400, 'validation_error'), ans(400, 'validation_error', 'baseline run-b belongs to another tenant'), 'run-b'))).toHaveLength(1);
  });
});

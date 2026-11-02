/**
 * Self-tests for `skipped-terminals-witness.ts` (RFC 0257). Each judge passes
 * what a conforming host logs and FAILS each wrong answer: a run.failed with no
 * failed node, a missing or reordered marker, a marker beside a completed
 * terminal, a replay that changes the disposition, and a parent that fails or
 * drops the child's list.
 */

import { describe, it, expect } from 'vitest';
import { judgeNoMarker, judgeParent, judgeReplaySame, judgeSkippedCompletes, terminalOf, type Ev, type SkipFinding } from './skipped-terminals-witness.js';

const failed = (fs: readonly SkipFinding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);
const log = (...evs: Ev[]): Ev[] => evs;
const done = (skippedTerminals?: string[]): Ev => ({ type: 'run.completed', payload: { outputs: {}, ...(skippedTerminals ? { skippedTerminals } : {}) } });
const fail: Ev = { type: 'run.failed', payload: { error: { code: 'openwop-app.all_terminals_skipped', message: 'x', details: { skippedTerminals: ['act'] } } } };

describe('terminalOf', () => {
  it('returns the single terminal event, and null for none or two', () => {
    expect(terminalOf(log({ type: 'node.completed' }, done()))?.type).toBe('run.completed');
    expect(terminalOf(log({ type: 'node.completed' }))).toBeNull();
    expect(terminalOf(log(done(), fail))).toBeNull();
  });
});

describe('judgeSkippedCompletes', () => {
  it('passes run.completed with the exact list; fails run.failed, no marker, a reordered or partial list', () => {
    expect(failed(judgeSkippedCompletes(log(done(['a', 'b'])), ['a', 'b']))).toEqual([]);
    expect(failed(judgeSkippedCompletes(log(fail), ['act']))).toHaveLength(3);
    expect(failed(judgeSkippedCompletes(log(done()), ['act']))).toHaveLength(1);
    expect(failed(judgeSkippedCompletes(log(done(['b', 'a'])), ['a', 'b']))).toHaveLength(1);
    expect(failed(judgeSkippedCompletes(log(done(['a'])), ['a', 'b']))).toHaveLength(1);
  });
});

describe('judgeNoMarker', () => {
  it('passes run.completed without the marker; fails a marker and a failure', () => {
    expect(failed(judgeNoMarker(log(done())))).toEqual([]);
    expect(failed(judgeNoMarker(log(done(['act']))))).toHaveLength(1);
    expect(failed(judgeNoMarker(log(fail)))).toHaveLength(1);
  });
});

describe('judgeReplaySame', () => {
  it('passes an identical disposition; fails a changed type or marker', () => {
    expect(failed(judgeReplaySame(log(done(['on-fail'])), log(done(['on-fail']))))).toEqual([]);
    expect(failed(judgeReplaySame(log(done(['on-fail'])), log(fail)))).toHaveLength(2);
    expect(failed(judgeReplaySame(log(done(['on-fail'])), log(done())))).toHaveLength(1);
  });
});

describe('judgeParent', () => {
  const sub = (outputs: Record<string, unknown>): Ev => ({ type: 'node.completed', nodeId: 'subwf-call', payload: { outputs } });
  it('passes childStatus completed with the list; fails a failed parent, a missing list, a failed childStatus', () => {
    expect(failed(judgeParent(log(sub({ childRunId: 'r', childStatus: 'completed', childSkippedTerminals: ['on-fail'] }), done()), 'subwf-call', ['on-fail']))).toEqual([]);
    expect(failed(judgeParent(log({ type: 'node.failed', nodeId: 'subwf-call' }, fail), 'subwf-call', ['on-fail']))).toHaveLength(4);
    expect(failed(judgeParent(log(sub({ childRunId: 'r', childStatus: 'completed' }), done()), 'subwf-call', ['on-fail']))).toHaveLength(1);
    expect(failed(judgeParent(log(sub({ childRunId: 'r', childStatus: 'failed', childSkippedTerminals: ['on-fail'] }), done()), 'subwf-call', ['on-fail']))).toHaveLength(1);
  });
});

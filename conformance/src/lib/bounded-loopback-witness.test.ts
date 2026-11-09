/**
 * Self-tests for `bounded-loopback-witness.ts` (RFC 0258). Each judge passes
 * what a conforming host logs and FAILS each wrong answer: no marker, a wrong
 * round or region, a reused interrupt key, a forward edge released on a
 * refine, a history built from anything but the log, a stale ApprovalData, an
 * exhausted visit still offering refine, a wrong exhaustion sequence, and a
 * fork that decides round 1 again.
 */

import { describe, it, expect } from 'vitest';
import { judgeApprovalData, judgeFailExhausted, judgeHistory, judgeRearm, judgeReplayRearm, judgeWithdrawn, type Ev, type LoopFinding } from './bounded-loopback-witness.js';

const failed = (fs: readonly LoopFinding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);
const fb1 = { scope: 'whole', text: 'round one' };
const fb2 = { scope: 'whole', text: 'round two' };
const lb = (round: number, max: number): Record<string, unknown> => ({ round, maxIterations: max, exhausted: round >= max });
const req = (key: string, round: number, max = 2, actions = ['accept', 'reject', 'refine']): Ev => ({ type: 'interrupt.requested', nodeId: 'gate', payload: { kind: 'approval', key, data: { actions, loopback: lb(round, max) } } });
const started = (nodeId: string): Ev => ({ type: 'node.started', nodeId });
const draftDone = (rounds: unknown[]): Ev => ({ type: 'node.completed', nodeId: 'draft', payload: { nodeId: 'draft', outputs: { rounds } } });
const marker = (round: number): Ev => ({ type: 'node.completed', nodeId: 'gate', payload: { nodeId: 'gate', loopback: { edgeId: 'again', targetNodeId: 'draft', round, rearmed: ['draft', 'gate'] } } });
const REARM = { gate: 'gate', target: 'draft', edgeId: 'again', region: ['draft', 'gate'], forward: 'apply' };

const v0 = draftDone([]);
const e1 = { round: 1, outputs: { rounds: [] }, refineFeedback: fb1 };
const v1 = draftDone([e1]);
const e2 = { round: 2, outputs: { rounds: [e1] }, refineFeedback: fb2 };
const v2 = draftDone([e1, e2]);
const oneRefine: Ev[] = [started('draft'), v0, req('k0', 0), marker(1), started('draft'), v1, req('k1', 1)];
const twoRefines: Ev[] = [...oneRefine, marker(2), started('draft'), v2, req('k2', 2, 2, ['accept', 'reject'])];

describe('judgeRearm', () => {
  it('passes a conforming re-arm', () => { expect(failed(judgeRearm(oneRefine, REARM))).toEqual([]); });
  it('fails no marker, a wrong region, a reused key, and a forward node started on refine', () => {
    expect(failed(judgeRearm(oneRefine.filter((e) => e !== oneRefine[3]), REARM)).length).toBeGreaterThan(0);
    const wrongRegion: Ev[] = oneRefine.map((e) => (e === oneRefine[3] ? { ...marker(1), payload: { nodeId: 'gate', loopback: { edgeId: 'again', targetNodeId: 'draft', round: 1, rearmed: ['gate', 'draft'] } } } : e));
    expect(failed(judgeRearm(wrongRegion, REARM))).toHaveLength(1);
    expect(failed(judgeRearm(oneRefine.map((e) => (e.type === 'interrupt.requested' ? req('k0', approvalRound(e)) : e)), REARM))).toHaveLength(1);
    expect(failed(judgeRearm([...oneRefine, started('apply')], REARM))).toHaveLength(1);
  });
});
function approvalRound(e: Ev): number { return ((e.payload?.['data'] as { loopback: { round: number } }).loopback.round); }

describe('judgeHistory', () => {
  it('passes a history rebuilt from the log', () => { expect(failed(judgeHistory(twoRefines, { target: 'draft', port: 'rounds', feedback: [fb1, fb2] }))).toEqual([]); });
  it('fails a newest-first history, a stamped entry, a missing round, and a wrong feedback', () => {
    const swap = twoRefines.map((e) => (e === v2 ? draftDone([e2, e1]) : e));
    expect(failed(judgeHistory(swap, { target: 'draft', port: 'rounds', feedback: [fb1, fb2] })).length).toBeGreaterThan(0);
    const stamped = twoRefines.map((e) => (e === v1 ? draftDone([{ ...e1, at: '2026-11-08T00:00:00Z' }]) : e));
    // the extra key, and round 2's copy of round 1 no longer equals what round 1 recorded
    expect(failed(judgeHistory(stamped, { target: 'draft', port: 'rounds', feedback: [fb1, fb2] }))).toHaveLength(2);
    const short = twoRefines.map((e) => (e === v2 ? draftDone([e1]) : e));
    expect(failed(judgeHistory(short, { target: 'draft', port: 'rounds', feedback: [fb1, fb2] })).length).toBeGreaterThan(0);
    expect(failed(judgeHistory(twoRefines, { target: 'draft', port: 'rounds', feedback: [fb2, fb1] })).length).toBeGreaterThan(0);
  });
});

describe('judgeApprovalData', () => {
  const want = [lb(0, 2), lb(1, 2), lb(2, 2)] as Array<{ round: number; maxIterations: number; exhausted: boolean }>;
  it('passes each visit read in order', () => { expect(failed(judgeApprovalData(twoRefines, 'gate', want))).toEqual([]); });
  it('fails a round that never advances, and a missing visit', () => {
    const stale = twoRefines.map((e) => (e.type === 'interrupt.requested' ? req(String(e.payload?.['key']), 0) : e));
    expect(failed(judgeApprovalData(stale, 'gate', want))).toHaveLength(2);
    expect(failed(judgeApprovalData(oneRefine, 'gate', want)).length).toBeGreaterThan(0);
  });
});

describe('judgeWithdrawn', () => {
  it('passes an exhausted visit without refine', () => { expect(failed(judgeWithdrawn(twoRefines, 'gate'))).toEqual([]); });
  it('fails an exhausted visit that still offers refine', () => {
    const still = [...oneRefine, marker(2), started('draft'), v2, req('k2', 2)];
    expect(failed(judgeWithdrawn(still, 'gate'))).toHaveLength(1);
  });
});

describe('judgeFailExhausted', () => {
  const limit: Ev = { type: 'workflow.loopback-limit', sequence: 10, payload: { nodeId: 'gate', iterations: 1, limit: 1 } };
  const cap: Ev = { type: 'cap.breached', sequence: 11, payload: { kind: 'loopback-iterations', limit: 1, observed: 2 } };
  const fail: Ev = { type: 'run.failed', sequence: 12, payload: { error: { code: 'loop_limit_exceeded', message: 'x' }, failedNodeId: 'gate' } };
  it('passes the three events in order', () => { expect(failed(judgeFailExhausted([limit, cap, fail], 'gate', 1))).toEqual([]); });
  it('fails a missing limit event, a reordered sequence, a wrong code, and a missing failedNodeId', () => {
    expect(failed(judgeFailExhausted([cap, fail], 'gate', 1))).toHaveLength(2);
    expect(failed(judgeFailExhausted([{ ...cap, sequence: 9 }, limit, fail], 'gate', 1))).toHaveLength(1);
    expect(failed(judgeFailExhausted([limit, cap, { ...fail, payload: { error: { code: 'approval_rejected' }, failedNodeId: 'gate' } }], 'gate', 1))).toHaveLength(1);
    expect(failed(judgeFailExhausted([limit, cap, { ...fail, payload: { error: { code: 'loop_limit_exceeded' } } }], 'gate', 1))).toHaveLength(1);
  });
});

describe('judgeReplayRearm', () => {
  const seq = (evs: Ev[]): Ev[] => evs.map((e, i) => ({ ...e, sequence: i + 1 }));
  const fork = seq([...oneRefine]);
  it('passes a fork that re-arms and asks again', () => { expect(failed(judgeReplayRearm(fork, 'gate', 5))).toEqual([]); });
  it('fails a fork that decides round 1 again, or settles the run', () => {
    const redecided = seq([...oneRefine, { type: 'interrupt.resolved', nodeId: 'gate' }]);
    expect(failed(judgeReplayRearm(redecided, 'gate', 5))).toHaveLength(1);
    const settled = seq([started('draft'), v0, req('k0', 0), marker(1), { type: 'run.completed' }]);
    expect(failed(judgeReplayRearm(settled, 'gate', 5))).toHaveLength(2);
  });
});

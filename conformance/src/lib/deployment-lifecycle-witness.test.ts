/**
 * Self-tests for `deployment-lifecycle-witness.ts` (RFC 0082). Each judge
 * passes the conforming answer and FAILS the defect it exists to catch.
 */

import { describe, it, expect } from 'vitest';
import {
  activeOn, judgeBound, judgeCanaryAdjusted, judgeIllegalRefused, judgeList, judgePinned, judgeReplayPinned, judgeRolledBack,
  judgeScopeRefused, judgeStep, judgeValidationRefused, pickDraft,
} from './deployment-lifecycle-witness.js';

const failed = (fs: { ok: boolean; message: string }[]): string[] => fs.filter((f) => !f.ok).map((f) => f.message);
const ok = (): { ok: boolean; errors: string } => ({ ok: true, errors: '' });
const A = 'core.conformance.channel-agent';
const incumbent = { agentId: A, version: '1.0.0', state: 'active', channels: ['stable'] };
const draft = { agentId: A, version: '1.1.0', state: 'draft' };
const err = (status: number, code: string): { status: number; json: unknown } => ({ status, json: { error: { code, message: 'x', retriable: false } } });

describe('record pickers', () => {
  it('find the draft and the versions active on a channel', () => {
    expect(pickDraft([incumbent, draft])).toBe('1.1.0');
    expect(pickDraft([incumbent])).toBeUndefined();
    expect(activeOn([incumbent, draft, { ...incumbent, version: '0.9.0', channels: ['canary'] }], 'stable')).toEqual(['1.0.0']);
  });
});

describe('judgeList', () => {
  it('passes a list of valid records and fails a non-200, a non-array or a foreign record', () => {
    expect(failed(judgeList({ status: 200, json: [incumbent, draft] }, A, ok))).toEqual([]);
    expect(failed(judgeList({ status: 404, json: {} }, A, ok))).toHaveLength(1);
    expect(failed(judgeList({ status: 200, json: { items: [] } }, A, ok))).toHaveLength(1);
    expect(failed(judgeList({ status: 200, json: [{ ...draft, agentId: 'other' }] }, A, ok))).toHaveLength(1);
  });
});

describe('refusals', () => {
  it('pass a refusal that moved nothing and fail one that applied the transition', () => {
    expect(failed(judgeIllegalRefused('pause of a draft', err(409, 'x'), draft, [incumbent, draft]))).toEqual([]);
    expect(failed(judgeIllegalRefused('pause of a draft', { status: 200, json: { ...draft, state: 'paused' } }, draft, [incumbent, { ...draft, state: 'paused' }]))).toHaveLength(2);
    expect(failed(judgeScopeRefused(err(403, 'forbidden'), draft, [draft]))).toEqual([]);
    expect(failed(judgeScopeRefused({ status: 200, json: draft }, draft, [{ ...draft, state: 'test' }]))).toHaveLength(2);
    expect(failed(judgeValidationRefused('x', err(400, 'validation_error'), draft, [draft]))).toEqual([]);
    expect(failed(judgeValidationRefused('x', err(409, 'conflict'), draft, [draft]))).toHaveLength(2);
  });
});

describe('the legal walk', () => {
  it('passes a 200 in the target state and fails a refusal or a wrong state', () => {
    expect(failed(judgeStep({ status: 200, json: { ...draft, state: 'test' } }, '1.1.0', 'test', ok))).toEqual([]);
    expect(failed(judgeStep(err(400, 'validation_error'), '1.1.0', 'test', ok))).toHaveLength(1);
    expect(failed(judgeStep({ status: 200, json: { ...draft, state: 'staged' } }, '1.1.0', 'test', ok))).toHaveLength(1);
    expect(failed(judgeBound([{ ...draft, state: 'active', channels: ['stable'] }], '1.1.0', 'stable'))).toEqual([]);
    expect(failed(judgeBound([{ ...draft, state: 'active' }], '1.1.0', 'stable'))).toHaveLength(1);
  });
});

describe('the channel pin', () => {
  it('passes a recorded active version and fails a missing or foreign one', () => {
    expect(failed(judgePinned({ resolvedChannel: 'stable', resolvedAgentVersion: '1.0.0' }, 'stable', ['1.0.0']))).toEqual([]);
    expect(failed(judgePinned({ resolvedChannel: 'stable' }, 'stable', ['1.0.0']))).toHaveLength(1);
    expect(failed(judgePinned(undefined, 'stable', ['1.0.0']))).toHaveLength(1);
    expect(failed(judgeReplayPinned('1.0.0', '1.1.0', { resolvedAgentVersion: '1.0.0' }))).toEqual([]);
    expect(failed(judgeReplayPinned('1.0.0', '1.1.0', { resolvedAgentVersion: '1.1.0' }))).toHaveLength(1);
  });
});

describe('canary and rollback', () => {
  const active = { ...draft, state: 'active', channels: ['stable'] };
  it('passes the requested share and fails a host that ignored it', () => {
    expect(failed(judgeCanaryAdjusted({ status: 200, json: { ...active, canaryPercent: 50 } }, '1.1.0', 50, [{ ...active, canaryPercent: 50 }], ok))).toEqual([]);
    expect(failed(judgeCanaryAdjusted({ status: 200, json: active }, '1.1.0', 50, [active], ok))).toHaveLength(2);
  });
  it('passes a pointer at the restored active version and fails a missing or dangling pointer', () => {
    const rolled = { ...draft, state: 'rolled-back', rollbackPointer: '1.0.0' };
    expect(failed(judgeRolledBack({ status: 200, json: rolled }, '1.1.0', [incumbent, rolled], ok))).toEqual([]);
    expect(failed(judgeRolledBack({ status: 200, json: { ...draft, state: 'rolled-back' } }, '1.1.0', [incumbent, rolled], ok))).toHaveLength(2);
    expect(failed(judgeRolledBack({ status: 200, json: rolled }, '1.1.0', [{ ...incumbent, state: 'paused' }, rolled], ok))).toHaveLength(1);
  });
});

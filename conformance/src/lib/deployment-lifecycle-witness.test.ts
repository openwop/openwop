/**
 * Self-tests for `deployment-lifecycle-witness.ts` (RFC 0082). Each judge
 * passes the conforming answer and FAILS the defect it exists to catch.
 */

import { describe, it, expect } from 'vitest';
import {
  activeOn, challengeScopes, errorDetails, judgeBound, judgeCanaryAdjusted, judgeEventRecorded, judgeList, judgePinned,
  judgeReplayPinned, judgeResumed, judgeRolledBack, judgeRunLinked, judgeScopeRefused, judgeStateConflict, judgeStep,
  judgeValidationRefused, pickDraft, promotionPath, type Accepted,
} from './deployment-lifecycle-witness.js';

const failed = (fs: { ok: boolean; message: string }[]): string[] => fs.filter((f) => !f.ok).map((f) => f.message);
const ok = (): { ok: boolean; errors: string } => ({ ok: true, errors: '' });
const A = 'core.conformance.channel-agent';
const incumbent = { agentId: A, version: '1.0.0', state: 'active', channels: ['stable'] };
const draft = { agentId: A, version: '1.1.0', state: 'draft' };
const err = (status: number, code: string, details?: Record<string, unknown>): { status: number; json: unknown } =>
  ({ status, json: { error: code, message: 'x', ...(details === undefined ? {} : { details }) } });
const conflict = (state: string, transition: string): { status: number; json: unknown } => err(409, 'deployment_state_conflict', { state, transition });

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
    expect(failed(judgeStateConflict('pause of a draft', 'pause', conflict('draft', 'pause'), draft, [incumbent, draft]))).toEqual([]);
    expect(failed(judgeStateConflict('pause of a draft', 'pause', { status: 200, json: { ...draft, state: 'paused' } }, draft, [incumbent, { ...draft, state: 'paused' }]))).toHaveLength(5);
    expect(failed(judgeScopeRefused(err(403, 'forbidden'), draft, [draft]))).toEqual([]);
    expect(failed(judgeScopeRefused({ status: 200, json: draft }, draft, [{ ...draft, state: 'test' }]))).toHaveLength(3);
    expect(failed(judgeValidationRefused('x', err(400, 'validation_error'), draft, [draft]))).toEqual([]);
    expect(failed(judgeValidationRefused('x', err(409, 'conflict'), draft, [draft]))).toHaveLength(2);
  });
});

describe('the 409 state conflict (RFC 0254 §A)', () => {
  it('fails a 400, a bare 4xx, a missing or wrong details.state, and a wrong details.transition', () => {
    expect(failed(judgeStateConflict('x', 'pause', err(400, 'validation_error'), draft, [draft]))).toHaveLength(4);
    expect(failed(judgeStateConflict('x', 'pause', err(409, 'conflict'), draft, [draft]))).toHaveLength(3);
    expect(failed(judgeStateConflict('x', 'pause', err(409, 'deployment_state_conflict', { transition: 'pause' }), draft, [draft]))).toHaveLength(1);
    expect(failed(judgeStateConflict('x', 'pause', conflict('active', 'pause'), draft, [draft]))).toHaveLength(1);
    expect(failed(judgeStateConflict('x', 'pause', conflict('draft', 'promote'), draft, [draft]))).toHaveLength(1);
  });
  it('reads details at the root, and from a legacy nested envelope', () => {
    expect(errorDetails({ error: 'x', message: 'm', details: { state: 'draft' } })).toEqual({ state: 'draft' });
    expect(errorDetails({ error: { code: 'x', details: { state: 'draft' } } })).toEqual({ state: 'draft' });
  });
});

describe('the scope refusal (RFC 0254 §E)', () => {
  const r403 = (h?: string): { status: number; json: unknown; wwwAuthenticate?: string } => ({ ...err(403, 'forbidden'), ...(h === undefined ? {} : { wwwAuthenticate: h }) });
  it('passes no challenge or one naming deploy:*, and fails another scope or another code', () => {
    expect(failed(judgeScopeRefused(r403('Bearer error="insufficient_scope", scope="deploy:*"'), draft, [draft]))).toEqual([]);
    expect(failed(judgeScopeRefused(r403('Bearer error="insufficient_scope", scope="runs:read deploy:*"'), draft, [draft]))).toEqual([]);
    expect(failed(judgeScopeRefused(r403('Bearer error="insufficient_scope", scope="deploy:promote"'), draft, [draft]))).toHaveLength(1);
    expect(failed(judgeScopeRefused(r403('Bearer error="insufficient_scope"'), draft, [draft]))).toHaveLength(1);
    expect(failed(judgeScopeRefused(err(403, 'insufficient_scope'), draft, [draft]))).toHaveLength(1);
    expect(challengeScopes('Bearer realm="x"')).toBeUndefined();
  });
});

describe('the advertised path (RFC 0254 §B)', () => {
  it('is all four promotion states when states is absent, and the advertised ones in order over a subset', () => {
    expect(promotionPath(null)).toEqual(['draft', 'test', 'staged', 'active']);
    expect(promotionPath(['active', 'draft', 'staged'])).toEqual(['draft', 'staged', 'active']);
    expect(promotionPath(['draft', 'active', 'paused'])).toEqual(['draft', 'active']);
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
  it('passes a pointer at the restored incumbent and fails a missing, dangling or foreign pointer', () => {
    const rolled = { ...draft, state: 'rolled-back', rollbackPointer: '1.0.0' };
    expect(failed(judgeRolledBack({ status: 200, json: rolled }, '1.1.0', ['1.0.0'], [incumbent, rolled], ok))).toEqual([]);
    expect(failed(judgeRolledBack({ status: 200, json: { ...draft, state: 'rolled-back' } }, '1.1.0', ['1.0.0'], [incumbent, rolled], ok))).toHaveLength(2);
    expect(failed(judgeRolledBack({ status: 200, json: rolled }, '1.1.0', ['1.0.0'], [{ ...incumbent, state: 'paused' }, rolled], ok))).toHaveLength(1);
    // Another active version, not the incumbent: the pointer is wrong even though it is listed active.
    const other = { ...draft, state: 'rolled-back', rollbackPointer: '0.9.0' };
    expect(failed(judgeRolledBack({ status: 200, json: other }, '1.1.0', ['1.0.0'], [incumbent, { ...incumbent, version: '0.9.0' }, other], ok))).toHaveLength(1);
  });
});

describe('the resume (RFC 0254 §A)', () => {
  const paused = { ...incumbent, state: 'paused' };
  it('passes pause then promote back to active and fails a refused or a stuck resume', () => {
    expect(failed(judgeResumed({ status: 200, json: paused }, { status: 200, json: incumbent }, '1.0.0', [incumbent], ok))).toEqual([]);
    expect(failed(judgeResumed({ status: 200, json: paused }, conflict('paused', 'promote'), '1.0.0', [paused], ok))).toHaveLength(1);
    expect(failed(judgeResumed({ status: 200, json: paused }, { status: 200, json: paused }, '1.0.0', [paused], ok))).toHaveLength(2);
    expect(failed(judgeResumed(conflict('active', 'pause'), null, '1.0.0', [incumbent], ok))).toHaveLength(1);
  });
});

describe('the management run (RFC 0254 §D)', () => {
  const typeOf = (v1: string): string => v1.replace('canary.adjusted', 'canary-adjusted').replace('state.changed', 'state-changed');
  const strict = (keys: string[]) => (p: unknown): { ok: boolean; errors: string } => {
    const extra = Object.keys(p as object).filter((k) => !keys.includes(k));
    return { ok: extra.length === 0, errors: extra.join(',') };
  };
  const V = {
    deploymentPromoted: strict(['agentId', 'toVersion', 'toState', 'fromVersion', 'channel', 'canaryPercent']),
    deploymentStateChanged: strict(['agentId', 'version', 'fromState', 'toState']),
    deploymentCanaryAdjusted: strict(['agentId', 'version', 'fromPercent', 'toPercent']),
    deploymentRolledBack: strict(['agentId', 'fromVersion', 'toVersion', 'rollbackPointer', 'reason']),
  };
  const acc = (transition: string, fromState: string, json: Record<string, unknown>): Accepted => ({ label: transition, transition, version: '1.1.0', fromState, answer: { status: 200, json } });
  const test = acc('promote', 'draft', { ...draft, state: 'test', transitionRunId: 'run-m1' });
  it('requires transitionRunId on every 200 record', () => {
    expect(failed(judgeRunLinked([test]))).toEqual([]);
    expect(failed(judgeRunLinked([test, acc('promote', 'test', { ...draft, state: 'staged' })]))).toHaveLength(1);
  });
  it('passes the matching content-free event and fails a missing, mismatched, leaking or unreadable one', () => {
    const ev = (type: string, payload: Record<string, unknown>) => ({ type, payload });
    const promoted = ev('deployment.promoted', { agentId: A, toVersion: '1.1.0', toState: 'test' });
    expect(failed(judgeEventRecorded(test, [promoted], typeOf, V))).toEqual([]);
    expect(failed(judgeEventRecorded(test, [], typeOf, V))).toHaveLength(1);
    expect(failed(judgeEventRecorded(test, [ev('deployment.promoted', { agentId: A, toVersion: '1.1.0', toState: 'staged' })], typeOf, V))).toHaveLength(1);
    expect(failed(judgeEventRecorded(test, [ev('deployment.promoted', { agentId: A, toVersion: '1.1.0', toState: 'test', manifest: { prompt: 'x' } })], typeOf, V))).toHaveLength(1);
    expect(failed(judgeEventRecorded(test, undefined, typeOf, V))).toHaveLength(1);
    const resumed = acc('promote', 'paused', { ...draft, state: 'active', transitionRunId: 'run-m2' });
    expect(failed(judgeEventRecorded(resumed, [ev('deployment.state-changed', { agentId: A, version: '1.1.0', fromState: 'paused', toState: 'active' })], typeOf, V))).toEqual([]);
    const rolled = acc('rollback', 'active', { ...draft, state: 'rolled-back', rollbackPointer: '1.0.0', transitionRunId: 'run-m3' });
    expect(failed(judgeEventRecorded(rolled, [ev('deployment.rolled-back', { agentId: A, fromVersion: '1.1.0', toVersion: '1.0.0', rollbackPointer: '1.0.0' })], typeOf, V))).toEqual([]);
    expect(failed(judgeEventRecorded(rolled, [ev('deployment.rolled-back', { agentId: A, fromVersion: '1.1.0', toVersion: '0.9.0', rollbackPointer: '0.9.0' })], typeOf, V))).toHaveLength(1);
    const canary = acc('adjust-canary', 'active', { ...draft, state: 'active', canaryPercent: 50, transitionRunId: 'run-m4' });
    expect(failed(judgeEventRecorded(canary, [ev('deployment.canary-adjusted', { agentId: A, version: '1.1.0', fromPercent: 100, toPercent: 50 })], typeOf, V))).toEqual([]);
  });
});

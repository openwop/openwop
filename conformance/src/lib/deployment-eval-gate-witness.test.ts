/**
 * Self-tests for `deployment-eval-gate-witness.ts` (RFC 0082 §E). The judges
 * pass a `422 eval_gate_unmet` that left the record alone, and FAIL a host
 * that promoted anyway, refused with another status or code, or moved the
 * record while refusing.
 */

import { describe, it, expect } from 'vitest';
import { judgeGateRefused, judgeRecordUnchanged, pickPromotable } from './deployment-eval-gate-witness.js';

const failed = (fs: { ok: boolean; message: string }[]): string[] => fs.filter((f) => !f.ok).map((f) => f.message);
const refusal = { status: 422, json: { error: { code: 'eval_gate_unmet', message: 'eval run did not pass', retriable: false } } };
const staged = { agentId: 'core.conformance.agents.scripted', version: '1.0.0', state: 'staged', channels: [] };

describe('pickPromotable', () => {
  it('picks the first draft, test or staged record and nothing else', () => {
    expect(pickPromotable([{ version: '0.9.0', state: 'active' }, staged])).toEqual(staged);
    expect(pickPromotable([{ version: '0.9.0', state: 'active' }, { version: '0.8.0', state: 'deprecated' }])).toBeUndefined();
    expect(pickPromotable({ items: [staged] })).toBeUndefined();
  });
});

describe('judgeGateRefused', () => {
  it('passes 422 eval_gate_unmet', () => {
    expect(failed(judgeGateRefused(refusal))).toEqual([]);
  });
  it('fails a host that promoted', () => {
    expect(failed(judgeGateRefused({ status: 200, json: { ...staged, state: 'active' } }))).toHaveLength(2);
  });
  it('fails a refusal with another status or code', () => {
    expect(failed(judgeGateRefused({ status: 403, json: refusal.json }))).toHaveLength(1);
    expect(failed(judgeGateRefused({ status: 422, json: { error: { code: 'validation_error', message: 'x', retriable: false } } }))).toHaveLength(1);
  });
});

describe('judgeRecordUnchanged', () => {
  it('passes a record left as it was', () => {
    expect(failed(judgeRecordUnchanged(staged, [{ ...staged }]))).toEqual([]);
  });
  it('fails a record moved to active, bound to a channel, or gone', () => {
    expect(failed(judgeRecordUnchanged(staged, [{ ...staged, state: 'active' }]))).toHaveLength(1);
    expect(failed(judgeRecordUnchanged(staged, [{ ...staged, channels: ['stable'] }]))).toHaveLength(1);
    expect(failed(judgeRecordUnchanged(staged, [{ ...staged, version: '2.0.0' }]))).toHaveLength(1);
  });
});

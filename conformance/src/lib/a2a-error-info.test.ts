/**
 * Self-test for a2a-error-info.ts (RFC 0211). These are the sabotages the
 * host-facing legs exist to catch, run against the comparator itself so the gate
 * proves each one turns red without needing a host that serves A2A 1.0.
 */
import { describe, it, expect } from 'vitest';
import { errorInfos, normaliseErrorData, isOpenwopEnvelope, ERROR_INFO_TYPE } from './a2a-error-info.js';

const info = (reason: string, metadata?: Record<string, string>): Record<string, unknown> => ({ '@type': ERROR_INFO_TYPE, reason, domain: 'a2a-protocol.org', ...(metadata ? { metadata } : {}) });
const same = (a: unknown, b: unknown, ida?: string, idb?: string): boolean => JSON.stringify(normaliseErrorData(a, ida)) === JSON.stringify(normaliseErrorData(b, idb));

describe('a2a-error-info (RFC 0211)', () => {
  it('finds the ErrorInfo in an Any[] and nothing in a legacy object', () => {
    expect(errorInfos([info('TASK_NOT_FOUND')]).map((e) => e.reason)).toEqual(['TASK_NOT_FOUND']);
    expect(errorInfos({ reason: 'TASK_NOT_FOUND' })).toEqual([]);
    expect(errorInfos([{ '@type': 'type.googleapis.com/google.rpc.BadRequest' }])).toEqual([]);
  });

  it('the old key comparison was vacuous: two one-element arrays that disclose differently share keys ["0"]', () => {
    const unknown = [info('TASK_NOT_FOUND', { taskId: 't/1' })];
    const foreign = [info('TASK_NOT_FOUND', { taskId: 't/2', scope: 'tenant' })];
    expect(Object.keys(unknown)).toEqual(Object.keys(foreign));
    expect(same(unknown, foreign, 't/1', 't/2')).toBe(false); // sabotage: metadata.scope only on the foreign answer
  });

  it('an echo of the requested id is not a difference', () => {
    expect(same([info('TASK_NOT_FOUND', { taskId: 'a/1' })], [info('TASK_NOT_FOUND', { taskId: 'b/2' })], 'a/1', 'b/2')).toBe(true);
  });

  it('each defect the data-shape leg names is visible to the comparator', () => {
    const good = [info('TASK_NOT_FOUND')];
    expect(same(good, { reason: 'TASK_NOT_FOUND' })).toBe(false); // object, not array
    expect(same(good, [])).toBe(false); // empty array
    expect(same(good, [info('TaskNotFound')])).toBe(false); // wrong reason
    expect(same(good, [{ ...info('TASK_NOT_FOUND'), domain: 'openwop.dev' }])).toBe(false); // wrong domain
  });

  it('recognises the OpenWOP envelope and never a JSON-RPC error', () => {
    expect(isOpenwopEnvelope({ error: 'not_found', message: 'no such run' })).toBe(true);
    expect(isOpenwopEnvelope({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'x', data: [info('TASK_NOT_FOUND')] } })).toBe(false);
    expect(isOpenwopEnvelope(null)).toBe(false);
  });
});

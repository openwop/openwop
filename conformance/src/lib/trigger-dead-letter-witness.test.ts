/**
 * The trigger dead-letter read witness (RFC 0232), proven in both directions.
 * No host serves the read yet, so each case turns one defect on in an
 * otherwise conforming page and checks the judge convicts exactly that rule.
 * The validator is the real one, over the committed v1 page schema.
 */

import { describe, expect, it } from 'vitest';
import { deadLetterFacet, judge, validatePage, type DeadLetterRead, type DeadLetterRule, type RefusedPost } from './trigger-dead-letter-witness.js';

const SUB = 'sub-0232';
const POST: RefusedPost = {
  subscriptionId: SUB,
  canary: 'openwop-canary-0123456789abcdef01',
  signature: 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  signingSecret: 'whsec_c2VjcmV0LWtleS1ieXRlcw==',
  retentionDays: 7,
};

function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subscriptionId: SUB,
    attemptEventId: 'evt-1',
    attempt: { subscriptionId: SUB, dedupKey: 'k-opaque-1', attempt: 1, outcome: 'dead-lettered' },
    reason: 'verification_failed',
    deadLetteredAt: '2026-10-03T12:00:00Z',
    expiresAt: '2026-10-10T12:00:00Z',
    ...over,
  };
}
const page = (...deliveries: Array<Record<string, unknown>>): DeadLetterRead => ({ status: 200, json: { deliveries } });
const failed = (read: DeadLetterRead): DeadLetterRule[] => judge(read, POST).filter((f) => !f.ok).map((f) => f.rule);

describe('trigger-dead-letter-witness (RFC 0232 §E)', () => {
  it('a conforming page passes every rule', () => {
    const findings = judge(page(record()), POST);
    expect(findings.map((f) => f.rule).sort()).toEqual(['attempt-shape', 'content-free', 'no-state-change', 'page-valid', 'present', 'retention']);
    expect(findings.filter((f) => !f.ok)).toEqual([]);
  });

  it('a record carrying the canary fails content-free (and the closed schema)', () => {
    expect(failed(page(record({ body: `{"x":"${POST.canary}"}` })))).toEqual(['page-valid', 'content-free']);
  });

  it('the canary smuggled into an open attempt field still fails content-free', () => {
    const r = record({ attempt: { subscriptionId: SUB, dedupKey: 'k', attempt: 1, outcome: 'dead-lettered', note: POST.canary } });
    expect(failed(page(r))).toEqual(['content-free']);
  });

  it('a record carrying the signature or the signing key fails content-free', () => {
    expect(failed(page(record({ attemptEventId: POST.signature })))).toEqual(['content-free']);
    expect(failed(page(record({ attemptEventId: POST.signingSecret.replace(/^whsec_/, '') })))).toEqual(['content-free']);
  });

  it('a page missing the refused delivery fails present', () => {
    expect(failed(page())).toEqual(['present']);
    expect(failed(page(record({ reason: 'retries_exhausted' })))).toEqual(['present']);
    expect(failed(page(record({ subscriptionId: 'another-sub' })))).toEqual(['present']);
  });

  it('an attempt that does not validate fails', () => {
    const r = record({ attempt: { subscriptionId: SUB, dedupKey: 'k', attempt: 1, outcome: 'delivered' } });
    expect(failed(page(r))).toEqual(['page-valid', 'attempt-shape']);
    expect(failed(page(record({ attempt: { subscriptionId: SUB, outcome: 'dead-lettered' } })))).toEqual(['page-valid']);
  });

  it('a refused post that carries a stateChange fails no-state-change', () => {
    const r = record({ stateChange: { subscriptionId: SUB, source: 'webhook', fromState: 'active', toState: 'failed', reason: 'signature-invalid' } });
    expect(failed(page(r))).toEqual(['no-state-change']);
  });

  it('expiresAt that does not match retentionDays fails retention', () => {
    expect(failed(page(record({ expiresAt: '2026-10-04T12:00:00Z' })))).toEqual(['retention']);
  });

  it('a host that does not serve the read fails at once', () => {
    expect(judge({ status: 404, json: { error: 'not_found' } }, POST).map((f) => [f.rule, f.ok])).toEqual([['page-valid', false]]);
  });

  it('the facet is read from either discovery layout', () => {
    expect(deadLetterFacet({ triggerBridge: { supported: true, deadLetter: { retentionDays: 7, maxPageSize: 100 } } })).toEqual({ retentionDays: 7, maxPageSize: 100 });
    expect(deadLetterFacet({ capabilities: { triggerBridge: { deadLetter: { retentionDays: 3, maxPageSize: 10 } } } })).toEqual({ retentionDays: 3, maxPageSize: 10 });
    expect(deadLetterFacet({ triggerBridge: { supported: true } })).toBeNull();
    expect(deadLetterFacet(null)).toBeNull();
  });

  it('the committed page schema accepts a conforming page and refuses an unknown root key', () => {
    expect(validatePage({ deliveries: [record()] }).ok).toBe(true);
    expect(validatePage({ deliveries: [], extra: 1 }).ok).toBe(false);
  });
});

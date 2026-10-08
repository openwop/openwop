/**
 * Self-test double for `purpose-relay-witness.ts`: each defect a host could have on
 * the onward hop fails its leg, and a conformant relay passes.
 */
import { describe, it, expect } from 'vitest';
import { textOf, relaysOf, labelOf, judgeReemit, judgeEmpty, type PeerSend } from './purpose-relay-witness.js';

const LABEL = ['openwop-conformance-analytics', 'openwop-conformance-support'];
const send = (text: string, permittedPurposes?: unknown): PeerSend => ({
  body: { jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text }], ...(permittedPurposes !== undefined ? { metadata: { openwop: { permittedPurposes } } } : {}) } } },
});

describe('purpose-relay witness', () => {
  it('finds the relay of one inbound message by its nonce, in 1.0 and 0.3 part shapes', () => {
    const v03: PeerSend = { body: { params: { message: { parts: [{ kind: 'text', text: 'relay n-2' }] } } } };
    expect(relaysOf([send('relay n-1'), v03, send('other')], 'n-2')).toEqual([v03]);
    expect(textOf(send('a').body)).toBe('a');
  });

  it('a conformant relay re-emits the label, or narrows it', () => {
    expect(judgeReemit(LABEL, labelOf(send('x', LABEL).body))).toEqual({ ok: true });
    expect(judgeReemit(LABEL, labelOf(send('x', [LABEL[0]]).body))).toEqual({ ok: true });
  });

  it('defect: the label is dropped on the onward hop', () => {
    expect(judgeReemit(LABEL, labelOf(send('x').body)).ok).toBe(false);
  });

  it('defect: the onward label widens the received one', () => {
    const v = judgeReemit(LABEL, labelOf(send('x', [...LABEL, 'advertising']).body));
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toContain('advertising');
  });

  it('defect: an onward call is made for []-labelled data', () => {
    expect(judgeEmpty(1, 1)).toMatchObject({ ok: false });
    expect(judgeEmpty(1, 0)).toEqual({ ok: true });
  });

  it('without a control relay, a missing call under [] is blocked, not a pass', () => {
    expect(judgeEmpty(0, 0)).toBe('blocked');
  });
});

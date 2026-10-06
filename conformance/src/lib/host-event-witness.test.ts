/**
 * Self-test for `host-event-witness.ts`: each judge passes a conforming
 * observation and convicts one injected defect (RFC 0236 §A–§E).
 */
import { describe, it, expect } from 'vitest';
import {
  advertisedTypes, exampleType, judgeEnvelope, judgeHostBody, judgeNoFanOut, judgeNoResume, judgeTenantScope, type AdvertisedType, type Frame,
} from './host-event-witness.js';
import { v2Validator } from './v2.js';

const hostEvent = v2Validator('host-event');
const delivery = v2Validator('webhook-delivery');
const D = { type: 'example.thing-happened', delivery: 'durable' as const };
const E = { type: 'example.thing-noticed', delivery: 'ephemeral' as const };
const env = (eventId: string, type: string, deliveryClass: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ eventId, type, timestamp: '2026-10-05T12:00:00Z', delivery: deliveryClass, payload: {}, ...extra });
const frame = (eventId: string, t: AdvertisedType = D, id: string | null = eventId, extra: Record<string, unknown> = {}): Frame =>
  ({ event: t.type, data: env(eventId, t.type, t.delivery, extra), id });
const allOk = (fs: readonly { ok: boolean }[]): boolean => fs.every((f) => f.ok);

describe('host-event-witness judges', () => {
  it('reads the advertised types and picks the example types', () => {
    const types = advertisedTypes({ types: [D, E, { type: 'acme.x' }] });
    expect(types).toEqual([D, E]);
    expect(exampleType(types, 'durable')).toBe(D.type);
    expect(exampleType(types, 'ephemeral')).toBe(E.type);
  });

  it('envelope: passes a conforming durable and ephemeral frame', () => {
    expect(allOk(judgeEnvelope([frame('hev-0000000000000001')], 'hev-0000000000000001', D, hostEvent))).toBe(true);
    expect(allOk(judgeEnvelope([frame('hev-0000000000000002', E, null)], 'hev-0000000000000002', E, hostEvent))).toBe(true);
  });

  it.each([
    ['a runId on the envelope', [frame('hev-0000000000000003', D, 'hev-0000000000000003', { runId: 'acme/r-0000000000000001' })], D],
    ['a sequence on the envelope', [frame('hev-0000000000000003', D, 'hev-0000000000000003', { sequence: 4 })], D],
    ['the wrong event: label', [{ ...frame('hev-0000000000000003'), event: 'message' }], D],
    ['a durable frame without id:', [frame('hev-0000000000000003', D, null)], D],
    ['an ephemeral frame with id:', [frame('hev-0000000000000003', E, 'hev-0000000000000003')], E],
    ['the wrong delivery class', [{ ...frame('hev-0000000000000003'), data: env('hev-0000000000000003', D.type, 'ephemeral') }], D],
    ['no frame at all', [], D],
  ] as const)('envelope: convicts %s', (_name, frames, adv) => {
    expect(allOk(judgeEnvelope(frames, 'hev-0000000000000003', adv, hostEvent))).toBe(false);
  });

  it('no-resume and no-fan-out convict a redelivered or webhooked ephemeral event', () => {
    expect(judgeNoResume([frame('hev-0000000000000001')], 'hev-0000000000000009').ok).toBe(true);
    expect(judgeNoResume([frame('hev-0000000000000009', E, null)], 'hev-0000000000000009').ok).toBe(false);
    expect(judgeNoFanOut(['{"hostEvent":{"eventId":"hev-0000000000000001"}}'], 'hev-0000000000000009').ok).toBe(true);
    expect(judgeNoFanOut(['{"hostEvent":{"eventId":"hev-0000000000000009"}}'], 'hev-0000000000000009').ok).toBe(false);
  });

  it('host body: passes a conforming delivery and convicts each defect', () => {
    const body = JSON.stringify({ hostEvent: JSON.parse(env('hev-0000000000000005', D.type, 'durable')) });
    expect(allOk(judgeHostBody(body, D.type, true, 'hev-0000000000000005', D.type, delivery))).toBe(true);
    const pseudoRun = JSON.stringify({ runId: 'hostext:example.thing-happened', event: JSON.parse(env('hev-0000000000000005', D.type, 'durable')) });
    expect(allOk(judgeHostBody(pseudoRun, D.type, true, 'hev-0000000000000005', D.type, delivery))).toBe(false);
    expect(allOk(judgeHostBody(body, 'run.completed', true, 'hev-0000000000000005', D.type, delivery))).toBe(false);
    expect(allOk(judgeHostBody(body, D.type, false, 'hev-0000000000000005', D.type, delivery))).toBe(false);
  });

  it('tenant scope: convicts a cross-tenant delivery and a vacuous own stream', () => {
    const f = [frame('hev-0000000000000006')];
    expect(allOk(judgeTenantScope(f, [], 'hev-0000000000000006'))).toBe(true);
    expect(allOk(judgeTenantScope(f, f, 'hev-0000000000000006'))).toBe(false);
    expect(allOk(judgeTenantScope([], [], 'hev-0000000000000006'))).toBe(false);
  });
});

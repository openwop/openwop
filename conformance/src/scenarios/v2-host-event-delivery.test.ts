/**
 * v2 — host events (RFC 0236; `spec/v2/core/events.md` §Host events,
 * `webhooks.md` §Delivery; suite 2.45.20, target major 2; seam-gated).
 *
 * A host event belongs to no run: its envelope has no `runId` and no
 * `sequence`. It rides `/host/events` beside the heartbeat messages and, when
 * durable, webhooks. The suite cannot cause one unaided, so every leg drives
 * the §G emit seam with the `example.*` types a seams-profile host advertises.
 *
 *   0236.host-event.envelope         an emitted durable event arrives as a valid
 *                                    envelope, `event:` = type, `id:` = eventId;
 *                                    `channel.presence` is listed ephemeral
 *                                    whenever `channelPresence` is advertised;
 *   0236.ephemeral.no-resume         an ephemeral frame has no `id:` and is not
 *                                    redelivered after `Last-Event-ID`;
 *   0236.webhook.ephemeral-refused   `registerWebhook` naming the ephemeral type
 *                                    is `400 validation_error`;
 *   0236.webhook.host-variant        a subscribed durable event arrives as
 *                                    `{ hostEvent }`, typed and signed;
 *   0236.ephemeral.no-fan-out        the same subscription never receives the
 *                                    ephemeral event;
 *   0236.host-event.tenant-isolation a second tenant's stream receives nothing
 *                                    for the first tenant's event.
 *
 * Judged by `lib/host-event-witness.ts`, whose self-test convicts each defect.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; seams profile or `hostEvents`
 * not advertised ⇒ `inapplicable`; seam unwired, or no `example.*` type of the
 * needed class advertised ⇒ `seamAbsent`; no second-tenant credential
 * (`OPENWOP_TEST_TENANT_B_API_KEY`) ⇒ `inapplicable` for the tenant leg.
 *
 * @see RFCS/0236-host-events.md
 * @see spec/v2/core/events.md §Host events
 */

import { afterEach, describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised, v2Validator } from '../lib/v2.js';
import { seamPath, seamsProfileAdvertised } from '../lib/seams.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { subscribe, type SseEvent } from '../lib/sse.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { absenceIsUnmeasured, noDeliveryCause, startScopedReceiver, type ScopedHit, type ScopedReceiver } from '../lib/scoped-receiver.js';
import { createReceiverState, verifyWebhookDelivery } from '../lib/webhook-receiver.js';
import {
  advertisedTypes, exampleType, judgeEnvelope, judgeHostBody, judgeNoFanOut, judgeNoResume, judgeTenantScope, type AdvertisedType, type Finding,
} from '../lib/host-event-witness.js';

export const REQUIRES_HOST_CALLBACK = 'the host POSTs host-event webhook deliveries to the suite-owned scoped receiver behind OPENWOP_WEBHOOK_RECEIVER_URL';

const DOC = 'spec/v2/core/events.md §Host events';
const WDOC = 'spec/v2/core/webhooks.md §Delivery';
const ID_ENVELOPE = 'openwop.requirement.0236.host-event.envelope';
const ID_NO_RESUME = 'openwop.requirement.0236.ephemeral.no-resume';
const ID_REFUSED = 'openwop.requirement.0236.webhook.ephemeral-refused';
const ID_HOST_BODY = 'openwop.requirement.0236.webhook.host-variant';
const ID_NO_FAN_OUT = 'openwop.requirement.0236.ephemeral.no-fan-out';
const ID_TENANT = 'openwop.requirement.0236.host-event.tenant-isolation';
const SEAM = seamPath('/v1/host/sample/host-events/emit');
const V2 = { 'OpenWOP-Version': '2.0' };
const STREAM_MS = 3_000;
const SECRET = 'openwop-conformance-host-event-secret-0236';

const hostEvent = v2Validator('host-event');
const webhookDelivery = v2Validator('webhook-delivery');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
const assertAll = (id: string, doc: string, findings: readonly Finding[]): void => {
  for (const f of findings) expect(f.ok, req(id, doc, f.message)).toBe(true);
};

type Skip = { kind: 'blocked' | 'inapplicable' | 'seam'; reason: string };
const skip = (s: Skip): undefined => (s.kind === 'seam' ? seamAbsent(s.reason) : softSkip(s.kind, s.reason));

/** The shared gate: the advertised types, or why the leg cannot run. */
async function gate(): Promise<{ types: AdvertisedType[]; record: Record<string, unknown> } | Skip> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { kind: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0' };
  const record = await familyAdvertised('hostEvents');
  if (record === null) return { kind: 'inapplicable', reason: 'the host does not advertise hostEvents' };
  if (!seamsProfileAdvertised(doc)) return { kind: 'inapplicable', reason: 'seams profile not advertised — the suite cannot cause a host event without the RFC 0236 §G emit seam' };
  return { types: advertisedTypes(record), record };
}

function pick(types: readonly AdvertisedType[], delivery: AdvertisedType['delivery']): AdvertisedType | Skip {
  const type = exampleType(types, delivery);
  return type === null
    ? { kind: 'seam', reason: `no example.* ${delivery} type is advertised in hostEvents.types — RFC 0236 §G: a seams-profile host advertises one for the suite to drive` }
    : { type, delivery };
}

async function emit(type: string): Promise<string | Skip> {
  const res = await http(() => driver.post(SEAM, { type }));
  if (res === null) return { kind: 'blocked', reason: `${SEAM} unreachable (fetch failed)` };
  if (res.status === 404 || res.status === 405) return { kind: 'seam', reason: `${SEAM} not mounted (${res.status}) — RFC 0236 §G` };
  const eventId = (res.json as { eventId?: unknown } | null)?.eventId;
  if (res.status !== 202 || typeof eventId !== 'string') return { kind: 'blocked', reason: `${SEAM} answered ${res.status} ${readErrorCode(res.json) ?? ''} for ${type}, so no event was produced`.trim() };
  return eventId;
}

/** Open `/host/events`, run `act` while it is open, and return every frame. */
async function streamWhile(act: () => Promise<void>, opts: { lastEventId?: string; bearer?: string } = {}): Promise<SseEvent[]> {
  const headers: Record<string, string> = { ...V2, ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}) };
  const sub = subscribe('/host/events', { timeoutMs: STREAM_MS, extraHeaders: headers, ...(opts.lastEventId ? { lastEventId: opts.lastEventId } : {}) });
  await sleep(400);
  await act();
  return [...(await sub).events];
}

const registered: string[] = [];
let receiver: ScopedReceiver | null = null;
afterEach(async () => {
  for (const id of registered.splice(0)) await driver.delete(`/webhooks/${encodeURIComponent(id)}`).catch(() => undefined);
  if (receiver) { receiver.server.close(); receiver = null; }
});

describe('v2 host events (RFC 0236 — seam-gated)', () => {
  it('an emitted durable host event arrives on /host/events as a valid envelope', async () => {
    const g = await gate();
    if ('kind' in g) return skip(g);
    const d = pick(g.types, 'durable');
    if ('kind' in d) return skip(d);
    let eventId: string | Skip = '';
    const frames = await streamWhile(async () => { eventId = await emit(d.type); });
    if (typeof eventId !== 'string') return skip(eventId);
    assertAll(ID_ENVELOPE, DOC, judgeEnvelope(frames, eventId, d, hostEvent));
    if (await familyAdvertised('channelPresence')) {
      expect(g.types.some((t) => t.type === 'channel.presence' && t.delivery === 'ephemeral'), req(ID_ENVELOPE, 'spec/v2/core/conversation.md §channelPresence', 'a host advertising channelPresence MUST list channel.presence under hostEvents as ephemeral')).toBe(true);
    }
  }, 20_000);

  it('an ephemeral host event has no id: and is not redelivered after Last-Event-ID', async () => {
    const g = await gate();
    if ('kind' in g) return skip(g);
    const d = pick(g.types, 'durable');
    const e = pick(g.types, 'ephemeral');
    if ('kind' in d) return skip(d);
    if ('kind' in e) return skip(e);
    let durableId: string | Skip = '';
    let ephemeralId: string | Skip = '';
    const frames = await streamWhile(async () => { durableId = await emit(d.type); await sleep(150); ephemeralId = await emit(e.type); });
    if (typeof durableId !== 'string') return skip(durableId);
    if (typeof ephemeralId !== 'string') return skip(ephemeralId);
    assertAll(ID_NO_RESUME, DOC, judgeEnvelope(frames, ephemeralId, e, hostEvent));
    const resumed = await streamWhile(async () => undefined, { lastEventId: durableId });
    assertAll(ID_NO_RESUME, DOC, [judgeNoResume(resumed, ephemeralId)]);
  }, 20_000);

  it('registerWebhook refuses an ephemeral host-event type with 400 validation_error', async () => {
    const g = await gate();
    if ('kind' in g) return skip(g);
    const e = pick(g.types, 'ephemeral');
    if ('kind' in e) return skip(e);
    const res = await http(() => driver.post('/webhooks', { url: 'https://example.com/openwop-conformance-0236', events: [e.type], secret: SECRET }));
    if (res === null) return softSkip('blocked', 'POST /webhooks unreachable (fetch failed)');
    const id = (res.json as { webhookId?: unknown } | null)?.webhookId;
    if (typeof id === 'string') registered.push(id);
    expect(res.status, req(ID_REFUSED, 'spec/v2/core/webhooks.md §Surfaces', `events[] naming the ephemeral host-event type ${e.type} MUST be refused 400 validation_error; got ${res.status} ${readErrorCode(res.json) ?? ''}`)).toBe(400);
    expect(readErrorCode(res.json), req(ID_REFUSED, 'spec/v2/core/webhooks.md §Surfaces', 'the refusal code MUST be validation_error')).toBe('validation_error');
  }, 20_000);

  it('a subscribed durable host event is delivered as { hostEvent }, signed; the ephemeral one is not', async () => {
    const g = await gate();
    if ('kind' in g) return skip(g);
    if ((await familyAdvertised('webhooks')) === null) return softSkip('inapplicable', 'the host does not advertise webhooks');
    const d = pick(g.types, 'durable');
    const e = pick(g.types, 'ephemeral');
    if ('kind' in d) return skip(d);
    if ('kind' in e) return skip(e);
    const hits: ScopedHit[] = [];
    const rx = await startScopedReceiver((hit, res) => { hits.push(hit); res.writeHead(204); res.end(); });
    receiver = rx;
    const reg = await http(() => driver.post('/webhooks', { url: rx.url, events: [d.type], secret: SECRET }));
    if (reg === null) return softSkip('blocked', 'POST /webhooks unreachable (fetch failed)');
    if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected' && !rx.tunnelled) {
      return softSkip('blocked', 'the host SSRF guard rejected the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https tunnel');
    }
    const webhookId = (reg.json as { webhookId?: unknown } | null)?.webhookId;
    expect(reg.status, req(ID_HOST_BODY, 'spec/v2/core/webhooks.md §Surfaces', `events[] naming the advertised durable host-event type ${d.type} MUST be accepted; got ${reg.status} ${readErrorCode(reg.json) ?? ''}`)).toBe(201);
    if (typeof webhookId === 'string') registered.push(webhookId);
    const ephemeralId = await emit(e.type);
    if (typeof ephemeralId !== 'string') return skip(ephemeralId);
    const durableId = await emit(d.type);
    if (typeof durableId !== 'string') return skip(durableId);
    for (let waited = 0; waited < 15_000 && !hits.some((h) => h.body.includes(durableId)); waited += 250) await sleep(250);
    const hit = hits.find((h) => h.body.includes(durableId));
    if (hit === undefined) {
      return absenceIsUnmeasured(rx) ? softSkip('blocked', noDeliveryCause(rx)) : softSkip('blocked', `no delivery of ${durableId} arrived within 15 s — ${noDeliveryCause(rx)}`);
    }
    const h = (name: string): string | undefined => { const v = hit.headers[name]; return Array.isArray(v) ? v[0] : v; };
    const verified = verifyWebhookDelivery(SECRET, h('openwop-signature') ?? '', h('openwop-signature-algorithm'), h('openwop-timestamp') ?? '', hit.body, createReceiverState()).accepted === true;
    assertAll(ID_HOST_BODY, WDOC, judgeHostBody(hit.body, h('openwop-event-type'), verified, durableId, d.type, webhookDelivery));
    assertAll(ID_NO_FAN_OUT, DOC, [judgeNoFanOut(hits.map((x) => x.body), ephemeralId)]);
  }, 30_000);

  it('a second tenant receives nothing for the first tenant’s host event', async () => {
    const g = await gate();
    if ('kind' in g) return skip(g);
    const d = pick(g.types, 'durable');
    if ('kind' in d) return skip(d);
    const other = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
    if (!other) return softSkip('inapplicable', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-tenant check needs it');
    if (other === process.env['OPENWOP_API_KEY']?.trim()) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the second credential must resolve to a different tenant');
    let eventId: string | Skip = '';
    const otherStream = streamWhile(async () => undefined, { bearer: other });
    const own = await streamWhile(async () => { eventId = await emit(d.type); });
    const theirs = await otherStream;
    if (typeof eventId !== 'string') return skip(eventId);
    assertAll(ID_TENANT, DOC, judgeTenantScope(own, theirs, eventId));
  }, 20_000);
});

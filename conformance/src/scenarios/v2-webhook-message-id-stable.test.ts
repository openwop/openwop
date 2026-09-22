/**
 * RFC 0201 §C.10 — the signed delivery id is stable across retries and
 * distinct across deliveries (suite 2.36.0, target major 2; gated on
 * `webhooks.signatureAlgorithms` listing `standard-webhooks-1`).
 *
 * `webhook-id` is the receiver's idempotency key, and because it is inside the
 * Standard Webhooks signed bytes it is an AUTHENTICATED one. That only helps if
 * the host keeps it still: a per-attempt id makes a durable host's retries look
 * like new events, and a constant id makes new events look like retries.
 *
 * How the receiver is driven: `fail2` answers `500` to the first two attempts
 * for each `(OpenWOP-Webhook-Id, runId, sequence)` and `204` afterwards, so
 * every delivery is attempted at least twice (retries are a v2 MUST,
 * webhooks.md §Durability). Two opted-in subscriptions to the SAME URL, each on
 * `run.started` + `run.completed`, give four distinct deliveries of one run:
 * two by event, two by subscription.
 *
 * Observe first, then assert (the 2.34.1 lesson): if no delivery key was seen
 * twice inside the window, the leg returns `blocked` before any obligation is
 * asserted, so an unmeasured window can never fold into a partial-witness pass.
 *
 * How it FAILS: a per-attempt `randomUUID()` id (first half); a constant id or
 * the subscription id (the distinctness half); an id containing `.` (grammar).
 * The restart half of §C.10 (an attempt after a host restart) needs the RFC
 * 0158 kill hook and is NOT claimed by this file.
 *
 * @see spec/v2/core/webhooks.md §Standard Webhooks
 * @see RFCS/0201-standard-webhooks-signature-scheme.md §C.10
 */

import { afterEach, describe, it, expect } from 'vitest';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { hitHeader, mintWhsec, startModalReceiver, STANDARD_WEBHOOKS_ID, type ModalHit } from '../lib/webhook-receiver.js';
import { retryWaitCapMs, retryWaitFor } from '../lib/webhook-retry-window.js';
import {
  STANDARD_WEBHOOKS_ALG,
  deliveriesFor,
  driveRun,
  loopbackRefusal,
  registerSw,
  swGate,
  unregisterAllSw,
  waitFor,
} from '../lib/standard-webhooks.js';

const EVENTS = ['run.started', 'run.completed'];
const CAP_MS = retryWaitCapMs();

let closeReceiver: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unregisterAllSw();
  if (closeReceiver) { const c = closeReceiver; closeReceiver = null; await c(); }
});

function keyOf(h: ModalHit): string {
  let runId = '';
  let seq = '';
  try {
    const b = JSON.parse(h.body) as { runId?: unknown; event?: { sequence?: unknown } };
    runId = String(b.runId ?? '');
    seq = String(b.event?.sequence ?? '');
  } catch { /* keyed on the header alone */ }
  return `${hitHeader(h, 'openwop-webhook-id') ?? ''}|${runId}|${seq}`;
}

describe('RFC 0201 §C.10 — webhook-id is stable across retries, distinct across deliveries', () => {
  it('every attempt of one delivery carries one webhook-id, and distinct deliveries carry distinct ids', async () => {
    const g = await swGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const rx = await startModalReceiver();
    closeReceiver = rx.close;
    const target = rx.urlFor('fail2');
    const subs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const reg = await registerSw({ url: target.url, events: EVENTS, signatureAlgorithms: ['v1', STANDARD_WEBHOOKS_ALG], secret: mintWhsec() });
      const blocked = loopbackRefusal(reg, target.tunnelled);
      if (blocked) return softSkip('blocked', blocked);
      if (reg.status !== 201) return softSkip('blocked', `the opt-in registration answered ${reg.status} ${readErrorCode(reg.json) ?? ''} — no subscription to observe (the registration rules are v2-webhook-standard-webhooks-delivery's rows)`);
      subs.push((reg.json as { webhookId: string }).webhookId);
    }
    const run = await driveRun();
    if (run.runId === null) return softSkip('blocked', `POST /runs answered ${run.status} — no delivery to observe`);
    const ours = (): ModalHit[] => subs.flatMap((s) => deliveriesFor(rx.hits, s, run.runId));
    const byKey = (): Map<string, ModalHit[]> => {
      const m = new Map<string, ModalHit[]>();
      for (const h of ours()) m.set(keyOf(h), [...(m.get(keyOf(h)) ?? []), h]);
      return m;
    };
    const expectedKeys = subs.length * EVENTS.length;
    const window = retryWaitFor((g.facet['retryPolicy'] as { backoff?: string } | undefined) ?? null, CAP_MS);
    await waitFor(() => {
      const m = byKey();
      return m.size >= expectedKeys && [...m.values()].every((a) => a.length >= 2);
    }, window);
    const keys = byKey();
    const retried = [...keys.values()].filter((a) => a.length >= 2);
    // OBSERVE FIRST: nothing is asserted until the window question is answered.
    if (retried.length === 0) {
      return softSkip('blocked', `no delivery was attempted twice inside the ${window}ms window (${ours().length} attempt(s) over ${keys.size} key(s)); the receiver answers 500 twice per key, so a retrying host shows two — unmeasured, not unmet (RFC 0148 §A)`);
    }
    const ID = 'openwop.requirement.0201.message-id-stable';
    for (const [key, attempts] of retried.map((a) => [keyOf(a[0]!), a] as const)) {
      const ids = new Set(attempts.map((a) => hitHeader(a, 'webhook-id') ?? '<absent>'));
      expect(
        [...ids],
        req(ID, 'RFC 0201 §C.10', `webhook-id MUST be identical on every attempt of one (webhookId, runId, sequence) — ${attempts.length} attempts of ${key} carried ${ids.size} value(s)`),
      ).toHaveLength(1);
    }
    const perKey = [...keys.entries()].map(([key, a]) => ({ key, id: hitHeader(a[0]!, 'webhook-id') ?? '' }));
    for (const { key, id } of perKey) {
      expect(STANDARD_WEBHOOKS_ID.test(id), req(ID, 'RFC 0201 §C.10', `webhook-id MUST match ^[A-Za-z0-9_-]{16,128}$ (${key}: ${JSON.stringify(id)})`)).toBe(true);
    }
    expect(keys.size, req(ID, 'RFC 0201 §C.10', `two opted-in subscriptions on ${EVENTS.join(' + ')} MUST yield ${expectedKeys} distinct deliveries of one run`)).toBeGreaterThanOrEqual(2);
    expect(
      new Set(perKey.map((k) => k.id)).size,
      req(ID, 'RFC 0201 §C.10', `webhook-id MUST differ between distinct deliveries, by event and by subscription — ${perKey.length} deliveries carried ${new Set(perKey.map((k) => k.id)).size} distinct id(s)`),
    ).toBe(perKey.length);
    for (const { id } of perKey) {
      expect(subs.includes(id), req(ID, 'RFC 0201 §C.11', 'webhook-id MUST NOT be the subscription id')).toBe(false);
    }
  }, CAP_MS + 45_000);
});

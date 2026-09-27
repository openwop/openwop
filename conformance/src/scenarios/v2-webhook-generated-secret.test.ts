/**
 * RFC 0221 — a secret the host generates is returned once (`spec/v2/core/webhooks.md`
 * §Surfaces; suite 2.42.8, target major 2; gated on the `webhooks` family and the
 * `conformance-noop` fixture).
 *
 * `registerWebhook` makes `secret` optional. When the request omits it, the host
 * MUST generate one and return it in the `201` as `secret`, the only time it
 * appears on the wire, and every delivery to that subscription MUST verify under
 * it (`OpenWOP-Signature`, scheme `v1`). When the request supplies a secret, the
 * `201` MUST NOT echo it (RFC 0201 §B.6, now for every subscription).
 *
 * How it FAILS: a `201` without `secret` for a secret-less registration (the
 * subscriber can never verify a delivery); a returned secret the deliveries are
 * not signed with; a `201` that echoes a supplied secret.
 *
 * @see spec/v2/core/webhooks.md §Surfaces
 * @see RFCS/0221-generated-webhook-secret-returned-once.md
 */

import { afterEach, describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { hitHeader, startModalReceiver, type ModalHit } from '../lib/webhook-receiver.js';
import { SW_FIXTURE, deliveriesFor, driveRun, loopbackRefusal, registerSw, unregisterAllSw, waitFor } from '../lib/standard-webhooks.js';

const ID = 'openwop.requirement.0221.generated-secret-returned';
const SPEC = 'RFC 0221 · webhooks.md §Surfaces';

let closeReceiver: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unregisterAllSw();
  if (closeReceiver) { const c = closeReceiver; closeReceiver = null; await c(); }
});

function v1SignedBy(secret: string, h: ModalHit): boolean {
  const ts = hitHeader(h, 'openwop-timestamp');
  return ts !== undefined && hitHeader(h, 'openwop-signature') === `sha256=${createHmac('sha256', secret).update(`${ts}.${h.body}`, 'utf8').digest('hex')}`;
}

describe('RFC 0221 — a host-generated webhook secret is returned once', () => {
  it('a secret-less registration returns the generated secret, and deliveries verify under it; a supplied secret is never echoed', async () => {
    let doc: Record<string, unknown> | null = null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
    if (!fixtures.includes(SW_FIXTURE)) return softSkip('inapplicable', `${SW_FIXTURE} fixture not advertised — no run to deliver`);

    const rx = await startModalReceiver();
    closeReceiver = rx.close;
    const target = rx.urlFor('no-echo');
    const reg = await registerSw({ url: target.url, events: ['run.completed'] });
    const refused = loopbackRefusal(reg, target.tunnelled);
    if (refused) return softSkip('blocked', refused);
    if (reg.status !== 201) return softSkip('blocked', `registerWebhook answered ${reg.status} ${readErrorCode(reg.json) ?? ''} — webhooks.md §Surfaces owns that contract`);

    const body = reg.json as { webhookId: string; secret?: unknown };
    expect(typeof body.secret === 'string' && body.secret.length > 0, req(ID, SPEC, 'a registration that omits secret MUST get the host-generated secret back in the 201 as a non-empty string')).toBe(true);
    const secret = body.secret as string;

    const run = await driveRun();
    expect(run.status, req(ID, 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    await waitFor(() => deliveriesFor(rx.hits, body.webhookId, run.runId).length > 0, 15_000);
    const delivery = deliveriesFor(rx.hits, body.webhookId, run.runId)[0];
    expect(delivery, req(ID, 'webhooks.md §Durability', 'the subscription MUST receive the run.completed delivery')).toBeDefined();
    expect(v1SignedBy(secret, delivery!), req(ID, SPEC, 'the delivery MUST verify (OpenWOP-Signature, scheme v1) under the secret the 201 returned')).toBe(true);

    const supplied = `conformance-${'s'.repeat(24)}`;
    const own = await registerSw({ url: rx.urlFor('no-echo').url, events: ['run.completed'], secret: supplied });
    expect(own.status, req(ID, SPEC, `a registration with a supplied secret MUST answer 201 (got ${own.status} ${readErrorCode(own.json) ?? ''})`)).toBe(201);
    expect(own.text.includes(supplied) || (own.json as { secret?: unknown }).secret !== undefined, req(ID, 'RFC 0221 · RFC 0201 §B.6', 'the 201 MUST NOT echo a supplied secret')).toBe(false);
  });
});

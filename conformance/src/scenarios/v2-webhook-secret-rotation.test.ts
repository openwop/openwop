/**
 * RFC 0201 §E — multi-signature secret rotation (suite 2.36.0, target major 2;
 * gated on `webhooks.signatureAlgorithms` listing `standard-webhooks-1` AND the
 * `webhooks.secretRotation` facet).
 *
 * After `POST /webhooks/{webhookId}/rotate-secret`, for `overlapSeconds`, every
 * delivery's `webhook-signature` MUST carry exactly one entry under the new
 * secret and one under the previous secret, and `OpenWOP-Signature` stays on the
 * previous secret; afterwards only the new secret signs. The route is tenant-
 * checked before lookup (`403 id_tenant_mismatch`), refuses a subscription that
 * did not opt in (`400 validation_error`), and returns no secret.
 *
 * The post-overlap leg waits for `previousSecretExpiresAt` only when
 * `overlapSeconds` fits inside the suite's retry-wait cap
 * (`OPENWOP_WEBHOOK_RETRY_WAIT_MS`, operator-raisable). Past the cap it is not
 * observed, and the row says so with a `partial-witness:` detail — which the
 * acceptance predicate refuses to cite as `executed-pass` (RFC 0201 §Falsifiability).
 *
 * How it FAILS: signing only with the new secret (one entry); moving
 * `OpenWOP-Signature` to the new secret at rotation; a foreign-tenant id that
 * reaches the lookup (`404` instead of `403`); a response that echoes the secret.
 *
 * @see spec/v2/core/webhooks.md §Standard Webhooks
 * @see RFCS/0201-standard-webhooks-signature-scheme.md §E
 */

import { afterEach, describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { projectBoundId } from '../lib/bound-id.js';
import { retryWaitCapMs } from '../lib/webhook-retry-window.js';
import { hitHeader, mintWhsec, startModalReceiver, verifyStandardWebhooks, type ModalHit } from '../lib/webhook-receiver.js';
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

const CAP_MS = retryWaitCapMs();

let closeReceiver: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unregisterAllSw();
  if (closeReceiver) { const c = closeReceiver; closeReceiver = null; await c(); }
});

function v1SignedBy(secret: string, h: ModalHit): boolean {
  const ts = hitHeader(h, 'openwop-timestamp');
  return ts !== undefined && hitHeader(h, 'openwop-signature') === `sha256=${createHmac('sha256', secret).update(`${ts}.${h.body}`, 'utf8').digest('hex')}`;
}

async function oneDelivery(rx: { hits: ModalHit[] }, webhookId: string): Promise<{ runStatus: number; delivery: ModalHit | undefined }> {
  const run = await driveRun();
  await waitFor(() => deliveriesFor(rx.hits, webhookId, run.runId).length > 0, 15_000);
  return { runStatus: run.status, delivery: deliveriesFor(rx.hits, webhookId, run.runId)[0] };
}

describe('RFC 0201 §E — secret rotation overlaps, then retires (gated on webhooks.secretRotation)', () => {
  it('a rotation dual-signs for overlapSeconds, keeps OpenWOP-Signature on the previous secret, and is tenant-checked', async () => {
    const g = await swGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const rot = g.facet['secretRotation'] as { overlapSeconds?: unknown } | undefined;
    if (!rot || typeof rot.overlapSeconds !== 'number') return softSkip('inapplicable', 'webhooks.secretRotation not advertised (RFC 0201 §E.18) — rotateWebhookSecret is not offered');
    const overlapSeconds = rot.overlapSeconds;
    const rx = await startModalReceiver();
    closeReceiver = rx.close;
    const target = rx.urlFor('echo');
    const s1 = mintWhsec();
    const s2 = mintWhsec();
    const reg = await registerSw({ url: target.url, events: ['run.completed'], signatureAlgorithms: ['v1', STANDARD_WEBHOOKS_ALG], secret: s1 });
    const blocked = loopbackRefusal(reg, target.tunnelled);
    if (blocked) return softSkip('blocked', blocked);
    if (reg.status !== 201) return softSkip('blocked', `the opt-in registration answered ${reg.status} ${readErrorCode(reg.json) ?? ''} — nothing to rotate`);
    const webhookId = (reg.json as { webhookId: string }).webhookId;
    const plain = await registerSw({ url: rx.urlFor('no-echo').url, events: ['run.completed'] });

    const ID = 'openwop.requirement.0201.secret-rotation';
    // Tenant check BEFORE lookup: a well-formed id in a tenant that is not the
    // caller's, which therefore cannot exist for this caller.
    const ownTenant = webhookId.slice(0, webhookId.indexOf('/'));
    const foreign = `${ownTenant === 'openwop-conformance-foreign' ? 'openwop-conformance-other' : 'openwop-conformance-foreign'}/${'a'.repeat(22)}`;
    const cross = await driver.post(`/webhooks/${projectBoundId(foreign)}/rotate-secret`, { secret: s2 });
    expect(cross.status, req(ID, 'RFC 0201 §E.18 / identity.md §5', `a foreign-tenant webhookId MUST be refused 403 before the lookup (got ${cross.status})`)).toBe(403);
    expect(readErrorCode(cross.json), req(ID, 'RFC 0201 §E.18', 'the foreign-tenant refusal MUST carry id_tenant_mismatch')).toBe('id_tenant_mismatch');
    if (plain.status === 201) {
      const plainId = (plain.json as { webhookId: string }).webhookId;
      const notOpted = await driver.post(`/webhooks/${projectBoundId(plainId)}/rotate-secret`, { secret: s2 });
      expect(notOpted.status, req(ID, 'RFC 0201 §E.18', `rotating a subscription that did not opt in MUST be refused 400 validation_error (got ${notOpted.status})`)).toBe(400);
    }

    const rotated = await driver.post(`/webhooks/${projectBoundId(webhookId)}/rotate-secret`, { secret: s2 });
    expect(rotated.status, req(ID, 'RFC 0201 §E.18', `rotateWebhookSecret MUST answer 200 on an opted-in subscription (got ${rotated.status} ${readErrorCode(rotated.json) ?? ''})`)).toBe(200);
    const body = rotated.json as { rotatedAt?: string; previousSecretExpiresAt?: string };
    const span = Date.parse(body.previousSecretExpiresAt ?? '') - Date.parse(body.rotatedAt ?? '');
    expect(Math.abs(span - overlapSeconds * 1000) <= 1000, req(ID, 'RFC 0201 §E.19', `previousSecretExpiresAt MUST be rotatedAt + overlapSeconds (${overlapSeconds}s; got ${span}ms)`)).toBe(true);
    expect(rotated.text.includes(s2) || rotated.text.includes(s2.slice(6)), req(ID, 'RFC 0201 §E.19', 'the rotation response MUST carry no secret')).toBe(false);

    const during = await oneDelivery(rx, webhookId);
    expect(during.runStatus, req(ID, 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    expect(during.delivery, req(ID, 'webhooks.md §Durability', 'the rotated subscription MUST keep receiving deliveries')).toBeDefined();
    const d = during.delivery!;
    const underNew = verifyStandardWebhooks(d.body, d.headers, s2);
    const underOld = verifyStandardWebhooks(d.body, d.headers, s1);
    expect(underNew.entries.length, req(ID, 'RFC 0201 §E.20', `during the overlap webhook-signature MUST carry exactly two entries (got ${underNew.entries.length})`)).toBe(2);
    expect(underNew.matched, req(ID, 'RFC 0201 §E.20', 'one entry MUST verify under the new secret')).toBe(1);
    expect(underOld.matched, req(ID, 'RFC 0201 §E.20', 'one entry MUST verify under the previous secret')).toBe(1);
    expect(v1SignedBy(s1, d), req(ID, 'RFC 0201 §E.20', 'OpenWOP-Signature MUST stay on the previous secret during the overlap')).toBe(true);

    // After the overlap: only when it fits the operator's wait cap.
    const expiresAt = Date.parse(body.previousSecretExpiresAt ?? '');
    if (expiresAt - Date.now() > CAP_MS) {
      return softSkip('inapplicable', `the post-overlap leg is not observed: overlapSeconds (${overlapSeconds}) exceeds the suite wait cap (${CAP_MS}ms; raise OPENWOP_WEBHOOK_RETRY_WAIT_MS to witness it)`);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, expiresAt - Date.now()) + 1_500));
    const after = await oneDelivery(rx, webhookId);
    expect(after.delivery, req(ID, 'webhooks.md §Durability', 'the subscription MUST keep receiving deliveries after the overlap')).toBeDefined();
    const a = after.delivery!;
    const aNew = verifyStandardWebhooks(a.body, a.headers, s2);
    expect(aNew.entries.length, req(ID, 'RFC 0201 §E.20', `after previousSecretExpiresAt webhook-signature MUST carry one entry (got ${aNew.entries.length})`)).toBe(1);
    expect(aNew.matched, req(ID, 'RFC 0201 §E.20', 'the one entry MUST verify under the new secret')).toBe(1);
    expect(verifyStandardWebhooks(a.body, a.headers, s1).matched, req(ID, 'RFC 0201 §E.20', 'the previous secret MUST NOT sign anything after previousSecretExpiresAt')).toBe(0);
    expect(v1SignedBy(s2, a), req(ID, 'RFC 0201 §E.20', 'OpenWOP-Signature MUST move to the new secret at previousSecretExpiresAt')).toBe(true);
  }, CAP_MS + 90_000);
});

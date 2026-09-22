/**
 * RFC 0201 §A–§C — the Standard Webhooks companion scheme on the wire
 * (suite 2.36.0, target major 2; gated on `webhooks.signatureAlgorithms`
 * listing `standard-webhooks-1`).
 *
 * Three legs, one requirement id each:
 *
 *   1. `opt-in-only` — a registration WITHOUT `signatureAlgorithms`, aimed at a
 *      receiver that never echoes a challenge, still gets `201`; the receiver
 *      sees no verification request; its deliveries carry no `webhook-*`
 *      header. A host that verifies, or adds the headers for, everyone fails.
 *   2. `registration-validated` — the opt-in is checked (no `v1`, a repeated
 *      value, an unadvertised id, a missing / non-`whsec_` / 8-byte secret are
 *      each `400 validation_error`), a valid opt-in's `201` echoes the applied
 *      list, and no response body carries the secret or its key bytes.
 *   3. `delivery-signed` — an opted-in delivery carries the five `OpenWOP-*`
 *      headers verifying under scheme `v1` with `OpenWOP-Signature-Algorithm:
 *      v1`, AND a `webhook-signature` entry verifying over
 *      `{webhook-id}.{webhook-timestamp}.{rawBody}` with the decoded secret, a
 *      `webhook-timestamp` equal to `OpenWOP-Timestamp`, and a `webhook-id`
 *      that is not the subscription id. The verifier is the suite's own
 *      (`webhook-receiver.ts`), pinned to the upstream library's test vector.
 *
 * How each FAILS (the sabotage run before citing a row):
 *   (a) webhook-* added to every subscription            → leg 1
 *   (b) verification run for a non-opted registration     → leg 1 (no-echo ⇒ 400)
 *   (c) `webhook-signature` computed over `ts.body`        → leg 3
 *   (d) `standard-webhooks-1` in OpenWOP-Signature-Algorithm → leg 3
 *   (e) webhook-timestamp ≠ OpenWOP-Timestamp              → leg 3
 *   (f) `["standard-webhooks-1"]` accepted without `v1`    → leg 2
 *
 * @see spec/v2/core/webhooks.md §Standard Webhooks
 * @see RFCS/0201-standard-webhooks-signature-scheme.md §B, §C
 */

import { afterEach, describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import {
  decodeWhsec,
  hitHeader,
  mintWhsec,
  startModalReceiver,
  STANDARD_WEBHOOKS_ID,
  verifyStandardWebhooks,
} from '../lib/webhook-receiver.js';
import {
  STANDARD_WEBHOOKS_ALG,
  deliveriesFor,
  driveRun,
  loopbackRefusal,
  registerSw,
  standardWebhooksHeaderNames,
  swGate,
  unregisterAllSw,
  waitFor,
} from '../lib/standard-webhooks.js';

const DELIVERY_WAIT_MS = 15_000;

let closeReceiver: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unregisterAllSw();
  if (closeReceiver) { const c = closeReceiver; closeReceiver = null; await c(); }
});

function v1Verifies(secret: string, h: { headers: Record<string, string | string[] | undefined>; body: string }): boolean {
  const ts = hitHeader(h, 'openwop-timestamp');
  const sig = hitHeader(h, 'openwop-signature');
  if (ts === undefined || sig === undefined) return false;
  return sig === `sha256=${createHmac('sha256', secret).update(`${ts}.${h.body}`, 'utf8').digest('hex')}`;
}

describe('RFC 0201 — Standard Webhooks companion scheme (gated on standard-webhooks-1)', () => {
  it('a subscription that did not opt in is neither verified nor given webhook-* headers', async () => {
    const g = await swGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const rx = await startModalReceiver();
    closeReceiver = rx.close;
    const target = rx.urlFor('no-echo');
    const reg = await registerSw({ url: target.url, events: ['run.completed'] });
    const blockedReg = loopbackRefusal(reg, target.tunnelled);
    if (blockedReg) return softSkip('blocked', blockedReg);
    const ID = 'openwop.requirement.0201.opt-in-only';
    expect(
      reg.status,
      req(ID, 'RFC 0201 §B.8 / §D.15', `a registration without signatureAlgorithms MUST NOT be verified — against an endpoint that never echoes a challenge it MUST still answer 201 (got ${reg.status} ${readErrorCode(reg.json) ?? ''})`),
    ).toBe(201);
    const webhookId = (reg.json as { webhookId: string }).webhookId;
    const run = await driveRun();
    expect(run.status, req(ID, 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    await waitFor(() => deliveriesFor(rx.hits, webhookId, run.runId).length > 0, DELIVERY_WAIT_MS);
    expect(
      rx.hits.filter((h) => h.mode === 'no-echo' && h.verification).length,
      req(ID, 'RFC 0201 §D.15', 'the receiver MUST see no verification request for a subscription that did not opt in'),
    ).toBe(0);
    const ours = deliveriesFor(rx.hits, webhookId, run.runId);
    expect(ours.length, req(ID, 'webhooks.md §Durability', 'the host MUST deliver run.completed for this run to the registered subscriber (a leg with no delivery would witness nothing)')).toBeGreaterThan(0);
    for (const d of ours) {
      expect(
        standardWebhooksHeaderNames(d),
        req(ID, 'RFC 0201 §B.8', 'a delivery to a subscription that did not opt in MUST NOT carry any webhook-* header'),
      ).toEqual([]);
      expect(hitHeader(d, 'openwop-signature-algorithm'), req(ID, 'webhooks.md §Headers', 'OpenWOP-Signature-Algorithm stays v1')).toBe('v1');
    }
  }, 45_000);

  it('the opt-in is validated, its 201 echoes the applied list, and no response carries the secret', async () => {
    const g = await swGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const rx = await startModalReceiver();
    closeReceiver = rx.close;
    const target = rx.urlFor('echo');
    const secret = mintWhsec();
    const base = { url: target.url, events: ['run.completed'] };
    const ID = 'openwop.requirement.0201.registration-validated';
    const refusals: Array<[string, Record<string, unknown>]> = [
      ['standard-webhooks-1 without v1', { ...base, signatureAlgorithms: [STANDARD_WEBHOOKS_ALG], secret }],
      ['a repeated value', { ...base, signatureAlgorithms: ['v1', 'v1', STANDARD_WEBHOOKS_ALG], secret }],
      ['an id the host does not list', { ...base, signatureAlgorithms: ['v1', 'openwop-conformance-unlisted-9'], secret }],
      ['an opt-in with no secret', { ...base, signatureAlgorithms: ['v1', STANDARD_WEBHOOKS_ALG] }],
      ['a secret not in whsec_ form', { ...base, signatureAlgorithms: ['v1', STANDARD_WEBHOOKS_ALG], secret: 'plain-shared-secret-of-sufficient-length' }],
      ['a whsec_ secret of 8 bytes', { ...base, signatureAlgorithms: ['v1', STANDARD_WEBHOOKS_ALG], secret: `whsec_${Buffer.alloc(8, 7).toString('base64')}` }],
    ];
    const bodies: string[] = [];
    for (const [label, body] of refusals) {
      const res = await registerSw(body);
      const blockedRes = loopbackRefusal(res, target.tunnelled);
      if (blockedRes) return softSkip('blocked', blockedRes);
      bodies.push(res.text);
      expect(res.status, req(ID, 'RFC 0201 §B.5–§B.6', `${label} MUST be refused 400 validation_error (got ${res.status})`)).toBe(400);
      expect(readErrorCode(res.json), req(ID, 'RFC 0201 §B.5–§B.6', `${label} MUST carry the code validation_error`)).toBe('validation_error');
    }
    const ok = await registerSw({ ...base, signatureAlgorithms: ['v1', STANDARD_WEBHOOKS_ALG], secret });
    const blockedOk = loopbackRefusal(ok, target.tunnelled);
    if (blockedOk) return softSkip('blocked', blockedOk);
    bodies.push(ok.text);
    expect(ok.status, req(ID, 'RFC 0201 §B / §D.14', `a valid opt-in against an echoing endpoint MUST answer 201 (got ${ok.status} ${readErrorCode(ok.json) ?? ''})`)).toBe(201);
    const applied = (ok.json as { signatureAlgorithms?: unknown } | null)?.signatureAlgorithms;
    expect(
      Array.isArray(applied) ? [...(applied as string[])].sort() : applied,
      req(ID, 'RFC 0201 §B.7', 'the 201 MUST carry signatureAlgorithms — the list the dispatcher will apply'),
    ).toEqual(['standard-webhooks-1', 'v1']);
    const key = decodeWhsec(secret)!;
    const leaks = [secret, secret.slice('whsec_'.length), key.toString('hex'), key.toString('base64url')];
    for (const b of bodies) {
      for (const l of leaks) {
        expect(b.includes(l), req(ID, 'RFC 0201 §B.6', 'the host MUST NOT return the supplied secret (or its key bytes) in any response')).toBe(false);
      }
    }
  }, 45_000);

  it('an opted-in delivery is dual-signed and its Standard Webhooks signature covers the id', async () => {
    const g = await swGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const rx = await startModalReceiver();
    closeReceiver = rx.close;
    const target = rx.urlFor('echo');
    const secret = mintWhsec();
    const reg = await registerSw({ url: target.url, events: ['run.completed'], signatureAlgorithms: ['v1', STANDARD_WEBHOOKS_ALG], secret });
    const blockedReg = loopbackRefusal(reg, target.tunnelled);
    if (blockedReg) return softSkip('blocked', blockedReg);
    const ID = 'openwop.requirement.0201.delivery-signed';
    expect(reg.status, req(ID, 'RFC 0201 §B', `the opt-in registration MUST answer 201 (got ${reg.status} ${readErrorCode(reg.json) ?? ''})`)).toBe(201);
    const webhookId = (reg.json as { webhookId: string }).webhookId;
    const run = await driveRun();
    expect(run.status, req(ID, 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    await waitFor(() => deliveriesFor(rx.hits, webhookId, run.runId).length > 0, DELIVERY_WAIT_MS);
    const ours = deliveriesFor(rx.hits, webhookId, run.runId);
    expect(ours.length, req(ID, 'webhooks.md §Durability', 'the host MUST deliver run.completed for this run to the opted-in subscriber')).toBeGreaterThan(0);
    const d = ours[0]!;
    expect(hitHeader(d, 'openwop-signature-algorithm'), req(ID, 'RFC 0201 §A.2', 'OpenWOP-Signature-Algorithm MUST stay v1 on an opted-in delivery (never standard-webhooks-1)')).toBe('v1');
    for (const h of ['openwop-webhook-id', 'openwop-event-type', 'openwop-timestamp', 'openwop-signature']) {
      expect(hitHeader(d, h), req(ID, 'RFC 0201 §C.9', `every header the host sends today MUST still be sent — ${h}`)).toBeDefined();
    }
    expect(v1Verifies(secret, d), req(ID, 'RFC 0201 §C.9', 'OpenWOP-Signature MUST verify under scheme v1 keyed by the secret string as issued')).toBe(true);
    const wid = hitHeader(d, 'webhook-id');
    expect(wid !== undefined && STANDARD_WEBHOOKS_ID.test(wid), req(ID, 'RFC 0201 §C.10', `webhook-id MUST match ^[A-Za-z0-9_-]{16,128}$ (got ${String(wid)})`)).toBe(true);
    expect(wid, req(ID, 'RFC 0201 §C.11', 'webhook-id MUST NOT be the subscription id carried in OpenWOP-Webhook-Id')).not.toBe(hitHeader(d, 'openwop-webhook-id'));
    expect(hitHeader(d, 'webhook-timestamp'), req(ID, 'RFC 0201 §C.9', 'webhook-timestamp MUST equal OpenWOP-Timestamp')).toBe(hitHeader(d, 'openwop-timestamp'));
    const verdict = verifyStandardWebhooks(d.body, d.headers, secret);
    expect(
      verdict.matched,
      req(ID, 'RFC 0201 §C.9', `at least one webhook-signature entry MUST verify over {webhook-id}.{webhook-timestamp}.{rawBody} with the decoded secret (verifier: ${verdict.reason ?? 'ok'}; ${verdict.entries.length} entr${verdict.entries.length === 1 ? 'y' : 'ies'})`),
    ).toBeGreaterThan(0);
    // The control that separates "signs the id" from "signs ts.body": the
    // verifier recomputes over the id, so a host that left the id out of the
    // signed bytes already failed above. Recompute with a different id and
    // confirm it does NOT match, so the pass above is attributable to the id.
    const forged = verifyStandardWebhooks(d.body, { ...d.headers, 'webhook-id': `${wid ?? ''}X` }, secret);
    expect(forged.matched, req(ID, 'RFC 0201 §C.9', 'the signature MUST cover webhook-id — recomputing with a different id MUST NOT match')).toBe(0);
  }, 45_000);
});

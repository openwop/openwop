/**
 * Unit tests for `webhook-receiver.ts` — the signature-header contract.
 *
 * This verifier is the reference a subscriber implementer copies. It required
 * `v1=` and therefore rejected, as malformed, the exact header `webhooks.md`
 * §"Delivery headers" mandates (`X-openwop-Signature: sha256={hex}`). The
 * divergence survived because `webhook-receiver-adversarial.test.ts` signs with
 * `signPayload` and verifies with `verifyWebhookDelivery` — a closed loop that is
 * self-consistent and wrong, and so green against every host. These cases pin the
 * header against the SPEC rather than against the suite's own output.
 *
 * @see webhook-receiver.ts, spec/v1/webhooks.md §"Delivery headers"
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  SIGNATURE_PREFIX,
  createReceiverState,
  verifyWebhookDelivery,
  signPayload,
} from './webhook-receiver.js';

const SECRET = 'shhh-not-a-real-secret';
const BODY = JSON.stringify({ event: { type: 'run.completed' } });

/** Build the header exactly as `webhooks.md` documents it, not as we emit it. */
function specShapedHeader(ts: number): string {
  const hex = createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex');
  return `sha256=${hex}`;
}

describe('webhook-receiver: the X-openwop-Signature prefix follows the spec', () => {
  it('the constant is the spec value, not the algorithm-header value', () => {
    // `v1` names the SIGNING SCHEME (X-openwop-Signature-Algorithm). It is not
    // the encoding prefix. One value, two fields — the conflation this fixes.
    expect(SIGNATURE_PREFIX).toBe('sha256=');
  });

  it('ACCEPTS a header built to the spec by hand, with no help from signPayload', () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyWebhookDelivery(
      SECRET,
      specShapedHeader(ts),
      'v1',
      String(ts),
      BODY,
      createReceiverState(),
    );
    expect(result.accepted).toBe(true);
  });

  it('REJECTS the pre-2026-08-19 `v1=` prefix as malformed — the shape the spec never defined', () => {
    const ts = Math.floor(Date.now() / 1000);
    const hex = createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex');
    const result = verifyWebhookDelivery(
      SECRET,
      `v1=${hex}`,
      'v1',
      String(ts),
      BODY,
      createReceiverState(),
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toBe('malformed_signature_header');
  });

  it('signPayload emits what the verifier accepts AND what the spec documents', () => {
    const ts = Math.floor(Date.now() / 1000);
    const { signatureHeader, algorithmHeader } = signPayload(SECRET, ts, BODY);
    // Both halves matter: agreeing with the verifier alone is the closed loop
    // that hid the bug, so this also compares against the hand-built header.
    expect(signatureHeader).toBe(specShapedHeader(ts));
    expect(algorithmHeader).toBe('v1');
  });
});

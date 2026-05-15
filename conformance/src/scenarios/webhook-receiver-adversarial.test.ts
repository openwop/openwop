/**
 * CF-5 close-out — receiver-side rejection contract per
 * `spec/v1/webhooks.md` §"Signature recipe" + §"Replay-attack
 * resistance". The companion to `webhook-signed-delivery.test.ts`
 * (which verifies the FORWARD direction: host signs correctly) —
 * this scenario verifies the REVERSE direction: a properly-
 * implemented receiver MUST reject five named adversarial inputs.
 *
 * The reference receiver implementation lives at
 * `conformance/src/lib/webhook-receiver.ts`. The SDK ships an
 * identical-behavior `verifyWebhookSignature` helper across all
 * three reference SDKs (SDK-3 close-out).
 *
 * Five adversarial cases:
 *
 *   1. Tampered body — host's HMAC is valid for body B; adversary
 *      delivers body B'. Receiver MUST reject with
 *      `signature_mismatch`.
 *   2. Tampered HMAC — body is valid; adversary flips a byte of the
 *      v1=<hex> signature. Receiver MUST reject with
 *      `signature_mismatch`.
 *   3. Stale timestamp — body + HMAC are valid but timestamp is
 *      older than the default 5-minute window. Receiver MUST reject
 *      with `timestamp_expired`.
 *   4. Replayed signature — adversary resends a previously-accepted
 *      delivery within the window. Receiver MUST reject with
 *      `duplicate_signature`.
 *   5. Wrong algorithm — host sends `algorithm: v2` (a future
 *      version a v1-only receiver doesn't recognize). Receiver MUST
 *      reject with `wrong_algorithm`.
 *
 * This scenario is purely receiver-side; it does NOT touch the host
 * under test. It runs unconditionally (no capability gating).
 *
 * @see spec/v1/webhooks.md
 * @see conformance/src/lib/webhook-receiver.ts
 * @see sdk/typescript/src/webhook-helpers.ts
 */

import { describe, it, expect } from 'vitest';
import {
  createReceiverState,
  signPayload,
  verifyWebhookDelivery,
} from '../lib/webhook-receiver.js';

describe('webhook-receiver-adversarial: receiver rejects five canonical attacks', () => {
  const secret = 'test-secret-do-not-use-in-prod';
  const body = JSON.stringify({ runId: 'r-conformance', type: 'run.completed' });
  const nowSec = 1_715_775_600;
  const ts = nowSec;

  it('positive control: receiver accepts a freshly-signed valid delivery', () => {
    const state = createReceiverState();
    const { signatureHeader, timestampHeader, algorithmHeader } = signPayload(secret, ts, body);
    const result = verifyWebhookDelivery(
      secret,
      signatureHeader,
      algorithmHeader,
      timestampHeader,
      body,
      state,
      { nowSeconds: nowSec },
    );
    expect(
      result.accepted,
      'webhooks.md §"Signature recipe": valid signature + fresh timestamp + correct algorithm MUST be accepted',
    ).toBe(true);
  });

  it('case 1: tampered body → signature_mismatch', () => {
    const state = createReceiverState();
    const { signatureHeader, timestampHeader, algorithmHeader } = signPayload(secret, ts, body);
    const tamperedBody = JSON.stringify({ runId: 'r-conformance', type: 'run.failed' });
    const result = verifyWebhookDelivery(
      secret,
      signatureHeader,
      algorithmHeader,
      timestampHeader,
      tamperedBody,
      state,
      { nowSeconds: nowSec },
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(
        result.reason,
        'webhooks.md §"Signature recipe": tampered body MUST be rejected with signature_mismatch',
      ).toBe('signature_mismatch');
    }
  });

  it('case 2: tampered HMAC → signature_mismatch', () => {
    const state = createReceiverState();
    const { signatureHeader, timestampHeader, algorithmHeader } = signPayload(secret, ts, body);
    // Flip one hex character of the v1=<hex> signature.
    const flipIndex = 5;
    const orig = signatureHeader[flipIndex]!;
    const replacement = orig === '0' ? '1' : '0';
    const tampered = signatureHeader.slice(0, flipIndex) + replacement + signatureHeader.slice(flipIndex + 1);
    const result = verifyWebhookDelivery(
      secret,
      tampered,
      algorithmHeader,
      timestampHeader,
      body,
      state,
      { nowSeconds: nowSec },
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe('signature_mismatch');
    }
  });

  it('case 3: stale timestamp → timestamp_expired', () => {
    const state = createReceiverState();
    const staleTs = nowSec - 10_000; // way past the 5-minute window
    const { signatureHeader, timestampHeader, algorithmHeader } = signPayload(secret, staleTs, body);
    const result = verifyWebhookDelivery(
      secret,
      signatureHeader,
      algorithmHeader,
      timestampHeader,
      body,
      state,
      { nowSeconds: nowSec },
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(
        result.reason,
        'webhooks.md §"Replay-attack resistance": timestamp older than freshness window MUST be rejected with timestamp_expired',
      ).toBe('timestamp_expired');
    }
  });

  it('case 4: replayed signature → duplicate_signature', () => {
    const state = createReceiverState();
    const { signatureHeader, timestampHeader, algorithmHeader } = signPayload(secret, ts, body);
    // First delivery accepted.
    const first = verifyWebhookDelivery(
      secret,
      signatureHeader,
      algorithmHeader,
      timestampHeader,
      body,
      state,
      { nowSeconds: nowSec },
    );
    expect(first.accepted).toBe(true);
    // Replay — same signature, same body, same timestamp, still
    // within the window.
    const replay = verifyWebhookDelivery(
      secret,
      signatureHeader,
      algorithmHeader,
      timestampHeader,
      body,
      state,
      { nowSeconds: nowSec },
    );
    expect(replay.accepted).toBe(false);
    if (!replay.accepted) {
      expect(
        replay.reason,
        'webhooks.md §"Replay-attack resistance": replay of an already-accepted signature MUST be rejected with duplicate_signature',
      ).toBe('duplicate_signature');
    }
  });

  it('case 5: wrong algorithm → wrong_algorithm', () => {
    const state = createReceiverState();
    const { signatureHeader, timestampHeader } = signPayload(secret, ts, body);
    const result = verifyWebhookDelivery(
      secret,
      signatureHeader,
      'v2',
      timestampHeader,
      body,
      state,
      { nowSeconds: nowSec },
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(
        result.reason,
        'webhooks.md §"Signature algorithm versioning": algorithm other than v1 MUST be rejected with wrong_algorithm by a v1-only receiver',
      ).toBe('wrong_algorithm');
    }
  });

  it('case 6: malformed signature header → malformed_signature_header', () => {
    const state = createReceiverState();
    const { timestampHeader, algorithmHeader } = signPayload(secret, ts, body);
    const result = verifyWebhookDelivery(
      secret,
      'not-a-canonical-header',
      algorithmHeader,
      timestampHeader,
      body,
      state,
      { nowSeconds: nowSec },
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe('malformed_signature_header');
    }
  });
});

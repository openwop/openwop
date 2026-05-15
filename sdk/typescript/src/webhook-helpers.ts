/**
 * Webhook delivery-verification helpers per `spec/v1/webhooks.md`
 * §"Signature recipe". Receivers MUST verify both the HMAC AND the
 * timestamp freshness before accepting a delivery — verifying HMAC
 * alone leaves the receiver open to replay attacks.
 *
 * The canonical signing recipe:
 *
 *     hmac = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *     header `openwop-Webhook-Signature: v1=<hmac-hex>`
 *     header `openwop-Webhook-Timestamp: <unix-seconds>`
 *
 * Verification:
 *
 *   1. Parse the `v1=<hex>` value from the signature header.
 *   2. Recompute `expected = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)`.
 *   3. Compare using **constant-time** equality (timing-safe).
 *   4. Reject when `|now - timestamp|` exceeds the freshness window
 *      (default 5 minutes per `webhooks.md`'s recommendation).
 *
 * Implementation note: this helper uses `node:crypto`'s `timingSafeEqual`
 * for the comparison. The browser-side equivalent (Web Crypto's
 * `subtle.verify`) is not wrapped here — the SDK's runtime is Node.
 *
 * @module @openwop/openwop/webhook-helpers
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Default freshness window per `spec/v1/webhooks.md` §"Replay attack resistance". */
export const DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS = 300;

export interface VerifyWebhookSignatureOptions {
  /**
   * Maximum age in seconds for the delivery timestamp before it's
   * treated as a replay. Default 300 (5 minutes) per the spec.
   * Set to 0 to disable timestamp checks (NOT recommended).
   */
  freshnessWindowSeconds?: number;
  /**
   * Override the "now" timestamp in unix seconds. Useful for testing.
   * Default `Math.floor(Date.now() / 1000)`.
   */
  nowSeconds?: number;
}

export type VerifyWebhookOutcome =
  | { valid: true }
  | { valid: false; reason: 'signature_mismatch' | 'timestamp_expired' | 'timestamp_too_far_in_future' | 'malformed_signature_header' | 'malformed_timestamp_header' };

/**
 * Verify a webhook delivery per `spec/v1/webhooks.md` §"Signature
 * recipe". Returns `{ valid: true }` on success; otherwise
 * `{ valid: false, reason }` so callers can log + alert appropriately.
 *
 * Callers MUST pass the **raw** body bytes — JSON-parsed-then-
 * re-serialized bodies will fail verification because the host
 * signs the exact bytes it delivered.
 *
 * @param secret The pre-shared secret returned from `webhooks.register`.
 * @param signatureHeader The value of the `openwop-Webhook-Signature` header (e.g., `"v1=abc123…"`).
 * @param timestampHeader The value of the `openwop-Webhook-Timestamp` header (unix seconds as string).
 * @param rawBody The exact request body bytes the host POSTed.
 */
export function verifyWebhookSignature(
  secret: string,
  signatureHeader: string,
  timestampHeader: string,
  rawBody: string | Buffer,
  options: VerifyWebhookSignatureOptions = {},
): VerifyWebhookOutcome {
  // 1. Parse the signature header.
  if (!signatureHeader.startsWith('v1=')) {
    return { valid: false, reason: 'malformed_signature_header' };
  }
  const providedHex = signatureHeader.slice(3);
  if (!/^[0-9a-f]+$/i.test(providedHex)) {
    return { valid: false, reason: 'malformed_signature_header' };
  }

  // 2. Parse the timestamp.
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { valid: false, reason: 'malformed_timestamp_header' };
  }

  // 3. Freshness check.
  const window = options.freshnessWindowSeconds ?? DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS;
  if (window > 0) {
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    const delta = now - timestamp;
    if (delta > window) return { valid: false, reason: 'timestamp_expired' };
    // Allow small future skew (within the window) but reject far-future timestamps.
    if (delta < -window) return { valid: false, reason: 'timestamp_too_far_in_future' };
  }

  // 4. Recompute + constant-time compare.
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const signedBytes = `${timestamp}.${bodyStr}`;
  const expectedHex = createHmac('sha256', secret).update(signedBytes, 'utf8').digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return { valid: true };
}

/**
 * Compute the canonical webhook signature for a payload — useful when
 * implementing a host (forward direction) OR when generating test
 * fixtures. Receivers verify via `verifyWebhookSignature`; this is the
 * inverse.
 */
export function signWebhookDelivery(
  secret: string,
  timestamp: number,
  rawBody: string | Buffer,
): { signatureHeader: string; timestampHeader: string } {
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const hex = createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`, 'utf8').digest('hex');
  return {
    signatureHeader: `v1=${hex}`,
    timestampHeader: String(timestamp),
  };
}

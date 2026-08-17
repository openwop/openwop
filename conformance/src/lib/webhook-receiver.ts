/**
 * Reference webhook receiver for the conformance suite — implements
 * the verification contract per `spec/v1/webhooks.md` §"Signature
 * recipe" + §"Replay-attack resistance" so adversarial-input scenarios
 * can verify that a properly-implemented receiver rejects the
 * documented failure modes.
 *
 * Mirrors the SDK's verifyWebhookSignature helper (sdk/typescript/src/
 * webhook-helpers.ts) but inlined here so the conformance suite stays
 * dependency-free vs. the SDK. The two MUST produce identical
 * outcomes for the same inputs.
 *
 * @see spec/v1/webhooks.md §"Signature recipe"
 * @see sdk/typescript/src/webhook-helpers.ts (canonical SDK
 *      implementation; this file is a conformance-suite mirror)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_FRESHNESS_WINDOW_SECONDS = 300;

export type WebhookRejectionReason =
  | 'signature_mismatch'
  | 'timestamp_expired'
  | 'timestamp_too_far_in_future'
  | 'malformed_signature_header'
  | 'malformed_timestamp_header'
  | 'wrong_algorithm'
  | 'duplicate_signature';

export type WebhookVerifyResult =
  | { accepted: true }
  | { accepted: false; reason: WebhookRejectionReason };

export interface WebhookReceiverState {
  /** Set of signature values the receiver has already accepted (anti-replay). */
  acceptedSignatures: Set<string>;
}

export function createReceiverState(): WebhookReceiverState {
  return { acceptedSignatures: new Set() };
}

export interface VerifyOptions {
  /** Default 5 minutes per spec. Set 0 to disable freshness check. */
  freshnessWindowSeconds?: number;
  /** Override `now` (unix seconds) for deterministic tests. */
  nowSeconds?: number;
}

/**
 * Verify a single webhook delivery against the canonical recipe.
 * Returns `{ accepted: true }` on success; `{ accepted: false, reason }`
 * otherwise. Updates `state.acceptedSignatures` on acceptance for
 * replay-attack detection on subsequent calls.
 *
 * Receivers MUST pass the **exact** request body bytes — parsed-and-
 * reserialized JSON will fail verification.
 */
export function verifyWebhookDelivery(
  secret: string,
  signatureHeader: string,
  algorithmHeader: string | undefined,
  timestampHeader: string,
  rawBody: string | Buffer,
  state: WebhookReceiverState,
  options: VerifyOptions = {},
): WebhookVerifyResult {
  // 1. Algorithm gating. Hosts MAY include an explicit
  //    X-openwop-Signature-Algorithm header; receivers MUST refuse
  //    anything other than `v1` per webhooks.md §"Signature algorithm
  //    versioning". Absence is treated as the v1 default.
  if (algorithmHeader !== undefined && algorithmHeader !== 'v1') {
    return { accepted: false, reason: 'wrong_algorithm' };
  }

  // 2. Signature header parse.
  if (!signatureHeader.startsWith('v1=')) {
    return { accepted: false, reason: 'malformed_signature_header' };
  }
  const providedHex = signatureHeader.slice(3);
  if (!/^[0-9a-f]+$/i.test(providedHex)) {
    return { accepted: false, reason: 'malformed_signature_header' };
  }

  // 3. Anti-replay: receivers MUST refuse a signature value seen
  //    before, even if the timestamp would otherwise be fresh
  //    (defense-in-depth against an attacker resending a captured
  //    delivery before the original's timestamp window expires).
  if (state.acceptedSignatures.has(signatureHeader)) {
    return { accepted: false, reason: 'duplicate_signature' };
  }

  // 4. Timestamp parse + freshness window.
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { accepted: false, reason: 'malformed_timestamp_header' };
  }
  const window = options.freshnessWindowSeconds ?? DEFAULT_FRESHNESS_WINDOW_SECONDS;
  if (window > 0) {
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    const delta = now - timestamp;
    if (delta > window) return { accepted: false, reason: 'timestamp_expired' };
    if (delta < -window) return { accepted: false, reason: 'timestamp_too_far_in_future' };
  }

  // 5. HMAC recompute + constant-time compare.
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expectedHex = createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`, 'utf8').digest('hex');
  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { accepted: false, reason: 'signature_mismatch' };
  }

  // 6. Accept + record for replay detection.
  state.acceptedSignatures.add(signatureHeader);
  return { accepted: true };
}

/**
 * Sign a payload the way the host would — useful for building
 * adversarial-input fixtures in scenarios.
 */
export function signPayload(
  secret: string,
  timestamp: number,
  rawBody: string | Buffer,
): { signatureHeader: string; timestampHeader: string; algorithmHeader: 'v1' } {
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const hex = createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`, 'utf8').digest('hex');
  return {
    signatureHeader: `v1=${hex}`,
    timestampHeader: String(timestamp),
    algorithmHeader: 'v1',
  };
}

/**
 * Discover a tenant the calling bearer provably OWNS, by creating a probe run
 * and reading `owner.tenant` off its snapshot (RFC 0048; `run-snapshot.schema.json`
 * §owner — the triple is `{ tenant, workspace, principal }`, and `tenantId` was
 * never the spec name: S29, 2026-08-17, found by the second sibling host, whose
 * schema-correct `owner.tenant` this helper silently ignored). A host that scopes
 * webhook subscriptions by tenant membership (RFC 0093) 403s a `tenantId` the
 * bearer is not a member of — so a hard-coded tenant is wrong; the only portable
 * owned tenant is the one on a run the bearer just created. Returns `undefined`
 * for a single-tenant host (which omits `owner`) or when no probe
 * fixture is available — callers then omit `tenantId`, which single-tenant hosts
 * accept. (RFC 0093 / webhooks.md §Register; suite defect fixed 2026-08-09.)
 */
export async function discoverOwnedTenant(
  driver: { post: (p: string, b: unknown) => Promise<{ status: number; json: unknown }>; get: (p: string) => Promise<{ status: number; json: unknown }> },
  probeWorkflowId = 'conformance-noop',
): Promise<string | undefined> {
  const create = await driver.post('/v1/runs', { workflowId: probeWorkflowId });
  if (create.status !== 201) return undefined;
  const runId = (create.json as { runId?: string } | null)?.runId;
  if (typeof runId !== 'string') return undefined;
  const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
  const owner = (snap.json as { owner?: { tenant?: unknown; tenantId?: unknown } } | null)?.owner;
  if (typeof owner?.tenant === 'string' && owner.tenant.length > 0) return owner.tenant;
  // Pre-S29 hosts that copied the suite's misnamed field: tolerated, never asserted.
  return typeof owner?.tenantId === 'string' && owner.tenantId.length > 0 ? owner.tenantId : undefined;
}

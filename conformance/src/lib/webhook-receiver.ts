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

/**
 * The `X-openwop-Signature` value prefix, per `webhooks.md` §"Delivery headers"
 * (`sha256={hex}`). Distinct from the ALGORITHM header's `v1`, which names the
 * signing scheme, not the encoding — see `verifyWebhookDelivery`.
 */
export const SIGNATURE_PREFIX = 'sha256=';

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
  //
  // `sha256=`, NOT `v1=` (corrected 2026-08-19). `webhooks.md` §"Delivery
  // headers" specifies `X-openwop-Signature: sha256={hex}` and its verification
  // recipe says "Strip the `sha256=` prefix". This verifier required `v1=` and
  // rejected the spec's own header as malformed — so the reference verifier a
  // subscriber implementer would copy refused every conforming delivery.
  //
  // The confusion is visible one comment above: `v1` is the value of the
  // ALGORITHM header (`X-openwop-Signature-Algorithm: v1`), a different field.
  // One value, two fields, conflated. It survived because
  // `webhook-receiver-adversarial.test.ts` signs with `signPayload` and verifies
  // with this function — a closed loop that is self-consistent and wrong, and
  // therefore green on every host. Reported by a tier-2 host that could not
  // adjudicate which of the suite's three signature shapes was canonical.
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { accepted: false, reason: 'malformed_signature_header' };
  }
  const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
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
    signatureHeader: `${SIGNATURE_PREFIX}${hex}`,
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
 *
 * **Prefers `owner.workspace`, and that is not a fallback ordering — it is which
 * field the route actually takes.** `webhooks.md` §Register documents the body's
 * `tenantId` as *"Workspace under which the subscription lives. Caller MUST be a
 * member."*, and every example in that document passes a workspace
 * (`workspace-123`, `workspace-prod`). RFC 0048 §A defines `owner.tenant` as
 * something else entirely — the **top-level isolation boundary** — with
 * `workspace` an optional sub-tenant beneath it. The two coincide only on hosts
 * where tenant ≡ workspace, which is why reading `owner.tenant` worked
 * everywhere it had been run.
 *
 * Reported 2026-09-02 by a tier-2 host with a real workspace layer: its
 * schema-correct `owner` is `{tenant: "<instance>", workspace: "<workspaceId>",
 * principal: …}`, so this helper derived the instance label — a value **nobody
 * is a member of** — and registration 403'd by design. Registering with
 * `owner.workspace` returns 201, verified by curl on that host. The host is
 * conformant and the suite was wrong; the docblock above already stated the
 * right intent ("a tenant the calling bearer provably OWNS") while reading the
 * field that does not carry it.
 *
 * The `tenant` read is retained beneath it for hosts that emit no `workspace`.
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
  const owner = (snap.json as { owner?: { tenant?: unknown; workspace?: unknown; tenantId?: unknown } } | null)
    ?.owner;
  // `tenantId` on POST /v1/webhooks is the WORKSPACE (webhooks.md §Register), not
  // the RFC 0048 §A `tenant` isolation boundary. Where a host distinguishes them,
  // only the workspace is a scope the bearer is a member of.
  if (typeof owner?.workspace === 'string' && owner.workspace.length > 0) return owner.workspace;
  if (typeof owner?.tenant === 'string' && owner.tenant.length > 0) return owner.tenant;
  // Pre-S29 hosts that copied the suite's misnamed field: tolerated, never asserted.
  return typeof owner?.tenantId === 'string' && owner.tenantId.length > 0 ? owner.tenantId : undefined;
}

/**
 * The public `https:` front for the conformance webhook receiver, when the operator
 * has wired one (`OPENWOP_WEBHOOK_RECEIVER_URL`).
 *
 * This does NOT point the host at some third-party endpoint. The delivery must
 * still land on the local `startReceiver()` server, because every assertion in
 * the scenario reads `receiver.received` — an IN-PROCESS array. Registering an
 * arbitrary URL would send the delivery somewhere the suite cannot observe, and
 * the row would turn green while every header and HMAC assertion went vacuous.
 * That is the precise defect this suite exists to catch, so the variable is
 * specified as "a tunnel or TLS-terminating proxy in front of THIS receiver",
 * never "an endpoint of your choosing".
 *
 * The suite cannot verify that the tunnel actually fronts this process — that
 * is the operator's contract. What it CAN do is refuse to let a mis-wired
 * tunnel look like a pass: with the variable set, zero observed deliveries is a
 * hard assertion failure, never a soft-skip (see the delivery assertion below).
 *
 * Validation is deliberately strict and fails LOUDLY rather than skipping: a
 * malformed value is an operator error, and turning it into a `blocked` row
 * would hide the misconfiguration behind a disposition that reads as
 * "the host could not be exercised".
 */
export function resolveRegistrationUrl(localUrl: string): { url: string; tunnelled: boolean } {
  const raw = process.env.OPENWOP_WEBHOOK_RECEIVER_URL?.trim();
  if (!raw) return { url: localUrl, tunnelled: false };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `OPENWOP_WEBHOOK_RECEIVER_URL is not a valid URL: ${JSON.stringify(raw)}`,
    );
  }

  // Must clear gate 1 (scheme). An `http:` front cannot satisfy a host that
  // validates scheme before address, which is the ordering that made the
  // ALLOW_PRIVATE flag insufficient in the first place.
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `OPENWOP_WEBHOOK_RECEIVER_URL MUST be https: (got ${parsed.protocol}). ` +
        'A plain-http front cannot clear the scheme gate, so it cannot witness this scenario.',
    );
  }

  // Must clear gate 2 (registration-time address check). A loopback or private
  // hostname here is just the local URL wearing a different scheme — it would
  // be rejected for the same reason, and the operator would read the resulting
  // failure as a host defect rather than as their own misconfiguration.
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' || host === '::1' || host.startsWith('127.');
  const isPrivate =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^(fc|fd)/.test(host);
  if (isLoopback || isPrivate) {
    throw new Error(
      `OPENWOP_WEBHOOK_RECEIVER_URL MUST be a publicly-resolvable host (got ${parsed.hostname}). ` +
        'It is the PUBLIC front for the local receiver — a tunnel or TLS-terminating proxy — ' +
        'not the receiver address itself.',
    );
  }

  return { url: raw, tunnelled: true };
}

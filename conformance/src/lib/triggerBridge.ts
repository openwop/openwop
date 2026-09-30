/**
 * Shared helpers for the RFC 0083 `triggerBridge` conformance scenario.
 * Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/triggerBridge.js`.
 *
 * Two surfaces:
 *   - the NORMATIVE read (`GET /v1/trigger-subscriptions[/{subscriptionId}]`,
 *     RFC 0083 §A), exercised black-box; and
 *   - the host-sample delivery seam (`POST /v1/host/sample/trigger-bridge/deliver`),
 *     used to drive the §C delivery model (dedup → retry → dead-letter →
 *     causation) so the two `trigger.*` events can be asserted against the test
 *     event-log seam. The seam is OPTIONAL — scenarios soft-skip on 404/405
 *     (reference durable-delivery is deferred per RFC 0083 §Conformance).
 *
 * Gating uses the `openwop-trigger-bridge` PROFILE derived from the live
 * discovery doc (the bridge + a dead-letter sink + a durable source, §D), not a
 * bare capability flag.
 *
 * @see RFCS/0083-durable-trigger-and-channel-bridge-profile.md
 * @see spec/v1/trigger-bridge.md
 * @see spec/v1/profiles.md (§openwop-trigger-bridge)
 */
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { driver } from './driver.js';
import { deriveProfiles, type DiscoveryPayload } from './profiles.js';

/** True when the live host's discovery derives the `openwop-trigger-bridge`
 *  profile (RFC 0083 §D predicate: bridge advertised + dead-letter sink + a
 *  durable source). */
export async function isTriggerBridgeProfileAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  if (disco.status !== 200 || !disco.json) return false;
  return deriveProfiles(disco.json as DiscoveryPayload).includes('openwop-trigger-bridge');
}

export interface TriggerSubscription {
  subscriptionId?: string;
  source?: string;
  state?: string;
  [k: string]: unknown;
}

/** GET the NORMATIVE subscription read surface (RFC 0083 §A
 *  `GET /v1/trigger-subscriptions`); null when not served (404/405/501). */
export async function listTriggerSubscriptions(): Promise<{ subscriptions?: TriggerSubscription[] } | null> {
  const res = await driver.get('/v1/trigger-subscriptions');
  if (res.status === 404 || res.status === 405 || res.status === 501) return null;
  return (res.json as { subscriptions?: TriggerSubscription[] } | undefined) ?? {};
}

export interface DeliveryResult {
  runId?: string;
  subscriptionId?: string;
  outcome?: string;
  deliveredCount?: number;
}

/**
 * Drive one delivery through the host-sample bridge seam. `scenario`:
 *   - `dedup`     — deliver the same `dedupKey` twice; effectively-once (§C-1).
 *   - `exhaust`   — exhaust the retry policy → `dead-lettered` (§C-2 + RFC 0053).
 *   - `deliver`   — a single successful delivery whose run's `run.started`
 *                   carries the delivery `causationId` (§C / RFC 0040).
 * Returns null when the seam is unwired (404/405).
 */
export async function driveDelivery(
  body: { scenario: 'dedup' | 'exhaust' | 'deliver'; dedupKey?: string; source?: string },
): Promise<DeliveryResult | null> {
  const res = await driver.post('/v1/host/sample/trigger-bridge/deliver', body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as DeliveryResult | undefined) ?? {};
}

/**
 * A dedup key that belongs to ONE exercise (2.37.0).
 *
 * `trigger-bridge.md` §C-1 makes the dedup window a ≥24h FLOOR, so a LITERAL
 * dedup key is not a fixture — it is a durable identity the host is required to
 * remember across runs of this suite. Two exercises that hand the bridge the
 * same key are ONE delivery by the spec's own rule, and the second one's row
 * reads zero deliveries on a host doing exactly what it MUST. That is a suite
 * defect and not a host defect, and it is the same failure the RFC 0158
 * duplicate-delivery row had when two scenario files shared one effect identity
 * (`lib/effect-receiver.ts`).
 *
 * `prefix` keeps a key readable in a host's own log; the random half is what
 * makes it this exercise's. `randomBytes`, not `Date.now()`: two vitest workers
 * can enter the same line in the same millisecond.
 */
export function freshDedupKey(prefix: string): string {
  return `openwop-conformance-${prefix}-${randomBytes(9).toString('hex')}`;
}

/**
 * The same per-exercise mint for a `stream` source, in the COORDINATE shape
 * §F.5 keys on (2.37.0).
 *
 * `trigger-stream-cdc-sources.test.ts` handed the seam the literal
 * `'events:3:99001'` and then asserted `deliveredCount === 1 || outcome ===
 * 'delivered'` — the identical defect `freshDedupKey` above was written for,
 * one file over, found when the enumeration was re-run against the merged
 * tree. §C-1's window is a ≥24h floor and §F.5 reuses it verbatim, so the
 * second run of that file against the same host, any time that day, hands the
 * bridge broker coordinates it has already delivered; a CONFORMANT host
 * collapses the exercise into the first run's outcome and the assertion
 * convicts it. Cold host passes, warm host fails.
 *
 * `freshDedupKey` would not do here, and the difference is not cosmetic: §F.5
 * says a stream event's dedup key SHOULD derive from
 * `(topic, partition, offset)`, and the leg's own `req()` message asserts over
 * exactly that keying. An opaque token would make the message describe
 * something the call no longer does. So topic and partition stay fixed and the
 * OFFSET is minted — which is precisely what makes a real broker's message a
 * different message.
 */
export function freshStreamDedupKey(topic = 'events', partition = 3): string {
  // A 2^44 offset space: distinct across every run this suite will make, and
  // still a plausible broker offset rather than an opaque token.
  return `${topic}:${partition}:${randomInt(2 ** 44)}`;
}

export const SUBSCRIPTION_STATES = ['active', 'paused', 'failed', 'dead-lettered'];
export const DELIVERY_OUTCOMES = ['delivered', 'retrying', 'dead-lettered'];

// ---------------------------------------------------------------------------
// RFC 0230 — the normative-surface (seam-free) ingest path.
// ---------------------------------------------------------------------------

/** Does discovery advertise `triggerBridge.ingestion.inboundSigning` ∋ `standard-webhooks-1`? */
export async function inboundSigningAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  if (disco.status !== 200 || !disco.json) return false;
  const d = disco.json as Record<string, any>;
  const tb = d.triggerBridge ?? d.capabilities?.triggerBridge;
  const s = tb?.ingestion?.inboundSigning;
  return Array.isArray(s) && s.includes('standard-webhooks-1');
}

export interface SignedWebhookSubscription {
  subscriptionId: string;
  ingestUrl: string;
  signingSecret: string;
}

/**
 * Register a `webhook` subscription bound to the `conformance-noop` fixture
 * (RFC 0230 §B). Returns null (with a reason) when the registration does not
 * yield the §B binding — the caller records that as a host defect, not a skip.
 */
export async function registerSignedWebhook(mode: 'none' | 'required'): Promise<SignedWebhookSubscription | { reason: string }> {
  const res = await driver.post('/v1/trigger-subscriptions', { source: 'webhook', workflowId: 'conformance-noop', verification: { mode } });
  const body = res.json as { subscription?: { subscriptionId?: string }; binding?: { ingestUrl?: string; signingSecret?: string } } | undefined;
  const subscriptionId = body?.subscription?.subscriptionId;
  const ingestUrl = body?.binding?.ingestUrl;
  const signingSecret = body?.binding?.signingSecret;
  if (res.status !== 201 || !subscriptionId || !ingestUrl || !signingSecret) {
    return { reason: `POST /v1/trigger-subscriptions answered ${res.status} without the RFC 0230 §B binding (subscriptionId, ingestUrl, signingSecret)` };
  }
  return { subscriptionId, ingestUrl, signingSecret };
}

/** A Standard Webhooks `webhook-id` (RFC 0201 grammar). */
export function freshWebhookId(): string {
  return `msg_${randomBytes(12).toString('hex')}`;
}

/** `v1,<base64 HMAC-SHA256(key, "{id}.{ts}.{body}")>`, key = base64-decode after `whsec_`. */
export function standardWebhooksSignature(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

/**
 * POST a raw body to `ingestUrl` with NO OpenWOP credential and the three
 * Standard Webhooks headers (RFC 0230 §C). `signature` overrides the computed one
 * (a bad-signature probe); `timestamp` overrides the current second (a skew probe).
 */
export async function signedIngest(
  sub: SignedWebhookSubscription,
  body: string,
  opts: { webhookId?: string; timestamp?: string; signature?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> | undefined }> {
  const id = opts.webhookId ?? freshWebhookId();
  const ts = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const sig = opts.signature ?? standardWebhooksSignature(sub.signingSecret, id, ts, body);
  const res = await driver.post(sub.ingestUrl, body, {
    authenticated: false,
    headers: { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig },
  });
  return { status: res.status, json: res.json as Record<string, unknown> | undefined };
}

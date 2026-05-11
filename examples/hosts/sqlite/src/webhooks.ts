/**
 * Webhook subscriptions + signed-delivery for the SQLite reference host.
 *
 * Implements the webhook surface from `spec/v1/webhooks.md`:
 *   - `POST /v1/webhooks` register
 *   - `DELETE /v1/webhooks/{id}` unregister
 *   - Best-effort HTTP POST delivery on run events
 *   - HMAC-SHA256 signing over `{timestamp}.{rawBody}` with
 *     `X-openwop-Signature`, `X-openwop-Signature-Timestamp`, and
 *     `X-openwop-Signature-Algorithm: v1` headers.
 *
 * Reference-only properties:
 *   - In-process delivery (no queue); failures swallowed silently.
 *   - No retry / backoff / circuit breaker — production hosts would
 *     implement the post-v1 delivery policy from `webhooks.md`.
 *   - Per-subscriber secrets are generated when the caller doesn't
 *     supply one; returned exactly once on register.
 *
 * @see spec/v1/webhooks.md
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type Database from 'better-sqlite3';

/**
 * SSRF guard for webhook destination URLs.
 *
 * Rejects URLs whose hostname resolves (or syntactically points) to
 * loopback / RFC1918 / link-local / unique-local addresses, or to the
 * common "internal-only" hostnames operators care about (`localhost`,
 * `*.local`, `*.internal`). An authenticated tenant can otherwise use
 * `POST /v1/webhooks` for blind SSRF probing of the deployer's internal
 * services (AWS metadata, internal Redis, etc.).
 *
 * Bypass: set `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true` (for `examples/hosts/`
 * developer scenarios where the test receiver is on localhost).
 *
 * @see review §"Webhook delivery — SSRF + payload leakage"
 */
function urlAllowed(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  if (process.env.OPENWOP_WEBHOOK_ALLOW_PRIVATE === 'true') return { ok: true };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'webhook url is not a parseable URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `webhook url protocol "${url.protocol}" is not http(s)` };
  }

  const host = url.hostname.toLowerCase();
  // Strip IPv6 brackets — URL.hostname returns them on `[::1]`.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // Hostname allowlist short-circuits.
  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return { ok: false, reason: 'webhook url points at localhost (SSRF guard)' };
  }
  if (bare.endsWith('.local') || bare.endsWith('.internal') || bare.endsWith('.cluster')) {
    return { ok: false, reason: `webhook url hostname "${bare}" looks internal (SSRF guard)` };
  }

  // IP literal: check ranges.
  const ipVersion = isIP(bare);
  if (ipVersion === 4) {
    const [a, b] = bare.split('.').map(Number) as [number, number];
    if (a === 127) return { ok: false, reason: '127.0.0.0/8 (loopback) (SSRF guard)' };
    if (a === 10) return { ok: false, reason: '10.0.0.0/8 (RFC1918) (SSRF guard)' };
    if (a === 172 && b >= 16 && b <= 31) {
      return { ok: false, reason: '172.16.0.0/12 (RFC1918) (SSRF guard)' };
    }
    if (a === 192 && b === 168) {
      return { ok: false, reason: '192.168.0.0/16 (RFC1918) (SSRF guard)' };
    }
    if (a === 169 && b === 254) {
      return { ok: false, reason: '169.254.0.0/16 (link-local; AWS metadata) (SSRF guard)' };
    }
    if (a === 0) return { ok: false, reason: '0.0.0.0/8 (SSRF guard)' };
  }
  if (ipVersion === 6) {
    const lower = bare;
    if (lower === '::1' || lower === '::ffff:127.0.0.1') {
      return { ok: false, reason: 'IPv6 loopback (SSRF guard)' };
    }
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return { ok: false, reason: 'fc00::/7 (unique local) (SSRF guard)' };
    }
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return { ok: false, reason: 'fe80::/10 (link-local) (SSRF guard)' };
    }
  }

  // Note: we do NOT resolve DNS here. A real production host would
  // resolve and re-check after resolution (and re-resolve on delivery
  // to defend against DNS rebinding). For the reference host this is
  // a documented limitation.
  return { ok: true };
}

/**
 * Strip payload-bearing fields from a run event before fan-out. The
 * reference host's policy mirrors debug-bundle.md §"Redaction guarantees":
 * omit fields that can carry tenant-input content. Production hosts
 * would wire this through the same redaction pipeline used for SSE/poll
 * (per redaction.md / capabilities.secrets.supported), substituting
 * `[REDACTED:<secretId>]` for known BYOK references rather than dropping
 * the whole field.
 */
function redactForFanOut(event: { type: string; [k: string]: unknown }): Record<string, unknown> {
  const { data, ...rest } = event;
  // Pass through metadata fields the receiver needs: type, runId, seq,
  // timestamp, nodeId. Drop the open-ended `data` field; receivers
  // wanting the payload can fetch the run snapshot or debug bundle
  // through an authenticated channel.
  return rest;
}

export interface WebhookSubscription {
  readonly subscriptionId: string;
  readonly url: string;
  readonly secret: string;
  readonly eventTypes: ReadonlyArray<string>; // empty array = all events
  readonly createdAt: string;
}

interface SubscriptionRow {
  subscription_id: string;
  url: string;
  secret: string;
  event_types: string;
  created_at: string;
}

export function setupWebhookSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      subscription_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      event_types TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
  `);
}

export interface RegisterInput {
  readonly url: string;
  readonly secret?: string;
  readonly eventTypes?: ReadonlyArray<string>;
}

export class WebhookUrlRejected extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'WebhookUrlRejected';
  }
}

export function registerWebhook(
  db: Database.Database,
  input: RegisterInput,
): WebhookSubscription {
  const guard = urlAllowed(input.url);
  if (!guard.ok) throw new WebhookUrlRejected(guard.reason);

  const subscriptionId = `wh-${randomUUID()}`;
  const secret = input.secret ?? randomBytes(32).toString('base64url');
  const eventTypes = Array.isArray(input.eventTypes) ? input.eventTypes : [];
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO webhook_subscriptions (subscription_id, url, secret, event_types, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(subscriptionId, input.url, secret, JSON.stringify(eventTypes), createdAt);
  return { subscriptionId, url: input.url, secret, eventTypes, createdAt };
}

export function unregisterWebhook(db: Database.Database, subscriptionId: string): boolean {
  const result = db
    .prepare('DELETE FROM webhook_subscriptions WHERE subscription_id = ?')
    .run(subscriptionId);
  return result.changes > 0;
}

/**
 * Load subscriptions matching `eventType`. Reference-impl design:
 * `event_types` is stored as a JSON-encoded array in a TEXT column, so
 * we read every row and filter in JS rather than encoding event types
 * as a separate join table. At reference scale (≤ tens of subscriptions)
 * this is fine. A production host with many subscribers SHOULD denormalize
 * to a `webhook_event_subscriptions` join table with `(event_type,
 * subscription_id)` rows so the SQL plan can index-scan by event_type.
 */
function loadSubscriptionsForEvent(
  db: Database.Database,
  eventType: string,
): WebhookSubscription[] {
  const rows = db
    .prepare('SELECT * FROM webhook_subscriptions')
    .all() as SubscriptionRow[];
  return rows
    .map((r) => ({
      subscriptionId: r.subscription_id,
      url: r.url,
      secret: r.secret,
      eventTypes: JSON.parse(r.event_types) as string[],
      createdAt: r.created_at,
    }))
    .filter((s) => s.eventTypes.length === 0 || s.eventTypes.includes(eventType));
}

/**
 * Sign a payload per `webhooks.md` §"Signature scheme". Returns the
 * hex-encoded HMAC-SHA256 of `${timestamp}.${rawBody}`.
 */
export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

/**
 * Best-effort POST to a single subscriber. Errors are swallowed —
 * reference-host MVP. Returns a promise that resolves when the request
 * completes (success or failure).
 */
function deliver(sub: WebhookSubscription, payload: unknown): Promise<void> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(sub.url);
    } catch {
      resolve();
      return;
    }
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signPayload(sub.secret, timestamp, body);

    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-openwop-Signature': signature,
        'X-openwop-Signature-Timestamp': timestamp,
        'X-openwop-Signature-Algorithm': 'v1',
        'X-openwop-Subscription-Id': sub.subscriptionId,
      },
    };
    const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = reqFn(opts, (res) => {
      res.resume();
      res.on('end', () => resolve());
    });
    req.on('error', () => resolve());
    req.setTimeout(5000, () => {
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });
}

/** Fan out a single event to every matching subscriber. Fire-and-forget. */
export function fanOutEvent(
  db: Database.Database,
  event: { type: string; [k: string]: unknown },
): void {
  const subs = loadSubscriptionsForEvent(db, event.type);
  if (subs.length === 0) return;
  // Redact `data` from the payload — webhook receivers get the event
  // *envelope* (type, runId, seq, timestamp, nodeId) but NOT the open-
  // ended `data` field which may carry interrupt configs, approval
  // payloads, or future BYOK credentialRefs. Receivers fetch the full
  // payload via an authenticated `GET /v1/runs/{id}` or debug-bundle.
  const safe = redactForFanOut(event);
  for (const sub of subs) {
    // Fire-and-forget — we don't await delivery (best-effort per spec).
    void deliver(sub, safe).catch(() => undefined);
  }
}

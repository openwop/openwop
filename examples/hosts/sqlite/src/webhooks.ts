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
import type Database from 'better-sqlite3';

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

export function registerWebhook(
  db: Database.Database,
  input: RegisterInput,
): WebhookSubscription {
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
  for (const sub of subs) {
    // Fire-and-forget — we don't await delivery (best-effort per spec).
    void deliver(sub, event).catch(() => undefined);
  }
}

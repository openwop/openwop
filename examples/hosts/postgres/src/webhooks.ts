/**
 * Webhook subscriptions + signed-delivery for the Postgres reference host.
 *
 * Async-pg port of `examples/hosts/sqlite/src/webhooks.ts`. Implements
 * the webhook surface from `spec/v1/webhooks.md`:
 *   - `POST /v1/webhooks` register
 *   - `DELETE /v1/webhooks/{id}` unregister
 *   - HMAC-SHA256 over `{timestamp}.{rawBody}` with `X-openwop-Signature*`
 *     and `X-openwop-Signature-Algorithm: v1` headers.
 *   - Best-effort fire-and-forget delivery; receivers fetch authenticated
 *     run snapshot or debug-bundle for the full payload.
 *   - SSRF guard rejects RFC1918 / link-local / loopback / .local /
 *     .internal / .cluster hosts (bypass via OPENWOP_WEBHOOK_ALLOW_PRIVATE).
 *
 * Postgres-specific: JSONB column for `event_types` (pg-types auto-parses
 * on read, so the SQLite port's JSON.parse is dropped). Every fn that
 * touches the DB is async-pg through the Querier interface.
 *
 * @see spec/v1/webhooks.md
 * @see examples/hosts/sqlite/src/webhooks.ts — the source of the port
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Querier } from './db.js';

/**
 * SSRF guard for webhook destination URLs. Rejects URLs whose hostname
 * points at loopback / RFC1918 / link-local / unique-local addresses or
 * the common "internal-only" hostnames. Bypass: set
 * OPENWOP_WEBHOOK_ALLOW_PRIVATE=true (for the host's own conformance
 * scenarios where the test receiver runs on localhost).
 *
 * No DNS resolution — a production host would resolve and re-check, and
 * re-resolve at delivery time to defend against DNS rebinding. Reference-
 * impl limitation.
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
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return { ok: false, reason: 'webhook url points at localhost (SSRF guard)' };
  }
  if (bare.endsWith('.local') || bare.endsWith('.internal') || bare.endsWith('.cluster')) {
    return { ok: false, reason: `webhook url hostname "${bare}" looks internal (SSRF guard)` };
  }

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
    if (
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    ) {
      return { ok: false, reason: 'fe80::/10 (link-local) (SSRF guard)' };
    }
  }

  return { ok: true };
}

/**
 * Strip payload-bearing fields from a run event before fan-out. Receivers
 * get the envelope (type, runId, seq, timestamp, nodeId) but NOT the
 * open-ended `data` field — that may carry interrupt configs, approval
 * payloads, or future BYOK credentialRefs. Receivers fetch full payloads
 * via authenticated `GET /v1/runs/{id}` or `/debug-bundle`.
 */
function redactForFanOut(event: { type: string; [k: string]: unknown }): Record<string, unknown> {
  const { data, ...rest } = event;
  void data;
  return rest;
}

export interface WebhookSubscription {
  readonly subscriptionId: string;
  readonly url: string;
  readonly secret: string;
  readonly eventTypes: ReadonlyArray<string>;
  readonly createdAt: string;
}

interface SubscriptionRow {
  subscription_id: string;
  url: string;
  secret: string;
  /** JSONB → already-parsed array of strings (or [] default). */
  event_types: string[] | null;
  created_at: string;
}

export async function setupWebhookSchema(q: Querier): Promise<void> {
  await q.query(`
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      subscription_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      event_types JSONB NOT NULL DEFAULT '[]'::JSONB,
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

export async function registerWebhook(
  q: Querier,
  input: RegisterInput,
): Promise<WebhookSubscription> {
  const guard = urlAllowed(input.url);
  if (!guard.ok) throw new WebhookUrlRejected(guard.reason);

  const subscriptionId = `wh-${randomUUID()}`;
  const secret = input.secret ?? randomBytes(32).toString('base64url');
  const eventTypes = Array.isArray(input.eventTypes) ? input.eventTypes : [];
  const createdAt = new Date().toISOString();
  await q.query(
    `INSERT INTO webhook_subscriptions (subscription_id, url, secret, event_types, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [subscriptionId, input.url, secret, JSON.stringify(eventTypes), createdAt],
  );
  return { subscriptionId, url: input.url, secret, eventTypes, createdAt };
}

export async function unregisterWebhook(q: Querier, subscriptionId: string): Promise<boolean> {
  const res = await q.query(
    'DELETE FROM webhook_subscriptions WHERE subscription_id = $1',
    [subscriptionId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Load subscriptions matching `eventType`. Reference-impl design: read
 * every row + filter in JS. Production hosts with many subscribers
 * SHOULD denormalize to a `webhook_event_subscriptions` join table so
 * the SQL plan can index-scan by event_type.
 */
async function loadSubscriptionsForEvent(
  q: Querier,
  eventType: string,
): Promise<WebhookSubscription[]> {
  const res = await q.query<SubscriptionRow>('SELECT * FROM webhook_subscriptions');
  return res.rows
    .map((r) => ({
      subscriptionId: r.subscription_id,
      url: r.url,
      secret: r.secret,
      eventTypes: (r.event_types ?? []) as string[],
      createdAt: r.created_at,
    }))
    .filter((s) => s.eventTypes.length === 0 || s.eventTypes.includes(eventType));
}

/**
 * Sign a payload per webhooks.md §"Signature scheme". Hex-encoded
 * HMAC-SHA256 of `${timestamp}.${rawBody}`.
 */
export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

/**
 * Best-effort POST to a single subscriber. Errors swallowed. Returns a
 * promise that resolves when the request completes (success or failure).
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

/**
 * Fan out a single event to every matching subscriber. Fire-and-forget;
 * caller does not await delivery.
 */
export async function fanOutEvent(
  q: Querier,
  event: { type: string; [k: string]: unknown },
): Promise<void> {
  const subs = await loadSubscriptionsForEvent(q, event.type);
  if (subs.length === 0) return;
  const safe = redactForFanOut(event);
  for (const sub of subs) {
    void deliver(sub, safe).catch(() => undefined);
  }
}

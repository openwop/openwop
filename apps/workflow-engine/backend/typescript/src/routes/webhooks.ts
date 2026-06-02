/**
 * Webhook routes:
 *   GET    /v1/webhooks                — list subscriptions (refs only; no secret)
 *   POST   /v1/webhooks                — register subscription
 *   DELETE /v1/webhooks/{subscriptionId} — unregister
 *   POST   /v1/webhooks/{subscriptionId}/test — fire a signed test delivery
 *
 * Delivery is HMAC-SHA256-signed per spec/v1/webhooks.md §"Signature recipe".
 * Routes ENQUEUE a durable `WebhookDeliveryRecord` per matching subscriber; the
 * background `webhookDeliveryWorker` drains the queue with claim-based leasing
 * (multi-instance-safe) + exponential-backoff retry + dead-lettering, so a
 * process crash or a transient receiver failure no longer drops the delivery.
 * (The signing itself lives in the worker, next to the POST.)
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { Express } from 'express';
// `RegisterWebhookRequest` / `Response` aren't exported by @openwop/openwop@1.1.1
// even though the in-tree source declares them — define minimal local shapes.
interface RegisterWebhookRequest {
  url: string;
  events: readonly string[];
  secret?: string;
  tags?: readonly string[];
}
interface RegisterWebhookResponse {
  subscriptionId: string;
  url: string;
  events: readonly string[];
  secret?: string;
}
import type { Storage } from '../storage/storage.js';
import { OpenwopError, type EventRecord, type WebhookDeliveryRecord } from '../types.js';
import { getEventLog } from '../executor/eventLog.js';
import { createLogger } from '../observability/logger.js';
import { WEBHOOK_MAX_ATTEMPTS } from '../host/webhookDeliveryWorker.js';

const log = createLogger('routes.webhooks');

interface Deps {
  storage: Storage;
}

export function registerWebhookRoutes(app: Express, deps: Deps): void {
  const { storage } = deps;

  // Subscribe once at boot to fan out events to registered webhooks.
  // The subscription persists for the lifetime of the process.
  getEventLog().subscribe((event) => {
    deliverToSubscribers(storage, event).catch((err) => {
      log.warn('webhook fanout error', { error: err instanceof Error ? err.message : String(err) });
    });
  });

  // List subscriptions. Secret is NEVER returned — only refs + metadata, so a
  // leaked list response can't be replayed to forge a signed delivery.
  app.get('/v1/webhooks', async (_req, res, next) => {
    try {
      const subs = await storage.listWebhooks({});
      res.status(200).json({
        subscriptions: subs.map((s) => ({
          subscriptionId: s.subscriptionId,
          url: s.url,
          events: s.events,
          ...(s.tags ? { tags: s.tags } : {}),
          createdAt: s.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/webhooks', async (req, res, next) => {
    try {
      const body = req.body as RegisterWebhookRequest;
      // Validate required fields per spec/v1/webhooks.md §"Subscription".
      // Per conformance: missing/malformed inputs return 400 validation_error.
      if (!body || typeof body !== 'object') {
        throw new OpenwopError('validation_error', 'Request body must be a JSON object.', 400);
      }
      if (typeof body.url !== 'string' || body.url.length === 0) {
        throw new OpenwopError('validation_error', 'Field `url` is required and MUST be a non-empty string.', 400, {
          field: 'url',
        });
      }
      assertReachableUrl(body.url);
      // events[] is structurally optional per the openwop spec — sample
      // requires non-empty for clarity but uses validation_error code.
      if (!Array.isArray(body.events) || body.events.length === 0) {
        throw new OpenwopError('validation_error', 'Field `events` MUST be a non-empty string array.', 400, {
          field: 'events',
        });
      }
      const subscriptionId = randomUUID();
      const secret = body.secret ?? randomBytes(32).toString('base64url');
      await storage.insertWebhook({
        subscriptionId,
        url: body.url,
        events: body.events,
        tags: body.tags,
        secret,
        createdAt: new Date().toISOString(),
      });
      const response: RegisterWebhookResponse = {
        subscriptionId,
        url: body.url,
        events: body.events,
        ...(body.secret ? {} : { secret }),
      } as RegisterWebhookResponse;
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/webhooks/:subscriptionId', async (req, res, next) => {
    try {
      const sub = await storage.getWebhook(req.params.subscriptionId);
      if (!sub) {
        throw new OpenwopError(
          'subscription_not_found',
          `Webhook subscription ${req.params.subscriptionId} not found.`,
          404,
          { subscriptionId: req.params.subscriptionId },
        );
      }
      await storage.deleteWebhook(req.params.subscriptionId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // Enqueue a synthetic, HMAC-signed `webhook.test` delivery to the
  // subscription's URL so an operator can verify reachability + signature
  // handling end-to-end. The 202 means "test delivery enqueued", not "endpoint
  // acknowledged" — the worker delivers (and retries) it asynchronously.
  app.post('/v1/webhooks/:subscriptionId/test', async (req, res, next) => {
    try {
      const sub = await storage.getWebhook(req.params.subscriptionId);
      if (!sub) {
        throw new OpenwopError(
          'subscription_not_found',
          `Webhook subscription ${req.params.subscriptionId} not found.`,
          404,
          { subscriptionId: req.params.subscriptionId },
        );
      }
      const testEvent: EventRecord = {
        eventId: randomUUID(),
        runId: 'webhook-test',
        sequence: 0,
        type: 'webhook.test',
        payload: { message: 'OpenWOP webhook test delivery', subscriptionId: sub.subscriptionId },
        timestamp: new Date().toISOString(),
      };
      await enqueueDelivery(storage, sub, testEvent);
      res.status(202).json({
        subscriptionId: sub.subscriptionId,
        url: sub.url,
        dispatched: true,
        eventType: 'webhook.test',
      });
    } catch (err) {
      next(err);
    }
  });
}

async function deliverToSubscribers(storage: Storage, event: EventRecord): Promise<void> {
  const subscribers = await storage.listWebhooks({ eventType: event.type });
  for (const sub of subscribers) {
    await enqueueDelivery(storage, sub, event);
  }
}

/**
 * Enqueue one durable delivery row. The `secret` is captured here (the
 * subscription may be deleted before the worker delivers) and the event is
 * serialized into the exact `payload` body the worker will POST. The worker
 * (`webhookDeliveryWorker`) signs + delivers + retries with backoff.
 */
async function enqueueDelivery(
  storage: Storage,
  sub: { subscriptionId: string; url: string; secret: string },
  event: EventRecord,
): Promise<void> {
  const now = Date.now();
  const record: WebhookDeliveryRecord = {
    deliveryId: randomUUID(),
    subscriptionId: sub.subscriptionId,
    url: sub.url,
    secret: sub.secret,
    eventType: event.type,
    payload: JSON.stringify(event),
    status: 'pending',
    attempts: 0,
    maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    nextAttemptAt: now,
    claimedBy: null,
    claimExpiresAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await storage.enqueueWebhookDelivery(record);
}

function assertReachableUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OpenwopError('validation_error', `Webhook url is not a valid URL.`, 400, { field: 'url' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OpenwopError('webhook_url_rejected', `Webhook url must be http: or https:.`, 400, {
      reason: 'unsupported_protocol',
      protocol: parsed.protocol,
    });
  }
  // SSRF guard — always on per spec/v1/webhooks.md §"SSRF guard".
  // Refuses obvious loopback / link-local / RFC 1918 hostnames + IPs.
  // Operators can override via OPENWOP_WEBHOOK_ALLOW_PRIVATE=true for
  // local development / testing only.
  if (process.env.OPENWOP_WEBHOOK_ALLOW_PRIVATE === 'true') return;
  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopback(hostname)) {
    throw new OpenwopError(
      'webhook_url_rejected',
      `Webhook url host "${hostname}" is denied (loopback / link-local / private-IP).`,
      400,
      { reason: 'ssrf_guard', host: hostname },
    );
  }
}

function isPrivateOrLoopback(host: string): boolean {
  if (['localhost', '0.0.0.0', '::1', '::'].includes(host)) return true;
  // IPv4 dotted-quad
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return true;            // 127.0.0.0/8 loopback
    if (a === 10) return true;             // 10.0.0.0/8 RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;          // 192.168.0.0/16
    if (a === 169 && b === 254) return true;          // 169.254.0.0/16 link-local + GCP/AWS metadata
    if (a === 0) return true;                          // 0.0.0.0/8
  }
  // IPv6 link-local + ULA
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  return false;
}

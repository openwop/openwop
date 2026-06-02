/**
 * Durable webhook-delivery worker.
 *
 * Replaces the old `setImmediate` fire-and-forget delivery path (which dropped
 * deliveries on a process crash and never retried a transient failure). The
 * webhook routes now ENQUEUE a `WebhookDeliveryRecord` per matching subscriber
 * (`storage.enqueueWebhookDelivery`); this worker drains the queue:
 *
 *   1. `storage.claimDueWebhookDeliveries` atomically leases a batch of due
 *      rows (multi-instance-safe — Postgres `FOR UPDATE SKIP LOCKED`, sqlite a
 *      write transaction). A crashed worker's lease expires, so another
 *      instance re-claims the row — deliveries survive a crash.
 *   2. Each claimed row is POSTed with the HMAC-SHA256 signature recipe from
 *      `spec/v1/webhooks.md`.
 *   3. Success → `markWebhookDeliveryDelivered`. Failure (network error, or a
 *      non-2xx response) → `rescheduleWebhookDelivery` with exponential backoff
 *      until `maxAttempts`, after which the row is `dead` (dead-letter).
 *
 * `processDueWebhookDeliveries` is exported so tests can drain the queue
 * deterministically (pass a fixed `now`); `startWebhookDeliveryWorker` wraps it
 * in a polling loop for the running server.
 */

import { createHmac } from 'node:crypto';
import type { Storage } from '../storage/storage.js';
import type { WebhookDeliveryRecord } from '../types.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('webhookDeliveryWorker');

/** Per-delivery attempt budget before a row is dead-lettered. */
export const WEBHOOK_MAX_ATTEMPTS = 5;
/** Rows claimed per poll. Kept small so the worst-case sequential batch time
 *  (`CLAIM_BATCH × DELIVERY_TIMEOUT_MS`) stays well under `CLAIM_LEASE_MS` —
 *  otherwise a slow batch's unprocessed tail could have its lease expire and be
 *  re-claimed (and re-delivered) by another instance mid-batch. */
const CLAIM_BATCH = 5;
/** Claim lease duration (ms). A claimed row whose lease expires is re-claimable.
 *  MUST exceed the worst-case batch processing time (`CLAIM_BATCH × timeout` =
 *  5 × 10s = 50s) with margin so an in-progress batch is never re-claimed. */
const CLAIM_LEASE_MS = 120_000;
/** Poll cadence for the running worker. */
const POLL_INTERVAL_MS = 1_000;
/** Per-delivery HTTP timeout. */
const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Exponential backoff for attempt `attempts` (1-based: the delay applied AFTER
 * the Nth failure). 2s, 4s, 8s, 16s, … capped at 5 min. The caller adds this to
 * `now` to get `nextAttemptAt`.
 */
export function webhookBackoffMs(attempts: number): number {
  const base = 2_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 300_000);
}

/** Sign + POST one delivery. Returns true on a 2xx response. The signature
 *  timestamp is computed at SEND time (not the batch-claim time) so a slow batch
 *  doesn't ship later items with a stale `t=` — receivers verify it against the
 *  spec's ±5min freshness window (webhooks.md §"Signature recipe"). */
async function sendDelivery(rec: WebhookDeliveryRecord): Promise<{ ok: boolean; detail: string }> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', rec.secret).update(`${timestamp}.${rec.payload}`).digest('hex');
  try {
    const res = await fetch(rec.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'openwop-signature': `t=${timestamp},v1=${signature}`,
        'openwop-event-type': rec.eventType,
        'openwop-subscription-id': rec.subscriptionId,
      },
      body: rec.payload,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true, detail: `${res.status}` };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Claim and process one batch of due deliveries. Returns the number of rows
 * processed (0 when the queue is idle). Exported for deterministic tests —
 * pass a fixed `now`; the running worker passes `Date.now()`.
 */
export async function processDueWebhookDeliveries(
  storage: Storage,
  workerId: string,
  now: number = Date.now(),
): Promise<number> {
  const due = await storage.claimDueWebhookDeliveries(workerId, now, CLAIM_LEASE_MS, CLAIM_BATCH);
  for (const rec of due) {
    const result = await sendDelivery(rec);
    if (result.ok) {
      await storage.markWebhookDeliveryDelivered(rec.deliveryId, now);
      continue;
    }
    const attempts = rec.attempts + 1;
    const dead = attempts >= rec.maxAttempts;
    const nextAttemptAt = now + webhookBackoffMs(attempts);
    await storage.rescheduleWebhookDelivery(rec.deliveryId, now, nextAttemptAt, dead, result.detail);
    log.warn('webhook delivery failed', {
      subscriptionId: rec.subscriptionId,
      url: rec.url,
      attempt: attempts,
      maxAttempts: rec.maxAttempts,
      dead,
      detail: result.detail,
    });
  }
  return due.length;
}

export interface WebhookDeliveryWorker {
  stop(): void;
}

/**
 * Start the polling delivery worker for the running server. Idempotent guard:
 * one batch at a time (a slow batch never overlaps the next tick). Returns a
 * handle whose `stop()` clears the timer (call on graceful shutdown).
 */
export function startWebhookDeliveryWorker(storage: Storage, workerId: string): WebhookDeliveryWorker {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      // Drain greedily within a tick so a backlog clears fast, but stop once a
      // batch comes back short (queue idle) to yield the event loop.
      let processed = 0;
      do {
        processed = await processDueWebhookDeliveries(storage, workerId);
      } while (processed >= CLAIM_BATCH);
    } catch (err) {
      log.warn('webhook delivery worker tick error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  // Don't keep the process alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
  log.info('webhook delivery worker started', { workerId, pollIntervalMs: POLL_INTERVAL_MS });
  return { stop: () => clearInterval(timer) };
}

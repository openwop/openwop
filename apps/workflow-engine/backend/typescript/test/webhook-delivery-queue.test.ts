/**
 * Durable webhook-delivery queue (replaces the old setImmediate fire-and-forget
 * path). Exercises the storage queue + the worker drain against the in-memory
 * sqlite backend: signed successful delivery, exponential-backoff retry through
 * to dead-letter, and the claim lease that makes the queue crash-recoverable /
 * multi-instance-safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStorage } from '../src/storage/index.js';
import type { Storage } from '../src/storage/storage.js';
import type { WebhookDeliveryRecord } from '../src/types.js';
import {
  processDueWebhookDeliveries,
  webhookBackoffMs,
  WEBHOOK_MAX_ATTEMPTS,
} from '../src/host/webhookDeliveryWorker.js';

const T0 = 1_700_000_000_000; // fixed epoch ms

function makeDelivery(over: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord {
  return {
    deliveryId: over.deliveryId ?? `d-${Math.random().toString(36).slice(2)}`,
    subscriptionId: 'sub-1',
    url: 'https://example.test/hook',
    secret: 'shh',
    eventType: 'run.completed',
    payload: JSON.stringify({ type: 'run.completed', runId: 'r1' }),
    status: 'pending',
    attempts: 0,
    maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    nextAttemptAt: T0,
    claimedBy: null,
    claimExpiresAt: null,
    lastError: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

describe('durable webhook delivery queue', () => {
  let storage: Storage;

  beforeEach(async () => {
    storage = await openStorage('memory://');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers a signed POST once and marks the row terminal', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await storage.enqueueWebhookDelivery(makeDelivery({ deliveryId: 'ok' }));

    const processed = await processDueWebhookDeliveries(storage, 'worker-a', T0);
    expect(processed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Signature recipe: openwop-signature: t=<unix>,v1=<hmac>; correct headers.
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://example.test/hook');
    const headers = (init!.headers ?? {}) as Record<string, string>;
    expect(headers['openwop-event-type']).toBe('run.completed');
    expect(headers['openwop-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    // Terminal: nothing more is due, even far in the future.
    expect(await processDueWebhookDeliveries(storage, 'worker-a', T0 + 3_600_000)).toBe(0);
  });

  it('retries with exponential backoff and dead-letters after maxAttempts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    await storage.enqueueWebhookDelivery(makeDelivery({ deliveryId: 'fail' }));

    let now = T0;
    let totalFetches = 0;
    // Drive the backoff schedule: each failure reschedules at now+backoff(attempt).
    for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS + 2; attempt++) {
      const processed = await processDueWebhookDeliveries(storage, 'worker-a', now);
      if (processed === 0) break; // dead-lettered — no longer due
      totalFetches++;
      now += webhookBackoffMs(attempt); // advance past the reschedule delay
    }
    // Attempted exactly maxAttempts times, then dead-lettered (no further claims).
    expect(totalFetches).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect(fetchSpy).toHaveBeenCalledTimes(WEBHOOK_MAX_ATTEMPTS);
    expect(await processDueWebhookDeliveries(storage, 'worker-a', now + 1_000_000)).toBe(0);
  });

  it('is not due before its backoff elapses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    await storage.enqueueWebhookDelivery(makeDelivery({ deliveryId: 'wait' }));

    expect(await processDueWebhookDeliveries(storage, 'worker-a', T0)).toBe(1); // first attempt fails
    // Immediately after, it's scheduled in the future — not yet due.
    expect(await processDueWebhookDeliveries(storage, 'worker-a', T0 + 1)).toBe(0);
    // After the first backoff window, due again.
    expect(await processDueWebhookDeliveries(storage, 'worker-a', T0 + webhookBackoffMs(1))).toBe(1);
  });

  it('leases a claimed row and re-claims it only after the lease expires (crash recovery)', async () => {
    await storage.enqueueWebhookDelivery(makeDelivery({ deliveryId: 'lease' }));
    const leaseMs = 30_000;

    const first = await storage.claimDueWebhookDeliveries('worker-a', T0, leaseMs, 10);
    expect(first.map((d) => d.deliveryId)).toEqual(['lease']);

    // A second instance can't grab it while the lease is live (worker-a "crashed"
    // before completing — the row stays claimed).
    expect(await storage.claimDueWebhookDeliveries('worker-b', T0 + 5_000, leaseMs, 10)).toEqual([]);

    // Once the lease expires, another instance re-claims it.
    const reclaim = await storage.claimDueWebhookDeliveries('worker-b', T0 + leaseMs + 1, leaseMs, 10);
    expect(reclaim.map((d) => d.deliveryId)).toEqual(['lease']);
    expect(reclaim[0]!.claimedBy).toBe('worker-b');
  });
});

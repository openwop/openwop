/**
 * Durable trigger bridge -- RFC 0083 reference durable-delivery (sample-grade).
 *
 * Implements the RFC 0083 section B subscription state machine + section C delivery model
 * (dedup -> attempt -> retry -> dead-letter -> trigger->run causation) that the RFC
 * deferred to `Active -> Accepted`. A `TriggerSubscription` is a durable inbound
 * work source; `deliver()` wraps a "fire this run" thunk with at-least-once ->
 * effectively-once semantics:
 *
 *   - DEDUP (section C-1): a repeat `dedupKey` within retention is a no-op returning
 *     the prior runId -- at-least-once becomes effectively-once.
 *   - ATTEMPT + RETRY (section C-2): each attempt is recorded; on failure it retries
 *     up to `retryPolicy.maxAttempts`; on exhaustion the subscription
 *     transitions `active -> dead-lettered` (reason `retry-exhausted`).
 *   - CAUSATION (section C-3): a delivered run is created with `causationId` = the
 *     delivery id, so `/ancestry` resolves delivery -> run (the caller's `fire`
 *     thunk threads the delivery id onto the run).
 *
 * The two `trigger.*` events are emitted by the caller on the resulting run's
 * stream (this module is pure state + the delivery algorithm, testable without
 * a server). Store is process-local (sample-grade), mirroring
 * schedulingService.ts; a production host backs it with a durable queue + the
 * RFC 0053 dead-letter sink.
 *
 * @see spec/v1/trigger-bridge.md section B/section C  -  RFCS/0083-durable-trigger-and-channel-bridge-profile.md
 * @see schemas/trigger-subscription.schema.json
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

export type SubscriptionSource = 'webhook' | 'schedule' | 'queue' | 'email' | 'form';
export type SubscriptionState = 'active' | 'paused' | 'failed' | 'dead-lettered';
export type DeliveryOutcome = 'delivered' | 'retrying' | 'dead-lettered';

export interface RetryPolicy {
  maxAttempts: number;
  backoff: 'none' | 'fixed' | 'exponential';
}

export interface TriggerSubscription {
  subscriptionId: string;
  source: SubscriptionSource;
  state: SubscriptionState;
  dedupEnabled: boolean;
  retryPolicy: RetryPolicy;
  tenantId: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  deliveryId: string;
  subscriptionId: string;
  dedupKey: string;
  attempt: number;
  outcome: DeliveryOutcome;
  runId?: string;
  at: string;
}

export interface DeliverResult {
  outcome: 'delivered' | 'deduped' | 'dead-lettered' | 'skipped';
  /** The delivery id used as the run's `causationId` (delivered case). */
  deliveryId: string;
  runId?: string;
  attempts: number;
  stateChange?: { from: SubscriptionState; to: SubscriptionState; reason: 'retry-exhausted' };
}

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, backoff: 'fixed' };

const subscriptions = new Map<string, TriggerSubscription>();
const deliveries: DeliveryAttempt[] = [];
/** dedupKey -> prior runId (the effectively-once index; >=24h floor in prod). */
const dedupIndex = new Map<string, string>();

function nowIso(): string {
  return new Date().toISOString();
}

/** Host-opaque dedup key (section C-1): a one-way hash, never inbound content in
 *  cleartext. */
export function makeDedupKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('')).digest('hex').slice(0, 32);
}

/**
 * Register (or return the existing) subscription. Idempotent by
 * `subscriptionId` -- a caller (e.g. a Kanban board) uses a deterministic id so
 * one durable subscription backs the source across restarts.
 */
export function registerSubscription(input: {
  subscriptionId: string;
  tenantId: string;
  source: SubscriptionSource;
  dedupEnabled?: boolean;
  retryPolicy?: Partial<RetryPolicy>;
  label?: string;
}): TriggerSubscription {
  const existing = subscriptions.get(input.subscriptionId);
  if (existing) return existing;
  const sub: TriggerSubscription = {
    subscriptionId: input.subscriptionId,
    source: input.source,
    state: 'active',
    dedupEnabled: input.dedupEnabled ?? true,
    retryPolicy: { ...DEFAULT_RETRY, ...input.retryPolicy },
    tenantId: input.tenantId,
    label: input.label,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  subscriptions.set(sub.subscriptionId, sub);
  return sub;
}

export function getSubscription(subscriptionId: string): TriggerSubscription | undefined {
  return subscriptions.get(subscriptionId);
}

export function listSubscriptions(tenantId: string): TriggerSubscription[] {
  return [...subscriptions.values()].filter((s) => s.tenantId === tenantId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listDeliveries(subscriptionId: string): DeliveryAttempt[] {
  return deliveries.filter((d) => d.subscriptionId === subscriptionId);
}

/** Operator pause/resume (section B). Returns the state change, or null if a no-op. */
export function setSubscriptionState(
  subscriptionId: string,
  toState: SubscriptionState,
): { from: SubscriptionState; to: SubscriptionState } | null {
  const sub = subscriptions.get(subscriptionId);
  if (!sub || sub.state === toState) return null;
  const from = sub.state;
  sub.state = toState;
  sub.updatedAt = nowIso();
  return { from, to: toState };
}

/**
 * Deliver an inbound event through the section C model. `fire(deliveryId)` MUST create
 * + start the run with `causationId = deliveryId` and resolve its runId (or
 * throw to trigger a retry). Returns the outcome + the delivery id (the run's
 * causationId) + the per-call attempt records (also queryable via
 * `listDeliveries`). The caller emits the `trigger.delivery.attempted` event on
 * the resulting run.
 */
export async function deliver(input: {
  subscriptionId: string;
  dedupKey: string;
  fire: (deliveryId: string) => Promise<string>;
}): Promise<DeliverResult> {
  const sub = subscriptions.get(input.subscriptionId);
  if (!sub) return { outcome: 'skipped', deliveryId: '', attempts: 0 };
  if (sub.state !== 'active') return { outcome: 'skipped', deliveryId: '', attempts: 0 };

  // section C-1 dedup -- effectively-once.
  if (sub.dedupEnabled) {
    const prior = dedupIndex.get(input.dedupKey);
    if (prior !== undefined) {
      return { outcome: 'deduped', deliveryId: '', runId: prior, attempts: 0 };
    }
  }

  const deliveryId = `dlv-${randomUUID()}`;
  const max = Math.max(1, sub.retryPolicy.maxAttempts);
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const runId = await input.fire(deliveryId);
      deliveries.push({ deliveryId, subscriptionId: sub.subscriptionId, dedupKey: input.dedupKey, attempt, outcome: 'delivered', runId, at: nowIso() });
      if (sub.dedupEnabled) dedupIndex.set(input.dedupKey, runId);
      return { outcome: 'delivered', deliveryId, runId, attempts: attempt };
    } catch {
      const last = attempt === max;
      deliveries.push({
        deliveryId,
        subscriptionId: sub.subscriptionId,
        dedupKey: input.dedupKey,
        attempt,
        outcome: last ? 'dead-lettered' : 'retrying',
        at: nowIso(),
      });
      // Sample-grade: retry immediately (no real backoff sleep, so tests stay
      // fast); a production host honors `retryPolicy.backoff`.
    }
  }
  // section C-2 exhaustion -> section B dead-letter (routed to the RFC 0053 sink in prod).
  const from = sub.state;
  sub.state = 'dead-lettered';
  sub.updatedAt = nowIso();
  return { outcome: 'dead-lettered', deliveryId, attempts: max, stateChange: { from, to: 'dead-lettered', reason: 'retry-exhausted' } };
}

/** Test-only: drop all subscriptions + deliveries + dedup index. */
export function __resetTriggerBridgeStore(): void {
  subscriptions.clear();
  deliveries.length = 0;
  dedupIndex.clear();
}

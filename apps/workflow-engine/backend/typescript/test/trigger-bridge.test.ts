/**
 * Durable trigger bridge (RFC 0083 reference durable-delivery) + the Kanban
 * bridge through it.
 *
 * Covers:
 *   1. The pure service (host/triggerBridgeService.ts): subscription register
 *      (idempotent), the §C delivery model — delivered / dedup (effectively-
 *      once) / retry → dead-letter (state machine) — and operator pause →
 *      skip.
 *   2. The REST read surface (`GET /v1/trigger-subscriptions[/{id}]`) + the
 *      Kanban bridge: a card→To Do move registers a `queue` subscription,
 *      records a delivered delivery, and a repeat move of the same card to the
 *      same column de-duplicates to the same run.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import {
  __resetHostExtPersistence,
  initHostExtPersistence,
} from '../src/host/hostExtPersistence.js';
import {
  __resetTriggerBridgeStore,
  __setDedupRetentionMs,
  deliver,
  getSubscription,
  listDeliveries,
  makeDedupKey,
  registerSubscription,
  setSubscriptionState,
} from '../src/host/triggerBridgeService.js';

describe('trigger-bridge service (pure, RFC 0083 §C)', () => {
  const storage = openSqliteStorage(':memory:');
  beforeAll(() => {
    initHostExtPersistence(storage);
  });
  afterAll(async () => {
    __resetHostExtPersistence();
    await storage.close();
  });
  beforeEach(async () => {
    initHostExtPersistence(storage);
    await __resetTriggerBridgeStore();
  });

  it('registerSubscription is idempotent by subscriptionId', async () => {
    const a = await registerSubscription({ subscriptionId: 'sub-1', tenantId: 't1', source: 'queue' });
    const b = await registerSubscription({ subscriptionId: 'sub-1', tenantId: 't1', source: 'queue' });
    // Read-through returns a freshly-deserialized object each call, so this is
    // value-equality (the idempotency guarantee is "same subscription, not a
    // second row"), not reference-equality.
    expect(a).toEqual(b);
    expect(a.state).toBe('active');
  });

  it('delivers, recording a delivered attempt + the run causationId handle', async () => {
    await registerSubscription({ subscriptionId: 'sub-1', tenantId: 't1', source: 'queue' });
    const res = await deliver({ subscriptionId: 'sub-1', dedupKey: 'k1', fire: async () => 'run-A' });
    expect(res.outcome).toBe('delivered');
    expect(res.runId).toBe('run-A');
    expect(res.deliveryId.startsWith('dlv-')).toBe(true);
    const d = await listDeliveries('sub-1');
    expect(d).toHaveLength(1);
    expect(d[0]!.outcome).toBe('delivered');
  });

  it('de-duplicates a repeat dedupKey to the prior run (effectively-once, §C-1)', async () => {
    await registerSubscription({ subscriptionId: 'sub-1', tenantId: 't1', source: 'queue' });
    await deliver({ subscriptionId: 'sub-1', dedupKey: 'k1', fire: async () => 'run-A' });
    let fired = false;
    const res = await deliver({ subscriptionId: 'sub-1', dedupKey: 'k1', fire: async () => { fired = true; return 'run-B'; } });
    expect(res.outcome).toBe('deduped');
    expect(res.runId).toBe('run-A'); // returns the prior run
    expect(fired).toBe(false); // the fire thunk was NOT invoked
  });

  it('retries then dead-letters on exhaustion, transitioning the subscription (§C-2 / §B)', async () => {
    await registerSubscription({ subscriptionId: 'sub-1', tenantId: 't1', source: 'queue', retryPolicy: { maxAttempts: 3, backoff: 'none' } });
    const res = await deliver({ subscriptionId: 'sub-1', dedupKey: 'k1', fire: async () => { throw new Error('downstream down'); } });
    expect(res.outcome).toBe('dead-lettered');
    expect(res.attempts).toBe(3);
    expect(res.stateChange).toEqual({ from: 'active', to: 'dead-lettered', reason: 'retry-exhausted' });
    expect((await getSubscription('sub-1'))!.state).toBe('dead-lettered');
    expect((await listDeliveries('sub-1')).map((d) => d.outcome)).toEqual(['retrying', 'retrying', 'dead-lettered']);
  });

  it('skips delivery when the subscription is paused (§B)', async () => {
    await registerSubscription({ subscriptionId: 'sub-1', tenantId: 't1', source: 'queue' });
    await setSubscriptionState('sub-1', 'paused');
    const res = await deliver({ subscriptionId: 'sub-1', dedupKey: 'k1', fire: async () => 'run-A' });
    expect(res.outcome).toBe('skipped');
  });

  it('makeDedupKey is host-opaque (a hash, not inbound content)', () => {
    const key = makeDedupKey('sub-1', 'card-7', 'todo');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('card-7');
  });
});

describe('trigger-bridge read surface + Kanban bridge (sqlite memory app)', () => {
  let server: http.Server;
  const PORT = 18755;
  const BASE = `http://127.0.0.1:${PORT}`;
  const TOKEN = 'sample-token';

  beforeAll(async () => {
    process.env.OPENWOP_STORAGE_DSN = 'memory://';
    process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
    const app = await createApp({ port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false });
    await __resetTriggerBridgeStore();
    await new Promise<void>((res) => { server = app.listen(PORT, res); });
  });

  afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

  async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
    if (res.status === 204) return { status: 204, body: undefined as unknown as T };
    return { status: res.status, body: (await res.json()) as T };
  }

  it('advertises triggerBridge.supported in discovery', async () => {
    const { body } = await jsonFetch<{ triggerBridge?: { supported?: boolean; sources?: string[] } }>('/.well-known/openwop');
    expect(body.triggerBridge?.supported).toBe(true);
    expect(body.triggerBridge?.sources).toContain('queue');
  });

  it('a Kanban card→To Do move registers a queue subscription with a delivered delivery, and re-moves de-duplicate', async () => {
    const triggerWorkflowId = (await jsonFetch<{ fixtures?: string[] }>('/.well-known/openwop')).body.fixtures?.[0];
    const board = await jsonFetch<{ id: string }>('/v1/host/sample/kanban/boards', {
      method: 'POST',
      body: JSON.stringify({ name: 'TB board', triggerWorkflowId }),
    });
    const boardId = board.body.id;
    const card = await jsonFetch<{ id: string }>(`/v1/host/sample/kanban/boards/${boardId}/cards`, {
      method: 'POST',
      body: JSON.stringify({ title: 'x', columnId: 'doing' }),
    });

    // Move into To Do → delivered.
    const m1 = await jsonFetch<{ triggeredRunId: string | null }>(`/v1/host/sample/kanban/cards/${card.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ columnId: 'todo' }),
    });
    expect(typeof m1.body.triggeredRunId).toBe('string');

    // The board's subscription is visible with a delivered delivery.
    const subs = await jsonFetch<{ subscriptions: { subscriptionId: string; source: string; state: string }[] }>('/v1/trigger-subscriptions');
    const sub = subs.body.subscriptions.find((s) => s.subscriptionId === `host:kanban:${boardId}`);
    expect(sub?.source).toBe('queue');
    expect(sub?.state).toBe('active');
    const detail = await jsonFetch<{ deliveries: { outcome: string; runId?: string }[] }>(`/v1/trigger-subscriptions/${encodeURIComponent(sub!.subscriptionId)}`);
    expect(detail.body.deliveries.some((d) => d.outcome === 'delivered' && d.runId === m1.body.triggeredRunId)).toBe(true);

    // Move out and back into To Do → same dedupKey → deduped to the same run.
    await jsonFetch(`/v1/host/sample/kanban/cards/${card.body.id}`, { method: 'PATCH', body: JSON.stringify({ columnId: 'doing' }) });
    const m2 = await jsonFetch<{ triggeredRunId: string | null }>(`/v1/host/sample/kanban/cards/${card.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ columnId: 'todo' }),
    });
    expect(m2.body.triggeredRunId).toBe(m1.body.triggeredRunId); // effectively-once
  });
});

describe('trigger-bridge: dedup retention eviction (§C-1)', () => {
  const storage = openSqliteStorage(':memory:');
  beforeAll(() => {
    initHostExtPersistence(storage);
  });
  afterAll(async () => {
    __resetHostExtPersistence();
    await storage.close();
  });
  beforeEach(async () => {
    initHostExtPersistence(storage);
    await __resetTriggerBridgeStore();
  });

  it('evicts a dedup entry past the retention window so a re-delivery fires fresh', async () => {
    await registerSubscription({ subscriptionId: 'sub-1', tenantId: 't1', source: 'queue' });
    __setDedupRetentionMs(0); // every prior entry is immediately stale
    const r1 = await deliver({ subscriptionId: 'sub-1', dedupKey: 'k1', fire: async () => 'run-A' });
    expect(r1.outcome).toBe('delivered');
    let fired = false;
    const r2 = await deliver({ subscriptionId: 'sub-1', dedupKey: 'k1', fire: async () => { fired = true; return 'run-B'; } });
    // Retention 0 ⇒ the prior k1 entry is evicted ⇒ NOT deduped ⇒ fires fresh.
    expect(r2.outcome).toBe('delivered');
    expect(r2.runId).toBe('run-B');
    expect(fired).toBe(true);
  });
});

describe('trigger-bridge: durability (subscriptions + deliveries + dedup survive restart)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'owop-tb-dur-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('persists then read-through-reads a subscription + delivery + dedup index from a fresh store', async () => {
    const path = join(dir, 'tb.db');

    const s1 = openSqliteStorage(path);
    initHostExtPersistence(s1);
    await __resetTriggerBridgeStore();
    await registerSubscription({ subscriptionId: 'host:kanban:b1', tenantId: 'acme', source: 'queue' });
    const r1 = await deliver({ subscriptionId: 'host:kanban:b1', dedupKey: 'dk1', fire: async () => 'run-A' });
    expect(r1.outcome).toBe('delivered');
    await s1.close();

    // Restart: a brand-new handle on the same file. Read-through means NO
    // hydrate step — every read goes straight to the durable row.
    __resetHostExtPersistence();
    const s2 = openSqliteStorage(path);
    initHostExtPersistence(s2);

    expect((await getSubscription('host:kanban:b1'))?.tenantId).toBe('acme');
    expect((await listDeliveries('host:kanban:b1')).some((d) => d.outcome === 'delivered' && d.runId === 'run-A')).toBe(true);
    // Effectively-once SURVIVES the restart: re-delivering dk1 dedups to run-A.
    const r2 = await deliver({ subscriptionId: 'host:kanban:b1', dedupKey: 'dk1', fire: async () => 'run-B' });
    expect(r2.outcome).toBe('deduped');
    expect(r2.runId).toBe('run-A');
    await s2.close();
  });
});

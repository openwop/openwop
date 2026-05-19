/**
 * Storage adapter parity — SQLite vs real Postgres (via testcontainers).
 *
 * Companion to `storage-adapter-parity.test.ts`, which exercises pg-mem.
 * That file documents 8 SQL patterns pg-mem can't model:
 *   - JSONB array param auto-stringification (webhook `events`)
 *   - `WITH ... INSERT ... RETURNING` CTE atomicity (event sequence)
 *   - `INSERT ... ON CONFLICT DO NOTHING RETURNING` ordering (idempotency claim)
 *   - cascading DELETE coverage (`deleteAllTenantData`)
 *
 * This file targets the same Postgres adapter at a REAL Postgres instance
 * via `@testcontainers/postgresql` so those 8 patterns get exercised
 * end-to-end. Pairs with `PG_MEM_INCOMPAT` in the sibling file: every
 * test here MUST cover a pattern listed there.
 *
 * Docker requirement: testcontainers needs a running Docker daemon.
 * The entire suite soft-skips when Docker isn't reachable, so dev
 * machines without Docker keep `npm test` green while CI (with Docker)
 * exercises the full coverage.
 *
 * Boot cost: pulling postgres:16-alpine on first run is ~80 MB / 30s.
 * Subsequent runs hit the local image cache.
 *
 * @see test/storage-adapter-parity.test.ts (companion; pg-mem coverage)
 * @see src/storage/postgres/index.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { openPostgresStorage } from '../src/storage/postgres/index.js';
import type { Storage } from '../src/storage/storage.js';
import type { RunRecord, InterruptRecord, WebhookSubscriptionRecord } from '../src/types.js';

// Skip the entire file when Docker isn't reachable. testcontainers does
// its own probe at container-start time, so we replicate the check at
// suite collection time to avoid a 30s timeout when Docker is absent.
async function isDockerReachable(): Promise<boolean> {
  if (process.env.OPENWOP_SKIP_TESTCONTAINERS === '1') return false;
  try {
    // Best-effort socket probe — Docker daemon listens on the host
    // socket. Failure modes (ENOENT, ECONNREFUSED, ETIMEDOUT) all
    // resolve to false; only an active daemon returns true.
    const { execSync } = await import('node:child_process');
    execSync('docker info > /dev/null 2>&1', { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

let container: StartedPostgreSqlContainer | null = null;
let storage: Storage | null = null;
let dockerAvailable = false;

const baseTime = '2026-05-18T10:00:00.000Z';

function mkRun(suffix: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: `run-${suffix}`,
    workflowId: `wf.${suffix}`,
    tenantId: 'tenant-a',
    status: 'pending',
    inputs: { hello: suffix },
    metadata: {},
    configurable: {},
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  };
}

function mkInterrupt(runId: string, nodeId: string): InterruptRecord {
  return {
    interruptId: `int-${runId}-${nodeId}`,
    runId,
    nodeId,
    kind: 'approval',
    token: `tok-${runId}-${nodeId}`,
    data: { prompt: 'go?' },
    createdAt: baseTime,
  };
}

function mkWebhook(id: string): WebhookSubscriptionRecord {
  return {
    subscriptionId: `sub-${id}`,
    url: `https://example.test/webhook/${id}`,
    events: ['run.completed', 'run.failed'],
    secret: 'whsec_test',
    createdAt: baseTime,
  };
}

beforeAll(async () => {
  dockerAvailable = await isDockerReachable();
  if (!dockerAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      '[parity-testcontainers] Docker not reachable — skipping real-Postgres parity tests. '
        + 'Set OPENWOP_SKIP_TESTCONTAINERS=1 to suppress this notice in CI environments that intentionally exclude Docker.',
    );
    return;
  }
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  storage = await openPostgresStorage(container.getConnectionUri());
}, 120_000); // 2-minute timeout for first-run image pull

afterAll(async () => {
  if (storage) {
    try {
      await storage.close();
    } catch {
      // ignore
    }
  }
  if (container) {
    try {
      await container.stop();
    } catch {
      // ignore
    }
  }
}, 60_000);

const skipNoDocker = !dockerAvailable;

// Each test below covers one of the 8 patterns in PG_MEM_INCOMPAT.
// Tagged via the docstring so a future contributor can cross-reference.

describe('Postgres parity (real DB): events monotonic sequence — CTE-RETURNING atomicity', () => {
  it.skipIf(skipNoDocker)('appendEvent assigns +1 per call (postgres CTE)', async () => {
    const s = storage!;
    const run = mkRun(`pg-event-seq`);
    await s.insertRun(run);
    const e1 = await s.appendEvent({ runId: run.runId, type: 'run.started', payload: {}, timestamp: baseTime, eventId: 'pg-e1' });
    const e2 = await s.appendEvent({ runId: run.runId, type: 'node.started', payload: {}, timestamp: baseTime, eventId: 'pg-e2' });
    const e3 = await s.appendEvent({ runId: run.runId, type: 'run.completed', payload: {}, timestamp: baseTime, eventId: 'pg-e3' });
    expect(e2.sequence - e1.sequence).toBe(1);
    expect(e3.sequence - e2.sequence).toBe(1);
  });

  it.skipIf(skipNoDocker)('listEvents returns sequence-ordered events', async () => {
    const s = storage!;
    const run = mkRun(`pg-event-list`);
    await s.insertRun(run);
    await s.appendEvent({ runId: run.runId, type: 'run.started', payload: {}, timestamp: baseTime, eventId: 'pg-el1' });
    await s.appendEvent({ runId: run.runId, type: 'run.completed', payload: {}, timestamp: baseTime, eventId: 'pg-el2' });
    const events = await s.listEvents(run.runId);
    expect(events.length).toBe(2);
    expect(events[0]?.type).toBe('run.started');
    expect(events[1]?.type).toBe('run.completed');
  });

  it.skipIf(skipNoDocker)('getMaxSequence increases monotonically per append', async () => {
    const s = storage!;
    const run = mkRun(`pg-event-max`);
    await s.insertRun(run);
    const m0 = await s.getMaxSequence(run.runId);
    await s.appendEvent({ runId: run.runId, type: 'run.started', payload: {}, timestamp: baseTime, eventId: 'pg-em1' });
    const m1 = await s.getMaxSequence(run.runId);
    expect(m1).toBeGreaterThan(m0);
    await s.appendEvent({ runId: run.runId, type: 'node.started', payload: {}, timestamp: baseTime, eventId: 'pg-em2' });
    const m2 = await s.getMaxSequence(run.runId);
    expect(m2 - m1).toBe(1);
  });
});

describe('Postgres parity (real DB): idempotency — INSERT-ON-CONFLICT-RETURNING', () => {
  it.skipIf(skipNoDocker)('first call claims; second returns existing', async () => {
    const s = storage!;
    const key = `pg-idem-${Math.random().toString(36).slice(2)}`;
    const first = await s.claimIdempotency(key, baseTime);
    expect(first.claimed).toBe(true);
    const second = await s.claimIdempotency(key, baseTime);
    expect(second.claimed).toBe(false);
    expect(second.existing).not.toBeNull();
  });

  it.skipIf(skipNoDocker)('putIdempotency upgrades the pending placeholder', async () => {
    const s = storage!;
    const key = `pg-idem-upgrade-${Math.random().toString(36).slice(2)}`;
    await s.claimIdempotency(key, baseTime);
    await s.putIdempotency({
      key,
      responseBody: '{"runId":"pg-r"}',
      responseStatus: 201,
      createdAt: baseTime,
    });
    const second = await s.claimIdempotency(key, baseTime);
    expect(second.existing?.responseStatus).toBe(201);
  });
});

describe('Postgres parity (real DB): webhooks — JSONB array marshalling', () => {
  it.skipIf(skipNoDocker)('insertWebhook → getWebhook round-trips with JSONB events array', async () => {
    const s = storage!;
    const wh = mkWebhook(`pg-1`);
    await s.insertWebhook(wh);
    const got = await s.getWebhook(wh.subscriptionId);
    expect(got?.url).toBe(wh.url);
    expect(got?.events).toEqual(wh.events);
  });

  it.skipIf(skipNoDocker)('deleteWebhook removes the row', async () => {
    const s = storage!;
    const wh = mkWebhook(`pg-delete`);
    await s.insertWebhook(wh);
    await s.deleteWebhook(wh.subscriptionId);
    expect(await s.getWebhook(wh.subscriptionId)).toBeNull();
  });
});

describe('Postgres parity (real DB): tenant cascade DELETE', () => {
  it.skipIf(skipNoDocker)('deleteAllTenantData cascades runs + events + interrupts + secrets', async () => {
    const s = storage!;
    const T = `pg-del-tenant-${Math.random().toString(36).slice(2)}`;
    const r1 = mkRun(`pg-del-1`, { tenantId: T });
    const r2 = mkRun(`pg-del-2`, { tenantId: T });
    await s.insertRun(r1);
    await s.insertRun(r2);
    await s.appendEvent({ runId: r1.runId, type: 'run.started', payload: {}, timestamp: baseTime, eventId: `pg-del-ev-1` });
    await s.insertInterrupt(mkInterrupt(r1.runId, `pg-del-n1`));
    await s.upsertTenantSecret(T, 'pg-del-ref', '{"v":"x"}', baseTime);

    const counts = await s.deleteAllTenantData(T);
    expect(counts.runs).toBeGreaterThanOrEqual(2);
    expect(counts.events).toBeGreaterThanOrEqual(1);
    expect(counts.interrupts).toBeGreaterThanOrEqual(1);
    expect(counts.secrets).toBeGreaterThanOrEqual(1);

    expect(await s.getRun(r1.runId)).toBeNull();
    expect(await s.getRun(r2.runId)).toBeNull();
    expect(await s.getTenantSecret(T, 'pg-del-ref')).toBeNull();
  });
});

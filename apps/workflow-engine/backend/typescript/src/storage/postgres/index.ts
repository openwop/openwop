/**
 * Postgres-backed Storage implementation.
 *
 * Targets Cloud SQL Postgres for the signed-in tier of the
 * app.openwop.dev demo (P3.3). Implements the same Storage interface
 * as sqlite + memory so the executor + routes don't care about the
 * backing store.
 *
 * Connection model:
 *   - One `pg.Pool` per process. Default pool: max=20, idleTimeoutMillis=30s.
 *   - Cloud Run min=0 max=10 → at most 200 connections in the worst case.
 *     Set Cloud SQL max_connections >= 250 to stay headroom-safe.
 *   - The pool reconnects automatically on transient drops.
 *
 * Atomicity:
 *   - `appendEvent`         uses a single `WITH … INSERT` to read the
 *                            current max sequence and insert in one
 *                            statement (no explicit transaction needed).
 *   - `claimIdempotency`    uses `INSERT … ON CONFLICT DO NOTHING
 *                            RETURNING` to claim under a single round-trip.
 *   - `updateRun`           uses `UPDATE … RETURNING *` so we don't
 *                            need a SELECT-then-UPDATE pair.
 *
 * BYOK secrets carry an explicit tenant_id column (default `__global__`
 * for backward-compat). Sqlite/memory keep the flat shape; the
 * Postgres-backed flow gets per-tenant isolation for free.
 */

import { Pool, type PoolConfig } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  EventRecord,
  InterruptRecord,
  RunRecord,
  WebhookSubscriptionRecord,
} from '../../types.js';
import type { Storage } from '../storage.js';
import { applyMigrations } from './schema.js';

type Row = Record<string, unknown>;

function rowToRun(r: Row): RunRecord {
  return {
    runId: r.run_id as string,
    workflowId: r.workflow_id as string,
    tenantId: r.tenant_id as string,
    scopeId: (r.scope_id as string | null) ?? undefined,
    status: r.status as RunRecord['status'],
    inputs: r.inputs ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    configurable: (r.configurable as Record<string, unknown> | null) ?? {},
    callbackUrl: (r.callback_url as string | null) ?? undefined,
    idempotencyKey: (r.idempotency_key as string | null) ?? undefined,
    parentRunId: (r.parent_run_id as string | null) ?? undefined,
    parentSeq: (r.parent_seq as number | null) ?? undefined,
    forkMode: (r.fork_mode as RunRecord['forkMode'] | null) ?? undefined,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
    completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : undefined,
    currentNodeId: (r.current_node_id as string | null) ?? undefined,
    schedulerSnapshot: (r.scheduler_snapshot as string | null) ?? undefined,
    ...(r.error_code
      ? { error: { code: r.error_code as string, message: (r.error_message as string | null) ?? '' } }
      : {}),
  };
}

function rowToEvent(r: Row): EventRecord {
  return {
    eventId: r.event_id as string,
    runId: r.run_id as string,
    sequence: r.sequence as number,
    type: r.type as string,
    nodeId: (r.node_id as string | null) ?? undefined,
    payload: r.payload ?? null,
    timestamp: (r.timestamp as Date).toISOString(),
    causationId: (r.causation_id as string | null) ?? undefined,
  };
}

function rowToInterrupt(r: Row): InterruptRecord {
  return {
    interruptId: r.interrupt_id as string,
    runId: r.run_id as string,
    nodeId: r.node_id as string,
    kind: r.kind as InterruptRecord['kind'],
    token: r.token as string,
    data: r.data ?? null,
    resumeSchema: (r.resume_schema as Record<string, unknown> | null) ?? undefined,
    createdAt: (r.created_at as Date).toISOString(),
    resolvedAt: r.resolved_at ? (r.resolved_at as Date).toISOString() : undefined,
    resolvedValue: r.resolved_value ?? undefined,
  };
}

function rowToWebhook(r: Row): WebhookSubscriptionRecord {
  return {
    subscriptionId: r.subscription_id as string,
    url: r.url as string,
    events: (r.events as string[] | null) ?? [],
    tags: (r.tags as string[] | null) ?? undefined,
    secret: r.secret as string,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export interface PostgresStorageOptions extends PoolConfig {
  connectionString: string;
}

export async function openPostgresStorage(options: PostgresStorageOptions | string): Promise<Storage> {
  const opts: PostgresStorageOptions =
    typeof options === 'string' ? { connectionString: options } : options;
  const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 30_000,
    ...opts,
  });

  // Run migrations once at boot. Single dedicated client; avoid
  // holding a pool slot for the duration of DDL.
  const migrationClient = await pool.connect();
  try {
    await applyMigrations(migrationClient as unknown as import('pg').Client);
  } finally {
    migrationClient.release();
  }

  const impl: Storage = {
    async insertRun(run) {
      await pool.query(
        `INSERT INTO runs (
          run_id, workflow_id, tenant_id, scope_id, status,
          inputs, metadata, configurable, callback_url,
          idempotency_key, parent_run_id, parent_seq, fork_mode,
          created_at, updated_at, completed_at, error_code, error_message,
          current_node_id, scheduler_snapshot
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
        )`,
        [
          run.runId, run.workflowId, run.tenantId, run.scopeId ?? null, run.status,
          run.inputs ?? null,
          run.metadata ?? {},
          run.configurable ?? {},
          run.callbackUrl ?? null,
          run.idempotencyKey ?? null,
          run.parentRunId ?? null,
          run.parentSeq ?? null,
          run.forkMode ?? null,
          run.createdAt, run.updatedAt, run.completedAt ?? null,
          run.error?.code ?? null, run.error?.message ?? null,
          run.currentNodeId ?? null,
          run.schedulerSnapshot ?? null,
        ],
      );
    },

    async getRun(runId) {
      const { rows } = await pool.query<Row>(`SELECT * FROM runs WHERE run_id = $1`, [runId]);
      return rows[0] ? rowToRun(rows[0]) : null;
    },

    async updateRun(runId, patch) {
      const existing = await impl.getRun(runId);
      if (!existing) return;
      const merged: RunRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      await pool.query(
        `UPDATE runs SET
          status = $1,
          inputs = $2,
          metadata = $3,
          configurable = $4,
          callback_url = $5,
          updated_at = $6,
          completed_at = $7,
          error_code = $8,
          error_message = $9,
          current_node_id = $10,
          scheduler_snapshot = $11
        WHERE run_id = $12`,
        [
          merged.status,
          merged.inputs ?? null,
          merged.metadata ?? {},
          merged.configurable ?? {},
          merged.callbackUrl ?? null,
          merged.updatedAt,
          merged.completedAt ?? null,
          merged.error?.code ?? null,
          merged.error?.message ?? null,
          merged.currentNodeId ?? null,
          merged.schedulerSnapshot ?? null,
          runId,
        ],
      );
    },

    async listRuns({ tenantId, status, limit = 100 }) {
      const { rows } = await pool.query<Row>(
        `SELECT * FROM runs
         WHERE ($1::text IS NULL OR tenant_id = $1)
           AND ($2::text IS NULL OR status = $2)
         ORDER BY created_at DESC
         LIMIT $3`,
        [tenantId ?? null, status ?? null, limit],
      );
      return rows.map(rowToRun);
    },

    async appendEvent(input) {
      const eventId = input.eventId || randomUUID();
      // Single round-trip: compute next sequence + insert atomically.
      const { rows } = await pool.query<Row>(
        `WITH next AS (
           SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM events WHERE run_id = $1
         )
         INSERT INTO events (event_id, run_id, sequence, type, node_id, payload, timestamp, causation_id)
         SELECT $2, $1, next.seq, $3, $4, $5, $6, $7 FROM next
         RETURNING event_id, run_id, sequence, type, node_id, payload, timestamp, causation_id`,
        [
          input.runId, eventId, input.type, input.nodeId ?? null,
          input.payload ?? null, input.timestamp, input.causationId ?? null,
        ],
      );
      return rowToEvent(rows[0]!);
    },

    async listEvents(runId, opts = {}) {
      const fromSeq = opts.fromSeq ?? 0;
      const limit = opts.limit ?? 1000;
      const { rows } = await pool.query<Row>(
        `SELECT * FROM events
         WHERE run_id = $1 AND sequence > $2
         ORDER BY sequence ASC
         LIMIT $3`,
        [runId, fromSeq, limit],
      );
      return rows.map(rowToEvent);
    },

    async getMaxSequence(runId) {
      const { rows } = await pool.query<{ max: string | number | null }>(
        `SELECT COALESCE(MAX(sequence), 0) AS max FROM events WHERE run_id = $1`,
        [runId],
      );
      return Number(rows[0]?.max ?? 0);
    },

    async insertInterrupt(record) {
      await pool.query(
        `INSERT INTO interrupts (interrupt_id, run_id, node_id, kind, token, data, resume_schema, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          record.interruptId, record.runId, record.nodeId, record.kind, record.token,
          record.data ?? null, record.resumeSchema ?? null, record.createdAt,
        ],
      );
    },

    async getInterrupt(interruptId) {
      const { rows } = await pool.query<Row>(`SELECT * FROM interrupts WHERE interrupt_id = $1`, [interruptId]);
      return rows[0] ? rowToInterrupt(rows[0]) : null;
    },

    async getInterruptByToken(token) {
      const { rows } = await pool.query<Row>(`SELECT * FROM interrupts WHERE token = $1`, [token]);
      return rows[0] ? rowToInterrupt(rows[0]) : null;
    },

    async getInterruptByNode(runId, nodeId) {
      const { rows } = await pool.query<Row>(
        `SELECT * FROM interrupts
         WHERE run_id = $1 AND node_id = $2 AND resolved_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [runId, nodeId],
      );
      return rows[0] ? rowToInterrupt(rows[0]) : null;
    },

    async resolveInterrupt(interruptId, resolvedValue, resolvedAt) {
      await pool.query(
        `UPDATE interrupts SET resolved_at = $1, resolved_value = $2 WHERE interrupt_id = $3`,
        [resolvedAt, resolvedValue ?? null, interruptId],
      );
    },

    async listOpenInterrupts(runId) {
      const { rows } = await pool.query<Row>(
        `SELECT * FROM interrupts WHERE run_id = $1 AND resolved_at IS NULL`,
        [runId],
      );
      return rows.map(rowToInterrupt);
    },

    async insertWebhook(record) {
      await pool.query(
        `INSERT INTO webhooks (subscription_id, url, events, tags, secret, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          record.subscriptionId, record.url,
          record.events, record.tags ?? null,
          record.secret, record.createdAt,
        ],
      );
    },

    async getWebhook(subscriptionId) {
      const { rows } = await pool.query<Row>(`SELECT * FROM webhooks WHERE subscription_id = $1`, [subscriptionId]);
      return rows[0] ? rowToWebhook(rows[0]) : null;
    },

    async deleteWebhook(subscriptionId) {
      await pool.query(`DELETE FROM webhooks WHERE subscription_id = $1`, [subscriptionId]);
    },

    async listWebhooks({ eventType, tags }) {
      const { rows } = await pool.query<Row>(`SELECT * FROM webhooks`);
      const all = rows.map(rowToWebhook);
      return all.filter((sub) => {
        if (eventType && !sub.events.includes(eventType) && !sub.events.includes('*')) return false;
        const subTags = sub.tags;
        if (tags && tags.length > 0 && subTags && subTags.length > 0) {
          const hasTag = tags.some((t) => subTags.includes(t));
          if (!hasTag) return false;
        }
        return true;
      });
    },

    async claimIdempotency(key, createdAt) {
      // INSERT … ON CONFLICT DO NOTHING — returns row only if we won
      // the insert. If empty, fetch the existing record.
      const ins = await pool.query<Row>(
        `INSERT INTO idempotency (key, response_body, response_status, created_at)
         VALUES ($1, '__pending__', 0, $2)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [key, createdAt],
      );
      if (ins.rowCount === 1) return { claimed: true, existing: null };
      const { rows } = await pool.query<Row>(
        `SELECT key, response_body, response_status, created_at FROM idempotency WHERE key = $1`,
        [key],
      );
      const r = rows[0]!;
      return {
        claimed: false,
        existing: {
          key: r.key as string,
          responseBody: r.response_body as string,
          responseStatus: r.response_status as number,
          createdAt: (r.created_at as Date).toISOString(),
        },
      };
    },

    async putIdempotency(record) {
      await pool.query(
        `INSERT INTO idempotency (key, response_body, response_status, created_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (key) DO UPDATE SET
           response_body = EXCLUDED.response_body,
           response_status = EXCLUDED.response_status,
           created_at = EXCLUDED.created_at`,
        [record.key, record.responseBody, record.responseStatus, record.createdAt],
      );
    },

    async appendAudit(input) {
      await pool.query(
        `INSERT INTO audit_log (audit_id, timestamp, principal_id, action, resource, outcome, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          randomUUID(), input.timestamp, input.principalId ?? null,
          input.action, input.resource ?? null, input.outcome ?? null,
          input.payload ?? null,
        ],
      );
    },

    async getInvocation({ runId, nodeId, attempt, providerKey }) {
      const { rows } = await pool.query<{ result: unknown }>(
        `SELECT result FROM invocation_log
         WHERE run_id = $1 AND node_id = $2 AND attempt = $3 AND provider_key = $4`,
        [runId, nodeId, attempt, providerKey],
      );
      return rows[0]?.result ?? null;
    },

    async putInvocation({ runId, nodeId, attempt, providerKey }, result) {
      await pool.query(
        `INSERT INTO invocation_log (run_id, node_id, attempt, provider_key, result, created_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (run_id, node_id, attempt, provider_key) DO UPDATE SET
           result = EXCLUDED.result,
           created_at = EXCLUDED.created_at`,
        [runId, nodeId, attempt, providerKey, result ?? null],
      );
    },

    async upsertEncryptedSecret(credentialRef, encryptedRecordJson, now) {
      // Backend signature stays flat (no tenantId) — sqlite has the same
      // shape. The byok_secrets table has tenant_id with a __global__
      // default so legacy callers keep working. KMS-encrypted per-tenant
      // BYOK (P3.4) writes via a different path that respects tenantId.
      await pool.query(
        `INSERT INTO byok_secrets (credential_ref, tenant_id, encrypted_record, created_at, updated_at)
         VALUES ($1, '__global__', $2, $3, $3)
         ON CONFLICT (tenant_id, credential_ref) DO UPDATE SET
           encrypted_record = EXCLUDED.encrypted_record,
           updated_at = EXCLUDED.updated_at`,
        [credentialRef, encryptedRecordJson, now],
      );
    },

    async getEncryptedSecret(credentialRef) {
      const { rows } = await pool.query<{ encrypted_record: string }>(
        `SELECT encrypted_record FROM byok_secrets WHERE tenant_id = '__global__' AND credential_ref = $1`,
        [credentialRef],
      );
      return rows[0]?.encrypted_record ?? null;
    },

    async deleteSecret(credentialRef) {
      await pool.query(
        `DELETE FROM byok_secrets WHERE tenant_id = '__global__' AND credential_ref = $1`,
        [credentialRef],
      );
    },

    async listSecretRefs() {
      const { rows } = await pool.query<{ credential_ref: string }>(
        `SELECT credential_ref FROM byok_secrets WHERE tenant_id = '__global__' ORDER BY credential_ref ASC`,
      );
      return rows.map((r) => r.credential_ref);
    },

    async close() {
      await pool.end();
    },
  };
  return impl;
}

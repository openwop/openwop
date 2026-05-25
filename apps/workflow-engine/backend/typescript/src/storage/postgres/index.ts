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
  ChatMessageRecord,
  ChatSessionRecord,
  EventRecord,
  InterruptRecord,
  NotificationRecord,
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

function rowToNotification(r: Row): NotificationRecord {
  return {
    notificationId: r.notification_id as string,
    tenantId: r.tenant_id as string,
    type: r.type as string,
    priority: r.priority as NotificationRecord['priority'],
    status: r.status as NotificationRecord['status'],
    title: r.title as string,
    message: r.message as string,
    runId: (r.run_id as string | null) ?? undefined,
    workflowId: (r.workflow_id as string | null) ?? undefined,
    nodeId: (r.node_id as string | null) ?? undefined,
    interruptId: (r.interrupt_id as string | null) ?? undefined,
    actionUrl: (r.action_url as string | null) ?? undefined,
    metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: (r.created_at as Date).toISOString(),
    readAt: r.read_at ? (r.read_at as Date).toISOString() : undefined,
    archivedAt: r.archived_at ? (r.archived_at as Date).toISOString() : undefined,
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
    await applyMigrations(migrationClient);
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
      // Serialize per-run via a transaction-scoped advisory lock so
      // concurrent appends can't both read MAX(sequence) before either
      // INSERTs. Without this, parallel critic dispatches (Triple-AI
      // fan-out: 3 chat-responder nodes each emitting reasoning.delta
      // + node.message + node.completed events concurrently) race on
      // sequence-assignment and one INSERT loses to the unique
      // constraint `events_run_id_sequence_key`, crashing the run
      // with "inline dispatch failed" — observed 2026-05-25 against
      // run 31c2b04c-… (only chat_2 + chat_6 completed; chat_4 never
      // started because the executor crashed in mid-emit).
      //
      // pg_advisory_xact_lock takes two int4 keys; we partition the
      // 64-bit hashtext namespace into (run_id-hash, scope-tag). The
      // scope tag (1 = events.append) lets us add other per-run
      // serialized regions later without aliasing.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), 1)', [input.runId]);
        const { rows } = await client.query<Row>(
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
        await client.query('COMMIT');
        return rowToEvent(rows[0]!);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => { /* connection already broken */ });
        throw err;
      } finally {
        client.release();
      }
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
      // Reachable only when the INSERT hit the (key) UNIQUE conflict,
      // which means a row already exists with that key. The SELECT
      // therefore returns exactly one row.
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

    async upsertTenantSecret(tenantId, credentialRef, encryptedRecordJson, now) {
      await pool.query(
        `INSERT INTO byok_secrets (credential_ref, tenant_id, encrypted_record, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (tenant_id, credential_ref) DO UPDATE SET
           encrypted_record = EXCLUDED.encrypted_record,
           updated_at = EXCLUDED.updated_at`,
        [credentialRef, tenantId, encryptedRecordJson, now],
      );
    },

    async getTenantSecret(tenantId, credentialRef) {
      const { rows } = await pool.query<{ encrypted_record: string }>(
        `SELECT encrypted_record FROM byok_secrets WHERE tenant_id = $1 AND credential_ref = $2`,
        [tenantId, credentialRef],
      );
      return rows[0]?.encrypted_record ?? null;
    },

    async deleteTenantSecret(tenantId, credentialRef) {
      await pool.query(
        `DELETE FROM byok_secrets WHERE tenant_id = $1 AND credential_ref = $2`,
        [tenantId, credentialRef],
      );
    },

    async listTenantSecretRefs(tenantId) {
      const { rows } = await pool.query<{ credential_ref: string }>(
        `SELECT credential_ref FROM byok_secrets WHERE tenant_id = $1 ORDER BY credential_ref ASC`,
        [tenantId],
      );
      return rows.map((r) => r.credential_ref);
    },

    async deleteAllTenantSecrets(tenantId) {
      const res = await pool.query(`DELETE FROM byok_secrets WHERE tenant_id = $1`, [tenantId]);
      return res.rowCount ?? 0;
    },

    async deleteRun(runId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM events WHERE run_id = $1`, [runId]);
        await client.query(`DELETE FROM interrupts WHERE run_id = $1`, [runId]);
        await client.query(`DELETE FROM invocation_log WHERE run_id = $1`, [runId]);
        const rr = await client.query(`DELETE FROM runs WHERE run_id = $1`, [runId]);
        await client.query('COMMIT');
        return (rr.rowCount ?? 0) > 0;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    async deleteAllTenantData(tenantId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const runRows = await client.query<{ run_id: string }>(
          `SELECT run_id FROM runs WHERE tenant_id = $1`,
          [tenantId],
        );
        const runIds = runRows.rows.map((r) => r.run_id);
        let events = 0;
        let interrupts = 0;
        if (runIds.length > 0) {
          const er = await client.query(`DELETE FROM events WHERE run_id = ANY($1::text[])`, [runIds]);
          events = er.rowCount ?? 0;
          const ir = await client.query(`DELETE FROM interrupts WHERE run_id = ANY($1::text[])`, [runIds]);
          interrupts = ir.rowCount ?? 0;
        }
        const rr = await client.query(`DELETE FROM runs WHERE tenant_id = $1`, [tenantId]);
        const wr = await client.query(`DELETE FROM workflows WHERE tenant_id = $1`, [tenantId]);
        const sr = await client.query(`DELETE FROM byok_secrets WHERE tenant_id = $1`, [tenantId]);
        await client.query('COMMIT');
        return {
          runs: rr.rowCount ?? 0,
          events,
          interrupts,
          workflows: wr.rowCount ?? 0,
          secrets: sr.rowCount ?? 0,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async reassignTenant(fromTenant, toTenant) {
      // Wrap both UPDATEs in a single transaction so partial failure
      // doesn't leave the data split across two tenants.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r1 = await client.query(
          `UPDATE runs SET tenant_id = $1 WHERE tenant_id = $2`,
          [toTenant, fromTenant],
        );
        const r2 = await client.query(
          `UPDATE workflows SET tenant_id = $1 WHERE tenant_id = $2`,
          [toTenant, fromTenant],
        );
        await client.query('COMMIT');
        return { runs: r1.rowCount ?? 0, workflows: r2.rowCount ?? 0 };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async incrementManagedUsage(tenantId, providerId, dateUtc, inputTokens, outputTokens) {
      await pool.query(
        `INSERT INTO managed_provider_usage (tenant_id, date, provider_id, input_tokens, output_tokens)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, date, provider_id) DO UPDATE SET
           input_tokens  = managed_provider_usage.input_tokens  + EXCLUDED.input_tokens,
           output_tokens = managed_provider_usage.output_tokens + EXCLUDED.output_tokens`,
        [tenantId, dateUtc, providerId, inputTokens, outputTokens],
      );
    },

    async getManagedUsage(tenantId, providerId, dateUtc) {
      const { rows } = await pool.query<{ input_tokens: number; output_tokens: number }>(
        `SELECT input_tokens, output_tokens FROM managed_provider_usage
           WHERE tenant_id = $1 AND date = $2 AND provider_id = $3`,
        [tenantId, dateUtc, providerId],
      );
      const row = rows[0];
      if (!row) return { inputTokens: 0, outputTokens: 0 };
      // pg returns INTEGER as JS number; BIGINT would come back as string
      // (the daily cap is small enough that INTEGER suffices, but
      // belt-and-suspenders coerce in case a deployer widens the column).
      return {
        inputTokens: typeof row.input_tokens === 'number' ? row.input_tokens : Number(row.input_tokens),
        outputTokens: typeof row.output_tokens === 'number' ? row.output_tokens : Number(row.output_tokens),
      };
    },

    async getEnvelopeCorrelation(runId, correlationId) {
      const { rows } = await pool.query<{ outcome: string; envelope_type: string; recorded_at: Date | string }>(
        `SELECT outcome, envelope_type, recorded_at FROM envelope_correlations
           WHERE run_id = $1 AND correlation_id = $2`,
        [runId, correlationId],
      );
      const row = rows[0];
      if (!row) return null;
      // pg returns TIMESTAMPTZ as Date; the interface uses ISO-string
      // for backend-symmetry with the sqlite adapter.
      const recordedAt = row.recorded_at instanceof Date
        ? row.recorded_at.toISOString()
        : row.recorded_at;
      return {
        outcome: JSON.parse(row.outcome) as unknown,
        envelopeType: row.envelope_type,
        recordedAt,
      };
    },

    async putEnvelopeCorrelation(runId, correlationId, outcome, envelopeType, recordedAt) {
      await pool.query(
        `INSERT INTO envelope_correlations
           (run_id, correlation_id, outcome, envelope_type, recorded_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_id, correlation_id) DO UPDATE SET
           outcome       = EXCLUDED.outcome,
           envelope_type = EXCLUDED.envelope_type,
           recorded_at   = EXCLUDED.recorded_at`,
        [runId, correlationId, JSON.stringify(outcome), envelopeType, recordedAt],
      );
    },

    // ── chat sessions (Phase 2C.1) ────────────────────────────────────
    async listChatSessions(tenantId, limit) {
      const r = await pool.query<{
        session_id: string;
        tenant_id: string;
        title: string;
        created_at: Date;
        updated_at: Date;
        message_count: number;
      }>(
        `SELECT session_id, tenant_id, title, created_at, updated_at, message_count
         FROM chat_sessions
         WHERE tenant_id = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [tenantId, limit ?? 200],
      );
      return r.rows.map((row): ChatSessionRecord => ({
        sessionId: row.session_id,
        tenantId: row.tenant_id,
        title: row.title,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        messageCount: row.message_count,
      }));
    },

    async createChatSession(record) {
      await pool.query(
        `INSERT INTO chat_sessions (session_id, tenant_id, title, created_at, updated_at, message_count)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          record.sessionId,
          record.tenantId,
          record.title,
          record.createdAt,
          record.updatedAt,
          record.messageCount,
        ],
      );
    },

    async getChatSession(tenantId, sessionId) {
      const r = await pool.query<{
        session_id: string;
        tenant_id: string;
        title: string;
        created_at: Date;
        updated_at: Date;
        message_count: number;
      }>(
        `SELECT session_id, tenant_id, title, created_at, updated_at, message_count
         FROM chat_sessions
         WHERE tenant_id = $1 AND session_id = $2`,
        [tenantId, sessionId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        sessionId: row.session_id,
        tenantId: row.tenant_id,
        title: row.title,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        messageCount: row.message_count,
      };
    },

    async updateChatSession(tenantId, sessionId, patch) {
      await pool.query(
        `UPDATE chat_sessions
            SET title         = COALESCE($3, title),
                updated_at    = COALESCE($4, updated_at),
                message_count = COALESCE($5, message_count)
          WHERE tenant_id = $1 AND session_id = $2`,
        [
          tenantId,
          sessionId,
          patch.title ?? null,
          patch.updatedAt ?? null,
          patch.messageCount ?? null,
        ],
      );
    },

    async deleteChatSession(tenantId, sessionId) {
      const r = await pool.query(
        `DELETE FROM chat_sessions WHERE tenant_id = $1 AND session_id = $2`,
        [tenantId, sessionId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async listChatSessionMessages(sessionId) {
      const r = await pool.query<{
        message_id: string;
        session_id: string;
        role: string;
        content: string;
        meta: string | null;
        created_at: Date;
      }>(
        `SELECT message_id, session_id, role, content, meta, created_at
         FROM chat_messages
         WHERE session_id = $1
         ORDER BY created_at ASC, message_id ASC`,
        [sessionId],
      );
      return r.rows.map((row): ChatMessageRecord => ({
        messageId: row.message_id,
        sessionId: row.session_id,
        role: row.role as ChatMessageRecord['role'],
        content: row.content,
        meta: row.meta,
        createdAt: row.created_at.toISOString(),
      }));
    },

    async appendChatMessage(record) {
      // Atomic insert + counter bump in one transaction — see the
      // sqlite mirror in `../sqlite/index.ts` for the rationale. Pool
      // checkout + BEGIN/COMMIT so concurrent appends serialize at the
      // row level instead of racing on read-then-write.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO chat_messages (message_id, session_id, role, content, meta, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            record.messageId,
            record.sessionId,
            record.role,
            record.content,
            record.meta,
            record.createdAt,
          ],
        );
        await client.query(
          `UPDATE chat_sessions
              SET message_count = message_count + 1,
                  updated_at = $1
            WHERE session_id = $2`,
          [record.createdAt, record.sessionId],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => { /* */ });
        throw err;
      } finally {
        client.release();
      }
    },

    async insertNotification(record) {
      await pool.query(
        `INSERT INTO notifications (
          notification_id, tenant_id, type, priority, status,
          title, message, run_id, workflow_id, node_id,
          interrupt_id, action_url, metadata,
          created_at, read_at, archived_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          record.notificationId, record.tenantId, record.type, record.priority, record.status,
          record.title, record.message,
          record.runId ?? null, record.workflowId ?? null, record.nodeId ?? null,
          record.interruptId ?? null, record.actionUrl ?? null, record.metadata ?? null,
          record.createdAt, record.readAt ?? null, record.archivedAt ?? null,
        ],
      );
    },

    async listNotifications({ tenantId, status, includeArchived, ascending, limit = 100 }) {
      const wantStatuses: readonly string[] | null = status
        ? (Array.isArray(status) ? status : [status as string])
        : null;
      // Default: hide archived rows from the inbox view. The Archived
      // tab passes `includeArchived: true` to opt in.
      const params: unknown[] = [tenantId];
      let where = `tenant_id = $1`;
      if (wantStatuses && wantStatuses.length > 0) {
        const placeholders = wantStatuses.map((_, i) => `$${params.length + i + 1}`).join(', ');
        where += ` AND status IN (${placeholders})`;
        for (const s of wantStatuses) params.push(s);
      } else if (!includeArchived) {
        where += ` AND status <> 'archived'`;
      }
      params.push(limit);
      const order = ascending ? 'ASC' : 'DESC';
      const { rows } = await pool.query<Row>(
        `SELECT * FROM notifications WHERE ${where}
          ORDER BY created_at ${order}
          LIMIT $${params.length}`,
        params,
      );
      return rows.map(rowToNotification);
    },

    async getNotification(notificationId) {
      const { rows } = await pool.query<Row>(
        `SELECT * FROM notifications WHERE notification_id = $1`,
        [notificationId],
      );
      return rows[0] ? rowToNotification(rows[0]) : null;
    },

    async updateNotificationStatus(notificationId, status, now) {
      // `read_at` and `archived_at` are set on transition. Re-reading or
      // re-archiving an already-archived row is a no-op for the timestamp
      // (COALESCE keeps the first transition's timestamp).
      const readAt = status === 'read' ? now : null;
      const archivedAt = status === 'archived' ? now : null;
      const { rows } = await pool.query<Row>(
        `UPDATE notifications
            SET status = $1,
                read_at = CASE WHEN $2::timestamptz IS NOT NULL
                                THEN COALESCE(read_at, $2)
                                ELSE read_at END,
                archived_at = CASE WHEN $3::timestamptz IS NOT NULL
                                    THEN COALESCE(archived_at, $3)
                                    ELSE archived_at END
          WHERE notification_id = $4
          RETURNING *`,
        [status, readAt, archivedAt, notificationId],
      );
      return rows[0] ? rowToNotification(rows[0]) : null;
    },

    async markAllNotificationsRead(tenantId, now) {
      const r = await pool.query(
        `UPDATE notifications
            SET status = 'read',
                read_at = COALESCE(read_at, $2)
          WHERE tenant_id = $1
            AND status = 'unread'`,
        [tenantId, now],
      );
      return r.rowCount ?? 0;
    },

    async deleteNotification(notificationId) {
      const r = await pool.query(
        `DELETE FROM notifications WHERE notification_id = $1`,
        [notificationId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async deleteAllTenantNotifications(tenantId) {
      const r = await pool.query(
        `DELETE FROM notifications WHERE tenant_id = $1`,
        [tenantId],
      );
      return r.rowCount ?? 0;
    },

    async close() {
      await pool.end();
    },
  };
  return impl;
}

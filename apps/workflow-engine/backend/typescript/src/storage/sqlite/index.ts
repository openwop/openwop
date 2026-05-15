/**
 * sqlite-backed Storage implementation. Default for the sample.
 *
 * Uses better-sqlite3 (synchronous API). The synchronous boundary is
 * fine here because the executor is single-process and the sample
 * doesn't claim multi-instance — production deployers swap for
 * Postgres / Firestore behind the same `Storage` interface.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EventRecord,
  IdempotencyRecord,
  InterruptRecord,
  RunRecord,
  WebhookSubscriptionRecord,
} from '../../types.js';
import type { Storage } from '../storage.js';
import { applyMigrations } from './schema.js';

export function openSqliteStorage(dbPath: string): Storage {
  const resolvedPath = dbPath === ':memory:' ? ':memory:' : resolve(dbPath);
  if (resolvedPath !== ':memory:') {
    const dir = dirname(resolvedPath);
    if (isAbsolute(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);

  // ── statements (prepared once for reuse) ──

  const insertRunStmt = db.prepare(`
    INSERT INTO runs (
      run_id, workflow_id, tenant_id, scope_id, status,
      inputs, metadata, configurable, callback_url,
      idempotency_key, parent_run_id, parent_seq, fork_mode,
      created_at, updated_at, completed_at, error_code, error_message, current_node_id
    ) VALUES (
      @runId, @workflowId, @tenantId, @scopeId, @status,
      @inputs, @metadata, @configurable, @callbackUrl,
      @idempotencyKey, @parentRunId, @parentSeq, @forkMode,
      @createdAt, @updatedAt, @completedAt, @errorCode, @errorMessage, @currentNodeId
    )
  `);

  const getRunStmt = db.prepare(`SELECT * FROM runs WHERE run_id = ?`);

  const listRunsStmt = db.prepare(`
    SELECT * FROM runs
    WHERE (@tenantId IS NULL OR tenant_id = @tenantId)
      AND (@status IS NULL OR status = @status)
    ORDER BY created_at DESC
    LIMIT @limit
  `);

  const appendEventStmt = db.prepare(`
    INSERT INTO events (event_id, run_id, sequence, type, node_id, payload, timestamp, causation_id)
    VALUES (@eventId, @runId, @sequence, @type, @nodeId, @payload, @timestamp, @causationId)
  `);

  const getMaxSeqStmt = db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS max FROM events WHERE run_id = ?`);

  const listEventsStmt = db.prepare(`
    SELECT * FROM events
    WHERE run_id = @runId AND sequence > @fromSeq
    ORDER BY sequence ASC
    LIMIT @limit
  `);

  const insertInterruptStmt = db.prepare(`
    INSERT INTO interrupts (
      interrupt_id, run_id, node_id, kind, token, data, resume_schema, created_at
    ) VALUES (
      @interruptId, @runId, @nodeId, @kind, @token, @data, @resumeSchema, @createdAt
    )
  `);

  const getInterruptStmt = db.prepare(`SELECT * FROM interrupts WHERE interrupt_id = ?`);
  const getInterruptByTokenStmt = db.prepare(`SELECT * FROM interrupts WHERE token = ?`);
  const getInterruptByNodeStmt = db.prepare(`
    SELECT * FROM interrupts
    WHERE run_id = ? AND node_id = ? AND resolved_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `);
  const resolveInterruptStmt = db.prepare(`
    UPDATE interrupts SET resolved_at = ?, resolved_value = ? WHERE interrupt_id = ?
  `);
  const listOpenInterruptsStmt = db.prepare(`
    SELECT * FROM interrupts WHERE run_id = ? AND resolved_at IS NULL
  `);

  const insertWebhookStmt = db.prepare(`
    INSERT INTO webhooks (subscription_id, url, events, tags, secret, created_at)
    VALUES (@subscriptionId, @url, @events, @tags, @secret, @createdAt)
  `);
  const getWebhookStmt = db.prepare(`SELECT * FROM webhooks WHERE subscription_id = ?`);
  const deleteWebhookStmt = db.prepare(`DELETE FROM webhooks WHERE subscription_id = ?`);
  const listWebhooksStmt = db.prepare(`SELECT * FROM webhooks`);

  const getIdempotencyStmt = db.prepare(`SELECT * FROM idempotency WHERE key = ?`);
  const upsertIdempotencyStmt = db.prepare(`
    INSERT OR REPLACE INTO idempotency (key, response_body, response_status, created_at)
    VALUES (@key, @responseBody, @responseStatus, @createdAt)
  `);

  const insertAuditStmt = db.prepare(`
    INSERT INTO audit_log (audit_id, timestamp, principal_id, action, resource, outcome, payload)
    VALUES (@auditId, @timestamp, @principalId, @action, @resource, @outcome, @payload)
  `);

  const getInvocationStmt = db.prepare(`
    SELECT result FROM invocation_log
    WHERE run_id = ? AND node_id = ? AND attempt = ? AND provider_key = ?
  `);
  const putInvocationStmt = db.prepare(`
    INSERT OR REPLACE INTO invocation_log (run_id, node_id, attempt, provider_key, result, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Atomic claim: lookup, and if absent insert a `__pending__` placeholder
  // so concurrent same-key requests serialize on the sqlite write lock.
  const PENDING_BODY = '__pending__';
  const claimIdempotencyTxn = db.transaction(
    (key: string, createdAt: string): { claimed: boolean; existing: IdempotencyRecord | null } => {
      const existing = getIdempotencyStmt.get(key) as
        | { key: string; response_body: string; response_status: number; created_at: string }
        | undefined;
      if (existing) {
        return {
          claimed: false,
          existing: {
            key: existing.key,
            responseBody: existing.response_body,
            responseStatus: existing.response_status,
            createdAt: existing.created_at,
          },
        };
      }
      upsertIdempotencyStmt.run({
        key,
        responseBody: PENDING_BODY,
        responseStatus: 0,
        createdAt,
      });
      return { claimed: true, existing: null };
    },
  );

  // Atomic append: read max sequence + insert in a single txn.
  const appendEventTxn = db.transaction((input: Omit<EventRecord, 'sequence'>): EventRecord => {
    const row = getMaxSeqStmt.get(input.runId) as { max: number };
    const sequence = row.max + 1;
    appendEventStmt.run({
      ...input,
      sequence,
      payload: JSON.stringify(input.payload ?? null),
      nodeId: input.nodeId ?? null,
      causationId: input.causationId ?? null,
    });
    return { ...input, sequence };
  });

  function rowToRun(row: any): RunRecord {
    return {
      runId: row.run_id,
      workflowId: row.workflow_id,
      tenantId: row.tenant_id,
      scopeId: row.scope_id ?? undefined,
      status: row.status,
      inputs: row.inputs ? JSON.parse(row.inputs) : null,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      configurable: row.configurable ? JSON.parse(row.configurable) : {},
      callbackUrl: row.callback_url ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      parentRunId: row.parent_run_id ?? undefined,
      parentSeq: row.parent_seq ?? undefined,
      forkMode: row.fork_mode ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
      currentNodeId: row.current_node_id ?? undefined,
      ...(row.error_code
        ? { error: { code: row.error_code, message: row.error_message ?? '' } }
        : {}),
    };
  }

  function rowToEvent(row: any): EventRecord {
    return {
      eventId: row.event_id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      nodeId: row.node_id ?? undefined,
      payload: row.payload ? JSON.parse(row.payload) : null,
      timestamp: row.timestamp,
      causationId: row.causation_id ?? undefined,
    };
  }

  function rowToInterrupt(row: any): InterruptRecord {
    return {
      interruptId: row.interrupt_id,
      runId: row.run_id,
      nodeId: row.node_id,
      kind: row.kind,
      token: row.token,
      data: row.data ? JSON.parse(row.data) : null,
      resumeSchema: row.resume_schema ? JSON.parse(row.resume_schema) : undefined,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
      resolvedValue: row.resolved_value ? JSON.parse(row.resolved_value) : undefined,
    };
  }

  function rowToWebhook(row: any): WebhookSubscriptionRecord {
    return {
      subscriptionId: row.subscription_id,
      url: row.url,
      events: row.events ? JSON.parse(row.events) : [],
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      secret: row.secret,
      createdAt: row.created_at,
    };
  }

  return {
    insertRun(run) {
      insertRunStmt.run({
        runId: run.runId,
        workflowId: run.workflowId,
        tenantId: run.tenantId,
        scopeId: run.scopeId ?? null,
        status: run.status,
        inputs: JSON.stringify(run.inputs ?? null),
        metadata: JSON.stringify(run.metadata ?? {}),
        configurable: JSON.stringify(run.configurable ?? {}),
        callbackUrl: run.callbackUrl ?? null,
        idempotencyKey: run.idempotencyKey ?? null,
        parentRunId: run.parentRunId ?? null,
        parentSeq: run.parentSeq ?? null,
        forkMode: run.forkMode ?? null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt ?? null,
        errorCode: run.error?.code ?? null,
        errorMessage: run.error?.message ?? null,
        currentNodeId: run.currentNodeId ?? null,
      });
    },

    getRun(runId) {
      const row = getRunStmt.get(runId);
      return row ? rowToRun(row) : null;
    },

    updateRun(runId, patch) {
      const existing = this.getRun(runId);
      if (!existing) return;
      const merged: RunRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      const updateStmt = db.prepare(`
        UPDATE runs SET
          status = @status,
          inputs = @inputs,
          metadata = @metadata,
          configurable = @configurable,
          callback_url = @callbackUrl,
          updated_at = @updatedAt,
          completed_at = @completedAt,
          error_code = @errorCode,
          error_message = @errorMessage,
          current_node_id = @currentNodeId
        WHERE run_id = @runId
      `);
      updateStmt.run({
        runId,
        status: merged.status,
        inputs: JSON.stringify(merged.inputs ?? null),
        metadata: JSON.stringify(merged.metadata ?? {}),
        configurable: JSON.stringify(merged.configurable ?? {}),
        callbackUrl: merged.callbackUrl ?? null,
        updatedAt: merged.updatedAt,
        completedAt: merged.completedAt ?? null,
        errorCode: merged.error?.code ?? null,
        errorMessage: merged.error?.message ?? null,
        currentNodeId: merged.currentNodeId ?? null,
      });
    },

    listRuns({ tenantId, status, limit = 100 }) {
      const rows = listRunsStmt.all({
        tenantId: tenantId ?? null,
        status: status ?? null,
        limit,
      });
      return rows.map(rowToRun);
    },

    appendEvent(input) {
      const eventId = input.eventId || randomUUID();
      const result = appendEventTxn({ ...input, eventId });
      return result;
    },

    listEvents(runId, { fromSeq = 0, limit = 1000 } = {}) {
      const rows = listEventsStmt.all({ runId, fromSeq, limit });
      return rows.map(rowToEvent);
    },

    getMaxSequence(runId) {
      const row = getMaxSeqStmt.get(runId) as { max: number };
      return row.max;
    },

    insertInterrupt(record) {
      insertInterruptStmt.run({
        ...record,
        data: JSON.stringify(record.data ?? null),
        resumeSchema: record.resumeSchema ? JSON.stringify(record.resumeSchema) : null,
      });
    },

    getInterrupt(interruptId) {
      const row = getInterruptStmt.get(interruptId);
      return row ? rowToInterrupt(row) : null;
    },

    getInterruptByToken(token) {
      const row = getInterruptByTokenStmt.get(token);
      return row ? rowToInterrupt(row) : null;
    },

    getInterruptByNode(runId, nodeId) {
      const row = getInterruptByNodeStmt.get(runId, nodeId);
      return row ? rowToInterrupt(row) : null;
    },

    resolveInterrupt(interruptId, resolvedValue, resolvedAt) {
      resolveInterruptStmt.run(resolvedAt, JSON.stringify(resolvedValue ?? null), interruptId);
    },

    listOpenInterrupts(runId) {
      const rows = listOpenInterruptsStmt.all(runId);
      return rows.map(rowToInterrupt);
    },

    insertWebhook(record) {
      insertWebhookStmt.run({
        subscriptionId: record.subscriptionId,
        url: record.url,
        events: JSON.stringify(record.events),
        tags: record.tags ? JSON.stringify(record.tags) : null,
        secret: record.secret,
        createdAt: record.createdAt,
      });
    },

    getWebhook(subscriptionId) {
      const row = getWebhookStmt.get(subscriptionId);
      return row ? rowToWebhook(row) : null;
    },

    deleteWebhook(subscriptionId) {
      deleteWebhookStmt.run(subscriptionId);
    },

    listWebhooks({ eventType, tags }) {
      const rows = listWebhooksStmt.all().map(rowToWebhook);
      return rows.filter((sub) => {
        if (eventType && !sub.events.includes(eventType) && !sub.events.includes('*')) {
          return false;
        }
        const subTags = sub.tags;
        if (tags && tags.length > 0 && subTags && subTags.length > 0) {
          const hasTag = tags.some((t) => subTags.includes(t));
          if (!hasTag) return false;
        }
        return true;
      });
    },

    lookupIdempotency(key) {
      const existing = getIdempotencyStmt.get(key) as
        | { key: string; response_body: string; response_status: number; created_at: string }
        | undefined;
      if (!existing) return null;
      return {
        key: existing.key,
        responseBody: existing.response_body,
        responseStatus: existing.response_status,
        createdAt: existing.created_at,
      };
    },
    claimIdempotency(key, createdAt) {
      // Single sqlite txn: SELECT then INSERT under exclusive write lock.
      // better-sqlite3 serializes write txns process-wide, so two concurrent
      // claims for the same key see consistent state.
      return claimIdempotencyTxn(key, createdAt);
    },
    putIdempotency(record) {
      upsertIdempotencyStmt.run({
        key: record.key,
        responseBody: record.responseBody,
        responseStatus: record.responseStatus,
        createdAt: record.createdAt,
      });
    },

    appendAudit(input) {
      insertAuditStmt.run({
        auditId: randomUUID(),
        timestamp: input.timestamp,
        principalId: input.principalId ?? null,
        action: input.action,
        resource: input.resource ?? null,
        outcome: input.outcome ?? null,
        payload: input.payload != null ? JSON.stringify(input.payload) : null,
      });
    },

    getInvocation({ runId, nodeId, attempt, providerKey }) {
      const row = getInvocationStmt.get(runId, nodeId, attempt, providerKey) as
        | { result: string }
        | undefined;
      return row?.result ? JSON.parse(row.result) : null;
    },

    putInvocation({ runId, nodeId, attempt, providerKey }, result) {
      putInvocationStmt.run(
        runId,
        nodeId,
        attempt,
        providerKey,
        JSON.stringify(result ?? null),
        new Date().toISOString(),
      );
    },

    close() {
      db.close();
    },
  };
}

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
  ChatMessageRecord,
  ChatSessionRecord,
  EventRecord,
  IdempotencyRecord,
  InterruptRecord,
  NotificationRecord,
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

  const upsertSecretStmt = db.prepare(`
    INSERT INTO byok_secrets (credential_ref, encrypted_record, created_at, updated_at)
    VALUES (@ref, @rec, @now, @now)
    ON CONFLICT(credential_ref) DO UPDATE SET
      encrypted_record = excluded.encrypted_record,
      updated_at       = excluded.updated_at
  `);
  const getSecretStmt = db.prepare(`SELECT encrypted_record FROM byok_secrets WHERE credential_ref = ?`);
  const deleteSecretStmt = db.prepare(`DELETE FROM byok_secrets WHERE credential_ref = ?`);
  const listSecretRefsStmt = db.prepare(`SELECT credential_ref FROM byok_secrets ORDER BY credential_ref ASC`);

  const upsertTenantSecretStmt = db.prepare(`
    INSERT INTO byok_tenant_secrets (tenant_id, credential_ref, encrypted_record, created_at, updated_at)
    VALUES (@tenant, @ref, @rec, @now, @now)
    ON CONFLICT(tenant_id, credential_ref) DO UPDATE SET
      encrypted_record = excluded.encrypted_record,
      updated_at       = excluded.updated_at
  `);
  const getTenantSecretStmt = db.prepare(
    `SELECT encrypted_record FROM byok_tenant_secrets WHERE tenant_id = ? AND credential_ref = ?`,
  );
  const deleteTenantSecretStmt = db.prepare(
    `DELETE FROM byok_tenant_secrets WHERE tenant_id = ? AND credential_ref = ?`,
  );
  const listTenantSecretRefsStmt = db.prepare(
    `SELECT credential_ref FROM byok_tenant_secrets WHERE tenant_id = ? ORDER BY credential_ref ASC`,
  );
  const deleteAllTenantSecretsStmt = db.prepare(
    `DELETE FROM byok_tenant_secrets WHERE tenant_id = ?`,
  );

  const incrManagedUsageStmt = db.prepare(`
    INSERT INTO managed_provider_usage (tenant_id, date, provider_id, input_tokens, output_tokens)
    VALUES (@tenant, @date, @provider, @inTok, @outTok)
    ON CONFLICT(tenant_id, date, provider_id) DO UPDATE SET
      input_tokens  = input_tokens  + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens
  `);
  const getManagedUsageStmt = db.prepare(
    `SELECT input_tokens, output_tokens FROM managed_provider_usage
       WHERE tenant_id = ? AND date = ? AND provider_id = ?`,
  );

  const getEnvelopeCorrelationStmt = db.prepare(
    `SELECT outcome, envelope_type, recorded_at FROM envelope_correlations
       WHERE run_id = ? AND correlation_id = ?`,
  );
  const putEnvelopeCorrelationStmt = db.prepare(`
    INSERT OR REPLACE INTO envelope_correlations
      (run_id, correlation_id, outcome, envelope_type, recorded_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // ── chat sessions (Phase 2C.1) ─────────────────────────────────────
  const listChatSessionsStmt = db.prepare(`
    SELECT session_id, tenant_id, title, created_at, updated_at, message_count
    FROM chat_sessions
    WHERE tenant_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const createChatSessionStmt = db.prepare(`
    INSERT INTO chat_sessions (session_id, tenant_id, title, created_at, updated_at, message_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const getChatSessionStmt = db.prepare(`
    SELECT session_id, tenant_id, title, created_at, updated_at, message_count
    FROM chat_sessions
    WHERE tenant_id = ? AND session_id = ?
  `);
  // Patch-update: COALESCE keeps unchanged columns at their existing value
  // so callers don't have to read-then-write to update just one field.
  const updateChatSessionStmt = db.prepare(`
    UPDATE chat_sessions
       SET title = COALESCE(?, title),
           updated_at = COALESCE(?, updated_at),
           message_count = COALESCE(?, message_count)
     WHERE tenant_id = ? AND session_id = ?
  `);
  const deleteChatSessionStmt = db.prepare(`
    DELETE FROM chat_sessions WHERE tenant_id = ? AND session_id = ?
  `);
  const listChatMessagesStmt = db.prepare(`
    SELECT message_id, session_id, role, content, meta, created_at
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY created_at ASC, message_id ASC
  `);
  const appendChatMessageStmt = db.prepare(`
    INSERT INTO chat_messages (message_id, session_id, role, content, meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  // Atomic counter bump — paired with appendChatMessageStmt in a single
  // transaction so concurrent appends don't lose increments. The route
  // previously did read-then-write on `session.messageCount`, which
  // collapsed parallel appends.
  const bumpChatSessionStmt = db.prepare(`
    UPDATE chat_sessions
       SET message_count = message_count + 1,
           updated_at = ?
     WHERE session_id = ?
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
    async insertRun(run) {
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

    async getRun(runId) {
      const row = getRunStmt.get(runId);
      return row ? rowToRun(row) : null;
    },

    async updateRun(runId, patch) {
      const existing = await this.getRun(runId);
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

    async listRuns({ tenantId, status, limit = 100 }) {
      const rows = listRunsStmt.all({
        tenantId: tenantId ?? null,
        status: status ?? null,
        limit,
      });
      return rows.map(rowToRun);
    },

    async appendEvent(input) {
      const eventId = input.eventId || randomUUID();
      const result = appendEventTxn({ ...input, eventId });
      return result;
    },

    async listEvents(runId, { fromSeq = 0, limit = 1000 } = {}) {
      const rows = listEventsStmt.all({ runId, fromSeq, limit });
      return rows.map(rowToEvent);
    },

    async getMaxSequence(runId) {
      const row = getMaxSeqStmt.get(runId) as { max: number };
      return row.max;
    },

    async insertInterrupt(record) {
      insertInterruptStmt.run({
        ...record,
        data: JSON.stringify(record.data ?? null),
        resumeSchema: record.resumeSchema ? JSON.stringify(record.resumeSchema) : null,
      });
    },

    async getInterrupt(interruptId) {
      const row = getInterruptStmt.get(interruptId);
      return row ? rowToInterrupt(row) : null;
    },

    async getInterruptByToken(token) {
      const row = getInterruptByTokenStmt.get(token);
      return row ? rowToInterrupt(row) : null;
    },

    async getInterruptByNode(runId, nodeId) {
      const row = getInterruptByNodeStmt.get(runId, nodeId);
      return row ? rowToInterrupt(row) : null;
    },

    async resolveInterrupt(interruptId, resolvedValue, resolvedAt) {
      resolveInterruptStmt.run(resolvedAt, JSON.stringify(resolvedValue ?? null), interruptId);
    },

    async listOpenInterrupts(runId) {
      const rows = listOpenInterruptsStmt.all(runId);
      return rows.map(rowToInterrupt);
    },

    async insertWebhook(record) {
      insertWebhookStmt.run({
        subscriptionId: record.subscriptionId,
        url: record.url,
        events: JSON.stringify(record.events),
        tags: record.tags ? JSON.stringify(record.tags) : null,
        secret: record.secret,
        createdAt: record.createdAt,
      });
    },

    async getWebhook(subscriptionId) {
      const row = getWebhookStmt.get(subscriptionId);
      return row ? rowToWebhook(row) : null;
    },

    async deleteWebhook(subscriptionId) {
      deleteWebhookStmt.run(subscriptionId);
    },

    async listWebhooks({ eventType, tags }) {
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

    async claimIdempotency(key, createdAt) {
      // Single sqlite txn: SELECT then INSERT under exclusive write lock.
      // better-sqlite3 serializes write txns process-wide, so two concurrent
      // claims for the same key see consistent state.
      return claimIdempotencyTxn(key, createdAt);
    },
    async putIdempotency(record) {
      upsertIdempotencyStmt.run({
        key: record.key,
        responseBody: record.responseBody,
        responseStatus: record.responseStatus,
        createdAt: record.createdAt,
      });
    },

    async appendAudit(input) {
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

    async getInvocation({ runId, nodeId, attempt, providerKey }) {
      const row = getInvocationStmt.get(runId, nodeId, attempt, providerKey) as
        | { result: string }
        | undefined;
      return row?.result ? JSON.parse(row.result) : null;
    },

    async putInvocation({ runId, nodeId, attempt, providerKey }, result) {
      putInvocationStmt.run(
        runId,
        nodeId,
        attempt,
        providerKey,
        JSON.stringify(result ?? null),
        new Date().toISOString(),
      );
    },

    async upsertEncryptedSecret(credentialRef, encryptedRecordJson, now) {
      upsertSecretStmt.run({ ref: credentialRef, rec: encryptedRecordJson, now });
    },

    async getEncryptedSecret(credentialRef) {
      const row = getSecretStmt.get(credentialRef) as { encrypted_record: string } | undefined;
      return row?.encrypted_record ?? null;
    },

    async deleteSecret(credentialRef) {
      deleteSecretStmt.run(credentialRef);
    },

    async listSecretRefs() {
      const rows = listSecretRefsStmt.all() as Array<{ credential_ref: string }>;
      return rows.map((r) => r.credential_ref);
    },

    async upsertTenantSecret(tenantId, credentialRef, encryptedRecordJson, now) {
      upsertTenantSecretStmt.run({
        tenant: tenantId, ref: credentialRef, rec: encryptedRecordJson, now,
      });
    },

    async getTenantSecret(tenantId, credentialRef) {
      const row = getTenantSecretStmt.get(tenantId, credentialRef) as
        | { encrypted_record: string }
        | undefined;
      return row?.encrypted_record ?? null;
    },

    async deleteTenantSecret(tenantId, credentialRef) {
      deleteTenantSecretStmt.run(tenantId, credentialRef);
    },

    async listTenantSecretRefs(tenantId) {
      const rows = listTenantSecretRefsStmt.all(tenantId) as Array<{ credential_ref: string }>;
      return rows.map((r) => r.credential_ref);
    },

    async deleteAllTenantSecrets(tenantId) {
      const res = deleteAllTenantSecretsStmt.run(tenantId);
      return Number(res.changes ?? 0);
    },

    async deleteRun(runId) {
      // Single-run cascade — mirrors deleteAllTenantData's explicit delete
      // order (no FK constraints in this schema). Atomic via transaction.
      const txn = db.transaction((rid: string) => {
        db.prepare(`DELETE FROM events WHERE run_id = ?`).run(rid);
        db.prepare(`DELETE FROM interrupts WHERE run_id = ?`).run(rid);
        db.prepare(`DELETE FROM invocation_log WHERE run_id = ?`).run(rid);
        db.prepare(`DELETE FROM annotations WHERE run_id = ?`).run(rid);
        const rr = db.prepare(`DELETE FROM runs WHERE run_id = ?`).run(rid);
        return Number(rr.changes ?? 0) > 0;
      });
      return txn(runId);
    },

    async insertAnnotation(record) {
      db.prepare(
        `INSERT INTO annotations (annotation_id, run_id, tenant_id, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(record.annotationId, record.runId, record.tenantId, JSON.stringify(record.payload), record.createdAt);
    },

    async listAnnotations(runId) {
      const rows = db
        .prepare(`SELECT annotation_id, run_id, tenant_id, payload, created_at FROM annotations WHERE run_id = ? ORDER BY created_at ASC`)
        .all(runId) as Array<{ annotation_id: string; run_id: string; tenant_id: string; payload: string; created_at: string }>;
      return rows.map((r) => ({
        annotationId: r.annotation_id,
        runId: r.run_id,
        tenantId: r.tenant_id,
        payload: JSON.parse(r.payload) as unknown,
        createdAt: r.created_at,
      }));
    },

    async deleteAllTenantData(tenantId) {
      const deleteTxn = db.transaction((tid: string) => {
        // 1. Find every run owned by the tenant — we need their ids to
        //    cascade events + interrupts. No FK constraints in this
        //    schema, so the cascade is explicit.
        const runRows = db.prepare(`SELECT run_id FROM runs WHERE tenant_id = ?`).all(tid) as Array<{ run_id: string }>;
        const runIds = runRows.map((r) => r.run_id);
        let events = 0;
        let interrupts = 0;
        for (const rid of runIds) {
          const er = db.prepare(`DELETE FROM events WHERE run_id = ?`).run(rid);
          events += Number(er.changes ?? 0);
          const ir = db.prepare(`DELETE FROM interrupts WHERE run_id = ?`).run(rid);
          interrupts += Number(ir.changes ?? 0);
        }
        const rr = db.prepare(`DELETE FROM runs WHERE tenant_id = ?`).run(tid);
        const wr = db.prepare(`DELETE FROM workflows WHERE tenant_id = ?`).run(tid);
        const sr = db.prepare(`DELETE FROM byok_tenant_secrets WHERE tenant_id = ?`).run(tid);
        return {
          runs: Number(rr.changes ?? 0),
          events,
          interrupts,
          workflows: Number(wr.changes ?? 0),
          secrets: Number(sr.changes ?? 0),
        };
      });
      return deleteTxn(tenantId);
    },

    async reassignTenant(fromTenant, toTenant) {
      const reassignTxn = db.transaction((from: string, to: string) => {
        const r1 = db.prepare(`UPDATE runs SET tenant_id = ? WHERE tenant_id = ?`).run(to, from);
        const r2 = db.prepare(`UPDATE workflows SET tenant_id = ? WHERE tenant_id = ?`).run(to, from);
        return { runs: Number(r1.changes ?? 0), workflows: Number(r2.changes ?? 0) };
      });
      return reassignTxn(fromTenant, toTenant);
    },

    async incrementManagedUsage(tenantId, providerId, dateUtc, inputTokens, outputTokens) {
      incrManagedUsageStmt.run({
        tenant: tenantId,
        date: dateUtc,
        provider: providerId,
        inTok: inputTokens,
        outTok: outputTokens,
      });
    },

    async getManagedUsage(tenantId, providerId, dateUtc) {
      const row = getManagedUsageStmt.get(tenantId, dateUtc, providerId) as
        | { input_tokens: number; output_tokens: number }
        | undefined;
      if (!row) return { inputTokens: 0, outputTokens: 0 };
      return { inputTokens: row.input_tokens, outputTokens: row.output_tokens };
    },

    async getEnvelopeCorrelation(runId, correlationId) {
      const row = getEnvelopeCorrelationStmt.get(runId, correlationId) as
        | { outcome: string; envelope_type: string; recorded_at: string }
        | undefined;
      if (!row) return null;
      return {
        outcome: JSON.parse(row.outcome) as unknown,
        envelopeType: row.envelope_type,
        recordedAt: row.recorded_at,
      };
    },

    async putEnvelopeCorrelation(runId, correlationId, outcome, envelopeType, recordedAt) {
      putEnvelopeCorrelationStmt.run(
        runId,
        correlationId,
        JSON.stringify(outcome),
        envelopeType,
        recordedAt,
      );
    },

    // ── chat sessions (Phase 2C.1) ────────────────────────────────────
    async listChatSessions(tenantId, limit) {
      const rows = listChatSessionsStmt.all(tenantId, limit ?? 200) as Array<{
        session_id: string;
        tenant_id: string;
        title: string;
        created_at: string;
        updated_at: string;
        message_count: number;
      }>;
      return rows.map((r): ChatSessionRecord => ({
        sessionId: r.session_id,
        tenantId: r.tenant_id,
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: r.message_count,
      }));
    },

    async createChatSession(record) {
      createChatSessionStmt.run(
        record.sessionId,
        record.tenantId,
        record.title,
        record.createdAt,
        record.updatedAt,
        record.messageCount,
      );
    },

    async getChatSession(tenantId, sessionId) {
      const row = getChatSessionStmt.get(tenantId, sessionId) as
        | {
            session_id: string;
            tenant_id: string;
            title: string;
            created_at: string;
            updated_at: string;
            message_count: number;
          }
        | undefined;
      if (!row) return null;
      return {
        sessionId: row.session_id,
        tenantId: row.tenant_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: row.message_count,
      };
    },

    async updateChatSession(tenantId, sessionId, patch) {
      updateChatSessionStmt.run(
        patch.title ?? null,
        patch.updatedAt ?? null,
        patch.messageCount ?? null,
        tenantId,
        sessionId,
      );
    },

    async deleteChatSession(tenantId, sessionId) {
      const info = deleteChatSessionStmt.run(tenantId, sessionId);
      return info.changes > 0;
    },

    async listChatSessionMessages(sessionId) {
      const rows = listChatMessagesStmt.all(sessionId) as Array<{
        message_id: string;
        session_id: string;
        role: string;
        content: string;
        meta: string | null;
        created_at: string;
      }>;
      return rows.map((r): ChatMessageRecord => ({
        messageId: r.message_id,
        sessionId: r.session_id,
        role: r.role as ChatMessageRecord['role'],
        content: r.content,
        meta: r.meta,
        createdAt: r.created_at,
      }));
    },

    async appendChatMessage(record) {
      // Atomic: insert the message AND bump the parent session's
      // message_count + updated_at in one transaction. The previous
      // pattern (route reads session.messageCount, route increments,
      // route writes back) lost increments under concurrent appends.
      // better-sqlite3 transactions are synchronous — wrap into the
      // async signature with a thin Promise resolve.
      db.transaction(() => {
        appendChatMessageStmt.run(
          record.messageId,
          record.sessionId,
          record.role,
          record.content,
          record.meta,
          record.createdAt,
        );
        bumpChatSessionStmt.run(record.createdAt, record.sessionId);
      })();
    },

    async insertNotification(record) {
      db.prepare(
        `INSERT INTO notifications (
          notification_id, tenant_id, type, priority, status,
          title, message, run_id, workflow_id, node_id,
          interrupt_id, action_url, metadata,
          created_at, read_at, archived_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        record.notificationId, record.tenantId, record.type, record.priority, record.status,
        record.title, record.message,
        record.runId ?? null, record.workflowId ?? null, record.nodeId ?? null,
        record.interruptId ?? null, record.actionUrl ?? null,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.createdAt, record.readAt ?? null, record.archivedAt ?? null,
      );
    },

    async listNotifications({ tenantId, status, includeArchived, ascending, limit = 100 }) {
      const wantStatuses: readonly string[] | null = status
        ? (Array.isArray(status) ? status : [status as string])
        : null;
      const conditions: string[] = ['tenant_id = ?'];
      const params: unknown[] = [tenantId];
      if (wantStatuses && wantStatuses.length > 0) {
        conditions.push(`status IN (${wantStatuses.map(() => '?').join(', ')})`);
        for (const s of wantStatuses) params.push(s);
      } else if (!includeArchived) {
        conditions.push(`status <> 'archived'`);
      }
      params.push(limit);
      const order = ascending ? 'ASC' : 'DESC';
      const rows = db.prepare(
        `SELECT * FROM notifications WHERE ${conditions.join(' AND ')}
          ORDER BY created_at ${order} LIMIT ?`,
      ).all(...params) as Array<Record<string, unknown>>;
      return rows.map(rowToNotificationSqlite);
    },

    async getNotification(notificationId) {
      const row = db.prepare(
        `SELECT * FROM notifications WHERE notification_id = ?`,
      ).get(notificationId) as Record<string, unknown> | undefined;
      return row ? rowToNotificationSqlite(row) : null;
    },

    async updateNotificationStatus(notificationId, status, now) {
      // Mirror the Postgres semantics: read_at / archived_at are set
      // once at first transition and preserved afterward (COALESCE).
      const readAt = status === 'read' ? now : null;
      const archivedAt = status === 'archived' ? now : null;
      db.prepare(
        `UPDATE notifications
            SET status = ?,
                read_at = CASE WHEN ? IS NOT NULL THEN COALESCE(read_at, ?) ELSE read_at END,
                archived_at = CASE WHEN ? IS NOT NULL THEN COALESCE(archived_at, ?) ELSE archived_at END
          WHERE notification_id = ?`,
      ).run(status, readAt, readAt, archivedAt, archivedAt, notificationId);
      const row = db.prepare(
        `SELECT * FROM notifications WHERE notification_id = ?`,
      ).get(notificationId) as Record<string, unknown> | undefined;
      return row ? rowToNotificationSqlite(row) : null;
    },

    async markAllNotificationsRead(tenantId, now) {
      const r = db.prepare(
        `UPDATE notifications
            SET status = 'read',
                read_at = COALESCE(read_at, ?)
          WHERE tenant_id = ?
            AND status = 'unread'`,
      ).run(now, tenantId);
      return r.changes;
    },

    async deleteNotification(notificationId) {
      const r = db.prepare(
        `DELETE FROM notifications WHERE notification_id = ?`,
      ).run(notificationId);
      return r.changes > 0;
    },

    async deleteAllTenantNotifications(tenantId) {
      const r = db.prepare(
        `DELETE FROM notifications WHERE tenant_id = ?`,
      ).run(tenantId);
      return r.changes;
    },

    async close() {
      db.close();
    },
  };
}

function rowToNotificationSqlite(r: Record<string, unknown>): NotificationRecord {
  // sqlite stores metadata as a JSON string; parse opportunistically and
  // fall back to undefined on malformed data rather than crashing the list.
  let metadata: Record<string, unknown> | undefined;
  if (typeof r.metadata === 'string' && r.metadata.length > 0) {
    try { metadata = JSON.parse(r.metadata); } catch { metadata = undefined; }
  }
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
    metadata,
    createdAt: r.created_at as string,
    readAt: (r.read_at as string | null) ?? undefined,
    archivedAt: (r.archived_at as string | null) ?? undefined,
  };
}

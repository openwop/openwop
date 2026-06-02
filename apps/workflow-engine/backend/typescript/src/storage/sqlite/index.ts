/**
 * sqlite-backed Storage implementation. Default for the sample.
 *
 * Uses better-sqlite3 (synchronous API). The synchronous boundary is
 * fine here because the executor is single-process and the sample
 * doesn't claim multi-instance — production deployers swap for
 * Postgres / Firestore behind the same `Storage` interface.
 */

import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
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
  PushSubscriptionRecord,
  RunRecord,
  UserAgentRecord,
  WebhookDeliveryRecord,
  WebhookSubscriptionRecord,
} from '../../types.js';
import type {
  ChatEgressEnvelope,
  DeliveryLogRecord,
  MessagingConnectorRecord,
  MessagingIdentityRecord,
  MessagingPolicyRecord,
  MessagingAllowlistEntry,
  MessagingPairingRecord,
  MessagingRoutingRuleRecord,
  MessagingSessionRecord,
  MessagingTurnRecord,
  RelayDeviceRecord,
} from '../../messaging/types.js';
import { egressExtraJson, applyEgressExtra } from '../../messaging/types.js';
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

  // Cross-instance pub/sub is in-process here: sqlite is single-node, so an
  // EventEmitter delivers a publish to every subscriber in the one process.
  // (The Postgres adapter uses LISTEN/NOTIFY for true cross-instance fan-out.)
  const pubsub = new EventEmitter();
  pubsub.setMaxListeners(0); // many concurrent SSE subscribers

  // ── statements (prepared once for reuse) ──

  const insertRunStmt = db.prepare(`
    INSERT INTO runs (
      run_id, workflow_id, tenant_id, scope_id, status,
      inputs, metadata, configurable, callback_url,
      idempotency_key, parent_run_id, parent_seq, fork_mode,
      created_at, updated_at, completed_at, error_code, error_message,
      current_node_id, scheduler_snapshot
    ) VALUES (
      @runId, @workflowId, @tenantId, @scopeId, @status,
      @inputs, @metadata, @configurable, @callbackUrl,
      @idempotencyKey, @parentRunId, @parentSeq, @forkMode,
      @createdAt, @updatedAt, @completedAt, @errorCode, @errorMessage,
      @currentNodeId, @schedulerSnapshot
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

  // ── run dispatch lease (multi-instance crash recovery, schema v20) ──
  const setRunDispatchLeaseStmt = db.prepare(`
    UPDATE runs
    SET dispatch_owner = @owner, dispatch_lease_expires_at = @lease
    WHERE run_id = @runId
  `);
  // Select up-to-`limit` ORPHAN run ids: pending/running, past the grace
  // window (createdAt < staleBeforeIso — created_at is ISO-8601 TEXT, so
  // lexicographic compare is chronological), and the lease absent/expired.
  const selectOrphanedRunIdsStmt = db.prepare(`
    SELECT run_id FROM runs
    WHERE status IN ('pending', 'running')
      AND created_at < @staleBeforeIso
      AND (dispatch_lease_expires_at IS NULL OR dispatch_lease_expires_at < @nowMs)
    ORDER BY created_at ASC
    LIMIT @limit
  `);
  const claimRunDispatchStmt = db.prepare(`
    UPDATE runs
    SET dispatch_owner = @workerId, dispatch_lease_expires_at = @leaseExpiresAt
    WHERE run_id = @runId
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

  // ── webhook deliveries (durable retry queue) ──
  const enqueueWebhookDeliveryStmt = db.prepare(`
    INSERT INTO webhook_deliveries (
      delivery_id, subscription_id, url, secret, event_type, payload,
      status, attempts, max_attempts, next_attempt_at,
      claimed_by, claim_expires_at, last_error, created_at, updated_at
    ) VALUES (
      @deliveryId, @subscriptionId, @url, @secret, @eventType, @payload,
      @status, @attempts, @maxAttempts, @nextAttemptAt,
      @claimedBy, @claimExpiresAt, @lastError, @createdAt, @updatedAt
    )
  `);
  // Select the ids of up-to-`limit` DUE deliveries, oldest schedule first.
  const selectDueWebhookDeliveryIdsStmt = db.prepare(`
    SELECT delivery_id FROM webhook_deliveries
    WHERE status = 'pending'
      AND next_attempt_at <= @now
      AND (claim_expires_at IS NULL OR claim_expires_at < @now)
    ORDER BY next_attempt_at ASC
    LIMIT @limit
  `);
  const claimWebhookDeliveryStmt = db.prepare(`
    UPDATE webhook_deliveries
    SET claimed_by = @workerId, claim_expires_at = @claimExpiresAt, updated_at = @now
    WHERE delivery_id = @deliveryId
  `);
  const getWebhookDeliveryStmt = db.prepare(`SELECT * FROM webhook_deliveries WHERE delivery_id = ?`);
  const markWebhookDeliveryDeliveredStmt = db.prepare(`
    UPDATE webhook_deliveries
    SET status = 'delivered', updated_at = @now, claimed_by = NULL, claim_expires_at = NULL
    WHERE delivery_id = @deliveryId
  `);
  const rescheduleWebhookDeliveryStmt = db.prepare(`
    UPDATE webhook_deliveries
    SET attempts = attempts + 1,
        status = @status,
        next_attempt_at = @nextAttemptAt,
        last_error = @error,
        claimed_by = NULL,
        claim_expires_at = NULL,
        updated_at = @now
    WHERE delivery_id = @deliveryId
  `);

  // Atomic claim: SELECT due ids + UPDATE the lease + re-SELECT the claimed
  // rows, all under one better-sqlite3 write transaction. better-sqlite3
  // serializes write txns process-wide, so two concurrent claimers cannot
  // grab the same row — the second sees the lease already set and its own
  // due-scan excludes those ids.
  const claimDueWebhookDeliveriesTxn = db.transaction(
    (workerId: string, now: number, leaseMs: number, limit: number): WebhookDeliveryRecord[] => {
      const idRows = selectDueWebhookDeliveryIdsStmt.all({ now, limit }) as Array<{ delivery_id: string }>;
      const claimExpiresAt = now + leaseMs;
      const claimed: WebhookDeliveryRecord[] = [];
      for (const { delivery_id } of idRows) {
        claimWebhookDeliveryStmt.run({ deliveryId: delivery_id, workerId, claimExpiresAt, now });
        const row = getWebhookDeliveryStmt.get(delivery_id);
        if (row) claimed.push(rowToWebhookDelivery(row));
      }
      return claimed;
    },
  );

  // Atomic orphan-run claim: SELECT due ids + UPDATE the lease + re-SELECT
  // the claimed rows, all under one better-sqlite3 write transaction — same
  // shape as claimDueWebhookDeliveriesTxn above. better-sqlite3 serializes
  // write txns process-wide, so two concurrent reapers can't grab the same
  // run: the second's due-scan excludes ids whose lease the first just set.
  const claimOrphanedRunsTxn = db.transaction(
    (
      workerId: string,
      nowMs: number,
      staleBeforeIso: string,
      leaseMs: number,
      limit: number,
    ): RunRecord[] => {
      const idRows = selectOrphanedRunIdsStmt.all({ staleBeforeIso, nowMs, limit }) as Array<{
        run_id: string;
      }>;
      const leaseExpiresAt = nowMs + leaseMs;
      const claimed: RunRecord[] = [];
      for (const { run_id } of idRows) {
        claimRunDispatchStmt.run({ runId: run_id, workerId, leaseExpiresAt });
        const row = getRunStmt.get(run_id);
        if (row) claimed.push(rowToRun(row));
      }
      return claimed;
    },
  );

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
      // Per-run scheduler snapshot for DAG-aware resume — see schema
      // migration v17. Stored as opaque text (JSON-encoded
      // `SerializedSnapshot` from executor.ts) and surfaced raw so
      // the resume path can JSON.parse it without round-tripping
      // through a typed shape.
      schedulerSnapshot: (row.scheduler_snapshot as string | null) ?? undefined,
      // Multi-instance run-dispatch lease (schema migration v20). Both
      // columns are nullable; `dispatch_lease_expires_at` is epoch-ms.
      dispatchOwner: row.dispatch_owner ?? null,
      dispatchLeaseExpiresAt: row.dispatch_lease_expires_at == null ? null : Number(row.dispatch_lease_expires_at),
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

  function rowToWebhookDelivery(row: any): WebhookDeliveryRecord {
    return {
      deliveryId: row.delivery_id,
      subscriptionId: row.subscription_id,
      url: row.url,
      secret: row.secret,
      eventType: row.event_type,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      nextAttemptAt: row.next_attempt_at,
      claimedBy: row.claimed_by ?? null,
      claimExpiresAt: row.claim_expires_at ?? null,
      lastError: row.last_error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToUserAgent(row: any): UserAgentRecord {
    return {
      agentId: row.agent_id,
      tenantId: row.tenant_id,
      persona: row.persona,
      label: row.label ?? undefined,
      description: row.description ?? undefined,
      modelClass: row.model_class,
      systemPrompt: row.system_prompt,
      toolAllowlist: row.tool_allowlist ? JSON.parse(row.tool_allowlist) : [],
      memoryShape: {
        scratchpad: row.memory_scratchpad === 1,
        conversation: row.memory_conversation === 1,
        longTerm: row.memory_long_term === 1,
      },
      confidenceThreshold: row.confidence_threshold ?? undefined,
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
        schedulerSnapshot: run.schedulerSnapshot ?? null,
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
          current_node_id = @currentNodeId,
          scheduler_snapshot = @schedulerSnapshot
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
        schedulerSnapshot: merged.schedulerSnapshot ?? null,
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

    async setRunDispatchLease(runId, owner, leaseExpiresAt) {
      // Best-effort: a missing run row is a no-op (zero rows updated).
      setRunDispatchLeaseStmt.run({ runId, owner: owner ?? null, lease: leaseExpiresAt ?? null });
    },

    async claimOrphanedRuns(workerId, nowMs, staleBeforeIso, leaseMs, limit) {
      return claimOrphanedRunsTxn(workerId, nowMs, staleBeforeIso, leaseMs, limit);
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

    async enqueueWebhookDelivery(record) {
      enqueueWebhookDeliveryStmt.run({
        deliveryId: record.deliveryId,
        subscriptionId: record.subscriptionId,
        url: record.url,
        secret: record.secret,
        eventType: record.eventType,
        payload: record.payload,
        status: record.status,
        attempts: record.attempts,
        maxAttempts: record.maxAttempts,
        nextAttemptAt: record.nextAttemptAt,
        claimedBy: record.claimedBy ?? null,
        claimExpiresAt: record.claimExpiresAt ?? null,
        lastError: record.lastError ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    },

    async claimDueWebhookDeliveries(workerId, now, leaseMs, limit) {
      return claimDueWebhookDeliveriesTxn(workerId, now, leaseMs, limit);
    },

    async markWebhookDeliveryDelivered(deliveryId, now) {
      markWebhookDeliveryDeliveredStmt.run({ deliveryId, now });
    },

    async rescheduleWebhookDelivery(deliveryId, now, nextAttemptAt, dead, error) {
      rescheduleWebhookDeliveryStmt.run({
        deliveryId,
        now,
        nextAttemptAt,
        status: dead ? 'dead' : 'pending',
        error,
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
    async pruneIdempotencyByPrefix(keyPrefix, olderThanIso) {
      // created_at is an ISO-8601 string → lexicographic compare is chronological.
      const info = db
        .prepare(`DELETE FROM idempotency WHERE key LIKE ? ESCAPE '\\' AND created_at < ?`)
        .run(`${keyPrefix.replace(/[%_\\]/g, '\\$&')}%`, olderThanIso);
      return info.changes;
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
        const nr = db.prepare(`DELETE FROM notifications WHERE tenant_id = ?`).run(tid);
        const pr = db.prepare(`DELETE FROM push_subscriptions WHERE tenant_id = ?`).run(tid);
        return {
          runs: Number(rr.changes ?? 0),
          events,
          interrupts,
          workflows: Number(wr.changes ?? 0),
          secrets: Number(sr.changes ?? 0),
          notifications: Number(nr.changes ?? 0),
          pushSubscriptions: Number(pr.changes ?? 0),
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

    async insertPushSubscription(record) {
      // ON CONFLICT(endpoint) — same-browser re-subscribe updates the
      // keys + user-agent without a duplicate row. Mirrors postgres.
      db.prepare(
        `INSERT INTO push_subscriptions (
          subscription_id, tenant_id, endpoint, p256dh_key, auth_key,
          user_agent, created_at, last_used_at
        ) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET
          p256dh_key = excluded.p256dh_key,
          auth_key = excluded.auth_key,
          user_agent = excluded.user_agent,
          tenant_id = excluded.tenant_id`,
      ).run(
        record.subscriptionId, record.tenantId, record.endpoint,
        record.p256dhKey, record.authKey,
        record.userAgent ?? null,
        record.createdAt, record.lastUsedAt ?? null,
      );
    },

    async listPushSubscriptions(tenantId) {
      const rows = db.prepare(
        `SELECT * FROM push_subscriptions WHERE tenant_id = ? ORDER BY created_at DESC`,
      ).all(tenantId) as Array<Record<string, unknown>>;
      return rows.map(rowToPushSubscriptionSqlite);
    },

    async getPushSubscriptionByEndpoint(endpoint) {
      const row = db.prepare(
        `SELECT * FROM push_subscriptions WHERE endpoint = ?`,
      ).get(endpoint) as Record<string, unknown> | undefined;
      return row ? rowToPushSubscriptionSqlite(row) : null;
    },

    async deletePushSubscription(subscriptionId) {
      const r = db.prepare(
        `DELETE FROM push_subscriptions WHERE subscription_id = ?`,
      ).run(subscriptionId);
      return r.changes > 0;
    },

    async deleteAllTenantPushSubscriptions(tenantId) {
      const r = db.prepare(
        `DELETE FROM push_subscriptions WHERE tenant_id = ?`,
      ).run(tenantId);
      return r.changes;
    },

    // ── user-authored agents (phase E1, 2026-05-28) ──
    async insertUserAgent(record) {
      db.prepare(
        `INSERT INTO user_agents (
          agent_id, tenant_id, persona, label, description, model_class,
          system_prompt, tool_allowlist,
          memory_scratchpad, memory_conversation, memory_long_term,
          confidence_threshold, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.agentId,
        record.tenantId,
        record.persona,
        record.label ?? null,
        record.description ?? null,
        record.modelClass,
        record.systemPrompt,
        JSON.stringify(record.toolAllowlist),
        record.memoryShape.scratchpad ? 1 : 0,
        record.memoryShape.conversation ? 1 : 0,
        record.memoryShape.longTerm ? 1 : 0,
        record.confidenceThreshold ?? null,
        record.createdAt,
      );
    },

    async listUserAgents(tenantId) {
      const rows = db.prepare(
        `SELECT * FROM user_agents WHERE tenant_id = ? ORDER BY created_at DESC`,
      ).all(tenantId) as Array<Record<string, unknown>>;
      return rows.map(rowToUserAgent);
    },

    async listAllUserAgents() {
      const rows = db.prepare(
        `SELECT * FROM user_agents ORDER BY created_at DESC`,
      ).all() as Array<Record<string, unknown>>;
      return rows.map(rowToUserAgent);
    },

    async getUserAgent(agentId) {
      const row = db.prepare(
        `SELECT * FROM user_agents WHERE agent_id = ?`,
      ).get(agentId) as Record<string, unknown> | undefined;
      return row ? rowToUserAgent(row) : null;
    },

    async deleteUserAgent(agentId) {
      const r = db.prepare(`DELETE FROM user_agents WHERE agent_id = ?`).run(agentId);
      return r.changes > 0;
    },

    async updateUserAgent(record) {
      const r = db.prepare(
        `UPDATE user_agents SET
          persona = ?, label = ?, description = ?, model_class = ?,
          system_prompt = ?, tool_allowlist = ?,
          memory_scratchpad = ?, memory_conversation = ?, memory_long_term = ?,
          confidence_threshold = ?
        WHERE agent_id = ?`,
      ).run(
        record.persona,
        record.label ?? null,
        record.description ?? null,
        record.modelClass,
        record.systemPrompt,
        JSON.stringify(record.toolAllowlist),
        record.memoryShape.scratchpad ? 1 : 0,
        record.memoryShape.conversation ? 1 : 0,
        record.memoryShape.longTerm ? 1 : 0,
        record.confidenceThreshold ?? null,
        record.agentId,
      );
      return r.changes > 0;
    },

    // ── messaging relay-gateway (demo host-extension) ──
    async upsertRelayDevice(record) {
      db.prepare(
        `INSERT INTO relay_devices (
          relay_id, tenant_id, channel, device_name, status,
          device_token_hash, token_expires_at, activation_code, activation_expires_at,
          registered_at, last_heartbeat_at, last_reported_status
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(relay_id) DO UPDATE SET
          channel=excluded.channel, device_name=excluded.device_name, status=excluded.status,
          device_token_hash=excluded.device_token_hash, token_expires_at=excluded.token_expires_at,
          activation_code=excluded.activation_code, activation_expires_at=excluded.activation_expires_at,
          last_heartbeat_at=excluded.last_heartbeat_at, last_reported_status=excluded.last_reported_status`,
      ).run(
        record.relayId, record.tenantId, record.channel, record.deviceName ?? null, record.status,
        record.deviceTokenHash ?? null, record.tokenExpiresAt ?? null,
        record.activationCode ?? null, record.activationExpiresAt ?? null,
        record.registeredAt, record.lastHeartbeatAt ?? null, record.lastReportedStatus ?? null,
      );
    },
    async getRelayDevice(relayId) {
      const row = db.prepare(`SELECT * FROM relay_devices WHERE relay_id = ?`).get(relayId) as Record<string, unknown> | undefined;
      return row ? rowToRelayDeviceSqlite(row) : null;
    },
    async getRelayDeviceByTokenHash(tokenHash) {
      const row = db.prepare(
        `SELECT * FROM relay_devices WHERE device_token_hash = ? AND status = 'active'`,
      ).get(tokenHash) as Record<string, unknown> | undefined;
      return row ? rowToRelayDeviceSqlite(row) : null;
    },
    async listRelayDevices(tenantId) {
      const rows = db
        .prepare(`SELECT * FROM relay_devices WHERE tenant_id = ? ORDER BY registered_at DESC`)
        .all(tenantId) as Record<string, unknown>[];
      return rows.map(rowToRelayDeviceSqlite);
    },

    async recordAgentRunAttribution(row) {
      db.prepare(
        `INSERT OR IGNORE INTO agent_run_activity (run_id, tenant_id, roster_id, agent_id, source, created_at)
         VALUES (@runId, @tenantId, @rosterId, @agentId, @source, @createdAt)`,
      ).run({
        runId: row.runId,
        tenantId: row.tenantId,
        rosterId: row.rosterId,
        agentId: row.agentId ?? null,
        source: row.source,
        createdAt: row.createdAt,
      });
    },
    async listAgentRunActivity({ tenantId, rosterId, status, limit = 50 }) {
      const rows = db
        .prepare(
          `SELECT r.* FROM agent_run_activity a
             JOIN runs r ON r.run_id = a.run_id
            WHERE a.tenant_id = @tenantId
              AND (@rosterId IS NULL OR a.roster_id = @rosterId)
              AND (@status IS NULL OR r.status = @status)
            ORDER BY r.created_at DESC
            LIMIT @limit`,
        )
        .all({ tenantId, rosterId: rosterId ?? null, status: status ?? null, limit });
      return rows.map(rowToRun);
    },
    async enqueueRelayOutbound(record) {
      db.prepare(
        `INSERT INTO relay_outbound (egress_id, relay_id, channel, conversation_id, text, reply_to_message_id, enqueued_at, extra)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        record.egressId, record.relayId, record.channel, record.conversationId,
        record.text, record.replyToMessageId ?? null, record.enqueuedAt, egressExtraJson(record),
      );
    },
    async listRelayOutbound(relayId, limit) {
      const rows = db.prepare(
        `SELECT * FROM relay_outbound WHERE relay_id = ? ORDER BY enqueued_at ASC, egress_id ASC LIMIT ?`,
      ).all(relayId, limit) as Array<Record<string, unknown>>;
      return rows.map(rowToEgressSqlite);
    },
    async ackRelayOutbound(relayId, egressIds) {
      if (egressIds.length === 0) return 0;
      const placeholders = egressIds.map(() => '?').join(', ');
      const r = db.prepare(
        `DELETE FROM relay_outbound WHERE relay_id = ? AND egress_id IN (${placeholders})`,
      ).run(relayId, ...egressIds);
      return r.changes;
    },
    async deleteRelayOutbound(relayId) {
      db.prepare(`DELETE FROM relay_outbound WHERE relay_id = ?`).run(relayId);
    },
    async upsertMessagingConnector(record) {
      db.prepare(
        `INSERT INTO messaging_connectors (connector_id, tenant_id, channel, display_name, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(connector_id) DO UPDATE SET
           channel=excluded.channel, display_name=excluded.display_name, enabled=excluded.enabled, updated_at=excluded.updated_at`,
      ).run(
        record.connectorId, record.tenantId, record.channel, record.displayName,
        record.enabled ? 1 : 0, record.createdAt, record.updatedAt,
      );
    },
    async getMessagingConnector(connectorId) {
      const row = db.prepare(`SELECT * FROM messaging_connectors WHERE connector_id = ?`).get(connectorId) as Record<string, unknown> | undefined;
      return row ? rowToConnectorSqlite(row) : null;
    },
    async listMessagingConnectors(tenantId) {
      const rows = tenantId === undefined
        ? db.prepare(`SELECT * FROM messaging_connectors ORDER BY created_at ASC`).all() as Array<Record<string, unknown>>
        : db.prepare(`SELECT * FROM messaging_connectors WHERE tenant_id = ? ORDER BY created_at ASC`).all(tenantId) as Array<Record<string, unknown>>;
      return rows.map(rowToConnectorSqlite);
    },
    async upsertMessagingSession(record) {
      db.prepare(
        `INSERT INTO messaging_sessions (session_key, tenant_id, channel, conversation_id, peer_id, peer_display, last_inbound_at, message_count, last_run_id)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(session_key) DO UPDATE SET
           peer_id=excluded.peer_id, peer_display=excluded.peer_display,
           last_inbound_at=excluded.last_inbound_at, message_count=excluded.message_count, last_run_id=excluded.last_run_id`,
      ).run(
        record.sessionKey, record.tenantId, record.channel, record.conversationId, record.peerId,
        record.peerDisplay ?? null, record.lastInboundAt, record.messageCount, record.lastRunId ?? null,
      );
    },
    async getMessagingSession(sessionKey) {
      const row = db.prepare(`SELECT * FROM messaging_sessions WHERE session_key = ?`).get(sessionKey) as Record<string, unknown> | undefined;
      return row ? rowToSessionSqlite(row) : null;
    },
    async listMessagingSessions(tenantId) {
      const rows = tenantId === undefined
        ? db.prepare(`SELECT * FROM messaging_sessions ORDER BY last_inbound_at DESC`).all() as Array<Record<string, unknown>>
        : db.prepare(`SELECT * FROM messaging_sessions WHERE tenant_id = ? ORDER BY last_inbound_at DESC`).all(tenantId) as Array<Record<string, unknown>>;
      return rows.map(rowToSessionSqlite);
    },
    async deleteMessagingSession(sessionKey) {
      const r = db.prepare(`DELETE FROM messaging_sessions WHERE session_key = ?`).run(sessionKey);
      return r.changes > 0;
    },

    async upsertMessagingPolicy(record) {
      db.prepare(
        `INSERT INTO messaging_policies (connector_id, tenant_id, dm_policy, group_policy, require_mention, updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(connector_id) DO UPDATE SET
           dm_policy=excluded.dm_policy, group_policy=excluded.group_policy,
           require_mention=excluded.require_mention, updated_at=excluded.updated_at`,
      ).run(record.connectorId, record.tenantId, record.dmPolicy, record.groupPolicy, record.requireMention ? 1 : 0, record.updatedAt);
    },
    async getMessagingPolicy(connectorId) {
      const row = db.prepare(`SELECT * FROM messaging_policies WHERE connector_id = ?`).get(connectorId) as Record<string, unknown> | undefined;
      return row ? rowToPolicySqlite(row) : null;
    },
    async upsertMessagingRoutingRule(record) {
      db.prepare(
        `INSERT INTO messaging_routing_rules (rule_id, tenant_id, channel, pattern, workflow_id, agent_id, priority, created_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(rule_id) DO UPDATE SET
           channel=excluded.channel, pattern=excluded.pattern,
           workflow_id=excluded.workflow_id, agent_id=excluded.agent_id, priority=excluded.priority`,
      ).run(
        record.ruleId, record.tenantId, record.channel ?? null, record.pattern,
        record.workflowId ?? null, record.agentId ?? null, record.priority, record.createdAt,
      );
    },
    async listMessagingRoutingRules(tenantId) {
      const rows = tenantId === undefined
        ? db.prepare(`SELECT * FROM messaging_routing_rules ORDER BY priority DESC, created_at ASC`).all() as Array<Record<string, unknown>>
        : db.prepare(`SELECT * FROM messaging_routing_rules WHERE tenant_id = ? ORDER BY priority DESC, created_at ASC`).all(tenantId) as Array<Record<string, unknown>>;
      return rows.map(rowToRoutingRuleSqlite);
    },
    async deleteMessagingRoutingRule(ruleId) {
      return db.prepare(`DELETE FROM messaging_routing_rules WHERE rule_id = ?`).run(ruleId).changes > 0;
    },
    async upsertMessagingIdentity(record) {
      db.prepare(
        `INSERT INTO messaging_identities (identity_id, tenant_id, display_name, peers, created_at, updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(identity_id) DO UPDATE SET
           display_name=excluded.display_name, peers=excluded.peers, updated_at=excluded.updated_at`,
      ).run(record.identityId, record.tenantId, record.displayName ?? null, JSON.stringify(record.peers ?? []), record.createdAt, record.updatedAt);
    },
    async getMessagingIdentity(identityId) {
      const row = db.prepare(`SELECT * FROM messaging_identities WHERE identity_id = ?`).get(identityId) as Record<string, unknown> | undefined;
      return row ? rowToIdentitySqlite(row) : null;
    },
    async listMessagingIdentities(tenantId) {
      const rows = tenantId === undefined
        ? db.prepare(`SELECT * FROM messaging_identities ORDER BY created_at ASC`).all() as Array<Record<string, unknown>>
        : db.prepare(`SELECT * FROM messaging_identities WHERE tenant_id = ? ORDER BY created_at ASC`).all(tenantId) as Array<Record<string, unknown>>;
      return rows.map(rowToIdentitySqlite);
    },
    async deleteMessagingIdentity(identityId) {
      return db.prepare(`DELETE FROM messaging_identities WHERE identity_id = ?`).run(identityId).changes > 0;
    },
    async appendDeliveryLog(record) {
      db.prepare(
        `INSERT INTO messaging_delivery_log (log_id, tenant_id, relay_id, channel, direction, conversation_id, status, detail, at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(record.logId, record.tenantId, record.relayId ?? null, record.channel, record.direction, record.conversationId, record.status, record.detail ?? null, record.at);
    },
    async listDeliveryLog({ tenantId, channel, direction, status, limit = 100 }) {
      const conds: string[] = [];
      const params: unknown[] = [];
      if (tenantId !== undefined) { conds.push('tenant_id = ?'); params.push(tenantId); }
      if (channel) { conds.push('channel = ?'); params.push(channel); }
      if (direction) { conds.push('direction = ?'); params.push(direction); }
      if (status) { conds.push('status = ?'); params.push(status); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      // Clamp to [1, 1000]: SQLite reads a negative LIMIT as "unbounded", so a
      // negative/NaN value must never reach the query.
      const lim = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 1000) : 100;
      params.push(lim);
      const rows = db.prepare(`SELECT * FROM messaging_delivery_log ${where} ORDER BY at DESC LIMIT ?`).all(...params) as Array<Record<string, unknown>>;
      return rows.map(rowToDeliveryLogSqlite);
    },

    async appendMessagingTurn(record) {
      db.prepare(
        `INSERT INTO messaging_turns (turn_id, session_key, tenant_id, role, content, run_id, at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(
        record.turnId, record.sessionKey, record.tenantId, record.role, record.content,
        record.runId ?? null, record.at,
      );
    },
    async listMessagingTurns(sessionKey, limit, tenantId) {
      // Clamp to [1,1000] (negative LIMIT is unbounded in SQLite).
      const lim = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 1000) : 100;
      // Get the N MOST RECENT turns, then return them oldest → newest so a
      // caller can append them to messages[] in conversation order. The
      // tenant_id filter is defense-in-depth (sessionKey alone could collide).
      const rows = db.prepare(
        `SELECT * FROM (
           SELECT * FROM messaging_turns
            WHERE session_key = ? AND tenant_id = ?
            ORDER BY at DESC, turn_id DESC LIMIT ?
         ) ORDER BY at ASC, turn_id ASC`,
      ).all(sessionKey, tenantId, lim) as Array<Record<string, unknown>>;
      return rows.map(rowToTurnSqlite);
    },

    async appendMessagingPairing(record) {
      db.prepare(
        `INSERT INTO messaging_pairings (pairing_id, connector_id, tenant_id, channel, peer_id, code, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(record.pairingId, record.connectorId, record.tenantId, record.channel, record.peerId, record.code, record.expiresAt, record.createdAt);
    },
    async getMessagingPairingByCode(connectorId, code) {
      const row = db.prepare(`SELECT * FROM messaging_pairings WHERE connector_id = ? AND code = ?`).get(connectorId, code) as Record<string, unknown> | undefined;
      return row ? rowToPairingSqlite(row) : null;
    },
    async listMessagingPairings(connectorId) {
      const rows = connectorId === undefined
        ? db.prepare(`SELECT * FROM messaging_pairings ORDER BY created_at DESC`).all()
        : db.prepare(`SELECT * FROM messaging_pairings WHERE connector_id = ? ORDER BY created_at DESC`).all(connectorId);
      return (rows as Array<Record<string, unknown>>).map(rowToPairingSqlite);
    },
    async deleteMessagingPairing(pairingId) {
      const info = db.prepare(`DELETE FROM messaging_pairings WHERE pairing_id = ?`).run(pairingId);
      return info.changes > 0;
    },
    async addMessagingAllowlist(entry) {
      db.prepare(
        `INSERT OR IGNORE INTO messaging_allowlist (entry_id, connector_id, tenant_id, channel, peer_id, added_at)
         VALUES (?,?,?,?,?,?)`,
      ).run(entry.entryId, entry.connectorId, entry.tenantId, entry.channel, entry.peerId, entry.addedAt);
    },
    async getMessagingAllowlist(connectorId, channel, peerId) {
      const row = db.prepare(`SELECT * FROM messaging_allowlist WHERE connector_id = ? AND channel = ? AND peer_id = ?`).get(connectorId, channel, peerId) as Record<string, unknown> | undefined;
      return row ? rowToAllowlistSqlite(row) : null;
    },
    async listMessagingAllowlist(connectorId) {
      const rows = connectorId === undefined
        ? db.prepare(`SELECT * FROM messaging_allowlist ORDER BY added_at DESC`).all()
        : db.prepare(`SELECT * FROM messaging_allowlist WHERE connector_id = ? ORDER BY added_at DESC`).all(connectorId);
      return (rows as Array<Record<string, unknown>>).map(rowToAllowlistSqlite);
    },
    async deleteMessagingAllowlist(connectorId, channel, peerId) {
      const info = db.prepare(`DELETE FROM messaging_allowlist WHERE connector_id = ? AND channel = ? AND peer_id = ?`).run(connectorId, channel, peerId);
      return info.changes > 0;
    },

    async kvGet(key) {
      const row = db.prepare(`SELECT v FROM host_ext_kv WHERE k = ?`).get(key) as { v: string } | undefined;
      return row?.v ?? null;
    },
    async kvSet(key, value) {
      db.prepare(
        `INSERT INTO host_ext_kv (k, v, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
      ).run(key, value, new Date().toISOString());
    },
    async kvList(keyPrefix) {
      const escaped = keyPrefix.replace(/[\\%_]/g, '\\$&');
      const rows = db
        .prepare(`SELECT k, v FROM host_ext_kv WHERE k LIKE ? ESCAPE '\\' ORDER BY k`)
        .all(`${escaped}%`) as Array<{ k: string; v: string }>;
      return rows.map((r) => ({ key: r.k, value: r.v }));
    },
    async kvDelete(key) {
      const info = db.prepare(`DELETE FROM host_ext_kv WHERE k = ?`).run(key);
      return info.changes > 0;
    },

    async publish(channel, payload) {
      pubsub.emit(channel, payload);
    },
    async subscribe(channel, handler) {
      pubsub.on(channel, handler);
      return async () => {
        pubsub.off(channel, handler);
      };
    },

    async close() {
      pubsub.removeAllListeners();
      db.close();
    },
  };
}

function rowToRelayDeviceSqlite(r: Record<string, unknown>): RelayDeviceRecord {
  return {
    relayId: r.relay_id as string,
    tenantId: r.tenant_id as string,
    channel: r.channel as RelayDeviceRecord['channel'],
    deviceName: (r.device_name as string | null) ?? undefined,
    status: r.status as RelayDeviceRecord['status'],
    deviceTokenHash: (r.device_token_hash as string | null) ?? undefined,
    tokenExpiresAt: (r.token_expires_at as string | null) ?? undefined,
    activationCode: (r.activation_code as string | null) ?? undefined,
    activationExpiresAt: (r.activation_expires_at as string | null) ?? undefined,
    registeredAt: r.registered_at as string,
    lastHeartbeatAt: (r.last_heartbeat_at as string | null) ?? undefined,
    lastReportedStatus: (r.last_reported_status as string | null) ?? undefined,
  };
}

function rowToEgressSqlite(r: Record<string, unknown>): ChatEgressEnvelope {
  return applyEgressExtra({
    egressId: r.egress_id as string,
    relayId: r.relay_id as string,
    channel: r.channel as ChatEgressEnvelope['channel'],
    conversationId: r.conversation_id as string,
    text: r.text as string,
    replyToMessageId: (r.reply_to_message_id as string | null) ?? undefined,
    enqueuedAt: r.enqueued_at as string,
  }, r.extra as string | null | undefined);
}

function rowToConnectorSqlite(r: Record<string, unknown>): MessagingConnectorRecord {
  return {
    connectorId: r.connector_id as string,
    tenantId: r.tenant_id as string,
    channel: r.channel as MessagingConnectorRecord['channel'],
    displayName: r.display_name as string,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function rowToSessionSqlite(r: Record<string, unknown>): MessagingSessionRecord {
  return {
    sessionKey: r.session_key as string,
    tenantId: r.tenant_id as string,
    channel: r.channel as MessagingSessionRecord['channel'],
    conversationId: r.conversation_id as string,
    peerId: r.peer_id as string,
    peerDisplay: (r.peer_display as string | null) ?? undefined,
    lastInboundAt: r.last_inbound_at as string,
    messageCount: Number(r.message_count),
    lastRunId: (r.last_run_id as string | null) ?? undefined,
  };
}

function rowToPolicySqlite(r: Record<string, unknown>): MessagingPolicyRecord {
  return {
    connectorId: r.connector_id as string,
    tenantId: r.tenant_id as string,
    dmPolicy: r.dm_policy as MessagingPolicyRecord['dmPolicy'],
    groupPolicy: r.group_policy as MessagingPolicyRecord['groupPolicy'],
    requireMention: Boolean(r.require_mention),
    updatedAt: r.updated_at as string,
  };
}

function rowToRoutingRuleSqlite(r: Record<string, unknown>): MessagingRoutingRuleRecord {
  return {
    ruleId: r.rule_id as string,
    tenantId: r.tenant_id as string,
    channel: (r.channel as MessagingRoutingRuleRecord['channel'] | null) ?? undefined,
    pattern: r.pattern as string,
    ...(r.workflow_id ? { workflowId: r.workflow_id as string } : {}),
    ...(r.agent_id ? { agentId: r.agent_id as string } : {}),
    priority: Number(r.priority),
    createdAt: r.created_at as string,
  };
}

function rowToIdentitySqlite(r: Record<string, unknown>): MessagingIdentityRecord {
  let peers: MessagingIdentityRecord['peers'] = [];
  try { peers = JSON.parse((r.peers as string) || '[]'); } catch { peers = []; }
  return {
    identityId: r.identity_id as string,
    tenantId: r.tenant_id as string,
    displayName: (r.display_name as string | null) ?? undefined,
    peers,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function rowToPairingSqlite(r: Record<string, unknown>): MessagingPairingRecord {
  return {
    pairingId: r.pairing_id as string,
    connectorId: r.connector_id as string,
    tenantId: r.tenant_id as string,
    channel: r.channel as MessagingPairingRecord['channel'],
    peerId: r.peer_id as string,
    code: r.code as string,
    expiresAt: r.expires_at as string,
    createdAt: r.created_at as string,
  };
}

function rowToAllowlistSqlite(r: Record<string, unknown>): MessagingAllowlistEntry {
  return {
    entryId: r.entry_id as string,
    connectorId: r.connector_id as string,
    tenantId: r.tenant_id as string,
    channel: r.channel as MessagingAllowlistEntry['channel'],
    peerId: r.peer_id as string,
    addedAt: r.added_at as string,
  };
}

function rowToTurnSqlite(r: Record<string, unknown>): MessagingTurnRecord {
  return {
    turnId: r.turn_id as string,
    sessionKey: r.session_key as string,
    tenantId: r.tenant_id as string,
    role: r.role as MessagingTurnRecord['role'],
    content: r.content as string,
    runId: (r.run_id as string | null) ?? undefined,
    at: r.at as string,
  };
}

function rowToDeliveryLogSqlite(r: Record<string, unknown>): DeliveryLogRecord {
  return {
    logId: r.log_id as string,
    tenantId: r.tenant_id as string,
    relayId: (r.relay_id as string | null) ?? undefined,
    channel: r.channel as DeliveryLogRecord['channel'],
    direction: r.direction as DeliveryLogRecord['direction'],
    conversationId: r.conversation_id as string,
    status: r.status as string,
    detail: (r.detail as string | null) ?? undefined,
    at: r.at as string,
  };
}

function rowToPushSubscriptionSqlite(r: Record<string, unknown>): PushSubscriptionRecord {
  return {
    subscriptionId: r.subscription_id as string,
    tenantId: r.tenant_id as string,
    endpoint: r.endpoint as string,
    p256dhKey: r.p256dh_key as string,
    authKey: r.auth_key as string,
    userAgent: (r.user_agent as string | null) ?? undefined,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string | null) ?? undefined,
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

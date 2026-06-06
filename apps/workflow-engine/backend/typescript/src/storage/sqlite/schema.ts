/**
 * sqlite schema for the workflow-engine sample.
 *
 * Migrations are forward-only; each version adds DDL and bumps
 * LATEST_SCHEMA_VERSION. Reference-impl convention only — production
 * deployers should use a real migrator (Knex / Prisma / drizzle).
 */

import type { Database } from 'better-sqlite3';

export const LATEST_SCHEMA_VERSION = 23;

const MIGRATIONS: Record<number, (db: Database) => void> = {
  1: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        scope_id TEXT,
        status TEXT NOT NULL,
        inputs TEXT,
        metadata TEXT,
        configurable TEXT,
        callback_url TEXT,
        idempotency_key TEXT,
        parent_run_id TEXT,
        parent_seq INTEGER,
        fork_mode TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT,
        current_node_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_runs_tenant_status
        ON runs (tenant_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        node_id TEXT,
        payload TEXT,
        timestamp TEXT NOT NULL,
        causation_id TEXT,
        UNIQUE (run_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS idx_events_run_seq
        ON events (run_id, sequence);

      CREATE TABLE IF NOT EXISTS interrupts (
        interrupt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        data TEXT,
        resume_schema TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_interrupts_run_node
        ON interrupts (run_id, node_id, resolved_at);

      -- RFC 0056 annotations: created in migration v23 (NOT here) — mirrors
      -- postgres v20. Kept to a single CREATE so long-lived DBs that predate the
      -- table get it via the forward migration.

      CREATE TABLE IF NOT EXISTS webhooks (
        subscription_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        tags TEXT,
        secret TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        response_body TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invocation_log (
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        provider_key TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, node_id, attempt, provider_key)
      );

      CREATE TABLE IF NOT EXISTS workflows (
        workflow_id TEXT PRIMARY KEY,
        tenant_id TEXT,
        definition TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        audit_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        principal_id TEXT,
        action TEXT NOT NULL,
        resource TEXT,
        outcome TEXT,
        payload TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (timestamp DESC);
    `);
  },
  2: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS byok_secrets (
        credential_ref TEXT PRIMARY KEY,
        -- Encrypted record: JSON-serialized { v, iv, ct, tag } with
        -- AES-256-GCM ciphertext per src/byok/encryption.ts. The raw
        -- secret value MUST NEVER be written to this column.
        encrypted_record TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
  3: (db) => {
    // P3.4: tenant-scoped BYOK for signed-in users. The legacy flat
    // table stays for backward-compat (treated as `tenant_id =
    // __global__`); new rows from the KMS-backed signed-in path carry
    // their owning tenant id. Composite PK enforces isolation.
    db.exec(`
      CREATE TABLE IF NOT EXISTS byok_tenant_secrets (
        tenant_id TEXT NOT NULL,
        credential_ref TEXT NOT NULL,
        -- KMS-envelope record per src/byok/kmsEncryption.ts; v: 2.
        -- For local dev (no OPENWOP_BYOK_KMS_KEY) we use an
        -- AES-256-GCM stub KMS so the wire shape is identical.
        encrypted_record TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, credential_ref)
      );
    `);
  },
  4: (db) => {
    // Per-tenant, per-day token usage for managed (server-held-key)
    // providers — see src/providers/managedProvider.ts. Lets us cap
    // each signed-in user's daily consumption against the operator's
    // shared key. `date` is the UTC calendar day in YYYY-MM-DD form.
    db.exec(`
      CREATE TABLE IF NOT EXISTS managed_provider_usage (
        tenant_id TEXT NOT NULL,
        date TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, date, provider_id)
      );
    `);
  },
  5: (db) => {
    // Envelope-correlation persistence — backs the cross-process replay
    // contract from `ai-envelope.md §"Replay determinism"`. When the
    // envelope acceptor short-circuits on a duplicate correlationId,
    // the in-process Map covers the same-process case; this table
    // covers the recovered-process case (envelope accepted by an
    // instance that then died before its caller persisted downstream
    // state — a recovered instance MUST reply with the SAME outcome
    // rather than re-running the handler against a now-different
    // capability surface).
    //
    // `outcome` stores the JSON-serialized EnvelopeOutcome from
    // src/host/envelopeAcceptor.ts:121, which already carries
    // `redactedPayload` (SR-1 redaction was applied BEFORE caching).
    // Plaintext envelopes never enter this table.
    //
    // Per-(runId, correlationId) primary key matches the in-process
    // Map's keying so test scenarios that swap between the two share
    // the same conflict semantics.
    db.exec(`
      CREATE TABLE IF NOT EXISTS envelope_correlations (
        run_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        envelope_type TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (run_id, correlation_id)
      );
    `);
  },
  6: (db) => {
    // Run-scoped index for future cleanup-on-run-terminal queries
    // (`DELETE FROM envelope_correlations WHERE run_id = ?`). The
    // composite PK covers point-lookups but its leading column scan
    // is sufficient for the run-scoped delete — sqlite happily uses
    // the leftmost-prefix of the PK index for this. The explicit
    // index here is belt-and-suspenders for backends where PK index
    // prefix-scan is less reliable, and signals intent at the schema
    // level.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_envelope_correlations_run
        ON envelope_correlations (run_id);
    `);
  },
  7: (db) => {
    // Sample-extension chat-session history backing the new
    // `/v1/host/sample/chat/sessions/*` routes (chat improvements
    // plan §2C.1). Two tables: per-session headers (`chat_sessions`)
    // and per-session messages (`chat_messages`) with cascade delete.
    // `tenant_id` lets the routes scope listings per tenant; `meta`
    // is opaque JSON carrying the FE's ChatMessage.meta block
    // (provider/model/tokens/error/citations/etc.) so message-shape
    // evolution doesn't force a new migration.
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        session_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant
        ON chat_sessions (tenant_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session
        ON chat_messages (session_id, created_at);
    `);
  },
  8: (db) => {
    // Per-tenant notification inbox (PR #143). Mirrors the postgres
    // schema v6 — same column shape so the row mappers stay parallel.
    // sqlite has no JSONB; `metadata` is TEXT carrying a JSON string.
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'unread',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        run_id TEXT,
        workflow_id TEXT,
        node_id TEXT,
        interrupt_id TEXT,
        action_url TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        read_at TEXT,
        archived_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created
        ON notifications (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_tenant_status
        ON notifications (tenant_id, status, created_at DESC);
    `);
  },
  9: (db) => {
    // Web Push subscriptions — mirrors the postgres schema v7. See
    // ../postgres/schema.ts:235 for the rationale; same column shape.
    db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        subscription_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh_key TEXT NOT NULL,
        auth_key TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subs_endpoint
        ON push_subscriptions (endpoint);
      CREATE INDEX IF NOT EXISTS idx_push_subs_tenant
        ON push_subscriptions (tenant_id, created_at DESC);
    `);
  },
  10: (db) => {
    // Messaging relay-gateway (demo host-extension; NON-normative). Mirrors
    // ../postgres/schema.ts. Device tokens persisted as SHA-256 hash only.
    db.exec(`
      CREATE TABLE IF NOT EXISTS relay_devices (
        relay_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        device_name TEXT,
        status TEXT NOT NULL,
        device_token_hash TEXT,
        token_expires_at TEXT,
        activation_code TEXT,
        activation_expires_at TEXT,
        registered_at TEXT NOT NULL,
        last_heartbeat_at TEXT,
        last_reported_status TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_relay_devices_token
        ON relay_devices (device_token_hash);
      CREATE TABLE IF NOT EXISTS relay_outbound (
        egress_id TEXT PRIMARY KEY,
        relay_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        text TEXT NOT NULL,
        reply_to_message_id TEXT,
        enqueued_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_relay_outbound_relay
        ON relay_outbound (relay_id, enqueued_at ASC);
      CREATE TABLE IF NOT EXISTS messaging_connectors (
        connector_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        display_name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_connectors_tenant
        ON messaging_connectors (tenant_id);
      CREATE TABLE IF NOT EXISTS messaging_sessions (
        session_key TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        peer_display TEXT,
        last_inbound_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_run_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_sessions_tenant
        ON messaging_sessions (tenant_id, last_inbound_at DESC);
    `);
  },
  11: (db) => {
    // Messaging policies / routing rules / identities / delivery log
    // (demo host-extension; NON-normative). Mirrors ../postgres/schema.ts.
    db.exec(`
      CREATE TABLE IF NOT EXISTS messaging_policies (
        connector_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        dm_policy TEXT NOT NULL,
        group_policy TEXT NOT NULL,
        require_mention INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messaging_routing_rules (
        rule_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        channel TEXT,
        pattern TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_routing_tenant
        ON messaging_routing_rules (tenant_id, priority DESC);
      CREATE TABLE IF NOT EXISTS messaging_identities (
        identity_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        display_name TEXT,
        peers TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_identities_tenant
        ON messaging_identities (tenant_id);
      CREATE TABLE IF NOT EXISTS messaging_delivery_log (
        log_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        relay_id TEXT,
        channel TEXT NOT NULL,
        direction TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_delivery_log_tenant
        ON messaging_delivery_log (tenant_id, at DESC);
    `);
  },
  12: (db) => {
    // Envelope v2: carry rich outbound fields (media/components/reactions) as a
    // JSON blob so they survive the relay outbound queue. Mirrors postgres mig 10.
    db.exec(`ALTER TABLE relay_outbound ADD COLUMN extra TEXT;`);
  },
  13: (db) => {
    // Per-session turn history so messaging gets chat-style continuity: each
    // inbound run threads the recent prior turns into `messages[]`, and the
    // assistant reply is persisted on run completion. Mirrors postgres mig 11.
    db.exec(`
      CREATE TABLE IF NOT EXISTS messaging_turns (
        turn_id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        run_id TEXT,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_turns_session
        ON messaging_turns (session_key, at);
    `);
  },
  14: (db) => {
    // Per-connector access gates: pairing requests (short-lived) + allowlist
    // (approved peers). Mirrors postgres mig 12.
    db.exec(`
      CREATE TABLE IF NOT EXISTS messaging_pairings (
        pairing_id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_pairings_lookup
        ON messaging_pairings (connector_id, code);
      CREATE INDEX IF NOT EXISTS idx_messaging_pairings_peer
        ON messaging_pairings (connector_id, channel, peer_id);
      CREATE TABLE IF NOT EXISTS messaging_allowlist (
        entry_id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        UNIQUE (connector_id, channel, peer_id)
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_allowlist_connector
        ON messaging_allowlist (connector_id);
    `);
  },
  15: (db) => {
    // Routing rules may bind to an agent (RFC 0070 dispatch) instead of a
    // workflow. Mutex enforced at the route handler. Mirrors postgres mig 13.
    db.exec(`ALTER TABLE messaging_routing_rules ADD COLUMN agent_id TEXT;`);
  },
  16: (db) => {
    // User-authored agents — backs the Agents-tab "+ Author new" form
    // (`POST /v1/host/sample/agents`) added 2026-05-28. Pack-installed
    // agents stay in the registry as today (RFC 0003 §C); these rows
    // are merged into the same `getAgentRegistry().list()` at boot so
    // `GET /v1/agents` projects both sources without consumers
    // distinguishing. The `agent_id` shape for user records is
    // `user.<tenantId>.<persona-slug>` — the prefix avoids collision
    // with pack-installed ids (which always begin with their pack
    // name, never `user.`).
    //
    // `tool_allowlist` is JSON-encoded text (sqlite has no JSON
    // column type); the shape mirrors `ResolvedAgentManifest.toolAllowlist`.
    // `memory_*` mirror `memoryShape` booleans. `confidence_threshold`
    // is optional (real, 0.0-1.0).
    //
    // `system_prompt` carries the inline body — there's no pack-file
    // ref for user agents; the form fields the text directly. SR-1
    // (RFC 0072 §A: system prompts never cross the read API) still
    // holds: the inventory route projects `systemPromptRef` only, and
    // for user agents that ref is synthesized but not surfaced.
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_agents (
        agent_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        persona TEXT NOT NULL,
        label TEXT,
        description TEXT,
        model_class TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        tool_allowlist TEXT NOT NULL DEFAULT '[]',
        memory_scratchpad INTEGER NOT NULL DEFAULT 0,
        memory_conversation INTEGER NOT NULL DEFAULT 0,
        memory_long_term INTEGER NOT NULL DEFAULT 0,
        confidence_threshold REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_agents_tenant
        ON user_agents (tenant_id, created_at DESC);
    `);
  },
  17: (db) => {
    // Per-run serialized scheduler snapshot for DAG-aware resume.
    // Mirrors the postgres `scheduler_snapshot` column (postgres
    // schema already has it). Without this, `persistSnapshot` in
    // executor.ts silently dropped the snapshot on the sqlite path
    // (the in-memory DSN used by the public demo), and every resume
    // fell back to the legacy `resumeFromNodeIndex` path. That path
    // marks every node before the resume index as `completed` and
    // the resume target as `ready` — semantics that work for purely
    // linear workflows but corrupt any DAG with parallel suspends
    // (the other suspended branches get re-launched, suspend again,
    // and the original interrupts pile up). Real symptom: 4 parallel
    // approval nodes, user approves all 4, only the last one
    // actually drives the run forward.
    db.exec(`
      ALTER TABLE runs ADD COLUMN scheduler_snapshot TEXT;
    `);
  },
  18: (db) => {
    // Generic key→JSON store backing the sample host-extension stores (Kanban
    // boards, agent roster, org-chart) so they survive a restart. Coarse by
    // design — each service serializes its whole collection to one key.
    db.exec(`
      CREATE TABLE IF NOT EXISTS host_ext_kv (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
  19: (db) => {
    // Durable webhook-delivery retry queue. Backs the background worker
    // (`webhookWorker.ts`): a delivery is enqueued `pending`, claimed under
    // a time-boxed lease (`claimed_by` + `claim_expires_at`) so multiple
    // worker instances can't double-deliver, then either marked `delivered`
    // (terminal) or rescheduled with backoff — flipping to terminal `dead`
    // once `attempts` reaches `max_attempts`. Epoch-ms integers throughout
    // (the lease/backoff math is purely numeric; no ISO round-trip needed).
    // The (status, next_attempt_at) index serves the due-claim scan.
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        delivery_id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        claimed_by TEXT,
        claim_expires_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
        ON webhook_deliveries (status, next_attempt_at);
    `);
  },
  20: (db) => {
    // Multi-instance run-dispatch lease (crash recovery). A dispatching
    // instance stamps `dispatch_owner` (its worker/instance id) + a
    // time-boxed `dispatch_lease_expires_at` (epoch-ms) on a run when it
    // starts executing it. If that instance crashes, the lease expires and
    // a survivor's reaper re-claims the orphaned run (`claimOrphanedRuns`)
    // for re-dispatch — without two instances racing the same run, because
    // the claim runs in a single write transaction and excludes rows whose
    // lease is still live. Both columns are nullable (a run with no live
    // dispatcher carries NULL/NULL). The (status, dispatch_lease_expires_at)
    // index serves the orphan-claim scan.
    db.exec(`
      ALTER TABLE runs ADD COLUMN dispatch_owner TEXT;
      ALTER TABLE runs ADD COLUMN dispatch_lease_expires_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_runs_dispatch_lease
        ON runs (status, dispatch_lease_expires_at);
    `);
  },
  21: (db) => {
    // Append-only index of agent-attributed runs (RFC 0086). Written once when
    // a run is created carrying heartbeat/schedule/kanban/approval attribution;
    // the live status comes from the runs table at query time (joined), so this
    // row never needs updating. Lets fleet / per-agent / failure activity
    // queries filter by (tenant, roster) directly instead of scanning the most
    // recent N runs and filtering in memory.
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_run_activity (
        run_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        roster_id TEXT NOT NULL,
        agent_id TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_run_activity_tenant_roster
        ON agent_run_activity (tenant_id, roster_id, created_at);

      -- Backfill from existing runs so the activity feed isn't empty after this
      -- migration. Pick the first present attribution block (heartbeat →
      -- schedule → kanban → approval), matching recordRunAttribution's priority.
      -- json_extract returns NULL for non-JSON/absent, so the WHERE keeps only
      -- agent-attributed runs.
      INSERT OR IGNORE INTO agent_run_activity (run_id, tenant_id, roster_id, agent_id, source, created_at)
      SELECT run_id, tenant_id,
        COALESCE(json_extract(metadata,'$.heartbeat.rosterId'), json_extract(metadata,'$.schedule.rosterId'),
                 json_extract(metadata,'$.kanban.rosterId'),    json_extract(metadata,'$.approval.rosterId')),
        COALESCE(json_extract(metadata,'$.heartbeat.agentId'),  json_extract(metadata,'$.schedule.agentId'),
                 json_extract(metadata,'$.kanban.agentId'),     json_extract(metadata,'$.approval.agentId')),
        CASE
          WHEN json_extract(metadata,'$.heartbeat.rosterId') IS NOT NULL THEN 'heartbeat'
          WHEN json_extract(metadata,'$.schedule.rosterId')  IS NOT NULL THEN 'schedule'
          WHEN json_extract(metadata,'$.kanban.rosterId')    IS NOT NULL THEN 'kanban'
          ELSE 'approval'
        END,
        created_at
      FROM runs
      -- json_valid guards json_extract (sqlite raises on malformed JSON; AND
      -- short-circuits so json_extract only runs on valid-JSON rows). In practice
      -- metadata is always JSON.stringify output, but stay defensive.
      WHERE json_valid(metadata)
        AND COALESCE(json_extract(metadata,'$.heartbeat.rosterId'), json_extract(metadata,'$.schedule.rosterId'),
                     json_extract(metadata,'$.kanban.rosterId'),    json_extract(metadata,'$.approval.rosterId')) IS NOT NULL;
    `);
  },
  22: (db) => {
    // Windowed run-budget counter for the autonomous daemons (scheduler +
    // heartbeat). One row per (tenant, time-window) bucket; an atomic
    // upsert-increment makes the ceiling multi-instance-safe so self-firing
    // autonomy can't run away on cost. Stale buckets are harmless (a fixed
    // integer per past window) and pruned best-effort by the budget service.
    db.exec(`
      CREATE TABLE IF NOT EXISTS run_budget (
        bucket TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_budget_window ON run_budget (window_start);
    `);
  },
  23: (db) => {
    // FORWARD-FIX for the RFC 0056 annotations table — see postgres mig 20.
    // annotations was declared in v1, but a DB initialized before that
    // declaration landed never re-runs v1 (forward-only migrations), so it can
    // be missing on a long-lived DB. Idempotent; a no-op on fresh DBs.
    db.exec(`
      CREATE TABLE IF NOT EXISTS annotations (
        annotation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_annotations_run
        ON annotations (run_id, created_at);
    `);
  },
};

export function applyMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const row = db.prepare(`SELECT version FROM __schema_version WHERE id = 1`).get() as
    | { version: number }
    | undefined;
  const current = row?.version ?? 0;

  for (let v = current + 1; v <= LATEST_SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) {
      throw new Error(`Missing migration for schema version ${v}`);
    }
    migration(db);
  }

  if (current === 0) {
    db.prepare(`INSERT INTO __schema_version (id, version, applied_at) VALUES (1, ?, ?)`).run(
      LATEST_SCHEMA_VERSION,
      new Date().toISOString(),
    );
  } else if (current < LATEST_SCHEMA_VERSION) {
    db.prepare(`UPDATE __schema_version SET version = ?, applied_at = ? WHERE id = 1`).run(
      LATEST_SCHEMA_VERSION,
      new Date().toISOString(),
    );
  }
}

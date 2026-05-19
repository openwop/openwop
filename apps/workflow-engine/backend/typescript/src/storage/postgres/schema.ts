/**
 * Postgres schema for the workflow-engine sample.
 *
 * Migrations are forward-only; each version adds DDL and bumps
 * LATEST_SCHEMA_VERSION. Tracks the same surface as
 * src/storage/sqlite/schema.ts so behavior is identical regardless of
 * backend. Reference-impl convention only — production deployers
 * should use a real migrator (knex / flyway / drizzle).
 *
 * Tables:
 *   runs              one row per run, indexed by (tenant_id, created_at desc)
 *   events            per-run sequence-ordered event log
 *   interrupts        suspend records with signed-token lookup
 *   webhooks          subscription registry
 *   idempotency       Layer-1 HTTP idempotency key cache
 *   invocation_log    Layer-2 engine-side idempotency cache
 *   workflows         saved workflow definitions, tenant-scoped
 *   audit_log         security + auth audit trail
 *   byok_secrets      encrypted-at-rest BYOK credential records
 */

/**
 * Minimal client surface the migrations need. `pg.Client` and
 * `pg.PoolClient` both satisfy it (their `query` method shape is
 * identical for our usage). Accepting the narrower type lets callers
 * pass a `pool.connect()` result without unsafe casts.
 */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export const LATEST_SCHEMA_VERSION = 4;

const MIGRATIONS: Record<number, (client: Queryable) => Promise<void>> = {
  1: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        scope_id TEXT,
        status TEXT NOT NULL,
        inputs JSONB,
        metadata JSONB,
        configurable JSONB,
        callback_url TEXT,
        idempotency_key TEXT,
        parent_run_id TEXT,
        parent_seq INTEGER,
        fork_mode TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        error_code TEXT,
        error_message TEXT,
        current_node_id TEXT,
        scheduler_snapshot TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_tenant_status
        ON runs (tenant_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        node_id TEXT,
        payload JSONB,
        timestamp TIMESTAMPTZ NOT NULL,
        causation_id TEXT,
        UNIQUE (run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events (run_id, sequence);

      CREATE TABLE IF NOT EXISTS interrupts (
        interrupt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        data JSONB,
        resume_schema JSONB,
        created_at TIMESTAMPTZ NOT NULL,
        resolved_at TIMESTAMPTZ,
        resolved_value JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_interrupts_run_node
        ON interrupts (run_id, node_id, resolved_at);

      CREATE TABLE IF NOT EXISTS webhooks (
        subscription_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events JSONB NOT NULL,
        tags JSONB,
        secret TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        response_body TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invocation_log (
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        provider_key TEXT NOT NULL,
        result JSONB,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (run_id, node_id, attempt, provider_key)
      );

      CREATE TABLE IF NOT EXISTS workflows (
        workflow_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        definition JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (tenant_id, workflow_id)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        audit_id TEXT PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        principal_id TEXT,
        action TEXT NOT NULL,
        resource TEXT,
        outcome TEXT,
        payload JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (timestamp DESC);

      CREATE TABLE IF NOT EXISTS byok_secrets (
        credential_ref TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT '__global__',
        encrypted_record TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (tenant_id, credential_ref)
      );
    `);
  },
  2: async (client) => {
    // Per-tenant, per-day token usage for managed (server-held-key)
    // providers — see src/providers/managedProvider.ts. Mirrors the
    // sqlite-side migration v4. `date` is the UTC calendar day in
    // YYYY-MM-DD form (TEXT, not DATE, to match the sqlite shape so
    // the Storage interface can stay backend-agnostic).
    await client.query(`
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
  3: async (client) => {
    // Envelope-correlation persistence — mirrors sqlite migration v5.
    // Backs the cross-process replay contract from
    // `ai-envelope.md §"Replay determinism"`. Outcome JSON carries the
    // already-redacted payload from envelopeAcceptor.ts §"Step 7", so
    // plaintext envelopes never enter this table (SR-1 redaction-
    // carry-forward holds across the persistence boundary).
    await client.query(`
      CREATE TABLE IF NOT EXISTS envelope_correlations (
        run_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        envelope_type TEXT NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (run_id, correlation_id)
      );
    `);
  },
  4: async (client) => {
    // Run-scoped index for future cleanup-on-run-terminal queries
    // (`DELETE FROM envelope_correlations WHERE run_id = $1`). The
    // composite PK's leftmost-prefix usually covers this, but the
    // explicit index makes the intent visible and matches the sqlite
    // v6 mirror. Mirrors `sqlite/schema.ts` v6.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_envelope_correlations_run
        ON envelope_correlations (run_id);
    `);
  },
};

export async function applyMigrations(client: Queryable): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS __schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL
    );
  `);
  const cur = await client.query<{ version: number }>(
    `SELECT version FROM __schema_version WHERE id = 1`,
  );
  const current = cur.rows[0]?.version ?? 0;

  for (let v = current + 1; v <= LATEST_SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) throw new Error(`Missing Postgres migration for schema version ${v}`);
    await migration(client);
  }

  if (current === 0) {
    await client.query(
      `INSERT INTO __schema_version (id, version, applied_at) VALUES (1, $1, NOW())`,
      [LATEST_SCHEMA_VERSION],
    );
  } else if (current < LATEST_SCHEMA_VERSION) {
    await client.query(
      `UPDATE __schema_version SET version = $1, applied_at = NOW() WHERE id = 1`,
      [LATEST_SCHEMA_VERSION],
    );
  }
}

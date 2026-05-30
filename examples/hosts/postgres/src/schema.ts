/**
 * Postgres schema for the run-lifecycle slice.
 *
 * Mirrors the SQLite reference host's `runs` + `events` + `idempotency`
 * tables, translated to Postgres syntax:
 *   - `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`
 *   - `TEXT` columns stay `TEXT`
 *   - `INTEGER` for unix-epoch-ms → `BIGINT`
 *   - JSON-typed columns use `JSONB` for index/query efficiency
 *
 * Tables not in this slice (audit_log, audit_checkpoints, interrupts,
 * webhook_subscriptions): deferred. The full-feature-parity migration
 * adds them when the corresponding modules port over.
 *
 * Migration ordering: `__schema_version` tracks the highest applied
 * migration step. Each follow-up port (audit, interrupts, webhooks)
 * adds a new version with its `up()` and pins the new floor. Reference-
 * impl convention only — production deployers should use a real
 * migrator (`node-pg-migrate`, Flyway, etc.) and run setupSchema's
 * idempotent DDL as a fallback.
 */

import type { Querier } from './db.js';

/**
 * Schema version applied by this version of `setupSchema()`. Bump when
 * adding a migration step below. New deployments fast-forward; existing
 * deployments apply migrations from `(current + 1)` through `LATEST`.
 */
export const LATEST_SCHEMA_VERSION = 1;

async function currentVersion(q: Querier): Promise<number> {
  await q.query(`
    CREATE TABLE IF NOT EXISTS __schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const res = await q.query<{ version: number }>(
    'SELECT version FROM __schema_version WHERE id = 1',
  );
  return res.rows[0]?.version ?? 0;
}

async function setVersion(q: Querier, version: number): Promise<void> {
  await q.query(
    `INSERT INTO __schema_version (id, version, applied_at) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = EXCLUDED.applied_at`,
    [version, new Date().toISOString()],
  );
}

export async function setupSchema(q: Querier): Promise<void> {
  const have = await currentVersion(q);
  if (have >= LATEST_SCHEMA_VERSION) return;
  await q.query(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      inputs_json JSONB NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      error_json JSONB,
      claim_holder_id TEXT,
      claim_expires_at BIGINT,
      next_node_index INTEGER NOT NULL DEFAULT 0,
      next_event_seq INTEGER NOT NULL DEFAULT 0,
      parent_run_id TEXT,
      parent_node_id TEXT,
      configurable_json JSONB
    );
  `);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);`);

  // Idempotent migration: older deployments may lack `next_event_seq`.
  // The column is required by the atomic appendEvent path (see server.ts).
  await q.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'runs' AND column_name = 'next_event_seq'
      ) THEN
        ALTER TABLE runs ADD COLUMN next_event_seq INTEGER NOT NULL DEFAULT 0;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'runs' AND column_name = 'configurable_json'
      ) THEN
        ALTER TABLE runs ADD COLUMN configurable_json JSONB;
      END IF;
      -- channels-and-reducers.md §"Channel TTL" + run-snapshot.schema.json §variables.
      -- Per-run workflow-variable state (channel writes + identity passthrough).
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'runs' AND column_name = 'variables_json'
      ) THEN
        ALTER TABLE runs ADD COLUMN variables_json JSONB;
      END IF;
      -- channels-and-reducers.md — per-run reducer channel state (the message
      -- reducer deduped-by-messageId list, etc.). Surfaced on RunSnapshot.channels.
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'runs' AND column_name = 'channels_json'
      ) THEN
        ALTER TABLE runs ADD COLUMN channels_json JSONB;
      END IF;
    END $$;
  `);

  await q.query(`
    CREATE TABLE IF NOT EXISTS events (
      run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      node_id TEXT,
      data_json JSONB,
      timestamp TEXT NOT NULL,
      causation_id TEXT,
      PRIMARY KEY (run_id, seq)
    );
  `);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(run_id, seq);`);

  // Idempotent migration: older deployments may lack `causation_id`.
  // Required by RFC 0007 §E (core.dispatch emitted events MUST set
  // causationId to the consumed decision's eventId).
  await q.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'events' AND column_name = 'causation_id'
      ) THEN
        ALTER TABLE events ADD COLUMN causation_id TEXT;
      END IF;
    END $$;
  `);

  await q.query(`
    CREATE TABLE IF NOT EXISTS idempotency (
      cache_key TEXT PRIMARY KEY,
      status INTEGER NOT NULL,
      body TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      stored_at BIGINT NOT NULL
    );
  `);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_idem_stored_at ON idempotency(stored_at);`);

  // RFC 0056 run feedback/annotations. A per-run side-store, NOT part of the
  // replayable event log — so a fork (new run_id) starts with zero annotations
  // without any copy logic (§D), and the list is inherently run-scoped (§E CTI-1).
  await q.query(`
    CREATE TABLE IF NOT EXISTS annotations (
      annotation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      data_json JSONB NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_annotations_run ON annotations(run_id, created_at);`);

  await setVersion(q, LATEST_SCHEMA_VERSION);
}

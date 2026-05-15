/**
 * sqlite schema for the workflow-engine sample.
 *
 * Migrations are forward-only; each version adds DDL and bumps
 * LATEST_SCHEMA_VERSION. Reference-impl convention only — production
 * deployers should use a real migrator (Knex / Prisma / drizzle).
 */

import type { Database } from 'better-sqlite3';

export const LATEST_SCHEMA_VERSION = 1;

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

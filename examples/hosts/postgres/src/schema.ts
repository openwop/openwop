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
 */

import type { Querier } from './db.js';

export async function setupSchema(q: Querier): Promise<void> {
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
      parent_run_id TEXT,
      parent_node_id TEXT
    );
  `);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);`);

  await q.query(`
    CREATE TABLE IF NOT EXISTS events (
      run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      node_id TEXT,
      data_json JSONB,
      timestamp TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );
  `);
  await q.query(`CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(run_id, seq);`);

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
}

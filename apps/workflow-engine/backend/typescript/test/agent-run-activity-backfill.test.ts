/**
 * Migration 21 backfill — the agent_run_activity index is populated from
 * pre-existing runs on upgrade, so the activity feed isn't empty after deploy.
 *
 * Drives the REAL migrator: seed a v20 DB with attributed runs, then
 * applyMigrations (runs 21 + 22) and assert the index was backfilled with the
 * correct roster/source (first-present-block priority), skipping un-attributed
 * runs.
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../src/storage/sqlite/schema.js';

describe('agent_run_activity backfill (sqlite migration 21)', () => {
  it('backfills attributed runs and skips un-attributed ones', () => {
    const db = new Database(':memory:');
    // Pin the schema at v20 (pre-index) and stand up a minimal runs table with
    // the columns the backfill reads, then seed rows.
    db.exec(`
      CREATE TABLE __schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO __schema_version (id, version, applied_at) VALUES (1, 20, '2026-06-02T00:00:00Z');
      CREATE TABLE runs (run_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL);
    `);
    const insert = db.prepare(`INSERT INTO runs (run_id, tenant_id, metadata, created_at) VALUES (?, ?, ?, ?)`);
    insert.run('hb', 't1', JSON.stringify({ heartbeat: { rosterId: 'host:sally', agentId: 'a1', source: 'heartbeat' } }), '2026-06-02T12:00:00Z');
    insert.run('appr', 't1', JSON.stringify({ approval: { rosterId: 'host:priya', source: 'approval' } }), '2026-06-02T11:00:00Z');
    insert.run('orphan', 't1', JSON.stringify({ other: 1 }), '2026-06-02T13:00:00Z'); // no attribution
    insert.run('nojson', 't1', 'not json', '2026-06-02T09:00:00Z'); // json_extract → NULL, skipped

    applyMigrations(db); // runs 21 (table + backfill) + 22

    const rows = db.prepare(`SELECT run_id, roster_id, agent_id, source FROM agent_run_activity ORDER BY run_id`).all() as Array<{ run_id: string; roster_id: string; agent_id: string | null; source: string }>;
    expect(rows).toEqual([
      { run_id: 'appr', roster_id: 'host:priya', agent_id: null, source: 'approval' },
      { run_id: 'hb', roster_id: 'host:sally', agent_id: 'a1', source: 'heartbeat' },
    ]);
    db.close();
  });

  it('first-present block wins when a run carries multiple attribution keys', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE __schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO __schema_version (id, version, applied_at) VALUES (1, 20, '2026-06-02T00:00:00Z');
      CREATE TABLE runs (run_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL);
    `);
    // schedule + kanban both present → heartbeat-first priority picks schedule.
    db.prepare(`INSERT INTO runs (run_id, tenant_id, metadata, created_at) VALUES (?, ?, ?, ?)`).run(
      'both', 't1',
      JSON.stringify({ schedule: { rosterId: 'host:s', source: 'schedule' }, kanban: { rosterId: 'host:k', source: 'kanban' } }),
      '2026-06-02T10:00:00Z',
    );
    applyMigrations(db);
    const row = db.prepare(`SELECT roster_id, source FROM agent_run_activity WHERE run_id = 'both'`).get() as { roster_id: string; source: string };
    expect(row).toEqual({ roster_id: 'host:s', source: 'schedule' });
    db.close();
  });
});

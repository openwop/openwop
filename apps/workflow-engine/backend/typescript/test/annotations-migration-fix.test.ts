/**
 * Forward-fix for the RFC 0056 annotations table (sqlite mig 23 / postgres mig 20).
 *
 * `annotations` was declared in migration v1, but a DB initialized before that
 * declaration was added to the v1 block never re-runs v1 (migrations are
 * forward-only) — so the table can be MISSING on a long-lived DB. Production hit
 * `relation "annotations" does not exist` on the first annotation write (the
 * workforce demo seed). This drives the REAL sqlite migrator from a v22 DB with
 * NO annotations table and asserts the new forward migration creates it.
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../src/storage/sqlite/schema.js';

describe('annotations table forward-fix (sqlite migration 23)', () => {
  it('creates the annotations table on a long-lived DB that was stuck without it', () => {
    const db = new Database(':memory:');
    // Reproduce the production state: schema pinned at v22, annotations absent.
    db.exec(`
      CREATE TABLE __schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO __schema_version (id, version, applied_at) VALUES (1, 22, '2026-06-06T00:00:00Z');
    `);
    const before = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='annotations'`)
      .get();
    expect(before).toBeUndefined(); // the bug

    applyMigrations(db); // runs mig 23

    const after = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='annotations'`)
      .get();
    expect(after).toEqual({ name: 'annotations' });

    // The exact write that 500'd in production now succeeds.
    db.prepare(
      `INSERT INTO annotations (annotation_id, run_id, tenant_id, payload, created_at) VALUES (?,?,?,?,?)`,
    ).run('a1', 'r1', 't1', '{}', '2026-06-06T00:00:00Z');
    expect((db.prepare(`SELECT COUNT(*) c FROM annotations`).get() as { c: number }).c).toBe(1);
    db.close();
  });

  it('is a no-op on a fresh DB (annotations already created in v1)', () => {
    const db = new Database(':memory:');
    applyMigrations(db); // full run from scratch — v1 creates annotations, v23 is idempotent
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='annotations'`)
      .get();
    expect(exists).toEqual({ name: 'annotations' });
    db.close();
  });
});

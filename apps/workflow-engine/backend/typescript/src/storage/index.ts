/**
 * Pluggable storage entry point.
 *
 * Default DSN — `sqlite://./data/workflow-engine.db` — opens a sqlite
 * database via better-sqlite3 (synchronous, single file). Production
 * deployers swap this for Postgres / Firestore / DynamoDB by exporting
 * a different `Storage` impl behind the same interface.
 *
 * The `Storage` interface is intentionally narrow — only what the route
 * handlers + executor need. Adding a new storage backend means
 * implementing this interface, not bolting onto sqlite.
 */

import { openSqliteStorage } from './sqlite/index.js';
import { openPostgresStorage } from './postgres/index.js';
import type { Storage } from './storage.js';

export type { Storage } from './storage.js';

/**
 * Open a Storage backend by DSN. Async because the Postgres backend
 * runs schema migrations during open(); sqlite returns immediately.
 *
 * Supported DSNs:
 *   - `sqlite://<path>`              — local file
 *   - `memory://` or `:memory:`      — in-memory sqlite
 *   - `postgres://...` / `postgresql://...` — Postgres (Cloud SQL)
 */
export async function openStorage(dsn: string): Promise<Storage> {
  if (dsn.startsWith('sqlite://')) {
    const path = dsn.slice('sqlite://'.length);
    return openSqliteStorage(path);
  }
  if (dsn === ':memory:' || dsn.startsWith('memory://')) {
    // Re-use the sqlite backend with a memory file. Avoids carrying a
    // second in-memory implementation in the sample.
    return openSqliteStorage(':memory:');
  }
  if (dsn.startsWith('postgres://') || dsn.startsWith('postgresql://')) {
    return openPostgresStorage(dsn);
  }
  throw new Error(
    `Unsupported storage DSN scheme: ${dsn}. ` +
      'Built-in support: sqlite://<path>, memory://, postgres://<dsn>. ' +
      'See src/storage/README.md to add Firestore / DynamoDB.',
  );
}

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
import type { Storage } from './storage.js';

export type { Storage } from './storage.js';

export function openStorage(dsn: string): Storage {
  if (dsn.startsWith('sqlite://')) {
    const path = dsn.slice('sqlite://'.length);
    return openSqliteStorage(path);
  }
  if (dsn === ':memory:' || dsn.startsWith('memory://')) {
    // Re-use the sqlite backend with a memory file. Avoids carrying a
    // second in-memory implementation in the sample.
    return openSqliteStorage(':memory:');
  }
  throw new Error(
    `Unsupported storage DSN scheme: ${dsn}. ` +
      'Built-in support: sqlite://<path> or memory://. ' +
      'See src/storage/README.md to add Postgres / Firestore / DynamoDB.',
  );
}

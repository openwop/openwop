#!/usr/bin/env -S npx tsx
/**
 * Bootstrap the Postgres host with a PGlite in-process backend instead
 * of requiring an OPENWOP_PG_DSN to a real Postgres. This is the entry
 * point operators use to run the conformance suite end-to-end against
 * the host without standing up Docker:
 *
 *   # terminal 1 — boot host on port 3839 against pglite
 *   node examples/hosts/postgres/scripts/start-pglite.mjs
 *
 *   # terminal 2 — point conformance suite at the running host
 *   cd conformance
 *   OPENWOP_BASE_URL=http://127.0.0.1:3839 \
 *   OPENWOP_API_KEY=openwop-postgres-dev-key \
 *   OPENWOP_WEBHOOK_ALLOW_PRIVATE=true \
 *     npm test
 *
 * The host runs until SIGINT (Ctrl-C). All host state lives in the
 * PGlite memory-backed instance; killing the process discards it.
 *
 * For production deployments, run `npm start` (which expects
 * OPENWOP_PG_DSN to point at a real Postgres) instead of this script.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-pglite-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

const { setQuerier, start } = await import('../src/server.js');

function pgliteQuerier(db) {
  return {
    async query(sql, params = []) {
      const res = await db.query(sql, params);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

const db = new PGlite('memory://');
setQuerier(pgliteQuerier(db));
const { close } = await start();

process.on('SIGINT', () => {
  void close()
    .then(() => db.close())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
process.on('SIGTERM', () => {
  void close()
    .then(() => db.close())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});

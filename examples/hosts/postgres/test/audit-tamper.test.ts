/**
 * Host-internal tamper-detection test for the Postgres host's audit-log
 * integrity profile. Mirrors `examples/hosts/sqlite/test/audit-tamper.test.ts`.
 *
 * Why this lives here and not in the conformance suite:
 *   The black-box conformance suite (`audit-log-integrity.test.ts`) cannot
 *   mutate the host's audit store — by design, the profile's threat model
 *   assumes admin access is required to tamper. So conformance covers the
 *   chainValid happy path; this host-internal test covers the tamper-
 *   detection negative path against the same logic running on Postgres
 *   instead of SQLite.
 *
 * Run with: tsx test/audit-tamper.test.ts.
 *
 * @see spec/v1/auth-profiles.md §"Audit-log integrity"
 * @see src/audit.ts
 * @see examples/hosts/sqlite/test/audit-tamper.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// Simulate admin-bypass: install the audit schema without the
// append-only triggers so the test can issue UPDATE / DELETE directly.
// Production hosts run with the triggers in place.
process.env.OPENWOP_AUDIT_ALLOW_TAMPER = 'true';

import {
  setupAuditSchema,
  loadOrCreateSigningKey,
  logAudit,
  createCheckpoint,
  verifyAuditChain,
} from '../src/audit.js';
import type { Querier, QueryResult } from '../src/db.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-audit-tamper-'));
try {
  const db = new PGlite('memory://');
  const q = pgliteQuerier(db);
  await setupAuditSchema(q);

  const signingKey = loadOrCreateSigningKey(
    join(workdir, 'audit-signing-key.pem'),
    join(workdir, 'audit-signing-key.pub'),
  );

  // Seed five audit entries.
  for (let i = 1; i <= 5; i++) {
    await logAudit(q, {
      actor: 'system',
      action: 'host.started',
      target: `process-${i}`,
      details: { ordinal: i },
    });
  }
  await createCheckpoint(q, signingKey);

  // Pre-tamper sanity: clean chain + valid checkpoints.
  const cleanResult = await verifyAuditChain(q, 0, 100, signingKey);
  assert.equal(cleanResult.chainValid, true, 'pre-tamper chain MUST be valid');
  assert.equal(cleanResult.checkpointsValid, true, 'pre-tamper checkpoints MUST be valid');
  assert.equal(cleanResult.anomalies.length, 0, 'pre-tamper chain MUST have zero anomalies');
  assert.ok(cleanResult.checkpoints.length >= 1, 'pre-tamper checkpoint MUST be present');
  assert.equal(
    cleanResult.checkpoints[0]?.verified,
    true,
    'pre-tamper checkpoint MUST be marked verified',
  );

  // TAMPER 1: mutate entry seq=3's details in place. Simulates a privileged
  // attacker rewriting a single audit row without touching the chain links.
  await q.query(`UPDATE audit_log SET details_json = $1 WHERE seq = 3`, [
    JSON.stringify({ ordinal: 999, tampered: true }),
  ]);

  const tamperedResult = await verifyAuditChain(q, 0, 100, signingKey);
  assert.equal(tamperedResult.chainValid, false, 'tampered chain MUST report chainValid: false');
  assert.ok(
    tamperedResult.anomalies.length >= 1,
    `tampered chain MUST report ≥1 anomaly; got ${tamperedResult.anomalies.length}`,
  );

  const hashMismatch = tamperedResult.anomalies.find(
    (a) => a.kind === 'hash-mismatch' && a.atSequence === 3,
  );
  assert.ok(
    hashMismatch !== undefined,
    `expected hash-mismatch anomaly at seq=3, got: ${JSON.stringify(tamperedResult.anomalies)}`,
  );
  const chainBreak = tamperedResult.anomalies.find(
    (a) => a.kind === 'chain-break' && a.atSequence === 4,
  );
  assert.ok(
    chainBreak !== undefined,
    `expected chain-break anomaly at seq=4 (downstream of tamper), got: ${JSON.stringify(tamperedResult.anomalies)}`,
  );
  assert.equal(
    tamperedResult.checkpointsValid,
    false,
    'tampered chain MUST flip checkpointsValid to false (merkle root changes when an entry hash changes)',
  );
  const merkleMismatch = tamperedResult.anomalies.find((a) => a.kind === 'merkle-mismatch');
  assert.ok(
    merkleMismatch !== undefined,
    `expected merkle-mismatch anomaly, got: ${JSON.stringify(tamperedResult.anomalies)}`,
  );

  // TAMPER 2: restore the entry so chain is clean, then mutate the
  // checkpoint signature directly. Only the signature is forged.
  await q.query(`UPDATE audit_log SET details_json = $1 WHERE seq = 3`, [
    JSON.stringify({ ordinal: 3 }),
  ]);
  // Replace the first 4 base64 chars of the signature. Use SUBSTRING
  // (Postgres spelling; pglite supports both this and SUBSTR).
  await q.query(
    `UPDATE audit_checkpoints SET signature = 'AAAA' || SUBSTRING(signature FROM 5)`,
  );

  const sigTampered = await verifyAuditChain(q, 0, 100, signingKey);
  assert.equal(
    sigTampered.chainValid,
    true,
    'after entry-restore, chain MUST be valid even with bad checkpoint signature',
  );
  assert.equal(
    sigTampered.checkpointsValid,
    false,
    'forged checkpoint signature MUST flip checkpointsValid to false',
  );
  const sigInvalid = sigTampered.anomalies.find((a) => a.kind === 'signature-invalid');
  assert.ok(
    sigInvalid !== undefined,
    `expected signature-invalid anomaly, got: ${JSON.stringify(sigTampered.anomalies)}`,
  );

  await db.close();

  // Phase 2: storage-layer trigger check. Open a fresh DB WITHOUT the
  // tamper bypass so the append-only triggers install. The trigger
  // function must reject UPDATE and DELETE on audit_log.
  delete process.env.OPENWOP_AUDIT_ALLOW_TAMPER;
  const dbProd = new PGlite('memory://');
  const qProd = pgliteQuerier(dbProd);
  await setupAuditSchema(qProd);
  await logAudit(qProd, {
    actor: 'test',
    action: 'host.started',
    target: 'p',
    details: {},
  });

  let updateRejected = false;
  try {
    await qProd.query(`UPDATE audit_log SET details_json = '{}'::JSONB WHERE seq = 1`);
  } catch (err) {
    updateRejected = (err as Error).message.includes('append-only');
  }
  assert.ok(
    updateRejected,
    'audit_log_no_update trigger MUST reject in-place UPDATEs',
  );

  let deleteRejected = false;
  try {
    await qProd.query(`DELETE FROM audit_log WHERE seq = 1`);
  } catch (err) {
    deleteRejected = (err as Error).message.includes('append-only');
  }
  assert.ok(
    deleteRejected,
    'audit_log_no_delete trigger MUST reject DELETEs',
  );

  await dbProd.close();
  console.log('postgres-host audit-tamper test: PASS');
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

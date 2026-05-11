/**
 * Host-internal tamper-detection test for the audit-log integrity profile.
 *
 * Why this lives here and not in the conformance suite:
 *   The black-box conformance suite (`conformance/src/scenarios/audit-log-
 *   integrity.test.ts`) cannot mutate the host's audit store — by design,
 *   the profile's threat model assumes admin access is required to tamper.
 *   So conformance covers the chainValid happy path; this host-internal
 *   test covers the tamper-detection negative path.
 *
 * Run with: tsx test/audit-tamper.test.ts (or `npm test`).
 *
 * @see spec/v1/auth-profiles.md §"Audit-log integrity"
 * @see src/audit.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  setupAuditSchema,
  loadOrCreateSigningKey,
  logAudit,
  createCheckpoint,
  verifyAuditChain,
} from '../src/audit.js';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-audit-tamper-'));
try {
  const dbPath = join(workdir, 'audit.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  setupAuditSchema(db);

  const signingKey = loadOrCreateSigningKey(
    join(workdir, 'audit-signing-key.pem'),
    join(workdir, 'audit-signing-key.pub'),
  );

  // Seed five audit entries.
  for (let i = 1; i <= 5; i++) {
    logAudit(db, {
      actor: 'system',
      action: 'host.started',
      target: `process-${i}`,
      details: { ordinal: i },
    });
  }
  createCheckpoint(db, signingKey);

  // Verify clean chain WITH signing key (validates checkpoint signature + merkle).
  const cleanResult = verifyAuditChain(db, 0, 100, signingKey);
  assert.equal(cleanResult.chainValid, true, 'pre-tamper chain MUST be valid');
  assert.equal(cleanResult.checkpointsValid, true, 'pre-tamper checkpoints MUST be valid');
  assert.equal(cleanResult.anomalies.length, 0, 'pre-tamper chain MUST have zero anomalies');
  assert.ok(cleanResult.checkpoints.length >= 1, 'pre-tamper checkpoint MUST be present');
  assert.equal(
    cleanResult.checkpoints[0]?.verified,
    true,
    'pre-tamper checkpoint MUST be marked verified',
  );

  // TAMPER 1: mutate entry seq=3's details in place. This simulates a privileged
  // attacker rewriting a single audit row without touching the chain links.
  db.prepare("UPDATE audit_log SET details_json = ? WHERE seq = 3").run(
    JSON.stringify({ ordinal: 999, tampered: true }),
  );

  const tamperedResult = verifyAuditChain(db, 0, 100, signingKey);
  assert.equal(tamperedResult.chainValid, false, 'tampered chain MUST report chainValid: false');
  assert.ok(
    tamperedResult.anomalies.length >= 1,
    `tampered chain MUST report ≥1 anomaly; got ${tamperedResult.anomalies.length}`,
  );

  // Entry-level: hash-mismatch at seq=3 + chain-break at seq=4 (downstream propagation).
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
  // Checkpoint-level: merkle root recomputed from tampered entries no longer
  // matches the stored root, so the checkpoint MUST flip to invalid.
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

  // TAMPER 2: mutate the checkpoint's signature directly. Reset entries first
  // so the entry chain is clean; the only tamper is on audit_checkpoints.
  db.prepare("UPDATE audit_log SET details_json = ? WHERE seq = 3").run(
    JSON.stringify({ ordinal: 3 }),
  );
  db.prepare(
    "UPDATE audit_checkpoints SET signature = 'AAAA' || substr(signature, 5)",
  ).run();

  const sigTampered = verifyAuditChain(db, 0, 100, signingKey);
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

  db.close();
  console.log('audit-tamper test: PASS');
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

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

  // Verify clean chain.
  const cleanResult = verifyAuditChain(db, 0, 100);
  assert.equal(cleanResult.chainValid, true, 'pre-tamper chain MUST be valid');
  assert.equal(cleanResult.anomalies.length, 0, 'pre-tamper chain MUST have zero anomalies');
  assert.ok(cleanResult.checkpoints.length >= 1, 'pre-tamper checkpoint MUST be present');

  // TAMPER: mutate entry seq=3's details in place. This simulates a privileged
  // attacker rewriting a single audit row without touching the chain links.
  db.prepare("UPDATE audit_log SET details_json = ? WHERE seq = 3").run(
    JSON.stringify({ ordinal: 999, tampered: true }),
  );

  const tamperedResult = verifyAuditChain(db, 0, 100);
  assert.equal(tamperedResult.chainValid, false, 'tampered chain MUST report chainValid: false');
  assert.ok(
    tamperedResult.anomalies.length >= 1,
    `tampered chain MUST report ≥1 anomaly; got ${tamperedResult.anomalies.length}`,
  );

  // The mutated entry should appear as a hash-mismatch anomaly at seq=3.
  const hashMismatch = tamperedResult.anomalies.find(
    (a) => a.kind === 'hash-mismatch' && a.atSequence === 3,
  );
  assert.ok(
    hashMismatch !== undefined,
    `expected hash-mismatch anomaly at seq=3, got: ${JSON.stringify(tamperedResult.anomalies)}`,
  );

  // Entries AFTER the tampered row should also flag chain-break (because
  // seq=3's recomputed hash no longer matches what seq=4's prev_hash points to).
  const chainBreak = tamperedResult.anomalies.find(
    (a) => a.kind === 'chain-break' && a.atSequence === 4,
  );
  assert.ok(
    chainBreak !== undefined,
    `expected chain-break anomaly at seq=4 (downstream of tamper), got: ${JSON.stringify(tamperedResult.anomalies)}`,
  );

  db.close();
  console.log('audit-tamper test: PASS');
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

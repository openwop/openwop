/**
 * CF-11 — cross-host audit checkpoint export + re-anchor verifier
 * smoke per plans/openwop-protocol-gap-closure-plan.md Workstream 2.
 *
 * Boots the Postgres reference host with PGlite, generates audit
 * entries + a checkpoint, exports the checkpoints via
 * `exportAuditCheckpoints`, writes the export to a tmp file, then
 * invokes the out-of-band verifier at
 * `scripts/verify-audit-checkpoints.mjs` and asserts a clean exit.
 *
 * Negative paths:
 *   - Bundle with a tampered checkpoint signature → verifier exits 1
 *     with "DOES NOT verify".
 *   - Bundle with non-monotonic atSequence → verifier exits 1 with
 *     "not strictly increasing".
 *
 * @see examples/hosts/postgres/src/audit-export.ts
 * @see scripts/verify-audit-checkpoints.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-cp-export-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

const { setupAuditSchema, loadOrCreateSigningKey, logAudit, createCheckpoint, defaultAuditOptions } =
  await import('../src/audit.js');
const { exportAuditCheckpoints } = await import('../src/audit-export.js');

type Querier = {
  query<T>(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rows: T[]; rowCount: number }>;
};

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []) {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const VERIFIER = join(REPO_ROOT, 'scripts', 'verify-audit-checkpoints.mjs');

function runVerifier(bundlePath: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [VERIFIER, bundlePath], { encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  const q = pgliteQuerier(db);
  await setupAuditSchema(q);
  const signingKey = loadOrCreateSigningKey(
    join(workdir, 'audit.private.pem'),
    join(workdir, 'audit.public.pem'),
  );

  // 1. Plant a handful of audit entries.
  for (let i = 0; i < 5; i++) {
    await logAudit(q, {
      type: 'test.event',
      actor: 'tenant:default',
      action: `event-${i}`,
      target: 'cp-export-smoke',
      details: { i },
    });
  }

  // 2. Create a checkpoint over the entries.
  const cp1 = await createCheckpoint(q, signingKey);
  assert.ok(cp1, 'expected a checkpoint to be created');
  assert.equal(cp1!.signing_key_id, signingKey.keyId);

  // 3. Plant more entries + another checkpoint.
  for (let i = 5; i < 10; i++) {
    await logAudit(q, {
      type: 'test.event',
      actor: 'tenant:default',
      action: `event-${i}`,
      target: 'cp-export-smoke',
      details: { i },
    });
  }
  const cp2 = await createCheckpoint(q, signingKey);
  assert.ok(cp2);

  // 4. Export.
  const exportDoc = await exportAuditCheckpoints(q, signingKey, {
    name: 'openwop-host-postgres-conformance',
    version: '1.1.2',
  });
  assert.equal(exportDoc.bundleVersion, '1');
  assert.equal(exportDoc.checkpoints.length, 2);
  assert.equal(exportDoc.signingKey.algorithm, 'ed25519');
  assert.ok(exportDoc.signingKey.publicKeyPEM.startsWith('-----BEGIN PUBLIC KEY-----'));

  // 5. Write to a tmp file + invoke verifier (positive path).
  const bundlePath = join(workdir, 'audit-checkpoint-export.json');
  writeFileSync(bundlePath, JSON.stringify(exportDoc, null, 2));
  const positive = runVerifier(bundlePath);
  if (positive.status !== 0) {
    console.error('positive-path verifier output:');
    console.error(positive.stdout);
    console.error(positive.stderr);
  }
  assert.equal(positive.status, 0, 'positive path MUST exit 0');
  assert.ok(
    positive.stdout.includes('all 2 checkpoints verify'),
    `expected 'all 2 checkpoints verify' in stdout, got: ${positive.stdout}`,
  );

  // 6. Negative path A — tampered signature.
  const tampered = JSON.parse(JSON.stringify(exportDoc)) as typeof exportDoc;
  const tBuf = Buffer.from(tampered.checkpoints[0]!.signature, 'base64');
  tBuf[0] ^= 0xff;
  (tampered.checkpoints[0] as unknown as { signature: string }).signature = tBuf.toString('base64');
  const tamperedPath = join(workdir, 'tampered-sig.json');
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  const tamperedRun = runVerifier(tamperedPath);
  assert.equal(tamperedRun.status, 1, 'tampered-signature path MUST exit 1');
  assert.ok(
    tamperedRun.stderr.includes('DOES NOT verify'),
    `expected 'DOES NOT verify' in stderr, got: ${tamperedRun.stderr}`,
  );

  // 7. Negative path B — non-monotonic atSequence (reverse the array).
  const reordered = JSON.parse(JSON.stringify(exportDoc)) as typeof exportDoc;
  (reordered as unknown as { checkpoints: ExportedCheckpoint[] }).checkpoints = [
    ...reordered.checkpoints,
  ].reverse();
  const reorderedPath = join(workdir, 'reordered.json');
  writeFileSync(reorderedPath, JSON.stringify(reordered));
  const reorderedRun = runVerifier(reorderedPath);
  assert.equal(reorderedRun.status, 1, 'non-monotonic atSequence path MUST exit 1');
  assert.ok(
    reorderedRun.stderr.includes('not strictly increasing'),
    `expected 'not strictly increasing' in stderr, got: ${reorderedRun.stderr}`,
  );

  console.log('ok audit-checkpoint-export — 7 paths verified (positive + tampered-sig + non-monotonic)');
}

interface ExportedCheckpoint {
  checkpointId: string;
  atSequence: number;
  merkleRoot: string;
  signature: string;
  signedAt: string;
  signingKeyId: string;
}

void defaultAuditOptions; // keep import used (silence unused warning)

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    rmSync(workdir, { recursive: true, force: true });
  });


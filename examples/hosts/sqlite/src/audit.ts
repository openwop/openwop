/**
 * Audit-log integrity profile for the SQLite reference host.
 *
 * Implements the `openwop-audit-log-integrity` profile defined in
 * `spec/v1/auth-profiles.md` §"Audit-log integrity":
 *
 *   1. Append-only audit-log table — no in-place updates / deletes.
 *   2. Hash chain — each entry carries `prevHash` (SHA-256 of the prior
 *      entry's canonical-JSON serialization). Genesis entry has prevHash=null.
 *   3. Periodic anchoring — Ed25519-signed checkpoints over a merkle root
 *      of entries since the prior checkpoint. Default: every 1000 entries
 *      or every 300s, whichever is sooner.
 *   4. Verification endpoint — `GET /v1/audit/verify?fromSeq=&toSeq=` walks
 *      the chain and returns {chainValid, checkpoints, anomalies}.
 *
 * Reference-only properties:
 *   - Single signing key persisted to disk alongside the DB. A real host
 *     would manage rotation via the operator's KMS / HSM.
 *   - Checkpoint export to an out-of-band store (RECOMMENDED per the spec)
 *     is left to the operator — this module surfaces signed checkpoints
 *     via the verify endpoint only.
 *   - Tamper detection: the verify endpoint re-walks the chain and reports
 *     anomalies, but the spec deliberately requires admin access to the
 *     audit store to mutate entries. Conformance covers the chainValid
 *     happy path; tamper detection is exercised by the host-internal test
 *     in `test/audit-tamper.test.ts`.
 *
 * @see spec/v1/auth-profiles.md §"Audit-log integrity"
 * @see conformance/src/scenarios/audit-log-integrity.test.ts
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

// Per spec §"Audit-log integrity" — RECOMMENDED defaults.
const DEFAULT_CHECKPOINT_INTERVAL_ENTRIES = 1000;
const DEFAULT_CHECKPOINT_INTERVAL_SECONDS = 300;

export interface AuditEntryInput {
  /** Actor identifier — e.g., "tenant:default", "system", or a user/principal id. */
  readonly actor: string;
  /** Dotted action vocabulary — e.g., "run.create", "run.cancel", "audit.verify". */
  readonly action: string;
  /** Target of the action — typically the runId, artifactId, etc. */
  readonly target: string;
  /** Action-specific metadata, redacted of secrets. */
  readonly details: Record<string, unknown>;
}

interface AuditEntryRow {
  readonly seq: number;
  readonly occurred_at: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly details_json: string;
  readonly prev_hash: string | null;
  readonly entry_hash: string;
}

interface CheckpointRow {
  readonly checkpoint_id: string;
  readonly at_sequence: number;
  readonly merkle_root: string;
  readonly signature: string;
  readonly signed_at: string;
  readonly signing_key_id: string;
}

export interface VerifyResult {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly chainValid: boolean;
  readonly checkpoints: Array<{
    readonly checkpoint: string;
    readonly atSequence: number;
    readonly merkleRoot: string;
    readonly signature: string;
  }>;
  readonly anomalies: Array<{
    readonly atSequence: number;
    readonly kind: 'hash-mismatch' | 'chain-break' | 'missing-entry';
    readonly detail: string;
  }>;
}

export interface SigningKey {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  /** Base64-encoded DER (SPKI) of the public key — what we put in capabilities. */
  readonly publicKeyB64: string;
  /** PEM-encoded public key for human-readable export. */
  readonly publicKeyPEM: string;
}

export interface AuditOptions {
  readonly checkpointIntervalEntries: number;
  readonly checkpointIntervalSeconds: number;
}

/**
 * Canonical JSON serialization with recursively-sorted keys. Minimal RFC
 * 8785 JCS approximation — enough for stable hashing inside this host.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  const obj = value as Record<string, unknown>;
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Compute the canonical hash of an audit entry. Hash domain matches the
 * verify endpoint's re-walk computation exactly.
 */
function entryHash(input: {
  seq: number;
  occurredAt: string;
  actor: string;
  action: string;
  target: string;
  details: unknown;
  prevHash: string | null;
}): string {
  return sha256Hex(
    canonicalize({
      action: input.action,
      actor: input.actor,
      atSequence: input.seq,
      details: input.details,
      occurredAt: input.occurredAt,
      prevHash: input.prevHash,
      target: input.target,
    }),
  );
}

/**
 * Pairwise merkle root over an ordered list of leaf hashes. Empty list →
 * SHA-256 of empty string. Odd nodes at any level get promoted (single-
 * child node passes its hash up unchanged).
 */
function merkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) return sha256Hex('');
  let level = leafHashes.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right === undefined ? left : sha256Hex(left + right));
    }
    level = next;
  }
  return level[0]!;
}

export function setupAuditSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details_json TEXT NOT NULL,
      prev_hash TEXT,
      entry_hash TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS audit_checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      at_sequence INTEGER NOT NULL,
      merkle_root TEXT NOT NULL,
      signature TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      signing_key_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checkpoints_seq ON audit_checkpoints(at_sequence);
  `);
}

/**
 * Load the host's audit-signing keypair from disk; generate + persist on
 * first call. The private key file is created with permissions 0600 so a
 * world-readable filesystem doesn't leak it.
 */
export function loadOrCreateSigningKey(privateKeyPath: string, publicKeyPath: string): SigningKey {
  let privatePem: string;
  let publicPem: string;
  let keyId: string;

  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    privatePem = readFileSync(privateKeyPath, 'utf8');
    publicPem = readFileSync(publicKeyPath, 'utf8');
    keyId = sha256Hex(publicPem).slice(0, 16);
  } else {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    publicPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    keyId = sha256Hex(publicPem).slice(0, 16);
    writeFileSync(privateKeyPath, privatePem, { mode: 0o600 });
    writeFileSync(publicKeyPath, publicPem, { mode: 0o644 });
  }

  const privateKey = createPrivateKey(privatePem);
  const publicKey = createPublicKey(publicPem);
  const publicKeyB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { keyId, privateKey, publicKey, publicKeyB64, publicKeyPEM: publicPem };
}

/**
 * Append an audit entry. Hash chain is computed in-transaction so a
 * concurrent writer can't interleave between prev-hash read and insert.
 */
export function logAudit(
  db: Database.Database,
  input: AuditEntryInput,
): { seq: number; entryHash: string } {
  const occurredAt = new Date().toISOString();
  const detailsJson = canonicalize(input.details);
  const tx = db.transaction(() => {
    const prior = db
      .prepare('SELECT seq, entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1')
      .get() as { seq: number; entry_hash: string } | undefined;
    const prevHash = prior?.entry_hash ?? null;
    const seq = (prior?.seq ?? 0) + 1;
    const hash = entryHash({
      seq,
      occurredAt,
      actor: input.actor,
      action: input.action,
      target: input.target,
      details: input.details,
      prevHash,
    });
    db.prepare(
      `INSERT INTO audit_log (seq, occurred_at, actor, action, target, details_json, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(seq, occurredAt, input.actor, input.action, input.target, detailsJson, prevHash, hash);
    return { seq, entryHash: hash };
  });
  return tx();
}

/**
 * Create a checkpoint over entries since the prior checkpoint. Idempotent:
 * if called with no new entries since the last checkpoint, returns null.
 */
export function createCheckpoint(
  db: Database.Database,
  signingKey: SigningKey,
): CheckpointRow | null {
  const last = db
    .prepare('SELECT at_sequence FROM audit_checkpoints ORDER BY at_sequence DESC LIMIT 1')
    .get() as { at_sequence: number } | undefined;
  const fromSeq = (last?.at_sequence ?? 0) + 1;
  const tip = db.prepare('SELECT MAX(seq) as max FROM audit_log').get() as { max: number | null };
  const toSeq = tip.max ?? 0;
  if (toSeq < fromSeq) return null;

  const entries = db
    .prepare('SELECT entry_hash FROM audit_log WHERE seq BETWEEN ? AND ? ORDER BY seq ASC')
    .all(fromSeq, toSeq) as Array<{ entry_hash: string }>;
  const root = merkleRoot(entries.map((e) => e.entry_hash));

  const signature = sign(null, Buffer.from(root, 'hex'), signingKey.privateKey).toString('base64');
  const checkpointId = `cp-${randomUUID()}`;
  const signedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO audit_checkpoints (checkpoint_id, at_sequence, merkle_root, signature, signed_at, signing_key_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(checkpointId, toSeq, root, signature, signedAt, signingKey.keyId);

  return {
    checkpoint_id: checkpointId,
    at_sequence: toSeq,
    merkle_root: root,
    signature,
    signed_at: signedAt,
    signing_key_id: signingKey.keyId,
  };
}

/**
 * Trigger a checkpoint if either threshold is reached. Cheap to call on
 * every audit write; the DB queries are indexed.
 */
export function triggerCheckpointIfDue(
  db: Database.Database,
  signingKey: SigningKey,
  opts: AuditOptions,
): CheckpointRow | null {
  const last = db
    .prepare(
      'SELECT at_sequence, signed_at FROM audit_checkpoints ORDER BY at_sequence DESC LIMIT 1',
    )
    .get() as { at_sequence: number; signed_at: string } | undefined;
  const tip = db.prepare('SELECT MAX(seq) as max FROM audit_log').get() as { max: number | null };
  const tipSeq = tip.max ?? 0;
  if (tipSeq === 0) return null;

  const entriesSince = tipSeq - (last?.at_sequence ?? 0);
  const secondsSince = last
    ? (Date.now() - new Date(last.signed_at).getTime()) / 1000
    : Number.POSITIVE_INFINITY;

  if (entriesSince >= opts.checkpointIntervalEntries || secondsSince >= opts.checkpointIntervalSeconds) {
    return createCheckpoint(db, signingKey);
  }
  return null;
}

/**
 * Re-walk the chain and return verification result. The fromSeq/toSeq
 * range is clamped to the actual audit-log range — out-of-bounds requests
 * return what's available rather than an error, so a fresh host returns
 * an empty-but-valid chain instead of 404'ing.
 */
export function verifyAuditChain(
  db: Database.Database,
  fromSeq: number,
  toSeq: number,
): VerifyResult {
  const tip = db.prepare('SELECT MAX(seq) as max FROM audit_log').get() as { max: number | null };
  const tipSeq = tip.max ?? 0;
  const lo = Math.max(1, fromSeq);
  const hi = Math.min(toSeq, tipSeq);

  const anomalies: VerifyResult['anomalies'] = [];

  if (hi < lo) {
    // Empty range — vacuously valid.
    return { fromSeq: lo, toSeq: hi, chainValid: true, checkpoints: [], anomalies };
  }

  const rows = db
    .prepare('SELECT * FROM audit_log WHERE seq BETWEEN ? AND ? ORDER BY seq ASC')
    .all(lo, hi) as AuditEntryRow[];

  // Anchor: if lo > 1, fetch the prior entry's hash to seed prev_hash check.
  let expectedPrev: string | null = null;
  if (lo > 1) {
    const prior = db
      .prepare('SELECT entry_hash FROM audit_log WHERE seq = ?')
      .get(lo - 1) as { entry_hash: string } | undefined;
    expectedPrev = prior?.entry_hash ?? null;
  }

  let chainValid = true;
  let expectedSeq = lo;
  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      anomalies.push({
        atSequence: expectedSeq,
        kind: 'missing-entry',
        detail: `expected seq ${expectedSeq}, found ${row.seq}`,
      });
      chainValid = false;
      expectedSeq = row.seq;
    }
    if (row.prev_hash !== expectedPrev) {
      anomalies.push({
        atSequence: row.seq,
        kind: 'chain-break',
        detail: `prev_hash ${row.prev_hash} does not match prior entry hash ${expectedPrev}`,
      });
      chainValid = false;
    }
    const details: unknown = JSON.parse(row.details_json);
    const recomputed = entryHash({
      seq: row.seq,
      occurredAt: row.occurred_at,
      actor: row.actor,
      action: row.action,
      target: row.target,
      details,
      prevHash: row.prev_hash,
    });
    if (recomputed !== row.entry_hash) {
      anomalies.push({
        atSequence: row.seq,
        kind: 'hash-mismatch',
        detail: `recomputed ${recomputed} != stored ${row.entry_hash}`,
      });
      chainValid = false;
    }
    // Advance using the RECOMPUTED hash so downstream entries surface a
    // chain-break when an upstream entry was tampered with in place.
    expectedPrev = recomputed;
    expectedSeq = row.seq + 1;
  }

  const checkpoints = db
    .prepare(
      'SELECT * FROM audit_checkpoints WHERE at_sequence BETWEEN ? AND ? ORDER BY at_sequence ASC',
    )
    .all(lo, hi) as CheckpointRow[];

  return {
    fromSeq: lo,
    toSeq: hi,
    chainValid,
    checkpoints: checkpoints.map((c) => ({
      checkpoint: c.checkpoint_id,
      atSequence: c.at_sequence,
      merkleRoot: c.merkle_root,
      signature: c.signature,
    })),
    anomalies,
  };
}

/** Reasonable defaults for a reference host running fast conformance scenarios. */
export function defaultAuditOptions(): AuditOptions {
  return {
    checkpointIntervalEntries: Number(
      process.env.OPENWOP_AUDIT_CHECKPOINT_ENTRIES ?? DEFAULT_CHECKPOINT_INTERVAL_ENTRIES,
    ),
    checkpointIntervalSeconds: Number(
      process.env.OPENWOP_AUDIT_CHECKPOINT_SECONDS ?? DEFAULT_CHECKPOINT_INTERVAL_SECONDS,
    ),
  };
}

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

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
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
  /** Chain-level integrity: every entry's recomputed hash matches the stored entry_hash AND prev_hash links resolve. */
  readonly chainValid: boolean;
  /** Checkpoint integrity: every checkpoint's stored merkle_root matches a recomputation over its entry range AND its Ed25519 signature verifies. */
  readonly checkpointsValid: boolean;
  readonly checkpoints: Array<{
    readonly checkpoint: string;
    readonly atSequence: number;
    readonly merkleRoot: string;
    readonly signature: string;
    /** Per-checkpoint verification result — `null` when no signing key was passed to the verifier. */
    readonly verified: boolean | null;
  }>;
  readonly anomalies: Array<{
    readonly atSequence: number;
    readonly kind:
      | 'hash-mismatch'
      | 'chain-break'
      | 'missing-entry'
      | 'merkle-mismatch'
      | 'signature-invalid';
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
 *
 * What it does:
 *   - Sorts object keys lexicographically at every nesting level.
 *   - Delegates value serialization to `JSON.stringify`, which handles
 *     UTF-8, escape sequences, and the standard primitive shapes.
 *
 * What it doesn't (vs strict RFC 8785):
 *   - `-0` round-trips as `0` (JSON has no negative-zero distinction).
 *   - `NaN` / `Infinity` are not valid JSON; `JSON.stringify` would emit
 *     `null` and the audit entry's `details` MUST NOT contain them in
 *     the first place. Loggers SHOULD filter or substitute upstream.
 *   - Unicode normalization is not applied — strings are hashed as-is.
 *     Audit-log entry sources are host-controlled (no user-submitted
 *     text in the canonical entry shape), so NFC normalization isn't
 *     required for hash stability across replays in this host.
 *   - Number formatting follows V8's IEEE-754 round-trip; differs from
 *     strict JCS for some edge cases (e.g., `1e21`). Not exercised by
 *     the reference host's audit-entry shape.
 *
 * Strict RFC 8785 conformance is an open follow-up for hosts that need
 * cross-implementation hash compatibility with verifiers running in
 * different language ecosystems.
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

  // Storage-layer enforcement of append-only (auth-profiles.md
  // §"Audit-log integrity" §1). The verify endpoint catches in-place
  // tampering after the fact; these triggers reject the mutation at
  // the storage layer so even an admin with raw DB access has to
  // explicitly disable the trigger first (which itself is a detectable
  // signal). Set OPENWOP_AUDIT_ALLOW_TAMPER=true to skip the trigger
  // installation when running host-internal tamper-detection tests
  // that need to simulate a bypass.
  if (process.env.OPENWOP_AUDIT_ALLOW_TAMPER !== 'true') {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS audit_log_no_update
        BEFORE UPDATE ON audit_log
      BEGIN
        SELECT RAISE(FAIL, 'audit_log is append-only (auth-profiles.md §"Audit-log integrity")');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
        BEFORE DELETE ON audit_log
      BEGIN
        SELECT RAISE(FAIL, 'audit_log is append-only (auth-profiles.md §"Audit-log integrity")');
      END;
    `);
  }
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
 *
 * Single-process invariant: better-sqlite3 serializes transactions
 * within one Node process, so two `logAudit` calls in the same process
 * never observe the same prior tip. Multi-process operation (planned
 * for the Phase 2 Postgres-backed host) would need an atomic sequence
 * primitive — either a Postgres SEQUENCE or a SELECT … FOR UPDATE on
 * a `audit_seq` row — to retain the same guarantee. The PK + UNIQUE
 * constraints on `seq` and `entry_hash` cause a second-writer INSERT
 * to fail loudly rather than silently corrupt the chain, but graceful
 * retry under contention is not implemented here.
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
 *
 * When `signingKey` is provided, each checkpoint's stored merkle_root is
 * recomputed from the entry range and its Ed25519 signature is verified.
 * Mismatches surface as `merkle-mismatch` / `signature-invalid` anomalies
 * and flip `checkpointsValid` to false. Callers that pass `null` get
 * chain-level verification only (and `checkpointsValid: true` vacuously
 * when no checkpoints are present in range).
 */
export function verifyAuditChain(
  db: Database.Database,
  fromSeq: number,
  toSeq: number,
  signingKey: SigningKey | null = null,
): VerifyResult {
  const tip = db.prepare('SELECT MAX(seq) as max FROM audit_log').get() as { max: number | null };
  const tipSeq = tip.max ?? 0;
  const lo = Math.max(1, fromSeq);
  const hi = Math.min(toSeq, tipSeq);

  const anomalies: VerifyResult['anomalies'] = [];

  if (hi < lo) {
    // Empty range — vacuously valid.
    return {
      fromSeq: lo,
      toSeq: hi,
      chainValid: true,
      checkpointsValid: true,
      checkpoints: [],
      anomalies,
    };
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

  // Checkpoints that anchor entries inside the requested range. Each
  // anchors the slice (priorCheckpoint.at_sequence + 1 .. checkpoint.at_sequence).
  const checkpointRows = db
    .prepare(
      'SELECT * FROM audit_checkpoints WHERE at_sequence BETWEEN ? AND ? ORDER BY at_sequence ASC',
    )
    .all(lo, hi) as CheckpointRow[];

  let checkpointsValid = true;
  const verifiedCheckpoints: VerifyResult['checkpoints'] = [];

  for (let i = 0; i < checkpointRows.length; i++) {
    const cp = checkpointRows[i]!;
    const priorCheckpointSeq =
      i > 0
        ? checkpointRows[i - 1]!.at_sequence
        : ((
            db
              .prepare(
                'SELECT at_sequence FROM audit_checkpoints WHERE at_sequence < ? ORDER BY at_sequence DESC LIMIT 1',
              )
              .get(cp.at_sequence) as { at_sequence: number } | undefined
          )?.at_sequence ?? 0);

    // Recompute merkle root over the entries this checkpoint anchors. We
    // re-hash each entry from its CURRENT content (not the stored
    // entry_hash column), so an in-place tamper to details_json surfaces
    // as a merkle-root mismatch even when the row's entry_hash column was
    // not updated to match.
    const anchoredRows = db
      .prepare(
        'SELECT * FROM audit_log WHERE seq BETWEEN ? AND ? ORDER BY seq ASC',
      )
      .all(priorCheckpointSeq + 1, cp.at_sequence) as AuditEntryRow[];
    const anchoredHashes = anchoredRows.map((r) =>
      entryHash({
        seq: r.seq,
        occurredAt: r.occurred_at,
        actor: r.actor,
        action: r.action,
        target: r.target,
        details: JSON.parse(r.details_json),
        prevHash: r.prev_hash,
      }),
    );
    const recomputedRoot = merkleRoot(anchoredHashes);

    let merkleOk = true;
    let signatureOk: boolean | null = null;

    if (recomputedRoot !== cp.merkle_root) {
      anomalies.push({
        atSequence: cp.at_sequence,
        kind: 'merkle-mismatch',
        detail: `recomputed merkle root ${recomputedRoot} != stored ${cp.merkle_root}`,
      });
      merkleOk = false;
      checkpointsValid = false;
    }

    if (signingKey) {
      try {
        signatureOk = verify(
          null,
          Buffer.from(cp.merkle_root, 'hex'),
          signingKey.publicKey,
          Buffer.from(cp.signature, 'base64'),
        );
      } catch {
        signatureOk = false;
      }
      if (!signatureOk) {
        anomalies.push({
          atSequence: cp.at_sequence,
          kind: 'signature-invalid',
          detail: `Ed25519 signature does not verify under signing key ${signingKey.keyId}`,
        });
        checkpointsValid = false;
      }
    }

    verifiedCheckpoints.push({
      checkpoint: cp.checkpoint_id,
      atSequence: cp.at_sequence,
      merkleRoot: cp.merkle_root,
      signature: cp.signature,
      verified: signingKey === null ? null : merkleOk && signatureOk === true,
    });
  }

  return {
    fromSeq: lo,
    toSeq: hi,
    chainValid,
    checkpointsValid,
    checkpoints: verifiedCheckpoints,
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

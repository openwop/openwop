/**
 * Audit-log integrity profile for the Postgres reference host.
 *
 * Mirrors the SQLite host's `audit.ts` (see `examples/hosts/sqlite/src/audit.ts`)
 * with three Postgres-specific translations:
 *
 *   1. Async everywhere — the Querier interface is async-only, so every
 *      function that touches the DB becomes async.
 *   2. Atomic seq allocation via a sentinel row, not via single-process
 *      transactional read-then-insert. Postgres can serve multiple
 *      connections concurrently (pg.Pool, multi-process deployers), so
 *      the SQLite "better-sqlite3 in-process serialization" guarantee
 *      doesn't transfer. We use the same UPDATE…RETURNING pattern as
 *      `runs.next_event_seq` in server.ts: a single `audit_seq` row
 *      whose update locks the row for the duration of the writer's
 *      transaction, giving each writer a distinct seq.
 *   3. Append-only triggers expressed in plpgsql, not SQLite's
 *      `RAISE(FAIL, ...)` syntax. Functionally identical: BEFORE UPDATE
 *      and BEFORE DELETE handlers raise an exception. Bypass via
 *      OPENWOP_AUDIT_ALLOW_TAMPER=true (same env var as SQLite) skips
 *      trigger creation so the tamper-detection test can simulate a
 *      privileged attacker.
 *
 * Wire surface identical to the SQLite host:
 *   - capabilities.auth.profiles: ['openwop-audit-log-integrity']
 *   - capabilities.auth.auditLogIntegrity.{hashChain, checkpointSignatureAlgorithm,
 *     checkpointPublicKey, checkpointIntervalEntries, checkpointIntervalSeconds}
 *   - GET /v1/audit/verify?fromSeq=&toSeq= returns {chainValid, checkpointsValid,
 *     checkpoints, anomalies}
 *
 * The conformance suite (audit-log-integrity.test.ts) doesn't know it's
 * talking to Postgres vs SQLite — both hosts pass the same scenarios.
 *
 * @see spec/v1/auth-profiles.md §"Audit-log integrity"
 * @see conformance/src/scenarios/audit-log-integrity.test.ts
 * @see examples/hosts/sqlite/src/audit.ts — the reference this mirrors
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, randomUUID, type KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { withTransaction, type Querier } from './db.js';

const DEFAULT_CHECKPOINT_INTERVAL_ENTRIES = 1000;
const DEFAULT_CHECKPOINT_INTERVAL_SECONDS = 300;

export interface AuditEntryInput {
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly details: Record<string, unknown>;
}

interface AuditEntryRow {
  readonly seq: number;
  readonly occurred_at: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly details_json: unknown;
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
  readonly checkpointsValid: boolean;
  readonly checkpoints: Array<{
    readonly checkpoint: string;
    readonly atSequence: number;
    readonly merkleRoot: string;
    readonly signature: string;
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
  readonly publicKeyB64: string;
  readonly publicKeyPEM: string;
}

export interface AuditOptions {
  readonly checkpointIntervalEntries: number;
  readonly checkpointIntervalSeconds: number;
}

/**
 * Canonical JSON with sorted keys. See SQLite host's audit.ts for the
 * full discussion of what this approximates vs strict RFC 8785 JCS
 * (negative-zero, NaN/Infinity, NFC normalization, IEEE-754 number edge
 * cases). The hash domain is internal to the host so cross-language
 * verifier compatibility isn't required at v1.
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

/**
 * Create the four audit tables + (optional) append-only triggers.
 *
 * Tables:
 *   - audit_log:         the append-only entry log (seq, prev_hash, entry_hash, ...)
 *   - audit_checkpoints: Ed25519-signed merkle anchors of entry slices
 *   - audit_seq:         sentinel single-row table that serializes seq
 *                        allocation across concurrent writers (see
 *                        `logAudit` below for the UPDATE…RETURNING pattern)
 *
 * Triggers (unless OPENWOP_AUDIT_ALLOW_TAMPER=true):
 *   - audit_log_no_update / audit_log_no_delete:
 *       plpgsql functions that raise an exception on any UPDATE / DELETE
 *       of audit_log rows. Storage-layer enforcement of the append-only
 *       invariant from auth-profiles.md §"Audit-log integrity" §1.
 *
 * Idempotent — safe to call on every host boot.
 */
export async function setupAuditSchema(q: Querier): Promise<void> {
  await q.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      seq INTEGER PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details_json JSONB NOT NULL,
      prev_hash TEXT,
      entry_hash TEXT NOT NULL UNIQUE
    );
  `);

  await q.query(`
    CREATE TABLE IF NOT EXISTS audit_checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      at_sequence INTEGER NOT NULL,
      merkle_root TEXT NOT NULL,
      signature TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      signing_key_id TEXT NOT NULL
    );
  `);

  await q.query(`CREATE INDEX IF NOT EXISTS idx_checkpoints_seq ON audit_checkpoints(at_sequence);`);

  // Sentinel row for atomic seq allocation. The CHECK (id = 1) constraint
  // prevents accidental insertion of a second row; the COALESCE pattern in
  // logAudit guards against the bootstrap window where the row hasn't been
  // inserted yet.
  await q.query(`
    CREATE TABLE IF NOT EXISTS audit_seq (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_seq INTEGER NOT NULL
    );
  `);
  await q.query(
    `INSERT INTO audit_seq (id, next_seq) VALUES (1, 1) ON CONFLICT (id) DO NOTHING`,
  );

  // Storage-layer append-only enforcement (auth-profiles.md §"Audit-log
  // integrity" §1). Bypass for the host-internal tamper-detection test
  // via OPENWOP_AUDIT_ALLOW_TAMPER=true.
  //
  // Idempotency: Postgres doesn't have CREATE TRIGGER IF NOT EXISTS in
  // versions < 14. We DROP IF EXISTS + CREATE so the install replays
  // cleanly on every boot. The function is CREATE OR REPLACE.
  if (process.env.OPENWOP_AUDIT_ALLOW_TAMPER !== 'true') {
    await q.query(`
      CREATE OR REPLACE FUNCTION audit_log_reject_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only (auth-profiles.md "Audit-log integrity")';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await q.query(`DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;`);
    await q.query(`
      CREATE TRIGGER audit_log_no_update
        BEFORE UPDATE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_reject_modification();
    `);
    await q.query(`DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;`);
    await q.query(`
      CREATE TRIGGER audit_log_no_delete
        BEFORE DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_reject_modification();
    `);
  }
}

/**
 * Load the host's Ed25519 signing keypair from disk; generate + persist on
 * first call. The private-key file is created with permissions 0600.
 *
 * Identical to the SQLite host's implementation — this is filesystem-only
 * and DB-agnostic.
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
 * Append an audit entry. Hash chain computed inside the transaction so
 * a concurrent writer can't interleave between prev-hash read and insert.
 *
 * Multi-writer correctness:
 *   - `UPDATE audit_seq SET next_seq = next_seq + 1 ... RETURNING next_seq - 1`
 *     takes a row-level lock on `audit_seq.id=1` until the transaction
 *     commits. Concurrent writers wait on the lock and each receive a
 *     distinct seq. This is the Postgres-equivalent of better-sqlite3's
 *     in-process serialization, but it works ACROSS connections and
 *     processes (pg.Pool, multiple host instances).
 *   - The prev-hash SELECT happens inside the same transaction. Because
 *     the seq-allocating UPDATE locks `audit_seq` before the SELECT runs,
 *     the prev-hash we read is the actual prior tip — no other writer
 *     can insert between our SELECT and our INSERT.
 *   - The INSERT uses the seq returned by the sentinel update. The
 *     PRIMARY KEY constraint on audit_log.seq + UNIQUE on entry_hash
 *     fail loudly (transaction aborts, caller retries) in the unlikely
 *     event of a sequence-allocator drift.
 */
export async function logAudit(
  q: Querier,
  input: AuditEntryInput,
): Promise<{ seq: number; entryHash: string }> {
  const occurredAt = new Date().toISOString();
  return withTransaction(q, async () => {
    const seqRes = await q.query<{ seq: number }>(
      `UPDATE audit_seq SET next_seq = next_seq + 1
       WHERE id = 1
       RETURNING next_seq - 1 AS seq`,
    );
    if (seqRes.rows.length === 0) {
      throw new Error('logAudit: audit_seq sentinel row missing — was setupAuditSchema called?');
    }
    const seq = Number(seqRes.rows[0]!.seq);

    const priorRes = await q.query<{ entry_hash: string }>(
      'SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1',
    );
    const prevHash = priorRes.rows[0]?.entry_hash ?? null;

    const hash = entryHash({
      seq,
      occurredAt,
      actor: input.actor,
      action: input.action,
      target: input.target,
      details: input.details,
      prevHash,
    });

    await q.query(
      `INSERT INTO audit_log (seq, occurred_at, actor, action, target, details_json, prev_hash, entry_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        seq,
        occurredAt,
        input.actor,
        input.action,
        input.target,
        JSON.stringify(input.details),
        prevHash,
        hash,
      ],
    );

    return { seq, entryHash: hash };
  });
}

/**
 * Create a checkpoint over entries since the prior checkpoint. Idempotent:
 * returns null when no new entries exist since the last checkpoint.
 */
export async function createCheckpoint(
  q: Querier,
  signingKey: SigningKey,
): Promise<CheckpointRow | null> {
  const lastRes = await q.query<{ at_sequence: number }>(
    'SELECT at_sequence FROM audit_checkpoints ORDER BY at_sequence DESC LIMIT 1',
  );
  const fromSeq = (lastRes.rows[0]?.at_sequence ?? 0) + 1;

  const tipRes = await q.query<{ max: number | null }>('SELECT MAX(seq) as max FROM audit_log');
  const toSeq = tipRes.rows[0]?.max ?? 0;
  if (toSeq < fromSeq) return null;

  const entriesRes = await q.query<{ entry_hash: string }>(
    'SELECT entry_hash FROM audit_log WHERE seq BETWEEN $1 AND $2 ORDER BY seq ASC',
    [fromSeq, toSeq],
  );
  const root = merkleRoot(entriesRes.rows.map((e) => e.entry_hash));

  const signature = sign(null, Buffer.from(root, 'hex'), signingKey.privateKey).toString('base64');
  const checkpointId = `cp-${randomUUID()}`;
  const signedAt = new Date().toISOString();

  await q.query(
    `INSERT INTO audit_checkpoints (checkpoint_id, at_sequence, merkle_root, signature, signed_at, signing_key_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [checkpointId, toSeq, root, signature, signedAt, signingKey.keyId],
  );

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
 * every audit write.
 */
export async function triggerCheckpointIfDue(
  q: Querier,
  signingKey: SigningKey,
  opts: AuditOptions,
): Promise<CheckpointRow | null> {
  const lastRes = await q.query<{ at_sequence: number; signed_at: string }>(
    'SELECT at_sequence, signed_at FROM audit_checkpoints ORDER BY at_sequence DESC LIMIT 1',
  );
  const last = lastRes.rows[0];
  const tipRes = await q.query<{ max: number | null }>('SELECT MAX(seq) as max FROM audit_log');
  const tipSeq = tipRes.rows[0]?.max ?? 0;
  if (tipSeq === 0) return null;

  const entriesSince = tipSeq - (last?.at_sequence ?? 0);
  const secondsSince = last
    ? (Date.now() - new Date(last.signed_at).getTime()) / 1000
    : Number.POSITIVE_INFINITY;

  if (
    entriesSince >= opts.checkpointIntervalEntries ||
    secondsSince >= opts.checkpointIntervalSeconds
  ) {
    return createCheckpoint(q, signingKey);
  }
  return null;
}

/**
 * Re-walk the chain and return verification result. fromSeq/toSeq clamped
 * to the actual audit-log range — out-of-bounds requests return what's
 * available rather than 404'ing.
 *
 * When `signingKey` is provided, each checkpoint's stored merkle_root is
 * recomputed from the entry range and its Ed25519 signature is verified.
 * Mismatches surface as merkle-mismatch / signature-invalid anomalies.
 *
 * Note: the merkle re-walk computes each entry's hash from its CURRENT
 * row content, NOT the stored entry_hash column. This is the tamper-
 * detection invariant — an in-place mutation to details_json surfaces as
 * a merkle-mismatch even if the row's entry_hash column wasn't updated.
 */
export async function verifyAuditChain(
  q: Querier,
  fromSeq: number,
  toSeq: number,
  signingKey: SigningKey | null = null,
): Promise<VerifyResult> {
  const tipRes = await q.query<{ max: number | null }>('SELECT MAX(seq) as max FROM audit_log');
  const tipSeq = tipRes.rows[0]?.max ?? 0;
  const lo = Math.max(1, fromSeq);
  const hi = Math.min(toSeq, tipSeq);

  const anomalies: VerifyResult['anomalies'] = [];

  if (hi < lo) {
    return {
      fromSeq: lo,
      toSeq: hi,
      chainValid: true,
      checkpointsValid: true,
      checkpoints: [],
      anomalies,
    };
  }

  const rowsRes = await q.query<AuditEntryRow>(
    'SELECT * FROM audit_log WHERE seq BETWEEN $1 AND $2 ORDER BY seq ASC',
    [lo, hi],
  );
  const rows = rowsRes.rows;

  let expectedPrev: string | null = null;
  if (lo > 1) {
    const priorRes = await q.query<{ entry_hash: string }>(
      'SELECT entry_hash FROM audit_log WHERE seq = $1',
      [lo - 1],
    );
    expectedPrev = priorRes.rows[0]?.entry_hash ?? null;
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
    // pg-types unmarshals JSONB to a JS object. pglite returns the same
    // shape. Either way, `details_json` is already parsed — no JSON.parse.
    const details = row.details_json;
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
    expectedPrev = recomputed;
    expectedSeq = row.seq + 1;
  }

  const cpRes = await q.query<CheckpointRow>(
    'SELECT * FROM audit_checkpoints WHERE at_sequence BETWEEN $1 AND $2 ORDER BY at_sequence ASC',
    [lo, hi],
  );
  const checkpointRows = cpRes.rows;

  let checkpointsValid = true;
  const verifiedCheckpoints: VerifyResult['checkpoints'] = [];

  for (let i = 0; i < checkpointRows.length; i++) {
    const cp = checkpointRows[i]!;
    let priorCheckpointSeq: number;
    if (i > 0) {
      priorCheckpointSeq = checkpointRows[i - 1]!.at_sequence;
    } else {
      const priorRes = await q.query<{ at_sequence: number }>(
        'SELECT at_sequence FROM audit_checkpoints WHERE at_sequence < $1 ORDER BY at_sequence DESC LIMIT 1',
        [cp.at_sequence],
      );
      priorCheckpointSeq = priorRes.rows[0]?.at_sequence ?? 0;
    }

    const anchoredRes = await q.query<AuditEntryRow>(
      'SELECT * FROM audit_log WHERE seq BETWEEN $1 AND $2 ORDER BY seq ASC',
      [priorCheckpointSeq + 1, cp.at_sequence],
    );
    const anchoredHashes = anchoredRes.rows.map((r) =>
      entryHash({
        seq: r.seq,
        occurredAt: r.occurred_at,
        actor: r.actor,
        action: r.action,
        target: r.target,
        details: r.details_json,
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

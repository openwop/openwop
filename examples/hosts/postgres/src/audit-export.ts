/**
 * CF-11 — cross-host audit checkpoint export.
 *
 * Produces a portable JSON document a third party can use to re-anchor
 * a host's audit log against the host's Ed25519 public key, WITHOUT
 * needing access to the host or its database. Honest property: the
 * export is bytes-for-bytes verifiable by anyone who trusts the
 * publisher key.
 *
 * Format:
 *
 *   {
 *     "bundleVersion": "1",
 *     "exportedAt": "2026-05-15T20:00:00Z",
 *     "host": { "name": "...", "version": "..." },
 *     "signingKey": {
 *       "keyId": "<16-hex-prefix-of-pem-sha256>",
 *       "algorithm": "ed25519",
 *       "publicKeyPEM": "-----BEGIN PUBLIC KEY-----\n..."
 *     },
 *     "checkpoints": [
 *       {
 *         "checkpointId": "cp-<uuid>",
 *         "atSequence": <int>,
 *         "merkleRoot": "<hex>",
 *         "signature": "<base64>",
 *         "signedAt": "<iso8601>",
 *         "signingKeyId": "<same as signingKey.keyId>"
 *       },
 *       ...
 *     ]
 *   }
 *
 * The companion verifier `scripts/verify-audit-checkpoints.mjs`
 * consumes this shape directly.
 *
 * @see scripts/verify-audit-checkpoints.mjs
 * @see spec/v1/auth-profiles.md §"openwop-audit-log-integrity"
 */

import type { Querier } from './db.js';
import type { CheckpointRow, SigningKey } from './audit.js';

export interface ExportedCheckpoint {
  readonly checkpointId: string;
  readonly atSequence: number;
  readonly merkleRoot: string;
  readonly signature: string;
  readonly signedAt: string;
  readonly signingKeyId: string;
}

export interface AuditCheckpointExport {
  readonly bundleVersion: '1';
  readonly exportedAt: string;
  readonly host: { readonly name: string; readonly version?: string };
  readonly signingKey: {
    readonly keyId: string;
    readonly algorithm: 'ed25519';
    readonly publicKeyPEM: string;
  };
  readonly checkpoints: ReadonlyArray<ExportedCheckpoint>;
}

/**
 * Dump every audit checkpoint the host has signed, along with the
 * host's Ed25519 public key (PEM). Caller writes the result to disk
 * or pipes it to an external archive — the format is portable.
 *
 * Honest scope: this exports the CHECKPOINTS, not the underlying
 * audit-log entries. A verifier can confirm the checkpoint signatures
 * are valid + the merkle-root chain is consistent, but cannot
 * re-compute the merkle root without the original log entries.
 * Confirming the entries themselves requires either (a) the host's
 * `/v1/audit/verify` endpoint at the time of export OR (b) shipping
 * the entries alongside the checkpoints (out of scope for v1).
 */
export async function exportAuditCheckpoints(
  q: Querier,
  signingKey: SigningKey,
  host: { name: string; version?: string },
): Promise<AuditCheckpointExport> {
  const res = await q.query<CheckpointRow>(
    `SELECT checkpoint_id, at_sequence, merkle_root, signature, signed_at, signing_key_id
       FROM audit_checkpoints
      ORDER BY at_sequence ASC`,
  );

  const checkpoints: ExportedCheckpoint[] = res.rows.map((row) => ({
    checkpointId: row.checkpoint_id,
    atSequence: row.at_sequence,
    merkleRoot: row.merkle_root,
    signature: row.signature,
    signedAt: row.signed_at,
    signingKeyId: row.signing_key_id,
  }));

  return {
    bundleVersion: '1',
    exportedAt: new Date().toISOString(),
    host,
    signingKey: {
      keyId: signingKey.keyId,
      algorithm: 'ed25519',
      publicKeyPEM: signingKey.publicKeyPEM,
    },
    checkpoints,
  };
}

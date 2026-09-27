/**
 * RFC 0218 — the audit checkpoint preimage (`spec/v1/auth-profiles.md`
 * §"Audit-log integrity" 3).
 *
 * A checkpoint anchors the entries with sequence in `(P, atSequence]`, where `P`
 * is the previous checkpoint's `atSequence` (0 for the first). Its leaves are
 * those entries' hashes in sequence order: the lowercase-hex SHA-256 of each
 * entry's RFC 8785 JCS bytes, the same value the next entry carries as
 * `prevHash`. The root is built pairwise, one level at a time. A parent is the
 * SHA-256 of the ASCII bytes of `left ‖ right`, both lowercase hex. A last odd
 * node is promoted unchanged, never duplicated. The signature is Ed25519 over
 * the 32 bytes the root hex-decodes to.
 *
 * There is no leaf/interior domain separation, so a verifier that recomputes a
 * root MUST also hold the leaf count to `atSequence − P`
 * (`checkpointMerkleRoot`'s `expectedLeaves`). With the count fixed the tree
 * shape is fixed, and presenting interior nodes as leaves is refused.
 */

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { canonicalJSON } from './jcs.js';

const HEX64 = /^[0-9a-f]{64}$/;

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The entry hash: lowercase-hex SHA-256 of the entry's RFC 8785 JCS bytes. */
export function auditEntryHash(entry: unknown): string {
  return sha256Hex(canonicalJSON(entry));
}

export class CheckpointPreimageError extends Error {}

/**
 * The checkpoint root over `leaves` (entry hashes in sequence order). Refuses an
 * empty range, a leaf that is not 64 lowercase hex characters, and, when
 * `expectedLeaves` is given, any other count.
 */
export function checkpointMerkleRoot(leaves: readonly string[], expectedLeaves?: number): string {
  if (leaves.length === 0) throw new CheckpointPreimageError('a checkpoint anchors at least one entry');
  if (expectedLeaves !== undefined && leaves.length !== expectedLeaves) {
    throw new CheckpointPreimageError(`expected ${expectedLeaves} leaves (atSequence − P), got ${leaves.length}`);
  }
  for (const l of leaves) if (!HEX64.test(l)) throw new CheckpointPreimageError(`leaf is not 64 lowercase hex: ${JSON.stringify(l)}`);
  let level = leaves.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1];
      next.push(right === undefined ? level[i]! : sha256Hex(level[i]! + right));
    }
    level = next;
  }
  return level[0]!;
}

/**
 * The advertised `checkpointPublicKey` is base64 SPKI DER (`MCowBQYDK2VwAyEA…`).
 * A PEM string is accepted too.
 */
export function checkpointPublicKey(advertised: string): KeyObject {
  if (advertised.startsWith('-----BEGIN')) return createPublicKey(advertised);
  return createPublicKey({ key: Buffer.from(advertised, 'base64'), format: 'der', type: 'spki' });
}

/** Ed25519 over the 32 bytes `merkleRoot` hex-decodes to; `signature` is base64. */
export function verifyCheckpointSignature(merkleRoot: string, signature: string, key: KeyObject): boolean {
  if (!HEX64.test(merkleRoot)) return false;
  const sig = Buffer.from(signature, 'base64');
  if (sig.length !== 64) return false;
  return cryptoVerify(null, Buffer.from(merkleRoot, 'hex'), key, sig);
}

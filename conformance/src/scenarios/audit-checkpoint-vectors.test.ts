/**
 * RFC 0218 — the audit checkpoint preimage, server-free
 * (`spec/v1/auth-profiles.md` §"Audit-log integrity" 3).
 *
 * `conformance/vectors/audit-checkpoint-v1.json` is normative. Every leg
 * RECOMPUTES from the vector input through `lib/audit-checkpoint.ts` and compares
 * with the committed value; none compares two constants from the file. The
 * vectors were produced by an implementation independent of that lib and
 * cross-checked in a second language. Sabotages, each of which turns a leg red:
 * duplicating a last odd node (the 12-sequence checkpoint has 5 leaves); hashing
 * the concatenated DECODED bytes instead of the hex text; ranging leaves over
 * `0..atSequence` instead of `(P, atSequence]`; signing the checkpoint's
 * canonical JSON or the hex text instead of the 32 root bytes; dropping the
 * leaf-count check (the interior-nodes-as-leaves refusal is then accepted).
 *
 * Server-free and always-on; the vectors ship with the conformance package. The
 * black-box half is `audit-checkpoint-signature.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { req } from '../lib/requirement-ids.js';
import {
  auditEntryHash,
  checkpointMerkleRoot,
  checkpointPublicKey,
  verifyCheckpointSignature,
  CheckpointPreimageError,
} from '../lib/audit-checkpoint.js';

interface VectorCheckpoint { atSequence: number; previousAtSequence: number; leafCount: number; merkleRoot: string; signature: string }
interface Refusal { id: string; why: string; leaves: string[]; expectedLeaves: number }
interface SigRefusal { id: string; why: string; merkleRoot: string; signature: string }

const VECTORS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vectors', 'audit-checkpoint-v1.json');
const doc = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as {
  publicKeySpkiBase64: string;
  entries: Array<{ entry: { atSequence: number }; entryHash: string }>;
  checkpoints: VectorCheckpoint[];
  refusals: Refusal[];
  signatureRefusals: SigRefusal[];
};

const SPEC = 'RFC 0218 · spec/v1/auth-profiles.md §"Audit-log integrity" 3';
const VECTORS = 'openwop.requirement.0218.checkpoint-preimage-vectors';

describe('RFC 0218 — the audit checkpoint preimage (vectors)', () => {
  it('the vector set is present and non-trivial', () => {
    // An empty or truncated file would make every leg below vacuous.
    expect(doc.entries.length, req(VECTORS, SPEC, 'the vector file carries entries')).toBeGreaterThanOrEqual(12);
    expect(doc.checkpoints.map((c) => c.leafCount), req(VECTORS, SPEC, 'the checkpoints cover 1, 2, 4 and 5 leaves (odd promotion at 5)')).toEqual([1, 2, 4, 5]);
  });

  it('every entry hash is the SHA-256 of the entry\'s JCS bytes, and chains as prevHash', () => {
    let prev: string | null = null;
    for (const { entry, entryHash } of doc.entries) {
      expect(auditEntryHash(entry), req(VECTORS, SPEC, `entry ${entry.atSequence}: entryHash = SHA-256(JCS(entry))`)).toBe(entryHash);
      expect((entry as { prevHash?: string | null }).prevHash ?? null, req(VECTORS, SPEC, `entry ${entry.atSequence}: prevHash is the previous entry's hash`)).toBe(prev);
      prev = entryHash;
    }
  });

  it('every root is recomputed over (P, atSequence], pairwise, odd node promoted', () => {
    for (const c of doc.checkpoints) {
      const leaves = doc.entries.filter((e) => e.entry.atSequence > c.previousAtSequence && e.entry.atSequence <= c.atSequence).map((e) => e.entryHash);
      expect(checkpointMerkleRoot(leaves, c.atSequence - c.previousAtSequence), req(VECTORS, SPEC, `checkpoint at ${c.atSequence}: merkleRoot`)).toBe(c.merkleRoot);
    }
  });

  it('every signature verifies as Ed25519 over the 32 root bytes', () => {
    const key = checkpointPublicKey(doc.publicKeySpkiBase64);
    for (const c of doc.checkpoints) {
      expect(verifyCheckpointSignature(c.merkleRoot, c.signature, key), req(VECTORS, SPEC, `checkpoint at ${c.atSequence}: signature over the root bytes`)).toBe(true);
    }
  });

  it('refuses a leaf list whose count is not atSequence − P, an uppercase leaf, and an empty range', () => {
    for (const r of doc.refusals) {
      let refused: unknown;
      try { checkpointMerkleRoot(r.leaves, r.expectedLeaves); } catch (e) { refused = e; }
      expect(refused instanceof CheckpointPreimageError, req(VECTORS, SPEC, `${r.id} MUST be refused — ${r.why}`)).toBe(true);
    }
  });

  it('a signature over any other preimage does not verify', () => {
    const key = checkpointPublicKey(doc.publicKeySpkiBase64);
    for (const s of doc.signatureRefusals) {
      expect(verifyCheckpointSignature(s.merkleRoot, s.signature, key), req(VECTORS, SPEC, `${s.id} MUST NOT verify — ${s.why}`)).toBe(false);
    }
  });
});

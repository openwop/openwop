/**
 * RFC 0218 — a host's audit checkpoints are signed over their Merkle root
 * (`spec/v1/auth-profiles.md` §"Audit-log integrity" 3).
 *
 * Gated on the `openwop-audit-log-integrity` profile at major 1 and on the
 * `auditLogIntegrity` family at major 2 (RFC 0224; spec/v2/core/
 * security-defaults.md §Audit-log integrity). Every checkpoint
 * `GET /v1/audit/verify` (major 2: `GET /audit/verify`) returns MUST verify under the advertised
 * `checkpointPublicKey` as Ed25519 over its hex-decoded `merkleRoot`. The root
 * itself cannot be recomputed from outside (the entries are not on the wire),
 * so the black box witnesses the signature half only. The root half belongs to
 * the vectors (`audit-checkpoint-vectors.test.ts`), the host-internal tamper
 * test and the out-of-band verifier. A host with no checkpoint yet records
 * `inapplicable` before any assertion. Sabotage: a host that signs the
 * checkpoint's canonical JSON, or the 64 hex characters, fails the row.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
import { checkpointPublicKey, verifyCheckpointSignature } from '../lib/audit-checkpoint.js';
import { auditClaimName, auditIntegrityAdvert, auditVerifyPath } from '../lib/auditIntegrity.js';

const SPEC = 'RFC 0218 · spec/v1/auth-profiles.md §"Audit-log integrity" 3; spec/v2/core/security-defaults.md §"Audit-log integrity" (RFC 0224)';
const SIGNED = 'openwop.requirement.0218.checkpoint-signature-over-root';

describe('RFC 0218 — a host\'s checkpoints are signed over their root', () => {
  it('every checkpoint GET /v1/audit/verify returns verifies under the advertised key', async () => {
    const integrity = await auditIntegrityAdvert();
    if (integrity === null) {
      return softSkip('inapplicable', `the host does not claim ${auditClaimName()}`);
    }
    const advertised = integrity.checkpointPublicKey;
    if (typeof advertised !== 'string' || advertised.length === 0) {
      // A claimed profile without its key is the profile-shape leg's failure
      // (audit-log-integrity.test.ts); this row cannot be observed without it.
      return softSkip('blocked', `the host claims ${auditClaimName()} but advertises no auditLogIntegrity.checkpointPublicKey`);
    }
    let key;
    try { key = checkpointPublicKey(advertised); } catch (e) {
      return softSkip('blocked', `auditLogIntegrity.checkpointPublicKey is not an Ed25519 SPKI key: ${(e as Error).message}`);
    }

    const path = auditVerifyPath(0, 1_000_000);
    const verify = await driver.get(path);
    if (verify.status !== 200) {
      return softSkip('blocked', `GET ${path.split('?')[0]} answered ${verify.status}; the verify leg of audit-log-integrity owns that contract`);
    }
    const checkpoints = ((verify.json as { checkpoints?: Array<{ atSequence?: number; merkleRoot?: string; signature?: string }> }).checkpoints) ?? [];
    if (checkpoints.length === 0) {
      return softSkip('inapplicable', 'the host has minted no checkpoint yet (its interval has not elapsed)');
    }

    for (const cp of checkpoints) {
      expect(
        verifyCheckpointSignature(String(cp.merkleRoot ?? ''), String(cp.signature ?? ''), key),
        req(SIGNED, SPEC, `checkpoint at ${cp.atSequence}: signature MUST be Ed25519 over the 32 bytes merkleRoot hex-decodes to, under the advertised checkpointPublicKey`),
      ).toBe(true);
    }
  });
});

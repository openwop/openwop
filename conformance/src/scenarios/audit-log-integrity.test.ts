/**
 * Track 13: audit-log integrity profile (auth-profiles.md v1.1), and at major 2
 * the `auditLogIntegrity` family (RFC 0224, spec/v2/core/security-defaults.md
 * §Audit-log integrity).
 *
 * Verifies that hosts claiming audit-log integrity:
 *   1. Advertise the facets a verifier needs — at major 1
 *      `capabilities.auth.auditLogIntegrity.hashChain: true` plus the key; at
 *      major 2 a record that validates against the generated family schema,
 *      whose `checkpointPublicKey` is an Ed25519 SPKI key.
 *   2. Expose `GET /v1/audit/verify` (major 2: `GET /audit/verify`) which
 *      returns `{chainValid, checkpoints, anomalies}`.
 *   3. Report `chainValid: true` for an unmodified range.
 *   4. Surface at least one signed checkpoint with a non-empty `signature`.
 *   5. List checkpoints ascending, no more than `checkpointIntervalEntries`
 *      apart (RFC 0224 §A.3). A host that omits a checkpoint from the verify
 *      body leaves a gap the advertised cadence forbids.
 *
 * Major 1 gates through behaviorGate (strict mode fails an unadvertised
 * profile). Major 2 records `inapplicable` before any assertion when the
 * family is absent — presence of the record is the claim.
 *
 * Tamper detection (mutating an entry then asserting `chainValid: false`)
 * requires admin access to the host's audit store and is NOT exercised
 * by this black-box suite. Hosts SHOULD implement a separate internal
 * test for tamper detection — see auth-profiles.md.
 *
 * @see spec/v1/auth-profiles.md §"Audit-log integrity"
 * @see spec/v2/core/security-defaults.md §"Audit-log integrity"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
import { targetMajor } from '../lib/seams.js';
import { v2RefValidator, v2Validator } from '../lib/v2.js';
import { checkpointPublicKey } from '../lib/audit-checkpoint.js';
import { AUDIT_PROFILE, auditClaimName, auditIntegrityAdvert, auditVerifyPath, type AuditIntegrityCaps } from '../lib/auditIntegrity.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';

/**
 * audit-verify-result.schema.json, CLOSED: every `additionalProperties: false`
 * is enforced. (Until 2026-09-27 the suite stripped them because the reference
 * postgres/sqlite hosts emitted a per-checkpoint `verified` bit the schema does
 * not name; the hosts now keep that bit host-internal. The aggregate verdict is
 * the schema's OPTIONAL `checkpointsValid`.) Major 2 validates against the v2 copy.
 */
const VERIFY_RESULT_SCHEMA = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'audit-verify-result.schema.json'), 'utf8'),
) as Record<string, unknown>;

const CADENCE = 'openwop.requirement.0224.checkpoint-cadence';

/**
 * The gate, per major. Major 1: behaviorGate on the profile (unchanged). Major 2:
 * an absent family is `inapplicable`, recorded before any assertion.
 */
async function gate(): Promise<AuditIntegrityCaps | null> {
  const caps = await auditIntegrityAdvert();
  if (targetMajor() === 2) {
    if (caps === null) softSkip('inapplicable', 'the host does not advertise the auditLogIntegrity family at major 2');
    return caps;
  }
  return behaviorGate(AUDIT_PROFILE, caps !== null) ? caps : null;
}

function validateVerifyBody(body: unknown): { ok: boolean; errors: string } {
  if (targetMajor() === 2) return v2Validator('audit-verify-result')(body);
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(VERIFY_RESULT_SCHEMA);
  const ok = validate(body) as boolean;
  return { ok, errors: JSON.stringify(validate.errors ?? []) };
}

describe('audit-log-integrity: profile shape', () => {
  it('host that claims the profile advertises required capability fields', async () => {
    const integrity = await gate();
    if (integrity === null) return;

    if (targetMajor() === 2) {
      const shape = v2RefValidator('capabilities.schema.json#/properties/auditLogIntegrity')(integrity);
      expect(shape.ok, req('openwop.it.audit-log-integrity.host-that-claims-the-profile-advertises-required-capability-fields',
        'security-defaults.md §"Audit-log integrity"',
        `the auditLogIntegrity record MUST validate against the generated family schema: ${shape.errors}`,
      )).toBe(true);
      let keyOk = true;
      try { checkpointPublicKey(String(integrity.checkpointPublicKey ?? '')); } catch { keyOk = false; }
      expect(keyOk, req('openwop.it.audit-log-integrity.host-that-claims-the-profile-advertises-required-capability-fields',
        'security-defaults.md §"Audit-log integrity"',
        'auditLogIntegrity.checkpointPublicKey MUST be an Ed25519 SubjectPublicKeyInfo, base64',
      )).toBe(true);
      return;
    }

    expect(integrity.hashChain, req('openwop.it.audit-log-integrity.host-that-claims-the-profile-advertises-required-capability-fields', 
      'auth-profiles.md §"Audit-log integrity"',
      "openwop-audit-log-integrity profile MUST advertise auditLogIntegrity.hashChain: true",
    )).toBe(true);
    expect(integrity.checkpointSignatureAlgorithm, req('openwop.it.audit-log-integrity.host-that-claims-the-profile-advertises-required-capability-fields', 
      'auth-profiles.md §"Audit-log integrity" §"Key management"',
      'checkpointSignatureAlgorithm MUST be present (canonical: ed25519)',
    )).toBeDefined();
    expect(typeof integrity.checkpointPublicKey).toBe('string');
  });
});

describe('audit-log-integrity: verify endpoint returns chainValid', () => {
  it('GET /v1/audit/verify on a recent range reports chainValid: true', async () => {
    if ((await gate()) === null) return;

    const path = auditVerifyPath(0, 100);
    const verify = await driver.get(path);
    if (verify.status === 404) {
      // Host claims the profile but doesn't expose the endpoint — that's
      // a profile-claim violation. Fail explicitly.
      expect(verify.status, req('openwop.it.audit-log-integrity.get-v1-audit-verify-on-a-recent-range-reports-chainvalid-true', 
        'auth-profiles.md §"Audit-log integrity" §"Verification endpoint"',
        `claiming ${auditClaimName()} REQUIRES exposing GET ${path.split('?')[0]}`,
      )).not.toBe(404);
      return softSkip('blocked', 'precondition not met — `verify.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(verify.status).toBe(200);

    const body = verify.json as {
      fromSeq?: number;
      toSeq?: number;
      chainValid?: boolean;
      checkpoints?: Array<{ checkpoint?: string; merkleRoot?: string; signature?: string }>;
      anomalies?: unknown[];
    };

    // unfailable-leg audit wave 2, 2026-09-27: a body that OMITTED
    // `checkpoints` (or sent malformed checkpoint objects) passed — the
    // signature check below ran only `if (Array.isArray(body.checkpoints) &&
    // length > 0)`. The body is now validated against
    // audit-verify-result.schema.json (checkpoints[] + anomalies[] required;
    // each checkpoint needs checkpoint/atSequence/merkleRoot/signature).
    const shape = validateVerifyBody(body);
    expect(shape.ok, req('openwop.it.audit-log-integrity.get-v1-audit-verify-on-a-recent-range-reports-chainvalid-true',
      'audit-verify-result.schema.json',
      `GET ${path.split('?')[0]} MUST return the AuditVerifyResult shape: ${shape.errors}`,
    )).toBe(true);

    expect(body.chainValid, req('openwop.it.audit-log-integrity.get-v1-audit-verify-on-a-recent-range-reports-chainvalid-true', 
      'auth-profiles.md §"Audit-log integrity"',
      'unmodified audit range MUST report chainValid: true',
    )).toBe(true);
    expect(Array.isArray(body.anomalies)).toBe(true);
    expect(body.anomalies?.length ?? -1).toBe(0);

    if (Array.isArray(body.checkpoints) && body.checkpoints.length > 0) {
      const cp = body.checkpoints[0];
      expect(typeof cp.signature, req('openwop.it.audit-log-integrity.get-v1-audit-verify-on-a-recent-range-reports-chainvalid-true', 'auth-profiles.md §"Audit-log integrity"', 'checkpoint signature MUST be a non-empty string')).toBe('string');
      expect((cp.signature ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('audit-log-integrity: checkpoints at the advertised cadence', () => {
  it('verify lists every checkpoint ascending, no more than checkpointIntervalEntries apart', async () => {
    const integrity = await gate();
    if (integrity === null) return;
    const every = integrity.checkpointIntervalEntries;
    if (typeof every !== 'number' || !Number.isInteger(every) || every < 1) {
      // Required at major 2 (the shape leg owns that failure); optional at major 1.
      return softSkip(targetMajor() === 2 ? 'blocked' : 'inapplicable', 'checkpointIntervalEntries is not advertised as a positive integer, so no cadence is claimed');
    }
    const verify = await driver.get(auditVerifyPath(0, 1_000_000));
    if (verify.status !== 200) {
      return softSkip('blocked', `the verify endpoint answered ${verify.status}; the verify leg owns that contract`);
    }
    const seqs = (((verify.json as { checkpoints?: Array<{ atSequence?: unknown }> }).checkpoints) ?? []).map((c) => c.atSequence);
    if (seqs.length === 0) {
      return softSkip('inapplicable', 'the host has minted no checkpoint yet, so there is no cadence to observe');
    }
    let prev = 0;
    for (const at of seqs) {
      expect(typeof at === 'number' && Number.isInteger(at), req(CADENCE, 'security-defaults.md §"Audit-log integrity"', 'every checkpoint MUST carry an integer atSequence')).toBe(true);
      const n = at as number;
      expect(n >= prev, req(CADENCE, 'security-defaults.md §"Audit-log integrity"', `checkpoints MUST be listed ascending by atSequence: ${n} follows ${prev}`)).toBe(true);
      expect(n - prev, req(CADENCE, 'security-defaults.md §"Audit-log integrity"',
        `a checkpoint MUST anchor at most checkpointIntervalEntries (${every}) entries: checkpoint at ${n} follows ${prev === 0 ? 'the start of the log' : `the checkpoint at ${prev}`} — a checkpoint is missing from the verify body, or was never minted`,
      )).toBeLessThanOrEqual(every);
      prev = n;
    }
  });
});

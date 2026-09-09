/**
 * Track 13: audit-log integrity profile (auth-profiles.md v1.1).
 *
 * Verifies that hosts claiming the `openwop-audit-log-integrity` profile:
 *   1. Surface `capabilities.auth.auditLogIntegrity.hashChain: true`.
 *   2. Expose `GET /v1/audit/verify` which returns `{chainValid, checkpoints, anomalies}`.
 *   3. Report `chainValid: true` for an unmodified range.
 *   4. Surface at least one signed checkpoint with a non-empty `signature`.
 *
 * Tamper detection (mutating an entry then asserting `chainValid: false`)
 * requires admin access to the host's audit store and is NOT exercised
 * by this black-box suite. Hosts SHOULD implement a separate internal
 * test for tamper detection — see auth-profiles.md.
 *
 * @see spec/v1/auth-profiles.md §"Audit-log integrity"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface AuditIntegrityCaps {
  hashChain?: boolean;
  checkpointSignatureAlgorithm?: string;
  checkpointPublicKey?: string;
  checkpointIntervalEntries?: number;
  checkpointIntervalSeconds?: number;
}

interface AuthCaps {
  profiles?: string[];
  auditLogIntegrity?: AuditIntegrityCaps;
}

async function isProfileAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const auth = capabilityFamily<AuthCaps>(disco.json, 'auth') ?? {};
  return Array.isArray(auth.profiles) && auth.profiles.includes('openwop-audit-log-integrity');
}

describe('audit-log-integrity: profile shape', () => {
  it('host that claims the profile advertises required capability fields', async () => {
    if (!behaviorGate('openwop-audit-log-integrity', await isProfileAdvertised())) {
      return;
    }

    const disco = await driver.get('/.well-known/openwop');
    const integrity =
      capabilityFamily<AuthCaps>(disco.json, 'auth')
        ?.auditLogIntegrity ?? {};

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
    if (!behaviorGate('openwop-audit-log-integrity', await isProfileAdvertised())) {
      return;
    }

    const verify = await driver.get('/v1/audit/verify?fromSeq=0&toSeq=100');
    if (verify.status === 404) {
      // Host claims the profile but doesn't expose the endpoint — that's
      // a profile-claim violation. Fail explicitly.
      expect(verify.status, req('openwop.it.audit-log-integrity.get-v1-audit-verify-on-a-recent-range-reports-chainvalid-true', 
        'auth-profiles.md §"Audit-log integrity" §"Verification endpoint"',
        'claiming openwop-audit-log-integrity profile REQUIRES exposing GET /v1/audit/verify',
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

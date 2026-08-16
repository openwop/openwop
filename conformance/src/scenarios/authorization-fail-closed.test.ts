/**
 * authorization-fail-closed — RFC 0049 §C invariant verification.
 *
 * Status: DRAFT. RFC 0049 (RBAC scopes & authorization decisions) is `Draft`.
 * Backs the SECURITY invariant `authorization-fail-closed`.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.authorization.supported = true`.
 *
 * What this scenario asserts:
 *   1. Advertisement shape — when authorization is supported, `failClosed`
 *      (when present) is exactly `true` (RFC 0049 §C).
 *   2. Fail-closed MUST-NOT — when the host exposes the optional
 *      `POST /v1/host/sample/authorization/decide` test seam, a decision for
 *      a principal with an absent/unseeded role MUST resolve to
 *      `allowed: false`. The host MUST NOT default-allow under any error
 *      condition.
 *
 * Hosts without the seam soft-skip the behavioral probe (404).
 *
 * @see RFCS/0049-rbac-scopes-and-authorization-decisions.md
 * @see SECURITY/invariants.yaml id: authorization-fail-closed
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

interface DiscoveryAuthorization {
  supported?: boolean;
  failClosed?: boolean;
}

interface DiscoveryDoc {
  capabilities?: {
    authorization?: DiscoveryAuthorization;
  };
}

async function readAuthorization(): Promise<DiscoveryAuthorization | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily(body, 'authorization') ?? null;
}

describe('authorization-fail-closed: advertisement shape (RFC 0049 §C)', () => {
  it('failClosed is exactly true when authorization is supported', async () => {
    const authz = await readAuthorization();
    if (!authz?.supported || authz.failClosed === undefined) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!authz?.supported || authz.failClosed === undefined` returned early');
    expect(
      authz.failClosed,
      driver.describe('RFC 0049 §C', 'capabilities.authorization.failClosed MUST be `true`'),
    ).toBe(true);
  });
});

describe('authorization-fail-closed: absent/unseeded role MUST deny (RFC 0049 §C)', () => {
  it('a decision for an unseeded-role principal resolves allowed=false', async () => {
    const authz = await readAuthorization();
    if (!authz?.supported) return softSkip('inapplicable', 'capability-gated');

    // Seam contract: request an authorization decision for a principal whose
    // role is absent/unseeded. The host MUST fail closed.
    const res = await driver.post('/v1/host/sample/authorization/decide', {
      principal: 'conformance-unseeded-principal',
      action: 'runs:cancel',
      resource: 'run-conformance-probe',
    });
    // 404 from a host that hasn't wired the seam is a soft-skip.
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam, prior step, or fixture unavailable)');

    const decision = res.json as { allowed?: boolean } | undefined;
    expect(
      decision?.allowed,
      driver.describe(
        'SECURITY/invariants.yaml authorization-fail-closed',
        'an absent/unseeded role MUST deny (allowed=false); the host MUST NOT default-allow',
      ),
    ).toBe(false);
  });
});

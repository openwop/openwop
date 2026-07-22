/**
 * Anonymous-actor no-secret / no-cross-tenant reach (RFC 0132 §C.2/§C.3) —
 * backs the `anon-actor-no-secret-reach` SECURITY invariant (SR-1 + CTI-1 parity).
 *
 * A `read`-tier tool granted to an anonymous actor MUST be tenant-scoped to the
 * surface's tenant, MUST NOT resolve/return/reach any secret or BYOK credential
 * material, and MUST NOT reach cross-tenant data. A cross-tenant read fails
 * closed (`run_forbidden` / an empty result — never another tenant's data). A
 * planted BYOK canary in the surface tenant's secrets MUST NEVER surface on any
 * observable output of an anon tool call.
 *
 * Capability-gated on `capabilities.anonymousActor.supported`; soft-skips when
 * unadvertised or when the reference seam is unwired (404). Hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. Passing non-vacuously graduates
 * `anon-actor-no-secret-reach` reference-impl → protocol tier.
 *
 * @see RFCS/0132-anonymous-actor-authorization.md §C.2, §C.3
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { driver } from '../lib/driver.js';
import { isAnonymousActorAdvertised, anonDispatch } from '../lib/anonymousActor.js';

const PROFILE = 'openwop-anonymous-actor';

/** The canary the harness expects to be planted in the surface tenant's secrets;
 *  it MUST NOT appear anywhere in an anon tool call's observable output. */
const BYOK_CANARY = 'sk-openwop-anon-canary-DO-NOT-LEAK';

describe('anonymous-actor-no-secret-reach (RFC 0132 §C.2/§C.3)', () => {
  it('a read-tier anon tool call never surfaces a planted BYOK canary', async () => {
    if (!behaviorGate(PROFILE, await isAnonymousActorAdvertised())) return;
    const res = await anonDispatch({ tool: 'catalog.read', args: { probeSecrets: true } });
    if (res.status === 404 || res.status === 405) return; // seam unwired — soft-skip
    const serialized = JSON.stringify(res.json ?? {});
    expect(
      serialized.includes(BYOK_CANARY),
      driver.describe('SECURITY anon-actor-no-secret-reach', 'an anon tool call MUST NOT surface secret/BYOK material'),
    ).toBe(false);
  });

  it('a cross-tenant read fails closed — never another tenant’s data', async () => {
    if (!behaviorGate(PROFILE, await isAnonymousActorAdvertised())) return;
    // Ask a granted read tool to reach a resource in a DIFFERENT tenant.
    const res = await anonDispatch({ tool: 'catalog.read', args: { tenant: 'other-tenant' } });
    if (res.status === 404 || res.status === 405) return; // seam unwired — soft-skip
    const decided = res.json?.authorizationDecided?.payload;
    // Either the authorization decision denies, or the seam returns a fail-closed
    // status with no cross-tenant result — never allowed-with-data.
    const deniedByDecision = decided?.allowed === false;
    const deniedByStatus = res.status === 403 || res.status === 404;
    expect(
      deniedByDecision || deniedByStatus,
      driver.describe('SECURITY anon-actor-no-secret-reach (CTI-1)', 'a cross-tenant anon read MUST fail closed'),
    ).toBe(true);
    expect(
      res.json?.result,
      driver.describe('SECURITY anon-actor-no-secret-reach (CTI-1)', 'a cross-tenant anon read MUST NOT return data'),
    ).toBeUndefined();
  });
});

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
import { isAnonymousActorAdvertised, anonDispatch } from '../lib/anonymousActor.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const PROFILE = 'openwop-anonymous-actor';

/** The canary the harness expects to be planted in the surface tenant's secrets;
 *  it MUST NOT appear anywhere in an anon tool call's observable output. */
const BYOK_CANARY = 'sk-openwop-anon-canary-DO-NOT-LEAK';

describe('anonymous-actor-no-secret-reach (RFC 0132 §C.2/§C.3)', () => {
  it('a read-tier anon tool call never surfaces a planted BYOK canary', async () => {
    if (!behaviorGate(PROFILE, await isAnonymousActorAdvertised())) return;
    const res = await anonDispatch({ tool: 'catalog.read', args: { probeSecrets: true } });
    if (res.status === 404 || res.status === 405) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 405` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    const serialized = JSON.stringify(res.json ?? {});
    expect(
      serialized.includes(BYOK_CANARY),
      req('openwop.it.anonymous-actor-no-secret-reach.a-read-tier-anon-tool-call-never-surfaces-a-planted-byok-canary', 'SECURITY anon-actor-no-secret-reach', 'an anon tool call MUST NOT surface secret/BYOK material'),
    ).toBe(false);
  });

  it('a cross-tenant read fails closed — the caller-supplied tenant is never resolved', async () => {
    if (!behaviorGate(PROFILE, await isAnonymousActorAdvertised())) return;
    // A visitor tries to influence the tenant via tool args. Per RFC 0132 §A.2 the
    // caller MUST NOT be able to supply or influence the anon actor's tenant: a
    // conformant host either DENIES the attempt, or NEUTRALIZES it by scoping to
    // the surface's own tenant — it MUST NOT resolve to the caller-supplied tenant
    // and MUST NOT return that tenant's data. Both outcomes are "fail closed"; the
    // one non-conformant behavior is resolving/returning the caller's tenant.
    const CROSS = 'other-tenant';
    const res = await anonDispatch({ tool: 'catalog.read', args: { tenant: CROSS } });
    if (res.status === 404 || res.status === 405) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 405` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    const decided = res.json?.authorizationDecided?.payload;
    const deniedByDecision = decided?.allowed === false;
    const deniedByStatus = res.status === 403 || res.status === 404;
    // The resolved tenant (owner triple or the decision's `resource`) MUST NOT be
    // the caller-supplied one — the host ignored the attacker-controlled input.
    const resolvedTenant = res.json?.owner?.tenant ?? decided?.resource?.replace(/^tenant:/, '');
    const neutralizedToSurface =
      typeof resolvedTenant === 'string' && resolvedTenant.length > 0 && resolvedTenant !== CROSS;
    expect(
      deniedByDecision || deniedByStatus || neutralizedToSurface,
      req('openwop.it.anonymous-actor-no-secret-reach.a-cross-tenant-read-fails-closed-the-caller-supplied-tenant-is-never-resolved', 
        'SECURITY anon-actor-no-secret-reach (CTI-1 / RFC 0132 §A.2)',
        'a cross-tenant anon read MUST fail closed — denied, or the caller-supplied tenant ignored (never resolved to the caller’s tenant)',
      ),
    ).toBe(true);
    // On the denial path there MUST be no result body; on the neutralized path a
    // result scoped to the SURFACE tenant is fine (it is not cross-tenant data).
    if (deniedByDecision || deniedByStatus) {
      expect(
        res.json?.result,
        req('openwop.it.anonymous-actor-no-secret-reach.a-cross-tenant-read-fails-closed-the-caller-supplied-tenant-is-never-resolved', 'SECURITY anon-actor-no-secret-reach (CTI-1)', 'a denied cross-tenant anon read MUST NOT return data'),
      ).toBeUndefined();
    }
  });
});

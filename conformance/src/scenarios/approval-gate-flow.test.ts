/**
 * approval-gate-flow — RFC 0051 §A behavioral verification.
 *
 * Status: DRAFT. RFC 0051 (approval & deployment-gate primitive) is `Draft`.
 *
 * Capability-gated: the `core.openwop.governance.approvalGate` node requires
 * a host advertising `capabilities.authorization.supported = true`
 * (peerDependency `authorization: 'supported'`). Skips otherwise.
 *
 * What this scenario asserts (via the optional
 * `POST /v1/host/sample/governance/approval-gate` seam):
 *   1. Unauthorized principal — a principal lacking `requiredRole`/`requiredScope`
 *      is denied; the gate does NOT release (fail-closed, RFC 0049 §C).
 *   2. Override is audited — taking the role-gated `override` path returns an
 *      `approval.overridden` event whose `reason` is present.
 *
 * Hosts without the seam soft-skip the behavioral probes (404).
 *
 * @see RFCS/0051-approval-deployment-gate-primitive.md
 * @see spec/v1/interrupt-profiles.md §`core.openwop.governance.approvalGate`
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

async function authorizationSupported(): Promise<boolean> {
  // Root-first per RFC 0073 (`capabilities.authorization` is the deprecated wrapper shape).
  const authz = await readCapabilityFamily<{ supported?: unknown }>('authorization');
  return authz?.supported === true;
}

describe('approval-gate-flow: role-gated, audited approval (RFC 0051 §A)', () => {
  it('an unauthorized principal does NOT release the gate (fail-closed)', async () => {
    if (!(await authorizationSupported())) return softSkip('inapplicable', 'capability-gated');
    const res = await driver.post('/v1/host/sample/governance/approval-gate', {
      scenario: 'unauthorized-grant',
      principal: 'conformance-unauthorized-principal',
    });
    if (res.status === 404) return softSkip('blocked', 'seam unwired — soft-skip');
    const body = res.json as { released?: boolean } | undefined;
    expect(
      body?.released,
      req('openwop.it.approval-gate-flow.an-unauthorized-principal-does-not-release-the-gate-fail-closed', 'RFC 0051 §A', 'an unauthorized principal MUST NOT release the gate (fail-closed)'),
    ).toBe(false);
  });

  it('the override path emits an audited approval.overridden with a reason', async () => {
    if (!(await authorizationSupported())) return softSkip('inapplicable', 'capability-gated');
    const res = await driver.post('/v1/host/sample/governance/approval-gate', {
      scenario: 'override',
      principal: 'conformance-owner-principal',
      reason: 'conformance emergency publish',
    });
    if (res.status === 404) return softSkip('blocked', 'seam unwired — soft-skip');
    const body = res.json as { event?: { type?: string; payload?: { reason?: string } } } | undefined;
    expect(
      body?.event?.type,
      req('openwop.it.approval-gate-flow.the-override-path-emits-an-audited-approval-overridden-with-a-reason', 'RFC 0051 §B', 'taking the override path MUST emit approval.overridden'),
    ).toBe('approval.overridden');
    expect(
      typeof body?.event?.payload?.reason === 'string' && body.event.payload.reason.length > 0,
      req('openwop.it.approval-gate-flow.the-override-path-emits-an-audited-approval-overridden-with-a-reason', 'RFC 0051 §B', 'approval.overridden MUST carry a non-empty reason (the audit breadcrumb)'),
    ).toBe(true);
  });
});

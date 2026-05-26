/**
 * subrun-approval-fail-closed — RFC 0063 §C. A parent that terminates or whose
 * approval interrupt expires WITHOUT an `accept`/`edit-accept` MUST NOT merge the
 * child outputs. Absence of an approval is denial — backs the proposed
 * protocol-tier SECURITY invariant `subrun-merge-approval-fail-closed` (lands
 * with this test promoted to load-bearing at reference-host implementation).
 *
 * Gated on `capabilities.agents.subRunAttestation` + the host sub-run attestation
 * seam; soft-skips when either is absent.
 *
 * @see RFCS/0063-subrun-output-attestation-and-merge-gating.md §C
 * @see SECURITY/invariants.yaml — subrun-merge-approval-fail-closed (lands at impl)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readSubRunAttestationCap, invokeSubRunAttest } from '../lib/subRunAttestation.js';

describe('subrun-approval-fail-closed (RFC 0063 §C)', () => {
  it('no accept/edit-accept (terminated or expired) MUST NOT merge', async () => {
    if ((await readSubRunAttestationCap()) !== true) return;
    // approvalAction omitted models a run that terminated without a response.
    const res = await invokeSubRunAttest({
      childOutputs: { artifact: 'unverified' },
      outputAttestation: { requireApproval: true },
    });
    if (res === null) return; // seam absent — soft-skip
    expect(
      res.merged,
      driver.describe('RFC 0063 §C', 'an unresolved approval MUST fail closed — outputs MUST NOT be merged'),
    ).toBe(false);
  });
});

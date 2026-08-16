/**
 * subrun-approval-gate — RFC 0063 §C. When `requireApproval: true`, the host
 * suspends before merge; `accept` merges the child outputs, `reject` does not.
 *
 * Gated on `capabilities.agents.subRunAttestation` + the host sub-run attestation
 * seam; soft-skips when either is absent.
 *
 * @see RFCS/0063-subrun-output-attestation-and-merge-gating.md §C
 * @see spec/v1/interrupt.md — `approval` kind + resume actions (RFC 0051, reused)
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readSubRunAttestationCap, invokeSubRunAttest } from '../lib/subRunAttestation.js';

describe('subrun-approval-gate (RFC 0063 §C)', () => {
  it('accept merges the child outputs; reject does not', async () => {
    if ((await readSubRunAttestationCap()) !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `(await readSubRunAttestationCap()) !== true` returned early');
    const base = { childOutputs: { artifact: 'x' }, outputAttestation: { requireApproval: true } };

    const accepted = await invokeSubRunAttest({ ...base, approvalAction: 'accept' });
    if (accepted === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      accepted.merged,
      driver.describe('RFC 0063 §C', 'an `accept` approval MUST merge the child outputs'),
    ).toBe(true);

    const rejected = await invokeSubRunAttest({ ...base, approvalAction: 'reject' });
    if (rejected === null) return softSkip('blocked', 'precondition not met — `rejected === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      rejected.merged,
      driver.describe('RFC 0063 §C', 'a `reject` approval MUST NOT merge the child outputs'),
    ).toBe(false);
  });
});

/**
 * subrun-attestation-shape — RFC 0063 §A. The `capabilities.agents.subRunAttestation`
 * advertisement flag is either absent or a boolean.
 *
 * Status: ACTIVE (advertisement-shape; always runs). Behavioral coverage lives
 * in the sibling subrun-*.test.ts scenarios, gated on the flag + the host
 * sub-run attestation seam.
 *
 * @see RFCS/0063-subrun-output-attestation-and-merge-gating.md §A
 * @see spec/v1/node-packs.md §"`outputAttestation` — verify-before-merge"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readSubRunAttestationCap } from '../lib/subRunAttestation.js';

describe('subrun-attestation-shape: advertisement (RFC 0063 §A)', () => {
  it('capabilities.agents.subRunAttestation is absent or a boolean', async () => {
    const cap = await readSubRunAttestationCap();
    // null = unadvertised (no agents block OR flag omitted) — valid.
    if (cap === null) return;
    expect(
      typeof cap,
      driver.describe(
        'capabilities.schema.json §agents.subRunAttestation',
        'agents.subRunAttestation MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

/**
 * subrun-checksum-stable — RFC 0063 §B. A child's output checksum is byte-stable
 * for identical outputs and host-independent (the RFC 8785 JCS + SHA-256 recipe
 * pinned in replay.md), and is surfaced as the `attestation` object on the
 * existing `core.workflowChain.event { phase: 'output.harvested' }`.
 *
 * Gated on `capabilities.agents.subRunAttestation` + the host sub-run attestation
 * seam; soft-skips when either is absent.
 *
 * @see RFCS/0063-subrun-output-attestation-and-merge-gating.md §B
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readSubRunAttestationCap, invokeSubRunAttest } from '../lib/subRunAttestation.js';

describe('subrun-checksum-stable (RFC 0063 §B)', () => {
  it('identical child outputs produce an identical sha256 attestation checksum', async () => {
    if ((await readSubRunAttestationCap()) !== true) return;
    const childOutputs = { report: 'done', score: 0.9, tags: ['a', 'b'] };
    const a = await invokeSubRunAttest({ childOutputs, outputAttestation: { checksum: true } });
    if (a === null) return; // seam absent — soft-skip
    // Key-reordered but value-identical: JCS canonicalization MUST yield the same hash.
    const b = await invokeSubRunAttest({
      childOutputs: { tags: ['a', 'b'], score: 0.9, report: 'done' },
      outputAttestation: { checksum: true },
    });
    if (b === null) return;
    const att = a.attestation ?? {};
    expect(
      typeof att.checksum === 'string' && (att.checksum as string).length > 0,
      driver.describe('RFC 0063 §B', 'output.harvested MUST carry a non-empty attestation.checksum when checksum:true'),
    ).toBe(true);
    expect(
      att.algorithm,
      driver.describe('RFC 0063 §B', 'attestation.algorithm MUST be "sha256" (the v1 recipe)'),
    ).toBe('sha256');
    expect(
      (b.attestation ?? {}).checksum,
      driver.describe('RFC 0063 §B', 'JCS canonicalization MUST make the checksum invariant to key order — same content, same hash'),
    ).toBe(att.checksum);
  });
});

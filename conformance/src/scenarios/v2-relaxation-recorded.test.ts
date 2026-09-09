/**
 * RFC 0173 §A.2 — `relaxation-recorded` (suite 2.0.0, target major 2; unaided).
 *
 * A relaxation is an operator setting recorded in the certification bundle
 * (`host.relaxations[]`, bundle v3) with a durability class from a closed set,
 * and "a bundle that records a relaxation cannot certify the profile the
 * relaxed obligation belongs to" (`spec/v2/core/security-defaults.md`
 * §Relaxations; RFC 0173 §A.2, row C6.8). Both halves are witnessable without a
 * host: the suite builds a bundle v3 fixture and runs the verifier and the
 * schema over it. No discovery fetch, no seam.
 *
 * Two legs:
 *   1. `verifyBundleV3` rejects `relaxed-profile-certified` when a claimed
 *      profile is `certified: true` while a relaxation on one of its
 *      obligations is recorded — with a positive control (the same bundle
 *      without the relaxation certifies) so the rejection is attributable to
 *      the relaxation rather than to some other defect of the fixture.
 *   2. `durability` outside `session | deployment | persisted` fails
 *      `schemas/v2/certification-bundle.schema.json`; every member of the
 *      closed set validates.
 *
 * @see spec/v2/core/security-defaults.md §Relaxations
 * @see RFCS/0173-v2-security-defaults.md §A.2
 */

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signBundleV3, verifyBundleV3, witnessDigest, type BundleV3, type BundleV3Relaxation } from '../lib/certification-bundle-v3.js';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';

const host = generateKeyPairSync('ed25519');
const hostPem = host.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const ROWS: BundleV3['results']['requirements'] = [
  { id: 'openwop.requirement.0173.webhook-durable-delivery', scenario: 'v2-webhook-durable-delivery.test.ts', result: 'executed-pass', assertions: 4 },
  { id: 'openwop.requirement.0169.capabilities-root-closed', scenario: 'v2-capabilities-root-closed.test.ts', result: 'executed-pass', assertions: 3 },
];

/** A schema-valid, verifier-clean bundle v3; `relaxations` and the claimed profile vary per leg. */
function bundle(opts: { relaxations?: BundleV3Relaxation[]; certified: boolean }): BundleV3 {
  const unsigned: Omit<BundleV3, 'signature'> = {
    bundleVersion: '3',
    generatedAt: '2026-09-03T00:00:00Z',
    suite: { name: '@openwop/openwop-conformance', version: '2.0.0', targetMajor: 2, specArtifactsVersion: '2.0.0' },
    host: {
      name: 'fixture-host',
      version: '2.0.0',
      build: { kind: 'commit', id: 'deadbeef' },
      signingKeyId: 'host-key-1',
      ...(opts.relaxations ? { relaxations: opts.relaxations } : {}),
    },
    discovery: { url: 'https://fixture.invalid/.well-known/openwop', sha256: 'a'.repeat(64), protocolVersions: ['2.0'], preferredVersion: '2.0' },
    claimedProfiles: [
      { id: 'openwop-webhooks', evidenceTier: 'self', witnessCount: 1, certified: opts.certified },
      { id: 'openwop-discovery-core', evidenceTier: 'self', witnessCount: 1, certified: true },
    ],
    results: { totals: { executedPass: ROWS.length, executedFail: 0, skipped: 0, inapplicable: 0, blocked: 0 }, requirements: ROWS },
    witnessSha256: witnessDigest(ROWS),
    assertionCount: ROWS.reduce((n, r) => n + (r.assertions ?? 0), 0),
  };
  return { ...unsigned, signature: signBundleV3(unsigned, hostPem, 'host-key-1') };
}

const RELAXED: BundleV3Relaxation = { obligation: 'webhooks.durable-delivery', durability: 'deployment', reason: 'development deployment; no delivery queue' };

describe('RFC 0173 §A.2 — relaxation-recorded (unaided, fixture bundle)', () => {
  it('a bundle recording a relaxation cannot certify the relaxed profile', () => {
    // Positive control first: without the relaxation the same bundle certifies
    // `openwop-webhooks`, so the rejection below is the relaxation's, not the fixture's.
    const control = verifyBundleV3(bundle({ certified: true }));
    expect(
      control.rejections,
      req('openwop.requirement.0173.relaxation-recorded', 'security-defaults.md §Relaxations', 'control: a bundle with no relaxation and a fully witnessed profile MUST verify clean'),
    ).toEqual([]);
    expect(
      control.certifiedProfiles,
      req('openwop.requirement.0173.relaxation-recorded', 'security-defaults.md §Relaxations', 'control: the unrelaxed profile certifies'),
    ).toContain('openwop-webhooks');

    const relaxed = verifyBundleV3(bundle({ relaxations: [RELAXED], certified: true }));
    expect(
      relaxed.rejections.map((r) => r.kind),
      req('openwop.requirement.0173.relaxation-recorded', 'security-defaults.md §Relaxations', 'a bundle that records a relaxation MUST NOT certify the profile the relaxed obligation belongs to (`relaxed-profile-certified`, RFC 0173 §A.2)'),
    ).toContain('relaxed-profile-certified');
    expect(
      relaxed.rejections.find((r) => r.kind === 'relaxed-profile-certified')?.profile,
      req('openwop.requirement.0173.relaxation-recorded', 'security-defaults.md §Relaxations', 'the rejection names the relaxed profile'),
    ).toBe('openwop-webhooks');
    expect(
      relaxed.certifiedProfiles,
      req('openwop.requirement.0173.relaxation-recorded', 'security-defaults.md §Relaxations', 'the relaxed profile is not in `certifiedProfiles`'),
    ).not.toContain('openwop-webhooks');
    // A relaxation on one obligation does not poison an unrelated profile.
    expect(
      relaxed.certifiedProfiles,
      req('openwop.requirement.0173.relaxation-recorded', 'security-defaults.md §Relaxations', 'an unrelated profile still certifies — the relaxation is scoped to the obligation it names'),
    ).toContain('openwop-discovery-core');

    // A host that records the relaxation AND does not claim the profile is the honest shape.
    const honest = verifyBundleV3(bundle({ relaxations: [RELAXED], certified: false }));
    expect(
      honest.rejections.map((r) => r.kind),
      req('openwop.requirement.0173.relaxation-recorded', 'security-defaults.md §Relaxations', 'a relaxation recorded against an unclaimed profile is not a rejection — recording is the obligation, claiming is the defect'),
    ).not.toContain('relaxed-profile-certified');
  });

  it('durability is a closed set: session | deployment | persisted', () => {
    const validate = v2Validator('certification-bundle');
    const withDurability = (durability: string): unknown => {
      const b = bundle({ relaxations: [{ ...RELAXED, durability: durability as BundleV3Relaxation['durability'] }], certified: false });
      // The verifier fixture is schema-shaped; hand it to Ajv as plain data.
      return JSON.parse(JSON.stringify(b));
    };
    for (const d of ['session', 'deployment', 'persisted']) {
      const r = validate(withDurability(d));
      expect(
        r.ok,
        req('openwop.requirement.0173.relaxation-recorded.durability-closed', 'certification-bundle.schema.json host.relaxations[].durability', `durability "${d}" is a member of the closed set and MUST validate: ${r.errors}`),
      ).toBe(true);
    }
    for (const d of ['permanent', 'runtime', '']) {
      const r = validate(withDurability(d));
      expect(
        r.ok,
        req('openwop.requirement.0173.relaxation-recorded.durability-closed', 'certification-bundle.schema.json host.relaxations[].durability', `durability "${d}" is outside session | deployment | persisted and MUST fail the bundle schema (RFC 0173 §A.2)`),
      ).toBe(false);
      expect(
        r.errors,
        req('openwop.requirement.0173.relaxation-recorded.durability-closed', 'certification-bundle.schema.json host.relaxations[].durability', 'the failure names the durability enum'),
      ).toMatch(/durability|enum/);
    }
  });
});

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signBundleV3, verifyBundleV3, witnessDigest, type BundleV3, type BundleV3Relaxation } from './certification-bundle-v3.js';
import { profilesDeniedByObservedRelaxation, profilesRelaxedBy, v2RegistryAvailable } from './v2-profiles.js';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const EGRESS_ROW = 'openwop.requirement.0171.webhook-egress-refused';

function bundle(egress: 'executed-pass' | 'executed-fail' | 'inapplicable', relaxations?: BundleV3Relaxation[]): BundleV3 {
  const rows: BundleV3['results']['requirements'] = [
    { id: 'openwop.requirement.0169.capabilities-root-closed', scenario: 'v2-capabilities-root-closed.test.ts', result: 'executed-pass', assertions: 3 },
    { id: EGRESS_ROW, scenario: 'v2-webhook-egress-refusal.test.ts', result: egress, ...(egress === 'executed-pass' ? { assertions: 2 } : { detail: egress === 'inapplicable' ? 'the egress guard is relaxed and the operator DECLARED it' : 'this host ACCEPTED 8 of 8 destinations the guard MUST refuse' }) },
  ];
  // A bundle with a non-pass row carries a detail block, or the verifier rejects it bundle-wide for a reason that is not the one under test.
  const nonPass = rows.filter((r) => r.result !== 'executed-pass').map((r) => ({ id: r.id, result: r.result, reason: r.detail ?? '' }));
  const pass = rows.filter((r) => r.result === 'executed-pass').length;
  const unsigned: Omit<BundleV3, 'signature'> = {
    bundleVersion: '3', generatedAt: '2026-09-21T00:00:00Z',
    suite: { name: '@openwop/openwop-conformance', version: '2.33.0', targetMajor: 2, specArtifactsVersion: '2.33.0' },
    host: { name: 'fixture-host', version: '2.0.0', build: { kind: 'commit', id: 'deadbeef' }, signingKeyId: 'k1', ...(relaxations ? { relaxations } : {}) },
    discovery: { url: 'https://fixture.invalid/.well-known/openwop', sha256: 'a'.repeat(64), protocolVersions: ['2.0'], preferredVersion: '2.0' },
    claimedProfiles: [
      { id: 'openwop-core-standard', evidenceTier: 'self', witnessCount: 1, certified: true },
      { id: 'openwop-discovery-core', evidenceTier: 'self', witnessCount: 1, certified: true },
    ],
    results: { totals: { executedPass: pass, executedFail: egress === 'executed-fail' ? 1 : 0, skipped: 0, inapplicable: egress === 'inapplicable' ? 1 : 0, blocked: 0 }, requirements: rows },
    witnessSha256: witnessDigest(rows),
    assertionCount: rows.reduce((n, r) => n + (r.assertions ?? 0), 0),
    ...(nonPass.length > 0 ? { detail: { nonPass } } : {}),
  };
  return { ...unsigned, signature: signBundleV3(unsigned, pem, 'k1') };
}

describe.skipIf(!v2RegistryAvailable())('an open egress guard denies the profile that owns `webhooks` — declared or not', () => {
  it('ownership is read from spec/v2/profiles.json, not from the spelling of the profile id', () => {
    const ids = ['openwop-discovery-core', 'openwop-core-standard', 'openwop-conformance-seams-v2'];
    expect([...profilesRelaxedBy(['webhooks.egress-guard'], ids)]).toEqual(['openwop-core-standard']);
    expect([...profilesRelaxedBy(['replay.suppression'], ids)]).toEqual(['openwop-core-standard']);
    expect([...profilesRelaxedBy(['mcp.egress-guard'], ids)]).toEqual([]); // no claimed profile is built on mcp
    expect([...profilesRelaxedBy([], ids)]).toEqual([]);
    // the id-named arm is kept: a non-registry id still names its family
    expect([...profilesRelaxedBy(['webhooks.durable-delivery'], ['openwop-webhooks'])]).toEqual(['openwop-webhooks']);
  });

  it('UNDECLARED: the guard-refusal row failed and nothing is recorded → the owning profile is rejected, the unrelated one still certifies', () => {
    const v = verifyBundleV3(bundle('executed-fail'));
    const r = v.rejections.find((x) => x.kind === 'undeclared-relaxation-observed');
    expect(r?.profile).toBe('openwop-core-standard');
    expect(r?.detail).toContain('webhooks.egress-guard');
    expect(v.certifiedProfiles).toEqual(['openwop-discovery-core']);
    expect([...profilesDeniedByObservedRelaxation([{ id: EGRESS_ROW, result: 'executed-fail' }], ['openwop-core-standard']).profiles]).toEqual(['openwop-core-standard']);
  });

  it('GUARDED: the row passed → nothing is denied', () => {
    const v = verifyBundleV3(bundle('executed-pass'));
    expect(v.rejections.map((x) => x.kind)).not.toContain('undeclared-relaxation-observed');
    expect(v.certifiedProfiles).toContain('openwop-core-standard');
  });

  it('DECLARED: the relaxation is recorded → denied ONCE, as a declared relaxation, never double-reported as an undeclared one', () => {
    const v = verifyBundleV3(bundle('inapplicable', [{ obligation: 'webhooks.egress-guard', durability: 'session', reason: 'conformance cut against loopback fixtures' }]));
    expect(v.rejections.filter((x) => x.profile === 'openwop-core-standard').map((x) => x.kind)).toEqual(['relaxed-profile-certified']);
    expect(v.certifiedProfiles).toEqual(['openwop-discovery-core']);
  });
});

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signBundleV3, verifyBundleV3, witnessDigest, verifierSign, publicKeyFromPrivate, canonicalJSON, type BundleV3 } from './certification-bundle-v3.js';

const pem = (k: ReturnType<typeof generateKeyPairSync>['privateKey']) => k.export({ type: 'pkcs8', format: 'pem' }) as string;
const host = generateKeyPairSync('ed25519');
const verifier = generateKeyPairSync('ed25519');
const hostPub = host.publicKey.export({ type: 'spki', format: 'pem' }) as string;

function unsigned(rows: BundleV3['results']['requirements'], extra: Partial<Omit<BundleV3, 'signature'>> = {}): Omit<BundleV3, 'signature'> {
  const count = (d: string) => rows.filter((r) => r.result === d).length;
  const nonPass = rows.filter((r) => r.result !== 'executed-pass');
  return {
    bundleVersion: '3', generatedAt: '2026-09-03T00:00:00Z',
    suite: { name: '@openwop/openwop-conformance', version: '2.0.0-rc.0', targetMajor: 2, specArtifactsVersion: '2.0.0-rc.0' },
    host: { name: 'in-memory', version: '2.0.0', build: { kind: 'commit', id: 'abc123' }, signingKeyId: 'host-key-1' },
    discovery: { url: 'http://h/.well-known/openwop', sha256: 'a'.repeat(64), protocolVersions: ['1.11', '2.0'], preferredVersion: '2.0' },
    claimedProfiles: [{ id: 'openwop-discovery-core', evidenceTier: 'self', witnessCount: 1, certified: count('blocked') === 0 }],
    results: { totals: { executedPass: count('executed-pass'), executedFail: count('executed-fail'), skipped: count('skipped'), inapplicable: count('inapplicable'), blocked: count('blocked') }, requirements: rows },
    witnessSha256: witnessDigest(rows), assertionCount: rows.reduce((n, r) => n + (r.assertions ?? 0), 0),
    ...(nonPass.length ? { detail: { nonPass: nonPass.map((r) => ({ id: r.id, result: r.result, reason: r.detail ?? '' })) } } : {}),
    ...extra,
  };
}
const good = [{ id: 'openwop.it.discovery.root-closed', scenario: 'v2-capabilities-root-closed.test.ts', result: 'executed-pass' as const, assertions: 3 }];

describe('certification bundle v3 (RFC 0168 §E)', () => {
  it('signs and verifies a well-formed bundle', () => {
    const u = unsigned(good); const b: BundleV3 = { ...u, signature: signBundleV3(u, pem(host.privateKey), 'host-key-1') };
    const v = verifyBundleV3(b, { hostPublicKeyPem: hostPub });
    expect(v.rejections, JSON.stringify(v.rejections)).toEqual([]);
    expect(v.signatureVerified).toBe(true);
    expect(v.certifiedProfiles).toEqual(['openwop-discovery-core']);
  });
  it('refuses a tampered witness (a row changed after signing)', () => {
    const u = unsigned(good); const b: BundleV3 = { ...u, signature: signBundleV3(u, pem(host.privateKey), 'host-key-1') };
    const tampered: BundleV3 = { ...b, results: { ...b.results, requirements: [{ ...good[0], assertions: 99 }] }, assertionCount: 99 };
    const v = verifyBundleV3(tampered, { hostPublicKeyPem: hostPub });
    expect(v.rejections.map((r) => r.kind)).toContain('witness-digest');
  });
  it('refuses a signature that does not verify under the host key', () => {
    const u = unsigned(good); const other = generateKeyPairSync('ed25519');
    const b: BundleV3 = { ...u, signature: signBundleV3(u, pem(other.privateKey), 'host-key-1') };
    expect(verifyBundleV3(b, { hostPublicKeyPem: hostPub }).rejections.map((r) => r.kind)).toContain('signature-invalid');
  });
  it('refuses an independent claim without a distinct verifier signature', () => {
    const u = unsigned(good, { claimedProfiles: [{ id: 'openwop-discovery-core', evidenceTier: 'independent', witnessCount: 1, certified: true }] });
    const b: BundleV3 = { ...u, signature: signBundleV3(u, pem(host.privateKey), 'host-key-1') };
    expect(verifyBundleV3(b, { hostPublicKeyPem: hostPub }).rejections.map((r) => r.kind)).toContain('independent-unsigned');
    const selfSigned: BundleV3 = { ...b, verifierSignature: verifierSign(u, pem(host.privateKey), 'host-key-1') };
    expect(verifyBundleV3(selfSigned, { hostPublicKeyPem: hostPub }).rejections.map((r) => r.kind)).toContain('independent-self-signed');
    const proper: BundleV3 = { ...b, verifierSignature: verifierSign(u, pem(verifier.privateKey), 'verifier-key-1') };
    const v = verifyBundleV3(proper, { hostPublicKeyPem: hostPub, verifierPublicKeyPem: verifier.publicKey.export({ type: 'spki', format: 'pem' }) as string });
    expect(v.rejections).toEqual([]); expect(v.verifierSignatureVerified).toBe(true);
  });
  it('a blocked row means nothing certifies; a relaxed obligation cannot certify its profile', () => {
    const rows = [...good, { id: 'openwop.it.x.y', scenario: 'x.test.ts', result: 'blocked' as const, detail: 'unclassified return' }];
    const u = unsigned(rows, { claimedProfiles: [{ id: 'openwop-discovery-core', evidenceTier: 'self', witnessCount: 1, certified: true }] });
    const b: BundleV3 = { ...u, signature: signBundleV3(u, pem(host.privateKey), 'host-key-1') };
    const v = verifyBundleV3(b, { hostPublicKeyPem: hostPub });
    expect(v.rejections.map((r) => r.kind)).toContain('blocked-certified'); expect(v.certifiedProfiles).toEqual([]);
    const u2 = unsigned(good, { host: { name: 'h', version: '1', build: { kind: 'commit', id: 'c' }, relaxations: [{ obligation: 'webhooks.durable-delivery', durability: 'deployment', reason: 'dev' }] }, claimedProfiles: [{ id: 'openwop-webhooks', evidenceTier: 'self', witnessCount: 1, certified: true }] });
    const b2: BundleV3 = { ...u2, signature: signBundleV3(u2, pem(host.privateKey), 'k') };
    expect(verifyBundleV3(b2).rejections.map((r) => r.kind)).toContain('relaxed-profile-certified');
  });
  it('canonical JSON is key-sorted and whitespace-free; the public key derives from the private key', () => {
    expect(canonicalJSON({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(publicKeyFromPrivate(pem(host.privateKey))).toBe(hostPub);
  });
});

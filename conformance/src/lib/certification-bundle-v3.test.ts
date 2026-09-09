import { describe, it, expect } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
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
  // Derivability, restored in 2.0.5. v2 bundles carried `discovery.document`
  // and `verifyBundleV2` re-derived every claimed profile from it; v3 shipped
  // {url, sha256, protocolVersions, preferredVersion} and the check went with
  // the field, so `certified: true` was a claim only its emitter could
  // evaluate. These pin the restored behaviour AND its absence case.
  //
  // 2.0.8 — `DERIVES` used to be the v1 shape below (`protocolVersion: '1.11'`,
  // `supportedEnvelopes`, `limits`) inside a `targetMajor: 2` bundle, and it
  // passed. That is the whole defect in one fixture: the only test exercising
  // derivability at major 2 did it with a document no v2 host would ever serve,
  // so the v1-predicate verifier looked correct here and refused every real
  // host. The major-2 fixture is now major-2 shaped.
  const DERIVES_V1: Record<string, unknown> = {
    protocolVersion: '1.11',
    supportedEnvelopes: ['clarification.request'],
    schemaVersions: {},
    limits: { clarificationRounds: 2, schemaRounds: 2, envelopesPerTurn: 2 },
  };
  // RFC 0169 §C.1: a v2 declaration's root is `protocolVersions` /
  // `preferredVersion` plus family records. `openwop-discovery-core`'s registry
  // predicate is exactly {families: [], metadata: [protocolVersions, preferredVersion]}.
  const DERIVES: Record<string, unknown> = {
    protocolVersions: ['2.0'],
    preferredVersion: '2.0',
    interrupt: { supported: true },
    eventLog: { eventLogSchemaVersion: 3 },
  };
  const withDoc = (doc: Record<string, unknown> | undefined, over: Record<string, unknown> = {}): BundleV3 => {
    const u = unsigned(good, {
      discovery: {
        url: 'http://h/.well-known/openwop',
        sha256: doc === undefined ? 'a'.repeat(64) : createHash('sha256').update(canonicalJSON(doc)).digest('hex'),
        protocolVersions: ['1.11', '2.0'],
        preferredVersion: '2.0',
        ...(doc === undefined ? {} : { document: doc }),
        ...over,
      } as BundleV3['discovery'],
    });
    return { ...u, signature: signBundleV3(u, pem(host.privateKey), 'host-key-1') };
  };

  it('re-derives every certified profile from the bundle-carried discovery document', () => {
    const v = verifyBundleV3(withDoc(DERIVES), { hostPublicKeyPem: hostPub });
    expect(v.rejections, JSON.stringify(v.rejections)).toEqual([]);
    expect(v.derivabilityChecked).toBe(true);
    expect(v.certifiedProfiles).toEqual(['openwop-discovery-core']);
  });

  it('refuses a profile the captured document does not derive', () => {
    // Same bundle, same signature, same `certified: true` — only the document
    // is honest about what the host advertised. Before 2.0.5 this verified.
    // `{protocolVersion}` singular satisfies neither catalog: not v1 core (no
    // envelopes/limits) and not the v2 registry (no `protocolVersions`).
    const v = verifyBundleV3(withDoc({ protocolVersion: '1.11' }), { hostPublicKeyPem: hostPub });
    expect(v.rejections.map((r) => r.kind)).toContain('profile-not-derivable');
    expect(v.certifiedProfiles).toEqual([]);
  });

  // The blocker itself. Two tier-1 hosts cut major-2 bundles from real
  // declarations and were refused `openwop-discovery-core` as "not advertised"
  // — on documents that advertise exactly it — because the verifier answered
  // from the v1 catalog, where `isCore` demands a scalar `protocolVersion` of
  // major 1. Nothing was wrong with either host or either bundle.
  it('derives a major-2 profile from a v2-shaped declaration', () => {
    const v = verifyBundleV3(withDoc(DERIVES), { hostPublicKeyPem: hostPub });
    expect(v.rejections.map((r) => r.kind)).not.toContain('profile-not-derivable');
    expect(v.certifiedProfiles).toEqual(['openwop-discovery-core']);
  });

  it('refuses a v1-shaped document in a major-2 bundle', () => {
    // The converse, and the fixture this file used to certify on. A v1
    // declaration does not derive a v2 profile: `protocolVersions` is absent,
    // so the registry predicate for `openwop-discovery-core` fails. Without
    // this row the catalog dispatch could regress to "try v1 too" and nothing
    // would go red.
    const v = verifyBundleV3(withDoc(DERIVES_V1), { hostPublicKeyPem: hostPub });
    expect(v.derivabilityChecked).toBe(true);
    expect(v.rejections.map((r) => r.kind)).toContain('profile-not-derivable');
    expect(v.certifiedProfiles).toEqual([]);
  });

  it('a major-1 bundle still answers from the v1 catalog', () => {
    // The default is major 1 and every v1-era call site depends on it. Same
    // v1 document, `targetMajor: 1` — derives, where the major-2 bundle above
    // refused it.
    const u = unsigned(good, {
      suite: { name: '@openwop/openwop-conformance', version: '2.0.0-rc.0', targetMajor: 1, specArtifactsVersion: '2.0.0-rc.0' },
      discovery: {
        url: 'http://h/.well-known/openwop',
        sha256: createHash('sha256').update(canonicalJSON(DERIVES_V1)).digest('hex'),
        protocolVersions: ['1.11'], preferredVersion: '1.11', document: DERIVES_V1,
      } as BundleV3['discovery'],
    });
    const v = verifyBundleV3({ ...u, signature: signBundleV3(u, pem(host.privateKey), 'host-key-1') }, { hostPublicKeyPem: hostPub });
    expect(v.derivabilityChecked).toBe(true);
    expect(v.rejections, JSON.stringify(v.rejections)).toEqual([]);
    expect(v.certifiedProfiles).toEqual(['openwop-discovery-core']);
  });

  it('refuses a document substituted after signing', () => {
    // The signature covers discovery.sha256, not the document, so swapping the
    // document alone leaves the signature valid; only re-deriving the digest
    // catches it. Without this the field would be a place to put a lie.
    const b = withDoc(DERIVES);
    const tampered: BundleV3 = { ...b, discovery: { ...b.discovery, document: { protocolVersion: '1.11' } } };
    const v = verifyBundleV3(tampered, { hostPublicKeyPem: hostPub });
    expect(v.signatureVerified).toBe(true);
    expect(v.rejections.map((r) => r.kind)).toContain('discovery-digest');
    expect(v.derivabilityChecked).toBe(false);
  });

  it('a bundle with no document still verifies, and says derivability went unchecked', () => {
    // Every bundle cut before 2.0.5 lands here. Absence is a stated gap, not a
    // rejection — but a reader quoting the verdict needs to see the flag.
    const v = verifyBundleV3(withDoc(undefined), { hostPublicKeyPem: hostPub });
    expect(v.rejections, JSON.stringify(v.rejections)).toEqual([]);
    expect(v.certifiedProfiles).toEqual(['openwop-discovery-core']);
    expect(v.derivabilityChecked).toBe(false);
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

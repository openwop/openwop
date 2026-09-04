/**
 * v2-bundle-v3-signed — RFC 0168 §E.1/§E.2; `spec/v2/core/conformance.md`
 * §"Bundle v3".
 *
 * Suite 2.0.0. A certification bundle validates against
 * `schemas/v2/certification-bundle.schema.json` (closed root, `bundleVersion: "3"`),
 * carries `witnessSha256` over the reporter record and an Ed25519 attestation
 * over `{ witnessSha256, host.build, suite.version, discovery.sha256 }`; an
 * `evidenceTier: independent` claim MUST carry a verifier signature under a key
 * distinct from the host's, and the verifier MUST refuse, not warn. Unaided and
 * fixture-based, with `lib/certification-bundle-v3.ts` as the signer/verifier:
 *
 *   1. §E.1 — a signed fixture validates against the schema; the same fixture
 *      with one extra root key is rejected (closed root).
 *   2. §E.2 — the signed fixture verifies under the host key; flipping
 *      `witnessSha256` is refused with `witness-digest` (and the signature no
 *      longer verifies, since the digest is inside the attestation payload).
 *   3. §E.2 — an `independent` claim whose verifier signature uses the host's
 *      key id is refused with `independent-self-signed`; a distinct verifier
 *      key verifies.
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §E.1, §E.2
 * @see spec/v2/core/conformance.md §"Bundle v3"
 * @see conformance/src/lib/certification-bundle-v3.ts
 */

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { req } from '../lib/requirement-ids.js';
import { v2Validator } from '../lib/v2.js';
import { publicKeyFromPrivate, signBundleV3, verifierSign, verifyBundleV3, witnessDigest, type BundleV3, type BundleV3Requirement } from '../lib/certification-bundle-v3.js';

const SECTION = 'conformance.md §"Bundle v3" (RFC 0168 §E)';
const HOST_KEY_ID = 'fixture-host-key';

function keyPem(): string {
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

function fixture(hostPem: string): BundleV3 {
  const rows: BundleV3Requirement[] = [
    { id: 'openwop.requirement.0168.bundle-v3-signed.fixture-a', scenario: 'v2-bundle-v3-signed.test.ts', result: 'executed-pass', assertions: 2 },
    { id: 'openwop.requirement.0168.bundle-v3-signed.fixture-b', scenario: 'v2-bundle-v3-signed.test.ts', result: 'executed-pass', assertions: 1 },
  ];
  const unsigned: Omit<BundleV3, 'signature'> = {
    bundleVersion: '3',
    generatedAt: new Date().toISOString(),
    suite: { name: '@openwop/openwop-conformance', version: '2.0.0', targetMajor: 2, specArtifactsVersion: '2.0.0' },
    host: { name: 'fixture-host', version: '0.0.0', build: { kind: 'commit', id: 'fixture' }, signingKeyId: HOST_KEY_ID },
    discovery: { url: 'https://host.invalid/.well-known/openwop', sha256: 'b'.repeat(64), protocolVersions: ['2.0'], preferredVersion: '2.0' },
    claimedProfiles: [{ id: 'openwop-core-v2', evidenceTier: 'self', witnessCount: 2, certified: true }],
    results: { totals: { executedPass: 2, executedFail: 0, skipped: 0, inapplicable: 0, blocked: 0 }, requirements: rows },
    witnessSha256: witnessDigest(rows),
    assertionCount: 3,
  };
  return { ...unsigned, signature: signBundleV3(unsigned, hostPem, HOST_KEY_ID) };
}

describe('v2-bundle-v3-signed (RFC 0168 §E)', () => {
  it('a signed v3 bundle validates against the closed-root schema; an extra root key is rejected', () => {
    const validate = v2Validator('certification-bundle');
    const bundle = fixture(keyPem());
    const ok = validate(bundle);
    expect(ok.ok, req('openwop.requirement.0168.bundle-v3-signed.schema-closed-root', SECTION, `a signed v3 bundle with the required fields MUST validate (${ok.errors})`)).toBe(true);
    const open = validate({ ...bundle, vendorNote: 'not a v3 field' });
    expect(open.ok, req('openwop.requirement.0168.bundle-v3-signed.schema-closed-root', SECTION, 'the v3 root is closed — an unknown root key MUST be rejected (RFC 0168 §E.1)')).toBe(false);
  });

  it('the attestation verifies under the host key, and a flipped witnessSha256 is refused with witness-digest', () => {
    const hostPem = keyPem();
    const bundle = fixture(hostPem);
    const hostPublicKeyPem = publicKeyFromPrivate(hostPem);
    const clean = verifyBundleV3(bundle, { hostPublicKeyPem });
    expect(clean.rejections, req('openwop.requirement.0168.bundle-v3-signed.witness-digest', SECTION, `an untampered signed bundle MUST verify with no rejections (${clean.rejections.map((r) => r.kind).join(',')})`)).toEqual([]);
    expect(clean.signatureVerified, req('openwop.requirement.0168.bundle-v3-signed.witness-digest', SECTION, 'the Ed25519 attestation MUST verify under the host key')).toBe(true);
    const flipped: BundleV3 = { ...bundle, witnessSha256: bundle.witnessSha256.startsWith('0') ? `1${bundle.witnessSha256.slice(1)}` : `0${bundle.witnessSha256.slice(1)}` };
    const verdict = verifyBundleV3(flipped, { hostPublicKeyPem });
    expect(verdict.rejections.map((r) => r.kind), req('openwop.requirement.0168.bundle-v3-signed.witness-digest', SECTION, 'a witnessSha256 that is not the digest of the rows MUST be refused with witness-digest (RFC 0148 §C)')).toContain('witness-digest');
    expect(verdict.signatureVerified, req('openwop.requirement.0168.bundle-v3-signed.witness-digest', SECTION, 'the attestation covers witnessSha256, so a flipped digest MUST NOT verify under the host key')).toBe(false);
  });

  it('an independent claim self-signed under the host key is refused; a distinct verifier key verifies', () => {
    const hostPem = keyPem();
    const verifierPem = keyPem();
    const base = fixture(hostPem);
    const independent: BundleV3 = { ...base, claimedProfiles: [{ id: 'openwop-core-v2', evidenceTier: 'independent', witnessCount: 2, certified: true }] };
    const selfSigned: BundleV3 = { ...independent, verifierSignature: verifierSign(independent, hostPem, HOST_KEY_ID) };
    const refused = verifyBundleV3(selfSigned, { hostPublicKeyPem: publicKeyFromPrivate(hostPem), verifierPublicKeyPem: publicKeyFromPrivate(hostPem) });
    expect(refused.rejections.map((r) => r.kind), req('openwop.requirement.0168.bundle-v3-signed.independent-self-signed', SECTION, 'an independent claim whose verifier key id equals the host key id MUST be refused with independent-self-signed (RFC 0148 R5)')).toContain('independent-self-signed');
    expect(refused.certifiedProfiles, req('openwop.requirement.0168.bundle-v3-signed.independent-self-signed', SECTION, 'a refused independent claim MUST NOT certify')).not.toContain('openwop-core-v2');
    const distinct: BundleV3 = { ...independent, verifierSignature: verifierSign(independent, verifierPem, 'fixture-verifier-key') };
    const accepted = verifyBundleV3(distinct, { hostPublicKeyPem: publicKeyFromPrivate(hostPem), verifierPublicKeyPem: publicKeyFromPrivate(verifierPem) });
    expect(accepted.rejections, req('openwop.requirement.0168.bundle-v3-signed.independent-self-signed', SECTION, `a distinct verifier key MUST verify with no rejections (${accepted.rejections.map((r) => r.kind).join(',')})`)).toEqual([]);
    expect(accepted.verifierSignatureVerified, req('openwop.requirement.0168.bundle-v3-signed.independent-self-signed', SECTION, 'the verifier attestation MUST verify under the verifier key')).toBe(true);
  });
});

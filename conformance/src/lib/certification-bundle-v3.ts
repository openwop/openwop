/**
 * Certification bundle v3 (RFC 0168 §E; schemas/v2/certification-bundle.schema.json).
 *
 * What v3 adds over v2 and why:
 *   - a closed root and `witnessSha256` over the reporter record (RFC 0148 §C
 *     asked for it; the v2 schema listed it optional and no emitter wrote it);
 *   - `assertionCount`, `host.build`, per-profile `evidenceTier`/`witnessCount`,
 *     `detail` (required when any result is not executed-pass);
 *   - an Ed25519 attestation over the canonical JSON of
 *     { witnessSha256, host.build, suite.version, discovery.sha256 } — the same
 *     commit rebuilt once scored 283/22 and 303/2 and nothing in the bundle could
 *     tell them apart; the build id plus the signature can;
 *   - `evidenceTier: independent` REQUIRES a verifier signature under a key id
 *     distinct from the host's (RFC 0148 R5: a malicious generator fabricates
 *     witnesses — a self-signed "independent" claim is refused, not warned).
 *
 * This module is schema-agnostic on purpose (the schema check is a separate step
 * in cli.ts) and pure: it never reads the environment.
 */
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';

export type BundleV3Result = 'executed-pass' | 'executed-fail' | 'skipped' | 'inapplicable' | 'blocked';

export interface BundleV3Requirement {
  readonly id: string;
  readonly scenario: string;
  readonly result: BundleV3Result;
  readonly assertions?: number;
  readonly detail?: string;
}
export interface BundleV3Profile {
  readonly id: string;
  readonly evidenceTier: 'self' | 'steward' | 'independent';
  readonly witnessCount: number;
  readonly certified: boolean;
}
export interface BundleV3Relaxation { readonly obligation: string; readonly durability: 'session' | 'deployment' | 'persisted'; readonly reason: string }
export interface BundleV3Signature { readonly alg: 'ed25519'; readonly keyId: string; readonly sig: string; readonly over: readonly string[]; readonly verifierKeyId?: string }
export interface BundleV3 {
  bundleVersion: '3';
  generatedAt: string;
  suite: { name: '@openwop/openwop-conformance'; version: string; targetMajor: 1 | 2; specArtifactsVersion: string; stampSha256?: string };
  host: { name: string; version: string; vendor?: string; build: { kind: 'image-digest' | 'commit' | 'artifact-sha256'; id: string }; signingKeyId?: string; relaxations?: BundleV3Relaxation[] };
  discovery: { url: string; sha256: string; protocolVersions: string[]; preferredVersion: string };
  claimedProfiles: BundleV3Profile[];
  results: { totals: Record<'executedPass' | 'executedFail' | 'skipped' | 'inapplicable' | 'blocked', number>; requirements: BundleV3Requirement[] };
  witnessSha256: string;
  assertionCount: number;
  detail?: { nonPass: { id: string; result: string; reason: string }[] };
  signature: BundleV3Signature;
  verifierSignature?: { alg: 'ed25519'; keyId: string; sig: string };
}

export const SIGNATURE_OVER = ['witnessSha256', 'host.build', 'suite.version', 'discovery.sha256'] as const;

/** Deterministic JSON: keys sorted at every level, no whitespace. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** RFC 0148 §C — the digest over the reporter record (the requirement rows). */
export function witnessDigest(rows: readonly BundleV3Requirement[]): string {
  const canonicalRows = [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ id: r.id, scenario: r.scenario, result: r.result, ...(r.assertions === undefined ? {} : { assertions: r.assertions }), ...(r.detail === undefined ? {} : { detail: r.detail }) }));
  return createHash('sha256').update(canonicalJSON(canonicalRows), 'utf8').digest('hex');
}

/** The bytes the attestation covers. */
export function attestationPayload(b: Pick<BundleV3, 'witnessSha256' | 'host' | 'suite' | 'discovery'>): Buffer {
  return Buffer.from(canonicalJSON({ witnessSha256: b.witnessSha256, 'host.build': b.host.build, 'suite.version': b.suite.version, 'discovery.sha256': b.discovery.sha256 }), 'utf8');
}

function toBase64url(buf: Buffer): string { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromBase64url(s: string): Buffer { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

export function signBundleV3(bundle: Omit<BundleV3, 'signature'>, privateKeyPem: string, keyId: string): BundleV3Signature {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`bundle v3 signing key must be Ed25519, got ${String(key.asymmetricKeyType)}`);
  const sig = edSign(null, attestationPayload(bundle), key);
  return { alg: 'ed25519', keyId, sig: toBase64url(sig), over: [...SIGNATURE_OVER] };
}

export function verifierSign(bundle: Pick<BundleV3, 'witnessSha256' | 'host' | 'suite' | 'discovery'>, privateKeyPem: string, keyId: string): NonNullable<BundleV3['verifierSignature']> {
  const key = createPrivateKey(privateKeyPem);
  return { alg: 'ed25519', keyId, sig: toBase64url(edSign(null, attestationPayload(bundle), key)) };
}

export function publicKeyFromPrivate(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }) as string;
}

export interface VerifyV3Options {
  /** The host's public key (PEM). Without it the signature's bytes are checked for shape only and the verdict says `signatureVerified: false`. */
  readonly hostPublicKeyPem?: string;
  /** The verifier's public key (PEM) — required to verify an `independent` claim. */
  readonly verifierPublicKeyPem?: string;
}
export interface V3Rejection { readonly kind: string; readonly detail: string; readonly profile?: string }
export interface V3Verdict {
  readonly rejections: V3Rejection[];
  readonly signatureVerified: boolean;
  readonly verifierSignatureVerified: boolean;
  readonly certifiedProfiles: string[];
}

export function verifyBundleV3(bundle: BundleV3, opts: VerifyV3Options = {}): V3Verdict {
  const rejections: V3Rejection[] = [];
  if (bundle.bundleVersion !== '3') rejections.push({ kind: 'not-v3', detail: `bundleVersion is ${JSON.stringify(bundle.bundleVersion)}, expected "3"` });
  const rows = bundle.results?.requirements ?? [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) rejections.push({ kind: 'duplicate-requirement', detail: `${r.id}: more than one row (RFC 0148 §A)` });
    seen.add(r.id);
    if (r.result !== 'executed-pass' && !(r.detail && r.detail.trim())) rejections.push({ kind: 'reason-missing', detail: `${r.id}: '${r.result}' recorded without a reason` });
    if (r.result === 'executed-pass' && !(r.assertions && r.assertions > 0)) rejections.push({ kind: 'vacuous-pass', detail: `${r.id}: executed-pass with no assertions is a witness of nothing (RFC 0148 §C)` });
  }
  const count = (d: BundleV3Result): number => rows.filter((r) => r.result === d).length;
  const expected = { executedPass: count('executed-pass'), executedFail: count('executed-fail'), skipped: count('skipped'), inapplicable: count('inapplicable'), blocked: count('blocked') };
  for (const k of Object.keys(expected) as (keyof typeof expected)[]) if (bundle.results?.totals?.[k] !== expected[k]) rejections.push({ kind: 'totals-mismatch', detail: `totals.${k} is ${String(bundle.results?.totals?.[k])} but the rows count ${expected[k]}` });
  const digest = witnessDigest(rows);
  if (bundle.witnessSha256 !== digest) rejections.push({ kind: 'witness-digest', detail: `witnessSha256 ${String(bundle.witnessSha256).slice(0, 12)} does not equal the digest of the rows (${digest.slice(0, 12)})` });
  const assertions = rows.reduce((n, r) => n + (r.assertions ?? 0), 0);
  if (bundle.assertionCount !== assertions) rejections.push({ kind: 'assertion-count', detail: `assertionCount is ${String(bundle.assertionCount)} but the rows sum to ${assertions}` });
  const nonPass = rows.filter((r) => r.result !== 'executed-pass');
  if (nonPass.length > 0 && !bundle.detail) rejections.push({ kind: 'detail-missing', detail: `${nonPass.length} non-pass row(s) and no detail block` });
  if (!bundle.host?.build?.kind || !bundle.host?.build?.id) rejections.push({ kind: 'build-missing', detail: 'host.build.{kind,id} is required — a bundle attributes to a BUILD, not a commit' });

  // Signature
  let signatureVerified = false;
  const sig = bundle.signature;
  if (!sig || sig.alg !== 'ed25519' || !sig.keyId || !sig.sig) rejections.push({ kind: 'signature-missing', detail: 'signature.{alg: ed25519, keyId, sig} is required in v3' });
  else if (JSON.stringify(sig.over) !== JSON.stringify(SIGNATURE_OVER)) rejections.push({ kind: 'signature-over', detail: `signature.over must be ${JSON.stringify(SIGNATURE_OVER)}` });
  else if (opts.hostPublicKeyPem) {
    const key: KeyObject = createPublicKey(opts.hostPublicKeyPem);
    signatureVerified = edVerify(null, attestationPayload(bundle), key, fromBase64url(sig.sig));
    if (!signatureVerified) rejections.push({ kind: 'signature-invalid', detail: 'the attestation does not verify under the host key' });
  }
  // Independent tier
  let verifierSignatureVerified = false;
  const claimsIndependent = (bundle.claimedProfiles ?? []).some((p) => p.evidenceTier === 'independent');
  if (claimsIndependent) {
    const vs = bundle.verifierSignature;
    if (!vs || !vs.keyId || !vs.sig) rejections.push({ kind: 'independent-unsigned', detail: 'evidenceTier independent requires a verifierSignature (RFC 0168 §E.2)' });
    else if (vs.keyId === sig?.keyId || vs.keyId === bundle.host?.signingKeyId) rejections.push({ kind: 'independent-self-signed', detail: 'the verifier key must be distinct from the host key (RFC 0148 R5)' });
    else if (opts.verifierPublicKeyPem) {
      verifierSignatureVerified = edVerify(null, attestationPayload(bundle), createPublicKey(opts.verifierPublicKeyPem), fromBase64url(vs.sig));
      if (!verifierSignatureVerified) rejections.push({ kind: 'verifier-signature-invalid', detail: 'the verifier attestation does not verify' });
    } else rejections.push({ kind: 'independent-unverifiable', detail: 'an independent claim needs the verifier public key to verify; refused, not assumed' });
  }
  // Relaxations: a relaxed obligation's profile cannot certify (RFC 0173 §A.2).
  const relaxed = new Set((bundle.host?.relaxations ?? []).map((r) => r.obligation.split('.')[0]));
  const certifiedProfiles: string[] = [];
  for (const p of bundle.claimedProfiles ?? []) {
    if (p.certified && relaxed.size > 0 && [...relaxed].some((o) => p.id.includes(o))) rejections.push({ kind: 'relaxed-profile-certified', profile: p.id, detail: `${p.id} is marked certified while a relaxation on ${[...relaxed].join(', ')} is recorded (RFC 0173 §A.2)` });
    else if (p.certified) certifiedProfiles.push(p.id);
  }
  if (expected.blocked > 0 && certifiedProfiles.length > 0) rejections.push({ kind: 'blocked-certified', detail: `${expected.blocked} blocked row(s): a bundle with blocked > 0 does not certify (RFC 0168 §E.1)` });
  // RFC 0168 §E.2: the verifier REFUSES, it does not warn — but a refusal is
  // scoped to what it names. A rejection carrying a `profile` removes that
  // profile only (a relaxation on one obligation does not poison an unrelated
  // one, RFC 0173 §A.2); a rejection that names no profile is a statement about
  // the bundle — a bad witness digest, an unverifiable signature, a self-signed
  // `independent` claim, a blocked row — and nothing in it certifies.
  const bundleWide = rejections.filter((r) => !('profile' in r) || !r.profile);
  const scoped = new Set(rejections.map((r) => r.profile).filter((p): p is string => typeof p === 'string'));
  return {
    rejections,
    signatureVerified,
    verifierSignatureVerified,
    certifiedProfiles: bundleWide.length > 0 ? [] : certifiedProfiles.filter((p) => !scoped.has(p)),
  };
}

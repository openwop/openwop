/**
 * RFC 0216 §C: when a colocated companion bundle is acceptance evidence.
 *
 * A companion is the served host's image, booted beside the suite so it can
 * trust a suite-held trust anchor that a host serving production traffic MUST
 * NOT trust. It runs the same verifier code. It does not serve the served
 * front: no CDN, no rewrite, no public-origin challenge. So it witnesses the
 * rows on `spec/v2/harness-trust-anchors.json` and nothing else, and only when
 * it PAIRS with a certified served-host bundle P:
 *
 *   (a) the same host:       `host.name` and `host.vendor` equal;
 *   (b) the same image:      both `host.build.kind` are `image-digest`, `id` byte-equal;
 *   (c) P's operator signed: the companion's `signature.keyId` is in P's captured
 *                            `signingKeys[]` (`use: certification-bundle`), the
 *                            companion's `witnessSha256` recomputes from its rows,
 *                            and its attestation verifies under that key;
 *   (d) the same config:     the captured discovery documents are equal once each
 *                            document's origin is replaced by one placeholder and
 *                            the `oidc` lane's `issuers` are removed. Nothing else
 *                            is set aside.
 *
 * Shared by `check-accepted-predicate.mjs` (rule 4) and
 * `check-companion-pairing.mjs`, which the coherence scenario
 * `v2-colocated-companion.test.ts` drives, so the test exercises the gate's own code.
 */
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';

/**
 * §C.10: the one companion committed before the marker existed, named by its
 * `witnessSha256` so a renamed copy is still caught. It is treated as marked. It
 * has `kind: commit` and a throwaway key, so it fails (b) and (c) and pairs with
 * nothing.
 */
export const LEGACY_UNMARKED_COMPANIONS = new Map([
  ['c1d336b74698e5c44895201893ae09c8d0017fe1b8ed0dfdbf87c3436c10068e', 'openwop-app colocated companion, 2026-09-25 (suite 2.38.0), cut before RFC 0216 §B'],
]);

export const isCompanion = (b) => b?.host?.deployment === 'colocated-companion' || LEGACY_UNMARKED_COMPANIONS.has(b?.witnessSha256);

/** Key-sorted JSON. Every key in a bundle or discovery document is ASCII, where this equals RFC 8785's order. */
export const canonicalJSON = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(',')}}`;
};

/** conformance.md §"Canonical JSON": the witnessSha256 preimage, read from the prose. */
export function proseWitnessDigest(b) {
  const rows = [...(b.results?.requirements ?? [])]
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .map((r) => ({ id: r.id, scenario: r.scenario, result: r.result,
      ...(r.assertions === undefined ? {} : { assertions: r.assertions }),
      ...(r.detail === undefined ? {} : { detail: r.detail }),
      ...(r.evidence === undefined ? {} : { evidence: r.evidence }) }));
  const relaxations = b.host?.relaxations ?? [];
  const deployment = b.host?.deployment;
  const preimage = relaxations.length > 0 || deployment !== undefined
    ? { rows, ...(relaxations.length > 0 ? { relaxations } : {}), ...(deployment !== undefined ? { deployment } : {}) }
    : rows;
  return createHash('sha256').update(canonicalJSON(preimage), 'utf8').digest('hex');
}

const fromB64u = (x) => Buffer.from(String(x).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const ed25519KeyFromRaw = (raw) => createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
const attestationPayload = (b) => Buffer.from(canonicalJSON({
  witnessSha256: b.witnessSha256, 'host.build': b.host?.build, 'suite.version': b.suite?.version, 'discovery.sha256': b.discovery?.sha256,
}), 'utf8');

function withoutOrigin(v, origin) {
  if (typeof v === 'string') return origin ? v.split(origin).join('<origin>') : v;
  if (Array.isArray(v)) return v.map((x) => withoutOrigin(x, origin));
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutOrigin(x, origin)]));
  return v;
}
const originOf = (url) => { try { return new URL(url).origin; } catch { return undefined; } };

/** §C.9(d): the document with its origin set aside and the `oidc` lane's `issuers` removed. Nothing else. */
export function normalisedDiscovery(bundle) {
  const doc = bundle?.discovery?.document;
  if (!doc || typeof doc !== 'object') return undefined;
  const out = withoutOrigin(doc, originOf(bundle.discovery.url));
  const lanes = out?.auth?.lanes;
  if (Array.isArray(lanes)) {
    out.auth.lanes = lanes.map((l) => {
      if (l?.lane !== 'oidc') return l;
      const { issuers: _dropped, ...rest } = l;
      return rest;
    });
  }
  return out;
}

export const certified = (b) => Array.isArray(b?.claimedProfiles) && b.claimedProfiles.length > 0 && b.claimedProfiles.every((p) => p.certified === true);

/**
 * Why `served` cannot be `companion`'s pair, as a list of reasons (empty = it pairs).
 * Every condition is evaluated, so a fixture that fails for the wrong reason shows it.
 */
export function pairingFailures(companion, served) {
  const why = [];
  if (companion.host?.name !== served.host?.name || (companion.host?.vendor ?? null) !== (served.host?.vendor ?? null)) why.push('same-host');
  const cb = companion.host?.build, pb = served.host?.build;
  if (!(cb?.kind === 'image-digest' && pb?.kind === 'image-digest' && typeof cb.id === 'string' && cb.id === pb.id)) why.push('same-image');
  const sig = companion.signature ?? {};
  const keys = Array.isArray(served.discovery?.document?.signingKeys) ? served.discovery.document.signingKeys : [];
  const key = keys.find((k) => k && k.keyId === sig.keyId && k.use === 'certification-bundle');
  let attributable = false;
  if (key && typeof sig.sig === 'string' && proseWitnessDigest(companion) === companion.witnessSha256) {
    try { attributable = edVerify(null, attestationPayload(companion), ed25519KeyFromRaw(fromB64u(key.publicKey)), fromB64u(sig.sig)); } catch { attributable = false; }
  }
  if (!attributable) why.push('attributable');
  const nc = normalisedDiscovery(companion), np = normalisedDiscovery(served);
  if (!(nc && np && canonicalJSON(nc) === canonicalJSON(np))) why.push('equivalent-discovery');
  return why;
}

/**
 * The ids a companion witnesses: its non-partial `executed-pass` rows on the
 * anchor list, when it is certified and some certified served-host bundle pairs
 * with it. Otherwise none.
 *
 * @param {{ name: string, bundle: object }} companion
 * @param {{ name: string, bundle: object }[]} bundles  every committed bundle (companions are skipped as pairs)
 * @param {Set<string>} anchorIds
 * @returns {{ counted: Set<string>, discarded: string[], pairedWith: string | null, failures: Record<string, string[]> }}
 */
export function companionWitness(companion, bundles, anchorIds) {
  const counted = new Set();
  const discarded = [];
  const failures = {};
  let pairedWith = null;
  if (certified(companion.bundle)) {
    for (const p of bundles) {
      if (p === companion || isCompanion(p.bundle) || !certified(p.bundle)) continue;
      const f = pairingFailures(companion.bundle, p.bundle);
      if (f.length === 0) { pairedWith = p.name; break; }
      if (!f.includes('same-host')) failures[p.name] = f;
    }
  }
  for (const r of companion.bundle.results?.requirements ?? []) {
    const partial = typeof r.detail === 'string' && r.detail.startsWith('partial-witness:');
    if (r.result !== 'executed-pass' || partial) continue;
    if (pairedWith && anchorIds.has(r.id)) counted.add(r.id);
    else discarded.push(r.id);
  }
  return { counted, discarded, pairedWith, failures };
}

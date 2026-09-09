/**
 * Suite 2.0.0 — the seams profile (RFC 0168 §C; `openwop-conformance-seams-v2`).
 *
 * v1 scenarios reach the host-sample seams at `/v1/host/sample/…`,
 * `/v1/host/workspace/files…` and `/v1/packs-test/…`. In v2 those operations
 * leave the canonical API for `api/seams-v2.yaml` under `/conformance/seams/…`
 * (RFC 0168 §C.2). Under target major 2 the driver rewrites the v1 seam path
 * to its v2 address, so the 165 scenarios that name a seam keep working
 * without a sweep; the sweep to `seamPath()` is the P3-F polish.
 *
 * How a v2 host advertises the profile: RFC 0168 §C.1 forbids a `testSeams`
 * capability flag and RFC 0169 §C.1 removes the root `profiles[]`; the
 * reconciliation (recorded against RFC 0168 at its flip) is the
 * `conformance` METADATA key (RFC 0169 §A.1a): `conformance.seamsProfile:
 * "openwop-conformance-seams-v2"`. Metadata, not a capability family.
 */
export const SEAMS_PROFILE_ID = 'openwop-conformance-seams-v2';
export const SEAMS_PREFIX = '/conformance/seams';

const V1_SEAM_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/v1\/host\/sample\//, `${SEAMS_PREFIX}/sample/`],
  [/^\/v1\/host\/workspace\/files/, `${SEAMS_PREFIX}/workspace/files`],
  [/^\/v1\/packs-test\//, `${SEAMS_PREFIX}/packs-test/`],
];

/** The v2 address of a v1 seam path; a non-seam path is returned unchanged. */
export function seamPath(v1Path: string): string {
  for (const [re, to] of V1_SEAM_PREFIXES) if (re.test(v1Path)) return v1Path.replace(re, to);
  return v1Path;
}

export function isSeamPath(path: string): boolean {
  return V1_SEAM_PREFIXES.some(([re]) => re.test(path)) || path.startsWith(`${SEAMS_PREFIX}/`);
}

/**
 * Whether a (v2) discovery document advertises the seams profile.
 *
 * **The disposition rule, and it is load-bearing (rc.62).** A scenario that
 * finds this FALSE records `inapplicable`, never `blocked`. The host has not
 * claimed the instrument, so the obligation is out of scope for it — the same
 * sense as `softSkip('inapplicable', 'host does not advertise X')` in
 * `soft-skip.ts`. `blocked` is reserved for the DIFFERENT fact one line later
 * in several of these files: the profile IS advertised and the seam answers
 * 404 — an obligation the host took on and the suite could not measure.
 *
 * Why it matters that these are not the same. `blocked` is bundle-wide fatal
 * (`verifyBundleV3` `blocked-certified`, RFC 0168 §E.1). Until rc.62 fifteen
 * scenarios recorded `blocked` on an ABSENT advert while the seams profile's
 * predicate was empty — and an empty predicate is vacuously satisfied, so
 * `claimedProfilesForV2` claimed the profile for every v2 host. Together that
 * denied certification of EVERY profile to any host that had simply not
 * mounted the conformance seams: 19 of MyndHyve's 45 blocked rows and 9 of
 * openwop-workflow-engine's 29, on hosts that never advertised the profile
 * they were being held to. Mounting test-only surface is not a precondition of
 * certifying `openwop-discovery-core`, and a barrier of that shape falls
 * hardest on the independent implementers the v1 end-of-support clock needs.
 *
 * The predicate (`spec/v2/declaration.json`) now requires `conformance` at the
 * discovery root, which is NECESSARY but not sufficient; this function is the
 * sufficient test, applied per scenario. A host with a `conformance` block
 * naming some other profile claims seams-v2, records every floor row
 * `inapplicable`, witnesses nothing, and so certifies nothing — without a
 * single blocked row. Claimed-and-unwitnessed and not-claimed are both honest;
 * blocked-because-unclaimed was not.
 */
export function seamsProfileAdvertised(doc: Readonly<Record<string, unknown>> | null | undefined): boolean {
  const conf = doc?.['conformance'];
  return typeof conf === 'object' && conf !== null && (conf as Record<string, unknown>)['seamsProfile'] === SEAMS_PROFILE_ID;
}

/** The target major the runner selected (RFC 0168 §D.3); 1 when unset. */
export function targetMajor(): 1 | 2 {
  return process.env['OPENWOP_TARGET_MAJOR'] === '2' ? 2 : 1;
}

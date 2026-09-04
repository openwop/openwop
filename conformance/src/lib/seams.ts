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

/** Whether a (v2) discovery document advertises the seams profile. */
export function seamsProfileAdvertised(doc: Readonly<Record<string, unknown>> | null | undefined): boolean {
  const conf = doc?.['conformance'];
  return typeof conf === 'object' && conf !== null && (conf as Record<string, unknown>)['seamsProfile'] === SEAMS_PROFILE_ID;
}

/** The target major the runner selected (RFC 0168 §D.3); 1 when unset. */
export function targetMajor(): 1 | 2 {
  return process.env['OPENWOP_TARGET_MAJOR'] === '2' ? 2 : 1;
}

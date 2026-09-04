/**
 * Corpus-stamp digest verification (v2 charter Phase 1, suite 1.154.0).
 *
 * The published suite vendors `api/` and `schemas/` at `prepack` and writes
 * `schemas/CORPUS-STAMP.json` (RFC 0145 G2) — until 1.154.0 that stamp carried
 * only `suiteVersion` + `corpusCommit`, so a tarball whose vendored files had
 * been altered, partially copied, or hand-patched after install still read as
 * "the 1.x contract". That is the generated-surface-drift class the charter's
 * §A names (`@openwop/openwop-conformance@1.138.1` on npm was not the 1.138.1 in
 * the tree), one layer down: the package identified its corpus by a commit
 * hash it could not check.
 *
 * From 1.154.0 the stamp also carries `files`: a map of every vendored path
 * (relative to the package root) to its SHA-256. In the PUBLISHED layout the
 * suite verifies the map at global setup and refuses to run on a mismatch —
 * a suite that validated a host against a schema it did not ship would be
 * evidence about nothing. In the REPO layout (a spec checkout) there is no
 * vendored copy and nothing to verify; the check is skipped and says so.
 *
 * Three outcomes, never folded (OK / FAIL / UNKNOWN): `verified` when every
 * digest matches; `mismatch` (throws) when any file is missing or altered;
 * `not-applicable` when the layout is not published or the stamp predates
 * 1.154.0 (older tarballs cannot be verified and the run says so rather than
 * pretending).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep, dirname } from 'node:path';

export interface CorpusStamp {
  readonly suiteVersion?: string;
  readonly corpusCommit?: string;
  /** `<relative path>` → lowercase hex SHA-256. Present from suite 1.154.0. */
  readonly files?: Readonly<Record<string, string>>;
}

export type StampVerdict =
  | { readonly kind: 'verified'; readonly files: number }
  | { readonly kind: 'not-applicable'; readonly reason: string }
  | { readonly kind: 'mismatch'; readonly missing: readonly string[]; readonly altered: readonly string[]; readonly extra: readonly string[] }
  /**
   * The peer is INSTALLED and INTACT but is a different version than the suite
   * was packed against. Its own kind because the remedy is completely different
   * from a digest mismatch — nothing is corrupt, two versions are simply out of
   * step — and because the generic message sends readers to debug a broken
   * install. Reported by a tier-2 host that hit it through the `next` dist-tag:
   * the tag moves per package, so `@next` can name an exact-peer PAIR that was
   * never published together.
   */
  | { readonly kind: 'peer-version'; readonly peerVersion: string; readonly lockVersion: string };

export const STAMP_RELATIVE_PATH = join('schemas', 'CORPUS-STAMP.json');

/** SHA-256 of a file's bytes, lowercase hex. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every regular file under `dir`, as package-relative POSIX paths, sorted. */
export function listVendoredFiles(root: string, dirs: readonly string[] = ['api', 'schemas']): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p).split(sep).join('/'));
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out.filter((p) => p !== STAMP_RELATIVE_PATH.split(sep).join('/')).sort();
}

/** Build the `files` map for a package root (used by pack-vendor at prepack). */
export function digestVendoredFiles(root: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rel of listVendoredFiles(root)) map[rel] = sha256File(join(root, ...rel.split('/')));
  return map;
}

/**
 * Compare the stamp's `files` map against the bytes on disk. Pure: reads,
 * never writes, never throws on a mismatch — the caller decides how loud.
 */
/**
 * Suite 2.0.0 (RFC 0168 §D.2): the contract is the `@openwop/spec-artifacts` peer.
 * The suite embeds, at pack time, `dist/spec-artifacts.lock.json` =
 * { version, stampSha256 } for the peer it was built against; at start it
 * resolves the installed peer, recomputes its stamp digest, and refuses to run
 * on a version or digest mismatch (a floating peer makes a bundle
 * irreproducible). The peer's own files are then verified against its stamp.
 */
export function verifyPeerContract(pkgRoot: string): StampVerdict {
  const lockPath = join(pkgRoot, 'dist', 'spec-artifacts.lock.json');
  if (!existsSync(lockPath)) return { kind: 'not-applicable', reason: 'dist/spec-artifacts.lock.json is absent — a repo checkout, not a packed 2.x suite' };
  let lock: { version: string; stampSha256: string };
  try { lock = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { return { kind: 'mismatch', missing: ['dist/spec-artifacts.lock.json'], altered: [], extra: [] }; }
  let peerRoot: string;
  try { peerRoot = dirname(createRequire(join(pkgRoot, 'package.json')).resolve('@openwop/spec-artifacts/package.json')); }
  catch { return { kind: 'mismatch', missing: ['node_modules/@openwop/spec-artifacts (peer dependency not installed)'], altered: [], extra: [] }; }
  const stampPath = join(peerRoot, 'CORPUS-STAMP.json');
  if (!existsSync(stampPath)) return { kind: 'mismatch', missing: ['@openwop/spec-artifacts/CORPUS-STAMP.json'], altered: [], extra: [] };
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8')) as { package: string; version: string; files: Record<string, string> };
  const digest = createHash('sha256').update(JSON.stringify({ package: stamp.package, version: stamp.version, files: stamp.files })).digest('hex');
  // A plain version difference is NOT corruption; report it as itself so the
  // message names the two versions and the fix, instead of sending the reader
  // to hunt a damaged install.
  if (stamp.version !== lock.version) return { kind: 'peer-version', peerVersion: stamp.version, lockVersion: lock.version };
  if (digest !== lock.stampSha256) return { kind: 'mismatch', missing: [], altered: [`@openwop/spec-artifacts ${stamp.version} stamp digest ${digest.slice(0, 12)} ≠ the suite's lock ${lock.stampSha256.slice(0, 12)} — same version, different contents`], extra: [] };
  const missing: string[] = []; const altered: string[] = [];
  for (const [rel, d] of Object.entries(stamp.files)) { const p = join(peerRoot, ...rel.split('/')); if (!existsSync(p)) missing.push(rel); else if (sha256File(p) !== d) altered.push(rel); }
  if (missing.length || altered.length) return { kind: 'mismatch', missing, altered, extra: [] };
  return { kind: 'verified', files: Object.keys(stamp.files).length };
}

export function verifyCorpusStamp(root: string, layout: string): StampVerdict {
  if (layout !== 'published') {
    return { kind: 'not-applicable', reason: `layout is '${layout}' — the vendored copy exists only in the published package` };
  }
  const stampPath = join(root, STAMP_RELATIVE_PATH);
  if (!existsSync(stampPath)) {
    return { kind: 'not-applicable', reason: 'schemas/CORPUS-STAMP.json is absent — not a packed suite' };
  }
  let stamp: CorpusStamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8')) as CorpusStamp;
  } catch (e) {
    return { kind: 'mismatch', missing: [STAMP_RELATIVE_PATH], altered: [], extra: [] };
  }
  if (stamp.files === undefined) {
    return { kind: 'not-applicable', reason: `stamp ${stamp.suiteVersion ?? '?'} predates per-file digests (suite < 1.154.0); the vendored contract cannot be verified` };
  }
  const expected = stamp.files;
  const onDisk = new Set(listVendoredFiles(root));
  const missing: string[] = [];
  const altered: string[] = [];
  for (const [rel, digest] of Object.entries(expected).sort()) {
    const p = join(root, ...rel.split('/'));
    if (!existsSync(p)) {
      missing.push(rel);
      continue;
    }
    if (sha256File(p) !== digest) altered.push(rel);
    onDisk.delete(rel);
  }
  const extra = [...onDisk].sort();
  if (missing.length > 0 || altered.length > 0 || extra.length > 0) return { kind: 'mismatch', missing, altered, extra };
  return { kind: 'verified', files: Object.keys(expected).length };
}

/** One-line, greppable rendering for the run log. */
export function describeVerdict(v: StampVerdict): string {
  switch (v.kind) {
    case 'verified':
      return `[openwop-conformance] corpus stamp VERIFIED — ${v.files} vendored api/ + schemas/ files match their SHA-256 digests`;
    case 'not-applicable':
      return `[openwop-conformance] corpus stamp not checked — ${v.reason}`;
    case 'peer-version':
      return (
        `[openwop-conformance] peer version MISMATCH — this suite was packed against ` +
        `@openwop/spec-artifacts@${v.lockVersion} but @openwop/spec-artifacts@${v.peerVersion} is installed. ` +
        `Nothing is corrupt: the two are declared EXACT peers and are simply out of step. ` +
        `Install both at the same explicit version — never at a dist-tag such as \`next\`, which moves per package ` +
        `and can therefore name a pair that was never published together.`
      );
    case 'mismatch':
      return (
        `[openwop-conformance] corpus stamp MISMATCH — the vendored contract is not the one this suite shipped ` +
        `(missing ${v.missing.length}, altered ${v.altered.length}, extra ${v.extra.length}): ` +
        [...v.missing.map((f) => `missing ${f}`), ...v.altered.map((f) => `altered ${f}`), ...v.extra.map((f) => `extra ${f}`)].slice(0, 12).join('; ')
      );
  }
}

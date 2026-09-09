#!/usr/bin/env node
/**
 * RFC 0168 §D.2 — build the committed contents of spec-artifacts/ from the corpus:
*   api/…             (openapi.yaml, asyncapi.yaml, grpc/, v2/, seams-v2.yaml, redocly configs)
 *   schemas/ (all)     (v1 flat + envelopes/, v2/)
 *   spec/v1/*.json    (the registries + their schemas)
 *   spec/v2/ (all json) (declaration, profiles, errors, codemap, path manifest, facets, release)
 *   spec/v2/**\/*.md    (the normative v2 prose)
 *
 * The prose ships because the JSON does not stand alone. `persistence.md` §The
 * codemap is data calls `spec/v2/event-codemap.json` "the only authority" for
 * the v1→v2 mapping — and the sentences that say how to READ that authority
 * (the seat at the storage boundary, the vendor-prefix carve-out, the refusal
 * code) lived only in the corpus. A host integrator installing this package got
 * the map and not the rules, while `package.json` `files` advertised `spec`;
 * the directory held 35 JSON files and no prose, so the manifest read as though
 * the prose were there. Reported by a certifying host that could not check the
 * sentence its own architecture turns on. v1 prose is NOT shipped: `spec/v1/`
 * is frozen and its consumers have the corpus.
 *   CORPUS-STAMP.json (per-file SHA-256, corpus commit, corpus tag, package version)
 * The copy is committed (not built at prepack) so the digest check runs in the
 * repo layout too (Identity gate) and the tarball is a pure function of the tree.
 *   --write / --check
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'spec-artifacts');
const write = process.argv.includes('--write');
const walk = (d) => existsSync(d) ? readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : [];
const sources = [
  ...walk(join(ROOT, 'api')),
  ...walk(join(ROOT, 'schemas')).filter((p) => !p.endsWith('CORPUS-STAMP.json')),
  ...walk(join(ROOT, 'spec', 'v1')).filter((p) => p.endsWith('.json')),
  ...walk(join(ROOT, 'spec', 'v2')).filter((p) => p.endsWith('.json') || p.endsWith('.md')),
].map((p) => relative(ROOT, p)).sort();
const files = Object.fromEntries(sources.map((rel) => [rel, createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex')]));
const version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;
const release = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'release.json'), 'utf8'));
let commit = 'unknown'; try { commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const stamp = { _comment: 'Provenance of @openwop/spec-artifacts (RFC 0168 §D.2). files: SHA-256 per file; the conformance suite compares the installed peer against dist/spec-artifacts.lock.json at start.', package: '@openwop/spec-artifacts', version, corpusTag: release.corpusTag, files };
const stampDigest = (s) => createHash('sha256').update(JSON.stringify({ package: s.package, version: s.version, files: s.files })).digest('hex');
if (write) {
  for (const d of ['api', 'schemas', 'spec']) rmSync(join(PKG, d), { recursive: true, force: true });
  for (const rel of sources) { const dst = join(PKG, rel); mkdirSync(dirname(dst), { recursive: true }); cpSync(join(ROOT, rel), dst); }
  writeFileSync(join(PKG, 'CORPUS-STAMP.json'), JSON.stringify({ ...stamp, corpusCommit: commit }, null, 2) + '\n');
  console.log(`wrote spec-artifacts/: ${sources.length} files; stamp digest ${stampDigest(stamp).slice(0, 12)}`);
} else {
  const failures = [];
  for (const rel of sources) { const dst = join(PKG, rel); if (!existsSync(dst)) failures.push(`missing ${rel}`); else if (createHash('sha256').update(readFileSync(dst)).digest('hex') !== files[rel]) failures.push(`stale ${rel}`); }
  for (const p of [...walk(join(PKG, 'api')), ...walk(join(PKG, 'schemas')), ...walk(join(PKG, 'spec'))]) { const rel = relative(PKG, p); if (!(rel in files)) failures.push(`extra ${rel} (not in the corpus)`); }
  const onDisk = existsSync(join(PKG, 'CORPUS-STAMP.json')) ? JSON.parse(readFileSync(join(PKG, 'CORPUS-STAMP.json'), 'utf8')) : null;
  if (!onDisk || stampDigest(onDisk) !== stampDigest(stamp)) failures.push('CORPUS-STAMP.json digest differs from the tree');
  if (failures.length) { console.error(`=== generate-spec-artifacts FAILED — ${failures.length} problem(s):\n  ${failures.slice(0, 20).join('\n  ')}\nRun: node scripts/generate-spec-artifacts.mjs --write ===`); process.exit(1); }
  console.log(`=== generate-spec-artifacts OK — ${sources.length} files match the corpus; stamp digest ${stampDigest(stamp).slice(0, 12)} ===`);
}

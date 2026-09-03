#!/usr/bin/env node
/**
 * generate-cross-repo-evidence — resolve the `<repo>:<path>` evidence pointers
 * (v2 charter C.11, Phase 1 item 12).
 *
 * Since the 2026-06 split, SECURITY/invariants.yaml and conformance/coverage.md
 * point at tests and sources in sibling repositories as `<repo>:<path>`. This
 * repo's CI cannot resolve them, so "verified elsewhere" and "not verified"
 * were indistinguishable. This script makes the pointer set a COMMITTED
 * manifest — `evidence/cross-repo-manifests.json`: for every pointer, the
 * sibling repo's commit, whether the path exists there, and its SHA-256 (or
 * `dir: true`) — vendored from the local sibling checkouts when present.
 *
 *   --write   rebuild the manifest from ../<repo> checkouts (fails for a repo
 *             that is not checked out — a manifest cannot be written blind)
 *   --check   every pointer in the two sources has a manifest entry, and the
 *             entry says the path exists; when a sibling checkout is present
 *             locally, its file digest must still match (drift). A missing
 *             sibling is NOT unknown-treated-as-pass: the committed manifest is
 *             the evidence, and the check runs against it.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync as readdirSyncFs } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'evidence', 'cross-repo-manifests.json');
const REPOS = ['openwop-examples', 'openwop-app', 'openwop-registry', 'openwop-sdks'];
const SOURCES = ['SECURITY/invariants.yaml', 'conformance/coverage.md'];
const POINTER_RE = /\b(openwop-examples|openwop-app|openwop-registry|openwop-sdks):([A-Za-z0-9_./-]+)/g;

function pointers() {
  const out = new Map(); // "repo:path" → { repo, path, citedBy: Set }
  for (const src of SOURCES) {
    const text = readFileSync(join(ROOT, src), 'utf8');
    for (const m of text.matchAll(POINTER_RE)) {
      const key = `${m[1]}:${m[2].replace(/[.,;:)]+$/, '')}`;
      const e = out.get(key) ?? { repo: m[1], path: m[2].replace(/[.,;:)]+$/, ''), citedBy: new Set() };
      e.citedBy.add(src);
      out.set(key, e);
    }
  }
  return [...out.values()].sort((a, b) => (a.repo + a.path).localeCompare(b.repo + b.path));
}

/**
 * RFC 0177 §B.2 / RFC 0169 §B.2 — the registry's distinct `peerDependencies`
 * keys with their published-use counts, recorded here so check-declaration.mjs
 * can run the pack_peer_dependency_undefined rule against a COMMITTED inventory
 * instead of a sibling checkout the spec CI does not have. Read from
 * registry/v1/packs/<name>/-/<version>.json (the published manifests).
 */
function registryPeerDependencyKeys(dir) {
  const { readdirSync } = require_fs();
  const packs = join(dir, 'registry', 'v1', 'packs');
  if (!existsSync(packs)) return null;
  const counts = {};
  for (const name of readdirSync(packs)) {
    const vdir = join(packs, name, '-'); if (!existsSync(vdir)) continue;
    for (const f of readdirSync(vdir)) {
      if (!f.endsWith('.json') || f.includes('sbom')) continue;
      try { const m = JSON.parse(readFileSync(join(vdir, f), 'utf8')); for (const k of Object.keys(m.peerDependencies ?? {})) counts[k] = (counts[k] ?? 0) + 1; } catch { /* not a manifest */ }
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
function require_fs() { return { readdirSync: readdirSyncFs }; }

function siblingDir(repo) {
  const d = process.env[`OPENWOP_${repo.toUpperCase().replace(/-/g, '_')}_DIR`] ?? resolve(ROOT, '..', repo);
  return existsSync(join(d, '.git')) ? d : null;
}

function describe(dir, rel) {
  const p = join(dir, rel);
  if (!existsSync(p)) return { exists: false };
  if (statSync(p).isDirectory()) return { exists: true, dir: true };
  return { exists: true, sha256: createHash('sha256').update(readFileSync(p)).digest('hex') };
}

const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : 'report';
const ptrs = pointers();

if (mode === 'write') {
  const repos = {};
  const missingRepo = [];
  for (const repo of REPOS) {
    const dir = siblingDir(repo);
    if (!dir) {
      if (ptrs.some((p) => p.repo === repo)) missingRepo.push(repo);
      continue;
    }
    const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const files = {};
    for (const p of ptrs.filter((p) => p.repo === repo)) files[p.path] = { ...describe(dir, p.path), citedBy: [...p.citedBy].sort() };
    repos[repo] = { commit, files };
  }
  if (missingRepo.length > 0) {
    console.error(`generate-cross-repo-evidence --write: sibling checkout(s) not found for ${missingRepo.join(', ')} — clone them next to this repo (or set OPENWOP_<REPO>_DIR); a manifest cannot be written blind.`);
    process.exit(1);
  }
  const registryDir = siblingDir('openwop-registry');
  // Sibling artifact versions (charter §F "Identity": PROTOCOL-STATUS lists every
  // version axis the umbrella enumerated, including the SDK majors and the CLI).
  // Read from the checkouts at --write and COMMITTED here so the status page is
  // deterministic in a CI that has no siblings.
  const readJson = (d, rel) => { try { return JSON.parse(readFileSync(join(d, rel), 'utf8')); } catch { return null; } };
  const readText = (d, rel) => { try { return readFileSync(join(d, rel), 'utf8'); } catch { return null; } };
  const sdks = siblingDir('openwop-sdks'), cli = siblingDir('openwop-cli'), app = siblingDir('openwop-app'), ex = siblingDir('openwop-examples');
  const siblingVersions = {
    'openwop-sdks': sdks ? { typescript: readJson(sdks, 'sdk/typescript/package.json')?.version ?? null, python: (/^version\s*=\s*"([^"]+)"/m.exec(readText(sdks, 'sdk/python/pyproject.toml') ?? '') ?? [])[1] ?? null, go: (/^## \[(\d+\.\d+\.\d+)\]/m.exec(readText(sdks, 'go/CHANGELOG.md') ?? '') ?? [])[1] ?? null, corpusTag: (readText(sdks, 'CORPUS_TAG') ?? '').trim() || null } : null,
    'openwop-cli': cli ? { version: readJson(cli, 'package.json')?.version ?? null, dependsOnSdk: Boolean(readJson(cli, 'package.json')?.dependencies?.['@openwop/openwop']) } : null,
    'openwop-registry': registryDir ? { registryVersion: readJson(registryDir, 'registry/.well-known/openwop-registry.json')?.registryVersion ?? null, protocolVersion: readJson(registryDir, 'registry/.well-known/openwop-registry.json')?.protocolVersion ?? null, corpusTag: (readText(registryDir, 'CORPUS_TAG') ?? '').trim() || null } : null,
    'openwop-app': app ? { corpusTag: (readText(app, 'schemas/CORPUS_TAG') ?? '').trim() || null, conformancePin: readJson(app, 'backend/typescript/package.json')?.devDependencies?.['@openwop/openwop-conformance'] ?? readJson(app, 'backend/typescript/package.json')?.dependencies?.['@openwop/openwop-conformance'] ?? null } : null,
    'openwop-examples': ex ? { inMemoryHost: readJson(ex, 'examples/hosts/in-memory/package.json')?.version ?? null, conformancePin: readJson(ex, 'examples/hosts/in-memory/package.json')?.devDependencies?.['@openwop/openwop-conformance'] ?? null } : null,
  };
  const manifest = { $comment: 'GENERATED by scripts/generate-cross-repo-evidence.mjs from the sibling checkouts — the committed record of what every <repo>:<path> evidence pointer in SECURITY/invariants.yaml and conformance/coverage.md resolved to, plus the registry\'s distinct peerDependencies keys (RFC 0177 §B.2 inventory read by check-declaration.mjs). Regenerate after a sibling repo moves or renames a cited file.', generated: new Date().toISOString().slice(0, 10), repos, registryPeerDependencyKeys: registryDir ? registryPeerDependencyKeys(registryDir) : null, siblingVersions };
  writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
  const n = Object.values(repos).reduce((a, r) => a + Object.keys(r.files).length, 0);
  const missing = Object.values(repos).flatMap((r) => Object.entries(r.files).filter(([, v]) => !v.exists).map(([k]) => k));
  console.log(`wrote evidence/cross-repo-manifests.json: ${n} pointers across ${Object.keys(repos).length} repos${missing.length ? `; ${missing.length} do NOT exist in the sibling: ${missing.join(', ')}` : ''}`);
} else if (mode === 'check') {
  const failures = [];
  if (!existsSync(OUT)) failures.push('evidence/cross-repo-manifests.json is missing — run generate-cross-repo-evidence.mjs --write');
  else {
    const manifest = JSON.parse(readFileSync(OUT, 'utf8'));
    let verifiedLocally = 0;
    for (const p of ptrs) {
      const entry = manifest.repos?.[p.repo]?.files?.[p.path];
      if (!entry) {
        failures.push(`${p.repo}:${p.path} (cited by ${[...p.citedBy].join(', ')}) has no manifest entry — run --write with the sibling checked out`);
        continue;
      }
      if (!entry.exists) failures.push(`${p.repo}:${p.path} does not exist in ${p.repo}@${manifest.repos[p.repo].commit.slice(0, 9)} — the evidence pointer is dead`);
      const dir = siblingDir(p.repo);
      if (dir && entry.exists && !entry.dir) {
        const now = describe(dir, p.path);
        if (!now.exists) failures.push(`${p.repo}:${p.path} is in the manifest but no longer exists in the local ${p.repo} checkout`);
        else if (now.sha256 !== entry.sha256) failures.push(`${p.repo}:${p.path} changed since the manifest (${entry.sha256.slice(0, 12)} → ${now.sha256.slice(0, 12)}) — re-run --write to re-vendor the evidence record`);
        else verifiedLocally++;
      }
    }
    if (failures.length > 0) {
      console.error(`=== check-cross-repo-evidence FAILED — ${failures.length} problem(s) ===`);
      for (const f of failures.slice(0, 30)) console.error(`  ${f}`);
      process.exit(1);
    }
    console.log(`=== check-cross-repo-evidence OK — ${ptrs.length} pointers resolve in the committed manifest (${verifiedLocally} re-verified against local sibling checkouts) ===`);
  }
} else {
  console.log(JSON.stringify(ptrs.map((p) => `${p.repo}:${p.path}`), null, 2));
}

#!/usr/bin/env node
/**
 * Cross-check every published pack version against the registry's
 * security-advisory feed at `registry/security/advisories.json`.
 *
 * Stage 4 PR 3 (2026-05-12): operational maturity per the enterprise-
 * architecture review. The advisories feed is the registry's own CVE
 * database — version-controlled, signed-via-PR, maintainer-reviewed.
 *
 * For each entry in `registry/security/advisories.json` `advisories[]`:
 *   1. Validate against `schemas/security-advisory.schema.json` (done
 *      by the upstream ajv-validate step in registry-publish.yml; this
 *      script trusts the schema is already enforced).
 *   2. For each `affected[]` row, expand the pack name + SemVer range
 *      against every published version under registry/v1/packs/.
 *   3. For every matching version, verify it has `yanked: true` set in
 *      its version manifest. An advisory targeting a non-yanked version
 *      is a process failure — either the maintainer forgot to yank
 *      when filing the advisory, or the yank PR landed but the
 *      build-index.mjs regenerate step was skipped.
 *
 * Fails the CI gate if ANY non-yanked version matches an active
 * advisory. The fix is one of:
 *   - File a separate yank PR per docs/runbooks/PACK-LIFECYCLE.md §Yank
 *   - Set fixedIn on the advisory + ship the fixed version + yank the
 *     vulnerable one in one PR
 *
 * Pure Node 20 stdlib (no `semver` package) — the SemVer range matcher
 * supports the common syntax we need: bare versions, ` || `, `>=`,
 * `>`, `<=`, `<`, hyphenated ranges, and `<X.Y.Z`. Re-used patterns
 * are stamped against existing manifests; if you author a range this
 * matcher can't parse, you'll get a clear error pointing at the
 * advisory entry.
 *
 * Exits 0 if all advisories cleanly map to yanked versions.
 * Exits 1 on any policy violation.
 *
 * @see schemas/security-advisory.schema.json (advisory shape)
 * @see docs/runbooks/INCIDENT-RESPONSE.md §Incident class 1
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // registry/
const PACKS_ROOT = join(REGISTRY_ROOT, 'v1', 'packs');
const ADVISORIES_PATH = join(REGISTRY_ROOT, 'security', 'advisories.json');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { red: '', green: '', yellow: '', dim: '', reset: '' };
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const fail = (s) => console.error(`${C.red}✗${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}⚠${C.reset} ${s}`);

// ─── minimal SemVer matcher ────────────────────────────────────────
//
// Supports the syntax we actually file in advisories. If you need
// caret/tilde ranges in the future, extend `matchClause` rather than
// reach for the full `semver` npm package — the registry scripts are
// pure-stdlib by design.

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] || null,
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // A version WITH a prerelease ranks BELOW the same version without one.
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease < b.prerelease ? -1 : a.prerelease > b.prerelease ? 1 : 0;
  }
  return 0;
}

/**
 * Match `version` against a single conjunction clause like
 * `>=1.0.0 <1.0.3`. Each space-separated comparator must hold.
 */
function matchClause(version, clause) {
  const target = parseSemver(version);
  if (!target) return false;
  const parts = clause.trim().split(/\s+/);
  for (const part of parts) {
    const m = /^(>=|<=|>|<|=)?\s*(\S+)$/.exec(part);
    if (!m) throw new Error(`unparseable comparator: ${part}`);
    const op = m[1] || '=';
    const rhs = parseSemver(m[2]);
    if (!rhs) throw new Error(`unparseable version in comparator: ${m[2]}`);
    const cmp = compareSemver(target, rhs);
    let ok;
    if (op === '=') ok = cmp === 0;
    else if (op === '>=') ok = cmp >= 0;
    else if (op === '<=') ok = cmp <= 0;
    else if (op === '>') ok = cmp > 0;
    else if (op === '<') ok = cmp < 0;
    else throw new Error(`unsupported comparator: ${op}`);
    if (!ok) return false;
  }
  return true;
}

/** Match `version` against a SemVer range, supporting ` || ` disjunction. */
function semverSatisfies(version, range) {
  for (const clause of range.split('||')) {
    if (matchClause(version, clause)) return true;
  }
  return false;
}

// ─── advisory cross-check ──────────────────────────────────────────

function loadAdvisories() {
  if (!existsSync(ADVISORIES_PATH)) {
    warn(`no advisories file at ${ADVISORIES_PATH}; nothing to check`);
    return [];
  }
  const doc = JSON.parse(readFileSync(ADVISORIES_PATH, 'utf8'));
  return doc.advisories ?? [];
}

function listPackVersions(packName) {
  const versionsDir = join(PACKS_ROOT, packName, '-');
  if (!existsSync(versionsDir)) return [];
  return readdirSync(versionsDir)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => f.slice(0, -4))
    .sort();
}

function isYanked(packName, version) {
  const manifestPath = join(PACKS_ROOT, packName, '-', `${version}.json`);
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return manifest.yanked === true;
}

// ─── main ──────────────────────────────────────────────────────────

function main() {
  if (!existsSync(PACKS_ROOT)) {
    warn('no registry/v1/packs/ directory; nothing to check');
    process.exit(0);
  }

  const advisories = loadAdvisories();
  if (advisories.length === 0) {
    ok('no security advisories on file');
    process.exit(0);
  }

  let totalChecks = 0;
  let violations = 0;

  for (const advisory of advisories) {
    const id = advisory.id;
    if (!Array.isArray(advisory.affected) || advisory.affected.length === 0) {
      fail(`${id}: affected[] is missing or empty`);
      violations++;
      continue;
    }

    for (const row of advisory.affected) {
      const { packName, versions: range, fixedIn } = row;
      const allVersions = listPackVersions(packName);
      if (allVersions.length === 0) {
        // Advisory targets a pack that doesn't exist — likely a typo
        // or a pack that was fully unpublished. Warn rather than fail
        // so renaming-aware operations are smooth, but flag clearly.
        warn(`${id}: affected pack '${packName}' has no published versions`);
        continue;
      }

      let matched = [];
      try {
        matched = allVersions.filter((v) => semverSatisfies(v, range));
      } catch (err) {
        fail(`${id}: affected[].versions='${range}' failed to parse: ${err.message}`);
        violations++;
        continue;
      }

      if (matched.length === 0) {
        warn(`${id}: affected '${packName}@${range}' matched 0 versions (range may be stale)`);
        continue;
      }

      for (const version of matched) {
        totalChecks++;
        if (!isYanked(packName, version)) {
          fail(
            `${id}: ${packName}@${version} matches advisory range '${range}' ` +
              `but version manifest is NOT yanked. ` +
              (fixedIn
                ? `Fix: yank this version (see docs/runbooks/PACK-LIFECYCLE.md §Yank). Consumers should upgrade to >= ${fixedIn}.`
                : `Fix: yank this version. No fixedIn is recorded — consumers have no upgrade path.`)
          );
          violations++;
        }
      }
    }
  }

  console.log('');
  if (violations === 0) {
    ok(
      `${advisories.length} advisory record(s) cross-checked, ` +
        `${totalChecks} affected version(s) all correctly yanked`
    );
    process.exit(0);
  } else {
    fail(`${violations} policy violation(s) — see above`);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
/**
 * Does the version number still identify the contents? (2026-08-25)
 *
 * ## The defect this exists to make impossible
 *
 * `conformance/package.json` read `1.138.1`. npm served `1.138.1`. Twelve
 * suite files — 566 insertions, including a new `globalSetup` and seven
 * scenarios — had landed since that version was published. Two different
 * contents under one version number, so the version had stopped identifying
 * anything: a host pinning `1.138.1` and a reader of this repo were looking
 * at different suites while both believed they were current.
 *
 * Nothing detected it, and that is the part worth fixing. The publish step's
 * guard was:
 *
 *     if npm view "$PKG@$VER" version >/dev/null 2>&1; then skip; fi
 *
 * which asks whether the version EXISTS, not whether it is THIS. A
 * version-number comparison standing in for a content comparison — so the
 * drift's only symptom was a publish step printing "already on npm" and
 * exiting 0, which is exactly what a correct no-op prints.
 *
 * ## What this checks
 *
 * Pack the working tree, fetch the published tarball for the SAME version,
 * and compare per-file SHA-256. Identical ⇒ the version is honest. Different
 * ⇒ fail and name the files, because publishing is now a silent no-op and
 * every downstream claim about "suite X.Y.Z" is ambiguous.
 *
 * ## Three outcomes, and none of them is silence
 *
 *   OK        — published and byte-identical, or not yet published (a fresh
 *               version is exactly what a bump looks like).
 *   FAIL      — published and different. Bump all three pins.
 *   UNKNOWN   — the registry could not be reached. Reported as UNKNOWN and
 *               NOT as a pass, because "I could not look" and "I looked and
 *               it was fine" are different claims. Exit 0 so an offline
 *               `openwop:check` still works; `--require-network` makes it
 *               exit non-zero, which is what the publish preflight uses.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const REQUIRE_NETWORK = process.argv.includes('--require-network');
const ROOT = new URL('..', import.meta.url).pathname;
const PKG_DIR = join(ROOT, 'conformance');

/** Files npm adds or rewrites at publish time — comparing them proves nothing. */
const IGNORED = new Set(['package.json']);

/**
 * `dist/` is BUILT during publish (`npm run build:cli`), so a working tree that
 * has not run the generator lacks it and every published `dist/` file reads as
 * "removed". Excluding it loses no coverage: `dist/` is a pure function of
 * `src/` + tsconfig, so if `src/` is identical the emitted output is too — and
 * `src/` is compared in full. Comparing generated output against a tree that
 * has not run the generator is comparing the wrong thing, not comparing
 * strictly.
 */
const IGNORED_PREFIXES = ['dist/'];

/**
 * Fail fast rather than sit through npm's retry backoff. An offline developer
 * should see UNKNOWN in about a second, not wait out exponential retries — a
 * slow check is one people learn to skip, and a skipped check is no check.
 */
const FAST_FAIL = ['--fetch-retries=0', '--fetch-retry-maxtimeout=3000', '--fetch-timeout=8000'];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** npm, with the fast-fail flags appended. Calls execFileSync via `run`, never itself. */
function npm(args, opts = {}) {
  return execFileSync('npm', [...args, ...FAST_FAIL], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** Every file in an extracted `package/` dir → sha256, keyed by relative path. */
function digestTree(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const rel = relative(dir, p);
        if (IGNORED.has(rel) || IGNORED_PREFIXES.some((pre) => rel.startsWith(pre))) continue;
        out.set(rel, createHash('sha256').update(readFileSync(p)).digest('hex'));
      }
    }
  };
  walk(dir);
  return out;
}

function extractInto(tarball, dir) {
  run('tar', ['xzf', tarball, '-C', dir]);
  return join(dir, 'package');
}

const { name, version } = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const spec = `${name}@${version}`;
process.stdout.write(`=== check-published-suite-identity — does ${spec} still identify its contents? ===\n`);

// 1. Is this version published at all? Distinguish "not published" from "cannot reach".
let published;
try {
  npm(['view', spec, 'version'], { cwd: PKG_DIR });
  published = true;
} catch (err) {
  const stderr = String(err.stderr ?? '');
  if (/E404|is not in this registry|No match found/i.test(stderr)) {
    published = false;
  } else {
    // Network, auth, registry outage — NOT evidence of anything about contents.
    process.stdout.write(
      `  UNKNOWN — could not reach the registry to look up ${spec}.\n` +
        `  This is NOT a pass: "could not look" and "looked and it matched" are different claims.\n` +
        `  ${stderr.trim().split('\n').slice(0, 2).join(' / ')}\n`,
    );
    process.exit(REQUIRE_NETWORK ? 2 : 0);
  }
}

if (!published) {
  process.stdout.write(
    `  OK — ${spec} is not on npm yet, so publishing will create it. A fresh version is what a bump looks like.\n`,
  );
  process.exit(0);
}

// 2. Published. Compare the working tree's packed contents against it.
const work = mkdtempSync(join(tmpdir(), 'owp-suite-identity-'));
try {
  const localDir = join(work, 'local');
  const remoteDir = join(work, 'remote');
  run('mkdir', ['-p', localDir, remoteDir]);

  const localTgz = npm(['pack', '--silent', '--pack-destination', localDir], { cwd: PKG_DIR }).trim().split('\n').pop();
  const remoteTgz = npm(['pack', '--silent', '--pack-destination', remoteDir, spec], { cwd: PKG_DIR }).trim().split('\n').pop();

  const local = digestTree(extractInto(join(localDir, localTgz), localDir));
  const remote = digestTree(extractInto(join(remoteDir, remoteTgz), remoteDir));

  const changed = [...local.keys()].filter((k) => remote.has(k) && remote.get(k) !== local.get(k)).sort();
  const added = [...local.keys()].filter((k) => !remote.has(k)).sort();
  const removed = [...remote.keys()].filter((k) => !local.has(k)).sort();
  const drift = [
    ...changed.map((f) => `modified  ${f}`),
    ...added.map((f) => `added     ${f}`),
    ...removed.map((f) => `removed   ${f}`),
  ];

  if (drift.length === 0) {
    process.stdout.write(`  OK — ${spec} on npm is byte-identical to this tree (${local.size} files compared).\n`);
    process.exit(0);
  }

  process.stderr.write(
    `\n  FAIL — ${spec} is published, and this tree is NOT what was published.\n` +
      `  ${drift.length} file(s) differ:\n\n` +
      drift.slice(0, 40).map((l) => `    ${l}\n`).join('') +
      (drift.length > 40 ? `    ... and ${drift.length - 40} more\n` : '') +
      `\n  The version number no longer identifies the contents. Anyone who installed\n` +
      `  ${spec} has different scenarios from this repo, and both believe they are current.\n\n` +
      `  This is a HARD blocker on tagging: the publish step skips when the version\n` +
      `  already exists, so a release tag would go green and ship nothing, leaving\n` +
      `  every claim about "suite ${version}" ambiguous.\n\n` +
      `  Fix: bump all THREE pins together —\n` +
      `    conformance/package.json                       "version"\n` +
      `    scripts/openwop-check-publish-metadata.sh      EXPECTED_CONFORMANCE_VERSION\n` +
      `    scripts/check-npm-pack-contents.sh             conformancePack.version\n`,
  );
  process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}

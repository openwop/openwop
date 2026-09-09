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
// Suite 2.0.0: two published packages share this identity rule — pass
// `--package spec-artifacts` for the contract package (default: conformance).
const pkgArg = process.argv.indexOf('--package');
const PKG_DIR = join(ROOT, pkgArg >= 0 ? process.argv[pkgArg + 1] : 'conformance');

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
 * Fail fast rather than sit through npm's retry backoff — a slow check is one
 * people learn to skip, and a skipped check is no check.
 *
 * `--fetch-retries=0` ONLY. An earlier version also passed
 * `--fetch-retry-maxtimeout=3000`, which is below npm's default
 * `fetch-retry-mintimeout` of 10000; npm 11.6 accepts that, and the npm in CI
 * rejects it outright with "minTimeout is greater than maxTimeout" — so the
 * check reported UNKNOWN on every CI run and exited 0. It was not measuring
 * anything, and the gate stayed green. Enforce the wall clock HERE (see
 * `timeout` below) rather than through registry config whose validation varies
 * by npm version.
 */
const FAST_FAIL = ['--fetch-retries=0'];

/** Hard wall-clock ceiling, ours rather than npm's, so it behaves identically everywhere. */
const NPM_TIMEOUT_MS = 30_000;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** npm, with the fast-fail flags appended. Calls execFileSync via `run`, never itself. */
function npm(args, opts = {}) {
  return execFileSync('npm', [...args, ...FAST_FAIL], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: NPM_TIMEOUT_MS,
    ...opts,
  });
}

/**
 * `schemas/CORPUS-STAMP.json` records the provenance of the vendored schema
 * copy — `suiteVersion` plus `corpusCommit`, which is `git rev-parse HEAD` at
 * pack time. `corpusCommit` therefore changes on EVERY commit, whether or not
 * a single shipped byte moved.
 *
 * Comparing it would make this check fail on every commit after a publish
 * until the next suite bump — including a CHANGELOG-only PR, which is exactly
 * how it was caught. A gate that cries wolf on every commit is a gate someone
 * turns off, so this one compares the stamp's MEANING instead: `suiteVersion`
 * still matters (a stamp claiming the wrong suite version is real drift and
 * still fails), `corpusCommit` is a provenance label, not contract content.
 *
 * The distinction is the same one the whole check rests on: two tarballs with
 * identical schemas and different `corpusCommit` are the same contract.
 */
const STAMP_PATH = 'schemas/CORPUS-STAMP.json';
const STAMP_VOLATILE_KEYS = ['corpusCommit'];

function stampDigest(buf) {
  try {
    const o = JSON.parse(buf.toString('utf8'));
    for (const k of STAMP_VOLATILE_KEYS) delete o[k];
    return createHash('sha256').update(canonicalJson(o)).digest('hex');
  } catch {
    // Unparseable stamp — fall back to raw bytes rather than silently passing.
    return createHash('sha256').update(buf).digest('hex');
  }
}

/** Stable key order so the digest depends on content, not serialisation order. */
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
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
        const buf = readFileSync(p);
        out.set(rel, rel === STAMP_PATH ? stampDigest(buf) : createHash('sha256').update(buf).digest('hex'));
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
    // Network, auth, registry outage, or a malformed flag — NOT evidence of
    // anything about contents.
    //
    // In CI this is a FAILURE, not a tolerated skip. CI has a registry, so
    // "could not look" there means the check itself is broken — which is
    // exactly what happened: an invalid `--fetch-retry-maxtimeout` made every
    // CI run report UNKNOWN and exit 0, a dead gate that stayed green. Local
    // runs stay tolerant so offline work is unaffected.
    const strict = REQUIRE_NETWORK || process.env['CI'] === 'true';
    process.stdout.write(
      `  UNKNOWN — could not reach the registry to look up ${spec}.\n` +
        `  This is NOT a pass: "could not look" and "looked and it matched" are different claims.\n` +
        `  ${stderr.trim().split('\n').slice(0, 2).join(' / ')}\n` +
        (strict
          ? `  Treating UNKNOWN as a FAILURE: this environment is expected to reach the registry,\n` +
            `  so an unreachable lookup means the check is broken rather than the network absent.\n`
          : `  Tolerated locally (exit 0) so offline work is unaffected.\n`),
    );
    process.exit(strict ? 2 : 0);
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

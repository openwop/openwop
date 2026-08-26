#!/usr/bin/env node
/**
 * Does the README advertise the versions the registries actually serve? (2026-08-26)
 *
 * ## Why this is separate from the generator's check
 *
 * `generate-protocol-status.mjs` asserts the README's `@openwop/openwop-conformance`
 * version against `conformance/package.json` — a fact that lives in this repo and is
 * knowable with no network. The other three artifacts on that same banner line ship
 * from `openwop-sdks`, so **only a registry knows their versions**. Mixing a
 * sometimes-runnable check into an always-runnable one degrades the latter: the
 * combined thing then has to tolerate UNKNOWN, and a gate that tolerates UNKNOWN in
 * the environment that can't legitimately produce it is how a dead gate stays green.
 * The split is the point.
 *
 * ## What went wrong
 *
 * The banner advertised `@openwop/openwop` v1.6.1 (npm served 1.8.0),
 * `openwop-client` v1.5.0 (PyPI served 1.6.0), and the conformance suite v1.73.0
 * (npm served 1.139.0 — stale by 66 minors, in two places on one line). Only the Go
 * module was right. None of it was caught here; a downstream consumer found it while
 * syncing openwop.dev, and had already shipped one of the numbers to the public site
 * on the strength of this line being authoritative. It was.
 *
 * ## Outcomes — three, and none of them is silence
 *
 *   OK       every advertised version matches what the registry serves
 *   FAIL     a mismatch, naming the artifact, the claim, and the truth
 *   UNKNOWN  a registry could not be reached — reported as UNKNOWN, never folded
 *            into OK, because "could not look" and "looked and it matched" are
 *            different claims. Exits 0 locally so offline work is unaffected;
 *            exits 2 under --require-network or CI=true, where an unreachable
 *            registry means this check is broken rather than the network absent.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const STRICT = process.argv.includes('--require-network') || process.env['CI'] === 'true';
const ROOT = new URL('..', import.meta.url).pathname;
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const TIMEOUT_MS = 30_000;

/** Each artifact: how the README names it, and how to ask its registry. */
const ARTIFACTS = [
  {
    name: '@openwop/openwop (npm)',
    // Anchor on the package link so a version-format change is a hard failure,
    // not a silent skip (see the generator's per-site lesson).
    anchor: /@openwop\/openwop`\]\([^)]*\) \(npm[^)]*\)/g,
    version: /@openwop\/openwop`\]\([^)]*\) \(npm, \*\*v([0-9][0-9.]*)\*\*\)/g,
    fetch: () => execFileSync('npm', ['view', '@openwop/openwop', 'version', '--fetch-retries=0'],
      { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  },
  {
    name: 'openwop-client (PyPI)',
    anchor: /openwop-client`\]\([^)]*\) \(PyPI[^)]*\)/g,
    version: /openwop-client`\]\([^)]*\) \(PyPI, \*\*v([0-9][0-9.]*)\*\*\)/g,
    fetch: () => JSON.parse(execFileSync('curl', ['-fsS', '--max-time', '20', 'https://pypi.org/pypi/openwop-client/json'],
      { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] })).info.version,
  },
  {
    name: 'openwop-sdks/go (Go modules)',
    anchor: /openwop-sdks\/go`\]\([^)]*\) \(Go modules[^)]*\)/g,
    version: /openwop-sdks\/go`\]\([^)]*\) \(Go modules, \*\*v([0-9][0-9.]*)\*\*\)/g,
    // The proxy returns `v1.5.0`; the README writes `**v1.5.0**`. Strip the `v`
    // on both sides rather than comparing one shape to the other.
    fetch: () => JSON.parse(execFileSync('curl', ['-fsS', '--max-time', '20', 'https://proxy.golang.org/github.com/openwop/openwop-sdks/go/@latest'],
      { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] })).Version.replace(/^v/, ''),
  },
];

process.stdout.write('=== check-advertised-versions — does the README match what the registries serve? ===\n');

const findings = [];
const unknown = [];

for (const a of ARTIFACTS) {
  const anchors = [...README.matchAll(a.anchor)];
  const claims = [...README.matchAll(a.version)];
  if (anchors.length === 0) {
    findings.push(`${a.name}: not found on the README published-artifacts line at all — did the line change?`);
    continue;
  }
  if (anchors.length !== claims.length) {
    findings.push(`${a.name}: named ${anchors.length}x but only ${claims.length} carry a parseable version — the format changed, update this check rather than letting it skip.`);
    continue;
  }
  let actual;
  try {
    actual = a.fetch();
  } catch (err) {
    unknown.push(`${a.name}: ${String(err.stderr ?? err.message ?? err).trim().split('\n')[0].slice(0, 120)}`);
    continue;
  }
  for (const m of claims) {
    if (m[1] !== actual) {
      findings.push(`${a.name}: README advertises v${m[1]}, registry serves ${actual}.`);
    } else {
      process.stdout.write(`  ok  ${a.name} — v${m[1]}\n`);
    }
  }
}

if (unknown.length > 0) {
  process.stdout.write(
    `  UNKNOWN — ${unknown.length} registry lookup(s) could not be completed:\n`
    + unknown.map((u) => `    ${u}\n`).join('')
    + '  This is NOT a pass: "could not look" and "looked and it matched" are different claims.\n'
    + (STRICT
      ? '  Treating UNKNOWN as a FAILURE: this environment is expected to reach the registries.\n'
      : '  Tolerated locally (exit 0) so offline work is unaffected.\n'),
  );
}

if (findings.length > 0) {
  process.stderr.write(
    '\n  FAIL — the README advertises versions the registries do not serve:\n'
    + findings.map((f) => `    ${f}\n`).join('')
    + '\n  This line is treated as authoritative by downstream consumers — openwop.dev sourced\n'
    + '  a public claim from it. Fix the README, or publish the version it promises.\n',
  );
  process.exit(1);
}

if (unknown.length > 0 && STRICT) process.exit(2);
process.stdout.write('=== check-advertised-versions OK — every advertised version matches its registry ===\n');

#!/usr/bin/env node
/**
 * RFC 0156 acceptance item "governance, security, … documents agree" — the
 * part of "agree" that is a NUMBER and can therefore be checked instead of
 * asserted.
 *
 * Three tallies are hand-typed into prose and drift every time the thing they
 * count moves:
 *   1. SECURITY/invariants.yaml row counts (total / protocol / reference-impl /
 *      advisory) as stated in SECURITY.md §8 and the README banner;
 *   2. the number of scenario files under conformance/src/scenarios/ as stated
 *      twice in conformance/README.md.
 * `generate-protocol-status.mjs` already gates the RFC and spec-doc counts;
 * this script gates the two it does not. It reads the live tree, extracts the
 * stated numbers with anchored regexes (so a paragraph rewrite that drops the
 * phrase fails loudly rather than silently passing), and exits 1 on any
 * mismatch with the exact fix.
 *
 *   node scripts/check-doc-tallies.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const failures = [];
const check = (label, stated, actual, where) => {
  if (stated === null) failures.push(`${where}: could not find the ${label} tally phrase — the anchored sentence was rewritten; restore it or update this gate`);
  else if (stated !== actual) failures.push(`${where}: says ${label} = ${stated}, tree has ${actual}`);
};

// 1. invariants.yaml tallies
const yaml = read('SECURITY/invariants.yaml');
const tiers = { total: 0, protocol: 0, 'reference-impl': 0, advisory: 0 };
for (const m of yaml.matchAll(/^\s*-\s*id:\s*\S+\s*\n\s*tier:\s*(\S+)/gm)) {
  tiers.total++;
  if (m[1] in tiers) tiers[m[1]]++;
}
const sec = read('SECURITY.md');
const secM = sec.match(/\((\d+) rows as of \d{4}-\d{2}-\d{2}: (\d+) protocol-tier, (\d+) reference-impl-tier, (\d+) advisory\)/);
check('invariant total', secM ? Number(secM[1]) : null, tiers.total, 'SECURITY.md');
check('protocol-tier', secM ? Number(secM[2]) : null, tiers.protocol, 'SECURITY.md');
check('reference-impl-tier', secM ? Number(secM[3]) : null, tiers['reference-impl'], 'SECURITY.md');
check('advisory', secM ? Number(secM[4]) : null, tiers.advisory, 'SECURITY.md');
const readme = read('README.md');
const rdM = readme.match(/(\d+) invariants in \[`SECURITY\/invariants\.yaml`\]\(\.\/SECURITY\/invariants\.yaml\)[^\n]{0,12}? (\d+) protocol-tier \(verified at the spec gate[^)]*\)\), (\d+) reference-impl-tier \(verified by reference impls' CI\), (\d+) advisory\./);
check('invariant total', rdM ? Number(rdM[1]) : null, tiers.total, 'README.md');
check('protocol-tier', rdM ? Number(rdM[2]) : null, tiers.protocol, 'README.md');
check('reference-impl-tier', rdM ? Number(rdM[3]) : null, tiers['reference-impl'], 'README.md');
check('advisory', rdM ? Number(rdM[4]) : null, tiers.advisory, 'README.md');

// 2. scenario file count
const scenarioCount = readdirSync(resolve(ROOT, 'conformance/src/scenarios')).filter((f) => f.endsWith('.test.ts')).length;
const cr = read('conformance/README.md');
const c1 = cr.match(/The current suite has (\d+) scenario files under `src\/scenarios\/`\./);
const c2 = cr.match(/Current source tree: (\d+) scenario files\./);
check('scenario files (intro)', c1 ? Number(c1[1]) : null, scenarioCount, 'conformance/README.md');
check('scenario files (footer)', c2 ? Number(c2[1]) : null, scenarioCount, 'conformance/README.md');

if (failures.length > 0) {
  console.error('doc tallies DISAGREE with the tree:');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`tree: invariants ${tiers.total} (${tiers.protocol} protocol / ${tiers['reference-impl']} reference-impl / ${tiers.advisory} advisory); ${scenarioCount} scenario files`);
  process.exit(1);
}
console.log(`=== check-doc-tallies OK — SECURITY.md / README.md / conformance/README.md agree with the tree (invariants ${tiers.total}: ${tiers.protocol}/${tiers['reference-impl']}/${tiers.advisory}; ${scenarioCount} scenario files) ===`);

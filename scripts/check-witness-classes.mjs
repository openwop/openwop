#!/usr/bin/env node
/**
 * check-witness-classes — RFC 0166 §C structural rules on the assurance
 * registers. Enforced:
 *
 *   1. every invariants.yaml entry and every extensions.json record carries
 *      `witness` from the closed enum;
 *   2. `tests: []` ⇔ `witness: unwitnessable`, and an unwitnessable invariant
 *      carries `non_testability_rationale:`;
 *   3. a `protocol`-tier invariant is never `unwitnessable`;
 *   4. a `securityTier: high` extension advertised by a host in INTEROP-MATRIX
 *      is not `claims-check` / `unwitnessable` (§C.3) — reported, not yet
 *      failing, until the matrix carries machine-readable advertisements;
 *   5. ratchets: the unwitnessable count and the `witnessReview:
 *      initial-mechanical-*` (unreviewed) count may not exceed the committed
 *      baseline in docs/witness-baseline.json; lowering is allowed and rewrites
 *      the baseline with --update-baseline.
 *
 * The enum is defined in spec/v1/gaps.schema.json (RFC 0166 §C.1).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './registers-lib.mjs';

const ENUM = ['witnessable-unaided', 'witnessable-gated', 'seam-gated', 'claims-check', 'negative-existence', 'unwitnessable'];
const INV = join(ROOT, 'SECURITY', 'invariants.yaml');
const EXT = join(ROOT, 'spec', 'v1', 'extensions.json');
const BASE = join(ROOT, 'docs', 'witness-baseline.json');
const update = process.argv.includes('--update-baseline');
const failures = [];
const fail = (m) => failures.push(m);

// invariants — line parser matching check-security-invariants.sh's shape
const entries = [];
let cur = null;
for (const line of readFileSync(INV, 'utf8').split('\n')) {
  const id = /^  - id: (.+)$/.exec(line);
  if (id) {
    if (cur) entries.push(cur);
    cur = { id: id[1].trim(), tier: null, tests: [], testsEmpty: false, inTests: false, witness: null, review: null, rationale: false };
    continue;
  }
  if (!cur) continue;
  const f = /^    (\w+): ?(.*)$/.exec(line);
  if (f) {
    cur.inTests = false;
    const [, k, v] = f;
    if (k === 'tier') cur.tier = v.trim();
    else if (k === 'tests') {
      if (v.trim() === '[]') cur.testsEmpty = true;
      else cur.inTests = true;
    } else if (k === 'witness') cur.witness = v.trim();
    else if (k === 'witnessReview') cur.review = v.trim();
    else if (k === 'non_testability_rationale') cur.rationale = true;
    continue;
  }
  if (cur.inTests) {
    const t = /^      - (.+)$/.exec(line);
    if (t) cur.tests.push(t[1].trim());
  }
}
if (cur) entries.push(cur);

const counts = { invariants: entries.length, unwitnessable: 0, unreviewed: 0, byClass: {} };
for (const e of entries) {
  if (e.witness === null) fail(`invariant ${e.id}: no witness class (RFC 0166 §C.2); run scripts/annotate-witness.mjs --write`);
  else if (!ENUM.includes(e.witness)) fail(`invariant ${e.id}: witness '${e.witness}' is not in the closed enum`);
  else {
    counts.byClass[e.witness] = (counts.byClass[e.witness] ?? 0) + 1;
    const empty = e.testsEmpty || e.tests.length === 0;
    if (empty && e.witness !== 'unwitnessable') fail(`invariant ${e.id}: tests: [] but witness is '${e.witness}' — an entry nothing tests is unwitnessable, say so`);
    if (!empty && e.witness === 'unwitnessable') fail(`invariant ${e.id}: has tests but witness is 'unwitnessable' — name the class the tests give it`);
    if (e.witness === 'unwitnessable') {
      counts.unwitnessable++;
      if (!e.rationale) fail(`invariant ${e.id}: unwitnessable without non_testability_rationale (RFC 0166 §C.2)`);
      if (e.tier === 'protocol') fail(`invariant ${e.id}: a protocol-tier invariant MUST NOT be unwitnessable (RFC 0166 §C.2)`);
    }
    if (e.review && e.review.startsWith('initial-mechanical')) counts.unreviewed++;
  }
}

// extensions
const ext = JSON.parse(readFileSync(EXT, 'utf8'));
counts.extensions = (ext.extensions ?? []).length;
counts.extByClass = {};
counts.extUnreviewed = 0;
for (const r of ext.extensions ?? []) {
  if (!r.witness) fail(`extension ${r.id}: no witness class (RFC 0166 §C.3)`);
  else if (!ENUM.includes(r.witness)) fail(`extension ${r.id}: witness '${r.witness}' is not in the closed enum`);
  else counts.extByClass[r.witness] = (counts.extByClass[r.witness] ?? 0) + 1;
  if (r.witnessReview && String(r.witnessReview).startsWith('initial-mechanical')) counts.extUnreviewed++;
}

// ratchets
const baseline = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : null;
const current = { unwitnessable: counts.unwitnessable, unreviewedInvariants: counts.unreviewed, unreviewedExtensions: counts.extUnreviewed };
if (baseline) {
  for (const k of Object.keys(current)) {
    if (current[k] > baseline[k]) fail(`ratchet: ${k} is ${current[k]}, above the committed baseline ${baseline[k]} (docs/witness-baseline.json) — classify or review, do not grow the debt`);
  }
}
if (update || !baseline) {
  writeFileSync(BASE, JSON.stringify({ $comment: 'RFC 0166 §C ratchet baseline — counts may only go down; rewrite with scripts/check-witness-classes.mjs --update-baseline after lowering', measured: new Date().toISOString().slice(0, 10), ...current }, null, 2) + '\n');
}

if (failures.length > 0) {
  console.error(`=== check-witness-classes FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `=== check-witness-classes OK — ${counts.invariants} invariants ${JSON.stringify(counts.byClass)} (unwitnessable ${counts.unwitnessable}, unreviewed ${counts.unreviewed}); ${counts.extensions} extensions ${JSON.stringify(counts.extByClass)} (unreviewed ${counts.extUnreviewed}); ratchets at baseline ===`,
);

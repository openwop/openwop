#!/usr/bin/env node
/**
 * annotate-witness — put a `witness` class on every SECURITY/invariants.yaml
 * entry and every spec/v1/extensions.json record (RFC 0166 §C).
 *
 * The class is a semantic judgement (which is why capability-declaration-
 * classes.json is reviewed, not derived). This script does NOT pretend
 * otherwise: it derives an INITIAL class from what the tests it points at
 * can observe, and stamps `witnessReview: "initial-mechanical-2026-09-02"` on
 * the invariant so a reader knows the classification has not been reviewed
 * yet. `check-witness-classes.mjs` enforces only the structural rules
 * (`tests: []` ⇔ `unwitnessable` + rationale; a protocol-tier entry is never
 * `unwitnessable`; the enum is closed) and ratchets the unwitnessable and
 * unreviewed counts. Review flips the marker per entry.
 *
 * Derivation for invariants:
 *   tests: []                                             → unwitnessable
 *   any test outside conformance/src/scenarios (repo-qualified, host tests) → claims-check
 *   a scenario file that reads /v1/host/sample or uses seamAbsent            → seam-gated
 *   a scenario file that uses behaviorGate / softSkip / isFixtureAdvertised  → witnessable-gated
 *   a scenario file that never calls driver.<verb>( (schema/corpus only)     → claims-check
 *   otherwise                                                                 → witnessable-unaided
 * For extensions: capabilityPath referenced by any scenario file → witnessable-gated,
 * else claims-check (the advertisement is the only thing anyone checks).
 *
 * Invariants: `witness:` is APPENDED after the entry's last field (`note:` or
 * `non_testability_rationale:`). It must not go between `id:` and `tier:` —
 * scripts/check-doc-tallies.mjs requires `tier:` on the line after `id:`.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './registers-lib.mjs';

const write = process.argv.includes('--write');
const INV = join(ROOT, 'SECURITY', 'invariants.yaml');
const EXT = join(ROOT, 'spec', 'v1', 'extensions.json');
const SCEN = join(ROOT, 'conformance', 'src', 'scenarios');
const MARK = 'initial-mechanical-2026-09-02';

const scenarioText = new Map();
for (const f of readdirSync(SCEN).filter((f) => f.endsWith('.test.ts'))) scenarioText.set(f, readFileSync(join(SCEN, f), 'utf8'));

function classifyScenario(rel) {
  const name = rel.split('/').pop();
  const t = scenarioText.get(name);
  if (t === undefined) return 'claims-check';
  if (/\/v1\/host\/sample|seamAbsent\(/.test(t)) return 'seam-gated';
  if (/behaviorGate|behaviorGatePresent|softSkip\(|isFixtureAdvertised|capabilityFamily\(/.test(t)) return 'witnessable-gated';
  if (!/driver\.(get|post|put|patch|delete|request)\(/.test(t)) return 'claims-check';
  return 'witnessable-unaided';
}

const RANK = ['witnessable-unaided', 'witnessable-gated', 'seam-gated', 'claims-check', 'negative-existence', 'unwitnessable'];
function strongest(classes) {
  return classes.sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
}

// ---------------- invariants.yaml ----------------
const lines = readFileSync(INV, 'utf8').split('\n');
const out = [];
let entry = null; // { start, tests: [], hasWitness, lastLine }
const entries = [];
function flush() {
  if (entry) entries.push(entry);
  entry = null;
}
lines.forEach((line, i) => {
  if (/^  - id: /.test(line)) {
    flush();
    entry = { id: line.replace(/^  - id: /, '').trim(), start: i, tests: [], inTests: false, hasWitness: false, hasRationale: false, end: i };
  } else if (entry) {
    if (/^    tests: \[\]/.test(line)) entry.inTests = false;
    else if (/^    tests:/.test(line)) entry.inTests = true;
    else if (/^    \w+:/.test(line)) {
      entry.inTests = false;
      if (/^    witness:/.test(line)) entry.hasWitness = true;
      if (/^    non_testability_rationale:/.test(line)) entry.hasRationale = true;
    } else if (entry.inTests && /^      - /.test(line)) entry.tests.push(line.replace(/^      - /, '').trim());
    if (line.trim().length > 0) entry.end = i;
  }
});
flush();

let annotated = 0;
const insertAfter = new Map();
const invCounts = {};
for (const e of entries) {
  if (e.hasWitness) continue;
  let cls;
  if (e.tests.length === 0) cls = 'unwitnessable';
  else cls = strongest(e.tests.map((t) => (t.startsWith('conformance/src/scenarios/') ? classifyScenario(t) : 'claims-check')));
  invCounts[cls] = (invCounts[cls] ?? 0) + 1;
  let block = `    witness: ${cls}\n    witnessReview: ${MARK}`;
  if (cls === 'unwitnessable' && !e.hasRationale) {
    block =
      `    non_testability_rationale: |\n` +
      `      Classified unwitnessable by the RFC 0166 §C.2 backfill (${MARK}): no public test names\n` +
      `      this invariant (tests: []). The obligation is stated in note: above and is verified,\n` +
      `      if at all, by the reference implementation's own tests at its tier. Review may re-tier\n` +
      `      it or attach a scenario; until then it counts against the unwitnessable ratchet.\n` + block;
  }
  insertAfter.set(e.end, block);
  annotated++;
}
lines.forEach((line, i) => {
  out.push(line);
  if (insertAfter.has(i)) out.push(insertAfter.get(i));
});
if (write && annotated > 0) writeFileSync(INV, out.join('\n'));

// ---------------- extensions.json ----------------
const ext = JSON.parse(readFileSync(EXT, 'utf8'));
const allScenarios = [...scenarioText.values()].join('\n');
let extAnnotated = 0;
const extCounts = {};
for (const r of ext.extensions ?? []) {
  if (r.witness) continue;
  const path = String(r.capabilityPath ?? '');
  const family = path.split('.')[0];
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A scenario that names the FAMILY in a gate call or the full dotted path
  // observes the advertisement; anything else only checks the claim's shape.
  const gated = family && (new RegExp(`(capabilityFamily|behaviorGate|behaviorGatePresent)\\(\\s*['"\`]${esc(family)}`).test(allScenarios) || (path.includes('.') && allScenarios.includes(path)));
  const cls = gated ? 'witnessable-gated' : 'claims-check';
  r.witness = cls;
  r.witnessReview = MARK;
  extCounts[cls] = (extCounts[cls] ?? 0) + 1;
  extAnnotated++;
}
if (write && extAnnotated > 0) {
  // preserve the file's \uXXXX escaping convention (generate-extension-registry-coverage.mjs)
  const text = JSON.stringify(ext, null, 2).replace(/[-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
  writeFileSync(EXT, text);
}

console.log(
  `annotate-witness${write ? ' --write' : ' (dry run)'}: invariants ${annotated} annotated ${JSON.stringify(invCounts)}; extensions ${extAnnotated} annotated ${JSON.stringify(extCounts)}; all marked ${MARK}`,
);

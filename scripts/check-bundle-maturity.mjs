#!/usr/bin/env node
/**
 * check-bundle-maturity — RFC 0197 §C.7: the corpus declaration is the upper
 * bound on the maturity a host may advertise for a family.
 *
 * `spec/v2/core/capabilities.md` §8 sourced the technical maturity axis from
 * "the record's `status`" — the HOST's claim. `spec/v2/declaration.json` is the
 * CORPUS's claim, and it marks 82 of 87 families `experimental`. Nothing
 * compared the two, so a host could advertise `stable` for a family the
 * protocol has not committed to and every gate stayed green.
 *
 * THE DISPOSITION IS D1, AND IT IS NOT A SOFTENED MUST. §C is a MUST for a
 * bundle cut on the FIRST SUITE RELEASE THAT SHIPS THIS RFC (2.36.0) or later.
 * A bundle cut on an earlier suite is REPORTED, never failed, on RFC 0148's
 * precedent that an old pass stays a measurement at the suite that measured it
 * (COMPATIBILITY.md §2.3): the rule did not exist when that run happened, and
 * retro-failing it would invalidate evidence rather than improve it. The report
 * is not decoration — it names every overstated family and the gap row that
 * owes the re-cut, so "reported" cannot quietly become "forgotten".
 *
 * MyndHyve's 2.35.1 bundle overstated 38 families — the whole population of
 * the problem — and `openwop.gap.0197.1` (G1) owed its re-cut. The 2.39.5
 * re-cut (2026-09-26) overstates none, so G1 is closed; the 2.35.1 document is
 * kept at evidence/fixtures/ as the coherence test's sabotage subject.
 *
 * Test seams: OPENWOP_V2_BUNDLES_DIR, OPENWOP_V2_DECLARATION_FILE,
 * OPENWOP_V2_CAPABILITIES_SCHEMA, OPENWOP_0197_FIRST_SUITE.
 *
 * Exit 0 on success, 1 when a bundle cut on the RFC's suite or later overstates.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLES = process.env['OPENWOP_V2_BUNDLES_DIR'] ?? join(ROOT, 'evidence', 'v2-host-bundles');
const DECLARATION = process.env['OPENWOP_V2_DECLARATION_FILE'] ?? join(ROOT, 'spec', 'v2', 'declaration.json');
const CAPS_SCHEMA = process.env['OPENWOP_V2_CAPABILITIES_SCHEMA'] ?? join(ROOT, 'schemas', 'v2', 'capabilities.schema.json');
/**
 * A historical fact, not a moving target: 2.36.0 is the suite minor in which
 * `v2-capability-maturity-bounded` first ships. Reading it from
 * conformance/package.json would make the MUST slide forward with every bump
 * and never bind anyone.
 */
const FIRST_SUITE = process.env['OPENWOP_0197_FIRST_SUITE'] ?? '2.36.0';
const GAP_ROW = 'openwop.gap.0197.1 (G1)';

const readJson = (p, what) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) {
    console.error(`=== check-bundle-maturity FAILED — cannot read ${what} at ${p}: ${e.message} ===`);
    process.exit(1);
  }
};
const minorOf = (v) => { const m = /^(\d+)\.(\d+)/.exec(String(v ?? '')); return m ? [Number(m[1]), Number(m[2])] : null; };
const cmpMinor = (a, b) => { const x = minorOf(a), y = minorOf(b); if (!x || !y) return NaN; return x[0] !== y[0] ? Math.sign(x[0] - y[0]) : Math.sign(x[1] - y[1]); };

/**
 * Which discovery-root keys are family RECORDS is read from the generated
 * capabilities schema (a property whose schema requires status/since/witness),
 * exactly as `v2-capability-record-shape` does, so a metadata key (§3.1) is
 * never mistaken for a record and the two never disagree.
 */
const capsSchema = readJson(CAPS_SCHEMA, 'schemas/v2/capabilities.schema.json');
const familyKeys = new Set(Object.entries(capsSchema.properties ?? {})
  .filter(([, p]) => ['status', 'since', 'witness'].every((r) => (p.required ?? []).includes(r)))
  .map(([k]) => k));

const declaration = readJson(DECLARATION, 'spec/v2/declaration.json');
const technical = new Map((declaration.families ?? []).filter((f) => f.maturity).map((f) => [f.key, f.maturity.technical]));

if (!existsSync(BUNDLES)) {
  console.log(`=== check-bundle-maturity — no ${BUNDLES}; 0 committed bundles to measure (RFC 0197 §C binds from suite ${FIRST_SUITE}) ===`);
  process.exit(0);
}

const failures = [];
const report = [];
let measured = 0, boundBundles = 0, reportedBundles = 0, totalOverstated = 0;
for (const f of readdirSync(BUNDLES).filter((f) => f.endsWith('.json')).sort()) {
  const b = readJson(join(BUNDLES, f), `evidence/v2-host-bundles/${f}`);
  const doc = b?.discovery?.document;
  const suite = b?.suite?.version ?? null;
  if (!doc) { report.push(`  ${f}: no discovery.document — nothing to measure`); continue; }
  measured++;
  const records = Object.entries(doc).filter(([k, v]) => familyKeys.has(k) && v !== null && typeof v === 'object' && !Array.isArray(v));
  const overstated = records
    .filter(([k, v]) => v.status === 'stable' && technical.get(k) !== 'stable')
    .map(([k]) => `${k}(corpus:${technical.get(k) ?? 'not-declared'})`);
  totalOverstated += overstated.length;
  const bound = suite !== null && cmpMinor(suite, FIRST_SUITE) >= 0;
  if (bound) boundBundles++; else reportedBundles++;
  const verdict = overstated.length === 0
    ? 'ok'
    : bound
      ? `FAILS — cut on suite ${suite} ≥ ${FIRST_SUITE}, where §C.7 is a MUST`
      : `REPORTED — cut on suite ${suite} < ${FIRST_SUITE}; it stays a valid measurement at its own suite (COMPATIBILITY.md §2.3), and the re-cut is owed under ${GAP_ROW}`;
  report.push(`  ${f}: suite ${suite ?? 'unknown'}, ${records.length} family record(s), ${overstated.length} overstated — ${verdict}`);
  if (overstated.length > 0) report.push(`      ${overstated.join(', ')}`);
  if (bound && overstated.length > 0) {
    failures.push(`${f} (suite ${suite}) advertises \`status: "stable"\` for ${overstated.length} family/families the corpus declaration does not call stable: ${overstated.join(', ')}. Re-cut with \`status: "experimental"\` and a future \`until\`, or promote the family by RFC (§C.9).`);
  }
}

console.log(`check-bundle-maturity: ${familyKeys.size} family record keys; ${technical.size} declaration rows (${[...technical.values()].filter((t) => t === 'stable').length} stable); §C.7 binds bundles cut on suite ${FIRST_SUITE} or later — ${boundBundles} bound, ${reportedBundles} reported (D1)`);
for (const l of report) console.log(l);

if (failures.length > 0) {
  console.error(`=== check-bundle-maturity FAILED — ${failures.length} bundle(s) overstate maturity ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`=== check-bundle-maturity OK — ${measured} bundle(s) measured, ${totalOverstated} overstated family record(s) across them, none in a bundle §C.7 binds ===`);

#!/usr/bin/env node
/**
 * check-alias-coverage — RFC 0167 §E: the deprecation register covers every
 * alias in the corpus, machine-true.
 *
 * spec/v1/alias-detectors.json is the reviewed inventory: each detector is a
 * literal token in a file that proves an alias is still present, bound to the
 * spec/v1/deprecations.json row that must cover it. Three failures:
 *   1. the token is present and the bound deprecation row does not exist —
 *      an alias with no scheduled removal (the §E predicate);
 *   2. the token is absent — the alias left the corpus (or was reworded) and
 *      the detector is stale; retire or repoint it (three-outcome discipline:
 *      a detector that can no longer see is not a pass);
 *   3. a deprecation row of kind discovery-shape/discovery-field/profile-id/
 *      header/schema-field has no detector — the register names a surface the
 *      inventory cannot see, so removal can never be verified.
 *
 * Exit 0 on success, 1 on any failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const detectors = JSON.parse(readFileSync(join(ROOT, 'spec/v1/alias-detectors.json'), 'utf8')).detectors;
const register = JSON.parse(readFileSync(join(ROOT, 'spec/v1/deprecations.json'), 'utf8')).entries;
const byId = new Map(register.map((e) => [e.id, e]));
const failures = [];
const covered = new Set();
for (const d of detectors) {
  const file = join(ROOT, d.file);
  if (!existsSync(file)) { failures.push(`${d.alias}: ${d.file} does not exist`); continue; }
  const present = readFileSync(file, 'utf8').includes(d.token);
  if (!present) { failures.push(`${d.alias}: ${d.file} no longer contains ${JSON.stringify(d.token)} — the alias left the corpus or was reworded; retire or repoint the detector`); continue; }
  if (!byId.has(d.deprecation)) { failures.push(`${d.alias}: present in ${d.file} but ${d.deprecation} is not in spec/v1/deprecations.json — an alias with no scheduled removal`); continue; }
  covered.add(d.deprecation);
}
const VISIBLE = new Set(['discovery-shape', 'discovery-field', 'profile-id', 'header', 'schema-field', 'path']);
for (const e of register) {
  if (VISIBLE.has(e.kind) && !covered.has(e.id)) failures.push(`${e.id} (${e.kind}) has no detector in spec/v1/alias-detectors.json — its removal can never be verified`);
}
if (failures.length > 0) {
  console.error(`=== check-alias-coverage FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`=== check-alias-coverage OK — ${detectors.length} detectors, ${covered.size} register rows covered, every visible-kind row has a detector ===`);

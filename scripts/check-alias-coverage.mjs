#!/usr/bin/env node
/**
 * check-alias-coverage — RFC 0167 §E: the deprecation register covers every
 * alias in the corpus, machine-true.
 *
 * spec/v1/alias-detectors.json and spec/v2/alias-detectors.json (RFC 0266 §A)
 * are the reviewed inventory: each detector is a literal token in a file that
 * proves an alias is still present, bound to the deprecation row (spec/v1/ or
 * spec/v2/deprecations.json, merged by id) that must cover it. Three failures:
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
import { loadDeprecations } from './lib/registers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// RFC 0266 §A: the v1 inventory and register are frozen; v2 holds its own. Both
// pairs are read, the registers merged by id with the v2 row winning.
const detectors = ['spec/v1/alias-detectors.json', 'spec/v2/alias-detectors.json'].flatMap((f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8')).detectors);
const register = loadDeprecations(ROOT).entries;
const byId = new Map(register.map((e) => [e.id, e]));
const failures = [];
const covered = new Set();
for (const d of detectors) {
  const file = join(ROOT, d.file);
  if (!existsSync(file)) { failures.push(`${d.alias}: ${d.file} does not exist`); continue; }
  const present = readFileSync(file, 'utf8').includes(d.token);
  if (!present) { failures.push(`${d.alias}: ${d.file} no longer contains ${JSON.stringify(d.token)} — the alias left the corpus or was reworded; retire or repoint the detector`); continue; }
  if (!byId.has(d.deprecation)) { failures.push(`${d.alias}: present in ${d.file} but ${d.deprecation} is not in spec/v1/ or spec/v2/deprecations.json — an alias with no scheduled removal`); continue; }
  covered.add(d.deprecation);
}
const VISIBLE = new Set(['discovery-shape', 'discovery-field', 'profile-id', 'header', 'schema-field', 'path', 'prose-convention', 'artifact', 'error-code']); // RFC 0178 §A.3: every kind
for (const e of register) {
  if (VISIBLE.has(e.kind) && !covered.has(e.id)) failures.push(`${e.id} (${e.kind}) has no detector in spec/v1/ or spec/v2/alias-detectors.json — its removal can never be verified`);
}
if (failures.length > 0) {
  console.error(`=== check-alias-coverage FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`=== check-alias-coverage OK — ${detectors.length} detectors, ${covered.size} register rows covered, every visible-kind row has a detector ===`);

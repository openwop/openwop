#!/usr/bin/env node
/**
 * RFC 0216 §A.3: `spec/v2/harness-trust-anchors.json` is closed, exact, and
 * gate-kept.
 *
 * The list names the rows a colocated companion may witness (§C), which makes
 * it the one door past GOVERNANCE's rule that live claims are witnessed on the
 * deployed revision. A door that review alone keeps is a door that widens. This
 * gate fails when:
 *   (a) an entry's id is not an exact `openwop.(requirement|scenario).…` id;
 *   (b) an entry's anchor is outside the schema's closed enum;
 *   (c) the list differs, in either direction, from the union of the
 *       `### Harness-trust-anchor rows` tables of every Active/Accepted RFC, or
 *       an entry's `rfc` is not one of those RFCs;
 *   (d) the named scenario does not mint the id (conformance/requirements.json,
 *       or the scenario row `openwop.scenario.<file>`), or does not gate on the
 *       anchor (`oidc-test-issuer` → `harnessClaimed(`, openwop#1581);
 *   (e) the scenario is in any profile's `floorScenarios`: a companion never
 *       decides a profile verdict.
 *
 * `--root <dir>` points it at a corpus copy; the coherence scenario
 * `v2-colocated-companion.test.ts` sabotages one clause at a time that way.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const ri = argv.indexOf('--root');
const ROOT = ri >= 0 ? resolve(argv[ri + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const failures = [];

const list = JSON.parse(read('spec/v2/harness-trust-anchors.json'));
const schema = JSON.parse(read('spec/v2/harness-trust-anchors.schema.json'));
const ANCHORS = new Set(schema.$defs.row.properties.anchor.enum);
const EXACT = /^openwop\.(requirement|scenario)\.[a-z0-9.-]+$/;
/** How each anchor shows in a scenario that gates on it. One row per enum member, or (d) cannot pass. */
const GATES_ON = { 'oidc-test-issuer': 'harnessClaimed(' };

// (c) the RFC tables
const rfcRows = new Map(); // id -> rfc
for (const f of readdirSync(join(ROOT, 'RFCS')).filter((n) => /^\d{4}-.*\.md$/.test(n))) {
  const text = read(join('RFCS', f));
  const status = (/\|\s*\*\*Status\*\*\s*\|\s*`([^`]+)`/.exec(text) ?? [])[1];
  if (status !== 'Active' && status !== 'Accepted') continue;
  const table = text.split(/^### Harness-trust-anchor rows[^\n]*$/m)[1]?.split(/^#{2,3} /m)[0];
  if (table === undefined) continue;
  for (const line of table.split('\n').filter((l) => /^\|\s*`openwop\./.test(l))) {
    const id = /`(openwop\.[^`]+)`/.exec(line)[1];
    rfcRows.set(id, f.slice(0, 4));
  }
}

const records = JSON.parse(read('conformance/requirements.json')).records ?? [];
const profiles = JSON.parse(read('spec/v2/profiles.json')).profiles ?? [];
const floor = new Set(profiles.flatMap((p) => p.floorScenarios ?? []).map((s) => String(s).replace(/\.test\.ts$/, '')));

const listed = new Set();
for (const row of list.rows ?? []) {
  const { requirementId: id, scenario, anchor, rfc } = row;
  listed.add(id);
  if (typeof id !== 'string' || !EXACT.test(id) || /[*?]|\.\.|\.$/.test(id)) failures.push(`(a) ${JSON.stringify(id)}: not an exact requirement or scenario id`);
  if (!ANCHORS.has(anchor)) failures.push(`(b) ${id}: anchor ${JSON.stringify(anchor)} is outside the closed enum (${[...ANCHORS].join(', ')})`);
  if (!rfcRows.has(id)) failures.push(`(c) ${id}: no Active/Accepted RFC's "### Harness-trust-anchor rows" table lists it`);
  else if (rfcRows.get(id) !== rfc) failures.push(`(c) ${id}: listed under RFC ${rfc}, but RFC ${rfcRows.get(id)}'s table is the one that names it`);
  const base = String(scenario).replace(/\.test\.ts$/, '');
  const path = join('conformance', 'src', 'scenarios', String(scenario));
  if (!existsSync(join(ROOT, path))) { failures.push(`(d) ${id}: scenario ${scenario} does not exist`); continue; }
  const mints = id === `openwop.scenario.${base}` || records.some((r) => r.file === scenario && r.explicitId === id);
  if (!mints) failures.push(`(d) ${id}: ${scenario} does not mint it (conformance/requirements.json)`);
  // An anchor outside the enum is (b)'s finding; (d) has no gate string to look for.
  const gate = GATES_ON[anchor];
  if (ANCHORS.has(anchor) && (!gate || !read(path).includes(gate))) failures.push(`(d) ${id}: ${scenario} does not gate on the ${anchor} anchor (expected \`${gate ?? '?'}\`) — a row that needs no anchor is not eligible`);
  if (floor.has(base)) failures.push(`(e) ${id}: ${scenario} is a profile floor scenario — a companion MUST NOT decide a profile verdict (RFC 0216 §A.3(e))`);
}
for (const [id, rfc] of rfcRows) if (!listed.has(id)) failures.push(`(c) ${id}: RFC ${rfc}'s table lists it and spec/v2/harness-trust-anchors.json does not`);

if (failures.length) {
  console.error(`=== check-harness-trust-anchors FAILED — ${failures.length} problem(s) (RFC 0216 §A.3) ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`=== check-harness-trust-anchors OK — ${listed.size} row(s), each exact, gated on its anchor, off every floor, and named by an Active/Accepted RFC ===`);

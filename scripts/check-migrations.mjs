#!/usr/bin/env node
/**
 * check-migrations — RFC 0167 §D: spec/v1/migrations.json is valid, internally
 * referential, and agrees with every child RFC's §Migration table.
 *
 *   1. schema      — validates against spec/v1/migrations.schema.json
 *   2. ids         — unique; child in the id equals the `child` field
 *   3. references  — deprecationId exists in deprecations.json; gapIds exist in
 *                    gaps.json; rename/remove/delete-alias rows carry a deprecationId
 *   4. RFC tables  — every RFCS/*.md that declares `Part of: RFC 0167 … child Cn`
 *                    and has a `## Migration table` section lists exactly the
 *                    register rows for that child (ids in the table ⊆ register,
 *                    register rows for the child ⊆ table)
 *   5. codemods    — a named codemod resolves under codemods/ (check-codemods
 *                    exercises it)
 *   6. v2→v2       — RFC 0197 §A.2 R1: spec/v2/migrations.json validates against
 *                    its own schema, its ids are unique, its `deprecationId`
 *                    resolves to a `v2-minor` row, its `to.addedIn` is EARLIER
 *                    than that row's `removeIn`, and its `to.path` is a surface
 *                    the v2 tree actually carries. The v1 register is NOT
 *                    widened to hold these rows: its C1–C11 child grammar is the
 *                    v1→v2 program's identity and a 2.N→2.M row has no child.
 * Exit 0 on success, 1 on any failure.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'conformance', 'package.json'));
const failures = [];
const reg = JSON.parse(readFileSync(join(ROOT, 'spec/v1/migrations.json'), 'utf8'));
try {
  const { Ajv2020 } = require('ajv/dist/2020.js');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const ok = ajv.validate(JSON.parse(readFileSync(join(ROOT, 'spec/v1/migrations.schema.json'), 'utf8')), reg);
  if (!ok) for (const err of ajv.errors ?? []) failures.push(`schema: ${err.instancePath || '/'} ${err.message}`);
} catch (e) { failures.push(`schema: could not load Ajv from conformance/node_modules (${e.message})`); }
const dep = new Set(JSON.parse(readFileSync(join(ROOT, 'spec/v1/deprecations.json'), 'utf8')).entries.map((e) => e.id));
const gaps = new Set(JSON.parse(readFileSync(join(ROOT, 'spec/v1/gaps.json'), 'utf8')).entries.map((g) => g.id));
const seen = new Set();
for (const r of reg.rows) {
  if (seen.has(r.id)) failures.push(`ids: duplicate ${r.id}`); seen.add(r.id);
  if (!r.id.startsWith(`openwop.migration.${r.child}.`)) failures.push(`ids: ${r.id} does not carry its child ${r.child}`);
  if (r.deprecationId && !dep.has(r.deprecationId)) failures.push(`references: ${r.id} names ${r.deprecationId}, not in deprecations.json`);
  if (['rename', 'remove', 'delete-alias'].includes(r.kind) && !r.deprecationId) failures.push(`references: ${r.id} is ${r.kind} but has no deprecationId — a removed v1 surface must be in the deprecation register`);
  for (const g of r.gapIds) if (!gaps.has(g)) failures.push(`references: ${r.id} cites ${g}, not in gaps.json`);
  if (r.codemod && !existsSync(join(ROOT, 'codemods', r.codemod, 'transform.mjs'))) failures.push(`codemods: ${r.id} names ${r.codemod}, which has no codemods/<id>/transform.mjs`);
}
const byChild = new Map();
for (const r of reg.rows) byChild.set(r.child, [...(byChild.get(r.child) ?? []), r.id]);
let tables = 0;
for (const f of readdirSync(join(ROOT, 'RFCS')).filter((f) => /^\d{4}-.*\.md$/.test(f))) {
  const t = readFileSync(join(ROOT, 'RFCS', f), 'utf8');
  const part = t.match(/Part of:\s*RFC 0167[^\n]*child\s+(C\d{1,2})/);
  if (!part) continue;
  const sec = t.split(/^## Migration table\s*$/m)[1];
  if (!sec) { failures.push(`RFC tables: RFCS/${f} is child ${part[1]} but has no "## Migration table" section`); continue; }
  const body = sec.split(/^## /m)[0];
  const cited = new Set([...body.matchAll(/openwop\.migration\.C\d{1,2}\.\d+/g)].map((m) => m[0]));
  const expected = new Set(byChild.get(part[1]) ?? []);
  for (const id of cited) if (!expected.has(id)) failures.push(`RFC tables: RFCS/${f} cites ${id}, which is not a ${part[1]} row in migrations.json`);
  for (const id of expected) if (!cited.has(id)) failures.push(`RFC tables: RFCS/${f} omits ${id} — every ${part[1]} row must appear in its Migration table`);
  tables++;
}
// ── 6. the v2→v2 register (RFC 0197 §A.2 R1) ────────────────────────────────
const V2_REG = process.env['OPENWOP_V2_MIGRATIONS_FILE'] ?? join(ROOT, 'spec/v2/migrations.json');
const V2_SCHEMA = join(ROOT, 'spec/v2/migrations.schema.json');
const DEPRECATIONS = process.env['OPENWOP_DEPRECATIONS_FILE'] ?? join(ROOT, 'spec/v1/deprecations.json');
let v2reg = null;
try { v2reg = JSON.parse(readFileSync(V2_REG, 'utf8')); } catch (e) { failures.push(`v2: cannot read ${V2_REG} (${e.message}) — the register exists ahead of its first row precisely so R1 has somewhere to resolve`); }
if (v2reg) {
  try {
    const { Ajv2020 } = require('ajv/dist/2020.js');
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    if (!ajv.validate(JSON.parse(readFileSync(V2_SCHEMA, 'utf8')), v2reg)) for (const err of ajv.errors ?? []) failures.push(`v2 schema: ${err.instancePath || '/'} ${err.message}`);
  } catch (e) { failures.push(`v2 schema: could not load Ajv from conformance/node_modules (${e.message})`); }
  const depEntries = (() => { try { return JSON.parse(readFileSync(DEPRECATIONS, 'utf8')).entries ?? []; } catch { return null; } })();
  const baseline = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'spec/v2/surface-baseline.json'), 'utf8')); } catch { return null; } })();
  const sites = new Set();
  for (const s of baseline?.surfaces ?? []) {
    const i = s.indexOf('|'); const j = s.indexOf('|', i + 1);
    const site = s.slice(0, i), kind = s.slice(i + 1, j), value = s.slice(j + 1);
    sites.add(site);
    if (kind === 'property') sites.add(`${site}/${value}`);
  }
  const v2seen = new Set();
  for (const r of v2reg.rows ?? []) {
    if (v2seen.has(r.id)) failures.push(`v2 ids: duplicate ${r.id}`);
    v2seen.add(r.id);
    const dep = depEntries === null ? undefined : depEntries.find((e) => e.id === r.deprecationId);
    if (depEntries === null) failures.push(`v2 references: ${r.id} — spec/v1/deprecations.json unreadable`);
    else if (!dep) failures.push(`v2 references: ${r.id} names ${r.deprecationId}, which is not a row in spec/v1/deprecations.json`);
    else {
      const trig = Array.isArray(dep.removalTrigger) ? dep.removalTrigger : dep.removalTrigger ? [dep.removalTrigger] : [];
      if (!trig.includes('v2-minor')) failures.push(`v2 references: ${r.id} links ${dep.id}, whose removalTrigger is ${JSON.stringify(dep.removalTrigger)} — a v2→v2 migration row schedules a removal INSIDE major 2, so its deprecation row must carry v2-minor`);
      const a = /^(\d+)\.(\d+)/.exec(String(r.to?.addedIn ?? '')), b = /^(\d+)\.(\d+)/.exec(String(dep.removeIn ?? ''));
      if (!a || !b) failures.push(`v2 references: ${r.id} — to.addedIn ${r.to?.addedIn} and removeIn ${dep.removeIn} must both be <major>.<minor>`);
      else if (!(Number(a[1]) < Number(b[1]) || (Number(a[1]) === Number(b[1]) && Number(a[2]) < Number(b[2])))) {
        failures.push(`v2 references: ${r.id} — the replacement shipped in ${r.to.addedIn} and the removal is at ${dep.removeIn}; R1 requires the replacement STRICTLY EARLIER, or nobody had a minor in which both existed`);
      }
    }
    if (r.to?.path && baseline && !sites.has(String(r.to.path))) failures.push(`v2 references: ${r.id} — to.path ${r.to.path} is not a surface in spec/v2/surface-baseline.json; R1's "present in the v2 tree" half fails`);
    if (r.codemod && !existsSync(join(ROOT, 'codemods', r.codemod, 'transform.mjs'))) failures.push(`v2 codemods: ${r.id} names ${r.codemod}, which has no codemods/<id>/transform.mjs`);
  }
}

if (failures.length > 0) { console.error(`=== check-migrations FAILED — ${failures.length} problem(s) ===`); for (const x of failures) console.error(`  ${x}`); process.exit(1); }
const kinds = {}; for (const r of reg.rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
console.log(`=== check-migrations OK — ${reg.rows.length} rows across ${byChild.size} children ${JSON.stringify(kinds)}; ${tables} child RFC table(s) agree; ${reg.rows.filter((r) => r.codemod).length} row(s) with a codemod; spec/v2/migrations.json holds ${(v2reg?.rows ?? []).length} v2→v2 row(s) (an empty v2→v2 register is a legal state — RFC 0197) ===`);

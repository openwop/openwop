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
if (failures.length > 0) { console.error(`=== check-migrations FAILED — ${failures.length} problem(s) ===`); for (const x of failures) console.error(`  ${x}`); process.exit(1); }
const kinds = {}; for (const r of reg.rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
console.log(`=== check-migrations OK — ${reg.rows.length} rows across ${byChild.size} children ${JSON.stringify(kinds)}; ${tables} child RFC table(s) agree; ${reg.rows.filter((r) => r.codemod).length} row(s) with a codemod ===`);

#!/usr/bin/env node
/**
 * RFC 0178 §A.1 — every deprecation row with a schema-field / discovery-field
 * surface whose source is a v2 schema node is annotated `deprecated: true` and
 * `x-openwop-remove-in: "<major.minor>"` on that node, generated from
 * spec/v1/deprecations.json; api/v2/*.yaml operations named by a `path` row get
 * `deprecated: true` + `x-openwop-remove-in`. The annotation is what makes
 * COMPATIBILITY §7 bind (RFC 0178).
 *
 * Scope: schemas/v2/** and api/v2/** only (v1 artifacts are packed content and
 * RFC 0178 lands the annotation at v2). Green — reported as "nothing to
 * annotate" — while the v2 tree does not exist.
 *   --write  apply   --check  fail if any annotation is missing or stale
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(join(ROOT, 'spec', 'v1', 'deprecations.json'), 'utf8'));
const write = process.argv.includes('--write');
const V2 = join(ROOT, 'schemas', 'v2');
if (!existsSync(V2)) { console.log('=== generate-deprecation-annotations — schemas/v2/ does not exist yet; nothing to annotate ==='); process.exit(0); }
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : []; });
const wanted = reg.entries.filter((e) => ['schema-field', 'discovery-field'].includes(e.kind) && e.status === 'deprecated' && (e.sources ?? []).some((s) => s.file.startsWith('schemas/v2/')));
let stale = 0, applied = 0;
for (const file of walk(V2)) {
  const rel = relative(ROOT, file); const rows = wanted.filter((e) => e.sources.some((s) => s.file === rel)); if (!rows.length) continue;
  const doc = JSON.parse(readFileSync(file, 'utf8')); let changed = false;
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.properties) for (const [k, v] of Object.entries(node.properties)) {
      for (const e of rows) if (e.sources.some((s) => s.file === rel && s.token === k)) {
        if (v.deprecated !== true || v['x-openwop-remove-in'] !== e.removeIn) { if (write) { v.deprecated = true; v['x-openwop-remove-in'] = e.removeIn; changed = true; } else { stale++; console.error(`  ${rel} ${path}.${k}: missing/stale annotation for ${e.id}`); } } else applied++;
      }
      visit(v, `${path}.${k}`);
    }
    for (const k of ['items', 'additionalProperties']) if (node[k] && typeof node[k] === 'object') visit(node[k], `${path}.${k}`);
    for (const k of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(node[k])) node[k].forEach((s, i) => visit(s, `${path}.${k}[${i}]`));
  };
  visit(doc, '$');
  if (changed) { writeFileSync(file, JSON.stringify(doc, null, 2) + '\n'); console.log(`annotated ${rel}`); }
}
if (stale) { console.error(`=== generate-deprecation-annotations FAILED — ${stale} stale annotation(s); run --write ===`); process.exit(1); }
console.log(`=== generate-deprecation-annotations OK — ${applied} annotation(s) current over schemas/v2/ ===`);

#!/usr/bin/env node
/**
 * check-codemods — RFC 0167 §D.3: every codemod is a pure transform with a
 * three-part negative control, and every register row that names one resolves.
 *
 * For each codemods/<id>/:
 *   - transform.mjs exports { id, transform }; id equals the directory name;
 *   - fixtures/input.json → transform → deep-equals fixtures/expected.json;
 *   - fixtures/negative-input.json → transform → byte-identical JSON
 *     (no false positives);
 *   - fixtures/refused-input.json (optional) → transform THROWS
 *     (the codemod refuses rather than guesses);
 *   - idempotence: transform(transform(input)) deep-equals transform(input);
 *   - self-sabotage (docs/EVIDENCE-DISCIPLINE.md §6): the runner corrupts
 *     expected.json in memory and asserts its own comparator now FAILS —
 *     a comparator that cannot see a difference is not a witness.
 * Register integrity:
 *   - every `codemod` named in spec/v1/deprecations.json or
 *     spec/v1/migrations.json resolves to a directory here;
 *   - with --at-active: every migrations.json row of a codemod-able kind whose
 *     child RFC is Active has a codemod (the umbrella's Active predicate).
 *
 * Exit 0 on success, 1 on any failure.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'codemods');
const atActive = process.argv.includes('--at-active');
const failures = [];
const stable = (v) => JSON.stringify(sortKeys(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const ids = existsSync(DIR) ? readdirSync(DIR).filter((d) => statSync(join(DIR, d)).isDirectory() && /^openwop\.codemod\./.test(d)) : [];
let sabotageCaught = 0;
for (const id of ids) {
  const base = join(DIR, id);
  try {
    const mod = await import(pathToFileURL(join(base, 'transform.mjs')).href);
    if (mod.id !== id) failures.push(`${id}: transform.mjs exports id ${JSON.stringify(mod.id)}, expected the directory name`);
    if (typeof mod.transform !== 'function') { failures.push(`${id}: no transform() export`); continue; }
    const read = (n) => JSON.parse(readFileSync(join(base, 'fixtures', n), 'utf8'));
    const input = read('input.json'); const expected = read('expected.json');
    const out = mod.transform(structuredClone(input));
    if (stable(out) !== stable(expected)) failures.push(`${id}: transform(input.json) does not equal expected.json`);
    if (stable(mod.transform(structuredClone(out))) !== stable(out)) failures.push(`${id}: not idempotent — transform(transform(input)) differs`);
    const neg = read('negative-input.json');
    if (stable(mod.transform(structuredClone(neg))) !== stable(neg)) failures.push(`${id}: negative control changed — the codemod rewrote an input it must leave alone`);
    if (existsSync(join(base, 'fixtures', 'refused-input.json'))) {
      let threw = false; try { mod.transform(read('refused-input.json')); } catch { threw = true; }
      if (!threw) failures.push(`${id}: refused-input.json was accepted — the codemod guessed instead of refusing`);
    }
    // self-sabotage: corrupt the expectation and prove the comparator sees it
    // an array ignores non-index keys under JSON.stringify — sabotage by shape, not by key
    const corrupted = Array.isArray(expected) ? [...structuredClone(expected), { __sabotage__: true }] : { ...structuredClone(expected), __sabotage__: true };
    if (stable(out) === stable(corrupted)) failures.push(`${id}: comparator did not see a sabotaged expectation — the harness cannot witness`); else sabotageCaught++;
    if (!existsSync(join(base, 'README.md'))) failures.push(`${id}: README.md missing`);
  } catch (e) { failures.push(`${id}: ${e.message}`); }
}
const dep = JSON.parse(readFileSync(join(ROOT, 'spec/v1/deprecations.json'), 'utf8')).entries;
const mig = JSON.parse(readFileSync(join(ROOT, 'spec/v1/migrations.json'), 'utf8')).rows;
const known = new Set(ids);
for (const e of dep) if (e.codemod && !known.has(e.codemod)) failures.push(`deprecations.json ${e.id} names codemod ${e.codemod}, which is not under codemods/`);
for (const r of mig) if (r.codemod && !known.has(r.codemod)) failures.push(`migrations.json ${r.id} names codemod ${r.codemod}, which is not under codemods/`);
const CODEMODABLE = new Set(['rename', 'remove', 'retype', 'unify', 'delete-alias']);
if (atActive) {
  const rfcs = readdirSync(join(ROOT, 'RFCS')).filter((f) => /^\d{4}-.*\.md$/.test(f));
  const active = new Set();
  for (const f of rfcs) { const t = readFileSync(join(ROOT, 'RFCS', f), 'utf8'); const m = t.match(/\*\*Status\*\*\s*\|\s*`(\w+)`/); const part = t.match(/Part of:\s*RFC 0167[^\n]*child\s+(C\d{1,2})/); if (part && m && ['Active', 'Accepted'].includes(m[1])) active.add(part[1]); }
  for (const r of mig) if (CODEMODABLE.has(r.kind) && active.has(r.child) && !r.codemod) failures.push(`migrations.json ${r.id} (${r.kind}, child ${r.child} is Active) has no codemod — RFC 0167 §D.3 requires one at Active`);
}
if (failures.length > 0) { console.error(`=== check-codemods FAILED — ${failures.length} problem(s) ===`); for (const f of failures) console.error(`  ${f}`); process.exit(1); }
console.log(`=== check-codemods OK — ${ids.length} codemod(s), each with positive, negative, idempotence and self-sabotage legs (${sabotageCaught} sabotage(s) caught); every register codemod id resolves${atActive ? '; every codemod-able row of an Active child has a codemod' : ''} ===`);

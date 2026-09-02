#!/usr/bin/env node
/**
 * generate-requirement-registry — build `conformance/requirements.json` from
 * the scenario sources (RFC 0148 §A / gap G3; v2 charter Phase 1).
 *
 * One record per `it(` / `test(` in `src/scenarios/*.test.ts`:
 *
 *   {
 *     "id":        "openwop.it.<file-stem>.<title-slug>[~n]",
 *     "file":      "<file>.test.ts",
 *     "line":      <1-based line of the it()>,
 *     "title":     "<literal title, or null when interpolated>",
 *     "explicitId": "<first arg of a req() call inside the body, or null>",
 *     "citations": [ { "section": "...", "requirement": "..." } ]   // literal driver.describe() / req() args in the body
 *   }
 *
 * The id grammar and slugging live in `src/lib/requirement-ids.ts` and are
 * re-implemented here in plain JS so the generator has no build step; the lib
 * test pins both to the same fixtures.
 *
 * Interpolated titles (`it(\`...${x}...\`)`) cannot yield a stable id; the
 * record carries `title: null` and `line`, and the per-`it` row at run time is
 * keyed by the RENDERED title — so those rows exist in bundles but map to the
 * registry only by file+line. The count is reported so it can ratchet down.
 *
 * `--check`: regenerate in memory and fail when the committed file differs OR
 * when an id present in the committed file is absent from the regenerated set
 * and has no row in `conformance/requirement-aliases.json` (a reword without
 * an alias orphans every bundle that cited the old id). `--write` rewrites.
 */

import ts from 'typescript';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const CONF = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS_DIR = join(CONF, 'src', 'scenarios');
const OUT = join(CONF, 'requirements.json');
const ALIASES = join(CONF, 'requirement-aliases.json');

const MAX_SLUG = 80;
function slugTitle(title) {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const capped = s.length > MAX_SLUG ? s.slice(0, MAX_SLUG).replace(/-+$/g, '') : s;
  return capped.length > 0 ? capped : 'untitled';
}

function literalText(node) {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

function isItCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  // it(...), test(...), it.skip(...), it.only(...), it.todo(...), it.each is skipped (generated titles)
  if (ts.isIdentifier(e)) return e.text === 'it' || e.text === 'test';
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    return (e.expression.text === 'it' || e.expression.text === 'test') && ['skip', 'only', 'todo', 'skipIf', 'runIf'].includes(e.name.text);
  }
  // it.skipIf(cond)(...) form
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression)) {
    return e.expression.expression.text === 'it' || e.expression.expression.text === 'test';
  }
  return false;
}

function collectCitations(body, src) {
  const citations = [];
  let explicitId = null;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      if (ts.isPropertyAccessExpression(e) && e.name.text === 'describe' && e.expression.getText(src).endsWith('driver')) {
        const section = literalText(node.arguments[0]);
        const requirement = literalText(node.arguments[1]);
        if (section !== null && requirement !== null) citations.push({ section, requirement });
        else citations.push({ section: section ?? null, requirement: requirement ?? null, interpolated: true });
      } else if (ts.isIdentifier(e) && e.text === 'req') {
        const id = literalText(node.arguments[0]);
        if (id !== null && explicitId === null) explicitId = id;
        const section = literalText(node.arguments[1]);
        const requirement = literalText(node.arguments[2]);
        citations.push({ section: section ?? null, requirement: requirement ?? null, ...(section === null || requirement === null ? { interpolated: true } : {}) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return { citations, explicitId };
}

export function generate() {
  const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.test.ts')).sort();
  const records = [];
  let interpolatedTitles = 0;
  for (const file of files) {
    const full = join(SCENARIOS_DIR, file);
    const src = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true);
    const stem = file.replace(/\.test\.ts$/, '');
    const seen = new Map();
    const visit = (node) => {
      if (isItCall(node)) {
        const title = literalText(node.arguments[0]);
        const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
        const body = node.arguments[1];
        const { citations, explicitId } = body !== undefined ? collectCitations(body, src) : { citations: [], explicitId: null };
        if (title === null) {
          interpolatedTitles++;
          records.push({ id: null, file, line, title: null, explicitId, citations });
        } else {
          const base = `openwop.it.${stem}.${slugTitle(title)}`;
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          records.push({ id: n === 1 ? base : `${base}~${n}`, file, line, title, explicitId, citations });
        }
        // do not descend: nested it() inside it() is not a thing we index
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  const withId = records.filter((r) => r.id !== null).length;
  return {
    $comment:
      'GENERATED by conformance/scripts/generate-requirement-registry.mjs — do not edit. One record per it()/test() in src/scenarios. ' +
      'Ids: openwop.it.<file-stem>.<title-slug>[~n] (src/lib/requirement-ids.ts). A record with id null has an interpolated title; ' +
      'its run-time row is keyed by the rendered title and maps here by file+line only. Renamed ids need a row in requirement-aliases.json.',
    generatedFrom: 'src/scenarios/*.test.ts',
    counts: { files: files.length, tests: records.length, withStableId: withId, interpolatedTitles, explicitIds: records.filter((r) => r.explicitId !== null).length },
    records,
  };
}

function stable(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : 'report';
const fresh = generate();

if (mode === 'write') {
  writeFileSync(OUT, stable(fresh));
  if (!existsSync(ALIASES)) writeFileSync(ALIASES, stable({ $comment: 'old id → new id. Add a row when a test title is reworded so bundles citing the old id still resolve.', aliases: {} }));
  console.log(`wrote conformance/requirements.json: ${fresh.counts.tests} tests in ${fresh.counts.files} files (${fresh.counts.withStableId} stable ids, ${fresh.counts.interpolatedTitles} interpolated titles, ${fresh.counts.explicitIds} explicit req() ids)`);
} else if (mode === 'check') {
  const failures = [];
  if (!existsSync(OUT)) failures.push('conformance/requirements.json is missing — run generate-requirement-registry.mjs --write');
  else {
    const committed = JSON.parse(readFileSync(OUT, 'utf8'));
    const aliases = existsSync(ALIASES) ? JSON.parse(readFileSync(ALIASES, 'utf8')).aliases ?? {} : {};
    const freshIds = new Set(fresh.records.filter((r) => r.id !== null).map((r) => r.id));
    for (const r of committed.records ?? []) {
      if (r.id !== null && !freshIds.has(r.id) && !(r.id in aliases)) {
        failures.push(`id ${r.id} (${r.file}:${r.line}) no longer exists in the sources and has no alias row in requirement-aliases.json — a reworded title orphans bundles that cited it`);
      }
    }
    for (const [oldId, newId] of Object.entries(aliases)) {
      if (!freshIds.has(newId)) failures.push(`alias ${oldId} → ${newId}: the target id does not exist`);
    }
    if (stable(committed) !== stable(fresh)) failures.push('conformance/requirements.json is stale — run generate-requirement-registry.mjs --write (add alias rows for any reworded titles first)');
  }
  if (failures.length > 0) {
    console.error(`=== generate-requirement-registry --check FAILED — ${failures.length} problem(s) ===`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`=== requirement registry OK — ${fresh.counts.tests} tests / ${fresh.counts.withStableId} stable ids / ${fresh.counts.interpolatedTitles} interpolated titles; every retired id has an alias ===`);
} else {
  console.log(JSON.stringify(fresh.counts, null, 2));
}

#!/usr/bin/env node
/**
 * report-v2-witness-coverage — which v2 core obligations does a major-2 scenario
 * actually witness, and which lean on v1 scenarios that stop mattering at v1
 * end-of-support?
 *
 * A REPORT, not a gate. It measures; it does not decide conformance.
 *
 *   node scripts/report-v2-witness-coverage.mjs           table + JSON summary
 *   node scripts/report-v2-witness-coverage.mjs --json    JSON summary only
 *   node scripts/report-v2-witness-coverage.mjs --write   regenerate docs/V2-WITNESS-COVERAGE.md
 *   node scripts/report-v2-witness-coverage.mjs --check   exit 1 if that file is stale
 *
 * ## Inputs (corpus data only)
 *
 *   spec/v2/declaration.json          core families: normativeText, witness,
 *                                     owningRfc, floorScenarios, requirementIds
 *                                     (+ profile floors naming the family)
 *   conformance/requirements.json     every it(): file + authored citations
 *   conformance/scenario-majors.json  which major each scenario file runs at
 *   conformance/src/{scenarios,lib}   literal family gates in scenario code
 *   spec/v2/core/*.md                 headings + RFC 2119 obligation units
 *
 * ## Three witness signals, all authored, none inferred from prose meaning
 *
 *   gate  the scenario (or a lib helper it imports that gates on at most two
 *         families) names the family key as code: gateFamily('k'),
 *         familyAdvertised('k'), behaviorGate('k…' | 'openwop-k-in-kebab'),
 *         capabilityFamily(doc, 'k'), caps.k / capabilities.k / discovery.k,
 *         (families as Record<string, unknown>)['k']. Comments are stripped
 *         and, for the property forms, string literals blanked first. A gate
 *         can be negative (skip WHEN advertised); it is still counted.
 *         A gate helper called with a VARIABLE is resolved on the TypeScript
 *         AST, not by pattern: the argument is followed to the string literals
 *         it can hold — a parameter of a local helper (`leg(family)` ->
 *         every `leg('k')` call site), a for-of / .map / it.each element of a
 *         literal table (`for (const f of FACETS) familyAdvertised(f.family)`),
 *         a const, a destructured field. An exported lib function whose
 *         parameter flows into a gate helper is itself a gate helper. A value
 *         the AST cannot resolve (read from a JSON file at run time) counts for
 *         nothing. `--self-test` proves both directions on synthetic snippets.
 *   rfc   an it() citation names the family's owningRfc.
 *   cite  an it() citation names a v2 core section inside the family's
 *         normative home (declaration.json `normativeText`) that belongs to
 *         the family: a heading TITLED for it (`## \`mcp\``), any section of a
 *         document that homes that family alone, or (citing a parent) any
 *         subsection so owned. A SHARED section of a multi-family home
 *         (`storage.md` §Shared rules) credits only the homed families the same
 *         scenario also gates on: the citation says which rule, the gate says
 *         which family, and neither alone can (RFC 0191).
 *
 * A family is `v2-witnessed` when any major-2 scenario carries a signal,
 * `v1-only` when only major-1 scenarios do, `unwitnessed` otherwise. That verdict
 * is NECESSARY, NOT SUFFICIENT: one gated scenario can witness one rule of a
 * family with thirty. The section table below is the finer measure.
 *
 * ## What this cannot do, stated rather than guessed
 *
 * It does not map a prose MUST to a requirement id. requirements.json records
 * carry citations, not the sentence they witness, and a regex over prose cannot
 * decide which rule a test discharges (RFC 0191). So obligation coverage is
 * counted at SECTION granularity: an obligation unit counts as "in a v2-cited
 * section" when a major-2 citation names its section or an ancestor. A cited
 * section can still hold uncited rules; the count is an upper bound on what is
 * witnessed. Family attribution of units in shared documents uses titled
 * headings only; the remaining units are reported as `shared`, not guessed.
 *
 * A v1 scenario's citations point at spec/v1 sections; whether that v1 rule is
 * the one restated in a v2 section is a semantic claim, so v1-only is decided
 * at family level (gate / rfc signals) only.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(join(ROOT, 'conformance/package.json'))('typescript');
const OUT = join(ROOT, 'docs/V2-WITNESS-COVERAGE.md');
const args = new Set(process.argv.slice(2));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const decl = json('spec/v2/declaration.json');
const reqs = json('conformance/requirements.json');
const majors = json('conformance/scenario-majors.json').majors;
const core = decl.families.filter((f) => f.anchor === 'core' && f.kind === 'family');
const KEYS = new Set(core.map((f) => f.key));
const byKey = new Map(core.map((f) => [f.key, f]));

// ---------------------------------------------------------------- obligations
const OBLIGATION = /\b(MUST NOT|MUST|SHOULD NOT|SHOULD|REQUIRED)\b/;
const norm = (s) => s.replace(/[`"'“”*§]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Parse a markdown doc into sections (h2..h4) with their own obligation units. */
function parseDoc(rel) {
  const text = read(rel).replace(/^```[\s\S]*?^```[^\n]*$/gm, '\n');
  const sections = [{ level: 1, title: '(preamble)', parent: null, units: [] }];
  const stack = [sections[0]];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const body = [];
    for (const l of lines) {
      const h = /^(#{1,6})\s+(.*)$/.exec(l.trim());
      if (!h) { body.push(l); continue; }
      const level = h[1].length;
      if (level === 1) continue;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const s = { level, title: h[2].trim(), parent: stack[stack.length - 1], units: [] };
      sections.push(s); stack.push(s);
    }
    if (!body.length) continue;
    const cur = stack[stack.length - 1];
    const split = body.length > 1 && (body.every((l) => l.trim().startsWith('|')) || body.every((l) => /^\s*([-*+]|\d+\.)\s/.test(l)));
    for (const u of split ? body : [body.join(' ')]) if (OBLIGATION.test(u)) cur.units.push(u.trim());
  }
  return sections;
}
const ancestors = (s) => { const out = []; for (let p = s; p; p = p.parent) out.push(p); return out; };
/** The family a heading is TITLED for: its whole text, or one of its backticked tokens. */
function titledFamilies(title) {
  const bare = title.replace(/^§\s*/, '').replace(/^\d+(\.\d+)*\.?\s+/, '').replace(/^host\./, '');
  const out = new Set();
  const whole = bare.replace(/`/g, '').trim();
  if (KEYS.has(whole)) out.add(whole);
  for (const m of bare.matchAll(/`(?:host\.)?([A-Za-z0-9]+)`/g)) if (KEYS.has(m[1]) && /^[`§\s\w-]*$/.test(bare.replace(/ and /g, ' '))) out.add(m[1]);
  return out;
}
const sectionMatches = (s, token) => {
  const t = norm(token);
  const n = norm(s.title);
  if (/^\d+(\.\d+)*$/.test(t)) return n === t || n.startsWith(`${t} `) || n.startsWith(`${t}. `);
  const strip = (x) => x.replace(/^\d+(\.\d+)*\.?\s+/, '').replace(/^the /, '');
  const tn = strip(t);
  const nn = strip(n);
  return tn.length > 1 && (nn === tn || nn.startsWith(tn));
};

const coreDocs = readdirSync(join(ROOT, 'spec/v2/core')).filter((f) => f.endsWith('.md')).sort();
const docs = new Map(coreDocs.map((f) => [`spec/v2/core/${f}`, parseDoc(`spec/v2/core/${f}`)]));
const homesOf = new Map(); // doc -> families homed there
for (const f of core) for (const h of f.normativeText ?? []) if (docs.has(h)) homesOf.set(h, [...(homesOf.get(h) ?? []), f.key]);
/** The family a document is NAMED for (`tool-catalog.md` -> `toolCatalog`), when it homes that family. */
const namedFor = (doc) => {
  const k = doc.replace(/^.*\//, '').replace(/\.md$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return (homesOf.get(doc) ?? []).includes(k) ? k : null;
};
/**
 * A section's owning family, in precedence order: a heading on it or an
 * ancestor TITLED for a family; else the sole family the document homes; else
 * the family the document is named for. Otherwise `null` (shared).
 */
function ownerOf(doc, s) {
  for (const a of ancestors(s)) { const t = titledFamilies(a.title); if (t.size === 1) return [...t][0]; if (t.size > 1) return [...t].join('+'); }
  const h = homesOf.get(doc) ?? [];
  return h.length === 1 ? h[0] : namedFor(doc);
}

// ------------------------------------------------------------------ citations
const scenarioFiles = new Set(Object.keys(majors));
const majorOf = (file) => majors[file] ?? null;
const isV2 = (file) => (majorOf(file) ?? []).includes(2);
const citesV2 = new Map(); // "doc|section-index" -> Set(file)
const docCitesV2 = new Map(); // doc -> Set(file) (doc-level, no §)
const unresolved = [];
const rfcCites = new Map(); // rfc number -> Set(file)
const citesAnyCore = new Set(); // major-2 files with at least one resolvable v2 core citation
const fileCites = new Map(); // major-2 file -> Set("doc|section-index")
for (const r of reqs.records) {
  if (!scenarioFiles.has(r.file)) continue; // corpus-coherence tests are not host witnesses
  for (const c of r.citations) {
    const sec = c.section ?? '';
    for (const m of sec.matchAll(/RFCS?[\s/]*0*(\d{1,4})\b/g)) {
      const k = m[1].padStart(4, '0');
      if (!rfcCites.has(k)) rfcCites.set(k, new Set());
      rfcCites.get(k).add(r.file);
    }
    if (!isV2(r.file)) continue;
    let lastDoc = null;
    for (const part of sec.replace(/\([^()]*\)/g, '').split(/[;·]|,\s*(?=§)/)) {
      const clean = part.trim().replace(/\s*\((?:RFC|RFCS)[^)]*\)\s*$/, '');
      const cont = /^§\s*(.+)$/.exec(clean); // "runs.md §1.2, §1.3": the second § continues the first doc
      const m = cont && lastDoc ? [null, lastDoc, cont[1]] : /(?:spec\/v2\/core\/)?([a-z0-9-]+)\.md\s*(?:§\s*(.+))?$/.exec(clean);
      if (!m || part.includes('spec/v1/')) { lastDoc = null; continue; }
      lastDoc = m[1];
      const doc = `spec/v2/core/${m[1]}.md`;
      if (!docs.has(doc)) continue;
      const raw = (m[2] ?? '').trim();
      const quoted = /^["“]([^"”]+)["”]/.exec(raw);
      const token = (quoted ? quoted[1] : raw.replace(/\s*\(.*$/, '')).trim();
      citesAnyCore.add(r.file);
      if (!token) { if (!docCitesV2.has(doc)) docCitesV2.set(doc, new Set()); docCitesV2.get(doc).add(r.file); continue; }
      const secs = docs.get(doc);
      const hit = secs.findIndex((s) => s.level > 1 && sectionMatches(s, token));
      if (hit < 0) { unresolved.push(`${r.file}: ${doc} §${token}`); continue; }
      const key = `${doc}|${hit}`;
      if (!citesV2.has(key)) citesV2.set(key, new Set());
      citesV2.get(key).add(r.file);
      if (!fileCites.has(r.file)) fileCites.set(r.file, new Set());
      fileCites.get(r.file).add(key);
    }
  }
}
/**
 * The families one resolved citation (`doc`, section `idx`) credits, given the
 * families the citing scenario gates on. Only families whose normative home is
 * `doc` qualify. Each section at or under the cited one credits its owner; a
 * shared (unowned) one credits the homed families in `gates`, and nothing else.
 */
function creditsOf(doc, idx, gates) {
  const secs = docs.get(doc);
  const s = secs[idx];
  const homed = new Set(homesOf.get(doc) ?? []);
  const out = new Set();
  for (const t of secs) {
    if (!ancestors(t).includes(s)) continue;
    const o = ownerOf(doc, t);
    for (const k of o ? o.split('+') : [...gates]) if (homed.has(k)) out.add(k);
  }
  return out;
}

/** Major-2 files citing this section or an ancestor (a cited parent covers its subsections). */
function v2CitersOf(doc, s) {
  const secs = docs.get(doc);
  const out = new Set();
  for (const a of ancestors(s)) for (const f of citesV2.get(`${doc}|${secs.indexOf(a)}`) ?? []) out.add(f);
  return out;
}

// ---------------------------------------------------------------------- gates
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1');
const GATE_RES = [
  /\b(?:gateFamily|familyAdvertised)\(\s*['"`]([A-Za-z0-9]+)['"`]/g,
  /\bbehaviorGate\(\s*['"`](?:family\.)?([A-Za-z0-9]+)/g,
  // behaviorGate('openwop-audit-log-integrity') names `auditLogIntegrity`: the gate-id convention.
  /\bbehaviorGate\(\s*['"`]openwop-([a-z0-9-]+?)['"`]/g,
  /\b(?:caps|capabilities|discovery|disc|v2Doc)\??\.([A-Za-z0-9]+)\b/g,
  /\b(?:caps|capabilities|discovery|disc|v2Doc)\??\.?\[\s*['"]([A-Za-z0-9]+)['"]\s*\]/g,
  /\bcapabilityFamily(?:<[^>]*>)?\([\s\S]{0,160}?,\s*['"]([A-Za-z0-9]+)['"]\s*\)/g,
  /as Record<string, unknown>\)\s*\[\s*['"]([A-Za-z0-9]+)['"]\s*\]/g,
];
const camel = (k) => k.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
// The call forms read their string argument; the property forms run on source
// with string literals blanked, so 'host lacks capabilities.secrets support' is
// a message, not a gate.
const blankStrings = (s) => s.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`/g, '""');

/** Gate helpers and the argument position that names the family. */
const BASE_HELPERS = new Map([['gateFamily', 0], ['familyAdvertised', 0], ['capabilityFamily', 1]]);
const ITERATORS = new Set(['map', 'flatMap', 'forEach', 'filter', 'find', 'some', 'every']);
const unwrap = (e) => {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isAwaitExpression(e) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)))) e = e.expression;
  return e;
};
const nameOf = (n) => (n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : null);
/** The name a function-like node is called by in this file, if any. */
function fnName(fn) {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
  return null;
}
const isExported = (fn) => {
  const holder = ts.isFunctionDeclaration(fn) ? fn : fn.parent?.parent?.parent; // arrow: VariableDeclaration -> List -> Statement
  return !!holder && (ts.getModifiers?.(holder) ?? holder.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
};
/** Where the name `x` is bound, seen from `at`: a parameter, a for-of element, or a const. `prop` = destructured field. */
function binding(x, at) {
  const inPattern = (name) => {
    if (ts.isIdentifier(name)) return name.text === x ? { prop: null } : null;
    if (ts.isObjectBindingPattern(name)) for (const el of name.elements) if (ts.isIdentifier(el.name) && el.name.text === x) return { prop: nameOf(el.propertyName) ?? x };
    return null;
  };
  for (let p = at.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) && p.parameters) {
      for (let i = 0; i < p.parameters.length; i++) { const b = inPattern(p.parameters[i].name); if (b) return { kind: 'param', fn: p, index: i, prop: b.prop }; }
    }
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && ts.isVariableDeclarationList(p.initializer)) {
      for (const d of p.initializer.declarations) { const b = inPattern(d.name); if (b) return ts.isForOfStatement(p) ? { kind: 'value', expr: p.expression, prop: b.prop } : null; }
    }
    const stmts = ts.isSourceFile(p) || ts.isBlock(p) || ts.isModuleBlock(p) ? p.statements : null;
    for (const st of stmts ?? []) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) { const b = inPattern(d.name); if (b && d.initializer) return { kind: 'value', expr: d.initializer, prop: b.prop }; }
    }
  }
  return null;
}
/**
 * Every leaf value `expr` can hold, as AST nodes (string literals, object
 * literals); array elements are flattened, so a table yields its rows. Only
 * what the source spells out is followed; anything else yields nothing.
 */
function valuesOf(expr, ctx, depth = 0) {
  const e = unwrap(expr);
  if (!e || depth > 10 || ctx.seen.has(e)) return [];
  ctx.seen.add(e);
  try {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isObjectLiteralExpression(e)) return [e];
    if (ts.isArrayLiteralExpression(e)) return e.elements.flatMap((el) => valuesOf(ts.isSpreadElement(el) ? el.expression : el, ctx, depth + 1));
    if (ts.isConditionalExpression(e)) return [...valuesOf(e.whenTrue, ctx, depth + 1), ...valuesOf(e.whenFalse, ctx, depth + 1)];
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)) return [...valuesOf(e.left, ctx, depth + 1), ...valuesOf(e.right, ctx, depth + 1)];
    if (ts.isPropertyAccessExpression(e)) return fieldOf(valuesOf(e.expression, ctx, depth + 1), e.name.text, ctx, depth);
    if (ts.isElementAccessExpression(e)) { const k = nameOf(unwrap(e.argumentExpression)); const base = valuesOf(e.expression, ctx, depth + 1); return k ? fieldOf(base, k, ctx, depth) : base; }
    if (!ts.isIdentifier(e)) return [];
    const b = binding(e.text, e);
    if (!b) return [];
    let vals = [];
    if (b.kind === 'value') vals = valuesOf(b.expr, ctx, depth + 1);
    else {
      const name = fnName(b.fn);
      if (name) for (const c of ctx.calls.get(name) ?? []) vals.push(...valuesOf(c.arguments[b.index], ctx, depth + 1));
      // A callback's element parameter: TABLE.map((row) => …), it.each(TABLE)('…', (row) => …).
      const call = b.fn.parent;
      if (b.index === 0 && call && ts.isCallExpression(call) && call.arguments.includes(b.fn)) {
        const callee = unwrap(call.expression);
        if (ts.isPropertyAccessExpression(callee) && ITERATORS.has(callee.name.text)) vals.push(...valuesOf(callee.expression, ctx, depth + 1));
        if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'each') vals.push(...callee.arguments.flatMap((a) => valuesOf(a, ctx, depth + 1)));
      }
    }
    return b.prop ? fieldOf(vals, b.prop, ctx, depth) : vals;
  } finally { ctx.seen.delete(e); }
}
function fieldOf(nodes, key, ctx, depth) {
  const out = [];
  for (const n of nodes) {
    if (!ts.isObjectLiteralExpression(n)) continue;
    for (const p of n.properties) {
      if (ts.isPropertyAssignment(p) && nameOf(p.name) === key) out.push(...valuesOf(p.initializer, ctx, depth + 1));
      else if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) out.push(...valuesOf(p.name, ctx, depth + 1));
    }
  }
  return out;
}
/**
 * AST pass over one file: the families every gate-helper call can name, and
 * the exported functions that are themselves gate helpers (a parameter flows
 * straight into a helper's family argument).
 */
function astGates(src, helpers) {
  const sf = ts.createSourceFile('scenario.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls = new Map();
  const all = [];
  (function walk(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) { all.push(n); if (!calls.has(n.expression.text)) calls.set(n.expression.text, []); calls.get(n.expression.text).push(n); }
    ts.forEachChild(n, walk);
  })(sf);
  const families = new Set();
  const derived = new Map();
  for (const c of all) {
    const idx = helpers.get(c.expression.text);
    if (idx === undefined || !c.arguments[idx]) continue;
    for (const v of valuesOf(c.arguments[idx], { calls, seen: new Set() })) {
      if ((ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) && KEYS.has(camel(v.text))) families.add(camel(v.text));
    }
    const arg = unwrap(c.arguments[idx]);
    const b = ts.isIdentifier(arg) ? binding(arg.text, arg) : null;
    if (b?.kind === 'param' && !b.prop && isExported(b.fn) && fnName(b.fn)) derived.set(fnName(b.fn), b.index);
  }
  return { families, derived };
}
let HELPERS = new Map(BASE_HELPERS);
const gatesIn = (src) => {
  const s = stripComments(src);
  const code = blankStrings(s);
  const out = new Set();
  GATE_RES.forEach((re, i) => { for (const m of (i === 3 ? code : s).matchAll(re)) if (KEYS.has(camel(m[1]))) out.add(camel(m[1])); });
  for (const k of astGates(src, HELPERS).families) out.add(k);
  return out;
};
/** Lib files' exported gate helpers, to a fixed point (a helper may wrap another lib's helper). */
function deriveHelpers(libSources) {
  const helpers = new Map(BASE_HELPERS);
  for (let grew = true; grew;) {
    grew = false;
    for (const src of libSources) for (const [n, i] of astGates(src, helpers).derived) if (!helpers.has(n)) { helpers.set(n, i); grew = true; }
  }
  return helpers;
}

// ------------------------------------------------------------------ self-test
// Synthetic snippets, run against the live declaration and v2 core docs.
// Positive cases MUST be detected; negative cases MUST NOT be.
function selfTest() {
  const sortU = (x) => [...x].sort();
  let bad = 0;
  const fail = (m) => { process.stderr.write(`self-test: ${m}\n`); bad++; };
  const lib = "export async function probeFamily(name: string) { return familyAdvertised(name); }\nexport async function probeTwice(n: string) { return probeFamily(n); }";
  const saved = HELPERS;
  HELPERS = deriveHelpers([lib]);
  if (HELPERS.get('probeFamily') !== 0 || HELPERS.get('probeTwice') !== 0) fail(`derived lib helpers not found: ${JSON.stringify([...HELPERS])}`);
  const gateCases = [
    ['table rows, member access', "const FACETS = [{ family: 'kvStorage' }, { family: 'cache' }];\nfor (const f of FACETS) { await familyAdvertised(f.family); }", ['cache', 'kvStorage']],
    ['local helper with a parameter', "async function leg(family: string) { if (!(await familyAdvertised(family))) return; }\nit('a', () => leg('tableStorage'));\nit('b', () => leg('sql'));", ['sql', 'tableStorage']],
    ['it.each table', "it.each(['blobStorage'])('x', async (fam) => { await gateFamily(fam); });", ['blobStorage']],
    ['destructured for-of', "for (const { family } of [{ family: 'searchIndex' }]) await familyAdvertised(family);", ['searchIndex']],
    ['.map over a const table', "const T = ['vectorStore'] as const;\nawait Promise.all(T.map((k) => gateFamily(k)));", ['vectorStore']],
    ['derived lib helper, two hops', "import { probeTwice } from '../lib/p.js';\nawait probeTwice('nosql');", ['nosql']],
    ['capabilityFamily through a param', "function cap(d: unknown, n: string) { return capabilityFamily(d, n); }\ncap(doc, 'queueBus');", ['queueBus']],
    ['NEG family key to a non-gate helper', "function leg(x: string) { console.log(x); }\nleg('kvStorage');\nconst msg = 'memory';", []],
    ['NEG gate in a comment', "// await familyAdvertised('nosql');\n/* gateFamily('sql') */", []],
    ['NEG value read at run time', "const rows = JSON.parse(readFileSync(p, 'utf8')).rows;\nfor (const r of rows) await familyAdvertised(r.family);", []],
    ['NEG unrelated literal beside a variable gate', "const other = { family: 'cache' };\nasync function leg(family: string) { return familyAdvertised(family); }\nleg('kvStorage');", ['kvStorage']],
  ];
  for (const [name, src, want] of gateCases) {
    const got = sortU(gatesIn(src));
    if (JSON.stringify(got) !== JSON.stringify(want)) fail(`gate case "${name}": want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  HELPERS = saved;
  const sec = (doc, title) => { const i = docs.get(doc).findIndex((s) => s.level > 1 && sectionMatches(s, title)); if (i < 0) fail(`fixture section ${doc} §${title} not found`); return i; };
  const ST = 'spec/v2/core/storage.md';
  const HS = 'spec/v2/core/host-services.md';
  const citeCases = [
    ['shared section + gate credits the gated family only', ST, 'Shared rules', ['kvStorage'], ['kvStorage']],
    ['NEG shared section, no gate: ambiguous, credits nothing', ST, 'Shared rules', [], []],
    ['NEG shared section + a gate on a family homed elsewhere', ST, 'Shared rules', ['memory'], []],
    ['titled section credits its family without a gate', HS, 'memory', [], ['memory']],
    ['NEG titled section never credits a sibling family', HS, 'memory', ['queueBus'], ['memory']],
    ['a parent section credits its titled subsections', HS, 'secrets', [], ['secrets']],
  ];
  for (const [name, doc, title, gates, want] of citeCases) {
    const i = sec(doc, title);
    if (i < 0) continue;
    const got = sortU(creditsOf(doc, i, new Set(gates)));
    if (JSON.stringify(got) !== JSON.stringify(want)) fail(`cite case "${name}": want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  const n = gateCases.length + citeCases.length;
  if (bad) { process.stderr.write(`=== report-v2-witness-coverage self-test FAILED (${bad} of ${n}) ===\n`); process.exit(1); }
  process.stdout.write(`=== report-v2-witness-coverage self-test OK — ${n} cases (${gateCases.filter((c) => c[0].startsWith('NEG')).length + citeCases.filter((c) => c[0].startsWith('NEG')).length} negative) ===\n`);
  process.exit(0);
}
if (args.has('--self-test')) selfTest();

const libSources = new Map();
for (const f of readdirSync(join(ROOT, 'conformance/src/lib')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) libSources.set(f, readFileSync(join(ROOT, 'conformance/src/lib', f), 'utf8'));
HELPERS = deriveHelpers([...libSources.values()]);
const libGates = new Map();
for (const [f, src] of libSources) {
  const g = gatesIn(src);
  if (g.size > 0 && g.size <= 2) libGates.set(f.replace(/\.ts$/, ''), g);
}
const gateSignal = new Map(); // family -> Set(file)
for (const file of scenarioFiles) {
  const p = join(ROOT, 'conformance/src/scenarios', file);
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  const g = gatesIn(src);
  for (const m of src.matchAll(/from\s+['"]\.\.\/lib\/([\w.-]+?)(?:\.js)?['"]/g)) for (const k of libGates.get(m[1]) ?? []) g.add(k);
  for (const k of g) { if (!gateSignal.has(k)) gateSignal.set(k, new Set()); gateSignal.get(k).add(file); }
}

// ------------------------------------------------------------------- families
const sortU = (s) => [...s].sort();
const families = core.map((f) => {
  const homes = f.normativeText ?? [];
  const proseHomes = homes.filter((h) => docs.has(h));
  const schemaHomes = homes.filter((h) => !docs.has(h));
  let units = 0; let unitsCited = 0;
  for (const h of proseHomes) {
    for (const s of docs.get(h)) {
      const owner = ownerOf(h, s);
      if (!owner || !owner.split('+').includes(f.key)) continue;
      const citers = v2CitersOf(h, s);
      units += s.units.length;
      if (citers.size) unitsCited += s.units.length;
    }
  }
  const signals = new Map(); // file -> Set(kind)
  const add = (file, kind) => { if (!signals.has(file)) signals.set(file, new Set()); signals.get(file).add(kind); };
  for (const x of gateSignal.get(f.key) ?? []) add(x, 'gate');
  // An RFC that owns several families (0018, 0019, 0144) cannot say which one a citation witnesses.
  if (f.owningRfc && core.filter((g) => g.owningRfc === f.owningRfc).length === 1) for (const x of rfcCites.get(f.owningRfc) ?? []) add(x, 'rfc');
  for (const [x, keys] of fileCites) {
    const gates = new Set([...gateSignal.entries()].filter(([, files]) => files.has(x)).map(([k]) => k));
    for (const key of keys) { const [doc, i] = key.split('|'); if (creditsOf(doc, Number(i), gates).has(f.key)) { add(x, 'cite'); break; } }
  }
  const v2 = sortU([...signals.keys()].filter(isV2));
  const v1 = sortU([...signals.keys()].filter((x) => !isV2(x)));
  const profileFloors = decl.profiles.filter((p) => (p.predicate?.families ?? []).includes(f.key)).flatMap((p) => p.floorScenarios ?? []);
  const verdict = v2.length ? 'v2-witnessed' : v1.length ? 'v1-only' : 'unwitnessed';
  return {
    key: f.key, witness: f.witness, owningRfc: f.owningRfc ?? null, normativeText: homes, schemaHomes,
    floorScenarios: f.floorScenarios ?? [], requirementIds: f.requirementIds ?? [], profileFloors,
    obligationUnits: units, obligationUnitsInV2CitedSections: unitsCited,
    v2Scenarios: v2.map((x) => ({ file: x, signals: sortU(signals.get(x)) })),
    v1OnlyScenarios: v1.map((x) => ({ file: x, signals: sortU(signals.get(x)) })),
    verdict,
  };
});

// ------------------------------------------------------------------- sections
const sections = [];
for (const [doc, secs] of docs) {
  secs.forEach((s, i) => {
    if (!s.units.length) return;
    sections.push({ doc, section: s.title, owner: ownerOf(doc, s) ?? 'shared', units: s.units.length, v2Citers: sortU(v2CitersOf(doc, s)), docLevelV2Citers: sortU(docCitesV2.get(doc) ?? []), _i: i });
  });
}
const docTable = coreDocs.map((f) => {
  const d = `spec/v2/core/${f}`;
  const ss = sections.filter((s) => s.doc === d);
  const units = ss.reduce((a, s) => a + s.units, 0);
  const cited = ss.filter((s) => s.v2Citers.length).reduce((a, s) => a + s.units, 0);
  return { doc: d, units, unitsInV2CitedSections: cited, homes: homesOf.get(d) ?? [] };
});

// ---------------------------------------------------------------- top-20 risks
// Curated, not derived: picking the riskiest rule and designing its witness is
// judgement. Each row is RE-VERIFIED here against the live tree — the quote must
// still be in the doc, and the row reports whether its section has since gained
// a major-2 citation — so the list cannot silently go stale.
const RISKS = JSON.parse(read('scripts/lib/v2-witness-risks.json')).risks;
const risks = RISKS.map((r, i) => {
  const text = read(r.doc).replace(/\s+/g, ' ');
  const quoteFound = text.includes(r.rule.replace(/\s+/g, ' '));
  const secs = docs.get(r.doc) ?? [];
  const s = secs.find((x) => x.level > 1 && sectionMatches(x, r.section));
  const fam = families.find((x) => x.key === r.family);
  return { rank: i + 1, ...r, quoteFound, sectionResolved: !!s, sectionV2Citers: s ? sortU(v2CitersOf(r.doc, s)) : [], familyVerdict: fam?.verdict ?? 'n/a' };
});

// -------------------------------------------------------------------- summary
const noCoreCite = Object.keys(majors).filter((f) => isV2(f) && !citesAnyCore.has(f)).sort();
const count = (v) => families.filter((f) => f.verdict === v).length;
const totalUnits = sections.reduce((a, s) => a + s.units, 0);
const citedUnits = sections.filter((s) => s.v2Citers.length).reduce((a, s) => a + s.units, 0);
const uncitedSecs = sections.filter((s) => !s.v2Citers.length);
const summary = {
  families: { total: families.length, 'v2-witnessed': count('v2-witnessed'), 'v1-only': count('v1-only'), unwitnessed: count('unwitnessed') },
  byWitnessClass: Object.fromEntries(sortU(new Set(families.map((f) => f.witness))).map((w) => [w, Object.fromEntries(['v2-witnessed', 'v1-only', 'unwitnessed'].map((v) => [v, families.filter((f) => f.witness === w && f.verdict === v).length]))])),
  obligationUnits: { total: totalUnits, inV2CitedSections: citedUnits, inUncitedSections: totalUnits - citedUnits, sectionsWithObligations: sections.length, sectionsWithNoV2Citation: uncitedSecs.length },
  declarationLinks: { familiesWithFloorScenarios: families.filter((f) => f.floorScenarios.length).length, familiesWithRequirementIds: families.filter((f) => f.requirementIds.length).length },
  scenarios: { registered: scenarioFiles.size, major2: Object.values(majors).filter((m) => m.includes(2)).length },
  unresolvedV2Citations: unresolved.length,
  major2ScenariosCitingNoCoreDoc: Object.keys(majors).filter((f) => isV2(f) && !citesAnyCore.has(f)).length,
  risks: { listed: risks.length, staleQuotes: risks.filter((r) => !r.quoteFound).map((r) => r.rank), sectionsNowCited: risks.filter((r) => r.sectionV2Citers.length).map((r) => r.rank) },
};

// ------------------------------------------------------------------- markdown
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const esc = (s) => String(s).replace(/\|/g, '\\|');
function markdown() {
  const L = [];
  L.push('# v2 witness coverage', '');
  L.push('> **Status:** generated report, not normative. Regenerate with `node scripts/report-v2-witness-coverage.mjs --write`. A point-in-time report, not a gate: re-run it when scenarios or v2 prose change.', '');
  L.push('## Why this exists', '');
  L.push('Every v2 core family now has a v2 normative home (RFC 0189). Many of its rules are witnessed only by major-1 scenarios, or by nothing. At v1 end-of-support (not before the date in `evidence/v1-end-of-support.json`) a major-1 witness stops counting, and the rule is then checked by no test.', '');
  L.push('## Headline', '');
  const F = summary.families; const O = summary.obligationUnits;
  const wg = summary.byWitnessClass['witnessable-gated'] ?? {};
  const unitsBy = (v) => families.filter((f) => f.verdict === v).reduce((a, f) => a + f.obligationUnits, 0);
  L.push(`- **Families (${F.total} core):** ${F['v2-witnessed']} v2-witnessed, ${F['v1-only']} v1-only, ${F.unwitnessed} unwitnessed. Of the ${Object.values(wg).reduce((a, b) => a + b, 0)} \`witnessable-gated\` families, ${wg['v1-only'] ?? 0} are v1-only; every unwitnessed family is \`claims-check\`.`);
  L.push(`- **At v1 end-of-support:** the ${F['v1-only']} v1-only families, and the ${unitsBy('v1-only')} obligation units attributed to them, lose their only witness.`);
  L.push(`- **Obligation units (${O.total} in \`spec/v2/core/\`):** ${O.inV2CitedSections} (${pct(O.inV2CitedSections, O.total)}) sit in a section a major-2 scenario cites; ${O.inUncitedSections} sit in ${O.sectionsWithNoV2Citation} sections no major-2 scenario cites.`);
  L.push(`- **Declaration links:** ${summary.declarationLinks.familiesWithFloorScenarios} core families declare \`floorScenarios\`; ${summary.declarationLinks.familiesWithRequirementIds} declare \`requirementIds\`. The family-to-test link exists only in scenario code and citations, although \`overview.md\` §What a MUST means says every core MUST has an id in \`requirements.json\`.`);
  L.push(`- **Scenarios:** ${summary.scenarios.registered} registered, ${summary.scenarios.major2} run at major 2. ${summary.unresolvedV2Citations} major-2 citations name a v2 core section this script cannot match to a heading (see Citation gaps).`, '');
  L.push('## How to read it', '');
  L.push('- **Obligation unit:** a paragraph, table row or list item in `spec/v2/core/` with MUST, MUST NOT, SHOULD, SHOULD NOT or REQUIRED. Fenced code is ignored.');
  L.push('- **Signals:** `gate` = the scenario code names the family key, directly or through a local helper, a literal table or an exported lib helper (resolved on the TypeScript AST); `rfc` = an `it()` cites the family\'s owning RFC; `cite` = an `it()` cites a v2 section of the family\'s normative home that the family owns, or a shared section of that home when the same scenario also gates on the family.');
  L.push('- **Verdict:** `v2-witnessed` if a major-2 scenario carries a signal, `v1-only` if only major-1 scenarios do, else `unwitnessed`. It is necessary, not sufficient: one gated scenario can witness one rule of thirty.');
  L.push('- **Not measured:** which prose rule a given `it()` discharges. Citations name sections, not sentences, and no regex can decide it (RFC 0191). A cited section can still hold unwitnessed rules, so the cited-section count is an upper bound.');
  L.push('- **Attribution:** a section belongs to a family when its heading (or an ancestor\'s) is titled for it, when its document homes that family alone, or when the document is named for it (`replay.md`). Anything else is `shared`.', '');
  L.push('## Per-family coverage', '');
  L.push('| Family | Witness class | Verdict | Units (v2-cited) | Major-2 witnesses | Major-1-only witnesses |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  const order = { unwitnessed: 0, 'v1-only': 1, 'v2-witnessed': 2 };
  const fams = [...families].sort((a, b) => order[a.verdict] - order[b.verdict] || b.obligationUnits - a.obligationUnits || a.key.localeCompare(b.key));
  const list = (xs) => (xs.length ? (xs.length > 4 ? `${xs.slice(0, 4).map((x) => `\`${x.file.replace('.test.ts', '')}\``).join(', ')} +${xs.length - 4}` : xs.map((x) => `\`${x.file.replace('.test.ts', '')}\``).join(', ')) : '–');
  for (const f of fams) L.push(`| \`${f.key}\` | ${f.witness} | **${f.verdict}** | ${f.obligationUnits} (${f.obligationUnitsInV2CitedSections}) | ${list(f.v2Scenarios)} | ${list(f.v1OnlyScenarios)} |`);
  L.push('');
  L.push('## Per-document coverage', '');
  L.push('| Document | Units | In v2-cited sections | Homes |');
  L.push('| --- | --- | --- | --- |');
  for (const d of docTable) L.push(`| \`${d.doc.replace('spec/v2/core/', '')}\` | ${d.units} | ${d.unitsInV2CitedSections} (${pct(d.unitsInV2CitedSections, d.units)}) | ${d.homes.map((h) => `\`${h}\``).join(', ') || '–'} |`);
  L.push('');
  L.push('## Largest uncited sections', '');
  L.push('Sections with the most obligation units and no major-2 citation. A doc-level citation (no §) does not count.', '');
  L.push('| Document § | Owner | Units |');
  L.push('| --- | --- | --- |');
  for (const s of [...uncitedSecs].sort((a, b) => b.units - a.units || a.doc.localeCompare(b.doc) || a._i - b._i).slice(0, 25)) L.push(`| \`${s.doc.replace('spec/v2/core/', '')}\` § ${esc(s.section)} | ${s.owner} | ${s.units} |`);
  L.push('');
  L.push('## Citation gaps', '');
  L.push(`These ${noCoreCite.length} major-2 scenarios cite no \`spec/v2/core\` document (only RFCs, schemas or the interop map). Whatever they witness is invisible to the section counts above; \`v2-durability-recovery\`, for one, witnesses \`persistence.md\` §Durable acceptance through RFC 0158 only.`, '');
  L.push(noCoreCite.map((f) => `\`${f.replace('.test.ts', '')}\``).join(', '), '');
  L.push(`${unresolved.length} major-2 citations name a v2 core section that matches no heading (most are \`tool-catalog.md\` §A–§F, RFC section letters):`, '');
  for (const [k, n] of [...unresolved.reduce((m, u) => m.set(u.split(': ').slice(1).join(': '), (m.get(u.split(': ').slice(1).join(': ')) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) L.push(`- ${esc(k)} (${n})`);
  L.push('');
  L.push('## Top-20 risks', '');
  L.push('Ranked: security, tenant isolation, idempotency and replay first; then wire shape; then behaviour. Curated in `scripts/lib/v2-witness-risks.json`; the script re-checks each quote and section on every run.', '');
  L.push('| # | Family | Doc § | Class | Verdict | Proposed scenario |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  const famCell = (k) => (byKey.has(k) ? `\`${k}\`` : '–');
  const dot = (t) => (/[.!?]$/.test(t) ? t : `${t}.`);
  for (const r of risks) L.push(`| ${r.rank} | ${famCell(r.family)} | \`${r.doc.replace('spec/v2/core/', '')}\` § ${esc(r.section)} | ${r.class} | ${r.familyVerdict} | \`${r.scenario.name}\` |`);
  L.push('');
  for (const r of risks) {
    L.push(`### ${r.rank}. ${r.title}`, '');
    L.push(`- **Rule** (\`${r.doc.replace('spec/v2/core/', '')}\` § ${r.section}): "${r.rule}"${r.quoteFound ? '' : ' **[quote no longer found — re-check]**'}`);
    L.push(`- **Today:** ${r.today}${r.sectionV2Citers.length ? ` The section is now cited at major 2 by ${r.sectionV2Citers.map((x) => `\`${x}\``).join(', ')}; re-check whether this rule is covered.` : ''}`);
    L.push(`- **Why it matters:** ${r.why}`);
    L.push(`- **Proposed:** \`${r.scenario.name}\` (major 2; gate: ${r.scenario.gate}). Asserts: ${dot(r.scenario.asserts)}`);
    L.push(`- **Sabotage that must fail it:** ${dot(r.scenario.sabotage)}`, '');
  }
  L.push('## Re-run', '');
  L.push('```sh');
  L.push('node scripts/report-v2-witness-coverage.mjs          # table + JSON summary');
  L.push('node scripts/report-v2-witness-coverage.mjs --write  # regenerate this file');
  L.push('```', '');
  L.push('## JSON summary', '');
  L.push('```json', JSON.stringify(summary, null, 2), '```', '');
  return L.join('\n');
}

if (args.has('--write')) { writeFileSync(OUT, markdown()); process.stdout.write(`wrote ${OUT.replace(ROOT + '/', '')}\n`); process.exit(0); }
if (args.has('--check')) {
  const want = markdown();
  const have = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const bad = [];
  if (have !== want) bad.push('docs/V2-WITNESS-COVERAGE.md is stale — run `node scripts/report-v2-witness-coverage.mjs --write`');
  if (summary.risks.staleQuotes.length) bad.push(`risk rows ${summary.risks.staleQuotes.join(', ')} quote a rule no longer in the doc — update scripts/lib/v2-witness-risks.json`);
  process.stdout.write(`=== report-v2-witness-coverage --check ===\n${bad.length ? bad.map((b) => `FAIL ${b}`).join('\n') : 'OK   report is current'}\n`);
  process.exit(bad.length ? 1 : 0);
}
if (!args.has('--json')) {
  const w = (s, n) => String(s).padEnd(n);
  process.stdout.write(`${w('family', 32)}${w('class', 20)}${w('verdict', 14)}${w('units', 7)}${w('cited', 7)}${w('v2', 5)}v1-only\n`);
  for (const f of families) process.stdout.write(`${w(f.key, 32)}${w(f.witness, 20)}${w(f.verdict, 14)}${w(f.obligationUnits, 7)}${w(f.obligationUnitsInV2CitedSections, 7)}${w(f.v2Scenarios.length, 5)}${f.v1OnlyScenarios.length}\n`);
  process.stdout.write('\n');
}
process.stdout.write(JSON.stringify(args.has('--json') ? { summary, families, documents: docTable, uncitedSections: uncitedSecs.map(({ _i, ...x }) => x), major2ScenariosCitingNoCoreDoc: noCoreCite, risks, unresolvedV2Citations: unresolved } : summary, null, 2) + '\n');

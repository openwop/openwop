#!/usr/bin/env node
/**
 * check-req-only — RFC 0168 §A.1 (suite 2.0.0): `req(id, section, requirement)`
 * is the ONLY assertion-message form in the conformance scenarios.
 *
 * Fails when, in any `conformance/src/scenarios/**` or `conformance/src/coherence/**`
 * `.test.ts` file:
 *   (a) `driver.describe(` is called — the pre-2.0.0 form carries no requirement id;
 *   (b) an `expect(...)` inside an `it` body passes a string literal / template
 *       literal as its message — an assertion nobody can map to a requirement;
 *   (c) an `it` body contains a bare `return;` / `return undefined;` that is not
 *       `return softSkip(...)` / `return seamAbsent(...)` — RFC 0148 G8: an
 *       unclassified return records a pass / blocked row with no reason;
 *   (d) two `it`s in one file cite different explicit ids in one body, or two
 *       `it`s share the same explicit id — the ledger keys on the id, so the two
 *       rows would overwrite each other.
 *
 * Only `it` callbacks are inspected for (b) and (c); a `return` inside a nested
 * function (a `.find(x => ...)` predicate, say) is that function's return, not
 * the test's. No dependencies beyond node + the conformance package's own
 * `typescript` (loaded through createRequire, like the registry generator).
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONF = join(ROOT, 'conformance');
const ts = createRequire(join(CONF, 'package.json'))('typescript');
const DIRS = ['scenarios', 'coherence'].map((d) => join(CONF, 'src', d)).filter((d) => existsSync(d));

const failures = [];
let files = 0;
let its = 0;

function isItCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text === 'it' || e.text === 'test';
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    return (e.expression.text === 'it' || e.expression.text === 'test') && ['skip', 'only', 'todo', 'skipIf', 'runIf'].includes(e.name.text);
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression)) {
    return e.expression.expression.text === 'it' || e.expression.expression.text === 'test';
  }
  return false;
}
function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node);
}
function isExpectCallee(e) {
  if (ts.isIdentifier(e)) return e.text === 'expect';
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) return e.expression.text === 'expect';
  return false;
}
function isStringish(node) {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node));
}
const GATE_RE = /\b(?:behaviorGate|behaviorGatePresent|experimentalGate)\(/;
/** Is this return the `then`/`else` of an `if` whose condition consults a journaling gate? */
function isGateGuarded(ret, fn) {
  let p = ret.parent;
  while (p !== undefined && p !== fn && !ts.isIfStatement(p)) p = p.parent;
  return p !== undefined && p !== fn && ts.isIfStatement(p) && GATE_RE.test(p.expression.getText());
}
function isClassifiedReturn(expr) {
  return expr !== undefined && ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && ['softSkip', 'seamAbsent'].includes(expr.expression.text);
}

for (const dir of DIRS) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort()) {
    const full = join(dir, file);
    const rel = full.slice(ROOT.length + 1);
    const src = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true);
    files++;
    const at = (node) => `${rel}:${src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1}`;
    const explicitByIt = new Map(); // id → first it location

    // (a) anywhere in the file — helpers included.
    const visitAll = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'driver' &&
          node.expression.name.text === 'describe') {
        failures.push(`${at(node)}: driver.describe() — pre-2.0.0 form; use req('<id>', section, requirement)`);
      }
      if (isItCall(node)) {
        its++;
        const body = node.arguments[1];
        if (body !== undefined && isFunctionLike(body)) inspectItBody(body, node);
        // Walk the arguments (the body, for (a)) but not the callee: `it.skipIf(c)('t', fn)`
        // is ONE test, and its inner `it.skipIf(c)` call would otherwise count twice.
        for (const a of node.arguments) visitAll(a);
        return;
      }
      ts.forEachChild(node, visitAll);
    };

    function inspectItBody(fn, itNode) {
      const idsHere = new Set();
      // (b) and (c): walk the it callback but not into nested functions for (c);
      // (b) applies at any depth inside the it body (a nested forEach still asserts for this test).
      const walk = (node, inNested) => {
        if (ts.isCallExpression(node)) {
          if (isExpectCallee(node.expression) && isStringish(node.arguments[1])) {
            failures.push(`${at(node)}: expect() message is a bare string — wrap it in req('<id>', section, requirement)`);
          }
          if (ts.isIdentifier(node.expression) && node.expression.text === 'req') {
            const a = node.arguments[0];
            if (a !== undefined && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) idsHere.add(a.text);
          }
        }
        if (ts.isReturnStatement(node) && !inNested) {
          const e = node.expression;
          const bare = e === undefined || (ts.isIdentifier(e) && e.text === 'undefined') || (ts.isVoidExpression(e));
          // `if (!behaviorGate(...)) return;` is classified: the gate itself journals
          // the inapplicable / skipped reason (lib/behavior-gate.ts), which is what
          // setup.ts reads for the per-it row. Only a return NO gate spoke for is bare.
          if (bare && !isGateGuarded(node, fn)) failures.push(`${at(node)}: bare return in an it body — say why: return softSkip(kind, reason) / return seamAbsent(reason) (RFC 0148 G8)`);
        }
        if (isItCall(node) && node !== itNode) return; // a nested it() is its own test
        ts.forEachChild(node, (c) => walk(c, inNested || (isFunctionLike(c))));
      };
      walk(fn.body ?? fn, false);
      if (idsHere.size > 1) failures.push(`${at(itNode)}: one it() cites ${idsHere.size} different explicit ids (${[...idsHere].join(', ')}) — the ledger keeps the LAST one`);
      for (const id of idsHere) {
        const prior = explicitByIt.get(id);
        if (prior !== undefined && prior !== itNode) failures.push(`${at(itNode)}: explicit id ${id} is already used by the it() at ${at(prior)}`);
        else explicitByIt.set(id, itNode);
      }
    }

    visitAll(src);
  }
}

// The bundle schema refuses corpus-coherence ids by name (RFC 0168 §D.1:
// coherence checks run in the spec repo's CI and never enter a host bundle).
// The list is a regex, so it drifts silently when a coherence file is added or
// renamed — and a drifted list would let that file's ids into a bundle.
{
  const coherenceDir = join(CONF, 'src', 'coherence');
  const schemaPath = join(CONF, '..', 'schemas', 'v2', 'certification-bundle.schema.json');
  if (existsSync(coherenceDir) && existsSync(schemaPath)) {
    const stems = readdirSync(coherenceDir).filter((f) => f.endsWith('.test.ts')).map((f) => f.replace(/\.test\.ts$/, '')).sort();
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const pattern = schema?.properties?.results?.properties?.requirements?.items?.properties?.id?.pattern ?? '';
    const listed = (/\(\?!it\\\.\(\?:([^)]*)\)/.exec(pattern) ?? [, ''])[1].split('|').map((x) => x.replace(/\\/g, '')).filter(Boolean).sort();
    const missing = stems.filter((x) => !listed.includes(x));
    const extra = listed.filter((x) => !stems.includes(x));
    if (missing.length || extra.length) {
      failures.push(`schemas/v2/certification-bundle.schema.json id pattern is out of step with conformance/src/coherence/${missing.length ? ` — not excluded: ${missing.join(', ')}` : ''}${extra.length ? ` — excluded but absent: ${extra.join(', ')}` : ''}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`=== check-req-only FAILED — ${failures.length} problem(s) in ${files} scenario files ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`=== check-req-only OK — ${files} scenario files, ${its} it() blocks, all assertions carry a requirement id ===`);

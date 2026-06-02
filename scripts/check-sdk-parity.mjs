#!/usr/bin/env node
// check-sdk-parity.mjs — SDK parity gate (openwop:check step 4b).
//
// Enforces that every OpenAPI operation has a *declared* parity status for
// each reference SDK (TypeScript / Python / Go), and that any operation
// declared `typed` is actually wired in that SDK's source.
//
// Source of truth: `sdk/parity-expectations.json` — one entry per OpenAPI
// operation with `{operationId, method, path, ts, py, go, note?}`, each
// status either `"typed"` (a first-class helper exists) or `"excluded"`
// (intentionally not in the SDK — requires a `note`).
//
// Three failure modes are caught:
//   1. Coverage drift — a new OpenAPI operation with no expectations entry
//      (someone added a route without declaring its SDK status).
//   2. Orphan drift — an expectations entry whose operationId no longer
//      exists in OpenAPI (a route was removed/renamed).
//   3. Regression — an operation declared `typed` whose path is no longer
//      referenced anywhere in that SDK's source (a whole surface was
//      deleted). Verified against the operation's most-distinctive static
//      path fragment, which params/interpolation can't perturb.
//
// Dependency-free (runs under bare `node` in CI, no node_modules at root).
// OpenAPI operationIds are extracted the same way as
// generate-protocol-status.mjs (a line regex), so the two gates agree on
// the operation set.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const SDK_SOURCES = {
  ts: { label: 'TypeScript', dir: 'sdk/typescript/src', exts: ['.ts'], skip: /\.test\.|__tests__/ },
  py: { label: 'Python', dir: 'sdk/python/src/openwop_client', exts: ['.py'], skip: /(^|\/)test/ },
  go: { label: 'Go', dir: 'sdk/go', exts: ['.go'], skip: /_test\.go$/ },
};

function fail(msg, items) {
  console.error(`  FAIL: ${msg}`);
  for (const i of items) console.error(`    - ${i}`);
  process.exit(1);
}

// ── OpenAPI operation set (operationId → {method, path}) ──
// Walk the `paths:` block so we can attach each operationId to its path.
function parseOpenApiOps() {
  const text = read('api/openapi.yaml');
  const lines = text.split('\n');
  const ops = new Map(); // operationId -> {method, path}
  let curPath = null;
  let curMethod = null;
  for (const line of lines) {
    const pathM = line.match(/^ {2}(\/\S*):\s*$/); // 2-space indent under paths:
    if (pathM) { curPath = pathM[1]; curMethod = null; continue; }
    const methodM = line.match(/^ {4}(get|post|put|delete|patch):\s*$/);
    if (methodM) { curMethod = methodM[1].toUpperCase(); continue; }
    const opM = line.match(/^ {6}operationId:\s*([A-Za-z0-9_]+)/);
    if (opM && curPath && curMethod) ops.set(opM[1], { method: curMethod, path: curPath });
  }
  return ops;
}

// Most-distinctive static fragment of a path: the longest run of literal
// (non-`{param}`) characters, trailing slash trimmed. Used as a regression
// anchor — a typed method that calls this path necessarily contains this
// substring verbatim, regardless of how params are interpolated.
function distinctiveFragment(path) {
  const fragments = path.split(/\{[^}]*\}/).map((f) => f.replace(/\/+$/, ''));
  let best = '';
  for (const f of fragments) {
    const alnum = f.replace(/[^A-Za-z0-9]/g, '');
    if (alnum.length > best.replace(/[^A-Za-z0-9]/g, '').length) best = f;
  }
  return best;
}

function collectSource({ dir, exts, skip }) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(join(ROOT, d))) {
      const rel = join(d, name);
      if (skip.test(rel)) continue;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) walk(rel);
      else if (exts.some((e) => name.endsWith(e)) && !skip.test(name)) out.push(read(rel));
    }
  };
  walk(dir);
  return out.join('\n');
}

// ── Load expectations ──
const expDoc = JSON.parse(read('sdk/parity-expectations.json'));
const expectations = expDoc.operations;
const expById = new Map(expectations.map((e) => [e.operationId, e]));

const openapiOps = parseOpenApiOps();

// 1. Coverage: every OpenAPI op is declared.
const undeclared = [...openapiOps.keys()].filter((id) => !expById.has(id));
if (undeclared.length) {
  fail(
    'OpenAPI operations with no sdk/parity-expectations.json entry (declare ts/py/go status, or mark excluded with a note):',
    undeclared.map((id) => `${id} (${openapiOps.get(id).method} ${openapiOps.get(id).path})`),
  );
}

// 2. Orphans: every declared op still exists in OpenAPI.
const orphans = expectations.filter((e) => !openapiOps.has(e.operationId)).map((e) => e.operationId);
if (orphans.length) {
  fail('sdk/parity-expectations.json entries for operationIds not present in api/openapi.yaml (stale — remove or rename):', orphans);
}

// 3. Status validity + path agreement.
const STATUS = new Set(['typed', 'excluded']);
const invalid = [];
for (const e of expectations) {
  for (const lang of ['ts', 'py', 'go']) {
    if (!STATUS.has(e[lang])) invalid.push(`${e.operationId}.${lang}="${e[lang]}" (must be "typed" or "excluded")`);
  }
  if ((e.ts === 'excluded' || e.py === 'excluded' || e.go === 'excluded') && !e.note) {
    invalid.push(`${e.operationId} marks a SDK "excluded" but has no "note" explaining why`);
  }
  const live = openapiOps.get(e.operationId);
  if (live && e.path !== live.path) {
    invalid.push(`${e.operationId} path drift: expectations="${e.path}" openapi="${live.path}"`);
  }
}
if (invalid.length) fail('Invalid sdk/parity-expectations.json entries:', invalid);

// 4. Regression: every `typed` op's distinctive path fragment is present in
//    that SDK's source.
const sources = Object.fromEntries(Object.entries(SDK_SOURCES).map(([k, v]) => [k, collectSource(v)]));
const missing = [];
for (const e of expectations) {
  const frag = distinctiveFragment(e.path);
  if (!frag || frag.replace(/[^A-Za-z0-9]/g, '').length < 4) continue; // too generic to anchor on
  for (const lang of ['ts', 'py', 'go']) {
    if (e[lang] !== 'typed') continue;
    if (!sources[lang].includes(frag)) {
      missing.push(`${e.operationId} declared typed in ${SDK_SOURCES[lang].label} but "${frag}" is not referenced in ${SDK_SOURCES[lang].dir}`);
    }
  }
}
if (missing.length) {
  fail('SDK parity regressions (declared typed but the path is no longer wired):', missing);
}

const typed = expectations.filter((e) => e.ts === 'typed' && e.py === 'typed' && e.go === 'typed').length;
const excluded = expectations.filter((e) => e.ts === 'excluded').length;
console.log(`  ok: SDK parity — ${openapiOps.size} OpenAPI operations declared; ${typed} fully typed across TS/Python/Go, ${excluded} intentionally excluded`);

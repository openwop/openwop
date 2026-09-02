#!/usr/bin/env node
/**
 * check-deprecations — keep spec/v1/deprecations.json honest (COMPATIBILITY.md §7).
 *
 * The register is an INDEX of deprecations the RFC process has already made
 * (status: deprecated) plus surfaces the v2 program proposes to deprecate but no
 * RFC has yet (status: proposed). In v1.x it creates no obligation; what this
 * gate protects is that the index cannot drift away from the corpus it indexes.
 *
 * Checks:
 *   1. schema   — the register validates against spec/v1/deprecations.schema.json
 *   2. ids      — every `id` is unique
 *   3. sources  — every cited source file exists and still contains its token
 *                 (a reword that drops the deprecation text fails here)
 *   4. removeIn — a v1.x deprecation removes no earlier than 2.0; a proposed row
 *                 carries deprecatedIn: null (the schema enforces the latter)
 *   5. status   — a `deprecated` row cites at least one authority source that is
 *                 an RFC, a spec doc, or a schema (never only the charter)
 *
 * What it deliberately does NOT do: decide that something IS deprecated. That is
 * an RFC's job. A new `status: deprecated` row must point at the RFC or
 * annotation that made it.
 *
 * Exit 0 on success, 1 on any failure (three-outcome discipline: a file the gate
 * cannot read is a failure, not a pass).
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = join(ROOT, 'spec', 'v1', 'deprecations.json');
const SCHEMA = join(ROOT, 'spec', 'v1', 'deprecations.schema.json');

const failures = [];
const fail = (m) => failures.push(m);

let register;
let schema;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
  schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
} catch (e) {
  console.error(`check-deprecations: cannot read register or schema: ${e.message}`);
  process.exit(1);
}

// 1. schema — Ajv lives in conformance/node_modules (installed by openwop-check step 1).
try {
  const require = createRequire(join(ROOT, 'conformance', 'package.json'));
  const Ajv2020 = require('ajv/dist/2020').default ?? require('ajv/dist/2020');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(register)) {
    for (const err of validate.errors ?? []) fail(`schema: ${err.instancePath || '/'} ${err.message}`);
  }
} catch (e) {
  fail(`schema: could not load Ajv from conformance/node_modules (${e.message}); run \`npm install\` in conformance/ first`);
}

const entries = Array.isArray(register?.entries) ? register.entries : [];

// 2. ids
const seen = new Set();
for (const e of entries) {
  if (seen.has(e.id)) fail(`ids: duplicate id ${e.id}`);
  seen.add(e.id);
}

// 3. sources
for (const e of entries) {
  for (const s of e.sources ?? []) {
    const p = join(ROOT, s.file);
    if (!existsSync(p)) {
      fail(`sources: ${e.id} cites ${s.file}, which does not exist`);
      continue;
    }
    const text = readFileSync(p, 'utf8');
    if (!text.includes(s.token)) {
      fail(`sources: ${e.id} — ${s.file} no longer contains ${JSON.stringify(s.token)}; update the register or restore the annotation`);
    }
  }
}

// 4. removeIn
for (const e of entries) {
  const major = Number.parseInt(String(e.removeIn).split('.')[0], 10);
  if (!Number.isFinite(major) || major < 2) {
    fail(`removeIn: ${e.id} schedules removal at ${e.removeIn}; COMPATIBILITY.md §7 forbids v1.x removal`);
  }
}

// 5. status — a deprecated row must be grounded in the corpus, not only the charter
for (const e of entries) {
  if (e.status !== 'deprecated') continue;
  const grounded = (e.sources ?? []).some((s) => /^(RFCS|spec\/v1|schemas|COMPATIBILITY\.md)/.test(s.file));
  if (!grounded) fail(`status: ${e.id} is "deprecated" but cites no RFC, spec doc, or schema source`);
}

const deprecated = entries.filter((e) => e.status === 'deprecated').length;
const proposed = entries.filter((e) => e.status === 'proposed').length;

if (failures.length > 0) {
  console.error(`=== check-deprecations FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`=== check-deprecations OK — ${entries.length} entries (${deprecated} deprecated, ${proposed} proposed), every source still carries its token ===`);

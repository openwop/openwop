#!/usr/bin/env node
/**
 * RFC 0171 §B.1 — schemas/v2/error-envelope.schema.json is GENERATED from
 * spec/v2/errors.json: `error` is the closed enum of registered codes plus the
 * positive vendor pattern; `details` is the registered details schema per
 * code (an `if error == code then details` rule) where one is registered, else an
 * explicitly open object. The flat shape {error, message, details?} stays;
 * retry timing lives in Retry-After only (§B.2).
 *   --write / --check
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'errors.json'), 'utf8'));

// The registry declares `$schema: https://openwop.dev/spec/v2/errors.schema.json`.
// Validate it here, in both modes, so a malformed row cannot reach the
// generated envelope. Codes must also be unique, which a schema cannot say.
{
  const require = createRequire(join(ROOT, 'conformance', 'package.json'));
  const { Ajv2020 } = require('ajv/dist/2020.js');
  const addFormats = require('ajv-formats');
  const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);
  const regSchema = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'errors.schema.json'), 'utf8'));
  const problems = [];
  if (reg.$schema !== regSchema.$id) problems.push(`$schema is ${reg.$schema}, expected ${regSchema.$id}`);
  const validate = ajv.compile(regSchema);
  if (!validate(reg)) problems.push(ajv.errorsText(validate.errors, { separator: '; ' }));
  const seen = new Set();
  for (const r of reg.rows ?? []) { if (seen.has(r.code)) problems.push(`duplicate code ${r.code}`); seen.add(r.code); }
  if (problems.length) { console.error(`generate-error-envelope: spec/v2/errors.json does not validate against spec/v2/errors.schema.json — ${problems.join(' | ')}`); process.exit(1); }
}
const OUT = join(ROOT, 'schemas', 'v2', 'error-envelope.schema.json');
const withDetails = reg.rows.filter((r) => r.details);
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openwop.dev/spec/v2/error-envelope.schema.json',
  title: 'ErrorEnvelope (v2)',
  description: `GENERATED from spec/v2/errors.json by scripts/generate-error-envelope.mjs (RFC 0171 §B.1). ${reg.rows.length} registered codes; vendor codes match ${reg.vendorCodePattern}. Consumers MUST accept an unknown registered member and MUST NOT act on it (RFC 0171 §A.5).`,
  type: 'object', additionalProperties: false, required: ['error', 'message'],
  properties: {
    error: { oneOf: [{ type: 'string', enum: reg.rows.map((r) => r.code) }, { type: 'string', pattern: reg.vendorCodePattern }] },
    message: { type: 'string', minLength: 1 },
    details: { type: 'object', additionalProperties: true, description: 'Error-specific contextual data. A code that registers a details schema in errors.json constrains it through the allOf below, selected by `error`; every other code accepts any object.' },
  },
  // Discriminated on `error`, not on shape. The earlier `oneOf` over every registered
  // details schema plus an open fallback matched a conforming body TWICE (the
  // registered branch and the fallback), so every envelope carrying registered
  // details failed validation. `if error == code then details: <schema>` binds each
  // schema to its own code only.
  ...(withDetails.length ? { allOf: withDetails.map((r) => ({ if: { properties: { error: { const: r.code } }, required: ['error'] }, then: { properties: { details: { ...r.details, 'x-openwop-error': r.code } } } })) } : {}),
  'x-openwop-http-status': Object.fromEntries(reg.rows.map((r) => [r.code, r.httpStatus])),
  'x-openwop-retriable': reg.rows.filter((r) => r.retriable).map((r) => r.code),
};
const render = JSON.stringify(schema, null, 2) + '\n';

// --- spec/v2/core/errors.md ------------------------------------------------
// The doc said "Generated from spec/v2/errors.json" in two places and named a
// count in both, while NOTHING generated or checked it. Adding one registry row
// left a published table silently one code short. The two counts and the
// status table are now derived here, so the claim is true.
const DOC = join(ROOT, 'spec', 'v2', 'core', 'errors.md');
const n = reg.rows.length;
const table = [...reg.rows]
  .sort((a, b) => a.httpStatus - b.httpStatus || a.code.localeCompare(b.code))
  .map((r) => `\`${r.code}\` | ${r.httpStatus}`)
  .join('\n');
const docSrc = readFileSync(DOC, 'utf8');
let docOut = docSrc
  .replace(/It registers \*\*\d+\*\* codes\./, `It registers **${n}** codes.`)
  .replace(/Generated from `spec\/v2\/errors\.json` \(\d+ codes;/, `Generated from \`spec/v2/errors.json\` (${n} codes;`);
const head = docOut.indexOf('Code | Status\n--- | ---\n');
if (head === -1) { console.error('generate-error-envelope: errors.md has no `Code | Status` table'); process.exit(1); }
const start = head + 'Code | Status\n--- | ---\n'.length;
let end = docOut.indexOf('\n\n', start);
if (end === -1) end = docOut.length;
docOut = docOut.slice(0, start) + table + docOut.slice(end);

if (process.argv.includes('--write')) {
  writeFileSync(OUT, render);
  writeFileSync(DOC, docOut);
  console.log(`wrote schemas/v2/error-envelope.schema.json + spec/v2/core/errors.md (${n} codes)`);
} else if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== render) {
  console.error('generate-error-envelope: schemas/v2/error-envelope.schema.json is stale — run --write');
  process.exit(1);
} else if (docSrc !== docOut) {
  console.error('generate-error-envelope: spec/v2/core/errors.md is stale (count or status table) — run --write');
  process.exit(1);
} else console.log(`=== generate-error-envelope OK — ${n} codes, ${withDetails.length} with a details schema; errors.md current ===`);

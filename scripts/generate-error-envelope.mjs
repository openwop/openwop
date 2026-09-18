#!/usr/bin/env node
/**
 * RFC 0171 §B.1 — schemas/v2/error-envelope.schema.json is GENERATED from
 * spec/v2/errors.json: `error` is the closed enum of registered codes plus the
 * positive vendor pattern; `details` is the registered details schema per
 * code (a `oneOf` discriminated on `error`) where one is registered, else an
 * explicitly open object. The flat shape {error, message, details?} stays;
 * retry timing lives in Retry-After only (§B.2).
 *   --write / --check
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'errors.json'), 'utf8'));
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
    details: withDetails.length ? { oneOf: [...withDetails.map((r) => ({ ...r.details, 'x-openwop-error': r.code })), { type: 'object', additionalProperties: true }] } : { type: 'object', additionalProperties: true, description: 'Error-specific contextual data. No code has registered a details schema yet (errors.json rows carry details: null); when one does, this becomes a oneOf discriminated on error.' },
  },
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

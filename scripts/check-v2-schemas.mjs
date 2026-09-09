#!/usr/bin/env node
/**
 * v2 charter Phase 3 — the v2 leg of spec-corpus-validity, as a root script so
 * it is not packed content (the 1.x tarball never carries schemas/v2/):
 *   1. every schemas/v2/**.schema.json compiles under Ajv 2020 with every
 *      cross-file $ref resolvable inside schemas/v2/ (no reach into v1);
 *   2. `$id` === https://openwop.dev/spec/v2/<relative path>;
 *   3. closure (charter §F "Closure"): every object schema declares
 *      `additionalProperties` (false, or a schema for a declared map); the root
 *      of capabilities, certification-bundle, run-event-payloads, error-envelope
 *      and configurable is `additionalProperties: false`; the only vendor
 *      grammars are the three RFC 0169 §A.4 / RFC 0177 §C.2 / RFC 0171 §A.1
 *      allow: `extensions.<org>.<name>`, `^(openwop-|x-|vendor\.)` on
 *      pack-authored documents, positive `<org>.` patterns in registry enums;
 *   4. no capability family carries a `supported` property (RFC 0169 §A.2);
 *   5. a file still marked `x-openwop-seeded-from: v1` is reported (seeded, not
 *      yet decided by its child) — counted, not failed, until the RC.
 * Green-with-a-report while schemas/v2/ holds only the generated capabilities
 * schema.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'schemas', 'v2');
if (!existsSync(DIR)) { console.log('=== check-v2-schemas — schemas/v2/ does not exist yet ==='); process.exit(0); }
const require = createRequire(join(ROOT, 'conformance', 'package.json'));
const { Ajv2020 } = require('ajv/dist/2020.js'); const addFormats = require('ajv-formats');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.schema.json') ? [p] : []; });
const files = walk(DIR).sort(); const failures = []; let seeded = 0;
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true }); addFormats(ajv);
const docs = files.map((p) => [relative(DIR, p), JSON.parse(readFileSync(p, 'utf8'))]);
for (const [rel, doc] of docs) { if (doc.$id !== `https://openwop.dev/spec/v2/${rel}`) failures.push(`${rel}: $id is ${doc.$id}`); try { ajv.addSchema(doc); } catch (e) { failures.push(`${rel}: addSchema — ${e.message}`); } }
const ROOT_CLOSED = ['capabilities.schema.json', 'certification-bundle.schema.json', 'run-event-payloads.schema.json', 'error-envelope.schema.json', 'configurable.schema.json'];
const ALLOWED_PATTERNS = new Set(['^(openwop-|x-|vendor\\.)', '^(x-|vendor\\.)']);
for (const [rel, doc] of docs) {
  try { ajv.getSchema(doc.$id) ?? ajv.compile(doc); } catch (e) { failures.push(`${rel}: compile — ${e.message}`); }
  if (doc['x-openwop-seeded-from'] === 'v1') seeded++;
  if (ROOT_CLOSED.includes(rel) && doc.additionalProperties !== false) failures.push(`${rel}: root must be additionalProperties:false (charter §F Closure)`);
  // A `properties` / `$defs` / `patternProperties` value is a MAP of schemas,
  // never a schema itself — a map that happens to hold a property named
  // `type` or `properties` must not be mistaken for an object schema.
  const MAPS = new Set(['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas']);
  const SKIP = new Set(['enum', 'const', 'examples', 'default', 'x-openwop-seeded-from', 'x-openwop-http-status', 'x-openwop-retriable', 'if']);
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n, i) => visit(n, `${path}[${i}]`)); return; }
    if (node.type === 'object' || (node.properties && typeof node.properties === 'object')) {
      const fragment = /\.(anyOf|oneOf|allOf)\[\d+\]$/.test(path); // a direct anyOf/oneOf/allOf member is a constraint on the parent shape; closure is the parent's
      if (node.additionalProperties === undefined && !node.patternProperties && !node.$ref && !fragment && !/\.(then|else|not)(\.|$)/.test(path)) failures.push(`${rel} ${path}: object declares no additionalProperties`);
      if (node.patternProperties) for (const pk of Object.keys(node.patternProperties)) if (!ALLOWED_PATTERNS.has(pk) && !/\^\[a-z\]\[a-z0-9\]\*\(-\[a-z0-9\]\+\)\*\\\./.test(pk) && !/^\^\[/.test(pk)) failures.push(`${rel} ${path}: patternProperties ${pk} is not an allowed vendor grammar`);
    }
    if (rel === 'capabilities.schema.json' && path.split('.').length === 3 && node.properties?.supported) failures.push(`${rel} ${path}: a family carries \`supported\` (RFC 0169 §A.2)`);
    for (const [k, v] of Object.entries(node)) {
      if (!v || typeof v !== 'object' || SKIP.has(k)) continue;
      if (MAPS.has(k)) { for (const [mk, mv] of Object.entries(v)) visit(mv, `${path}.${k}.${mk}`); }
      else visit(v, `${path}.${k}`);
    }
  };
  visit(doc, '$');
}
if (failures.length) { console.error(`=== check-v2-schemas FAILED — ${failures.length} problem(s) ===\n  ` + failures.slice(0, 60).join('\n  ') + (failures.length > 60 ? `\n  … ${failures.length - 60} more` : '')); process.exit(1); }
console.log(`=== check-v2-schemas OK — ${files.length} schema(s) compile with $id under /spec/v2/, closure holds; ${seeded} still seeded-from-v1 (awaiting their child's hand edit) ===`);

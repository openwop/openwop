#!/usr/bin/env node
/**
 * Required-property-defined check for openwop's JSON Schemas.
 *
 * Replacement for redocly's `no-required-schema-properties-undefined`
 * lint rule, which we disable in `api/redocly.yaml` because it doesn't
 * walk parent scope — it false-positives on every valid JSON Schema
 * 2020-12 `if/then` conditional-requirement idiom (where `then` only
 * carries a `required` array and the property definitions live in the
 * enclosing object's `properties` block).
 *
 * This script walks each schema recursively. For every object node
 * that declares `required`, it ensures every entry is defined in
 * EITHER:
 *
 *   (a) the same object's `properties`, OR
 *   (b) the enclosing object's `properties` if the current object is
 *       a `then` / `else` / `not` / `oneOf` / `anyOf` / `allOf` member
 *       (i.e., a conditional sub-schema sharing parent scope).
 *
 * Catches the typo-in-required bug class redocly's rule was meant to
 * catch — `required: ["sessionId"]` when the property is actually
 * called `session_id` — without false-positiving the if/then pattern.
 *
 * Exits non-zero on any violation; prints `<file>:<json-path>` and
 * the undefined property name. Intended for `openwop:check` step 7.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS_DIR = resolve(REPO_ROOT, 'schemas');

// Keys whose value is a definitions-style map (each VALUE is its
// own root subschema, NOT inheriting parent scope — they describe
// per-property values or named definitions, not the object itself).
const ROOT_SUBSCHEMA_MAP_KEYS = new Set([
  'properties', 'patternProperties', 'definitions', '$defs',
]);

const violations = [];

function collectPropertyNamesFromScope(scopeChain) {
  // Walk the scopeChain from innermost outward, accumulating every
  // `properties` map's keys. Inner scopes win on collision (but only
  // for membership purposes — we don't care about value).
  const known = new Set();
  for (const node of scopeChain) {
    if (node && typeof node === 'object' && node.properties && typeof node.properties === 'object') {
      for (const name of Object.keys(node.properties)) known.add(name);
    }
  }
  return known;
}

function walk(node, jsonPath, scopeChain, file) {
  if (node === null || typeof node !== 'object') return;

  // Push the current node onto the scope chain. This handles:
  //   - root object — its own `properties` visible to its own `required`
  //   - if / then / else / not — share parent scope AND add their own
  //   - oneOf / anyOf / allOf elements — each element is its own scope
  //   - dependentSchemas values
  // The walk only RESETS scope when descending into `properties` /
  // `patternProperties` / `definitions` / `$defs` per-value maps,
  // where each value is a root subschema.
  const nextChain = [...scopeChain, node];

  // Check `required` against the visible scope chain.
  //
  // Skips:
  //   - schemas with NO `properties` block AND `additionalProperties`
  //     truthy or omitted — the schema is open-shape with no
  //     declared properties at all, so `required` is sketching what
  //     keys an instance MUST carry without describing their types.
  //     Cannot meaningfully distinguish typos from intent.
  //   - schemas that have `oneOf` / `anyOf` / `allOf` sibling
  //     branches: the required entry might be defined inside one of
  //     the branches (e.g., a discriminator `kind` required at root
  //     whose value-set is pinned by each oneOf variant). For these
  //     polymorphic roots we still typo-check — but against the
  //     UNION of properties defined in any branch, NOT just the
  //     root's own scope. A required entry that isn't defined in
  //     any branch's `properties` is a typo regardless of which
  //     branch matches at runtime.
  const hasOwnProperties =
    node.properties !== undefined &&
    node.properties !== null &&
    typeof node.properties === 'object';
  // Polymorphic branches CAN constrain the property set even when
  // the root has no own `properties`. Only treat the schema as
  // fully-open if neither the root nor any branch declares a
  // closed property surface (computed below after we walk branches).
  const hasOwnConstraint = hasOwnProperties || node.additionalProperties === false;
  if (Array.isArray(node.required) && node.required.length > 0) {
    const known = collectPropertyNamesFromScope(nextChain);
    // Add the union of properties declared in any polymorphic
    // branch (oneOf / anyOf / allOf elements). Branches that are
    // themselves open-shape (no `properties`) contribute nothing —
    // but if EVERY branch is open-shape, we still skip the check
    // entirely (there's no closed property set to typo against).
    const branchArrays = ['oneOf', 'anyOf', 'allOf']
      .map((k) => node[k])
      .filter((arr) => Array.isArray(arr));
    let anyBranchHasClosedShape = false;
    for (const arr of branchArrays) {
      for (const branch of arr) {
        if (branch && typeof branch === 'object' && branch.properties && typeof branch.properties === 'object') {
          anyBranchHasClosedShape = true;
          for (const name of Object.keys(branch.properties)) known.add(name);
        }
      }
    }
    // Treat as fully-open ONLY if neither the root nor any branch
    // declares a closed property surface. Otherwise we have a
    // constrained shape worth typo-checking against.
    const fullyOpen = !hasOwnConstraint && !anyBranchHasClosedShape;
    if (!fullyOpen) {
      for (const [i, name] of node.required.entries()) {
        if (typeof name !== 'string') continue;
        if (!known.has(name)) {
          violations.push({
            file,
            path: `${jsonPath.join('/')}/required/${i}`,
            name,
          });
        }
      }
    }
  }

  // Recurse.
  for (const [key, value] of Object.entries(node)) {
    if (ROOT_SUBSCHEMA_MAP_KEYS.has(key) && value !== null && typeof value === 'object') {
      // Per-property / per-definition maps — each value is its own
      // root subschema; do NOT inherit parent scope.
      for (const [subKey, subValue] of Object.entries(value)) {
        walk(subValue, [...jsonPath, key, subKey], [], file);
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) {
        walk(item, [...jsonPath, key, i], nextChain, file);
      }
      continue;
    }
    if (value !== null && typeof value === 'object') {
      walk(value, [...jsonPath, key], nextChain, file);
    }
  }
}

function checkSchema(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`[required-defined] cannot read ${filePath}: ${err.message}`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error(`[required-defined] ${filePath} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
  walk(parsed, ['#'], [], filePath);
}

function walkDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkDir(full);
    else if (entry.endsWith('.schema.json')) checkSchema(full);
  }
}

walkDir(SCHEMAS_DIR);

if (violations.length === 0) {
  console.log('[required-defined] all schemas — required properties are defined.');
  process.exit(0);
}

console.error(`[required-defined] ${violations.length} violation${violations.length === 1 ? '' : 's'}:`);
for (const v of violations) {
  console.error(`  ${v.file.replace(REPO_ROOT + '/', '')} ${v.path} — required '${v.name}' not defined in this or any enclosing 'properties' block`);
}
process.exit(1);

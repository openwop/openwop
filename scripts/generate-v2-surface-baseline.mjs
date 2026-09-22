#!/usr/bin/env node
/**
 * generate-v2-surface-baseline — RFC 0197 §A.1 / §B: the committed census of
 * every v2 SURFACE, so that `check-v2-surface-monotone.mjs` can tell a change
 * that adds one from a change that reshapes one.
 *
 * WHAT A SURFACE IS, AND WHY THE ENUMERATION IS BY *INSTANCE* PATH
 * ----------------------------------------------------------------
 * RFC 0197 §A.1: "A `$defs` name is not a surface, because no document carries
 * it. The monotone gate enumerates surfaces through `$ref` and every
 * `anyOf`/`oneOf`/`allOf` branch, so such a re-cut reports no removal."
 *
 * That sentence is the whole design. A census keyed on schema structure would
 * report RFC 0209's `ui.a2ui-surface` re-cut — root `properties` → an `anyOf`
 * of `$defs/payloadV1` / `payloadV2`, `$defs/component` → `componentV1` — as a
 * mass removal, even though every document valid before is still valid. So the
 * key is the path a DOCUMENT takes (`/`, `/messages/[]/componentUpdate`), not
 * the path the SCHEMA takes, `$ref`s are resolved in place, and every branch of
 * a combinator is walked at the SAME instance path.
 *
 * Five tuple kinds, in two families, because they move in opposite directions:
 *
 *   UNION kinds — what a document MAY carry. Aggregated across branches; a
 *   member disappearing from the union is a REMOVAL.
 *     property     — a named property reachable at an instance path
 *     enum-member  — a member of an enum at an instance path
 *     operation    — a `<METHOD> <path>` row of spec/v2/path-manifest.json
 *     channel      — a channel row of the same
 *
 *   RESTRICTION kinds — what a document MUST satisfy. Aggregated as the
 *   INTERSECTION across branches, because adding a branch never narrows the
 *   union; a restriction APPEARING at a pre-existing instance path is the
 *   break.
 *     required — required-property names that hold on EVERY branch
 *     closed   — `additionalProperties: false` on EVERY branch
 *     type     — the union of permitted JSON types; a type LOST is a narrowing
 *
 * `type` sits in both families by its own nature: it is emitted as a union of
 * type names, and the gate treats a type that vanished as the narrowing.
 *
 * Output `spec/v2/surface-baseline.json` — sorted, one compact string per
 * tuple (`<file>#<instance pointer>|<kind>|<value>`) so the diff of a real
 * change is readable rather than a re-indented wall.
 *
 *   --write   rewrite the baseline from the tree
 *   --check   fail when the committed baseline differs from the tree WITHOUT
 *             going through check-v2-surface-monotone (that gate is the one
 *             that knows which differences are legal); used by the release PR
 *   (default) print a summary
 *
 * The release PR regenerates this together with the `spec/v2/release.json`
 * bump. `release` records the version it was cut at, and the monotone gate
 * refuses to run against a baseline cut at a different release — which is what
 * forces the regeneration. What that does NOT catch, stated rather than
 * implied: a regeneration inside the same release, which would silently adopt
 * a removal as the new baseline. The control for that is the deprecation
 * register and the gate's own removal report, not this stamp.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const UNION_KINDS = new Set(['property', 'enum-member', 'operation', 'channel']);
const RESTRICTION_KINDS = new Set(['required', 'closed', 'type']);

function walkDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walkDir(p);
    return e.isFile() && p.endsWith('.json') ? [p] : [];
  });
}

/** JSON-Pointer escape for one path segment. */
const esc = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Enumerate one schema document into tuples.
 *
 * `branchKey` threads the combinator branch a tuple came from, so the caller
 * can intersect restriction kinds per instance path: a `required` that holds
 * on one `anyOf` branch and not another restricts nothing.
 */
export function enumerateSchema(rel, schema) {
  /** kind → instancePath → Map(value → Set(branchKey)) */
  const acc = new Map();
  /** instancePath → Set(branchKey) — every branch that REACHED this path. */
  const reached = new Map();
  const add = (kind, path, value, branchKey) => {
    if (!acc.has(kind)) acc.set(kind, new Map());
    const byPath = acc.get(kind);
    if (!byPath.has(path)) byPath.set(path, new Map());
    const byValue = byPath.get(path);
    if (!byValue.has(value)) byValue.set(value, new Set());
    byValue.get(value).add(branchKey);
  };

  const resolvePointer = (ptr) => {
    // Local `#/a/b` only. A cross-file `$ref` is followed by the OTHER file's
    // own enumeration; following it here would double-count and would make one
    // file's removal report against two.
    if (!ptr.startsWith('#/')) return null;
    let node = schema;
    for (const seg of ptr.slice(2).split('/')) {
      const k = seg.replace(/~1/g, '/').replace(/~0/g, '~');
      if (node === null || typeof node !== 'object' || !(k in node)) return null;
      node = node[k];
    }
    return node;
  };

  const seen = new Set();
  function walk(node, path, branchKey, depth) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    if (depth > 60) return;
    if (typeof node.$ref === 'string') {
      const key = `${node.$ref}@${path}`;
      if (!seen.has(key)) {
        seen.add(key);
        const target = resolvePointer(node.$ref);
        if (target) walk(target, path, branchKey, depth + 1);
      }
      // A `$ref` sibling may still carry keywords (2020-12 allows it); fall
      // through so they are not lost.
    }
    if (!reached.has(path)) reached.set(path, new Set());
    reached.get(path).add(branchKey);

    for (const comb of ['anyOf', 'oneOf', 'allOf']) {
      const branches = node[comb];
      if (!Array.isArray(branches)) continue;
      branches.forEach((b, i) => {
        // `allOf` branches all apply, so they keep the parent's branch key (a
        // restriction on one allOf arm IS a restriction). `anyOf`/`oneOf`
        // branches are alternatives and get their own key.
        walk(b, path, comb === 'allOf' ? branchKey : `${branchKey}>${comb}${i}@${path}`, depth + 1);
      });
    }
    for (const cond of ['then', 'else']) {
      // A conditional restriction does not hold on every document, so it is a
      // branch of its own; `if` is a selector, not a surface.
      if (node[cond] && typeof node[cond] === 'object') walk(node[cond], path, `${branchKey}>${cond}@${path}`, depth + 1);
    }

    if (node.type !== undefined) {
      for (const t of Array.isArray(node.type) ? node.type : [node.type]) add('type', path, String(t), branchKey);
    }
    if (Array.isArray(node.enum)) {
      for (const v of node.enum) add('enum-member', path, JSON.stringify(v), branchKey);
    }
    if (node.const !== undefined) add('enum-member', path, JSON.stringify(node.const), branchKey);
    if (node.additionalProperties === false) add('closed', path, 'true', branchKey);
    if (Array.isArray(node.required)) {
      for (const r of node.required) add('required', path, String(r), branchKey);
    }
    if (node.properties && typeof node.properties === 'object') {
      for (const [k, v] of Object.entries(node.properties)) {
        add('property', path, k, branchKey);
        walk(v, `${path}/${esc(k)}`, branchKey, depth + 1);
      }
    }
    if (node.patternProperties && typeof node.patternProperties === 'object') {
      for (const [k, v] of Object.entries(node.patternProperties)) walk(v, `${path}/~${esc(k)}`, branchKey, depth + 1);
    }
    if (node.additionalProperties && typeof node.additionalProperties === 'object') walk(node.additionalProperties, `${path}/*`, branchKey, depth + 1);
    if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) walk(node.items, `${path}/[]`, branchKey, depth + 1);
    if (Array.isArray(node.prefixItems)) node.prefixItems.forEach((v, i) => walk(v, `${path}/[${i}]`, branchKey, depth + 1));
    // `$defs` is walked ONLY through `$ref` (§A.1: a `$defs` name is not a surface).
  }

  walk(schema, '', 'root', 0);

  const out = [];
  for (const [kind, byPath] of acc) {
    for (const [path, byValue] of byPath) {
      const branchesHere = reached.get(path) ?? new Set();
      for (const [value, branches] of byValue) {
        if (RESTRICTION_KINDS.has(kind) && kind !== 'type') {
          // INTERSECTION: a restriction counts only when every branch that
          // reaches this instance path imposes it.
          if (branches.size < branchesHere.size) continue;
        }
        out.push(`${rel}#${path}|${kind}|${value}`);
      }
    }
  }
  return out;
}

export function enumerateTree(root = ROOT) {
  const tuples = [];
  for (const file of walkDir(join(root, 'schemas', 'v2')).sort()) {
    const rel = relative(root, file);
    let doc;
    try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${rel}: ${e.message}`); }
    tuples.push(...enumerateSchema(rel, doc));
  }
  const pm = join(root, 'spec', 'v2', 'path-manifest.json');
  if (existsSync(pm)) {
    const m = JSON.parse(readFileSync(pm, 'utf8'));
    for (const op of m.operations ?? []) tuples.push(`spec/v2/path-manifest.json#|operation|${op.method} ${op.path}`);
    for (const ch of m.channels ?? []) tuples.push(`spec/v2/path-manifest.json#|channel|${ch.address ?? ch.channel ?? ch.path ?? JSON.stringify(ch)}`);
  }
  return [...new Set(tuples)].sort();
}

export function baselineFor(root = ROOT) {
  const release = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'release.json'), 'utf8'));
  const surfaces = enumerateTree(root);
  return {
    $comment: 'GENERATED by scripts/generate-v2-surface-baseline.mjs (RFC 0197 §A.1) — the committed census of every v2 surface a DOCUMENT can carry, enumerated by instance path through $ref and every anyOf/oneOf/allOf branch. Each entry is `<file>#<instance pointer>|<kind>|<value>`. A $defs NAME is not a surface. Do not edit by hand: the release PR regenerates this with the spec/v2/release.json bump, and check-v2-surface-monotone.mjs refuses a baseline cut at a different release.',
    generatedFrom: ['schemas/v2/**/*.json', 'spec/v2/path-manifest.json'],
    release: release.version,
    kinds: { union: [...UNION_KINDS].sort(), restriction: [...RESTRICTION_KINDS].sort() },
    count: surfaces.length,
    surfaces,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  // Same seams the monotone gate uses, so the coherence twin can build a
  // baseline for a synthetic tree without writing into the corpus.
  const TREE_ROOT = process.env['OPENWOP_V2_SCHEMAS_ROOT'] ?? ROOT;
  const OUT = process.env['OPENWOP_V2_BASELINE_FILE'] ?? join(ROOT, 'spec', 'v2', 'surface-baseline.json');
  const built = baselineFor(TREE_ROOT);
  const text = JSON.stringify(built, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    writeFileSync(OUT, text);
    console.log(`wrote spec/v2/surface-baseline.json — ${built.count} surfaces at release ${built.release}`);
  } else if (process.argv.includes('--check')) {
    if (!existsSync(OUT)) { console.error('generate-v2-surface-baseline --check: spec/v2/surface-baseline.json is missing — run --write'); process.exit(1); }
    const have = readFileSync(OUT, 'utf8');
    if (have !== text) {
      const a = new Set(JSON.parse(have).surfaces ?? []);
      const b = new Set(built.surfaces);
      const gone = [...a].filter((x) => !b.has(x));
      const added = [...b].filter((x) => !a.has(x));
      console.error(`=== generate-v2-surface-baseline --check FAILED — the committed baseline is not the tree (${gone.length} absent, ${added.length} new) ===`);
      for (const x of gone.slice(0, 10)) console.error(`  absent: ${x}`);
      for (const x of added.slice(0, 10)) console.error(`  new:    ${x}`);
      console.error('  Run check-v2-surface-monotone.mjs FIRST: it decides which of these are legal. Only the release PR regenerates the baseline.');
      process.exit(1);
    }
    console.log(`=== generate-v2-surface-baseline OK — the committed baseline equals the tree (${built.count} surfaces, release ${built.release}) ===`);
  } else {
    const byKind = {};
    for (const s of built.surfaces) { const k = s.split('|')[1]; byKind[k] = (byKind[k] ?? 0) + 1; }
    console.log(`${built.count} surfaces at release ${built.release}: ${JSON.stringify(byKind)}`);
  }
}

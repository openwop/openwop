#!/usr/bin/env node
/**
 * `spec/v2/core/identity.md` §5 — "Every id field in every v2 schema and every
 * `api/v2/openapi.yaml` parameter and response body MUST `$ref` its kind."
 *
 * That sentence was written, published, and never checked. Nine violations sat
 * in the tree; two of them were a live defect a tier-1 host hit head-on, and one
 * of those two — `components/parameters/RunId` typed `maxLength: 128` — could
 * not even express a conforming v2 runId, whose grammar reaches 257 characters.
 *
 * WHY THE MAP RATHER THAN NAME-MATCHING. The obvious implementation fires when a
 * property name equals a `$defs` name. It is much weaker than it reads: 88 `*Id`
 * properties live under `schemas/v2/` and only 20 share a name with a kind. The
 * one that proves it is `childRunId`, which sat as `{type: string, minLength: 1}`
 * in the SAME FILE where `parentRunId` was correctly `$ref`'d. A child run's
 * identifier therefore carried no tenant segment for `identity.md` §5's
 * mandatory `403 id_tenant_mismatch` refusal to read — the same hole closed from
 * the other direction in the v2 overlap ruling. A name-matching check reports
 * green over it, and a green that cannot see the defect it was written for is
 * worse than no check, because it answers "is this enforced?" wrongly.
 *
 * So coverage is explicit. `spec/v2/id-field-bindings.json` places every `*Id`
 * property in exactly one of two sets — it IS a kind (and MUST `$ref` it), or
 * nothing in `ids.schema.json` governs it (with the reason). A property in
 * neither FAILS, which is what makes the map self-maintaining: a new id field
 * cannot be added without someone deciding which it is.
 *
 * Exits non-zero with a list; `--check` is the same thing (there is nothing to
 * write — every fix is a judgement about which kind a field is).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const kinds = new Set(Object.keys(rd('schemas/v2/ids.schema.json').$defs ?? {}));
const map = rd('spec/v2/id-field-bindings.json');
const bindings = map.bindings ?? {};
const notAKind = map.notAKind ?? {};

const problems = [];

/**
 * Every `*Id` property in a v2 schema, with the JSON pointer that reaches it —
 * AND every `*Ids` array property, yielding its `items` schema as the thing to
 * bind. The plural form was a blind spot in the first version of this check: a
 * `/Id$/` predicate cannot see `runIds`, and `POST /runs:bulk-cancel` takes
 * `runIds[]` from the body typed `{type: string, minLength: 1}`. A tier-1 host
 * found it the hard way — a v2 client sent the tenant-bound ids it had been
 * handed, and every one answered `not_found`, silently. The projection covered
 * the way out and not the way in.
 */
function* idProps(node, file, path = '') {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) yield* idProps(node[i], file, `${path}[${i}]`);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties' && v && typeof v === 'object') {
      for (const [pn, pv] of Object.entries(v)) {
        if (!pv || typeof pv !== 'object') continue;
        if (/Id$/.test(pn)) {
          yield { file, pointer: `${path}/properties/${pn}`, name: pn, schema: pv };
        } else if (/Ids$/.test(pn) && pv.items && typeof pv.items === 'object') {
          yield { file, pointer: `${path}/properties/${pn}/items`, name: pn, schema: pv.items };
        }
      }
    }
    yield* idProps(v, file, `${path}/${k}`);
  }
}

/**
 * A binding is satisfied by a direct `$ref` OR by a `$ref` inside a `oneOf`/
 * `anyOf` alongside a null branch. `debug-bundle`'s nodeId is genuinely nullable
 * — a run-level event has no node — so demanding a bare `$ref` there would force
 * the schema to LIE about the shape in order to satisfy a check about grammar.
 */
function refsKind(schema, kind) {
  const want = `ids.schema.json#/$defs/${kind}`;
  if (typeof schema.$ref === 'string') return schema.$ref.endsWith(want);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.some((b) => typeof b?.$ref === 'string' && b.$ref.endsWith(want))) return true;
  }
  return false;
}

const files = globSync('schemas/v2/**/*.schema.json', { cwd: ROOT }).sort();
const observed = new Set();

for (const f of files) {
  let doc;
  try { doc = rd(f); } catch (e) { problems.push(`${f}: unreadable (${e.message})`); continue; }
  for (const p of idProps(doc, f)) {
    observed.add(p.name);
    if (p.name in notAKind) continue;
    const kind = bindings[p.name];
    if (!kind) {
      problems.push(`${f} ${p.pointer}: '${p.name}' is in neither bindings nor notAKind in spec/v2/id-field-bindings.json — decide which it is (identity.md §5)`);
      continue;
    }
    if (!kinds.has(kind)) {
      problems.push(`spec/v2/id-field-bindings.json: '${p.name}' -> '${kind}', which is not a $def in ids.schema.json`);
      continue;
    }
    if (!refsKind(p.schema, kind)) {
      const shown = JSON.stringify(p.schema).slice(0, 90);
      problems.push(`${f} ${p.pointer}: '${p.name}' MUST $ref ids.schema.json#/$defs/${kind} (identity.md §5) — got ${shown}`);
    }
  }
}

// api/v2/openapi.yaml parameters. §5 names them explicitly, and the one that was
// wrong was wrong because this document is DERIVED from api/openapi.yaml: v1's
// bare-id typing was inherited into a major where the grammar changed.
const oapi = join(ROOT, 'api', 'v2', 'openapi.yaml');
if (existsSync(oapi)) {
  const text = readFileSync(oapi, 'utf8');
  // Deliberately textual: the corpus has no Node YAML parser (derive-v2-api.py
  // uses PyYAML for exactly this reason) and adding a dependency to a guard is
  // the wrong trade. Each components/parameters entry is matched by its block.
  const block = /^ {4}([A-Za-z0-9_]+):\n((?: {6}.*\n|\n)*)/gm;
  const paramsAt = text.indexOf('\n  parameters:');
  if (paramsAt !== -1) {
    const section = text.slice(paramsAt, text.indexOf('\n  responses:', paramsAt) + 1 || undefined);
    let m;
    while ((m = block.exec(section)) !== null) {
      const body = m[2];
      const nameM = /^ {6}name: (.+)$/m.exec(body);
      if (!nameM) continue;
      const pname = nameM[1].trim();
      const kind = bindings[pname];
      if (!kind || pname in notAKind) continue;
      if (!body.includes(`ids.schema.json#/$defs/${kind}`)) {
        problems.push(`api/v2/openapi.yaml components/parameters/${m[1]}: parameter '${pname}' MUST $ref ids.schema.json#/$defs/${kind} (identity.md §5)`);
      }
    }
  }
}

// Request BODIES in the derived OpenAPI. `runIds[]` on `POST /runs:bulk-cancel`
// is the one plural id array the v2 path space accepts inbound, and it was the
// surface a tier-1 host found unbound. The parameter scan above cannot see it —
// it lives in an inline request schema — so it is asserted by name here, and
// the fix lives in derive-v2-api.py rather than in this file's output.
if (existsSync(oapi)) {
  const text = readFileSync(oapi, 'utf8');
  const at = text.indexOf('/runs:bulk-cancel');
  if (at !== -1) {
    const body = text.slice(at, at + 4000);
    const runIdsAt = body.indexOf('runIds:');
    const window = runIdsAt === -1 ? '' : body.slice(runIdsAt, runIdsAt + 400);
    if (!window.includes('ids.schema.json#/$defs/runId')) {
      problems.push(`api/v2/openapi.yaml POST /runs:bulk-cancel: body 'runIds[]' items MUST $ref ids.schema.json#/$defs/runId (identity.md §5) — a v2 client sends the tenant-bound ids it was handed, and an unbound inbound array answers not_found for every one`);
    }
  }
}

// A map row for a property that no longer exists is stale coverage: it makes the
// map look more thorough than the tree it describes.
for (const n of [...Object.keys(bindings), ...Object.keys(notAKind)]) {
  if (!observed.has(n)) problems.push(`spec/v2/id-field-bindings.json: '${n}' is mapped but appears in no v2 schema — remove the stale row`);
}

if (problems.length > 0) {
  console.log(`=== check-id-kinds-bound FAILED — ${problems.length} problem(s) ===`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log(`=== check-id-kinds-bound OK — ${observed.size} *Id propert(ies) across ${files.length} v2 schema(s); ${Object.keys(bindings).length} bound to a kind, ${Object.keys(notAKind).length} declared not-a-kind ===`);

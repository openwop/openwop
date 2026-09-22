#!/usr/bin/env node
/**
 * v2 charter Phase 3, P3-B — seed schemas/v2/ from the v1 schemas.
 *
 * Mechanical, recorded, and re-runnable ONLY for files still marked
 * `x-openwop-seeded-from: v1`; a file a child RFC has hand-edited (the marker
 * removed) is never overwritten. What the seed does, per file:
 *   - `$id` → https://openwop.dev/spec/v2/<same path>;
 *   - every object schema with no `additionalProperties` gets `false` (RFC 0167
 *     Axiom 2 closure) — a `patternProperties` vendor hatch is preserved as is;
 *   - id fields become `$ref`s into ids.schema.json (RFC 0170 §D.1 /
 *     identity.md §5) — driven by spec/v2/id-field-bindings.json, the same map
 *     check-id-kinds-bound.mjs enforces: a `*Id` property bound to a kind, and
 *     the `items` of a bound `*Ids` array; `engineVersion` becomes an integer
 *     (RFC 0172 axis 3);
 *   - `bundleVersion` consts follow RFC 0172 axis 10;
 *   - the RFC 0171 §C.2 rename of `x-openwop-*` annotation keys to `openwop-*`
 *     on pack-authored documents (the `x-` header/annotation token split);
 *   - every `description` has its manifest-named `/v1/<op>` spelled `/<op>`
 *     (v2-path-spellings.mjs, the rule generate-from-declaration applies too;
 *     errata 2.0.10, #1317);
 *   - root `examples` are instances of a CLOSED v2 schema and MUST validate
 *     against it (check-v2-schemas.mjs rule 6): a `$comment` inside an example
 *     is dropped, and a bare id under a property bound to a TENANT-BOUND kind is
 *     rewritten `acme/<bare>-xxxx` to that kind's grammar (release 2.4.7, #1401);
 *   - `deprecated` surfaces whose deprecation row names this file are DROPPED
 *     when the row's `codemod` is a pure remove (kind remove with a v2 of
 *     "none") — everything else is a child's hand edit.
 * Every rule above is one the tree already carried by hand before it lived
 * here. A v2-ONLY change a child RFC makes to a seeded file (a new field, a
 * v2-only correction, an alias) is NOT a rule: that RFC removes the marker and
 * the file leaves the seed set for good. Editing a seeded file and keeping the
 * marker is the defect `--check` exists to catch — the next `--write` would
 * silently revert it (RFC 0186's `onTimeout` sat one re-seed from deletion).
 * The copy set is the transitive `$ref` closure of the v1 API documents plus
 * the pack, envelope, bundle and identity families the children name; the
 * closure is re-derived from api/v2 by check-v2-schemas.mjs once P3-C lands.
 *
 *   --write   seed / re-seed the files still marked    --list  print the set
 *   --check   fail if --write would change any file, or a set member is missing
 *             (openwop:check stage 10)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unversionManifestSpellings } from './v2-path-spellings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'schemas'); const DST = join(SRC, 'v2');
const API_SEEDS = ['a2a-task-state','agent-deployment-transition','agent-deployment','agent-inventory-response','agent-org-chart','agent-roster-entry','agent-roster-response','annotation-create','annotation','audit-verify-result','compact-tool-descriptor','error-envelope','eval-summary','heartbeat-evaluated','heartbeat-state-changed','localized-content-language-settings','localized-content-page-response','localized-content-page','localized-content-section','org-chart-responsibility-view','prompt-kind','prompt-ref','prompt-template','residency','run-ancestry-response','run-diff-response','run-event-payloads','run-event','run-options','run-snapshot','suspend-request','tool-descriptor','trigger-subscription-registration','trigger-subscription','workflow-definition','workspace-file-create','workspace-file'].map((s) => s + '.schema.json');
const FAMILY_SEEDS = ['node-pack-manifest','agent-manifest','prompt-pack-manifest','workflow-chain-pack-manifest','connection-pack-manifest','chat-card-pack-manifest','artifact-type-pack-manifest','form-content-pack-manifest','frontend-plugin-manifest','registry-version-manifest','pack-lockfile','security-advisory','debug-bundle','export-bundle','ai-envelope','budget-policy','memory-entry','memory-list-options','conversation-event','conversation-turn','trigger-event','workload-identity','credential-reference','credential-provenance','dispatch-config','self-hosted-runner-dispatch-frame','self-hosted-runner-registration','self-hosted-runner-result-frame','ui-plugin-message','a2ui-surface-delta-frame','goal','proposal','agent-eval-suite','run-orchestrator-decided-event'].map((s) => s + '.schema.json');
const ENVELOPES = readdirSync(join(SRC, 'envelopes')).filter((f) => f.endsWith('.schema.json')).map((f) => 'envelopes/' + f);
const NOT_COPIED = ['capabilities.schema.json', 'certification-bundle-v2.schema.json', 'conformance-certification-bundle.schema.json', 'core-conformance-mock-agent-config.schema.json'];
// capabilities: GENERATED from the declaration; the two bundle schemas: replaced by certification-bundle (v3); the mock-agent config: seams profile (schemas/v2/seams/).

// identity.md §5: the id-field map check-id-kinds-bound.mjs enforces is the one
// the seed applies — a hard-coded list here drifted from it (evalRunId,
// targetAgentId, typeId, the plural `*Ids` arrays were bound by hand instead).
const ID_KINDS = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'id-field-bindings.json'), 'utf8')).bindings;
const ID_DEFS = JSON.parse(readFileSync(join(DST, 'ids.schema.json'), 'utf8')).$defs;
const BUNDLE_CONST = { 'debug-bundle.schema.json': '2', 'export-bundle.schema.json': '2' };

function closure() {
  const seen = new Set(); const q = [...API_SEEDS, ...FAMILY_SEEDS, ...ENVELOPES];
  while (q.length) { const f = q.shift(); if (seen.has(f) || NOT_COPIED.includes(f)) continue; if (!existsSync(join(SRC, f))) { console.warn(`derive: ${f} not in v1 — skipped`); continue; } seen.add(f);
    const t = readFileSync(join(SRC, f), 'utf8');
    for (const m of t.matchAll(/"\$ref"\s*:\s*"([^"#]+\.schema\.json)/g)) { let r = m[1].replace(/^\.\//, ''); if (r.startsWith('https://openwop.dev/spec/v1/')) r = r.slice(28); r = r.replace(/^\.\.\//, ''); if (f.startsWith('envelopes/') && !r.includes('/') && !existsSync(join(SRC, r)) && existsSync(join(SRC, 'envelopes', r))) r = 'envelopes/' + r; q.push(r); } }
  return [...seen].sort();
}

// An example is an instance of a closed schema (check-v2-schemas rule 6): no
// `$comment` key, and a bare v1 id under a tenant-bound kind is bound
// `acme/<bare>-xxxx…` — padded to the kind's 16-char local-segment floor.
function bindExample(ex, props) {
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return ex;
  const out = {};
  for (const [k, v] of Object.entries(ex)) {
    if (k === '$comment') continue;
    const kind = typeof props[k]?.$ref === 'string' ? props[k].$ref.split('#/$defs/')[1] : undefined;
    const pattern = kind && ID_DEFS[kind]?.pattern;
    if (typeof v === 'string' && pattern && pattern.includes('/') && !new RegExp(pattern).test(v) && !v.includes('/')) {
      const bound = `acme/${v}-${'x'.repeat(Math.max(1, 15 - v.length))}`;
      out[k] = new RegExp(pattern).test(bound) ? bound : v;
    } else out[k] = v;
  }
  return out;
}

function transform(file, doc) {
  const rel = file; const depth = rel.split('/').length - 1; const idsRef = (kind) => `${depth ? '../'.repeat(depth) : ''}ids.schema.json#/$defs/${kind}`;
  const walk = (node, key, parentIsProps) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n) => walk(n, null, false));
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      let nk = k;
      if (parentIsProps && /^x-openwop-/.test(k) && /manifest|prompt-template|agent-manifest|pack-lockfile/.test(rel)) nk = k.replace(/^x-openwop-/, 'openwop-'); // RFC 0171 §C.2
      if (k === 'patternProperties') { out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk === '^(x-|vendor\\.)' && /manifest|prompt-template|agent-manifest/.test(rel) ? '^(openwop-|x-|vendor\\.)' : pk, walk(pv, null, false)])); continue; }
      if (k === '$ref' && typeof v === 'string' && v.startsWith('https://openwop.dev/spec/v1/')) { out[k] = v.replace('/spec/v1/', '/spec/v2/'); continue; }
      out[nk] = (k === 'properties' || k === '$defs' || k === 'definitions') ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => {
        if (k === 'properties' && ID_KINDS[pk] && pv && pv.type === 'string' && !pv.$ref) return [pk, { $ref: idsRef(ID_KINDS[pk]), ...(pv.description ? { description: pv.description } : {}) }];
        if (k === 'properties' && /Ids$/.test(pk) && ID_KINDS[pk] && pv && pv.type === 'array' && pv.items?.type === 'string' && !pv.items.$ref) return [pk, walk({ ...pv, items: { $ref: idsRef(ID_KINDS[pk]), ...(pv.items.description ? { description: pv.items.description } : {}) } }, pk, false)];
        if (k === 'properties' && pk === 'engineVersion' && pv && pv.type === 'string') return [pk, { ...pv, type: 'integer', minimum: 0, description: (pv.description ? pv.description + ' ' : '') + 'v2: integer everywhere (RFC 0172 §B axis 3).' }];
        return [pk, walk(pv, pk, k === 'properties')];
      })) : walk(v, k, false);
    }
    if (typeof out.description === 'string') out.description = unversionManifestSpellings(out.description); // #1317
    if (out.type === 'object' && out.additionalProperties === undefined && !out.patternProperties) {
      // Closure: an object with declared properties is closed; a declared
      // free-form map (no properties, no pattern) is OPEN — explicitly, so the
      // scan can tell "decided open" from "forgot". A constraint fragment inside
      // anyOf/oneOf/allOf (only `required`) is left alone.
      if (out.properties) out.additionalProperties = false;
      else if (!out.required) out.additionalProperties = true;
    }
    if (out.type === 'object' && out.additionalProperties === true && !out.patternProperties && out.properties) out.additionalProperties = false; // closure: an explicit open object with declared properties is closed; hatch-less free-form maps keep `true` only when they declare no properties
    return out;
  };
  const out = walk(doc, null, false);
  out.$id = `https://openwop.dev/spec/v2/${rel}`;
  if (Array.isArray(out.examples)) out.examples = out.examples.map((ex) => bindExample(ex, out.properties ?? {}));
  if (BUNDLE_CONST[rel] && out.properties?.bundleVersion) out.properties.bundleVersion = { const: BUNDLE_CONST[rel], description: `RFC 0172 §B axis 10 — one const family; this bundle is "${BUNDLE_CONST[rel]}" in v2.` };
  out['x-openwop-seeded-from'] = 'v1';
  return out;
}

const files = closure();
if (process.argv.includes('--list')) { console.log(files.join('\n')); console.log(`${files.length} files`); process.exit(0); }
const WRITE = process.argv.includes('--write'); const CHECK = process.argv.includes('--check');
if (!WRITE && !CHECK) { console.log(`derive-v2-schemas: ${files.length} files in the seed set (use --write, --check or --list)`); process.exit(0); }
let seeded = 0, kept = 0; const drift = [];
for (const f of files) {
  const dst = join(DST, f);
  const cur = existsSync(dst) ? readFileSync(dst, 'utf8') : null;
  if (cur !== null && JSON.parse(cur)['x-openwop-seeded-from'] !== 'v1') { kept++; continue; }
  const next = JSON.stringify(transform(f, JSON.parse(readFileSync(join(SRC, f), 'utf8'))), null, 2) + '\n';
  if (cur === next) { seeded++; continue; }
  if (CHECK) { drift.push(cur === null ? `${f}: in the seed set but absent from schemas/v2/` : `${f}: still marked x-openwop-seeded-from: v1 but differs from its derivation`); continue; }
  mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, next); seeded++;
}
if (drift.length) {
  console.error(`=== derive-v2-schemas --check FAILED — ${drift.length} file(s) would change under --write ===\n  ` + drift.join('\n  ') +
    `\n  A v1 change: run \`node scripts/derive-v2-schemas.mjs --write\`. A v2-only hand edit: remove the file's \`x-openwop-seeded-from\` marker (the RFC that made the edit now owns the file), or encode the edit as a seed rule if it is mechanical.`);
  process.exit(1);
}
console.log(CHECK ? `=== derive-v2-schemas --check OK — ${seeded} seeded file(s) equal their derivation, ${kept} hand-edited (unmarked), ${files.length} in set ===` : `derive-v2-schemas: seeded ${seeded}, kept ${kept} hand-edited, ${files.length} in set`);

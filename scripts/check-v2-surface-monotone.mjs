#!/usr/bin/env node
/**
 * check-v2-surface-monotone — RFC 0197 §A.1 and §B: a 2.x minor never reshapes
 * a v2 surface in place.
 *
 * The census `spec/v2/surface-baseline.json` is the before; the tree is the
 * after. Three questions, and each has a direction:
 *
 *   ADDITIONS PASS. Adding an OPTIONAL property to a closed v2 object is
 *   additive (§B.5) — this gate is the positive control for that rule, and a
 *   new property, enum member or operation is reported, never failed.
 *
 *   REMOVALS FAIL, unless the removal is named by a DUE, predicate-passing
 *   `v2-minor` deprecation row (through its spec/v2/migrations.json row's
 *   `from.path`) or by a `spec/v2/corrections.json` row (§A.4).
 *
 *   NEW RESTRICTIONS FAIL: a `required` entry appearing on a pre-existing
 *   object, an object going from open to `additionalProperties: false`, a
 *   permitted `type` disappearing. These are §A.1 / §B.6 majors.
 *
 * WHY A REMOVAL IS NOT WHAT A NAIVE DIFF CALLS ONE. The baseline enumerates by
 * INSTANCE path, resolving `$ref` and walking every `anyOf`/`oneOf`/`allOf`
 * branch at the same path (see generate-v2-surface-baseline.mjs). So RFC 0209's
 * `ui.a2ui-surface` re-cut — root `properties` replaced by an `anyOf` of
 * `$defs/payloadV1` / `payloadV2`, `$defs/component` renamed `componentV1` —
 * reports ZERO removals, because every document valid before is still valid and
 * a `$defs` NAME is not a surface. That re-cut is the reason this gate lands
 * last in the 2.36.0 cycle and takes its baseline on the finished tree.
 *
 * Restriction kinds are aggregated as the INTERSECTION across branches, so
 * adding an `anyOf` branch with its own `required` list restricts nothing and
 * passes; a `required` entry that holds on EVERY branch is the one that fails.
 *
 * G3 — the baseline records the release it was cut at, and this gate refuses a
 * baseline cut at a different release than `spec/v2/release.json`. That forces
 * the release PR to regenerate it. Stated plainly, because a gate should not
 * imply more than it checks: this does NOT catch a regeneration inside the same
 * release. The control for that is the deprecation register and code review of
 * the baseline diff, which is why the baseline is a sorted list of one-line
 * tuples rather than a re-indented blob.
 *
 * Test seams (used by conformance/src/coherence/v2-surface-monotone-gate):
 *   OPENWOP_V2_BASELINE_FILE  OPENWOP_V2_SCHEMAS_ROOT  OPENWOP_V2_RELEASE_FILE
 *   OPENWOP_V2_CORRECTIONS_FILE OPENWOP_V2_MIGRATIONS_FILE OPENWOP_DEPRECATIONS_FILE
 * `OPENWOP_V2_SCHEMAS_ROOT` names an alternative REPO ROOT whose `schemas/v2/`
 * and `spec/v2/path-manifest.json` are enumerated instead of this one's.
 *
 * Exit 0 on success, 1 on any failure.
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateTree } from './generate-v2-surface-baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = process.env['OPENWOP_V2_BASELINE_FILE'] ?? join(ROOT, 'spec', 'v2', 'surface-baseline.json');
const TREE_ROOT = process.env['OPENWOP_V2_SCHEMAS_ROOT'] ?? ROOT;
const RELEASE = process.env['OPENWOP_V2_RELEASE_FILE'] ?? join(ROOT, 'spec', 'v2', 'release.json');
const CORRECTIONS = process.env['OPENWOP_V2_CORRECTIONS_FILE'] ?? join(ROOT, 'spec', 'v2', 'corrections.json');
const MIGRATIONS = process.env['OPENWOP_V2_MIGRATIONS_FILE'] ?? join(ROOT, 'spec', 'v2', 'migrations.json');
const DEPRECATIONS = process.env['OPENWOP_DEPRECATIONS_FILE'] ?? join(ROOT, 'spec', 'v1', 'deprecations.json');

const readJsonOrNull = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const fail = (msg) => { console.error(`=== check-v2-surface-monotone FAILED ===\n  ${msg}`); process.exit(1); };

const baseline = readJsonOrNull(BASELINE);
if (!baseline) fail(`spec/v2/surface-baseline.json is missing or unreadable at ${BASELINE} — run scripts/generate-v2-surface-baseline.mjs --write. A gate with no before cannot see a removal, and a silent skip here is exactly the P1 hole.`);
const release = readJsonOrNull(RELEASE);
if (!release) fail(`cannot read ${RELEASE}`);
if (baseline.release !== release.version) {
  fail(`the baseline was cut at release ${baseline.release} but spec/v2/release.json reads ${release.version} — regenerate spec/v2/surface-baseline.json with the release bump (node scripts/generate-v2-surface-baseline.mjs --write). A baseline from another release measures the wrong before.`);
}

const parse = (s) => { const i = s.indexOf('|'); const j = s.indexOf('|', i + 1); return { site: s.slice(0, i), kind: s.slice(i + 1, j), value: s.slice(j + 1) }; };
/** The INSTANCE pointer a removal is about — what a corrections/migrations row names. */
function siteOf(t) {
  if (t.kind === 'property') return t.site.endsWith('#') ? `${t.site}/${t.value}` : `${t.site}/${t.value}`;
  if (t.kind === 'operation') return `spec/v2/path-manifest.json#/operations/${t.value}`;
  if (t.kind === 'channel') return `spec/v2/path-manifest.json#/channels/${t.value}`;
  return t.site;
}

const before = new Set(baseline.surfaces ?? []);
const after = new Set(enumerateTree(TREE_ROOT));

const beforeSites = new Set([...before].map((s) => parse(s).site));
const afterSites = new Set([...after].map((s) => parse(s).site));

// ── what may license a removal ───────────────────────────────────────────────
const corrections = readJsonOrNull(CORRECTIONS) ?? { rows: [] };
const migrations = readJsonOrNull(MIGRATIONS) ?? { rows: [] };
const deprecations = readJsonOrNull(DEPRECATIONS) ?? { entries: [] };
const triggersOf = (e) => (Array.isArray(e.removalTrigger) ? e.removalTrigger : e.removalTrigger ? [e.removalTrigger] : []);
const minorOf = (v) => { const m = /^(\d+)\.(\d+)/.exec(String(v ?? '')); return m ? [Number(m[1]), Number(m[2])] : null; };
const cmpMinor = (a, b) => { const x = minorOf(a), y = minorOf(b); if (!x || !y) return NaN; return x[0] !== y[0] ? Math.sign(x[0] - y[0]) : Math.sign(x[1] - y[1]); };

/** Licences: [{ pointer, why }]. A DUE v2-minor row licenses only if the retirement gate agrees. */
const licences = [];
for (const c of corrections.rows ?? []) for (const p of c.pointers ?? []) licences.push({ pointer: p, why: `${c.id} (COMPATIBILITY.md §3 correction on record, ${c.date})` });
const dueRetirementRows = (deprecations.entries ?? []).filter((e) => triggersOf(e).includes('v2-minor') && cmpMinor(release.version, e.removeIn) >= 0);
let retirementVerdict = null;
if (dueRetirementRows.length > 0) {
  const r = spawnSync('node', [join(ROOT, 'scripts', 'check-v2-retirement.mjs')], { cwd: ROOT, encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024 });
  retirementVerdict = r.status === 0;
  for (const e of dueRetirementRows) {
    if (!retirementVerdict) continue;
    for (const m of (migrations.rows ?? []).filter((m) => m.deprecationId === e.id)) {
      if (m.from?.path) licences.push({ pointer: m.from.path, why: `${e.id} (due at ${release.version}, retirable per check-v2-retirement)` });
    }
  }
}
const licensedBy = (site) => licences.find((l) => site === l.pointer || site.startsWith(`${l.pointer}/`)) ?? null;

// ── removals ────────────────────────────────────────────────────────────────
const removedTuples = [...before].filter((s) => !after.has(s)).map(parse);
const removedUnion = removedTuples.filter((t) => ['property', 'enum-member', 'operation', 'channel'].includes(t.kind));
// A removed property takes its whole subtree with it; report the root of the
// cut, not the hundred tuples underneath it.
const removedPropertySites = new Set(removedUnion.filter((t) => t.kind === 'property').map(siteOf));
const isUnderARemovedProperty = (site) => { for (const p of removedPropertySites) if (site !== p && site.startsWith(`${p}/`)) return true; return false; };

const failures = [];
const licensed = [];
for (const t of removedUnion) {
  const site = siteOf(t);
  if (isUnderARemovedProperty(site)) continue;
  const lic = licensedBy(site);
  if (lic) { licensed.push(`${t.kind} ${site}${t.kind === 'enum-member' ? ` = ${t.value}` : ''} — licensed by ${lic.why}`); continue; }
  failures.push(`${t.kind} removed without a due retirement row or a corrections.json row: ${site}${['enum-member'].includes(t.kind) ? ` = ${t.value}` : ''}`);
}

// ── new restrictions ────────────────────────────────────────────────────────
const addedTuples = [...after].filter((s) => !before.has(s)).map(parse);
for (const t of addedTuples) {
  if (!beforeSites.has(t.site)) continue; // a brand-new object may require whatever it likes
  if (t.kind === 'required') failures.push(`\`required\` entry "${t.value}" added to the pre-existing object ${t.site} — a document that validated without it no longer does (RFC 0197 §B.6; a new REQUIRED property is a major)`);
  if (t.kind === 'closed') failures.push(`${t.site} went from open to \`additionalProperties: false\` — closing an open object is a major (RFC 0197 §B.6)`);
}
for (const t of removedTuples) {
  if (t.kind !== 'type') continue;
  if (!afterSites.has(t.site)) continue; // the whole site is gone; the removal report above owns it
  failures.push(`type "${t.value}" no longer permitted at ${t.site} — narrowing a type is a major (RFC 0197 §A.1); add the new shape beside the old one instead`);
}

// ── report ──────────────────────────────────────────────────────────────────
const addedUnion = addedTuples.filter((t) => ['property', 'enum-member', 'operation', 'channel'].includes(t.kind));
console.log(`check-v2-surface-monotone: baseline ${baseline.count ?? before.size} surfaces at release ${baseline.release}; tree ${after.size}; ${addedUnion.length} addition(s) (additive, §B.5); ${removedUnion.length} removal tuple(s); ${licences.length} licence pointer(s)${dueRetirementRows.length > 0 ? `; ${dueRetirementRows.length} due v2-minor row(s), check-v2-retirement ${retirementVerdict ? 'agrees' : 'REFUSES'}` : '; no due v2-minor row'}`);
for (const l of licensed.slice(0, 20)) console.log(`  licensed: ${l}`);
if (failures.length > 0) {
  console.error(`=== check-v2-surface-monotone FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  process.exit(1);
}
console.log('=== check-v2-surface-monotone OK — no v2 surface was reshaped or removed without a licence ===');

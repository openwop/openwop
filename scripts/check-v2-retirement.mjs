#!/usr/bin/env node
/**
 * check-v2-retirement — RFC 0197 §A.2: a v2 surface is removed inside the
 * major only when SIX predicates hold, and this script is the thing that
 * proves them. It also re-runs §A.4's R3 over every `spec/v2/corrections.json`
 * row, so a correction's census claim is falsified here rather than believed.
 *
 *   R1 Replacement first   — a spec/v2/migrations.json row whose `to.addedIn`
 *                            minor is BELOW the removal minor, and whose `to`
 *                            surface is present in the v2 tree.
 *   R2 Announced removal   — the deprecations row named `removeIn` at least two
 *                            released minors AND 30 days earlier, read from the
 *                            PUBLIC HISTORY (`git log`), never from a field in
 *                            the row. A due row with no history FAILS (G7): a
 *                            row that appeared this morning has announced
 *                            nothing, and the absence of a record is not a
 *                            record of absence.
 *   R3 Unevidenced         — no committed evidence/v2-host-bundles/*.json
 *                            discovery document carries it, whatever `status`
 *                            its record has, AND a registry census no older
 *                            than 30 days counts 0 published manifests. A
 *                            census that is missing or null FAILS.
 *   R4 Absence defined     — the surface is a family, facet, enum member or
 *                            envelope kind (the four kinds whose absence the
 *                            2.0 contract already defines), it is not a
 *                            `required` entry in spec/v2/surface-baseline.json,
 *                            and a family is not in a profiles.json floor.
 *   R5 Corpus maturity     — the advertising family's declaration row is
 *                            `experimental`, and `removeIn` is later than the
 *                            row's `maturity.until` when one is set.
 *   R6 No independent host — no tier-3 / independent host is in the v2
 *                            INTEROP-MATRIX table or the end-of-support clock.
 *
 * A DUE row (the v2 release has reached `removeIn`) that is not `retirable`
 * FAILS, naming the predicate that held it back; the disposition is then to
 * reschedule `removeIn` to "3.0". A row that is not yet due is REPORTED with
 * its predicate line, because a gate that prints nothing while its input is
 * empty is indistinguishable from one that is broken.
 *
 * TEST SEAMS. Every input path is overridable, as check-removal-dates does
 * with OPENWOP_EOS_CLOCK_FILE, so `conformance/src/coherence/v2-retirement-gate`
 * can drive ONE predicate red at a time against a fixture: a row that fails for
 * the wrong predicate is a defect in the fixture, not a pass.
 *   OPENWOP_DEPRECATIONS_FILE  OPENWOP_V2_MIGRATIONS_FILE  OPENWOP_V2_BUNDLES_DIR
 *   OPENWOP_CROSS_REPO_FILE    OPENWOP_V2_DECLARATION_FILE OPENWOP_V2_RELEASE_FILE
 *   OPENWOP_V2_CORRECTIONS_FILE OPENWOP_EOS_CLOCK_FILE     OPENWOP_INTEROP_MATRIX_FILE
 *   OPENWOP_V2_PROFILES_FILE   OPENWOP_V2_BASELINE_FILE    OPENWOP_TODAY
 *   OPENWOP_V2_ROW_HISTORY_FILE — R2's git read, replaced by a fixture map
 *     { "<rowId>": { "firstCommit": "<ISO>", "minorAtCommit": "2.N" } }. It
 *     exists ONLY so the coherence twin can satisfy R2 while it sabotages some
 *     other predicate; on the real tree it is unset and git is the only source.
 *
 * Exit 0 on success, 1 on any failure. A file this script cannot read is a
 * failure, never a skip.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = (k, ...fallback) => process.env[k] ?? join(ROOT, ...fallback);
const P = {
  deprecations: env('OPENWOP_DEPRECATIONS_FILE', 'spec', 'v1', 'deprecations.json'),
  migrations: env('OPENWOP_V2_MIGRATIONS_FILE', 'spec', 'v2', 'migrations.json'),
  corrections: env('OPENWOP_V2_CORRECTIONS_FILE', 'spec', 'v2', 'corrections.json'),
  declaration: env('OPENWOP_V2_DECLARATION_FILE', 'spec', 'v2', 'declaration.json'),
  release: env('OPENWOP_V2_RELEASE_FILE', 'spec', 'v2', 'release.json'),
  profiles: env('OPENWOP_V2_PROFILES_FILE', 'spec', 'v2', 'profiles.json'),
  baseline: env('OPENWOP_V2_BASELINE_FILE', 'spec', 'v2', 'surface-baseline.json'),
  bundles: env('OPENWOP_V2_BUNDLES_DIR', 'evidence', 'v2-host-bundles'),
  crossRepo: env('OPENWOP_CROSS_REPO_FILE', 'evidence', 'cross-repo-manifests.json'),
  clock: process.env['OPENWOP_EOS_CLOCK_FILE'] ?? join(ROOT, 'evidence', 'v1-end-of-support.json'),
  matrix: env('OPENWOP_INTEROP_MATRIX_FILE', 'INTEROP-MATRIX.md'),
  rowHistory: process.env['OPENWOP_V2_ROW_HISTORY_FILE'] ?? null,
};
const TODAY = (process.env['OPENWOP_TODAY'] ?? new Date().toISOString()).slice(0, 10);
const CENSUS_MAX_AGE_DAYS = 30;
const ANNOUNCE_MIN_DAYS = 30;
const ANNOUNCE_MIN_MINORS = 2;

const readJson = (p, what) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) {
    console.error(`=== check-v2-retirement FAILED — cannot read ${what} at ${p}: ${e.message} ===`);
    process.exit(1);
  }
};
const readJsonOrNull = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const minorOf = (v) => { const m = /^(\d+)\.(\d+)/.exec(String(v ?? '')); return m ? [Number(m[1]), Number(m[2])] : null; };
/** -1 / 0 / 1 comparing <major>.<minor> pairs. */
export function cmpMinor(a, b) {
  const x = minorOf(a), y = minorOf(b);
  if (!x || !y) return NaN;
  return x[0] !== y[0] ? Math.sign(x[0] - y[0]) : Math.sign(x[1] - y[1]);
}
const daysBetween = (isoA, isoB) => Math.floor((Date.parse(isoB) - Date.parse(isoA)) / 86_400_000);

/** Dotted path lookup inside a discovery document. `a.b.c` only; no wildcards. */
function atPath(doc, path) {
  let node = doc;
  for (const seg of String(path).split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = Array.isArray(node) ? undefined : node[seg];
  }
  return node;
}

/** Does `found` carry `value`? Absent `value` means "the path existing is enough". */
function carries(found, value) {
  if (found === undefined) return false;
  if (value === undefined) return true;
  if (Array.isArray(found)) return found.some((x) => JSON.stringify(x) === JSON.stringify(value));
  return JSON.stringify(found) === JSON.stringify(value);
}

/**
 * R3's bundle leg, exported so check-v2-surface-monotone and the corrections
 * leg use the same scan rather than two implementations that can disagree.
 */
export function bundlesCarrying(discovery, bundlesDir = P.bundles) {
  if (!discovery || !existsSync(bundlesDir)) return [];
  const hits = [];
  for (const f of readdirSync(bundlesDir).filter((f) => f.endsWith('.json')).sort()) {
    const b = readJsonOrNull(join(bundlesDir, f));
    const doc = b?.discovery?.document;
    if (!doc) continue;
    if (carries(atPath(doc, discovery.path), discovery.value)) hits.push(f);
  }
  return hits;
}

/** R2 — the first commit that introduced this row id, from the public history. */
function rowHistory(rowId) {
  if (P.rowHistory) {
    const fixture = readJsonOrNull(P.rowHistory);
    const row = fixture?.[rowId];
    return row ? { firstCommit: row.firstCommit ?? null, minorAtCommit: row.minorAtCommit ?? null, source: 'fixture' } : { firstCommit: null, minorAtCommit: null, source: 'fixture' };
  }
  let dates = [];
  try {
    const out = execFileSync('git', ['-C', ROOT, 'log', '-S', JSON.stringify(rowId), '--format=%cI', '--', 'spec/v1/deprecations.json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    dates = out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return { firstCommit: null, minorAtCommit: null, source: 'git (unavailable)' }; }
  if (dates.length === 0) return { firstCommit: null, minorAtCommit: null, source: 'git' };
  const firstCommit = dates[dates.length - 1];
  // Which 2.x minor was released at that date? The highest `v2.N.P` tag whose
  // own date is at or before it.
  let minorAtCommit = null;
  try {
    const tags = execFileSync('git', ['-C', ROOT, 'tag', '--list', 'v2.*', '--format=%(creatordate:iso-strict)\t%(refname:short)'], { encoding: 'utf8' })
      .split('\n').map((l) => l.split('\t')).filter((p) => p.length === 2);
    for (const [when, name] of tags) {
      if (Date.parse(when) > Date.parse(firstCommit)) continue;
      const m = /^v(2)\.(\d+)\./.exec(name);
      if (!m) continue;
      const cand = `2.${m[2]}`;
      if (minorAtCommit === null || cmpMinor(cand, minorAtCommit) > 0) minorAtCommit = cand;
    }
  } catch { /* no tags reachable; minorAtCommit stays null and R2 fails closed */ }
  return { firstCommit, minorAtCommit, source: 'git' };
}

function evaluateRow(row, ctx) {
  const held = [];
  const notes = [];
  const r = row.retirement ?? null;
  if (!r) return { held: ['R4 no `retirement` block — nothing to evaluate (the schema requires one on a v2-minor row)'], notes };

  // ── R1 ────────────────────────────────────────────────────────────────────
  const migs = (ctx.migrations.rows ?? []).filter((m) => m.deprecationId === row.id);
  if (migs.length !== 1) {
    held.push(`R1 expected exactly one spec/v2/migrations.json row with deprecationId ${row.id}, found ${migs.length}`);
  } else {
    const mig = migs[0];
    if (!(cmpMinor(mig.to?.addedIn, row.removeIn) < 0)) held.push(`R1 replacement ${mig.to?.surface} shipped in ${mig.to?.addedIn}, which is not EARLIER than the removal minor ${row.removeIn} — a replacement that lands with the removal gives no one a window`);
    else notes.push(`R1 ok (${mig.to.surface} in ${mig.to.addedIn} < ${row.removeIn})`);
    if (mig.to?.path && !ctx.baselineSites.has(String(mig.to.path))) held.push(`R1 the replacement's path ${mig.to.path} is not a surface in spec/v2/surface-baseline.json — the replacement is not actually in the v2 tree`);
  }

  // ── R2 ────────────────────────────────────────────────────────────────────
  const hist = rowHistory(row.id);
  if (!hist.firstCommit) {
    held.push(`R2 no commit in the public history introduces ${row.id} into spec/v1/deprecations.json (${hist.source}) — a removal cannot be announced by a row that has no history`);
  } else {
    const age = daysBetween(hist.firstCommit.slice(0, 10), TODAY);
    if (age < ANNOUNCE_MIN_DAYS) held.push(`R2 announced ${age} day(s) ago (${hist.firstCommit.slice(0, 10)}), fewer than the ${ANNOUNCE_MIN_DAYS} RFC 0197 requires`);
    if (!hist.minorAtCommit) held.push(`R2 no released 2.x minor is datable at or before ${hist.firstCommit.slice(0, 10)}, so the two-minor window cannot be proven — it fails closed`);
    else {
      const gap = (minorOf(row.removeIn)?.[1] ?? -1) - (minorOf(hist.minorAtCommit)?.[1] ?? 0);
      if (gap < ANNOUNCE_MIN_MINORS) held.push(`R2 announced at ${hist.minorAtCommit} and removes at ${row.removeIn} — ${gap} minor(s), fewer than the ${ANNOUNCE_MIN_MINORS} RFC 0197 requires`);
      else notes.push(`R2 ok (announced ${hist.firstCommit.slice(0, 10)} at ${hist.minorAtCommit}, ${age} days, ${gap} minors)`);
    }
  }

  // ── R3 ────────────────────────────────────────────────────────────────────
  const hits = bundlesCarrying(r.discovery, P.bundles);
  if (!r.discovery) notes.push('R3 no `retirement.discovery` — the surface is not discovery-visible, so the bundle leg is 0 by construction');
  if (hits.length > 0) held.push(`R3 ${hits.length} committed v2 host bundle(s) carry ${r.discovery.path}${r.discovery.value !== undefined ? ` = ${JSON.stringify(r.discovery.value)}` : ''}: ${hits.join(', ')}`);
  if (r.manifest) {
    const census = ctx.census?.[row.id] ?? null;
    if (!census) held.push(`R3 no registryManifestCensus entry for ${row.id} in evidence/cross-repo-manifests.json — a missing census is a failure, not a zero (run generate-cross-repo-evidence.mjs --write with the registry checked out)`);
    else if (census.count === null || census.count === undefined) held.push(`R3 the registry census for ${row.id} is null — the registry checkout was absent when it was written`);
    else if (census.count > 0) held.push(`R3 ${census.count} published registry manifest(s) carry ${r.manifest.path} (of ${census.manifestsScanned} scanned at ${census.registryCommitDate})`);
    else {
      const age = census.registryCommitDate ? daysBetween(census.registryCommitDate, TODAY) : null;
      if (age === null) held.push(`R3 the registry census for ${row.id} records no registryCommitDate, so its freshness cannot be proven`);
      else if (age > CENSUS_MAX_AGE_DAYS) held.push(`R3 the registry census for ${row.id} is ${age} days old (> ${CENSUS_MAX_AGE_DAYS}); re-census before removing`);
      else notes.push(`R3 ok (0 bundles, 0 of ${census.manifestsScanned} manifests, census ${age} days old)`);
    }
  } else if (hits.length === 0) notes.push('R3 ok (0 bundles; no manifest leg declared)');

  // ── R4 ────────────────────────────────────────────────────────────────────
  if (!['family', 'facet', 'enum-member', 'envelope-kind'].includes(r.class)) {
    held.push(`R4 class ${JSON.stringify(r.class)} is not one of family | facet | enum-member | envelope-kind — a REQUIRED property, an endpoint, an error code's meaning and a header are never retirable inside the major`);
  } else {
    const site = migs.length === 1 ? migs[0].from?.path : null;
    // The `required` test applies to a surface that IS a property (a facet, or
    // an optional property). An enum member's property stays behind; only the
    // member goes, so a REQUIRED `transport` does not block retiring `"sse"`
    // from its enum. Conflating the two would make every advertised enum member
    // unretirable, which is not what §A.2 R4 says.
    if (['facet', 'family'].includes(r.class) && site && ctx.baselineRequired.has(String(site))) held.push(`R4 ${site} is a \`required\` entry in spec/v2/surface-baseline.json — its absence is not already a 2.0 state`);
    if (r.class === 'family' && ctx.profileFamilies.has(r.family)) held.push(`R4 family ${r.family} is in a spec/v2/profiles.json required set — removing it breaks a profile predicate, not just an optional advertisement`);
    if (held.every((h) => !h.startsWith('R4'))) notes.push(`R4 ok (class ${r.class})`);
  }

  // ── R5 ────────────────────────────────────────────────────────────────────
  const fam = (ctx.declaration.families ?? []).find((f) => f.key === r.family);
  if (!fam) held.push(`R5 no spec/v2/declaration.json family row for ${JSON.stringify(r.family)}`);
  else if (!fam.maturity) held.push(`R5 declaration row ${r.family} carries no maturity block`);
  else if (fam.maturity.technical !== 'experimental') held.push(`R5 declaration row ${r.family} is \`${fam.maturity.technical}\`, not \`experimental\` — §C.9: after a family moves to stable, removing any of its surfaces waits for 3.0`);
  else if (fam.maturity.until && !(cmpMinor(row.removeIn, fam.maturity.until) > 0)) held.push(`R5 declaration row ${r.family} holds its shape until ${fam.maturity.until}, which is not earlier than the removal minor ${row.removeIn}`);
  else notes.push(`R5 ok (${r.family} experimental${fam.maturity.until ? `, until ${fam.maturity.until}` : ''})`);

  // ── R6 ────────────────────────────────────────────────────────────────────
  const independentHosts = [];
  for (const h of ctx.clock?.hosts ?? []) {
    const tiers = h?.latest?.evidenceTiers ?? [];
    if (tiers.some((t) => /independent|tier-3/i.test(String(t)))) independentHosts.push(`${h.name} (clock)`);
  }
  for (const cell of ctx.matrixTiers) if (/independent|tier-3/i.test(cell)) independentHosts.push(`INTEROP v2 table: ${cell}`);
  if (independentHosts.length > 0) held.push(`R6 an independent (tier-3) host is in the v2 matrix: ${independentHosts.join(', ')} — a retirement inside the major is only for a surface no outside organization has measured`);
  else notes.push('R6 ok (no independent host in the v2 matrix or the end-of-support clock)');

  return { held, notes };
}

/** The Evidence-tier cells of the INTEROP-MATRIX v2 table. */
function matrixEvidenceTiers(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf('\n## v2 ');
  if (start < 0) return [];
  const rest = text.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  const section = end < 0 ? rest : rest.slice(0, end);
  const lines = section.split('\n').filter((l) => l.trim().startsWith('|'));
  const header = lines.find((l) => /\|\s*Evidence tier\s*\|/i.test(l));
  if (!header) return [];
  const cols = header.split('|').map((c) => c.trim());
  const idx = cols.findIndex((c) => /^Evidence tier$/i.test(c));
  if (idx < 0) return [];
  const out = [];
  for (const l of lines) {
    if (l === header || /^\|\s*-+/.test(l)) continue;
    const cells = l.split('|').map((c) => c.trim());
    if (cells.length <= idx) continue;
    if (cells[idx]) out.push(cells[idx]);
  }
  return out;
}

const deprecations = readJson(P.deprecations, 'spec/v1/deprecations.json');
const migrations = readJson(P.migrations, 'spec/v2/migrations.json');
const corrections = readJson(P.corrections, 'spec/v2/corrections.json');
const declaration = readJson(P.declaration, 'spec/v2/declaration.json');
const release = readJson(P.release, 'spec/v2/release.json');
const profiles = readJsonOrNull(P.profiles) ?? {};
const baseline = readJsonOrNull(P.baseline);
const crossRepo = readJsonOrNull(P.crossRepo);
const clock = readJsonOrNull(P.clock);

const baselineRequired = new Set();
const baselineSites = new Set();
for (const s of baseline?.surfaces ?? []) {
  const [site, kind, value] = s.split('|');
  baselineSites.add(site);
  if (kind === 'property') baselineSites.add(`${site}${site.endsWith('#') ? '/' : '/'}${value}`);
  if (kind === 'required') baselineRequired.add(`${site}/${value}`.replace('#/', '#/'));
}
const profileFamilies = new Set();
for (const p of profiles.profiles ?? []) for (const f of p.predicate?.families ?? []) profileFamilies.add(typeof f === 'string' ? f : f?.key ?? f?.family);

const ctx = {
  migrations, declaration, clock,
  census: crossRepo?.registryManifestCensus ?? null,
  baselineRequired, baselineSites, profileFamilies,
  matrixTiers: matrixEvidenceTiers(P.matrix),
};

const triggersOf = (e) => (Array.isArray(e.removalTrigger) ? e.removalTrigger : e.removalTrigger ? [e.removalTrigger] : []);
const rows = (deprecations.entries ?? []).filter((e) => triggersOf(e).includes('v2-minor'));

const failures = [];
const report = [];
for (const row of rows) {
  const due = cmpMinor(release.version, row.removeIn) >= 0;
  const { held, notes } = evaluateRow(row, ctx);
  const verdict = held.length === 0 ? 'retirable' : `held:${held.map((h) => h.slice(0, 2)).join(',')}`;
  report.push(`  ${row.id} removeIn ${row.removeIn} (${due ? 'DUE at ' + release.version : 'not due'}) — ${verdict}`);
  for (const n of notes) report.push(`      ${n}`);
  for (const h of held) report.push(`      ${h}`);
  if (due && held.length > 0) {
    failures.push(`${row.id} is DUE at ${release.version} and is NOT retirable — reschedule removeIn to 3.0 with removalTrigger v1-end-of-support. Held by: ${held.join(' | ')}`);
  }
}

// §A.4 — a correction is admitted only when R3 held for the PRIOR shape.
let correctionsOk = 0;
for (const c of corrections.rows ?? []) {
  const census = c.priorShapeCensus ?? {};
  const problems = [];
  if (census.bundles !== 0) problems.push(`priorShapeCensus.bundles is ${census.bundles}, not 0 — a committed bundle carried the prior shape (this is P1, and P1 is exactly what §A.4 refuses)`);
  if (census.manifests === null || census.manifests === undefined) problems.push('priorShapeCensus.manifests is null — no census was run, and a missing census is a failure, not a zero');
  else if (census.manifests !== 0) problems.push(`priorShapeCensus.manifests is ${census.manifests}, not 0`);
  if (census.manifestsScanned !== null && census.manifestsScanned !== undefined && census.manifestsScanned === 0 && census.manifests === 0) problems.push('priorShapeCensus scanned 0 manifests — 0 of 0 witnesses nothing');
  const compatPath = join(ROOT, 'COMPATIBILITY.md');
  if (existsSync(compatPath) && c.compatibilityEntry && !readFileSync(compatPath, 'utf8').includes(c.compatibilityEntry)) {
    problems.push(`COMPATIBILITY.md no longer contains ${JSON.stringify(c.compatibilityEntry)} — the correction's prose entry has drifted away from its register row`);
  }
  if (problems.length > 0) failures.push(`${c.id}: ${problems.join(' | ')}`);
  else correctionsOk++;
  report.push(`  ${c.id} (${c.date}, ${c.class}) — ${problems.length === 0 ? 'R3 holds for the prior shape' : 'R3 FAILS'}: ${c.pointers.length} pointer(s), ${census.bundles} bundle(s), ${census.manifests} of ${census.manifestsScanned} manifest(s)`);
}

console.log(`check-v2-retirement inputs: release ${release.version}; ${rows.length} v2-minor deprecation row(s); ${(migrations.rows ?? []).length} v2→v2 migration row(s); ${(corrections.rows ?? []).length} correction row(s); ${existsSync(P.bundles) ? readdirSync(P.bundles).filter((f) => f.endsWith('.json')).length : 0} committed bundle(s); census ${ctx.census ? `${Object.keys(ctx.census).length} row(s)` : 'ABSENT'}; ${ctx.matrixTiers.length} v2 matrix evidence-tier cell(s); today ${TODAY}`);
for (const line of report) console.log(line);

if (failures.length > 0) {
  console.error(`=== check-v2-retirement FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`=== check-v2-retirement OK — ${rows.length} v2-minor row(s), none due-and-held; ${correctionsOk} correction row(s) pass R3 ===`);

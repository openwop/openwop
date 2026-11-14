#!/usr/bin/env node
/**
 * derive-core-adoption — RFC 0264. A core family's `maturity.adoption` is a
 * count of hosts that witness it in committed bundles, not a hand-kept value.
 *
 * Why: `capabilities.md` §8 said adoption was "derived from INTEROP-MATRIX
 * bundle evidence", and nothing derived it for core rows. Every experimental
 * core row read `none` while the committed bundles carried executed-pass rows
 * for most of them on one host or more. A hand-kept axis drifts at the next
 * bundle, and nothing says so (RFC 0220 made the same call for ext `Stable`).
 *
 *   node scripts/derive-core-adoption.mjs                  --check (default)
 *   node scripts/derive-core-adoption.mjs --write          set the core rows in declaration.json
 *   node scripts/derive-core-adoption.mjs --emit-review-skeleton
 *                                                          print a `keep` row per `none` family
 *
 * §A. For each declaration row with `anchor: core`:
 *   - eligible bundles: per `host.name`, the newest (by `generatedAt`) bundle that
 *     `check-accepted-predicate.mjs` treats as certified — every claimed profile
 *     `certified: true` and a `witnessSha256` — that is not a colocated companion
 *     (RFC 0216 §C limits a companion to harness-trust-anchor rows). The host
 *     then counts only if `evidence/host-tiers.json` lists that bundle's
 *     discovery origin. A retired host's last certified bundle still counts.
 *   - a host witnesses F when its captured discovery document carries F's
 *     record at the document root (RFC 0073; RFC 0169 §A.2: presence of the
 *     record IS the claim), at least one major-2 scenario that GATES on F is
 *     `executed-pass` in the bundle, and none is `executed-fail`. The gate
 *     signal is `report-v2-witness-coverage.mjs --json` (`families[].v2Scenarios[]`
 *     with `signals` containing `gate`); citations and RFC mentions do not count.
 *     A row the suite annotated `partial-witness:` soft-skipped the requirement
 *     it was for and is not a pass (same rule as check-accepted-predicate).
 *   - value: 0 hosts `none`, 1 `single-witness`, 2+ `multi-witness`, any tier-3
 *     witnessing host `independent`.
 *
 * §B. `evidence/core-adoption-review.json` holds one row per core family at
 * `none`. The check fails on: a `none` family with no row; a row for a family
 * not at `none` (stale); an overdue `keep` row (`reviewBy` below the minor in
 * `spec/v2/release.json`); a `retire` row without a `correction` id present in
 * `spec/v2/corrections.json`; a `keep` row whose `reviewBy` moved since the
 * baseline while `reason` and `plan` are both unchanged (§B.3). The baseline is
 * the file at the last published tag: `v<release.json version>` if that tag
 * exists, else the highest `v<major>.*` tag at or below it. No file at that tag
 * means no baseline.
 *
 * `--write` rewrites only the changed `"adoption"` values, in place, so the
 * file's mixed escaping (some `§` literal, some `§`) is not churned. It
 * exits 0 after writing even if §B would fail: in the regen chain the derived
 * value lands first and the review row is a human edit that `--check` then demands.
 *
 * Env seams (tests, fixtures):
 *   OPENWOP_V2_BUNDLES_DIR        bundle directory
 *   OPENWOP_V2_DECLARATION_FILE   declaration.json
 *   OPENWOP_HOST_TIERS_FILE       host-tiers.json
 *   OPENWOP_0264_REVIEW_FILE      core-adoption-review.json
 *   OPENWOP_V2_RELEASE_FILE       release.json
 *   OPENWOP_V2_CORRECTIONS_FILE   corrections.json
 *   OPENWOP_0264_COVERAGE_JSON    a precomputed `report-v2-witness-coverage.mjs --json`
 *                                 (otherwise spawned; it needs typescript from conformance/node_modules)
 *   OPENWOP_0264_REVIEW_BASELINE  a baseline review file, or `none` for no baseline
 *
 * @see RFCS/0264-core-adoption-derived.md
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { certified, isCompanion } from './lib/companion-pairing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const P = {
  bundles: env.OPENWOP_V2_BUNDLES_DIR || join(ROOT, 'evidence', 'v2-host-bundles'),
  declaration: env.OPENWOP_V2_DECLARATION_FILE || join(ROOT, 'spec', 'v2', 'declaration.json'),
  tiers: env.OPENWOP_HOST_TIERS_FILE || join(ROOT, 'evidence', 'host-tiers.json'),
  review: env.OPENWOP_0264_REVIEW_FILE || join(ROOT, 'evidence', 'core-adoption-review.json'),
  release: env.OPENWOP_V2_RELEASE_FILE || join(ROOT, 'spec', 'v2', 'release.json'),
  corrections: env.OPENWOP_V2_CORRECTIONS_FILE || join(ROOT, 'spec', 'v2', 'corrections.json'),
};
const REVIEW_REL = 'evidence/core-adoption-review.json';
const args = new Set(process.argv.slice(2));
const mode = args.has('--write') ? 'write' : args.has('--emit-review-skeleton') ? 'skeleton' : 'check';
const NAME = 'derive-core-adoption';

const die = (msg) => { console.error(`=== ${NAME} FAILED — ${msg} ===`); process.exit(1); };
const readJson = (p, what) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return die(`cannot read ${what} (${p}): ${e.message}`); }
};

// ---------- inputs ----------
const declText = (() => { try { return readFileSync(P.declaration, 'utf8'); } catch (e) { return die(`cannot read declaration (${P.declaration}): ${e.message}`); } })();
const decl = JSON.parse(declText);
const coreRows = (decl.families ?? []).filter((f) => f.anchor === 'core');
const release = readJson(P.release, 'release.json');
const [relMajor, relMinor] = String(release.version ?? '').split('.').map(Number);
if (!Number.isInteger(relMajor) || !Number.isInteger(relMinor)) die(`release.json version "${release.version}" is not <major>.<minor>.<patch>`);

const tierOf = new Map();
for (const h of readJson(P.tiers, 'host-tiers.json').hosts ?? []) for (const o of h.origins ?? []) tierOf.set(o, h.tier);

function loadCoverage() {
  if (env.OPENWOP_0264_COVERAGE_JSON) return readJson(env.OPENWOP_0264_COVERAGE_JSON, 'OPENWOP_0264_COVERAGE_JSON');
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'report-v2-witness-coverage.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) die(`report-v2-witness-coverage.mjs --json exited ${r.status} (it needs typescript from conformance/node_modules — run npm ci there, or set OPENWOP_0264_COVERAGE_JSON): ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  try { return JSON.parse(r.stdout); } catch (e) { return die(`report-v2-witness-coverage.mjs --json printed no JSON: ${e.message}`); }
}
const coverage = loadCoverage();
if (!Array.isArray(coverage?.families)) die('coverage JSON has no families[] array');
/** family key -> set of major-2 scenario file names that GATE on it */
const gating = new Map(coverage.families.map((f) => [f.key, new Set((f.v2Scenarios ?? []).filter((s) => Array.isArray(s.signals) && s.signals.includes('gate')).map((s) => s.file))]));

// ---------- §A.2 eligible bundles ----------
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };
const newestByHost = new Map();
if (!existsSync(P.bundles)) die(`bundle directory ${P.bundles} does not exist`);
for (const file of readdirSync(P.bundles).filter((n) => n.endsWith('.json')).sort()) {
  let b;
  try { b = JSON.parse(readFileSync(join(P.bundles, file), 'utf8')); } catch { continue; /* unreadable bundles are check-ext-status-coherence's finding */ }
  if (isCompanion(b) || !certified(b) || typeof b.witnessSha256 !== 'string') continue;
  const name = b.host?.name;
  if (typeof name !== 'string' || !name) continue;
  const at = Date.parse(b.generatedAt ?? '') || 0;
  const prev = newestByHost.get(name);
  if (!prev || at > prev.at) newestByHost.set(name, { file, at, bundle: b });
}
const hosts = [];
const notes = [];
for (const [name, h] of [...newestByHost].sort(([a], [b]) => a.localeCompare(b))) {
  const origin = originOf(h.bundle.discovery?.url ?? '');
  const tier = tierOf.get(origin);
  if (tier === undefined) { notes.push(`${name}: newest certified bundle ${h.file} comes from ${origin ?? 'no discovery.url'}, not listed in host-tiers.json — not counted`); continue; }
  const doc = h.bundle.discovery?.document;
  const rows = h.bundle.results?.requirements ?? [];
  hosts.push({ name, file: h.file, tier, doc: doc && typeof doc === 'object' ? doc : {}, rows: Array.isArray(rows) ? rows : Object.values(rows) });
}

// ---------- §A.3 / §A.4 derivation ----------
const carries = (doc, key) => { const rec = doc[key]; return rec !== null && typeof rec === 'object' && !Array.isArray(rec); };
const derived = new Map();
const witnesses = new Map();
for (const row of coreRows) {
  const gates = gating.get(row.key) ?? new Set();
  const w = [];
  for (const h of hosts) {
    if (!carries(h.doc, row.key)) continue;
    const mine = h.rows.filter((r) => gates.has(r.scenario));
    const pass = mine.some((r) => r.result === 'executed-pass' && !(typeof r.detail === 'string' && r.detail.startsWith('partial-witness:')));
    const fail = mine.some((r) => r.result === 'executed-fail');
    if (pass && !fail) w.push(h);
  }
  witnesses.set(row.key, w);
  derived.set(row.key, w.length === 0 ? 'none' : w.some((h) => h.tier === 3) ? 'independent' : w.length === 1 ? 'single-witness' : 'multi-witness');
}
const noneFamilies = coreRows.map((r) => r.key).filter((k) => derived.get(k) === 'none');
const counts = {};
for (const v of derived.values()) counts[v] = (counts[v] ?? 0) + 1;
const summary = `${coreRows.length} core famil${coreRows.length === 1 ? 'y' : 'ies'} over ${hosts.length} host(s) [${hosts.map((h) => `${h.name}=${h.file} t${h.tier}`).join(', ')}]: ${['none', 'single-witness', 'multi-witness', 'independent'].map((v) => `${v} ${counts[v] ?? 0}`).join(', ')}`;
const minorPlus = (n) => `${relMajor}.${relMinor + n}`;

if (mode === 'skeleton') {
  console.log(JSON.stringify({
    $comment: `RFC 0264 §B — one row per core family whose derived adoption (scripts/derive-core-adoption.mjs) is none. decision keep|retire; reviewBy is a corpus minor; renewing a keep row MUST change reason or plan; a retire row names the spec/v2/corrections.json row that removes the family.`,
    rows: noneFamilies.map((family) => ({ family, reviewBy: minorPlus(3), decision: 'keep', reason: 'TODO', plan: 'TODO' })),
  }, null, 2));
  process.exit(0);
}

// ---------- §A.1 compare / write ----------
const changes = coreRows.filter((r) => r.maturity?.adoption !== derived.get(r.key)).map((r) => ({ key: r.key, from: r.maturity?.adoption, to: derived.get(r.key) }));

if (mode === 'write' && changes.length) {
  // Rewrite only the "adoption" value inside each changed family object, by
  // position in the text, then prove the parsed result differs in exactly those values.
  let text = declText;
  const famStart = text.indexOf('"families": [');
  if (famStart < 0) die('declaration has no "families": [ array to rewrite');
  for (const c of changes) {
    const keyRe = new RegExp(`\\{\\s*"key":\\s*${JSON.stringify(c.key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`, 'g');
    keyRe.lastIndex = famStart;
    const m = keyRe.exec(text);
    if (!m) die(`cannot locate family "${c.key}" in the declaration text`);
    const objStart = m.index;
    // the object ends at the matching close brace
    let depth = 0, i = objStart, inStr = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    const obj = text.slice(objStart, i + 1);
    const re = new RegExp(`("adoption":\\s*)"${c.from}"`);
    if (!re.test(obj)) die(`family "${c.key}": no "adoption": "${c.from}" in its object`);
    text = text.slice(0, objStart) + obj.replace(re, `$1"${c.to}"`) + text.slice(i + 1);
  }
  const after = JSON.parse(text);
  const expect = JSON.parse(declText);
  for (const c of changes) expect.families.find((f) => f.key === c.key && f.anchor === 'core').maturity.adoption = c.to;
  if (JSON.stringify(after) !== JSON.stringify(expect)) die('the in-place rewrite changed more than the adoption values — refusing to write');
  writeFileSync(P.declaration, text);
}

// ---------- §B review rows ----------
const failures = [];
if (mode === 'check') for (const c of changes) failures.push(`§A.1 ${c.key}: declaration says adoption "${c.from}", the bundles derive "${c.to}" (${(witnesses.get(c.key) ?? []).map((h) => h.name).join(', ') || 'no witnessing host'}) — run --write`);

const corrections = readJson(P.corrections, 'corrections.json');
const correctionIds = new Set((corrections.rows ?? []).map((r) => r.id));
const reviewExists = existsSync(P.review);
const review = reviewExists ? readJson(P.review, 'review file') : { rows: [] };
const rows = Array.isArray(review.rows) ? review.rows : [];
if (!Array.isArray(review.rows)) failures.push('§B.1 review file has no rows[] array');

function loadBaseline() {
  const seam = env.OPENWOP_0264_REVIEW_BASELINE;
  if (seam !== undefined && seam !== '') {
    if (seam === 'none') return { rows: null, from: 'none (seam)' };
    if (!existsSync(seam)) die(`OPENWOP_0264_REVIEW_BASELINE ${seam} does not exist (use "none" for no baseline)`);
    return { rows: readJson(seam, 'baseline').rows ?? [], from: seam };
  }
  const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  const ver = (t) => t.slice(1).split('.').map(Number);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const want = String(release.version).split('.').map(Number);
  const tags = (git('tag', '-l', `v${relMajor}.*`).stdout ?? '').split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && cmp(ver(t), want) <= 0).sort((a, b) => cmp(ver(b), ver(a)));
  const tag = tags[0];
  if (!tag) return { rows: null, from: `no published v${relMajor}.* tag at or below ${release.version}` };
  const r = git('show', `${tag}:${REVIEW_REL}`);
  if (r.status !== 0) return { rows: null, from: `${tag} (no ${REVIEW_REL} there)` };
  try { return { rows: JSON.parse(r.stdout).rows ?? [], from: tag }; } catch { return die(`${tag}:${REVIEW_REL} is not JSON`); }
}
const baseline = loadBaseline();
const baseByFamily = new Map((baseline.rows ?? []).map((r) => [r.family, r]));

const minorTuple = (s) => (/^\d+\.\d+$/.test(String(s)) ? String(s).split('.').map(Number) : null);
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
const seen = new Map();
for (const [n, r] of rows.entries()) {
  const at = `row ${n} (${r?.family ?? '?'})`;
  if (typeof r?.family !== 'string') { failures.push(`§B.1 ${at}: no family`); continue; }
  if (seen.has(r.family)) failures.push(`§B.1 ${at}: duplicate row for ${r.family}`);
  seen.set(r.family, r);
  if (derived.get(r.family) !== 'none') failures.push(`§B.2 ${at}: stale — ${derived.has(r.family) ? `derived adoption is ${derived.get(r.family)}` : 'not a core family'}, not none; delete the row`);
  if (r.decision !== 'keep' && r.decision !== 'retire') failures.push(`§B.1 ${at}: decision must be keep or retire, got ${JSON.stringify(r.decision)}`);
  const rb = minorTuple(r.reviewBy);
  if (!rb) failures.push(`§B.1 ${at}: reviewBy must be a corpus minor "<major>.<minor>", got ${JSON.stringify(r.reviewBy)}`);
  for (const k of ['reason', 'plan']) {
    if (!nonEmpty(r[k])) failures.push(`§B.1 ${at}: ${k} is empty`);
    else if (r[k].trim() === 'TODO') failures.push(`§B.1 ${at}: ${k} is still the skeleton's TODO`);
  }
  if (r.decision === 'keep' && rb && (rb[0] < relMajor || (rb[0] === relMajor && rb[1] < relMinor))) failures.push(`§B.2 ${at}: overdue — reviewBy ${r.reviewBy} is below the release minor ${relMajor}.${relMinor}; re-date it with a new reason or plan, or retire the family`);
  if (r.decision === 'retire' && !(nonEmpty(r.correction) && correctionIds.has(r.correction))) failures.push(`§B.4 ${at}: a retire row must name a spec/v2/corrections.json row in "correction"${r.correction ? ` (${r.correction} is not one)` : ''}`);
  const base = baseByFamily.get(r.family);
  if (r.decision === 'keep' && base && base.reviewBy !== r.reviewBy && base.reason === r.reason && base.plan === r.plan) failures.push(`§B.3 ${at}: renewed ${base.reviewBy} → ${r.reviewBy} with reason and plan unchanged since ${baseline.from} — a renewal MUST state a new reason or plan`);
}
for (const k of noneFamilies) if (!seen.has(k)) failures.push(`§B.1 ${k}: derived adoption is none and ${REVIEW_REL} has no row for it${reviewExists ? '' : ' (the file does not exist)'}`);

for (const n of notes) console.error(`  note: ${n}`);
console.error(`  none (${noneFamilies.length}): ${noneFamilies.join(', ') || '—'}`);
console.error(`  review baseline: ${baseline.from}`);
if (mode === 'write') {
  console.log(`=== ${NAME} wrote ${changes.length} adoption value(s) — ${summary} ===`);
  if (failures.length) console.error(`  note: --check will still fail on ${failures.length} review problem(s):\n    ${failures.join('\n    ')}`);
  process.exit(0);
}
if (failures.length) {
  console.error(`=== ${NAME} FAILED — ${failures.length} problem(s); ${summary} ===\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`=== ${NAME} OK — ${summary}; ${rows.length} review row(s) ===`);

#!/usr/bin/env node
/**
 * check-ext-status-coherence — an ext doc's `Status:` is a predicate over
 * evidence (spec/v2/ext/README.md), not a label somebody typed.
 *
 *   Stable  → its family has ≥1 executed-pass row under the family's witness id
 *             in a bundle whose relevant profile claim is certified. Otherwise
 *             FAIL (demote, do not hunt for a bundle).
 *   Draft   → if such a row EXISTS, report GRADUABLE (warning). Evidence the
 *             steward has not acted on is the state the README exists to end.
 *   Retired → the family must be absent from the declaration.
 *
 * Why: 17 ext docs were Draft on the day v2 was tagged and nothing said what
 * moves one. A status that can only go one way is not a status.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'spec', 'v2', 'ext');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const decl = readJson(join(ROOT, 'spec', 'v2', 'declaration.json'));
const fams = Array.isArray(decl.families) ? Object.fromEntries(decl.families.map((f) => [f.key, f])) : decl.families;
const extFamilies = new Map(Object.entries(fams).filter(([, v]) => v && v.anchor === 'ext'));

// certified passing rows: familyKey -> bundle names
const problems = [];
const witnessed = new Map();
const bundlesDir = join(ROOT, 'evidence', 'v2-host-bundles');
for (const f of existsSync(bundlesDir) ? readdirSync(bundlesDir) : []) {
  if (!f.endsWith('.json')) continue;
  let b;
  try { b = readJson(join(bundlesDir, f)); } catch (err) {
    // An unreadable bundle is a finding, not a stack trace — and it must not
    // silently shrink the witnessed set, which would demote a Stable doc.
    problems.push(`${f}: unreadable bundle (${err instanceof Error ? err.message : String(err)})`); continue;
  }
  const certified = (b.claimedProfiles ?? []).some((p) => p && p.certified === true);
  if (!certified) continue;
  const rows = b.results?.requirements ?? [];
  for (const r of Array.isArray(rows) ? rows : Object.values(rows)) {
    const id = r.id ?? r.requirementId ?? '';
    if (r.result !== 'executed-pass') continue;
    const m = /^openwop\.family\.([A-Za-z0-9_-]+)/.exec(id);
    if (m) { if (!witnessed.has(m[1])) witnessed.set(m[1], new Set()); witnessed.get(m[1]).add(f.replace(/\.json$/, '')); }
  }
}

const graduable = []; let checked = 0;
for (const dir of readdirSync(EXT)) {
  const readme = join(EXT, dir, 'README.md');
  if (!existsSync(readme)) continue;
  const text = readFileSync(readme, 'utf8');
  const st = /Status:\s*\**\s*(Draft|Stable|Retired)\b/i.exec(text);
  if (!st) { problems.push(`${dir}: no Status: Draft|Stable|Retired header`); continue; }
  const status = st[1][0].toUpperCase() + st[1].slice(1).toLowerCase();
  const fam = extFamilies.has(dir) ? dir : null;
  if (!fam) {
    if (!/not a (declared )?family|notes?, not a family|outside this rule/i.test(text)) problems.push(`${dir}: no declared ext family and the header does not say it is outside the rule`);
    continue;
  }
  checked++;
  const has = witnessed.has(fam);
  if (status === 'Stable' && !has) problems.push(`${dir}: Stable, but no certified bundle carries an executed-pass row under openwop.family.${fam} — demote to Draft with the date, do not hunt for a bundle`);
  if (status === 'Draft' && has) graduable.push(`${dir} — witnessed by ${[...witnessed.get(fam)].join(', ')}`);
  if (status === 'Retired' && extFamilies.has(fam)) problems.push(`${dir}: Retired, but the family is still declared`);
}
for (const g of graduable) console.warn(`  GRADUABLE (Draft with certified evidence — act on it): ${g}`);
if (problems.length) { console.error(`=== check-ext-status-coherence FAILED — ${problems.length} problem(s):`); for (const p of problems) console.error(`  ${p}`); process.exit(1); }
console.log(`=== check-ext-status-coherence OK — ${checked} ext doc(s) checked against ${witnessed.size} certified-witnessed famil(y/ies); ${graduable.length} graduable ===`);

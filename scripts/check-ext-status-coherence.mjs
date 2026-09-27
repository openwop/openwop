#!/usr/bin/env node
/**
 * check-ext-status-coherence — an ext doc's `Status:` is a predicate over
 * evidence (spec/v2/ext/README.md), not a label somebody typed.
 *
 *   Stable  → its family has ≥1 executed-pass row under `openwop.family.<key>`
 *             in a bundle that certifies a profile AND whose discovery origin
 *             is tier 2 or better in evidence/host-tiers.json (RFC 0220 §D).
 *             Otherwise FAIL (demote, do not hunt for a bundle). The declaration
 *             row MUST then say `technical: stable`, and a Draft row MUST NOT.
 *   Draft   → if such a row EXISTS, report GRADUABLE (warning). Evidence the
 *             steward has not acted on is the state the README exists to end.
 *             A row witnessed only at tier 1 is reported too, as NOT YET — a
 *             steward host cannot graduate a family alone.
 *   Retired → the family must be absent from the declaration.
 *   Note    → only a directory with no declared family, and it says so
 *             (RFC 0220 §E). A note is outside the rule; a family is never one.
 *
 * Why: 17 ext docs were Draft on the day v2 was tagged and nothing said what
 * moves one. A status that can only go one way is not a status. And until
 * RFC 0220 the tier half of the README's predicate was prose only: any
 * certified bundle — a loopback reference host included — would have passed.
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

const problems = [];
const tiers = new Map();
const tierFile = join(ROOT, 'evidence', 'host-tiers.json');
if (!existsSync(tierFile)) problems.push('evidence/host-tiers.json is missing — the tier half of the Stable predicate cannot be applied');
else for (const h of readJson(tierFile).hosts ?? []) {
  if (!Number.isInteger(h.tier) || h.tier < 1 || h.tier > 3) { problems.push(`evidence/host-tiers.json: ${h.name}: tier must be 1, 2 or 3`); continue; }
  for (const o of h.origins ?? []) tiers.set(o, h.tier);
}
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

// certified passing rows: familyKey -> bundle names, split by tier
const qualifying = new Map();
const tierOneOnly = new Map();
const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
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
  const origin = originOf(b.discovery?.url ?? '');
  const tier = origin ? tiers.get(origin) ?? 0 : 0;
  const name = `${f.replace(/\.json$/, '')} (${origin ?? 'no discovery.url'}, tier ${tier || 'unknown'})`;
  const rows = b.results?.requirements ?? [];
  for (const r of Array.isArray(rows) ? rows : Object.values(rows)) {
    const id = r.id ?? r.requirementId ?? '';
    if (r.result !== 'executed-pass') continue;
    const m = /^openwop\.family\.([A-Za-z0-9_-]+)$/.exec(id);
    if (!m) continue;
    add(tier >= 2 ? qualifying : tierOneOnly, m[1], name);
  }
}

const graduable = []; const notYet = []; let checked = 0; let notes = 0;
for (const dir of readdirSync(EXT)) {
  const readme = join(EXT, dir, 'README.md');
  if (!existsSync(readme)) continue;
  const text = readFileSync(readme, 'utf8');
  const st = /Status:\s*\**\s*(Draft|Stable|Retired|Note)\b/i.exec(text);
  if (!st) { problems.push(`${dir}: no Status: Draft|Stable|Retired|Note header`); continue; }
  const status = st[1][0].toUpperCase() + st[1].slice(1).toLowerCase();
  const fam = extFamilies.has(dir) ? dir : null;
  if (!fam) {
    if (status !== 'Note' && status !== 'Retired') problems.push(`${dir}: no declared ext family, so its status is Note, not ${status} — a note is outside the maturity rule and a Draft label promises a graduation it can never have (RFC 0220 §E)`);
    if (status === 'Note' && !/not a (declared )?(extension )?family|notes?, not a family|outside this rule/i.test(text)) problems.push(`${dir}: a Note MUST say it is not a declared family`);
    notes++;
    continue;
  }
  if (status === 'Note') { problems.push(`${dir}: a declared family is Draft, Stable or Retired — never Note (RFC 0220 §E)`); continue; }
  checked++;
  const has = qualifying.has(fam);
  const technical = extFamilies.get(fam).maturity?.technical;
  if (status === 'Stable' && !has) problems.push(`${dir}: Stable, but no certified tier-2+ bundle carries an executed-pass row under openwop.family.${fam}${tierOneOnly.has(fam) ? ` (tier-1 only: ${[...tierOneOnly.get(fam)].join(', ')})` : ''} — demote to Draft with the date, do not hunt for a bundle`);
  if (status === 'Stable' && technical !== 'stable') problems.push(`${dir}: Stable, but the declaration row says technical: ${technical} — a promotion moves both`);
  if (status === 'Draft' && technical === 'stable') problems.push(`${dir}: Draft, but the declaration row says technical: stable`);
  if (status === 'Draft' && has) graduable.push(`${dir} — witnessed by ${[...qualifying.get(fam)].join(', ')}`);
  if (status === 'Draft' && !has && tierOneOnly.has(fam)) notYet.push(`${dir} — tier-1 only: ${[...tierOneOnly.get(fam)].join(', ')}`);
  if (status === 'Retired' && extFamilies.has(fam)) problems.push(`${dir}: Retired, but the family is still declared`);
}
for (const g of graduable) console.warn(`  GRADUABLE (Draft with tier-2+ certified evidence — act on it): ${g}`);
for (const n of notYet) console.warn(`  NOT YET (witnessed, but no tier-2+ host): ${n}`);
if (problems.length) { console.error(`=== check-ext-status-coherence FAILED — ${problems.length} problem(s):`); for (const p of problems) console.error(`  ${p}`); process.exit(1); }
console.log(`=== check-ext-status-coherence OK — ${checked} ext famil(y/ies) checked, ${notes} note(s); ${qualifying.size} tier-2+ witnessed, ${tierOneOnly.size} tier-1 only; ${graduable.length} graduable ===`);

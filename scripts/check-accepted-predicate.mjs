#!/usr/bin/env node
/**
 * RFC 0174 §B.1 — `Active → Accepted` is a machine predicate for v2-era RFCs
 * (RFC ≥ 0167; v1.x RFCs are grandfathered as recorded). For every such RFC
 * whose Status is Accepted:
 *   1. every acceptance-criteria box is ticked or carries a stated reason;
 *   2. no `open` gap row in its register (RFC 0166);
 *   3. the Updated field names an evidence tier (GOVERNANCE §"Acceptance
 *      evidence tiers") or the label `corpus gate` (RFC 0168 / Phase 3 plan);
 *   4. every requirement id its falsifiability table names has at least one
 *      executed-pass row in a cited host bundle or in evidence/corpus-ledger.json
 *      (the corpus ledger check-spec-coherence.mjs emits — P3-E); a `(corpus)`
 *      verdict row is satisfied by the corpus ledger only.
 * Green with "0 v2 Accepted RFCs" today; the predicate exists so the first flip
 * runs through it.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RFCS = join(ROOT, 'RFCS');
const ledgerPath = join(ROOT, 'evidence', 'corpus-ledger.json');
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { requirements: {} };
const failures = [];
// Verdict cells that declare a witness class no `executed-pass` can ever have.
const DECLARED_VERDICT = /seam-gated|negative[- ]existence|unwitnessable|witnessable\s*—\s*gated|host-pending/i;
const hostGaps = [];
// Every requirement id any v2-era RFC declares in its Falsifiability table. A
// row id under a parent (`<id>.<leg>`) witnesses the parent ONLY when it is a
// leg — not when it is itself a declared requirement: two real pairs exist
// (0168 bundle-signature-attributable ⊂ .v1-root, 0176 well-known-one-resource
// ⊂ .v2-representation), and a pass on the refinement must not stand in for
// the base's own scenario.
const declaredIds = new Set();
for (const f of readdirSync(RFCS).filter((n) => /^\d{4}-.*\.md$/.test(n))) {
  if (Number(f.slice(0, 4)) < 167) continue;
  const t = readFileSync(join(RFCS, f), 'utf8').split(/### Falsifiability/)[1]?.split(/^## /m)[0] ?? '';
  for (const row of t.split('\n')) if (row.startsWith('| §') || row.startsWith('| `openwop.requirement')) for (const m of row.matchAll(/openwop\.requirement\.[a-z0-9.-]+/g)) declaredIds.add(m[0]);
}
// every requirement id with an executed-pass row in any committed host bundle
const bundleRows = new Set();
const uncertified = [];
const accountedRows = new Map();
{
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'v2-host-bundles');
  if (existsSync(dir)) for (const b of readdirSync(dir)) {
    if (!b.endsWith('.json')) continue;
    const doc = JSON.parse(readFileSync(join(dir, b), 'utf8'));
    // §B.1 says "a CITED bundle". The old reader took an executed-pass row from
    // any file in this directory, certified or not — so a bundle whose own
    // profile claims read `certified: false` (one blocked row is enough, RFC
    // 0168 §E.1) supplied acceptance witnesses exactly like a certified one.
    // An acceptance may not rest on evidence the evidence format itself refuses.
    const profiles = doc.claimedProfiles ?? [];
    if (profiles.length === 0 || !profiles.every((p) => p.certified === true)) {
      uncertified.push(`${b} (${profiles.filter((p) => !p.certified).map((p) => p.id).join(', ') || 'no claimed profiles'})`);
      continue;
    }
    const rows = doc.results?.requirements ?? [];
    for (const r of Array.isArray(rows) ? rows : Object.values(rows)) {
      const rid = r.id ?? r.requirementId;
      if (r.result === 'executed-pass') bundleRows.add(rid);
      // §B.1's second branch: a row the suite REACHED and recorded a reason for
      // accounts for a declared non-executable verdict. Silence never does.
      else if (typeof r.detail === 'string' && r.detail.trim() !== '') accountedRows.set(rid, `${r.result} — ${r.detail.trim()}`);
    }
  }
} let checked = 0;
for (const f of readdirSync(RFCS).filter((n) => /^\d{4}-.*\.md$/.test(n)).sort()) {
  const n = Number(f.slice(0, 4)); if (n < 167) continue;
  const text = readFileSync(join(RFCS, f), 'utf8');
  const status = (/\|\s*\*\*Status\*\*\s*\|\s*`([^`]+)`/.exec(text) ?? [])[1];
  if (status !== 'Accepted') continue;
  checked++;
  const acc = text.split(/^## Acceptance criteria/m)[1]?.split(/^## /m)[0] ?? '';
  // `Phase 4` was in this escape and read the NAME OF A BLOCKER as an excuse:
  // RFC 0179's only criterion is "openwop-app advertises it (Phase 4 leg)…",
  // unticked and unmet, and the gate called it satisfied. An escape must be an
  // explicit, labelled statement — `reason:` or `deferred:` — never a phase.
  for (const line of acc.split('\n')) if (/^- \[ \]/.test(line) && !/\b(reason|deferred):/i.test(line)) failures.push(`${f}: unticked acceptance box without a stated reason — ${line.trim().slice(0, 100)}`);
  // Table-format acceptance sections (`| # | Criterion | Evidence |`) were never
  // inspected — RFC 0184 flipped to Accepted with nine table rows and zero
  // checkboxes, so rule 1 was vacuously satisfied. A table row is ticked when
  // its Evidence cell names something; an empty, `—`, `TBD` or `pending` cell
  // is an unticked box.
  const tableRows = acc.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
  for (const row of tableRows) {
    const cells = row.split('|').map((c) => c.trim()); // ['', n, criterion, evidence, '']
    const evidence = cells[3] ?? '';
    if (!evidence || /^(—|-|TBD|pending|n\/a)$/i.test(evidence)) failures.push(`${f}: acceptance table row ${cells[1]} has no evidence (${JSON.stringify(cells[2]?.slice(0, 60))})`);
  }
  if (!acc.trim() || (tableRows.length === 0 && !/^- \[/m.test(acc))) failures.push(`${f}: Acceptance criteria section is empty or has neither checkboxes nor a table`);
  const reg = readdirSync(join(RFCS, 'registers')).find((r) => r.startsWith(f.slice(0, 4)) && r.endsWith('.gaps.md'));
  if (reg && /\|\s*`open`/.test(readFileSync(join(RFCS, 'registers', reg), 'utf8'))) failures.push(`${f}: register carries an open gap`);
  const updated = (/\|\s*\*\*Updated\*\*\s*\|([^\n]*)/.exec(text) ?? [, ''])[1];
  // Anchored to the DECLARATION, not the word. The old pattern matched any
  // prose mentioning a tier — RFC 0180 cleared this rule on the narrative
  // clause "Raised by the tier-1 host against its own malformed types", having
  // declared no tier at all. GOVERNANCE §"Acceptance evidence tiers" names the
  // label; the RFC must state it.
  if (!/Evidence tier:\s*\**\s*(tier-[123]|corpus gate)/i.test(updated)) failures.push(`${f}: Updated declares no evidence tier — write \`Evidence tier: tier-N — <label>\` or \`Evidence tier: corpus gate — …\` (GOVERNANCE §"Acceptance evidence tiers")`);
  const table = text.split(/### Falsifiability/)[1]?.split(/^## /m)[0] ?? '';
  // Rule 4 iterated ids and therefore passed VACUOUSLY for an RFC that named
  // none: five of the fourteen Active RFCs had no Falsifiability section or a
  // table with no ids in it, including the umbrella RFC 0167 — the largest flip
  // in the program. "At least one executed-pass row for each id the table
  // names" is trivially true of zero ids, which is not what §B.1 means.
  // A row is CHECKED when it names a requirement id (rule 4 then looks it up)
  // and DECLARED when its verdict says why no id can witness it. A row that is
  // neither is unchecked and unadmitted — the gate says nothing about it, and
  // said nothing about the whole of RFC 0167, 0180, 0185 and 0186.
  if (!table.trim()) failures.push(`${f}: no \`### Falsifiability\` section — rule 4 has nothing to check (RFC 0174 §B.1, RFC 0178 §C.1)`);
  const VERDICT = /witnessable|gated|corpus gate|not probed|negative[- ]existence|unwitnessable|host-pending|inspection|suite review/i;
  for (const row of table.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-{2,}/.test(l) && !/^\|\s*(Requirement|§?\s*Requirement)\b/i.test(l))) {
    if (/openwop\.requirement\./.test(row) || VERDICT.test(row)) continue;
    failures.push(`${f}: Falsifiability row is neither id-witnessed nor verdict-declared — ${row.trim().slice(0, 90)}`);
  }
  for (const row of table.split('\n').filter((l) => l.startsWith('| §') || l.startsWith('| `openwop.requirement'))) {
    const ids = [...row.matchAll(/openwop\.requirement\.[a-z0-9.-]+/g)].map((m) => m[0]);
    const corpus = /\(corpus\)/.test(row);
    for (const id of ids) {
      if (!corpus) {
        // A Falsifiability row names the requirement; the scenarios mint it as
        // that id OR as suffixed legs (`<id>.<leg>` — capability-record-shape
        // is witnessed as .required-fields / .until-iff-not-stable / .until-not-past
        // on every committed bundle). An exact-key lookup reported those three
        // RFC 0169 ids as unwitnessed for four days while every bundle carried
        // them. A parent is witnessed when it or any leg under it passes.
        const witnessed = (rowId) => rowId === id || (rowId.startsWith(`${id}.`) && !declaredIds.has(rowId));
        const inLedger = Object.entries(ledger.requirements ?? {}).some(([k, rows]) => witnessed(k) && rows.some((r) => r.result === 'executed-pass'));
        const inBundle = [...bundleRows].some(witnessed);
        // RFC 0174 §B.1 rule 4, second branch. A row whose VERDICT declares a
        // non-executable witness class is accounted for by a non-pass bundle row
        // that states a reason — the suite reached the leg and said why. Without
        // this, the honest move (declare the verdict) and the checkable move
        // (name an id) are in conflict, and the only way out is a vacuous leg.
        // Measured: RFC 0177 §E.4's form-when id carries `inapplicable` +
        // "profile not advertised in the captured discovery set", which §G.2
        // accepts, and rule 4 refused the flip anyway.
        const declared = DECLARED_VERDICT.test(row);
        const accounted = declared && [...accountedRows.keys()].some(witnessed);
        if (!inLedger && !inBundle && !accounted) {
          hostGaps.push(`${f.slice(0, 4)} ${id}${declared ? ' (verdict declares a non-executable class, but NO bundle row accounts for it — the suite must reach the leg and record a reason)' : ''}`);
        }
      }
    }
    for (const id of ids) { const rows = ledger.requirements?.[id]; if (corpus && !rows?.some((r) => r.result === 'executed-pass')) failures.push(`${f}: ${id} has no executed-pass row in evidence/corpus-ledger.json`); }
  }
}
const hostGapsUnique = [...new Set(hostGaps)];
if (hostGapsUnique.length) {
  // RFC 0174 §B.1 rule 4 names host bundles as well as the ledger. A failure
  // since 2.3.2 (gap-closure W5): every Accepted RFC's host-tier id is
  // witnessed on a committed bundle today, so a new gap is a real one — an
  // RFC accepted on a witness no host has produced, or a bundle re-cut that
  // lost a row. Either is the thing this gate exists to refuse.
  failures.push(`host-tier requirement ids with no executed-pass row in the ledger OR any committed bundle (RFC 0174 §B.1 rule 4): ${hostGapsUnique.join(', ')}`);
}
// RFC 0174 §B.1 closes with "for a program child, the parent `Active`", and RFC
// 0167 §"Children" says the umbrella flips "when every child is `Accepted`".
// Nothing implemented either. Taken literally the first rule is a TRAP: the
// moment the parent flips `Accepted` it stops being `Active`, and every child
// still `Active` becomes permanently ineligible with no path back short of
// amending §B.1. So the checkable form of both sentences is one rule — the
// parent flips LAST — and it is the one enforced here.
{
  const statusOf = new Map(); const parentOf = new Map();
  for (const f of readdirSync(RFCS).filter((n) => /^\d{4}-.*\.md$/.test(n))) {
    const t = readFileSync(join(RFCS, f), 'utf8');
    statusOf.set(f.slice(0, 4), (/\|\s*\*\*Status\*\*\s*\|\s*`([^`]+)`/.exec(t) ?? [])[1]);
    const m = /Part of:\s*RFC\s*(\d{4})/.exec(t);
    if (m) parentOf.set(f.slice(0, 4), m[1]);
  }
  for (const [parent] of [...new Set(parentOf.values())].map((p) => [p])) {
    if (statusOf.get(parent) !== 'Accepted') continue;
    const stragglers = [...parentOf.entries()].filter(([c, p]) => p === parent && statusOf.get(c) === 'Active').map(([c]) => c);
    if (stragglers.length) failures.push(`RFC ${parent} is Accepted while its program children are still Active (${stragglers.join(', ')}) — the parent flips LAST, or those children can never satisfy §B.1's parent rule`);
  }
  for (const [child, parent] of parentOf) {
    if (statusOf.get(child) !== 'Accepted') continue;
    if (!['Active', 'Accepted'].includes(statusOf.get(parent) ?? '')) failures.push(`RFC ${child} is Accepted under parent RFC ${parent}, which is \`${statusOf.get(parent)}\` — §B.1 requires the parent Active at the flip`);
  }
}
if (uncertified.length) console.error(`  note: ${uncertified.length} bundle(s) supply no acceptance witness because they are not certified — ${uncertified.join('; ')}`);
if (failures.length) { console.error('=== check-accepted-predicate FAILED ===\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`=== check-accepted-predicate OK — ${checked} v2-era Accepted RFC(s) satisfy RFC 0174 §B.1 ===`);

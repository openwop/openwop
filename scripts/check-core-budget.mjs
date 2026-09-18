#!/usr/bin/env node
/**
 * RFC 0190 §A — the kernel budget, superseding RFC 0174 §E.2/§E.2a.
 *
 * ## What changed, and why the old shape could not hold
 *
 * §E.2 measured `spec/v2/core/*.md`, non-recursively, against a flat 25,000.
 * Two things were wrong with that, and RFC 0189 made both load-bearing by
 * requiring all 72 core families to declare a normative home before v1
 * end-of-support:
 *
 * 1. THE DENOMINATOR DID NOT FOLLOW THE GATE'S ACCEPTANCE. check-v2-normative-
 *    home.mjs accepts `spec/v2/ext/**` as a home for a CORE family, and this
 *    script never counted it — so a family's entire contract could move to
 *    `ext/` and resolve at zero budget cost, with no stub left in `core/` at
 *    all. `readdirSync` (not a recursive walk) meant `spec/v2/core/<sub>/x.md`
 *    was the same hole one directory shallower. Nobody had to intend this: it
 *    was simply the cheapest way to satisfy the gate.
 * 2. THE NUMBER WAS SET AGAINST THE WRONG DENOMINATOR. §E.2a rejected raising
 *    the ceiling on 2026-09-17, reasoning that "16 core RFCs have landed
 *    against it, and the near-miss came from hurry, not from the number". RFC
 *    0189 was created the next day and turned 61 undeclared families into dated
 *    work. Measured against the four families actually written (563 words over
 *    five sections: forms 101, idempotency 107, eventLog 214, packs 141 — mean
 *    140.75), the remaining families need on the order of 9,450 words. The
 *    ceiling had 164. The rejection's stated basis was falsified by information
 *    that did not exist when it was made.
 *
 * ## The rule
 *
 * MEASURED SET — every document a `core`-anchored family's `normativeText[]`
 * points at: `spec/v2/core/**` recursively, plus any `spec/v2/ext/**` document
 * cited by a core family. Where a family's prose is FILED is an editorial
 * decision with no budget consequence, so there is no incentive to stub, and no
 * author has to answer "is this the base contract or a facet detail?" — a
 * question no gate could check. An ext document no core family cites stays
 * unbudgeted, correctly: it is the unwitnessed tail (RFC 0174 §E.2), not kernel.
 *
 * CAP — `25,000 + 200 × (core families with a resolved v2 home − 9)`, where 9
 * is the count of v2-resolved families at RFC 0190 (v1-dependent families are
 * NOT counted: they still owe v2 text, and counting them would grant words for
 * work not yet done). The budget grows ONLY as debt is retired, and words
 * arrive only when a family actually passes the §B predicate AND the
 * facetsUncovered ratchet, so a cheap declaration is not cheap. At 72/72 the cap
 * freezes at 37,600 and the forcing function returns permanently. 200 against a
 * measured mean of 140.75 is 42% margin; against the ~9,450 model it grants
 * 12,600 for ~9,170 — enough to land `agents` (19 facets) and `aiProviders` (12),
 * tight enough to still bite. The cap is SELF-FUNDING: each family grants 200 and
 * costs ~141, so declaring one leaves ~59 more than before. That is what makes a
 * 164-word starting headroom sufficient to bootstrap, and it forces cheap-first
 * ordering — an expensive family waits until cheaper ones have funded it.
 *
 * The invariant being protected is unchanged and is why a per-document cap was
 * not chosen: an implementer can read the entire front door in one sitting.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'spec', 'v2', 'core');
const BASE = 25_000;
const PER_FAMILY = 200;
const HOMED_AT_0190 = 9;

if (!existsSync(DIR)) { console.log('=== check-core-budget — spec/v2/core/ does not exist yet (0 words of a 25,000 budget; nothing measured) ==='); process.exit(0); }

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = join(d, e.name);
  return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
});

// Every ext document a CORE family declares as a home. Read from the
// declaration, so the measured set is exactly what the home gate accepts.
const declPath = join(ROOT, 'spec', 'v2', 'declaration.json');
let extHomes = [], homed = 0;
if (existsSync(declPath)) {
  const decl = JSON.parse(readFileSync(declPath, 'utf8'));
  for (const f of decl.families ?? []) {
    if (f.anchor !== 'core') continue;
    const homes = f.normativeText;
    if (!Array.isArray(homes) || homes.length === 0) continue;
    if (!homes.some((h) => h.startsWith('spec/v1/'))) homed += 1;
    for (const h of homes) {
      if (h.startsWith('spec/v2/ext/') && existsSync(join(ROOT, h)) && !extHomes.includes(h)) extHomes.push(h);
    }
  }
}

const files = [...walk(DIR), ...extHomes.map((h) => join(ROOT, h))];
const rows = files
  .map((p) => [relative(join(ROOT, 'spec', 'v2'), p), readFileSync(p, 'utf8').split(/\s+/).filter(Boolean).length])
  .sort((a, b) => a[0].localeCompare(b[0]));
const total = rows.reduce((n, [, w]) => n + w, 0);
const BUDGET = BASE + PER_FAMILY * Math.max(0, homed - HOMED_AT_0190);

for (const [f, w] of rows) console.log(`  ${String(w).padStart(6)}  ${f}`);
console.log(`  cap ${BUDGET.toLocaleString()} = ${BASE.toLocaleString()} + ${PER_FAMILY} x (${homed} homed - ${HOMED_AT_0190} at RFC 0190)`);
if (total > BUDGET) {
  console.error(`=== check-core-budget FAILED — the measured kernel is ${total.toLocaleString()} words; cap ${BUDGET.toLocaleString()} (RFC 0190 §A). ${extHomes.length} ext document(s) counted because a core family declares them. ===`);
  process.exit(1);
}
console.log(`=== check-core-budget OK — ${total.toLocaleString()} / ${BUDGET.toLocaleString()} words across ${rows.length} document(s)${extHomes.length ? ` (incl. ${extHomes.length} ext home(s) cited by a core family)` : ''} ===`);

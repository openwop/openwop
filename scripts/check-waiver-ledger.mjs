#!/usr/bin/env node
/**
 * check-waiver-ledger — the bootstrap-waiver ledger must not drift from the tree.
 *
 * `MAINTAINERS.md` §"Bootstrap-phase RFC waivers" says it "tracks every RFC that
 * has used the waiver so future maintainers can audit the velocity of
 * bootstrap-phase decisions." On 2026-08-20 it held **26 rows against 41 derived
 * from the tree** — the twenty-one absent included RFC 0147 and all three of its
 * Workstream 1–3 children, which is to say the entire program spine was missing
 * from the surface that exists to make waivers auditable.
 *
 * That is this corpus's recurring defect applied to governance: the artifact
 * reports, but not on what its reader assumes it measured.
 *
 * The ledger is NOT generated. Its `Waiver rationale` column is human judgement
 * that no script can derive, and replacing it with a machine summary would trade
 * a drifting-but-informative record for a current-but-empty one. Instead this
 * gate holds the two in agreement: every RFC the tree shows as waived must appear
 * in the ledger, in one of its two tables.
 *
 * Derivation is deliberately identical to `generate-assurance-status.mjs` — the
 * literal `comment window waived` — so the two surfaces cannot disagree about
 * what a waiver is.
 *
 * Exit 0 when they agree; 1 with the missing set when they do not.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** RFCs the tree shows as having used the waiver. */
function derived() {
  const dir = join(ROOT, 'RFCS');
  return readdirSync(dir)
    .filter((x) => /^\d{4}-.*\.md$/.test(x))
    .sort()
    .filter((f) => /comment window waived/i.test(readFileSync(join(dir, f), 'utf8')))
    .map((f) => f.slice(0, 4));
}

/** RFC numbers appearing as a row in any ledger table in MAINTAINERS.md. */
function ledgered() {
  const md = readFileSync(join(ROOT, 'MAINTAINERS.md'), 'utf8');
  const start = md.indexOf('## Bootstrap-phase RFC waivers');
  if (start === -1) {
    console.error('check-waiver-ledger: MAINTAINERS.md has no §"Bootstrap-phase RFC waivers".');
    process.exit(1);
  }
  // The section runs to the next H2, or to EOF.
  const rest = md.slice(start + 1);
  const nextH2 = rest.indexOf('\n## ');
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2);
  return new Set([...section.matchAll(/^\|\s*(\d{4})\s*\|/gm)].map((m) => m[1]));
}

const tree = derived();
const rows = ledgered();
const missing = tree.filter((n) => !rows.has(n));

console.log(`=== check-waiver-ledger — MAINTAINERS.md vs the tree ===`);
console.log(`  derived from RFCS/: ${tree.length}`);
console.log(`  rows in the ledger: ${rows.size}`);

if (missing.length > 0) {
  console.error(`\nFAILED: ${missing.length} waived RFC(s) are absent from the ledger:\n`);
  console.error('  ' + missing.join(', ') + '\n');
  console.error('The ledger exists so waivers can be audited. An RFC that used the waiver');
  console.error('and is not listed is invisible to that audit — which is the failure this');
  console.error('gate was added to prevent (see docs/WAIVER-AUDIT-2026-08-20.md §3.2).');
  console.error('\nAdd a row under §"Bootstrap-phase RFC waivers". If the rationale is not');
  console.error("known, say so in the column rather than inventing one; an honest \"not\"");
  console.error('recorded at the time" is worth more than a plausible reconstruction.');
  process.exit(1);
}

console.log(`\n=== check-waiver-ledger OK — every waived RFC is in the ledger ===`);

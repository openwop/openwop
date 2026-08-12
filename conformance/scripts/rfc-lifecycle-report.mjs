#!/usr/bin/env node
/**
 * rfc-lifecycle-report — measure whether RFC acceptance-criteria checkboxes are
 * a maintained signal, which decides whether RFC 0149 §D's lifecycle gate can
 * be built on them.
 *
 * §D proposes failing the corpus generator "when an `Accepted` RFC retains an
 * unresolved acceptance blocker not explicitly carried to a register/known-limit".
 * The obvious implementation reads the `- [ ]` boxes under §"Acceptance criteria".
 * Whether that works is an empirical question about 141 Accepted RFCs, and
 * UQ4 asks it directly: which stale statements are intentional historical notes
 * rather than defects?
 *
 * Read-only. Prints a report; writes nothing. Run from the repo root:
 *
 *   node conformance/scripts/rfc-lifecycle-report.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RFCS_DIR = join(REPO_ROOT, 'RFCS');

/** Per-RFC checkbox tally, split by whether the box sits under an Acceptance heading. */
function tally(raw) {
  let section = '';
  let acceptedUnchecked = 0;
  let acceptedChecked = 0;
  let otherUnchecked = 0;
  for (const line of raw.split('\n')) {
    if (/^## /.test(line)) section = line.replace(/^##\s*/, '').trim().toLowerCase();
    const inAcceptance = section.includes('acceptance');
    if (/^- \[ \] /.test(line)) {
      if (inAcceptance) acceptedUnchecked++;
      else otherUnchecked++;
    } else if (/^- \[[xX]\] /.test(line)) {
      if (inAcceptance) acceptedChecked++;
    }
  }
  return { acceptedUnchecked, acceptedChecked, otherUnchecked };
}

function report() {
  if (!existsSync(RFCS_DIR)) {
    console.log('RFCS/ not present (published layout) — nothing to measure.');
    return;
  }
  const buckets = { none: [], zero: [], partial: [], complete: [] };
  let accepted = 0;

  for (const file of readdirSync(RFCS_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
    const raw = readFileSync(join(RFCS_DIR, file), 'utf8');
    const status = /\|\s*\*\*Status\*\*\s*\|\s*`?([A-Za-z]+)`?/.exec(raw)?.[1];
    if (status !== 'Accepted') continue;
    accepted++;
    const t = tally(raw);
    const total = t.acceptedUnchecked + t.acceptedChecked;
    if (total === 0) buckets.none.push(file);
    else if (t.acceptedChecked === 0) buckets.zero.push(file);
    else if (t.acceptedUnchecked === 0) buckets.complete.push(file);
    else buckets.partial.push(`${file} (${t.acceptedChecked} ticked, ${t.acceptedUnchecked} not)`);
  }

  const pct = (n) => `${((n / accepted) * 100).toFixed(0)}%`;
  console.log('=== rfc-lifecycle-report (RFC 0149 §D / UQ4) ===\n');
  console.log(`Accepted RFCs: ${accepted}\n`);
  console.log(`  all acceptance boxes ticked   ${String(buckets.complete.length).padStart(4)}  ${pct(buckets.complete.length)}  signal maintained`);
  console.log(`  SOME ticked, some not         ${String(buckets.partial.length).padStart(4)}  ${pct(buckets.partial.length)}  <- the triage set`);
  console.log(`  boxes present, NONE ticked    ${String(buckets.zero.length).padStart(4)}  ${pct(buckets.zero.length)}  signal never used`);
  console.log(`  no acceptance checkboxes      ${String(buckets.none.length).padStart(4)}  ${pct(buckets.none.length)}`);

  console.log('\n--- the triage set: someone was ticking and stopped ---');
  for (const p of buckets.partial) console.log(`  ${p}`);
}

report();

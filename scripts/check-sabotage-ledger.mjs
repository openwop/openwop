#!/usr/bin/env node
/**
 * RFC 0263: run the sabotage-ledger rules (§A ids named, §B ledger shape,
 * §C red row before Accepted) over an RFC directory and a ledger. The code is
 * the same code `check-accepted-predicate.mjs` rules 5 and 6 run
 * (scripts/lib/sabotage-ledger.mjs).
 *
 *   node scripts/check-sabotage-ledger.mjs [--rfcs <dir>] [--ledger <file>] [--bundles <dir>]
 *
 * Exit 0 when no rule fails, 1 otherwise. The coherence scenario
 * `v2-sabotage-ledger.test.ts` drives it on fixture directories.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { idRuleFailures, ledgerShapeFailures, sabotageRuleFailures } from './lib/sabotage-ledger.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? resolve(argv[i + 1]) : d; };
const rfcs = opt('--rfcs', join(ROOT, 'RFCS'));
const ledgerPath = opt('--ledger', join(ROOT, 'evidence', 'sabotage-ledger.json'));
const bundles = opt('--bundles', join(ROOT, 'evidence', 'v2-host-bundles'));

const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { rows: [] };
const certified = new Set();
if (existsSync(bundles)) for (const f of readdirSync(bundles).filter((n) => n.endsWith('.json'))) {
  try {
    const b = JSON.parse(readFileSync(join(bundles, f), 'utf8'));
    const p = b.claimedProfiles ?? [];
    if (p.length > 0 && p.every((x) => x.certified === true) && typeof b.witnessSha256 === 'string') certified.add(b.witnessSha256);
  } catch { /* unreadable bundles are another gate's finding */ }
}

const failures = [...ledgerShapeFailures(ledger, certified)];
let checked = 0;
for (const f of readdirSync(rfcs).filter((n) => /^\d{4}-.*\.md$/.test(n)).sort()) {
  const text = readFileSync(join(rfcs, f), 'utf8');
  const status = (/\|\s*\*\*Status\*\*\s*\|\s*`([^`]+)`/.exec(text) ?? [])[1];
  failures.push(...idRuleFailures(f, status, text), ...sabotageRuleFailures(f, status, text, ledger));
  if (Number(f.slice(0, 4)) >= 258 && ['Active', 'Accepted'].includes(status)) checked++;
}
if (failures.length) { console.error(`=== check-sabotage-ledger FAILED — ${failures.length} problem(s) ===\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`=== check-sabotage-ledger OK — ${checked} RFC(s) from 0258 checked; ${(ledger.rows ?? []).length} ledger row(s) ===`);

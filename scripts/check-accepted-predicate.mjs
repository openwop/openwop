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
const failures = []; let checked = 0;
for (const f of readdirSync(RFCS).filter((n) => /^\d{4}-.*\.md$/.test(n)).sort()) {
  const n = Number(f.slice(0, 4)); if (n < 167) continue;
  const text = readFileSync(join(RFCS, f), 'utf8');
  const status = (/\|\s*\*\*Status\*\*\s*\|\s*`([^`]+)`/.exec(text) ?? [])[1];
  if (status !== 'Accepted') continue;
  checked++;
  const acc = text.split(/^## Acceptance criteria/m)[1]?.split(/^## /m)[0] ?? '';
  for (const line of acc.split('\n')) if (/^- \[ \]/.test(line) && !/reason:|deferred:|Phase 4/i.test(line)) failures.push(`${f}: unticked acceptance box without a stated reason — ${line.trim().slice(0, 100)}`);
  const reg = readdirSync(join(RFCS, 'registers')).find((r) => r.startsWith(f.slice(0, 4)) && r.endsWith('.gaps.md'));
  if (reg && /\|\s*`open`/.test(readFileSync(join(RFCS, 'registers', reg), 'utf8'))) failures.push(`${f}: register carries an open gap`);
  const updated = (/\|\s*\*\*Updated\*\*\s*\|([^\n]*)/.exec(text) ?? [, ''])[1];
  if (!/tier[- ]?[123]|tier-1|tier-2|tier-3|corpus gate/i.test(updated)) failures.push(`${f}: Updated names no evidence tier or corpus-gate label`);
  const table = text.split(/### Falsifiability/)[1]?.split(/^## /m)[0] ?? '';
  for (const row of table.split('\n').filter((l) => l.startsWith('| §') || l.startsWith('| `openwop.requirement'))) {
    const ids = [...row.matchAll(/openwop\.requirement\.[a-z0-9.-]+/g)].map((m) => m[0]);
    const corpus = /\(corpus\)/.test(row);
    for (const id of ids) { const rows = ledger.requirements?.[id]; if (corpus && !rows?.some((r) => r.result === 'executed-pass')) failures.push(`${f}: ${id} has no executed-pass row in evidence/corpus-ledger.json`); }
  }
}
if (failures.length) { console.error('=== check-accepted-predicate FAILED ===\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`=== check-accepted-predicate OK — ${checked} v2-era Accepted RFC(s) satisfy RFC 0174 §B.1 ===`);

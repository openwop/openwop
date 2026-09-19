#!/usr/bin/env node
/**
 * check-registers — RFC 0166 §A.2: every gap and risk register row carries a
 * disposition token; `carried:` ids exist in spec/v1/gaps.json; an RFC whose
 * Status is `Accepted` (or terminal) has no `open` GAP row. Open RISK rows are
 * permitted but ratcheted: their count is published and may not grow past
 * the committed baseline (docs/ASSURANCE-STATUS.json reports it).
 *
 * The rule this enforces was already written (RFCS/README.md §"Companion gap &
 * risk registers": "An Accepted RFC with silently-open register rows is a
 * process violation") — it just had no gate. Now it does.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listRegisterFiles, parseRegister, rfcStatus, GAP_TOKENS, RISK_TOKENS, ARG_TOKENS } from './registers-lib.mjs';

const failures = [];
const fail = (m) => failures.push(m);
const gapsPath = join(ROOT, 'spec', 'v1', 'gaps.json');
const gapIds = new Set(existsSync(gapsPath) ? (JSON.parse(readFileSync(gapsPath, 'utf8')).entries ?? []).map((e) => e.id) : []);

const counts = { gaps: {}, risks: {}, files: 0, rows: 0, openRiskRows: 0, acceptedWithOpenGaps: [] };
const TERMINAL = new Set(['Accepted', 'Superseded', 'Withdrawn', 'Rejected']);

for (const file of listRegisterFiles()) {
  counts.files++;
  const { rows } = parseRegister(file);
  const status = rfcStatus(file.rfc);
  const allowed = file.kind === 'gaps' ? GAP_TOKENS : RISK_TOKENS;
  for (const row of rows) {
    counts.rows++;
    if (row.token === null) {
      fail(`${file.rel} ${row.local}: no disposition token at the head of its ${file.kind === 'gaps' ? 'Resolution Path' : 'Status'} cell (RFC 0166 §A.1); run scripts/backfill-registers.mjs --write`);
      continue;
    }
    if (!allowed.includes(row.token)) fail(`${file.rel} ${row.local}: token '${row.token}' is not valid for a ${file.kind} row (${allowed.join('|')})`);
    if (ARG_TOKENS.has(row.token) && row.arg === null) fail(`${file.rel} ${row.local}: '${row.token}' requires an argument (${row.token}:<target>)`);
    if (row.token === 'carried' && row.arg && !gapIds.has(row.arg)) fail(`${file.rel} ${row.local}: carried:${row.arg} is not an id in spec/v1/gaps.json`);
    const bucket = file.kind === 'gaps' ? counts.gaps : counts.risks;
    bucket[row.token] = (bucket[row.token] ?? 0) + 1;
    if (file.kind === 'risks' && row.token === 'open') counts.openRiskRows++;
    if (file.kind === 'gaps' && row.token === 'open' && TERMINAL.has(status ?? '')) counts.acceptedWithOpenGaps.push(`${file.rel} ${row.local}`);
  }
}

for (const r of counts.acceptedWithOpenGaps) fail(`${r}: 'open' gap row on an RFC whose Status is terminal — close, transfer, carry (carried:<gap-id>), or externally-gate it (RFCS/README.md §"Companion gap & risk registers")`);

// RFC 0166 §C — the `open` ratchet. The corpus reached ZERO open gap rows on
// 2026-09-18 (the RFC 0111 / 0121 sweep: seven answered by fact, two by ruling,
// two re-tokened `externally-gated` because they are nobody here's work). Zero
// is the only baseline that makes `open` self-policing: with it, a new open row
// must be argued for; without it, open rows accumulate and the count is a
// statistic rather than a bound.
{
  const baselinePath = join(ROOT, 'docs', 'witness-baseline.json');
  if (existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const want = baseline.openGaps;
    const have = counts.gaps.open ?? 0;
    if (typeof want === 'number' && have > want) {
      failures.push(
        `open gap rows rose ${want} -> ${have} (docs/witness-baseline.json openGaps). An open row says a steward owes work: ` +
        `close it, rule it, or re-token it \`externally-gated:<tripwire>\` when it is nobody here's to do.`,
      );
    }
    // The summary line below has printed `(ratchet)` after the open-risk count
    // since that count was added, and NOTHING COMPARED IT TO ANYTHING. A word in
    // the output that the code does not back is the defect this corpus spent
    // 2026-09-19 removing from its prose; it was sitting in the gate's own
    // summary. Zero is not the right baseline here the way it is for gaps — an
    // open risk is a legitimate standing state, an open gap is work owed — so
    // the baseline pins the count where it stands and makes a rise deliberate.
    const wantRisks = baseline.openRisks;
    if (typeof wantRisks === 'number' && counts.openRiskRows > wantRisks) {
      failures.push(
        `open risk rows rose ${wantRisks} -> ${counts.openRiskRows} (docs/witness-baseline.json openRisks). ` +
        `An open risk is allowed to stand, but the count may not climb in silence: mitigate, accept, or transfer ` +
        `one to make room, or move the baseline in the same commit and say why.`,
      );
    }
  }
}
if (failures.length > 0) {
  console.error(`=== check-registers FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  if (failures.length > 40) console.error(`  … ${failures.length - 40} more`);
  process.exit(1);
}
console.log(
  `=== check-registers OK — ${counts.files} registers, ${counts.rows} rows, every row tokened; gaps ${JSON.stringify(counts.gaps)}; risks ${JSON.stringify(counts.risks)}; open risk rows ${counts.openRiskRows} (ratchet, baseline ${JSON.parse(readFileSync(join(ROOT, 'docs', 'witness-baseline.json'), 'utf8')).openRisks ?? 'unset'}) ===`,
);

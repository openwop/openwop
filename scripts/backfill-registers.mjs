#!/usr/bin/env node
/**
 * backfill-registers — write RFC 0166 §A.1 disposition tokens into every gap
 * and risk register row, and create the one-row register that RFC 0166 §A.3
 * requires for every RFC that graduated without one.
 *
 * Idempotent: a row whose disposition cell already begins with a recognised
 * token is left alone. Legacy vocabulary (`**CLOSED**`, `~~`, "Carried",
 * "Externally gated", "TRANSFERRED", "Mitigated", "Open") is mapped by
 * `registers-lib.mjs#legacyDisposition`; a row with no marker on an Accepted
 * RFC becomes `carried:<gap-id>` (it IS the named carried-forward gap the
 * README rule allows), and `open` otherwise.
 *
 *   node scripts/backfill-registers.mjs            # report what would change
 *   node scripts/backfill-registers.mjs --write    # apply
 */

import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listRegisterFiles, parseRegister, rfcStatus, rfcStem, legacyDisposition, renderToken, stripLeadingToken, GAP_TOKENS, RISK_TOKENS, ARG_TOKENS } from './registers-lib.mjs';

const write = process.argv.includes('--write');
const counts = { rows: 0, alreadyTokened: 0, mapped: {}, defaulted: 0, filesChanged: 0, registersCreated: 0 };

for (const file of listRegisterFiles()) {
  const { lines, rows } = parseRegister(file);
  const status = rfcStatus(file.rfc);
  let changed = false;
  for (const row of rows) {
    counts.rows++;
    const allowed = file.kind === 'gaps' ? GAP_TOKENS : RISK_TOKENS;
    const tokenOk = row.token !== null && allowed.includes(row.token) && !(ARG_TOKENS.has(row.token) && row.arg === null);
    if (tokenOk) {
      counts.alreadyTokened++;
      continue;
    }
    // Either no token, or a bare legacy word the parser recognises but that is
    // invalid here (a gap row reading "Mitigated", a "Carried" with no gap id):
    // re-derive and re-render, stripping the bare word first.
    const d = legacyDisposition(row, status);
    counts.mapped[d.token] = (counts.mapped[d.token] ?? 0) + 1;
    if (d.confidence === 'default') counts.defaulted++;
    const cells = [...row.cells];
    const rest = row.token !== null ? stripLeadingToken(cells[row.dispIndex]) : cells[row.dispIndex];
    cells[row.dispIndex] = `${renderToken(d.token, d.arg)} ${rest}`.trim();
    lines[row.line - 1] = `| ${cells.join(' | ')} |`;
    changed = true;
  }
  if (changed) {
    counts.filesChanged++;
    if (write) writeFileSync(file.path, lines.join('\n'));
  }
}

// §A.3 — a register for every RFC that has none, so "no register" and "empty
// register" are distinguishable.
const rfcDir = join(ROOT, 'RFCS');
const have = new Set(listRegisterFiles().map((f) => f.rfc));
for (const f of readdirSync(rfcDir).sort()) {
  const m = /^(\d{4})-(.+)\.md$/.exec(f);
  if (!m || m[1] === '0000' || /\.(gaps|risks)\.md$/.test(f)) continue;
  if (have.has(m[1])) continue;
  const stem = rfcStem(m[1]);
  const status = rfcStatus(m[1]);
  const target = join(rfcDir, 'registers', `${stem}.gaps.md`);
  if (existsSync(target)) continue;
  counts.registersCreated++;
  if (write) {
    writeFileSync(
      target,
      `# RFC ${m[1]} — Gap register\n\n` +
        `Opened 2026-09-02 by the RFC 0166 §A.3 backfill: this RFC (\`${status ?? 'unknown'}\`) graduated without a companion register. ` +
        `An empty register is a statement — "no gaps were recorded at authoring" — and this file makes it one, so a reader can tell it apart from a register nobody wrote.\n\n` +
        `| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |\n| --- | --- | --- | --- | --- | --- |\n` +
        `| G0 | — | No gaps were recorded at authoring; register opened by the RFC 0166 backfill so that absence is explicit. | Spec Architect | \`closed\` nothing to carry | — |\n`,
    );
  }
}

console.log(
  `backfill-registers${write ? ' --write' : ' (dry run)'}: ${counts.rows} rows; ${counts.alreadyTokened} already tokened; mapped ` +
    Object.entries(counts.mapped).map(([k, v]) => `${k}=${v}`).join(', ') +
    `; ${counts.defaulted} by RFC-status default; ${counts.filesChanged} files changed; ${counts.registersCreated} registers created`,
);

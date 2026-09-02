/**
 * registers-lib — one parser for the RFC gap and risk registers (RFC 0166 §A).
 *
 * Registers live in two places (`RFCS/registers/<nnnn>-<slug>.{gaps,risks}.md`
 * since the 2026-06 reorganisation, and `RFCS/<nnnn>-<slug>.{gaps,risks}.md`
 * for the RFCs written before it). Both are parsed here so no consumer has to
 * know. Rows are recognised by their first cell (`G<n>` / `R<n>`, optionally
 * bold), NOT by cell count — the assurance-status parser required exactly eight
 * cells and silently lost 64 of 204 risk rows to drifted tables.
 *
 * Disposition tokens (RFC 0166 §A.1) sit at the HEAD of the row's last
 * meaningful cell — `Resolution Path` for gaps, `Status` for risks — as
 * `open | closed | transferred:<target> | carried:<gap-id> | externally-gated:<tripwire>`
 * for gaps and `open | mitigated | accepted | closed | transferred:<target>` for
 * risks, optionally wrapped in `**…**`. Free text follows the token.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const GAP_TOKENS = ['open', 'closed', 'transferred', 'carried', 'externally-gated'];
export const RISK_TOKENS = ['open', 'mitigated', 'accepted', 'closed', 'transferred'];
/** Tokens that take a `:<argument>`. */
export const ARG_TOKENS = new Set(['transferred', 'carried', 'externally-gated']);

const TOKEN_RE = /^\s*(?:\*\*|`)*(open|closed|transferred|carried|externally-gated|mitigated|accepted)(?::([^\s*|`]+))?(?:\*\*|`)*(?=\s|$|—|-|\.|,|;|:)/i;

/** Every register file, both locations, with its RFC number and kind. */
export function listRegisterFiles() {
  const out = [];
  const add = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).sort()) {
      const m = /^(\d{4})-.+\.(gaps|risks)\.md$/.exec(f);
      if (m) out.push({ path: join(dir, f), rel: join(dir, f).slice(ROOT.length + 1), rfc: m[1], kind: m[2] });
    }
  };
  add(join(ROOT, 'RFCS', 'registers'));
  add(join(ROOT, 'RFCS'));
  return out;
}

/** Parse one register file into rows. */
export function parseRegister(file) {
  const text = readFileSync(file.path, 'utf8');
  const lines = text.split('\n');
  const rows = [];
  const idRe = file.kind === 'gaps' ? /^\|\s*(?:\*\*)?(G\d+)(?:\*\*)?\s*\|/ : /^\|\s*(?:\*\*)?(R\d+)(?:\*\*)?\s*\|/;
  lines.forEach((line, i) => {
    const m = idRe.exec(line);
    if (!m) return;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    // gaps: ID | Section | Question | Owner | Resolution Path | Blocks  → disposition cell = index 4
    // risks: ID | Risk | L | I | Score | Mitigation | Owner | Status   → disposition cell = last
    const dispIndex = file.kind === 'gaps' ? Math.min(4, cells.length - 1) : cells.length - 1;
    const dispCell = cells[dispIndex] ?? '';
    const tok = TOKEN_RE.exec(dispCell);
    rows.push({
      file,
      line: i + 1,
      local: m[1],
      cells,
      dispIndex,
      dispCell,
      token: tok ? tok[1].toLowerCase() : null,
      arg: tok && tok[2] ? tok[2] : null,
      raw: line,
    });
  });
  return { file, lines, rows };
}

/** Status of an RFC by number (reads the header table). */
export function rfcStatus(rfc) {
  const dir = join(ROOT, 'RFCS');
  const f = readdirSync(dir).find((x) => x.startsWith(`${rfc}-`) && x.endsWith('.md') && !/\.(gaps|risks)\.md$/.test(x));
  if (!f) return null;
  const text = readFileSync(join(dir, f), 'utf8');
  const m = text.match(/\|\s*\*\*Status\*\*\s*\|\s*`?([A-Za-z][\w-]*)/);
  return m ? m[1] : null;
}

/** RFC number → slug file stem, for register file naming. */
export function rfcStem(rfc) {
  const dir = join(ROOT, 'RFCS');
  const f = readdirSync(dir).find((x) => x.startsWith(`${rfc}-`) && x.endsWith('.md') && !/\.(gaps|risks)\.md$/.test(x));
  return f ? basename(f, '.md') : null;
}

/**
 * Map the legacy free-text vocabulary to a token (RFC 0166 §A.1 backfill).
 * Returns { token, arg, confidence } — `confidence: 'explicit'` when the cell
 * already carries a recognised legacy marker, `'default'` when the row had no
 * marker and the token follows from the RFC's status.
 */
export function legacyDisposition(row, status) {
  const cell = row.dispCell;
  const whole = row.raw;
  const negated = /\b(cannot|can ?not|could not|will not|never|not)\s+be\s+(closed|resolved)\b|\bnot closed\b/i.test(cell);
  const closedMark = /\*\*\s*(CLOSED|Closed|RESOLVED|Resolved|Done)\b/.test(cell) || /~~/.test(cell) || /Realised and remediated/i.test(cell) || /^\s*(CLOSED|Closed|Done\.?|RESOLVED|Resolved)\b/.test(cell) || /^\s*✅/.test(cell);
  if (row.file.kind === 'risks') {
    if (/TRANSFERRED/i.test(cell)) return { token: 'transferred', arg: extractTarget(cell), confidence: 'explicit' };
    if (closedMark && !negated) return { token: 'closed', arg: null, confidence: 'explicit' };
    if (/^\s*\*?\*?Mitigated/i.test(cell)) return { token: 'mitigated', arg: null, confidence: 'explicit' };
    if (/^\s*\*?\*?Accepted/i.test(cell)) return { token: 'accepted', arg: null, confidence: 'explicit' };
    return { token: 'open', arg: null, confidence: /^\s*\*?\*?Open/i.test(cell) ? 'explicit' : 'default' };
  }
  // gaps
  if (/^\s*(?:\*\*|`)*Mitigated/i.test(cell)) return { token: 'closed', arg: null, confidence: 'explicit' };
  if (/TRANSFERRED|transferred to/i.test(cell)) return { token: 'transferred', arg: extractTarget(cell), confidence: 'explicit' };
  if (/Externally gated|externally-gated/i.test(cell) || /Externally gated/i.test(whole)) return { token: 'externally-gated', arg: extractTripwire(whole), confidence: 'explicit' };
  if (closedMark && !negated) return { token: 'closed', arg: null, confidence: 'explicit' };
  if (/\bCarried\b|carried forward/i.test(cell) || /\bCarried\b|carried forward/i.test(whole)) return { token: 'carried', arg: gapId(row), confidence: 'explicit' };
  // No marker: on an Accepted RFC the row IS the carried-forward named gap
  // (RFCS/README.md §"Companion gap & risk registers"); otherwise it is open.
  if (status === 'Accepted' || status === 'Superseded' || status === 'Withdrawn') return { token: 'carried', arg: gapId(row), confidence: 'default' };
  return { token: 'open', arg: null, confidence: 'default' };
}

export function gapId(row) {
  return `openwop.gap.${row.file.rfc}.${row.local.slice(1)}`;
}

function extractTarget(text) {
  const m = /RFC\s*(\d{4})/i.exec(text) || /(docs\/[A-Za-z0-9._/-]+\.md)/.exec(text) || /(ROADMAP\.md[^\s|)]*)/.exec(text);
  return m ? (m[0].startsWith('RFC') ? `rfc-${m[1]}` : m[1]) : 'unspecified';
}

function extractTripwire(text) {
  if (/legal|ToS|terms of service/i.test(text)) return 'legal';
  if (/non-steward|independent|third[- ]party host|tier-3|Tier-3/i.test(text)) return 'non-steward-host';
  if (/working group|working-group|WG /i.test(text)) return 'working-group';
  if (/external audit|auditor/i.test(text)) return 'external-audit';
  return 'unspecified';
}

/** Strip a leading (possibly bold/backticked) legacy token word so it can be re-rendered. */
export function stripLeadingToken(cell) {
  return cell.replace(/^\s*(?:\*\*|`)*(open|closed|transferred|carried|externally-gated|mitigated|accepted)(?::[^\s*|`]+)?(?:\*\*|`)*\s*/i, '');
}

/** Render a token (with arg) as it is written into a cell. */
export function renderToken(token, arg) {
  return arg ? `\`${token}:${arg}\`` : `\`${token}\``;
}

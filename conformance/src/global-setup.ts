/**
 * Run-end disposition summary (RFC 0148 §A, 2026-08-25).
 *
 * ## The gap this closes
 *
 * Every scenario file already records ONE honest disposition when it
 * finishes (`setup.ts`'s `afterAll` → `resolveFileRecord`): a file that
 * returned early with zero assertions is `blocked` / `skipped` /
 * `inapplicable` with a reason, never a pass. That machinery is correct.
 *
 * It was **published on one invocation out of two**. The worker appends
 * each recording to `OPENWOP_LEDGER_PATH`, and the ONLY writer of that
 * variable was `cli.ts` inside `runCertify`. Under a plain `vitest run`
 * — what `README.md` documents for host operators, and what host
 * implementers actually run — the worker computed `blocked`, held it in
 * memory, and discarded it at process exit. The single surviving artifact
 * was vitest's `1 passed`.
 *
 * So the suite computed an honest disposition on every run and published
 * it on one. Two host implementers independently read the console line as
 * coverage and reported the suite as claiming a pass it had internally
 * classified `blocked` — correctly, given the only artifact they had.
 * RFC 0158 §"Operator preconditions are declared, not hidden" requires a
 * blocked row be surfaced "never silently skipped or reported as a pass";
 * the bundle honored that and the console contradicted it.
 *
 * ## What this does
 *
 * When `OPENWOP_LEDGER_PATH` is unset, point it at a temp file so the
 * workers record there anyway, then read it at run end and print a
 * summary. `--certify` sets the variable itself, so this defers to it
 * completely and never interferes with bundle generation.
 *
 * The summary is deliberately NOT a pass/fail signal — it does not change
 * the exit code. `vitest`'s exit code answers "did any assertion fail";
 * this answers "what did the run actually witness", and those are
 * different questions. Conflating them is what produced the gap.
 *
 * Set `OPENWOP_DISPOSITION_SUMMARY=false` to silence it.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Dispositions that are NOT a witnessed execution — the rows worth printing. */
const NON_EXECUTING = new Set(['blocked', 'skipped', 'inapplicable']);

/** Cap on printed rows; the overflow is always announced, never silent. */
const MAX_ROWS = 40;

// Import the REAL entry type rather than restating its shape. A hand-written
// structural guess here read `entry.id` — a key the ledger has never written
// (it is `requirementId`) — and the `(unnamed)` fallback made the mismatch
// look like missing data instead of a wrong reader. A type-only import erases
// at runtime, so this costs nothing and makes the compiler the oracle: rename
// a ledger field and this file stops building instead of silently degrading.
import type { LedgerEntry } from './lib/requirement-ledger.js';
import { LAYOUT, PKG_ROOT_PATH } from './lib/paths.js';
import { describeVerdict, verifyCorpusStamp, verifyPeerContract } from './lib/corpus-stamp.js';

/** What a JSONL line parses to before validation — every field may be absent. */
type LedgerLine = Partial<Record<keyof LedgerEntry, unknown>>;

let ownedDir: string | null = null;
let ledgerPath: string | null = null;

export function setup(): void {
  // Suite 1.154.0 — the vendored contract must be the one this suite shipped.
  // In the published layout every api/ + schemas/ file is checked against the
  // SHA-256 map pack-vendor.sh wrote into schemas/CORPUS-STAMP.json; a mismatch
  // aborts the run (a suite validating a host against a schema it did not ship
  // is evidence about nothing). Repo layout: nothing vendored, nothing to check,
  // and the log line says so rather than implying a pass.
  // Suite 2.0.0: in the published layout the contract is the spec-artifacts peer (RFC 0168 §D.2).
  const stamp = LAYOUT === 'published' ? verifyPeerContract(PKG_ROOT_PATH) : verifyCorpusStamp(PKG_ROOT_PATH, LAYOUT);
  process.stderr.write(`${describeVerdict(stamp)}\n`);
  if (stamp.kind === 'mismatch') {
    throw new Error('openwop-conformance: refusing to run — schemas/CORPUS-STAMP.json digests do not match the vendored api/ + schemas/ files. Reinstall the package; do not hand-patch vendored contract files.');
  }
  if (process.env['OPENWOP_DISPOSITION_SUMMARY'] === 'false') return;
  // `--certify` already routes the ledger to its own report dir and reads it
  // there. Never take it over — this exists only for the path that had no
  // reader at all.
  if ((process.env['OPENWOP_LEDGER_PATH'] ?? '') !== '') return;
  ownedDir = mkdtempSync(join(tmpdir(), 'owp-dispositions-'));
  ledgerPath = join(ownedDir, 'requirement-ledger.jsonl');
  process.env['OPENWOP_LEDGER_PATH'] = ledgerPath;
}

/**
 * Fold raw JSONL into the printable summary. PURE — no I/O, no env — so
 * `global-setup.test.ts` can pin it without a vitest subprocess or a host.
 * Returns `null` when there is nothing to say.
 */
export function summarise(raw: string): string | null {
  const counts = new Map<string, number>();
  const rows: Array<{ id: string; disposition: string; detail: string }> = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let entry: LedgerLine;
    try {
      entry = JSON.parse(line) as LedgerLine;
    } catch {
      continue;
    }
    const disposition = typeof entry.disposition === 'string' ? entry.disposition : 'unknown';
    const id = typeof entry.requirementId === 'string' ? entry.requirementId : '(unnamed)';
    const detail = typeof entry.detail === 'string' ? entry.detail : '';
    counts.set(disposition, (counts.get(disposition) ?? 0) + 1);
    if (NON_EXECUTING.has(disposition)) {
      rows.push({ id, disposition, detail });
    } else if (disposition === 'executed-pass' && entry.assertionCount === 0) {
      // The other shape RFC 0148 §A rejects: a pass that asserted nothing.
      rows.push({ id, disposition: 'executed-pass (0 assertions)', detail });
    }
  }
  if (counts.size === 0) return null;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const order = ['executed-pass', 'executed-fail', 'blocked', 'skipped', 'inapplicable'];
  const summary = [...order, ...[...counts.keys()].filter((k) => !order.includes(k))]
    .filter((k) => counts.has(k))
    .map((k) => `${k} ${counts.get(k)}`)
    .join(' \u00b7 ');
  const out: string[] = [
    '',
    `[openwop-conformance] RFC 0148 \u00a7A dispositions \u2014 ${total} requirement(s) recorded`,
    `  ${summary}`,
  ];
  if (rows.length > 0) {
    out.push(
      `  ${rows.length} requirement(s) did NOT witness. vitest reports these as passes because`,
      '  no assertion failed; that is a test outcome, not a conformance disposition.',
    );
    for (const r of rows.slice(0, MAX_ROWS)) {
      const detail = r.detail.length > 120 ? `${r.detail.slice(0, 117)}...` : r.detail;
      out.push(`    ${r.disposition.padEnd(28)} ${r.id}${detail === '' ? '' : `\n      ${detail}`}`);
    }
    if (rows.length > MAX_ROWS) {
      // Never truncate silently: a capped list that does not say it was capped
      // reads as a complete one, which is the same defect this whole summary
      // exists to remove.
      out.push(`    ... and ${rows.length - MAX_ROWS} more not listed (run with --certify for the full bundle)`);
    }
  }
  out.push('');
  return out.join('\n');
}

export function teardown(): void {
  if (ledgerPath === null || ownedDir === null) return;
  // We set the variable; unset it so a subsequent in-process run re-derives.
  delete process.env['OPENWOP_LEDGER_PATH'];
  let raw = '';
  try {
    raw = readFileSync(ledgerPath, 'utf8');
  } catch {
    // No file means no worker ever recorded \u2014 nothing to summarise, and a
    // missing summary must never be mistaken for "nothing was blocked", so
    // say so rather than printing an empty clean bill.
    process.stderr.write(
      '\n[openwop-conformance] no disposition ledger was written \u2014 the run recorded nothing, ' +
        'which is NOT the same as every scenario having witnessed its requirement.\n',
    );
    cleanup();
    return;
  }
  const text = summarise(raw);
  if (text !== null) process.stderr.write(text);
  cleanup();
}

function cleanup(): void {
  if (ownedDir !== null) {
    try {
      rmSync(ownedDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  ownedDir = null;
  ledgerPath = null;
}

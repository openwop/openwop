/**
 * RFC 0148 §A — the requirement execution ledger.
 *
 * The program exists because a green bundle could overstate behavior that never
 * ran. Every instance found so far shares one shape: **something absent was
 * treated as something proven.** `verifyBundleProfile()` derived `floorProven`
 * from `[].every(...)` over an undefined floor. A gated subtest 404'd and
 * soft-skipped. A scenario early-returned and the file still counted as passed.
 *
 * So the ledger inverts the default. A requirement has **no** disposition until
 * a scenario explicitly records one, and a requirement with no recorded
 * disposition resolves to `blocked` — never to `executed-pass`. Silence is
 * evidence of nothing, and the data structure now says so rather than relying on
 * each author to remember it.
 *
 * That is the whole mechanism. Everything else here is bookkeeping.
 */

import { appendFileSync, readFileSync, existsSync } from 'node:fs';

/** RFC 0148 §A. Exactly one of these per requirement, per run. */
export type Disposition =
  /** The assertion executed against the target and passed. */
  | 'executed-pass'
  /** The assertion executed and failed. */
  | 'executed-fail'
  /** The operator explicitly excluded an optional, unadvertised profile. */
  | 'skipped'
  /** The requirement does not apply to the captured discovery/profile set. */
  | 'inapplicable'
  /** Advertised behavior could not be exercised — seam, fixture, credential, or dependency missing. */
  | 'blocked';

export const DISPOSITIONS: readonly Disposition[] = [
  'executed-pass',
  'executed-fail',
  'skipped',
  'inapplicable',
  'blocked',
] as const;

/**
 * Dispositions that permit a profile to certify. `blocked` is deliberately NOT
 * here: RFC 0148 §A says a blocked requirement in a claimed profile invalidates
 * that profile's certification, because "we could not check" and "we checked and
 * it holds" are the two states this program exists to stop conflating.
 */
export const CERTIFIABLE: readonly Disposition[] = [
  'executed-pass',
  'skipped',
  'inapplicable',
] as const;

export interface LedgerEntry {
  readonly requirementId: string;
  readonly disposition: Disposition;
  /** Why — required for every disposition except `executed-pass`. */
  readonly detail?: string;
  /** How many `expect` assertions actually ran for this requirement (RFC 0148
   *  §C `assertionCount`). `executed-pass` with `0` is the vacuous pass the
   *  program exists to make visible; the runner treats it as unclassified for
   *  a claimed profile's floor. */
  readonly assertionCount?: number;
}

const ledger = new Map<string, LedgerEntry>();
/**
 * Append-only journal of every recording in call order (duplicates included).
 * `setup.ts` marks the journal length before a file's tests and reads what was
 * recorded since, so a file's own gate decisions can be found even when the
 * same requirement id was recorded earlier in the worker.
 */
const journal: LedgerEntry[] = [];

/**
 * Record a requirement's outcome. Recording the same id twice with different
 * dispositions throws: RFC 0148 §A says **exactly one** disposition per
 * requirement, and a silent last-write-wins would let a later soft-skip
 * overwrite an earlier real failure — the failure mode in reverse.
 */
export function recordRequirement(
  requirementId: string,
  disposition: Disposition,
  detail?: string,
  extras?: { assertionCount?: number },
): void {
  const prior = ledger.get(requirementId);
  if (prior !== undefined && prior.disposition !== disposition) {
    throw new Error(
      `RFC 0148 §A: ${requirementId} already recorded as '${prior.disposition}', now '${disposition}'. ` +
        'Exactly one disposition per requirement per run.',
    );
  }
  if (disposition !== 'executed-pass' && (detail === undefined || detail.trim() === '')) {
    throw new Error(
      `RFC 0148 §A: ${requirementId} recorded as '${disposition}' without a reason. ` +
        'Anything other than executed-pass MUST say why, or the ledger records an outcome nobody can act on.',
    );
  }
  const entry: LedgerEntry = {
    requirementId,
    disposition,
    ...(detail === undefined ? {} : { detail }),
    ...(extras?.assertionCount === undefined ? {} : { assertionCount: extras.assertionCount }),
  };
  ledger.set(requirementId, entry);
  journal.push(entry);
  // File sink (RFC 0148 acceptance item 2, S6). The in-memory map lives in a
  // vitest worker; the `--certify` runner is a separate process reading a
  // per-file JSON report. When the runner sets OPENWOP_LEDGER_PATH the worker
  // appends every recording as one JSONL line so the runner can build
  // requirement-level dispositions from what scenarios actually recorded —
  // rather than inferring them from per-file pass/fail/skip, which cannot
  // tell `skipped` from `inapplicable` from `blocked`. Best-effort: a sink
  // failure must never turn a real assertion into a crash.
  const sink = process.env['OPENWOP_LEDGER_PATH'];
  if (sink !== undefined && sink !== '' && sink !== suspendedSink) {
    try {
      appendFileSync(sink, JSON.stringify(entry) + '\n');
    } catch {
      /* ignore — the in-memory ledger is still authoritative for this worker */
    }
  }
}

/**
 * Read a ledger JSONL file written through the sink above. Duplicate lines for
 * the same id (a scenario re-recording the same disposition, or several files
 * gating the same profile) collapse to one entry; a CONFLICT (two different
 * dispositions for one id across workers) resolves to the least certifiable
 * — `executed-fail` > `blocked` > `executed-pass` > `skipped` > `inapplicable`
 * — because "one worker said it failed" outranks "another said it passed", and
 * an unresolvable disagreement must never round toward certification.
 * Returns an empty array when the file is absent.
 */
export function readLedgerFile(path: string): readonly LedgerEntry[] {
  if (!existsSync(path)) return [];
  const rank: Record<Disposition, number> = { 'executed-fail': 0, blocked: 1, 'executed-pass': 2, skipped: 3, inapplicable: 4 };
  const merged = new Map<string, LedgerEntry>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let e: LedgerEntry;
    try {
      e = JSON.parse(line) as LedgerEntry;
    } catch {
      continue;
    }
    if (typeof e.requirementId !== 'string' || !DISPOSITIONS.includes(e.disposition)) continue;
    const prior = merged.get(e.requirementId);
    if (prior === undefined || rank[e.disposition] < rank[prior.disposition]) merged.set(e.requirementId, e);
  }
  return [...merged.values()].sort((a, b) => a.requirementId.localeCompare(b.requirementId));
}

/**
 * The disposition for a requirement. **Absent resolves to `blocked`, never to a
 * pass.** This is the inversion the whole section turns on: a scenario that
 * returned early, threw and swallowed, or was never written leaves no entry, and
 * the honest reading of no entry is "this was not exercised".
 */
/**
 * Has this requirement already been recorded in THIS run? Distinguishes "the
 * scenario classified itself" from "nothing has been recorded yet" — which
 * `dispositionOf` cannot, since it folds the absent case to `blocked`.
 */
export function hasRequirement(requirementId: string): boolean {
  return ledger.has(requirementId);
}

export function dispositionOf(requirementId: string): Disposition {
  return ledger.get(requirementId)?.disposition ?? 'blocked';
}

export function entryOf(requirementId: string): LedgerEntry {
  return (
    ledger.get(requirementId) ?? {
      requirementId,
      disposition: 'blocked',
      detail: 'no disposition recorded — the requirement was not exercised',
    }
  );
}

export function snapshot(): readonly LedgerEntry[] {
  return [...ledger.values()].sort((a, b) => a.requirementId.localeCompare(b.requirementId));
}

/** Test-support only. Production runs record once and read once. */
let suspendedSink: string | undefined;
/**
 * Scenarios that exercise `recordRequirement` itself (the ledger's own unit
 * tests) record REAL requirement ids as fixtures — e.g. the whole core-standard
 * floor as `executed-pass`. With the file sink on, those fixture rows would
 * reach the runner's ledger and, under the reader's conflict rank, out-vote a
 * genuine `inapplicable` recorded by the scenario that owns the requirement.
 * Such a test file calls this in `beforeAll` and the returned restore in
 * `afterAll`: recordings made in between are kept in memory but NOT appended to
 * the sink that was active at the time of the call. A different path set by the
 * test itself (its own scratch sink) is unaffected.
 */
export function suspendSinkForFixtures(): () => void {
  suspendedSink = process.env['OPENWOP_LEDGER_PATH'];
  return () => {
    suspendedSink = undefined;
  };
}

/** Number of recordings so far in this worker (a mark for `journalSince`). */
export function journalLength(): number {
  return journal.length;
}

/** Every recording made since `mark` (from `journalLength()`), in call order. */
export function journalSince(mark: number): readonly LedgerEntry[] {
  return journal.slice(mark);
}

export function resetLedger(): void {
  ledger.clear();
  journal.length = 0;
}

export interface ProfileVerdict {
  readonly profile: string;
  readonly certifiable: boolean;
  readonly blocking: readonly LedgerEntry[];
}

/**
 * Whether a profile's requirements permit certification. A profile with **no**
 * requirements is NOT certifiable by this function — an empty requirement set
 * is the `[].every(...)` shape that started all of this, and callers must
 * distinguish "no floor by design" (`discoveryOnly`) from "no floor written yet"
 * before reaching here.
 */
export function verifyProfileRequirements(
  profile: string,
  requirementIds: readonly string[],
): ProfileVerdict {
  const blocking = requirementIds
    .map(entryOf)
    .filter((e) => !CERTIFIABLE.includes(e.disposition));
  return { profile, certifiable: requirementIds.length > 0 && blocking.length === 0, blocking };
}

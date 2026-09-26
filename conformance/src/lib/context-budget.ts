/**
 * RFC 0111 — the transcript-window checker, kept pure so its sabotage cases are
 * self-tests (`context-budget.test.ts`) rather than claims.
 *
 * WHY THIS FILE EXISTS (the 2026-09-26 correction on record, COMPATIBILITY.md).
 * Until suite 2.41.0 `context-budget-transcript-bound` could not fail in the ways
 * RFC 0111 names:
 *   (b) "the harness independently … re-computes their token sum" — impossible:
 *       events are content-free, so the suite had nothing to count. The test
 *       checked that each id existed, and nothing else.
 *   (c) "the recent tail" — the test checked only that ids were unique.
 *   and no check that the budget was ever under PRESSURE, so a host advertising
 *   a budget of 10^9 passed.
 * The seam now also returns `entries[] { eventId, rendered }` — the exact text
 * the host fed the model for each event that iteration — and for
 * `tokenCounter: "chars"` the suite recounts it itself.
 *
 * Definitions this checker applies (host-sample-test-seams.md §14):
 *   - `chars` is Unicode code points (`[...s].length`), not UTF-16 units or bytes.
 *   - An event is ELIGIBLE for an iteration's transcript when it shares
 *     `(type, nodeId)` with an event the host fed verbatim that iteration. The
 *     RFC's "no older event included while a newer eligible one is dropped"
 *     never defined "eligible"; keying on the pair (not the type alone) keeps a
 *     host that feeds only one node's events from being convicted for another
 *     node's.
 *   - PRESSURE: the budget did something — an eligible event older than the
 *     oldest fed one exists, or the window carries a summarized range.
 */

export interface WindowEntry {
  readonly eventId: string;
  readonly rendered: string;
}
export interface SummarizedRange {
  readonly summaryRef: string;
  readonly replacedTurns: readonly string[];
}
export interface TranscriptWindow {
  readonly tokenCounter: string;
  readonly tokenCount: number;
  readonly eventIds: readonly string[];
  readonly summarizedRanges: readonly SummarizedRange[];
  readonly entries?: readonly WindowEntry[];
}
export interface LogEvent {
  readonly eventId: string;
  readonly type: string;
  readonly sequence: number;
  readonly nodeId?: string;
  readonly payload: Record<string, unknown>;
}
export interface BudgetCap {
  readonly transcriptTokenBudget: number;
  readonly tokenCounter: string;
}
export interface WindowVerdict {
  /** Every broken rule, as a sentence naming the iteration. Empty = consistent. */
  readonly violations: string[];
  /** Whether this iteration shows the budget acting (see file docblock). */
  readonly pressure: boolean;
  /** Rules that could not be evaluated (no event log). */
  readonly unmeasured: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const stringArrayOf = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined);

/** Unicode code points — the `chars` unit. */
export function charCount(s: string): number {
  return [...s].length;
}

/** Parse a seam response; undefined when the required shape is wrong (a malformed optional member is also undefined — it cannot be half-trusted). */
export function parseTranscriptWindow(v: unknown): TranscriptWindow | undefined {
  if (!isRecord(v)) return undefined;
  const tokenCounter = v['tokenCounter'];
  const tokenCount = v['tokenCount'];
  const eventIds = stringArrayOf(v['eventIds']);
  if (typeof tokenCounter !== 'string' || typeof tokenCount !== 'number' || eventIds === undefined) return undefined;
  const summarizedRanges: SummarizedRange[] = [];
  const rawRanges = v['summarizedRanges'];
  if (rawRanges !== undefined) {
    if (!Array.isArray(rawRanges)) return undefined;
    for (const r of rawRanges) {
      if (!isRecord(r) || typeof r['summaryRef'] !== 'string') return undefined;
      const replacedTurns = stringArrayOf(r['replacedTurns']);
      if (replacedTurns === undefined) return undefined;
      summarizedRanges.push({ summaryRef: r['summaryRef'], replacedTurns });
    }
  }
  const rawEntries = v['entries'];
  if (rawEntries === undefined) return { tokenCounter, tokenCount, eventIds, summarizedRanges };
  if (!Array.isArray(rawEntries)) return undefined;
  const entries: WindowEntry[] = [];
  for (const e of rawEntries) {
    if (!isRecord(e) || typeof e['eventId'] !== 'string' || typeof e['rendered'] !== 'string') return undefined;
    entries.push({ eventId: e['eventId'], rendered: e['rendered'] });
  }
  return { tokenCounter, tokenCount, eventIds, summarizedRanges, entries };
}

const eligibilityKey = (e: LogEvent): string => `${e.type}\u0000${e.nodeId ?? ''}`;

/**
 * Check one iteration's window against the advertised cap and (when available)
 * the run's event log. `log` null ⇒ the log-dependent rules are reported in
 * `unmeasured`, never silently passed.
 */
export function checkTranscriptWindow(iteration: number, w: TranscriptWindow, cap: BudgetCap, log: readonly LogEvent[] | null): WindowVerdict {
  const violations: string[] = [];
  const unmeasured: string[] = [];
  const at = `iteration ${iteration}`;

  if (w.tokenCounter !== cap.tokenCounter) violations.push(`${at}: seam tokenCounter "${w.tokenCounter}" is not the advertised "${cap.tokenCounter}"`);
  if (w.tokenCount > cap.transcriptTokenBudget) violations.push(`${at}: tokenCount ${w.tokenCount} exceeds transcriptTokenBudget ${cap.transcriptTokenBudget}`);
  if (new Set(w.eventIds).size !== w.eventIds.length) violations.push(`${at}: eventIds repeats an entry`);

  // (b) — the recount. Only `chars` is recountable by a black-box harness.
  if (cap.tokenCounter === 'chars') {
    if (w.entries === undefined) {
      violations.push(`${at}: tokenCounter is "chars" but the seam returned no entries[] — the recount (RFC 0111 (b)) cannot run, and for "chars" entries are REQUIRED`);
    } else {
      const sum = w.entries.reduce((n, e) => n + charCount(e.rendered), 0);
      if (sum !== w.tokenCount) violations.push(`${at}: entries[].rendered sum to ${sum} chars but tokenCount is ${w.tokenCount}`);
    }
  }

  if (log === null) {
    unmeasured.push('real-event, entries↔eventIds, summary-range, recent-tail and pressure rules (no event log)');
    return { violations, pressure: false, unmeasured };
  }

  const byId = new Map(log.map((e) => [e.eventId, e]));
  const summarizedByRef = new Map<string, LogEvent>();
  for (const e of log) {
    if (e.type !== 'context.summarized') continue;
    const ref = e.payload['summaryRef'];
    if (typeof ref === 'string') summarizedByRef.set(ref, e);
  }

  for (const id of w.eventIds) if (!byId.has(id)) violations.push(`${at}: eventId "${id}" is not an event of this run`);
  for (const r of w.summarizedRanges) if (!summarizedByRef.has(r.summaryRef)) violations.push(`${at}: summarizedRanges summaryRef "${r.summaryRef}" has no matching context.summarized event`);

  if (w.entries !== undefined) {
    const verbatim: string[] = [];
    for (const e of w.entries) {
      const ev = byId.get(e.eventId);
      if (ev === undefined) { violations.push(`${at}: entries[] eventId "${e.eventId}" is not an event of this run`); continue; }
      if (ev.type === 'context.summarized') {
        const ref = ev.payload['summaryRef'];
        if (!w.summarizedRanges.some((r) => r.summaryRef === ref)) violations.push(`${at}: summary entry "${e.eventId}" is not listed in summarizedRanges`);
      } else {
        verbatim.push(e.eventId);
      }
    }
    if (verbatim.join('\u0000') !== w.eventIds.join('\u0000')) violations.push(`${at}: the verbatim entries[] (${verbatim.length}) are not eventIds (${w.eventIds.length}) in the same order`);
  }

  // (c) — the recent tail.
  const fed = w.eventIds.map((id) => byId.get(id)).filter((e): e is LogEvent => e !== undefined);
  if (fed.length === 0) return { violations, pressure: w.summarizedRanges.length > 0, unmeasured };
  for (let i = 1; i < fed.length; i += 1) {
    if (fed[i].sequence <= fed[i - 1].sequence) { violations.push(`${at}: eventIds are not in event-log order`); break; }
  }
  const decided = log.find((e) => e.type === 'runOrchestrator.decided' && e.payload['iteration'] === iteration);
  const cutoff = decided?.sequence ?? Number.POSITIVE_INFINITY;
  for (const e of fed) if (e.sequence >= cutoff) violations.push(`${at}: eventId "${e.eventId}" (seq ${e.sequence}) is at or after the iteration's own decision (seq ${cutoff})`);

  const keys = new Set(fed.map(eligibilityKey));
  const fedIds = new Set(fed.map((e) => e.eventId));
  const replaced = new Set(w.summarizedRanges.flatMap((r) => r.replacedTurns));
  const minFed = Math.min(...fed.map((e) => e.sequence));
  const maxBound = Number.isFinite(cutoff) ? cutoff : Math.max(...fed.map((e) => e.sequence)) + 1;
  let pressure = w.summarizedRanges.length > 0;
  for (const e of log) {
    if (!keys.has(eligibilityKey(e)) || fedIds.has(e.eventId)) continue;
    if (e.sequence > minFed && e.sequence < maxBound && !replaced.has(e.eventId)) {
      violations.push(`${at}: eligible event "${e.eventId}" (${e.type}, seq ${e.sequence}) was dropped while an older one (seq ${minFed}) was fed — not a recent tail`);
    }
    if (e.sequence < minFed) pressure = true;
  }
  return { violations, pressure, unmeasured };
}

/** The summary texts a window fed, in entry order — the model-facing proof of replay reuse. */
export function summaryTexts(w: TranscriptWindow, log: readonly LogEvent[]): string[] {
  if (w.entries === undefined) return [];
  const summaryIds = new Set(log.filter((e) => e.type === 'context.summarized').map((e) => e.eventId));
  return w.entries.filter((e) => summaryIds.has(e.eventId)).map((e) => e.rendered);
}

/** v1 reads `summarization.supported: true`; v2 has no `supported` seat — presence of the record is the claim (capabilities.md §2). */
export function summarizationDeclared(contextBudget: unknown, major: 1 | 2): boolean {
  if (!isRecord(contextBudget)) return false;
  const s = contextBudget['summarization'];
  if (!isRecord(s)) return false;
  return major === 2 ? true : s['supported'] === true;
}

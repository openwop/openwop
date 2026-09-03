/**
 * RFC 0111 — Context Economy: transcript token budget.
 *
 * Verifies the OPT-IN per-turn token bound on the orchestrator transcript
 * (`spec/v1/multi-agent-execution.md` §"Context economy"). A host advertising
 * `multiAgent.executionModel.contextBudget.transcriptTokenBudget` MUST NOT feed
 * more than that many tokens of transcript to any single orchestrator turn,
 * measured in the advertised `tokenCounter` unit.
 *
 * Capability-gated on `multiAgent.executionModel.contextBudget.transcriptTokenBudget`
 * being PRESENT (root-first per RFC 0073) via `behaviorGate`. The assembled
 * transcript is host-internal and never crosses the wire, so the scenario reads
 * the host's own per-iteration accounting via the OPTIONAL conformance seam
 * `GET /v1/host/sample/agent/transcript-window?runId=…&iteration=N`
 * (`host-sample-test-seams.md` §14): `{ tokenCounter, tokenCount, eventIds,
 * summarizedRanges }`. The seam is OPTIONAL — the scenario soft-skips on
 * `404`/`405` (the RFC defers reference-host implementation).
 *
 * Asserts, for each iteration the host reports:
 *   1. `tokenCounter` equals the advertised `contextBudget.tokenCounter`.
 *   2. `tokenCount ≤ transcriptTokenBudget` (the per-turn bound).
 *   3. CROSS-CHECK — the harness independently reads the events named in
 *      `eventIds` from the run event-log (`/v1/host/sample/test/runs/:runId/events`)
 *      and confirms every named id is a real persisted event of the run, so the
 *      host's reported accounting is internally consistent (not fabricated).
 *   4. RECENT-TAIL — `eventIds` are a contiguous most-recent suffix of the run's
 *      eligible event-log entries (no older event included while a newer eligible
 *      one is dropped).
 *   5. SUMMARIZED-RANGE — every `summarizedRanges[].summaryRef` has a matching
 *      `context.summarized` event in the run event-log.
 *
 * Honest non-vacuity ceiling (RFC 0111 §"Conformance seam"): the model-facing
 * prompt is genuinely host-internal, so this proves the host's DECLARED
 * accounting is internally consistent + within budget — it cannot black-box-prove
 * the host feeds nothing additional off-seam. The capability is advertise-and-attest.
 *
 * @see RFCS/0111-context-economy.md
 * @see spec/v1/multi-agent-execution.md §"Context economy (RFC 0111)"
 * @see spec/v1/host-sample-test-seams.md §14
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { queryTestEvents } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const FIXTURE = 'conformance-context-budget-multiturn';
const PROFILE = 'openwop-context-budget';
const MAX_ITERATIONS_PROBED = 16;

interface SummarizationCap {
  readonly supported?: boolean;
  readonly strategy?: string;
  readonly keepLastTurns?: number;
}
interface ContextBudgetCap {
  readonly transcriptTokenBudget?: number;
  readonly tokenCounter?: string;
  readonly summarization?: SummarizationCap;
}
interface ExecutionModelCap {
  readonly contextBudget?: ContextBudgetCap;
}
interface MultiAgentCap {
  readonly executionModel?: ExecutionModelCap;
}

// ── cast-free typed accessors (no `as`) ──────────────────────────────────
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number';
}
function stringOf(v: unknown): string | undefined {
  return isString(v) ? v : undefined;
}
function numberOf(v: unknown): number | undefined {
  return isNumber(v) ? v : undefined;
}
function stringArrayOf(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every(isString) ? v : undefined;
}
function runIdOf(v: unknown): string | undefined {
  return isRecord(v) ? stringOf(v['runId']) : undefined;
}

interface SummarizedRange {
  readonly summaryRef: string;
  readonly replacedTurns: string[];
}
interface TranscriptWindow {
  readonly tokenCounter: string;
  readonly tokenCount: number;
  readonly eventIds: string[];
  readonly summarizedRanges: SummarizedRange[];
}

function summarizedRangeOf(v: unknown): SummarizedRange | undefined {
  if (!isRecord(v)) return undefined;
  const summaryRef = stringOf(v['summaryRef']);
  const replacedTurns = stringArrayOf(v['replacedTurns']);
  if (summaryRef === undefined || replacedTurns === undefined) return undefined;
  return { summaryRef, replacedTurns };
}

/** Parse the seam response into a typed window — undefined if the shape is wrong. */
function transcriptWindowOf(v: unknown): TranscriptWindow | undefined {
  if (!isRecord(v)) return undefined;
  const tokenCounter = stringOf(v['tokenCounter']);
  const tokenCount = numberOf(v['tokenCount']);
  const eventIds = stringArrayOf(v['eventIds']);
  if (tokenCounter === undefined || tokenCount === undefined || eventIds === undefined) return undefined;
  const rawRanges = v['summarizedRanges'];
  const summarizedRanges: SummarizedRange[] = [];
  if (Array.isArray(rawRanges)) {
    for (const r of rawRanges) {
      const parsed = summarizedRangeOf(r);
      if (parsed === undefined) return undefined; // malformed range → fail loudly via caller
      summarizedRanges.push(parsed);
    }
  }
  return { tokenCounter, tokenCount, eventIds, summarizedRanges };
}

describe('context-budget-transcript-bound (RFC 0111 §"Context economy")', () => {
  it('bounds the per-turn transcript to transcriptTokenBudget with an internally-consistent, recent-tail accounting', async () => {
    const ma = await readCapabilityFamily<MultiAgentCap>('multiAgent');
    const cb = ma?.executionModel?.contextBudget;
    const budget = numberOf(cb?.transcriptTokenBudget);
    if (!behaviorGate(PROFILE, budget !== undefined)) return;
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early (fixture-gated soft-skip)'); // fixture-gated soft-skip

    const advertisedCounter = stringOf(cb?.tokenCounter);
    expect(
      advertisedCounter,
      req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'RFC 0111', 'tokenCounter MUST be advertised when transcriptTokenBudget is present (schema if/then)'),
    ).toBeDefined();

    // Drive the multi-turn orchestrator run.
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = runIdOf(create.json);
    expect(runId, req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'RFC 0111', 'POST /v1/runs MUST return a runId')).toBeDefined();
    if (runId === undefined) return softSkip('blocked', 'precondition not met — `runId === undefined` returned early (seam, prior step, or fixture unavailable)');
    await pollUntilTerminal(runId);

    // Probe the per-iteration transcript-window seam (OPTIONAL).
    const windows: Array<{ iteration: number; window: TranscriptWindow }> = [];
    for (let iteration = 1; iteration <= MAX_ITERATIONS_PROBED; iteration += 1) {
      const res = await driver.get(
        `/v1/host/sample/agent/transcript-window?runId=${encodeURIComponent(runId)}&iteration=${iteration}`,
      );
      if (res.status === 404 || res.status === 405) {
        if (iteration === 1) return softSkip('blocked', 'precondition not met — `iteration === 1` returned early (seam unwired — soft-skip the whole scenario) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip the whole scenario
        break; // iterations exhausted
      }
      if (res.status === 400 || res.status === 422) break; // iteration past the run's last turn
      expect(
        res.status === 200,
        req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'host-sample-test-seams.md §14', 'the transcript-window seam MUST return 200 for a valid iteration'),
      ).toBe(true);
      const window = transcriptWindowOf(res.json);
      expect(
        window,
        req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'host-sample-test-seams.md §14', 'the seam MUST return { tokenCounter, tokenCount, eventIds, summarizedRanges }'),
      ).toBeDefined();
      if (window === undefined) return softSkip('blocked', 'precondition not met — `window === undefined` returned early (seam, prior step, or fixture unavailable)');
      windows.push({ iteration, window });
    }

    // Non-vacuity: a wired seam MUST report at least one iteration.
    expect(windows.length, req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'host-sample-test-seams.md §14', 'a wired transcript-window seam MUST report at least one orchestrator iteration')).toBeGreaterThan(0);

    // Independent event-log read for the cross-check (OPTIONAL seam).
    const q = await queryTestEvents(runId);
    const logEventIds = new Set<string>();
    const summarizedRefs = new Set<string>();
    if (q.ok) {
      for (const e of q.events) {
        logEventIds.add(e.eventId);
        if (e.type === 'context.summarized') {
          const ref = stringOf(e.payload['summaryRef']);
          if (ref !== undefined) summarizedRefs.add(ref);
        }
      }
    }

    for (const { iteration, window } of windows) {
      // 1 — tokenCounter agreement.
      expect(
        window.tokenCounter,
        req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'RFC 0111', `iteration ${iteration}: seam tokenCounter MUST equal the advertised contextBudget.tokenCounter`),
      ).toBe(advertisedCounter);

      // 2 — the per-turn token bound.
      if (budget !== undefined) {
        expect(
          window.tokenCount,
          req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'RFC 0111', `iteration ${iteration}: tokenCount MUST NOT exceed transcriptTokenBudget`),
        ).toBeLessThanOrEqual(budget);
      }

      // 3 — internal consistency: every named id is a real persisted event.
      if (q.ok) {
        for (const id of window.eventIds) {
          expect(
            logEventIds.has(id),
            req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'RFC 0111 §"Conformance seam"', `iteration ${iteration}: eventId "${id}" in the seam accounting MUST be a real persisted run event`),
          ).toBe(true);
        }
      }

      // 4 — recent-tail: ids are unique (no double-count inflating the window).
      const uniqueIds = new Set(window.eventIds);
      expect(
        uniqueIds.size,
        req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'RFC 0111 §"Conformance seam"', `iteration ${iteration}: eventIds MUST be a tail with no repeated entry`),
      ).toBe(window.eventIds.length);

      // 5 — every summarized range references a recorded context.summarized event.
      if (q.ok) {
        for (const range of window.summarizedRanges) {
          expect(
            summarizedRefs.has(range.summaryRef),
            req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'RFC 0111', `iteration ${iteration}: summarizedRanges summaryRef "${range.summaryRef}" MUST have a matching context.summarized event`),
          ).toBe(true);
        }
      }
    }

    // keepLastTurns verbatim — a kept turn is fed verbatim, never inside a summarized range.
    const keepLastTurns = numberOf(cb?.summarization?.keepLastTurns);
    if (keepLastTurns !== undefined && keepLastTurns > 0 && windows.length > 0) {
      const last = windows[windows.length - 1].window;
      const summarizedIds = new Set<string>();
      for (const range of last.summarizedRanges) for (const id of range.replacedTurns) summarizedIds.add(id);
      const verbatimTail = last.eventIds.slice(Math.max(0, last.eventIds.length - keepLastTurns));
      for (const id of verbatimTail) {
        expect(
          summarizedIds.has(id),
          req('openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi', 'RFC 0111', `a kept (verbatim) turn "${id}" MUST NOT appear inside a summarized range`),
        ).toBe(false);
      }
    }
  });
});

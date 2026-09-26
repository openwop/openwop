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
 * Asserts, for each iteration the host reports (the rules live in the pure
 * checker `lib/context-budget.ts`, whose sabotage cases are self-tests):
 *   1. `tokenCounter` equals the advertised `contextBudget.tokenCounter`.
 *   2. `tokenCount ≤ transcriptTokenBudget` (the per-turn bound).
 *   3. RECOUNT (RFC 0111 (b), corrected 2026-09-26) — for `tokenCounter:
 *      "chars"` the seam MUST return `entries[] { eventId, rendered }` and the
 *      suite sums the rendered text's code points itself; the sum MUST equal
 *      `tokenCount`. Other units are advertise-and-attest.
 *   4. REAL EVENTS — every `eventIds` / `entries[]` id is an event of the run;
 *      the verbatim entries are `eventIds` in order.
 *   5. RECENT TAIL — fed events are in log order, none at or after the
 *      iteration's own `runOrchestrator.decided`, and no eligible event (same
 *      `(type, nodeId)`) newer than the oldest fed one was dropped.
 *   6. SUMMARIZED-RANGE — every `summaryRef` has a `context.summarized` event.
 *   7. PRESSURE — at least one iteration shows the budget acting (an older
 *      eligible event evicted, or a summarized range). Without it the row
 *      records `partial-witness:` — a budget of 10^9 is not a witness.
 *
 * Both majors (2.41.0). Major 1 gates through `behaviorGate`; major 2 reads the
 * `multiAgent` record's presence and records `inapplicable` when
 * `contextBudget` is absent — never a strict-mode failure for a host that does
 * not claim the capability. The seam is in the seams profile at major 2.
 * Gated on the LIVE fixture `conformance-context-budget-live` (no mock
 * decisions): the scripted `conformance-context-budget-multiturn` drives the
 * supervisor through `mockDecisions`, which is exactly the mock RFC 0111
 * §Scope forbids from advertising `contextBudget`.
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
import { LIVE_RUN_POLL_MS, liveScenarioTimeoutMs, pollUntilTerminal } from '../lib/polling.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { queryTestEvents } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { seamsProfileAdvertised, targetMajor } from '../lib/seams.js';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { runsPath } from '../lib/memoryAttribution.js';
import { checkTranscriptWindow, parseTranscriptWindow, type LogEvent, type TranscriptWindow } from '../lib/context-budget.js';

const FIXTURE = 'conformance-context-budget-live';
const PROFILE = 'openwop-context-budget';
const MAX_ITERATIONS_PROBED = 16;
const ID = 'openwop.it.context-budget-transcript-bound.bounds-the-per-turn-transcript-to-transcripttokenbudget-with-an-internally-consi';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function recordAt(v: unknown, ...keys: string[]): Record<string, unknown> | undefined {
  let cur: unknown = v;
  for (const k of keys) cur = isRecord(cur) ? cur[k] : undefined;
  return isRecord(cur) ? cur : undefined;
}
function runIdOf(v: unknown): string | undefined {
  const r = isRecord(v) ? v['runId'] : undefined;
  return typeof r === 'string' ? r : undefined;
}

describe('context-budget-transcript-bound (RFC 0111 §"Context economy")', () => {
  it('bounds the per-turn transcript to transcriptTokenBudget with an internally-consistent, recent-tail accounting', async () => {
    const major = targetMajor();
    let cb: Record<string, unknown> | undefined;
    if (major === 2) {
      const doc = await v2Discovery();
      if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
      cb = recordAt(await familyAdvertised('multiAgent'), 'executionModel', 'contextBudget');
      if (typeof cb?.['transcriptTokenBudget'] !== 'number') return softSkip('inapplicable', 'multiAgent.executionModel.contextBudget.transcriptTokenBudget is not advertised at major 2');
      if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the transcript-window seam is in the seams profile — conformance.seamsProfile is not openwop-conformance-seams-v2');
    } else {
      cb = recordAt(await readCapabilityFamily<Record<string, unknown>>('multiAgent'), 'executionModel', 'contextBudget');
      if (!behaviorGate(PROFILE, typeof cb?.['transcriptTokenBudget'] === 'number')) return;
    }
    const budget = cb?.['transcriptTokenBudget'];
    const advertisedCounter = cb?.['tokenCounter'];
    if (typeof budget !== 'number') return softSkip('inapplicable', 'transcriptTokenBudget not advertised');
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `the live fixture ${FIXTURE} is not advertised — the scripted multiturn fixture drives a mock supervisor, which RFC 0111 §Scope forbids from advertising contextBudget`);
    expect(typeof advertisedCounter === 'string', req(ID, 'RFC 0111', 'tokenCounter MUST be advertised when transcriptTokenBudget is present (schema if/then)')).toBe(true);
    if (typeof advertisedCounter !== 'string') return softSkip('blocked', 'contextBudget.tokenCounter is not advertised (the assertion above records the failure)');

    const create = await driver.post(runsPath(), { workflowId: FIXTURE });
    expect(create.status, req(ID, 'RFC 0111', `POST ${runsPath()} MUST create the live-fixture run`)).toBe(201);
    const runId = runIdOf(create.json);
    expect(runId, req(ID, 'RFC 0111', 'the create response MUST carry a runId')).toBeDefined();
    if (runId === undefined) return softSkip('blocked', 'no runId');
    await pollUntilTerminal(runId, { timeoutMs: LIVE_RUN_POLL_MS });

    const windows: Array<{ iteration: number; window: TranscriptWindow }> = [];
    for (let iteration = 1; iteration <= MAX_ITERATIONS_PROBED; iteration += 1) {
      const res = await driver.get(`/v1/host/sample/agent/transcript-window?runId=${encodeURIComponent(runId)}&iteration=${iteration}`);
      if (res.status === 404 || res.status === 405) {
        if (iteration === 1) return major === 2 ? seamAbsent(`contextBudget is advertised but the transcript-window seam answered ${res.status} (host-sample-test-seams.md §14)`) : softSkip('blocked', `the transcript-window seam answered ${res.status} (host-sample-test-seams.md §14)`);
        break;
      }
      if (res.status === 400 || res.status === 422) break;
      expect(res.status, req(ID, 'host-sample-test-seams.md §14', `iteration ${iteration}: the transcript-window seam MUST return 200 for a valid iteration`)).toBe(200);
      const window = parseTranscriptWindow(res.json);
      expect(window, req(ID, 'host-sample-test-seams.md §14', `iteration ${iteration}: the seam MUST return { tokenCounter, tokenCount, eventIds, summarizedRanges, entries? } with a well-formed entries[] when present`)).toBeDefined();
      if (window === undefined) return softSkip('blocked', `iteration ${iteration}: the seam answer was malformed (the assertion above records the failure)`);
      windows.push({ iteration, window });
    }
    expect(windows.length, req(ID, 'host-sample-test-seams.md §14', 'a wired transcript-window seam MUST report at least one orchestrator iteration')).toBeGreaterThan(0);

    const q = await queryTestEvents(runId);
    const log: LogEvent[] | null = q.ok
      ? q.events.map((e) => ({ eventId: e.eventId, type: e.type, sequence: e.sequence, payload: e.payload, ...(e.nodeId !== undefined ? { nodeId: e.nodeId } : {}) }))
      : null;
    const cap = { transcriptTokenBudget: budget, tokenCounter: advertisedCounter };
    let pressure = false;
    for (const { iteration, window } of windows) {
      const v = checkTranscriptWindow(iteration, window, cap, log);
      expect(v.violations, req(ID, 'RFC 0111 §"Conformance seam" (b)/(c), host-sample-test-seams.md §14', `iteration ${iteration}: the host's transcript accounting MUST be within budget, recountable, real, and a recent tail`)).toEqual([]);
      pressure ||= v.pressure;
    }

    // keepLastTurns verbatim — a kept turn is fed verbatim, never inside a summarized range.
    const keepLastTurns = recordAt(cb, 'summarization')?.['keepLastTurns'];
    if (typeof keepLastTurns === 'number' && keepLastTurns > 0) {
      const last = windows[windows.length - 1].window;
      const summarizedIds = new Set(last.summarizedRanges.flatMap((r) => r.replacedTurns));
      for (const id of last.eventIds.slice(Math.max(0, last.eventIds.length - keepLastTurns))) {
        expect(summarizedIds.has(id), req(ID, 'RFC 0111', `a kept (verbatim) turn "${id}" MUST NOT appear inside a summarized range`)).toBe(false);
      }
    }

    if (log === null) return softSkip('blocked', 'the run event-log seam is unavailable, so the real-event, recent-tail and pressure rules were not measured');
    if (!pressure) softSkip('inapplicable', `no iteration shows budget pressure — every eligible event fit under transcriptTokenBudget ${budget}, so the bound was never exercised (a budget the run never reaches is not a witness)`);
  }, liveScenarioTimeoutMs(1));
});

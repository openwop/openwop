/**
 * RFC 0111 — Context Economy: declared summarization is replay-deterministic.
 *
 * A host-produced summary is NONDETERMINISTIC host output that breaks the
 * purity of the transcript-as-event-log-projection, so RFC 0111 governs it
 * exactly like an RFC 0041 nondeterministic envelope: each substitution is
 * recorded as a `context.summarized` event whose `summaryRef` artifact a
 * `:fork mode:replay` MUST REUSE — the host MUST NOT re-summarize and produce
 * a different model-facing transcript (`spec/v1/multi-agent-execution.md`
 * §"Context economy" → "Replay determinism").
 *
 * Capability-gated on `multiAgent.executionModel.contextBudget.summarization.supported`
 * (root-first per RFC 0073) via `behaviorGate`. Drives the multi-turn
 * orchestrator fixture, reads the recorded `context.summarized` events from the
 * run event-log (`/v1/host/sample/test/runs/:runId/events`), then replays the
 * run via `POST /v1/runs/{runId}:fork {mode:"replay"}` and asserts the replayed
 * run re-emits the SAME `context.summarized` records (same `summaryRef` +
 * `replacedTurns`) — i.e. the recorded summary is reused, not regenerated.
 *
 * The event-log seam + replay are both OPTIONAL — the scenario soft-skips when
 * the event-log seam is unwired (`404`), when the host advertises no `replay`
 * mode, or when the run produced no summarization (no `context.summarized`).
 * The RFC defers reference-host implementation; the witness comes from a host
 * that runs real orchestrator turns and summarizes.
 *
 * STRENGTHENED 2.41.0 (the RFC 0111 correction on record, 2026-09-26). Equal
 * `summaryRef`s prove the fork cited the same artifact; they do not prove the
 * MODEL saw the same summary. When the transcript-window seam serves
 * `entries[]` for both runs, the summary texts the host fed on the fork MUST be
 * the source's, byte for byte — the replay MUST NOT re-summarize, on the text.
 * Both majors: major 2 reads `summarization` by presence (the v2 schema has no
 * `supported` seat) and records `inapplicable`, never a strict-mode failure,
 * when it is absent. Gated on the live fixture `conformance-context-budget-live`.
 *
 * @see RFCS/0111-context-economy.md
 * @see spec/v1/multi-agent-execution.md §"Context economy (RFC 0111)"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { queryTestEvents, type TestEvent } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
import { seamsProfileAdvertised, targetMajor } from '../lib/seams.js';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { runsPath } from '../lib/memoryAttribution.js';
import { parseTranscriptWindow, summarizationDeclared, summaryTexts, type LogEvent } from '../lib/context-budget.js';

const FIXTURE = 'conformance-context-budget-live';
const PROFILE = 'openwop-context-summarization';
const ID = 'openwop.it.context-summarization-replay.replay-reuses-the-recorded-context-summarized-summaryref-never-re-summarizes';
const MAX_ITERATIONS_PROBED = 16;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function recordAt(v: unknown, ...keys: string[]): Record<string, unknown> | undefined {
  let cur: unknown = v;
  for (const k of keys) cur = isRecord(cur) ? cur[k] : undefined;
  return isRecord(cur) ? cur : undefined;
}
function stringArrayOf(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;
}
function runIdOf(v: unknown): string | undefined {
  const r = isRecord(v) ? v['runId'] : undefined;
  return typeof r === 'string' ? r : undefined;
}
function replayModesOf(v: unknown): string[] {
  return stringArrayOf(recordAt(v, 'replay')?.['modes']) ?? [];
}
/** A summary fingerprint: summaryRef plus the (ordered) replaced-turn ids. */
function summaryFingerprints(events: readonly TestEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type !== 'context.summarized') continue;
    const ref = e.payload['summaryRef'];
    const replaced = stringArrayOf(e.payload['replacedTurns']);
    expect(typeof ref === 'string' && replaced !== undefined, req(ID, 'RFC 0111', 'a context.summarized event MUST carry summaryRef + replacedTurns')).toBe(true);
    if (typeof ref === 'string' && replaced !== undefined) out.push(`${ref}::${replaced.join(',')}`);
  }
  return out.sort();
}
const toLog = (events: readonly TestEvent[]): LogEvent[] => events.map((e) => ({ eventId: e.eventId, type: e.type, sequence: e.sequence, payload: e.payload }));

/** The summary texts the host fed across a run's iterations, via the seam; null when the seam or entries[] are not served. */
async function fedSummaryTexts(runId: string, log: readonly LogEvent[]): Promise<string[] | null> {
  const out: string[] = [];
  let served = false;
  for (let iteration = 1; iteration <= MAX_ITERATIONS_PROBED; iteration += 1) {
    const res = await driver.get(`/v1/host/sample/agent/transcript-window?runId=${encodeURIComponent(runId)}&iteration=${iteration}`);
    if (res.status !== 200) break;
    const w = parseTranscriptWindow(res.json);
    if (w?.entries === undefined) return null;
    served = true;
    out.push(...summaryTexts(w, log));
  }
  return served ? out : null;
}

describe('context-summarization-replay (RFC 0111 §"Replay determinism")', () => {
  it('replay reuses the recorded context.summarized summaryRef — never re-summarizes', async () => {
    const major = targetMajor();
    let wellKnown: unknown;
    if (major === 2) {
      const doc = await v2Discovery();
      if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
      const cb = recordAt(await familyAdvertised('multiAgent'), 'executionModel', 'contextBudget');
      if (!summarizationDeclared(cb, 2)) return softSkip('inapplicable', 'multiAgent.executionModel.contextBudget.summarization is not advertised at major 2');
      if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the run event-log is read through the seams profile — conformance.seamsProfile is not openwop-conformance-seams-v2');
      wellKnown = doc;
    } else {
      const cb = recordAt(await readCapabilityFamily<Record<string, unknown>>('multiAgent'), 'executionModel', 'contextBudget');
      if (!behaviorGate(PROFILE, summarizationDeclared(cb, 1))) return;
      wellKnown = (await driver.get('/.well-known/openwop')).json;
    }
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `the live fixture ${FIXTURE} is not advertised — RFC 0111 §Scope forbids a mock supervisor from advertising contextBudget`);

    const create = await driver.post(runsPath(), { workflowId: FIXTURE });
    expect(create.status, req(ID, 'RFC 0111', `POST ${runsPath()} MUST create the live-fixture run`)).toBe(201);
    const sourceRunId = runIdOf(create.json);
    expect(sourceRunId, req(ID, 'rest-endpoints.md POST /v1/runs', 'the create response MUST carry a runId')).toBeDefined();
    if (sourceRunId === undefined) return softSkip('blocked', 'no runId');
    await pollUntilTerminal(sourceRunId);

    const sourceQ = await queryTestEvents(sourceRunId);
    if (!sourceQ.ok) return softSkip('blocked', 'the run event-log seam is unavailable');
    const sourceFingerprints = summaryFingerprints(sourceQ.events);
    if (sourceFingerprints.length === 0) {
      return softSkip('blocked', 'the live run produced no context.summarized event — a host advertising summarization must summarize this fixture for reuse to be observable');
    }
    if (!replayModesOf(wellKnown).includes('replay')) return softSkip('inapplicable', 'the host advertises no replay fork mode');

    const fork = await driver.post(`${runsPath()}/${encodeURIComponent(sourceRunId)}:fork`, { fromSeq: 0, mode: 'replay' });
    if (fork.status === 501 || fork.status === 404) return softSkip('blocked', `replay fork answered ${fork.status}`);
    expect(fork.status, req(ID, 'rest-endpoints.md POST /v1/runs/{runId}:fork', 'replay fork MUST return 201')).toBe(201);
    const forkRunId = runIdOf(fork.json);
    expect(forkRunId, req(ID, 'rest-endpoints.md POST /v1/runs/{runId}:fork', 'replay fork MUST return a runId')).toBeDefined();
    if (forkRunId === undefined) return softSkip('blocked', 'no fork runId');
    await pollUntilTerminal(forkRunId);

    const forkQ = await queryTestEvents(forkRunId);
    if (!forkQ.ok) return softSkip('blocked', 'the event-log seam is unavailable for the fork');
    expect(summaryFingerprints(forkQ.events), req(ID, 'RFC 0111 §"Replay determinism"', 'a replay fork MUST reuse the recorded context.summarized summaryRef (never re-summarize to a different transcript)')).toEqual(sourceFingerprints);

    // The model-facing half: the summary TEXT the host fed on the fork.
    const sourceTexts = await fedSummaryTexts(sourceRunId, toLog(sourceQ.events));
    const forkTexts = await fedSummaryTexts(forkRunId, toLog(forkQ.events));
    if (sourceTexts === null || forkTexts === null) return softSkip('inapplicable', 'the transcript-window seam serves no entries[] for these runs, so the model-facing summary text was not compared (summaryRef reuse was)');
    expect(sourceTexts.length, req(ID, 'RFC 0111 §"Replay determinism"', 'the source run summarized, so its transcript windows MUST carry the summary text it fed')).toBeGreaterThan(0);
    expect(forkTexts, req(ID, 'RFC 0111 §"Replay determinism"', 'the replay MUST feed the model the recorded summary text, byte for byte — never a re-summarization')).toEqual(sourceTexts);
    return undefined;
  });
});

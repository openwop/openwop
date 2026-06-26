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

const FIXTURE = 'conformance-context-budget-multiturn';
const PROFILE = 'openwop-context-summarization';

interface SummarizationCap {
  readonly supported?: boolean;
}
interface ContextBudgetCap {
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
function stringOf(v: unknown): string | undefined {
  return isString(v) ? v : undefined;
}
function stringArrayOf(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every(isString) ? v : undefined;
}
function runIdOf(v: unknown): string | undefined {
  return isRecord(v) ? stringOf(v['runId']) : undefined;
}
function replayModesOf(v: unknown): string[] {
  if (!isRecord(v)) return [];
  const replay = v['replay'];
  if (!isRecord(replay)) return [];
  return stringArrayOf(replay['modes']) ?? [];
}

/** A summary fingerprint: summaryRef plus the (ordered) replaced-turn ids. */
function summaryFingerprint(e: TestEvent): string | undefined {
  const ref = stringOf(e.payload['summaryRef']);
  const replaced = stringArrayOf(e.payload['replacedTurns']);
  if (ref === undefined || replaced === undefined) return undefined;
  return `${ref}::${replaced.join(',')}`;
}

function summaryFingerprints(events: readonly TestEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type !== 'context.summarized') continue;
    const fp = summaryFingerprint(e);
    expect(fp, 'a context.summarized event MUST carry summaryRef + replacedTurns').toBeDefined();
    if (fp !== undefined) out.push(fp);
  }
  return out.sort();
}

describe('context-summarization-replay (RFC 0111 §"Replay determinism")', () => {
  it('replay reuses the recorded context.summarized summaryRef — never re-summarizes', async () => {
    const ma = await readCapabilityFamily<MultiAgentCap>('multiAgent');
    const summarizationSupported = ma?.executionModel?.contextBudget?.summarization?.supported === true;
    if (!behaviorGate(PROFILE, summarizationSupported)) return;
    if (!isFixtureAdvertised(FIXTURE)) return; // fixture-gated soft-skip

    // Drive the multi-turn orchestrator run.
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const sourceRunId = runIdOf(create.json);
    expect(sourceRunId, 'POST /v1/runs MUST return a runId').toBeDefined();
    if (sourceRunId === undefined) return;
    await pollUntilTerminal(sourceRunId);

    // Read the recorded summarization records (OPTIONAL event-log seam).
    const sourceQ = await queryTestEvents(sourceRunId, { type: 'context.summarized' });
    if (!sourceQ.ok) return; // event-log seam unwired — soft-skip
    const sourceFingerprints = summaryFingerprints(sourceQ.events);
    if (sourceFingerprints.length === 0) {
      // The run did not summarize (budget not exceeded on this host) — nothing
      // to prove about reuse. Honest soft-skip; not a vacuous pass of the MUST.
      // eslint-disable-next-line no-console
      console.warn(`[${PROFILE}] run produced no context.summarized events; replay-reuse leg soft-skipped`);
      return;
    }

    // Only attempt replay when the host advertises the replay fork mode.
    const wellKnown = await driver.get('/.well-known/openwop');
    if (!replayModesOf(wellKnown.json).includes('replay')) return;

    const fork = await driver.post(
      `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
      { fromSeq: 0, mode: 'replay' },
    );
    if (fork.status === 501 || fork.status === 404) return; // replay not implemented for this run — soft-skip
    expect(
      fork.status,
      driver.describe('rest-endpoints.md POST /v1/runs/{runId}:fork', 'replay fork MUST return 201'),
    ).toBe(201);
    const forkRunId = runIdOf(fork.json);
    expect(forkRunId, 'replay fork MUST return a runId').toBeDefined();
    if (forkRunId === undefined) return;
    await pollUntilTerminal(forkRunId);

    const forkQ = await queryTestEvents(forkRunId, { type: 'context.summarized' });
    if (!forkQ.ok) return; // event-log seam unwired for the fork — soft-skip
    const forkFingerprints = summaryFingerprints(forkQ.events);

    // The replay MUST reuse the recorded summaries (same summaryRef + replacedTurns),
    // NOT regenerate them — the direct analogue of RFC 0041 envelope-refusal recovery.
    expect(
      forkFingerprints,
      driver.describe(
        'RFC 0111 §"Replay determinism"',
        'a replay fork MUST reuse the recorded context.summarized summaryRef (never re-summarize to a different transcript)',
      ),
    ).toEqual(sourceFingerprints);
  });
});

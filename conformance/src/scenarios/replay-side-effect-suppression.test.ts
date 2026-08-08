/**
 * Replay side-effect suppression — verifies `spec/v1/replay.md`
 * §"Side-effect suppression in replay" (RFC 0140).
 *
 * WHAT THIS EXISTS TO CATCH, and why the event log cannot catch it:
 *
 *   A replayed side-effecting node that FIRES and records its outcome
 *   identically to the source produces an event log byte-indistinguishable
 *   from one that was correctly suppressed. Every existing replay scenario
 *   (`replay-fork.test.ts`, `replayDeterminism.test.ts`,
 *   `replay-fork-arbitrary.test.ts`) asserts on the event log, so all three
 *   pass green against a host that re-sends the email on every replay. The
 *   only way to tell the two apart is to count effects OUTSIDE the log —
 *   hence the `GET /v1/host/sample/replay/effect-count` seam
 *   (`host-sample-test-seams.md` §20).
 *
 * Legs:
 *   1. The source run fires exactly one effect.        (counter is real)
 *   2. A `mode:"replay"` fork reaches terminal.
 *   3. The effect count has NOT moved.                 (the load-bearing one)
 *   4. Replaying past a node the source never recorded fails closed with
 *      `replay_source_missing`, and still fires nothing.
 *
 * NON-VACUITY: legs 1 and 4 pin the counter from both ends — a constant-zero
 * counter reds leg 1, a constant-N counter reds leg 4's no-increment check.
 * Without both, leg 3 is satisfiable by a seam that returns a fixed number.
 *
 * WHAT A GREEN RUN DOES *NOT* PROVE: coverage. The counter observes the paths
 * the host routes through its counted seam; a leak through an uncounted path is
 * invisible to the suite AND to the counter. That is precisely why rule 5
 * requires a default-deny guard rather than an enumeration of effects. See
 * `coverage.md` §"Replay side-effect suppression counts, it does not enumerate".
 *
 * Gating: `behaviorGate` on `replay.sideEffectSuppression === 'recorded-outcome'`.
 * `none` (and absent, which defaults to it) means the host declares NO
 * mechanism — which is NOT permission to re-fire, since caveat 1 binds every
 * host unconditionally; it means the guarantee is unprobeable here.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { behaviorGate, behaviorGatePresent } from '../lib/behavior-gate.js';
import {
  readReplayCap,
  sideEffectSuppressionDeclared,
  replayModes,
  readEffectCount,
  readNodeFailures,
} from '../lib/replaySideEffect.js';

const PROFILE = 'openwop-replay-side-effect-suppression';
const EFFECT_WORKFLOW_ID = 'conformance-replay-effect';
const UNREACHED_WORKFLOW_ID = 'conformance-replay-effect-unreached';

const SKIP_NO_EFFECT_FIXTURE = !isFixtureAdvertised(EFFECT_WORKFLOW_ID);
const SKIP_NO_UNREACHED_FIXTURE = !isFixtureAdvertised(UNREACHED_WORKFLOW_ID);

/** True when the host declares the mechanism AND advertises the `replay` mode it applies to. */
async function suppressionProbeable(): Promise<boolean> {
  const cap = await readReplayCap();
  return sideEffectSuppressionDeclared(cap) && replayModes(cap).includes('replay');
}

async function startRun(workflowId: string, inputs?: Record<string, unknown>): Promise<string> {
  const create = await driver.post('/v1/runs', inputs ? { workflowId, inputs } : { workflowId });
  if (create.status !== 201) {
    throw new Error(`Failed to start ${workflowId}: ${create.status}`);
  }
  return (create.json as { runId: string }).runId;
}

async function forkReplay(sourceRunId: string): Promise<{ status: number; runId: string | undefined }> {
  const fork = await driver.post(
    `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
    { fromSeq: 0, mode: 'replay' },
  );
  const runId = (fork.json as { runId?: unknown } | undefined)?.runId;
  return { status: fork.status, runId: typeof runId === 'string' ? runId : undefined };
}

describe.skipIf(SKIP_NO_EFFECT_FIXTURE)('replay side-effect suppression: a replay does not re-fire (RFC 0140)', () => {
  it('the source fires exactly one effect and the replay fires none', async () => {
    if (!behaviorGate(PROFILE, await suppressionProbeable())) return;

    // Leg 1 — the source run fires exactly one effect.
    const sourceRunId = await startRun(EFFECT_WORKFLOW_ID);
    const sourceTerminal = await pollUntilTerminal(sourceRunId, { timeoutMs: 15_000 });
    expect(sourceTerminal.status, driver.describe(
      'replay.md §"Side-effect suppression in replay"',
      'the source run MUST reach `completed` so it records an outcome for the side-effecting node',
    )).toBe('completed');

    const sourceCount = await readEffectCount(sourceRunId);
    if (!behaviorGatePresent(PROFILE, sourceCount)) return; // seam absent: skip default, FAIL strict
    expect(sourceCount, driver.describe(
      'host-sample-test-seams.md §20',
      'the source run MUST have fired exactly one effect — a counter that cannot count the ORIGINAL effect cannot witness its absence on replay',
    )).toBe(1);

    // Leg 2 — the replay fork reaches terminal.
    const fork = await forkReplay(sourceRunId);
    expect(fork.status, driver.describe(
      'rest-endpoints.md POST /v1/runs/{runId}:fork',
      'a replay fork MUST return 201 on a host advertising sideEffectSuppression',
    )).toBe(201);
    const replayRunId = fork.runId;
    expect(typeof replayRunId, 'fork response MUST include a new runId').toBe('string');
    if (typeof replayRunId !== 'string') return;

    await pollUntilTerminal(replayRunId, { timeoutMs: 15_000 });

    // Leg 3 — THE LOAD-BEARING ASSERTION. Counted per-run, because a host that
    // (incorrectly) fires during a replay increments the REPLAY's count, not
    // the source's — so checking only the source would miss the whole defect.
    const replayCount = await readEffectCount(replayRunId);
    if (!behaviorGatePresent(PROFILE, replayCount)) return;
    expect(replayCount, driver.describe(
      'replay.md §"Side-effect suppression in replay" rule 1',
      'a replayed side-effecting node MUST NOT execute its effect — the replay run MUST have fired zero effects',
    )).toBe(0);

    // ...and the source's count MUST NOT have moved either, in case a host
    // attributes a replay's effects back to the source run.
    const sourceCountAfter = await readEffectCount(sourceRunId);
    if (!behaviorGatePresent(PROFILE, sourceCountAfter)) return;
    expect(sourceCountAfter, driver.describe(
      'replay.md §"Side-effect suppression in replay" rule 1',
      'replaying a run MUST NOT add effects to the source run either',
    )).toBe(1);
  }, 60_000);
});

describe.skipIf(SKIP_NO_UNREACHED_FIXTURE)('replay side-effect suppression: fail closed on a missing source outcome (RFC 0140)', () => {
  it('a replay reaching an unrecorded side-effecting node fails `replay_source_missing` and fires nothing', async () => {
    if (!behaviorGate(PROFILE, await suppressionProbeable())) return;

    // Build a source run that terminates WITHOUT recording an outcome for the
    // side-effecting node: start it behind a long delay, then cancel mid-flight.
    const sourceRunId = await startRun(UNREACHED_WORKFLOW_ID, { delayMs: 30_000 });
    const cancel = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:cancel`, {});
    if (cancel.status < 200 || cancel.status >= 300) {
      // Cancellation is how this scenario manufactures an unrecorded node. A
      // host that cannot cancel cannot be probed this way — skip rather than
      // report a suppression failure that is really a cancellation failure.
      return;
    }
    const sourceTerminal = await pollUntilTerminal(sourceRunId, { timeoutMs: 15_000 });
    expect(sourceTerminal.status, driver.describe(
      'rest-endpoints.md POST /v1/runs/{runId}:cancel',
      'the source run MUST reach `cancelled` so the side-effecting node has no recorded outcome',
    )).toBe('cancelled');

    const sourceCount = await readEffectCount(sourceRunId);
    if (!behaviorGatePresent(PROFILE, sourceCount)) return;
    expect(sourceCount, driver.describe(
      'replay.md §"Side-effect suppression in replay" rule 3',
      'the cancelled source MUST NOT have reached the side-effecting node',
    )).toBe(0);

    const fork = await forkReplay(sourceRunId);
    expect(fork.status, driver.describe(
      'rest-endpoints.md POST /v1/runs/{runId}:fork',
      'the fork request itself MUST still return 201 — `replay_source_missing` is a NODE failure, not a fork rejection',
    )).toBe(201);
    const replayRunId = fork.runId;
    if (typeof replayRunId !== 'string') return;

    await pollUntilTerminal(replayRunId, { timeoutMs: 30_000 });

    // The pure `core.delay` node re-executes live (rule 4), so the replay
    // reaches `effect` — for which the source recorded nothing.
    const failures = await readNodeFailures(replayRunId);
    const effectFailure = failures.find((f) => f.nodeId === 'effect');
    expect(effectFailure?.code, driver.describe(
      'replay.md §"Side-effect suppression in replay" rule 3',
      'a side-effecting node with no recorded source outcome MUST fail closed with `replay_source_missing` — never a synthesized success',
    )).toBe('replay_source_missing');

    // The fail-closed path MUST NOT have fired the effect. This is also what
    // makes leg 3 non-vacuous: a seam returning a constant reds here.
    const replayCount = await readEffectCount(replayRunId);
    if (!behaviorGatePresent(PROFILE, replayCount)) return;
    expect(replayCount, driver.describe(
      'replay.md §"Side-effect suppression in replay" rule 3',
      'failing closed MUST NOT execute the effect',
    )).toBe(0);
  }, 90_000);
});

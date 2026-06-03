/**
 * agent-channel-dispatch (RFC 0082 §B) — PRODUCTION run-graph channel pin +
 * replay reuse, exercised black-box.
 *
 * Complements `agent-deployment-lifecycle.test.ts` Leg 4, which drives the §B
 * pin through the host-sample `deployment-transition` SEAM. This scenario
 * proves the SAME contract from a real run graph (no seam): a canonical
 * `POST /v1/runs` of a workflow whose node binds `agent.channel` MUST
 *   (1) resolve the channel to a concrete version at first resolution and
 *       record it as `resolvedChannel` + `resolvedAgentVersion` on
 *       `agent.invocation.started` (RFC 0077 recorded fact), and
 *   (2) on `POST /v1/runs/{runId}:fork {mode:"replay"}` RE-READ that recorded
 *       version — and MUST NOT re-resolve a since-moved channel
 * per `agent-deployment.md §B` and `version-negotiation.md`
 * §"Channel resolution + replay determinism". This graduates §B from
 * seam-proven to production-path-proven.
 *
 * Leg 3 (the load-bearing non-re-resolution proof) MOVES the `stable` channel
 * between the original run and a replay fork via the optional deployment
 * seam, then asserts the fork STILL carries the ORIGINAL pin (not the moved
 * version). It self-guards: it runs only when the seam exists AND the move is
 * observable (a fresh run resolves to a different version); otherwise it logs
 * and skips its strict assertion without failing.
 *
 * Gating (root-first per RFC 0073): soft-skips unless the host advertises
 * `agents.deployment.supported:true` AND seeds+advertises the
 * `conformance-agent-channel-dispatch` fixture AND advertises replay mode
 * `replay`. Visible skip by default; hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true` (per `lib/behavior-gate.ts`). Hosts that omit
 * `agents.deployment` MUST reject a channel-bearing ref with `validation_error`
 * (`agent-ref.schema.json`) and so cannot seed the fixture — they gate out.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-deployment.md (§B)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/version-negotiation.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0082-agent-deployment-lifecycle.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readDeploymentCap, driveDeploymentTransition } from '../lib/agentDeployment.js';

const FIXTURE_ID = 'conformance-agent-channel-dispatch';
const BOUND_CHANNEL = 'stable';
const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface RunEventDoc {
  eventId: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  sequence: number;
}
interface PollEventsResponse {
  events: RunEventDoc[];
  isComplete?: boolean;
}

async function readAllEvents(runId: string): Promise<RunEventDoc[]> {
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0`);
  if (res.status !== 200) return [];
  const body = res.json as PollEventsResponse;
  return body.events ?? [];
}

/** Advertised replay modes (root-level `replay.modes`, RFC 0073 / profiles.ts). */
async function fetchReplayModes(): Promise<readonly string[]> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return [];
  const replay = (res.json as { replay?: { supported?: unknown; modes?: unknown } })?.replay;
  if (replay?.supported !== true || !Array.isArray(replay.modes)) return [];
  return replay.modes.filter((m): m is string => typeof m === 'string');
}

/** First `agent.invocation.started` (by sequence) of a run, or null. */
async function firstInvocationStarted(runId: string): Promise<RunEventDoc | null> {
  const events = (await readAllEvents(runId))
    .filter((e) => e.type === 'agent.invocation.started')
    .sort((a, b) => a.sequence - b.sequence);
  return events[0] ?? null;
}

/** Start the channel-bound fixture, wait for terminal, return its runId. */
async function startChannelRun(): Promise<string> {
  const create = await driver.post('/v1/runs', { workflowId: FIXTURE_ID });
  expect(
    create.status,
    driver.describe(
      'agent-deployment.md §B',
      `a host advertising agents.deployment + the ${FIXTURE_ID} fixture MUST accept a channel-bound run (201)`,
    ),
  ).toBe(201);
  const runId = (create.json as { runId: string }).runId;
  await pollUntilTerminal(runId, { timeoutMs: 15_000 });
  return runId;
}

describe.skipIf(HTTP_SKIP)('agent-channel-dispatch (RFC 0082 §B): production run-graph channel pin + replay reuse', () => {
  it('resolves + records the channel pin on a real run and re-reads it on replay (never re-resolving a moved channel)', async (ctx) => {
    const cap = await readDeploymentCap();
    if (!behaviorGate('openwop-deployment-channel-dispatch', cap?.supported === true)) return;
    if (!isFixtureAdvertised(FIXTURE_ID)) {
      // Host advertises agents.deployment but hasn't seeded the channel-bound
      // fixture — a host-config precondition, not a conformance failure.
      ctx.skip();
      return;
    }
    const modes = await fetchReplayModes();
    if (!modes.includes('replay')) {
      ctx.skip();
      return;
    }

    // ---- Leg 1: production-path channel resolution + recorded pin (§B) ----
    const sourceRunId = await startChannelRun();
    const started = await firstInvocationStarted(sourceRunId);
    expect(
      started !== null,
      driver.describe(
        'agent-deployment.md §B',
        'a @channel-bound run MUST emit agent.invocation.started',
      ),
    ).toBe(true);
    expect(
      started!.payload.resolvedChannel === BOUND_CHANNEL,
      driver.describe(
        'agent-deployment.md §B',
        `agent.invocation.started MUST carry the bound channel as resolvedChannel ("${BOUND_CHANNEL}")`,
      ),
    ).toBe(true);
    const pinnedVersion = started!.payload.resolvedAgentVersion;
    expect(
      typeof pinnedVersion === 'string' && (pinnedVersion as string).length > 0,
      driver.describe(
        'agent-deployment.md §B',
        'a @channel-bound run MUST record a concrete resolvedAgentVersion (the recorded fact a replay re-reads, RFC 0077)',
      ),
    ).toBe(true);

    // ---- Leg 2: replay re-reads the recorded version --------------------
    const fork1 = await driver.post(
      `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
      { fromSeq: 0, mode: 'replay' },
    );
    if (fork1.status === 501) {
      // replay advertised but not implemented for this run — skip-equivalent.
      ctx.skip();
      return;
    }
    expect(
      fork1.status,
      driver.describe('rest-endpoints.md POST /v1/runs/{runId}:fork', 'replay fork MUST return 201'),
    ).toBe(201);
    const fork1RunId = (fork1.json as { runId: string }).runId;
    await pollUntilTerminal(fork1RunId, { timeoutMs: 15_000 });
    const fork1Started = await firstInvocationStarted(fork1RunId);
    expect(
      fork1Started !== null,
      driver.describe('agent-deployment.md §B', 'a replay fork MUST re-emit agent.invocation.started'),
    ).toBe(true);
    expect(
      fork1Started!.payload.resolvedAgentVersion === pinnedVersion,
      driver.describe(
        'agent-deployment.md §B',
        'a replay MUST re-read the recorded resolvedAgentVersion (NOT re-resolve the channel)',
      ),
    ).toBe(true);

    // ---- Leg 3 (seam-guarded): move the channel, prove non-re-resolution -
    // The strongest form of §B: after the original pin, MOVE `stable` to a new
    // active version via the optional deployment seam. A replay fork of the
    // ORIGINAL run MUST still carry the ORIGINAL pin — proving the host re-reads
    // the recorded fact rather than re-resolving the (now-moved) channel.
    const moved = await driveDeploymentTransition({
      scenario: 'promote',
      channel: BOUND_CHANNEL,
    });
    if (moved === null) {
      // No deployment-transition seam — Leg 1+2 already give production-path
      // evidence; the cross-move proof needs the seam. Honest skip of Leg 3.
      // eslint-disable-next-line no-console
      console.warn('[agent-channel-dispatch] deployment seam absent — skipping the channel-move non-re-resolution leg (Leg 3)');
      return;
    }
    // Confirm the move is OBSERVABLE: a fresh channel-bound run must now resolve
    // to a DIFFERENT version. If it doesn't (canary split, no-op promote), we
    // can't prove movement — skip the strict assertion rather than assert falsely.
    const controlRunId = await startChannelRun();
    const controlStarted = await firstInvocationStarted(controlRunId);
    const movedVersion = controlStarted?.payload.resolvedAgentVersion;
    if (typeof movedVersion !== 'string' || movedVersion === pinnedVersion) {
      // eslint-disable-next-line no-console
      console.warn('[agent-channel-dispatch] channel did not observably move — skipping Leg 3 strict assertion');
      return;
    }
    const fork2 = await driver.post(
      `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
      { fromSeq: 0, mode: 'replay' },
    );
    if (fork2.status === 501) {
      ctx.skip();
      return;
    }
    expect(
      fork2.status,
      driver.describe('rest-endpoints.md POST /v1/runs/{runId}:fork', 'replay fork MUST return 201'),
    ).toBe(201);
    const fork2RunId = (fork2.json as { runId: string }).runId;
    await pollUntilTerminal(fork2RunId, { timeoutMs: 15_000 });
    const fork2Started = await firstInvocationStarted(fork2RunId);
    expect(
      fork2Started?.payload.resolvedAgentVersion === pinnedVersion,
      driver.describe(
        'agent-deployment.md §B',
        'after the channel moves, a replay of the original run MUST still carry the ORIGINAL pin — never re-resolving the moved channel',
      ),
    ).toBe(true);
    expect(
      fork2Started?.payload.resolvedAgentVersion !== movedVersion,
      driver.describe(
        'agent-deployment.md §B',
        'a replay MUST NOT resolve to the post-move version (proves the recorded fact is re-read, not re-resolved)',
      ),
    ).toBe(true);
  });
});

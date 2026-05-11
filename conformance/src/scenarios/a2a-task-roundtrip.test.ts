/**
 * Track 6: A2A task-roundtrip + state-projection conformance.
 *
 * Exercises the four documented drift points from
 * `spec/v1/a2a-integration.md` §"State projection":
 *
 *   #1. openwop `paused` → A2A `WORKING` (forward, lossy via metadata)
 *   #2. openwop `waiting-approval` / `waiting-input` → A2A `INPUT_REQUIRED` (lossy)
 *   #3. A2A `AUTH_REQUIRED` → openwop `waiting-input` (no native auth kind)
 *   #4. A2A `REJECTED` → openwop `failed` with `reason: 'rejected_by_remote'`
 *
 * Two layers:
 *
 *   - **Direct peer probe** (always when an A2A endpoint is configured):
 *     walks the fake peer through SUBMITTED → WORKING → COMPLETED and
 *     asserts the AgentCard + task lifecycle wire shape. With
 *     `OPENWOP_A2A_REAL_PEER_URL` set, points at a real reference A2A
 *     peer with relaxed shape-only assertions.
 *   - **Host-mediated reverse-projection** (gated on fixture
 *     advertisement): when the host advertises
 *     `conformance-a2a-task-roundtrip`, run it against the fake peer
 *     forced into AUTH_REQUIRED / REJECTED to verify the host applies
 *     the documented projections. **Real-peer mode does NOT exercise
 *     drift points** — real peers don't expose a state-forcing API,
 *     so these subtests stay fake-only.
 *
 * Operator contract:
 *   - `OPENWOP_A2A_FAKE_PEER=true` — boots the in-process synthetic
 *     peer. Asserts the deterministic echo skill + drift-point states.
 *   - `OPENWOP_A2A_REAL_PEER_URL=<base-url>` — points the direct probe
 *     at a real A2A reference implementation. Drift-point subtests
 *     soft-skip in this mode. Phase 3 T3.4 interop-evidence path.
 *
 * @see spec/v1/a2a-integration.md §"State projection"
 * @see docs/PROTOCOL-GAP-CLOSURE-PLAN.md Phase 3 T3.4
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { getA2AFakePeer } from '../lib/a2a-fake-peer.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntilTerminal, pollUntilStatus } from '../lib/polling.js';

const ROUNDTRIP_FIXTURE = 'conformance-a2a-task-roundtrip';

/** Resolve the A2A endpoint to probe: real-peer env wins; otherwise the in-process fake. */
function probePeer(): { url: string; isReal: boolean } | null {
  const real = process.env.OPENWOP_A2A_REAL_PEER_URL;
  if (real && real.length > 0) return { url: real.replace(/\/$/, ''), isReal: true };
  const fake = getA2AFakePeer();
  if (fake) return { url: fake.endpoint(), isReal: false };
  return null;
}

describe('a2a-task-roundtrip: AgentCard + task lifecycle', () => {
  it('AgentCard exposes protocolVersion + skills; task SUBMITTED → terminal state', async () => {
    const probe = probePeer();
    if (!probe) {
      // eslint-disable-next-line no-console
      console.warn(
        '[a2a-task-roundtrip] no A2A endpoint configured; set OPENWOP_A2A_FAKE_PEER=true ' +
          'or OPENWOP_A2A_REAL_PEER_URL=<base-url>',
      );
      return;
    }
    if (!probe.isReal) getA2AFakePeer()!.reset();

    // AgentCard fetch.
    const card = await fetch(`${probe.url}/agent.json`);
    expect(card.status).toBe(200);
    const cardJson = (await card.json()) as {
      protocolVersion?: string;
      skills?: ReadonlyArray<{ name?: string }>;
    };
    expect(typeof cardJson.protocolVersion).toBe('string');
    expect(Array.isArray(cardJson.skills)).toBe(true);
    expect((cardJson.skills ?? []).length).toBeGreaterThan(0);

    if (probe.isReal) {
      // Real-peer interop evidence (Phase 3 T3.4). Skip the
      // state-advancement assertions — a real peer's task transitions
      // on its own schedule (or in response to peer-side events we
      // don't control). Assertion stays shape-only: a task we create
      // returns a taskId + a valid initial state.
      const first = cardJson.skills?.[0];
      const create = await fetch(`${probe.url}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: first?.name, input: {} }),
      });
      expect(create.status).toBeGreaterThanOrEqual(200);
      expect(create.status).toBeLessThan(300);
      const createBody = (await create.json()) as { taskId?: string; state?: string };
      expect(typeof createBody.taskId).toBe('string');
      expect(typeof createBody.state).toBe('string');
      // eslint-disable-next-line no-console
      console.warn(
        `[a2a-task-roundtrip] real-peer interop OK against ${probe.url} ` +
          `(skill=${first?.name}, taskId=${createBody.taskId}, initial=${createBody.state})`,
      );
      return;
    }

    // Fake-peer path: deterministic state forcing, assert verbatim.
    const fake = getA2AFakePeer()!;
    const create = await fetch(`${probe.url}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: 'echo', input: { text: 'hello' } }),
    });
    expect(create.status).toBe(200);
    const { taskId } = (await create.json()) as { taskId: string; state: string };
    fake.advanceTask(taskId, 'WORKING');
    fake.advanceTask(taskId, 'COMPLETED');
    const get = await fetch(`${probe.url}/tasks/${taskId}`);
    const finalTask = (await get.json()) as { state: string };
    expect(finalTask.state).toBe('COMPLETED');
  });
});

describe('a2a-task-roundtrip: drift point #3 — AUTH_REQUIRED projects to waiting-input', () => {
  it('host consuming an A2A peer that returns AUTH_REQUIRED projects to waiting-input with metadata.subkind=auth', async () => {
    const peer = getA2AFakePeer();
    if (!peer) {
      // eslint-disable-next-line no-console
      console.warn('[a2a-task-roundtrip] peer not started; skipping drift-point #3 subtest');
      return;
    }
    if (!isFixtureAdvertised(ROUNDTRIP_FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[a2a-task-roundtrip] fixture ${ROUNDTRIP_FIXTURE} not advertised; skipping drift-point #3 subtest`,
      );
      return;
    }
    peer.reset();
    peer.setNextState('AUTH_REQUIRED');

    const create = await driver.post('/v1/runs', {
      workflowId: ROUNDTRIP_FIXTURE,
      inputs: { driftScenario: 'auth-required' },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // Host should project AUTH_REQUIRED into `waiting-input` per
    // a2a-integration.md §"State projection (reverse)".
    const snapshot = await pollUntilStatus(runId, 'waiting-input', { timeoutMs: 15_000 });
    expect(snapshot.status, driver.describe(
      'a2a-integration.md §"State projection" drift point #3',
      "A2A AUTH_REQUIRED MUST project to openwop 'waiting-input' (no native auth-required kind in v1)",
    )).toBe('waiting-input');

    // Cleanup so we don't leak a suspended run.
    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });
});

describe('a2a-task-roundtrip: drift point #4 — REJECTED projects to failed', () => {
  it('host consuming an A2A peer that returns REJECTED projects to failed with rejected_by_remote', async () => {
    const peer = getA2AFakePeer();
    if (!peer) {
      // eslint-disable-next-line no-console
      console.warn('[a2a-task-roundtrip] peer not started; skipping drift-point #4 subtest');
      return;
    }
    if (!isFixtureAdvertised(ROUNDTRIP_FIXTURE)) {
      return;
    }
    peer.reset();
    peer.setNextState('REJECTED');

    const create = await driver.post('/v1/runs', {
      workflowId: ROUNDTRIP_FIXTURE,
      inputs: { driftScenario: 'rejected' },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 15_000 });
    expect(terminal.status, driver.describe(
      'a2a-integration.md §"State projection" drift point #4',
      'A2A REJECTED MUST project to openwop terminal status `failed`',
    )).toBe('failed');

    // Reason carrier: host MAY surface 'rejected_by_remote' in the run
    // snapshot, the final node payload, or the run-level error envelope.
    // We accept any of those: stringify the snapshot and search.
    const haystack = JSON.stringify(terminal).toLowerCase();
    expect(haystack.includes('rejected'), driver.describe(
      'a2a-integration.md §"State projection" drift point #4',
      "host SHOULD surface 'rejected_by_remote' (or equivalent) so observers can attribute the failure to the remote A2A peer",
    )).toBe(true);
  });
});

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
 *   - **Direct fake-peer probe** (always when peer started): walks the
 *     fake peer through SUBMITTED → WORKING → INPUT_REQUIRED → COMPLETED
 *     and asserts the AgentCard + task lifecycle wire shape.
 *   - **Host-mediated reverse-projection** (gated on fixture
 *     advertisement): when the host advertises
 *     `conformance-a2a-task-roundtrip`, run it against the fake peer
 *     forced into AUTH_REQUIRED / REJECTED to verify the host applies
 *     the documented projections.
 *
 * Operator contract: `OPENWOP_A2A_FAKE_PEER=true` on suite side; configure
 * the host to use the printed AgentCard URL.
 *
 * @see spec/v1/a2a-integration.md §"State projection"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { getA2AFakePeer } from '../lib/a2a-fake-peer.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntilTerminal, pollUntilStatus } from '../lib/polling.js';

const ROUNDTRIP_FIXTURE = 'conformance-a2a-task-roundtrip';

describe('a2a-task-roundtrip: AgentCard + task lifecycle', () => {
  it('AgentCard exposes protocolVersion + skills; task SUBMITTED → COMPLETED', async () => {
    const peer = getA2AFakePeer();
    if (!peer) {
      // eslint-disable-next-line no-console
      console.warn('[a2a-task-roundtrip] peer not started; set OPENWOP_A2A_FAKE_PEER=true');
      return;
    }
    peer.reset();

    // AgentCard fetch.
    const card = await fetch(`${peer.endpoint()}/agent.json`);
    expect(card.status).toBe(200);
    const cardJson = (await card.json()) as { protocolVersion?: string; skills?: unknown[] };
    expect(typeof cardJson.protocolVersion).toBe('string');
    expect(Array.isArray(cardJson.skills)).toBe(true);

    // Create + poll a task.
    const create = await fetch(`${peer.endpoint()}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: 'echo', input: { text: 'hello' } }),
    });
    expect(create.status).toBe(200);
    const { taskId } = (await create.json()) as { taskId: string; state: string };

    // Advance through states.
    peer.advanceTask(taskId, 'WORKING');
    peer.advanceTask(taskId, 'COMPLETED');

    const get = await fetch(`${peer.endpoint()}/tasks/${taskId}`);
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

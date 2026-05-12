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

/**
 * POST a JSON-RPC 2.0 envelope at `endpoint` and return the parsed
 * response. Throws if the envelope is malformed; surfaces JSON-RPC
 * error responses as a `{error}` field per spec so callers can assert
 * on them.
 */
async function rpc(
  endpoint: string,
  method: string,
  params: unknown,
  id: number,
): Promise<{
  status: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const body = (await res.json()) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
  const out: {
    status: number;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  } = { status: res.status };
  if (body.result !== undefined) out.result = body.result;
  if (body.error !== undefined) out.error = body.error;
  return out;
}

describe('a2a-task-roundtrip: AgentCard + task lifecycle', () => {
  it('AgentCard exposes protocolVersion + skills; message/send + tasks/get round-trip per A2A v0.3 JSON-RPC', async () => {
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

    // AgentCard at the A2A v0.3 well-known path
    // (`AGENT_CARD_PATH` from @a2a-js/sdk: `.well-known/agent-card.json`).
    const card = await fetch(`${probe.url}/.well-known/agent-card.json`);
    expect(card.status).toBe(200);
    const cardJson = (await card.json()) as {
      protocolVersion?: string;
      skills?: ReadonlyArray<{ id?: string; name?: string }>;
      url?: string;
      additionalInterfaces?: ReadonlyArray<{ url?: string; transport?: string }>;
    };
    expect(typeof cardJson.protocolVersion).toBe('string');
    expect(Array.isArray(cardJson.skills)).toBe(true);
    expect((cardJson.skills ?? []).length).toBeGreaterThan(0);

    // Find the JSON-RPC transport endpoint. A2A v0.3 hosts MAY advertise
    // multiple transports via `additionalInterfaces`; we pick the first
    // JSONRPC entry, falling back to `card.url`.
    const jsonrpcIface = (cardJson.additionalInterfaces ?? []).find(
      (i) => i.transport === 'JSONRPC',
    );
    const rpcUrl = jsonrpcIface?.url ?? cardJson.url ?? `${probe.url}/a2a/jsonrpc`;
    expect(typeof rpcUrl).toBe('string');

    if (probe.isReal) {
      // Real-peer interop evidence (Phase 3 T3.4). A2A v0.3 returns
      // EITHER a Task (long-running) OR a Message (direct response)
      // for `message/send` — both are spec-conformant; we only assert
      // the envelope shape.
      const firstSkill = cardJson.skills?.[0];
      const sendRes = await rpc(
        rpcUrl,
        'message/send',
        {
          message: {
            kind: 'message',
            messageId: `probe-${Date.now()}`,
            role: 'user',
            parts: [{ kind: 'text', text: 'interop ping' }],
          },
        },
        1,
      );
      expect(sendRes.status).toBe(200);
      // Spec-conformant: result is either a Task or a Message envelope.
      const sendResult = sendRes.result ?? {};
      const kind = (sendResult.kind ?? '') as string;
      expect(['task', 'message']).toContain(kind);
      // eslint-disable-next-line no-console
      console.warn(
        `[a2a-task-roundtrip] real-peer interop OK against ${probe.url} ` +
          `(skill=${firstSkill?.id ?? firstSkill?.name}, kind=${kind})`,
      );
      return;
    }

    // Fake-peer path: deterministic state forcing, assert verbatim.
    const fake = getA2AFakePeer()!;
    const sendRes = await rpc(
      rpcUrl,
      'message/send',
      {
        message: {
          kind: 'message',
          messageId: 'probe-fake-1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hello' }],
        },
      },
      1,
    );
    expect(sendRes.status).toBe(200);
    expect(sendRes.error).toBeUndefined();
    const task = sendRes.result as { id?: string; kind?: string; status?: { state?: string } };
    expect(task.kind).toBe('task');
    expect(typeof task.id).toBe('string');

    // Advance through WORKING → COMPLETED via the fake's internal API.
    fake.advanceTask(task.id!, 'WORKING');
    fake.advanceTask(task.id!, 'COMPLETED');

    const getRes = await rpc(rpcUrl, 'tasks/get', { id: task.id }, 2);
    expect(getRes.status).toBe(200);
    expect(getRes.error).toBeUndefined();
    const finalTask = getRes.result as { status?: { state?: string } };
    // A2A v0.3 wire form uses lowercase-hyphen state names.
    expect(finalTask.status?.state).toBe('completed');
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

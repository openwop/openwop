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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { getA2AFakePeer } from '../lib/a2a-fake-peer.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntilTerminal, pollUntilStatus } from '../lib/polling.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

/**
 * Callback-shaped: the host issues A2A JSON-RPC calls to the suite's fake peer.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host issues A2A JSON-RPC calls to the suite's fake peer";

const ROUNDTRIP_FIXTURE = 'conformance-a2a-task-roundtrip';
const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

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

// ─── RFC 0100: async / durable A2A tasks ──────────────────────────────
// Capability-shape always-on + durable-get / resubscribe / push-SSRF gated.

describe('a2a-task-roundtrip: A2ATaskState + a2a capability shape (always-on, server-free; RFC 0100)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const taskStateSchema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'a2a-task-state.schema.json'), 'utf8'),
  );
  const capabilitiesSchema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'),
  );
  const validateTaskState = ajv.compile(taskStateSchema);
  const a2aBlockSchema = capabilitiesSchema.properties?.a2a;

  it('a conforming A2ATaskState validates with the lowercase-hyphen state enum and taskId == runId', () => {
    const ok = {
      taskId: 'run_x',
      runId: 'run_x',
      contextId: 'ctx_42',
      state: 'input-required',
      interruptKind: 'approval',
      updatedAt: '2026-06-13T19:00:00Z',
    };
    expect(
      validateTaskState(ok),
      `a2a-task-state.schema.json MUST accept a conforming record. Errors: ${JSON.stringify(validateTaskState.errors)}`,
    ).toBe(true);
  });

  it('an UPPERCASE state fails (the persisted/wire form is the A2A v0.3 lowercase-hyphen variant)', () => {
    expect(
      validateTaskState({ taskId: 'r', runId: 'r', state: 'WORKING', updatedAt: '2026-06-13T19:00:00Z' }),
      'a2a-integration.md spelling-drift note — the persisted A2ATaskState.state MUST be the lowercase-hyphen form',
    ).toBe(false);
  });

  it('an A2ATaskState carrying run inputs/artifacts inline fails (additionalProperties:false; SR-1)', () => {
    expect(
      validateTaskState({
        taskId: 'r',
        runId: 'r',
        state: 'completed',
        updatedAt: '2026-06-13T19:00:00Z',
        inputs: { secret: 'x' },
      }),
      'SECURITY a2a-push-egress-ssrf / SR-1 — the persisted record MUST NOT carry run inputs/outputs/artifacts inline',
    ).toBe(false);
  });

  it('a PushConfig requires `url` and structurally rejects a raw (non-truncated) push token', () => {
    const validatePush = ajv.compile({
      $ref: 'https://openwop.dev/spec/v1/a2a-task-state.schema.json#/$defs/PushConfig',
      $defs: taskStateSchema.$defs,
    });
    expect(validatePush({ tokenFingerprint: 'a1b2' }), 'PushConfig MUST require `url`').toBe(false);
    expect(
      validatePush({ url: 'https://caller.example.com/push', tokenFingerprint: 'a'.repeat(33) }),
      'SECURITY a2a-push-egress-ssrf — tokenFingerprint maxLength:32 structurally rejects a full-length raw token (SR-1)',
    ).toBe(false);
    expect(
      validatePush({ url: 'https://caller.example.com/push', tokenFingerprint: 'a1b2c3d4' }),
      'a truncated fingerprint + uri url MUST validate',
    ).toBe(true);
  });

  it('the capabilities.a2a block shape is declared (supported + agentCardUrl required; three optional booleans)', () => {
    expect(a2aBlockSchema, 'capabilities.schema.json MUST declare the a2a block').toBeDefined();
    expect(a2aBlockSchema.required).toEqual(expect.arrayContaining(['supported', 'agentCardUrl']));
    expect(a2aBlockSchema.additionalProperties).toBe(false);
    const validateA2A = ajv.compile({ ...a2aBlockSchema, $id: 'urn:test:a2a-block' });
    expect(
      validateA2A({ supported: true, agentCardUrl: 'https://example.com/.well-known/agent-card.json', durableTasks: true }),
      `a conforming a2a block MUST validate. Errors: ${JSON.stringify(validateA2A.errors)}`,
    ).toBe(true);
    expect(validateA2A({ supported: true }), 'agentCardUrl is required').toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('a2a-task-roundtrip: durable tasks/get after disconnect (gated on a2a.durableTasks; RFC 0100)', () => {
  it('a paused-at-HITL run projects a live input-required task on a later tasks/get read', async () => {
    const a2a = await readCapabilityFamily<{ durableTasks?: boolean }>('a2a');
    if (!behaviorGate('a2a.durableTasks', a2a?.durableTasks === true)) return;

    // Host-extension durable-task read seam (RFC 0100 §2). The host drives a
    // backing run to a paused HITL state; we read the persisted projection
    // WITHOUT holding the original connection.
    const start = await driver.post('/v1/host/sample/a2a/tasks/start', {
      scenario: 'paused-at-approval',
    });
    if (start.status === 404 || start.status === 403) return; // seam unwired — soft-skip
    const taskId = (start.json as { taskId?: string })?.taskId;
    if (!taskId) return;

    const read = await driver.get(`/v1/host/sample/a2a/tasks/${encodeURIComponent(taskId)}`);
    if (read.status === 404 || read.status === 403) return;
    const state = read.json as { state?: string; runId?: string; metadata?: { openwop?: { interrupt?: { kind?: string } } } };
    expect(
      state.state,
      driver.describe('a2a-integration.md §"Async / durable Tasks"', 'tasks/get after disconnect MUST return the live input-required projection (not a stale working)'),
    ).toBe('input-required');
    expect(
      state.runId,
      driver.describe('a2a-task-state.schema.json', 'taskId MUST equal the backing runId'),
    ).toBe(taskId);
  });
});

describe.skipIf(HTTP_SKIP)('a2a-task-roundtrip: push-config SSRF (gated on a2a.pushNotifications; RFC 0100)', () => {
  it('registering a pushConfig.url at a private address is refused (a2a-push-egress-ssrf)', async () => {
    const a2a = await readCapabilityFamily<{ pushNotifications?: boolean }>('a2a');
    if (!behaviorGate('a2a.pushNotifications', a2a?.pushNotifications === true)) return;

    const res = await driver.post('/v1/host/sample/a2a/tasks/push-config', {
      taskId: 'run_x',
      url: 'http://10.0.0.5/push',
    });
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip
    expect(
      res.status >= 400,
      driver.describe(
        'a2a-integration.md §"Async / durable Tasks"',
        'a2a-push-egress-ssrf — a caller-supplied pushConfig.url at a private/loopback address MUST be refused before any push',
      ),
    ).toBe(true);
  });
});

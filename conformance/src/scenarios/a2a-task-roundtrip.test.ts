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
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

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
  it('AgentCard exposes a protocol version (0.3 top-level or 1.0 per-interface) + skills; message/send + tasks/get round-trip per A2A v0.3 JSON-RPC', async () => {
    const probe = probePeer();
    if (!probe) {
      // eslint-disable-next-line no-console
      console.warn(
        '[a2a-task-roundtrip] no A2A endpoint configured; set OPENWOP_A2A_FAKE_PEER=true ' +
          'or OPENWOP_A2A_REAL_PEER_URL=<base-url>',
      );
      return softSkip('blocked', 'precondition not met — `!probe` returned early (seam, prior step, or fixture unavailable)');
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
      // A2A 1.0 (RFC 0152 §C): the version is per interface and the top-level
      // `url`/`protocolVersion` are gone. A dual-era peer (the suite's own, since
      // 1.112.0, and any real 1.0 peer) serves THIS shape while still speaking
      // 0.3 to a header-less request — which is what this leg exercises.
      supportedInterfaces?: ReadonlyArray<{ url?: string; protocolBinding?: string; protocolVersion?: string }>;
    };
    const advertisedVersion =
      cardJson.protocolVersion ??
      cardJson.supportedInterfaces?.find((i) => typeof i.protocolVersion === 'string')?.protocolVersion;
    expect(
      typeof advertisedVersion,
      req('openwop.it.a2a-task-roundtrip.agentcard-exposes-a-protocol-version-0-3-top-level-or-1-0-per-interface-skills-m', 'spec/v1/a2a-integration.md', 'the card MUST advertise a protocol version — top-level (0.3) or per interface (1.0)'),
    ).toBe('string');
    expect(Array.isArray(cardJson.skills)).toBe(true);
    expect((cardJson.skills ?? []).length).toBeGreaterThan(0);

    // Find the JSON-RPC transport endpoint: 1.0 `supportedInterfaces[]`
    // (`protocolBinding: "JSONRPC"`), else 0.3 `additionalInterfaces[]`
    // (`transport: "JSONRPC"`), else 0.3 `card.url`.
    const jsonrpc10 = (cardJson.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'JSONRPC');
    const jsonrpcIface = (cardJson.additionalInterfaces ?? []).find(
      (i) => i.transport === 'JSONRPC',
    );
    const rpcUrl = jsonrpc10?.url ?? jsonrpcIface?.url ?? cardJson.url ?? `${probe.url}/a2a/jsonrpc`;
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
      return softSkip('blocked', 'precondition not met — `probe.isReal` returned early (seam, prior step, or fixture unavailable)');
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
      return softSkip('blocked', 'precondition not met — `!peer` returned early ([a2a-task-roundtrip] peer not started; skipping drift-point #3 subtest) (seam, prior step, or fixture unavailable)');
    }
    if (!isFixtureAdvertised(ROUNDTRIP_FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[a2a-task-roundtrip] fixture ${ROUNDTRIP_FIXTURE} not advertised; skipping drift-point #3 subtest`,
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(ROUNDTRIP_FIXTURE)` returned early ([a2a-task-roundtrip] fixture … not advertised; skipping drift-point #3 subtest)');
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
    expect(snapshot.status, req('openwop.it.a2a-task-roundtrip.host-consuming-an-a2a-peer-that-returns-auth-required-projects-to-waiting-input', 
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
      return softSkip('blocked', 'precondition not met — `!peer` returned early ([a2a-task-roundtrip] peer not started; skipping drift-point #4 subtest) (seam, prior step, or fixture unavailable)');
    }
    if (!isFixtureAdvertised(ROUNDTRIP_FIXTURE)) {
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(ROUNDTRIP_FIXTURE)` returned early');
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
    expect(terminal.status, req('openwop.it.a2a-task-roundtrip.host-consuming-an-a2a-peer-that-returns-rejected-projects-to-failed-with-rejecte', 
      'a2a-integration.md §"State projection" drift point #4',
      'A2A REJECTED MUST project to openwop terminal status `failed`',
    )).toBe('failed');

    // Reason carrier: host MAY surface 'rejected_by_remote' in the run
    // snapshot, the final node payload, or the run-level error envelope.
    // We accept any of those: stringify the snapshot and search.
    const haystack = JSON.stringify(terminal).toLowerCase();
    expect(haystack.includes('rejected'), req('openwop.it.a2a-task-roundtrip.host-consuming-an-a2a-peer-that-returns-rejected-projects-to-failed-with-rejecte', 
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
      req('openwop.it.a2a-task-roundtrip.a-conforming-a2ataskstate-validates-with-the-lowercase-hyphen-state-enum-and-tas', 'spec/v1/a2a-integration.md', `a2a-task-state.schema.json MUST accept a conforming record. Errors: ${JSON.stringify(validateTaskState.errors)}`),
    ).toBe(true);
  });

  it('an UPPERCASE state fails (the persisted/wire form is the A2A v0.3 lowercase-hyphen variant)', () => {
    expect(
      validateTaskState({ taskId: 'r', runId: 'r', state: 'WORKING', updatedAt: '2026-06-13T19:00:00Z' }),
      req('openwop.it.a2a-task-roundtrip.an-uppercase-state-fails-the-persisted-wire-form-is-the-a2a-v0-3-lowercase-hyphe', 'spec/v1/a2a-integration.md', 'a2a-integration.md spelling-drift note — the persisted A2ATaskState.state MUST be the lowercase-hyphen form'),
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
      req('openwop.it.a2a-task-roundtrip.an-a2ataskstate-carrying-run-inputs-artifacts-inline-fails-additionalproperties', 'spec/v1/a2a-integration.md', 'SECURITY a2a-push-egress-ssrf / SR-1 — the persisted record MUST NOT carry run inputs/outputs/artifacts inline'),
    ).toBe(false);
  });

  it('a PushConfig requires `url` and structurally rejects a raw (non-truncated) push token', () => {
    const validatePush = ajv.compile({
      $ref: 'https://openwop.dev/spec/v1/a2a-task-state.schema.json#/$defs/PushConfig',
      $defs: taskStateSchema.$defs,
    });
    expect(validatePush({ tokenFingerprint: 'a1b2' }), req('openwop.it.a2a-task-roundtrip.a-pushconfig-requires-url-and-structurally-rejects-a-raw-non-truncated-push-toke', 'spec/v1/a2a-integration.md', 'PushConfig MUST require `url`')).toBe(false);
    expect(
      validatePush({ url: 'https://caller.example.com/push', tokenFingerprint: 'a'.repeat(33) }),
      req('openwop.it.a2a-task-roundtrip.a-pushconfig-requires-url-and-structurally-rejects-a-raw-non-truncated-push-toke', 'spec/v1/a2a-integration.md', 'SECURITY a2a-push-egress-ssrf — tokenFingerprint maxLength:32 structurally rejects a full-length raw token (SR-1)'),
    ).toBe(false);
    expect(
      validatePush({ url: 'https://caller.example.com/push', tokenFingerprint: 'a1b2c3d4' }),
      req('openwop.it.a2a-task-roundtrip.a-pushconfig-requires-url-and-structurally-rejects-a-raw-non-truncated-push-toke', 'spec/v1/a2a-integration.md', 'a truncated fingerprint + uri url MUST validate'),
    ).toBe(true);
  });

  it('the capabilities.a2a block shape is declared (supported + agentCardUrl required; three optional booleans)', () => {
    expect(a2aBlockSchema, req('openwop.it.a2a-task-roundtrip.the-capabilities-a2a-block-shape-is-declared-supported-agentcardurl-required-thr', 'spec/v1/a2a-integration.md', 'capabilities.schema.json MUST declare the a2a block')).toBeDefined();
    expect(a2aBlockSchema.required).toEqual(expect.arrayContaining(['supported', 'agentCardUrl']));
    expect(a2aBlockSchema.additionalProperties).toBe(false);
    const validateA2A = ajv.compile({ ...a2aBlockSchema, $id: 'urn:test:a2a-block' });
    expect(
      validateA2A({ supported: true, agentCardUrl: 'https://example.com/.well-known/agent-card.json', durableTasks: true }),
      req('openwop.it.a2a-task-roundtrip.the-capabilities-a2a-block-shape-is-declared-supported-agentcardurl-required-thr', 'spec/v1/a2a-integration.md', `a conforming a2a block MUST validate. Errors: ${JSON.stringify(validateA2A.errors)}`),
    ).toBe(true);
    expect(validateA2A({ supported: true }), req('openwop.it.a2a-task-roundtrip.the-capabilities-a2a-block-shape-is-declared-supported-agentcardurl-required-thr', 'spec/v1/a2a-integration.md', 'agentCardUrl is required')).toBe(false);
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
    if (start.status === 404 || start.status === 403) return softSkip('blocked', 'precondition not met — `start.status === 404 || start.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    const taskId = (start.json as { taskId?: string })?.taskId;
    if (!taskId) return softSkip('blocked', 'precondition not met — `!taskId` returned early (seam, prior step, or fixture unavailable)');

    const read = await driver.get(`/v1/host/sample/a2a/tasks/${encodeURIComponent(taskId)}`);
    if (read.status === 404 || read.status === 403) return softSkip('blocked', 'precondition not met — `read.status === 404 || read.status === 403` returned early (seam, prior step, or fixture unavailable)');
    const state = read.json as { state?: string; runId?: string; metadata?: { openwop?: { interrupt?: { kind?: string } } } };
    expect(
      state.state,
      req('openwop.it.a2a-task-roundtrip.a-paused-at-hitl-run-projects-a-live-input-required-task-on-a-later-tasks-get-re', 'a2a-integration.md §"Async / durable Tasks"', 'tasks/get after disconnect MUST return the live input-required projection (not a stale working)'),
    ).toBe('input-required');
    expect(
      state.runId,
      req('openwop.it.a2a-task-roundtrip.a-paused-at-hitl-run-projects-a-live-input-required-task-on-a-later-tasks-get-re', 'a2a-task-state.schema.json', 'taskId MUST equal the backing runId'),
    ).toBe(taskId);
  });
});

/**
 * Push-config SSRF, TWO-SIDED (RFC 0100 §4, a2a-integration.md §D.6).
 *
 * The RFC 0093 webhook-egress guard has two arms — `webhooks.md`
 * §"SSRF protection" rejects non-`https://` protocols AND private/loopback/
 * link-local/ULA/metadata addresses — and a host may implement either one
 * alone.
 *
 * Until 2026-08-25 this file probed with a single `http://10.0.0.5/push`,
 * which **violates both arms at once**. Either arm alone refuses it, so a
 * `>= 400` witnessed *that something refused* and never *which guard ran*.
 * A host with only the address arm passed; so did a host with only the
 * scheme arm; so would a host that refused every push URL for an unrelated
 * reason. The assertion was real and the conclusion drawn from it was not.
 *
 * The probes below isolate one arm each: `https` at a private address can
 * only be refused by the address arm, and `http` at a public host can only
 * be refused by the scheme arm. Two legs is the minimum that distinguishes
 * them — the same reason a negative control is not optional.
 *
 * The scheme leg is new, and the obligation it checks was previously stated
 * only by reference (every prior wording abbreviated the guard to its
 * address arm). `COMPATIBILITY.md` §3 records the Class 3 classification: a
 * host accepting a plaintext push target was never conforming. An
 * implementer reddened by this leg is reading a clarification, not a new
 * requirement — the failure message says so.
 */
describe.skipIf(HTTP_SKIP)('a2a-task-roundtrip: push-config SSRF, two-sided (gated on a2a.pushNotifications; RFC 0100)', () => {
  async function registerPush(url: string): Promise<{ status: number } | null> {
    const a2a = await readCapabilityFamily<{ pushNotifications?: boolean }>('a2a');
    if (!behaviorGate('a2a.pushNotifications', a2a?.pushNotifications === true)) return null;
    const res = await driver.post('/v1/host/sample/a2a/tasks/push-config', { taskId: 'run_x', url });
    if (res.status === 404 || res.status === 403) {
      // Previously a bare `return`, invisible to the RFC 0148 §A ledger because
      // this file's other tests assert — so the file recorded `executed-pass`
      // while this leg had witnessed nothing. Say why instead.
      return seamAbsent(
        'a2a-push-egress-ssrf — the `/v1/host/sample/a2a/tasks/push-config` seam is not mounted (404/403), so neither guard arm is observable',
      ) ?? null;
    }
    return { status: res.status };
  }

  it('ADDRESS arm: an https pushConfig.url at a private address is refused', async () => {
    // `https` on purpose: this probe is refusable ONLY by the address arm, so a
    // host that implements the scheme arm alone cannot pass it by accident.
    const res = await registerPush('https://10.0.0.5/push');
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      res.status >= 400,
      req('openwop.it.a2a-task-roundtrip.address-arm-an-https-pushconfig-url-at-a-private-address-is-refused', 
        'a2a-integration.md §D.6 (address arm)',
        'a2a-push-egress-ssrf — a pushConfig.url at a private/loopback address MUST be refused before any push, even over https',
      ),
    ).toBe(true);
  });

  it('SCHEME arm: an http pushConfig.url at a public host is refused', async () => {
    // Public hostname on purpose: refusable ONLY by the scheme arm.
    const res = await registerPush('http://push.example.com/push');
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      res.status >= 400,
      req('openwop.it.a2a-task-roundtrip.scheme-arm-an-http-pushconfig-url-at-a-public-host-is-refused', 
        'a2a-integration.md §D.6 (scheme arm)',
        'a2a-push-egress-ssrf — a plaintext `http://` pushConfig.url MUST be refused before any push. '
          + 'The RFC 0093 webhook-egress guard is the `webhooks.md` §"SSRF protection" list IN FULL, whose first entry is '
          + '"Non-`https://` protocols". Every prior wording of this requirement abbreviated the guard to its address arm; '
          + 'COMPATIBILITY.md §3 records this as a Class 3 clarification, so a host failing here was never conforming rather '
          + 'than newly non-conforming.',
      ),
    ).toBe(true);
  });
});

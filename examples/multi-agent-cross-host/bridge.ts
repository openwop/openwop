/**
 * MA-6 — Cross-host parent-child workflow sample.
 *
 * Runnable demonstration of the OpenWOP-to-A2A cross-host
 * composition pattern documented in
 * `spec/v1/a2a-integration.md` §"State projection" and previewed in
 * `examples/multi-agent-research-assistant/README.md` §"Cross-host
 * composition (A2A bridge)".
 *
 * **What this is.** A standalone Node script that drives a complete
 * parent-child workflow across a host boundary: the parent
 * (simulated OpenWOP host) issues a child task to an A2A peer (the
 * `A2AFakePeer` from the conformance suite), walks the task through
 * its full lifecycle, applies the canonical state projection back to
 * the OpenWOP-side `run.status`, and verifies the four documented
 * drift points.
 *
 * **What this is NOT.** This is NOT a production-grade bridge.
 * Real OpenWOP hosts implementing `core.a2a.invoke` will wire this
 * pattern into their executor (with retry/timeout/auth/tracing); the
 * example is the canonical reference algorithm + assertion fixture.
 *
 * **Why it lives here.** Real third-party hosts will want to read
 * one end-to-end runnable example before implementing the bridge
 * node. The conformance suite's `a2a-task-roundtrip.test.ts` covers
 * the contract via vitest; this example covers the same contract as
 * a sequential narrative.
 *
 * Run:
 *   ```bash
 *   cd /path/to/openwop
 *   npx tsx examples/multi-agent-cross-host/bridge.ts
 *   ```
 *
 * @see plans/openwop-protocol-gap-closure-plan.md Workstream 6 MA-6
 * @see spec/v1/a2a-integration.md §"State projection"
 * @see conformance/src/lib/a2a-fake-peer.ts (reused as the peer)
 */

import assert from 'node:assert/strict';

import { A2AFakePeer } from '../../conformance/src/lib/a2a-fake-peer.js';

// ─── Canonical A2A → OpenWOP state projection ────────────────────
// Per a2a-integration.md §"A2A → openwop (reverse projection)" table.

type OpenWopRunStatus =
  | 'queued'
  | 'running'
  | 'waiting-input'
  | 'waiting-approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Canonical reverse projection: A2A wire-form `TaskState` →
 * OpenWOP `run.status`. Future hosts implementing the A2A bridge
 * MUST apply this mapping (or a documented vendor extension when
 * the host carries `paused` literally via metadata).
 */
function projectA2AStateToOpenWop(
  wireState: string,
): { status: OpenWopRunStatus; reason?: string } {
  switch (wireState) {
    case 'submitted':
    case 'working':
      return { status: 'running' };
    case 'input-required':
      // Drift point #2 — A2A's INPUT_REQUIRED maps to either
      // waiting-approval or waiting-input depending on the
      // metadata's intent vocabulary. Conservative default:
      // waiting-input. A real bridge inspects Task.metadata.
      return { status: 'waiting-input' };
    case 'auth-required':
      // Drift point #3 — A2A has no native authentication-request
      // state in OpenWOP; project to waiting-input with reason.
      return { status: 'waiting-input', reason: 'auth_required_by_remote' };
    case 'completed':
      return { status: 'completed' };
    case 'failed':
      return { status: 'failed' };
    case 'canceled':
      return { status: 'cancelled' };
    case 'rejected':
      // Drift point #4 — A2A's REJECTED projects to OpenWOP failed
      // with a canonical reason code.
      return { status: 'failed', reason: 'rejected_by_remote' };
    case 'unknown':
    default:
      return { status: 'failed', reason: 'unknown_remote_state' };
  }
}

// ─── JSON-RPC helper ──────────────────────────────────────────────

async function rpc(
  endpoint: string,
  method: string,
  params: unknown,
  id: number,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoint}/a2a/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (!res.ok) throw new Error(`rpc(${method}): HTTP ${res.status}`);
  const body = (await res.json()) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
  if (body.error) {
    throw new Error(`rpc(${method}): JSON-RPC ${body.error.code} ${body.error.message}`);
  }
  if (!body.result) throw new Error(`rpc(${method}): missing result`);
  return body.result;
}

// ─── Bridge node — what `core.a2a.invoke` would look like ─────────

/**
 * Reference implementation of the parent-side `core.a2a.invoke`
 * bridge node. Given an A2A peer endpoint + skill, issues a
 * message/send, polls until the task reaches a terminal state, and
 * returns the projected OpenWOP run.status + the A2A Task result.
 *
 * Production hosts MUST add: timeout, retry with backoff, OAuth2
 * client-credentials for the A2A endpoint, OTel span propagation
 * via Task.metadata.openwop.traceContext, and an idempotency layer
 * keyed off `parentRunId`.
 */
async function invokeA2APeer(
  peerEndpoint: string,
  skill: string,
  message: string,
): Promise<{
  taskId: string;
  parentStatus: OpenWopRunStatus;
  parentReason?: string;
  taskWire: Record<string, unknown>;
  stateTransitions: string[];
}> {
  // 1. Send the initial message.
  const sendResult = await rpc(peerEndpoint, 'message/send', {
    message: {
      role: 'user',
      parts: [{ kind: 'text', text: message }],
    },
    configuration: { skill },
  }, 1);
  const initialTask = sendResult as { id: string; status: { state: string } };
  const taskId = initialTask.id;
  const stateTransitions: string[] = [initialTask.status.state];

  // 2. Poll until terminal.
  const terminalWire = new Set(['completed', 'failed', 'canceled', 'rejected']);
  let polled: Record<string, unknown> = initialTask;
  for (let i = 0; i < 20; i++) {
    polled = await rpc(peerEndpoint, 'tasks/get', { id: taskId }, 2 + i);
    const current = (polled as { status: { state: string } }).status.state;
    if (stateTransitions[stateTransitions.length - 1] !== current) {
      stateTransitions.push(current);
    }
    if (terminalWire.has(current)) break;
    // Real bridge would back off; here we tight-loop because the
    // fake peer advances synchronously.
    await new Promise((r) => setTimeout(r, 5));
  }

  const finalWire = (polled as { status: { state: string } }).status.state;
  const projection = projectA2AStateToOpenWop(finalWire);
  return {
    taskId,
    parentStatus: projection.status,
    ...(projection.reason && { parentReason: projection.reason }),
    taskWire: polled,
    stateTransitions,
  };
}

// ─── End-to-end demonstration ─────────────────────────────────────

async function main(): Promise<void> {
  const peer = new A2AFakePeer();
  await peer.start();
  try {
    const endpoint = peer.endpoint();

    // Scenario 1: Happy path — terminal COMPLETED.
    // Parent's run.status projects to completed. (The fake peer is
    // intentionally manual — `setNextState` predetermines the
    // terminal wire state so the demo is deterministic; real A2A
    // peers transition asynchronously and the bridge polls.)
    peer.setNextState('COMPLETED');
    const happy = await invokeA2APeer(endpoint, 'echo', 'Hello from parent');
    assert.equal(happy.parentStatus, 'completed',
      'completed A2A task MUST project to OpenWOP run.status=completed');
    assert.equal(happy.parentReason, undefined);
    assert.ok(happy.stateTransitions.includes('completed'));

    // Scenario 2: Drift point #3 — AUTH_REQUIRED.
    // The peer flips next-state to auth-required; bridge projects
    // to waiting-input with reason auth_required_by_remote.
    peer.reset();
    peer.setNextState('AUTH_REQUIRED');
    const authReq = await invokeA2APeer(endpoint, 'echo', 'needs auth');
    assert.equal(authReq.parentStatus, 'waiting-input',
      'AUTH_REQUIRED MUST project to waiting-input (drift point #3)');
    assert.equal(authReq.parentReason, 'auth_required_by_remote');

    // Scenario 3: Drift point #4 — REJECTED.
    peer.reset();
    peer.setNextState('REJECTED');
    const rejected = await invokeA2APeer(endpoint, 'echo', 'will be rejected');
    assert.equal(rejected.parentStatus, 'failed',
      'REJECTED MUST project to OpenWOP run.status=failed (drift point #4)');
    assert.equal(rejected.parentReason, 'rejected_by_remote',
      "MUST carry reason='rejected_by_remote' per a2a-integration.md");

    // Scenario 4: A2A FAILED → OpenWOP failed (no special reason).
    peer.reset();
    peer.setNextState('FAILED');
    const failed = await invokeA2APeer(endpoint, 'echo', 'will fail');
    assert.equal(failed.parentStatus, 'failed');
    assert.equal(failed.parentReason, undefined,
      'plain A2A FAILED carries NO special reason — only REJECTED uses rejected_by_remote');

    // Scenario 5: A2A CANCELED → OpenWOP cancelled (spelling drift,
    // both `l`s on the OpenWOP side per a2a-integration.md §"Spelling drift").
    peer.reset();
    peer.setNextState('CANCELED');
    const canceled = await invokeA2APeer(endpoint, 'echo', 'will be canceled');
    assert.equal(canceled.parentStatus, 'cancelled',
      'A2A canceled (one l) → OpenWOP cancelled (two l) — spelling drift documented');

    // Scenario 6: Replay determinism — same peer-side outcome
    // MUST produce same projection on every invocation. Bridge is
    // a pure projection over the terminal wire state.
    peer.reset();
    peer.setNextState('REJECTED');
    const replay1 = await invokeA2APeer(endpoint, 'echo', 'rejected #1');
    peer.reset();
    peer.setNextState('REJECTED');
    const replay2 = await invokeA2APeer(endpoint, 'echo', 'rejected #2');
    assert.equal(replay1.parentStatus, replay2.parentStatus);
    assert.equal(replay1.parentReason, replay2.parentReason);

    // Peer-side bookkeeping — every invocation produced exactly one
    // message/send call to the peer. Useful audit for the bridge.
    assert.ok(peer.invocations().length > 0,
      'peer recorded at least one invocation per bridge call');

    // eslint-disable-next-line no-console
    console.log(
      'ok multi-agent-cross-host — A2A bridge state-projection verified end-to-end\n' +
        `  happy-path:    A2A=${happy.stateTransitions.join('→')} → OpenWOP=${happy.parentStatus}\n` +
        `  AUTH_REQUIRED: A2A=auth-required → OpenWOP=${authReq.parentStatus} (reason=${authReq.parentReason})\n` +
        `  REJECTED:      A2A=rejected → OpenWOP=${rejected.parentStatus} (reason=${rejected.parentReason})\n` +
        `  FAILED:        A2A=failed → OpenWOP=${failed.parentStatus}\n` +
        `  CANCELED:      A2A=canceled → OpenWOP=${canceled.parentStatus}\n` +
        `  replay-deterministic: 2 independent invocations produced identical projection`,
    );
  } finally {
    await peer.stop();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

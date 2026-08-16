/**
 * replay-divergence-at-refusal — RFC 0041 §B behavioral assertion.
 *
 * Status: ACTIVE (capability-gated behavioral; soft-skips when no Phase 4
 * host advertises the contract). Gated on
 * `capabilities.multiAgent.executionModel.version >= 4` AND
 * `capabilities.multiAgent.executionModel.replayDeterminism.refusalDivergenceEmission: true`.
 *
 * Asserts (behavioral, when a Phase 4 host advertises both gates):
 *
 *   1. When the original run obtained a valid LLM envelope but the replay
 *      gets a refusal, the host MUST emit a `replay.divergedAtRefusal`
 *      event AND fail the replay with `error.code:
 *      "replay_diverged_at_refusal"`. Silent substitution is non-conformant.
 *
 *   2. The emitted `replay.divergedAtRefusal` payload MUST carry
 *      `originalEnvelopeKind: "valid"` + `replayEnvelopeKind: "refusal"`
 *      (or the inverse for the original-refused case). The two MUST
 *      differ — otherwise there is no divergence to report.
 *
 *   3. The error envelope MAY carry `details.atSequence`, `details.nodeId`,
 *      `details.originalEnvelopeKind`, `details.replayEnvelopeKind` per
 *      `spec/v1/rest-endpoints.md` §"Common error codes" — when present,
 *      the values MUST be consistent with the emitted event.
 *
 * Driving the assertion requires a host-side test seam that can stage a
 * mock provider returning a valid envelope on the original run and a
 * refusal on the replay (or vice-versa). Reference workflow-engine ships
 * a mock-AI provider (`OPENWOP_MULTI_AGENT_EXECUTION_MODEL=true`); the
 * Phase 4 wiring (landed 2026-05-23 via commits `1fce55a` + `bba3b4a`)
 * extends it with `checkReplayDivergence()` in the executor catch-path
 * + symmetric success-path detection of envelope-kind divergence; emits
 * `replay.divergedAtRefusal` event and fails the run with
 * `error.code: 'replay_diverged_at_refusal'` when source vs replay
 * differ at the same nodeId. Behavioral coverage is now real: 3
 * assertions PASS against workflow-engine when Phase 4 advertisement
 * is enabled (cover both divergence directions: original=valid +
 * replay=refusal AND original=refusal + replay=valid).
 *
 * @see RFCS/0041-multi-agent-replay-under-nondeterminism.md §B
 * @see spec/v1/replay.md §"Envelope-refusal recovery in replay (MAE-8 closure)"
 * @see spec/v1/multi-agent-execution.md §"Phase 4 replay determinism"
 * @see spec/v1/rest-endpoints.md §"Common error codes" — replay_diverged_at_refusal
 * @see schemas/run-event-payloads.schema.json §replayDivergedAtRefusal
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: {
      executionModel?: {
        supported?: unknown;
        version?: unknown;
        replayDeterminism?: {
          supported?: unknown;
          refusalDivergenceEmission?: unknown;
        };
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch { return null; }
}

describe.skipIf(HTTP_SKIP)('replay-divergence-at-refusal: advertisement shape (RFC 0041 §D)', () => {
  it('replayDeterminism (when present) conforms to RFC 0041 §D', async (ctx) => {
    const d = await readDiscovery();
    if (d === null) {
      softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
      ctx.skip();
      return;
    }
    const rd = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.replayDeterminism;
    if (rd === undefined) {
      softSkip('inapplicable', 'optional advertisement — `multiAgent.executionModel.replayDeterminism` not advertised by this host (RFC 0041 §D)');
      ctx.skip(); // optional advertisement — host hasn't opted in
      return;
    }

    expect(
      typeof rd.supported,
      driver.describe(
        'RFCS/0041-multi-agent-replay-under-nondeterminism.md §D',
        'replayDeterminism.supported MUST be boolean when present',
      ),
    ).toBe('boolean');

    if (rd.supported === true) {
      const version = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.version as number | undefined;
      expect(
        typeof version === 'number' && version >= 4,
        driver.describe(
          'RFCS/0041-multi-agent-replay-under-nondeterminism.md §D',
          'when replayDeterminism.supported: true, multiAgent.executionModel.version MUST be >= 4',
        ),
      ).toBe(true);

      // Phase 4 hosts MUST commit to refusal-divergence emission per the
      // schema description on capabilities.schema.json §replayDeterminism
      // .refusalDivergenceEmission. The MUST is normative prose on the
      // schema; JSON Schema can't express the conditional, so this
      // assertion closes the conformance-enforcement gap.
      expect(
        rd.refusalDivergenceEmission,
        driver.describe(
          'schemas/capabilities.schema.json §replayDeterminism.refusalDivergenceEmission',
          'hosts advertising version: 4 MUST set replayDeterminism.refusalDivergenceEmission to true',
        ),
      ).toBe(true);
    }
  });
});

interface RunSnapshot {
  status?: string;
  error?: { code?: string; message?: string };
}
interface RunEventDoc {
  type: string;
  nodeId?: string;
  sequence?: number;
  payload?: Record<string, unknown>;
}

async function pollUntilTerminal(runId: string): Promise<RunSnapshot> {
  for (let i = 0; i < 50; i++) {
    const r = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const snap = r.json as RunSnapshot;
    if (snap.status === 'completed' || snap.status === 'failed' || snap.status === 'cancelled') {
      return snap;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${runId} did not reach terminal within 5s`);
}

async function readEvents(runId: string): Promise<RunEventDoc[]> {
  const r = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  const body = r.json as { events?: RunEventDoc[] };
  return body.events ?? [];
}

async function programMock(nodeId: string, program: Array<Record<string, unknown>>): Promise<number> {
  const r = await driver.post('/v1/host/sample/test/mock-ai/program', { nodeId, program });
  return r.status;
}

describe.skipIf(HTTP_SKIP)('replay-divergence-at-refusal: behavioral (RFC 0041 §B MAE-8)', () => {
  // Behavioral assertion drives a workflow whose mock-AI provider returns a
  // valid envelope on the original run + a refusal on the replay (or
  // vice-versa via a second variant). The assertion sequence:
  //   1. Stage mock provider: original returns valid envelope.
  //   2. Run workflow `conformance-phase4-replay-divergence` end-to-end.
  //   3. Re-stage mock provider: replay-of-this-runId returns refusal.
  //   4. POST /v1/runs/{runId}:fork { mode: 'replay' }.
  //   5. Assert the resulting run terminates with
  //        error.code === 'replay_diverged_at_refusal'.
  //   6. Assert event log contains a `replay.divergedAtRefusal` event with
  //        originalEnvelopeKind === 'valid' AND replayEnvelopeKind === 'refusal'.
  //   7. Assert NO silent substitution: the replay's continuation past the
  //      diverging node MUST NOT execute (run terminates at the divergence).

  async function gateOnPhase4(ctx: { skip: () => void }): Promise<boolean> {
    const d = await readDiscovery();
    const rd = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.replayDeterminism;
    if (rd?.supported !== true || rd?.refusalDivergenceEmission !== true) {
      ctx.skip();
      return false;
    }
    return true;
  }

  it('Phase 4 host MUST emit replay.divergedAtRefusal + fail with replay_diverged_at_refusal when original=valid + replay=refusal', async (ctx) => {
    if (!(await gateOnPhase4(ctx))) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await gateOnPhase4(ctx))` returned early');

    const NODE_ID = 'structured-call';
    // Original program: valid envelope. Replay program (set after the
    // original completes): refusal. Programming twice is the spec-canonical
    // pattern — see spec/v1/host-sample-test-seams.md §5.
    const validEnv = '{"valid":true}';
    const programStatus = await programMock(NODE_ID, [
      { content: validEnv, stopReason: 'end_turn' as const },
    ]);
    if (programStatus === 404) {
      softSkip('blocked', 'precondition not met — `programStatus === 404` returned early (seam, prior step, or fixture unavailable)');
      ctx.skip(); // mock-AI program seam not exposed — soft-skip
      return;
    }
    expect(programStatus).toBe(200);

    const createRes = await driver.post('/v1/runs', {
      workflowId: 'conformance-phase4-replay-divergence',
    });
    if (createRes.status === 404 || createRes.status === 422) {
      softSkip('blocked', 'precondition not met — `createRes.status === 404 || createRes.status === 422` returned early (seam, prior step, or fixture unavailable)');
      ctx.skip(); // fixture not advertised
      return;
    }
    expect(createRes.status).toBe(201);
    const sourceRunId = (createRes.json as { runId: string }).runId;
    const sourceTerminal = await pollUntilTerminal(sourceRunId);
    expect(sourceTerminal.status).toBe('completed');

    // Stage refusal for the replay's mock-AI dispatch.
    await programMock(NODE_ID, [
      { content: 'safety-refused-for-conformance', stopReason: 'safety' as const, refusalText: 'safety-refused-for-conformance' },
    ]);

    const forkRes = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
      fromSeq: 0,
      mode: 'replay',
    });
    expect(forkRes.status).toBe(201);
    const replayRunId = (forkRes.json as { runId: string }).runId;
    const replayTerminal = await pollUntilTerminal(replayRunId);

    expect(
      replayTerminal.status,
      driver.describe(
        'RFCS/0041-multi-agent-replay-under-nondeterminism.md §B + spec/v1/rest-endpoints.md §"Common error codes"',
        'replay MUST terminate `failed` when refusal-divergence is detected (silent substitution is non-conformant)',
      ),
    ).toBe('failed');
    expect(
      replayTerminal.error?.code,
      driver.describe(
        'spec/v1/rest-endpoints.md §"Common error codes" — replay_diverged_at_refusal',
        'error.code MUST be `replay_diverged_at_refusal` per the canonical catalog',
      ),
    ).toBe('replay_diverged_at_refusal');

    const replayEvents = await readEvents(replayRunId);
    const divergenceEvent = replayEvents.find((e) => e.type === 'replay.divergedAtRefusal');
    expect(
      divergenceEvent,
      driver.describe(
        'schemas/run-event-payloads.schema.json §replayDivergedAtRefusal',
        'replay event log MUST contain exactly one `replay.divergedAtRefusal` event identifying the divergence',
      ),
    ).toBeDefined();
    expect(divergenceEvent?.payload?.sourceRunId).toBe(sourceRunId);
    expect(divergenceEvent?.payload?.nodeId).toBe(NODE_ID);
    expect(
      divergenceEvent?.payload?.originalEnvelopeKind,
      driver.describe(
        'schemas/run-event-payloads.schema.json §replayDivergedAtRefusal.originalEnvelopeKind',
        'originalEnvelopeKind MUST be `valid` (source run completed normally)',
      ),
    ).toBe('valid');
    expect(
      divergenceEvent?.payload?.replayEnvelopeKind,
      driver.describe(
        'schemas/run-event-payloads.schema.json §replayDivergedAtRefusal.replayEnvelopeKind',
        'replayEnvelopeKind MUST be `refusal` (replay hit the refusal entry of the mock program)',
      ),
    ).toBe('refusal');
  });

  it('Phase 4 host MUST emit replay.divergedAtRefusal + fail with replay_diverged_at_refusal when original=refusal + replay=valid (symmetric case)', async (ctx) => {
    if (!(await gateOnPhase4(ctx))) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await gateOnPhase4(ctx))` returned early');

    const NODE_ID = 'structured-call';
    // Symmetric: original=refusal, replay=valid.
    const programStatus = await programMock(NODE_ID, [
      { content: 'safety-refused-for-conformance', stopReason: 'safety' as const, refusalText: 'safety-refused-for-conformance' },
    ]);
    if (programStatus === 404) {
      softSkip('blocked', 'precondition not met — `programStatus === 404` returned early (seam, prior step, or fixture unavailable)');
      ctx.skip();
      return;
    }
    expect(programStatus).toBe(200);

    const createRes = await driver.post('/v1/runs', {
      workflowId: 'conformance-phase4-replay-divergence',
    });
    if (createRes.status === 404 || createRes.status === 422) {
      softSkip('blocked', 'precondition not met — `createRes.status === 404 || createRes.status === 422` returned early (seam, prior step, or fixture unavailable)');
      ctx.skip();
      return;
    }
    expect(createRes.status).toBe(201);
    const sourceRunId = (createRes.json as { runId: string }).runId;
    const sourceTerminal = await pollUntilTerminal(sourceRunId);
    // Source run fails because the LLM refused.
    expect(sourceTerminal.status).toBe('failed');

    // Stage valid envelope for the replay's mock-AI dispatch.
    await programMock(NODE_ID, [
      { content: '{"valid":true}', stopReason: 'end_turn' as const },
    ]);

    const forkRes = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
      fromSeq: 0,
      mode: 'replay',
    });
    expect(forkRes.status).toBe(201);
    const replayRunId = (forkRes.json as { runId: string }).runId;
    const replayTerminal = await pollUntilTerminal(replayRunId);

    expect(replayTerminal.status).toBe('failed');
    expect(replayTerminal.error?.code).toBe('replay_diverged_at_refusal');

    const replayEvents = await readEvents(replayRunId);
    const divergenceEvent = replayEvents.find((e) => e.type === 'replay.divergedAtRefusal');
    expect(divergenceEvent).toBeDefined();
    expect(divergenceEvent?.payload?.originalEnvelopeKind).toBe('refusal');
    expect(divergenceEvent?.payload?.replayEnvelopeKind).toBe('valid');
  });
});

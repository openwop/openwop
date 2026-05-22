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
 * Phase 4 wiring extends it to honor a "refusal on replay" mode. Until
 * that wiring lands, the assertion is surfaced as `it.todo` so test
 * reporters track the gap rather than reporting a vacuous PASS.
 *
 * @see RFCS/0041-multi-agent-replay-under-nondeterminism.md §B
 * @see spec/v1/replay.md §"Envelope-refusal recovery in replay (MAE-8 closure)"
 * @see spec/v1/multi-agent-execution.md §"Phase 4 replay determinism"
 * @see spec/v1/rest-endpoints.md §"Common error codes" — replay_diverged_at_refusal
 * @see schemas/run-event-payloads.schema.json §replayDivergedAtRefusal
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

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
  it('replayDeterminism (when present) conforms to RFC 0041 §D', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const rd = d.capabilities?.multiAgent?.executionModel?.replayDeterminism;
    if (rd === undefined) return; // soft-skip — host doesn't advertise

    expect(
      typeof rd.supported,
      driver.describe(
        'RFCS/0041-multi-agent-replay-under-nondeterminism.md §D',
        'replayDeterminism.supported MUST be boolean when present',
      ),
    ).toBe('boolean');

    if (rd.supported === true) {
      const version = d.capabilities?.multiAgent?.executionModel?.version as number | undefined;
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
  // Until the reference host wires the staged-refusal seam, surfaced as
  // `todo` so test reporters track the gap.
  it.todo('Phase 4 host MUST emit replay.divergedAtRefusal + fail with replay_diverged_at_refusal when original=valid + replay=refusal');
  it.todo('Phase 4 host MUST emit replay.divergedAtRefusal + fail with replay_diverged_at_refusal when original=refusal + replay=valid (symmetric case)');
});

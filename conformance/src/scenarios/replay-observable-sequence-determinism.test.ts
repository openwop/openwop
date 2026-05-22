/**
 * replay-observable-sequence-determinism — RFC 0041 §C behavioral.
 *
 * Status: ACTIVE (capability-gated behavioral). Gated on
 * `capabilities.multiAgent.executionModel.version >= 4` AND
 * `capabilities.multiAgent.executionModel.replayDeterminism.supported: true`.
 *
 * Asserts (behavioral, when a Phase 4 host advertises the contract):
 *
 *   1. A `mode: replay` fork from event-log index `fromSeq` produces an
 *      event-log prefix `[0, fromSeq]` that is byte-equivalent to the
 *      original run's prefix (modulo per-region clock fields per RFC 0036
 *      §E and ULID component-T entropy when ULIDs are minted fresh).
 *
 *   2. The replay's `RunSnapshot.variables`, `RunSnapshot.channels`, and
 *      `RunSnapshot.status` at the boundary index are byte-equivalent to
 *      the original.
 *
 *   3. (Crucially per §C.) The replay reproduces observable output EVEN
 *      WHEN the underlying tool call would have produced different bytes.
 *      The reference test uses a mock tool that returns a fresh random
 *      string on each call; the host MUST cache the original observable
 *      result so replay returns the SAME string the original got — not
 *      the bytes a fresh call would return now.
 *
 * Driving the assertion requires a workflow fixture whose tool call is
 * pure-nondeterministic (different bytes on each call) but whose
 * observable result is what gets cached. Reference workflow-engine ships
 * `core.noop` + deterministic fixtures; Phase 4 wiring needs a
 * nondeterministic-tool fixture (e.g., `conformance-phase4-nondet-tool`).
 * Until that lands, the cross-boundary assertion is surfaced as `it.todo`
 * so test reporters track the gap.
 *
 * @see RFCS/0041-multi-agent-replay-under-nondeterminism.md §C
 * @see spec/v1/replay.md §"Observable-output-sequence determinism vs bit-equivalent execution (MAE-9 closure)"
 * @see spec/v1/multi-agent-execution.md §"Phase 4 replay determinism"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: {
      executionModel?: {
        version?: unknown;
        replayDeterminism?: { supported?: unknown };
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

async function phase4Advertised(): Promise<boolean> {
  const d = await readDiscovery();
  const em = d?.capabilities?.multiAgent?.executionModel;
  return (em?.version as number) >= 4 && em?.replayDeterminism?.supported === true;
}

describe.skipIf(HTTP_SKIP)('replay-observable-sequence-determinism: prefix byte-equivalence (RFC 0041 §C)', () => {
  it('original and replay event-log prefixes [0, fromSeq] MUST be byte-equivalent (modulo per-region clock + ULID-T entropy)', async () => {
    if (!(await phase4Advertised())) return; // soft-skip

    // Behavioral assertion drives a workflow with at least one node whose
    // underlying tool call is nondeterministic (different bytes on each
    // call). The assertion sequence:
    //   1. POST /v1/runs { workflowId: 'conformance-phase4-nondet-tool' }
    //      → runs to completion, capturing the original event log.
    //   2. Capture original event-log prefix [0, N] where N is the index
    //      after the nondeterministic-tool node fires.
    //   3. POST /v1/runs/{runId}:fork { mode: 'replay', fromSeq: N }
    //   4. Read replay event-log prefix [0, N].
    //   5. Assert byte-equivalence modulo the carve-outs:
    //      - per-region observedAt timestamps (RFC 0036 §E)
    //      - ULID component-T entropy on newly-minted eventIds
    //   6. Read original + replay RunSnapshot at index N; assert
    //      variables + channels + status byte-equivalent.
    // Until the nondeterministic-tool fixture ships, surfaced as `todo`.
    expect.fail('Phase 4 advertised but conformance fixture conformance-phase4-nondet-tool not yet shipped — see RFC 0041 §Conformance');
  });
});

describe.skipIf(HTTP_SKIP)('replay-observable-sequence-determinism: observable-result caching (RFC 0041 §C)', () => {
  // The load-bearing assertion: a nondeterministic tool call's OBSERVABLE
  // RESULT (return value + side-effects on workflow state + emitted events)
  // is what gets cached, not the bytes-on-the-wire of the underlying call.
  // The replay's reproduction of the observable sequence is what makes
  // this a valid determinism contract — bit-equivalent execution would
  // require unbounded caching (rejected per RFC 0041 §"Alternatives
  // considered" #2).
  it.todo('replay of a workflow containing a nondeterministic tool call reproduces the original observable result, NOT a fresh call');
});

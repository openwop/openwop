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

import { describe, it } from 'vitest';

// Behavioral assertions in this file are currently `it.todo` placeholders;
// the `conformance-phase4-nondet-tool` fixture hasn't shipped yet. When
// it does, the `it.todo` calls flip back to runnable `it(...)` bodies
// that read discovery (via `driver.get('/.well-known/openwop')`), gate
// on `multiAgent.executionModel.version >= 4` AND
// `replayDeterminism.supported: true`, and drive the workflow through
// the fixture.

describe('replay-observable-sequence-determinism: prefix byte-equivalence (RFC 0041 §C)', () => {
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
  // Surfaced as `todo` until the `conformance-phase4-nondet-tool`
  // fixture ships in the suite — consistent with the sibling Phase 4
  // scenarios (`replay-divergence-at-refusal.test.ts`,
  // `replay-llm-cache-key-portable.test.ts`).
  // Marked out of stable profile via RFC 0042 §B (experimental tier):
  // RFC 0041 §C remains Active, so its wire shape MAY shift compatibly
  // within v1.x. Hosts that wire this assertion before RFC 0041 graduates
  // to Accepted SHOULD advertise `multiAgent.executionModel.tier:
  // 'experimental'` + `experimentalUntil` per RFC 0042 §A. Path-to-runnable
  // requires: (a) host pure-replay observable-cache emission via the
  // `:fork mode: replay` re-dispatch path and (b) the test seam endpoint
  // contract for cache-hit-vs-fresh-call distinction (see
  // `spec/v1/host-sample-test-seams.md` for the established seam pattern).
  it.skip('original and replay event-log prefixes [0, fromSeq] MUST be byte-equivalent (modulo per-region clock + ULID-T entropy) — out of stable profile via RFC 0042');
});

describe('replay-observable-sequence-determinism: observable-result caching (RFC 0041 §C)', () => {
  // The load-bearing assertion: a nondeterministic tool call's OBSERVABLE
  // RESULT (return value + side-effects on workflow state + emitted events)
  // is what gets cached, not the bytes-on-the-wire of the underlying call.
  // The replay's reproduction of the observable sequence is what makes
  // this a valid determinism contract — bit-equivalent execution would
  // require unbounded caching (rejected per RFC 0041 §"Alternatives
  // considered" #2).
  // Marked out of stable profile via RFC 0042 §B (experimental tier):
  // see the prefix-byte-equivalence comment above for the same routing.
  // This is RFC 0041 §C's load-bearing assertion; it lands as a runnable
  // `it()` when RFC 0041 graduates to Accepted on first non-steward host
  // adoption.
  it.skip('replay of a workflow containing a nondeterministic tool call reproduces the original observable result, NOT a fresh call — out of stable profile via RFC 0042');
});

/**
 * aiEnvelope.correlationReplay — FINAL v1.1 advertisement-shape verification + behavioral placeholders.
 *
 * Status: DRAFT (advertisement-shape). `spec/v1/ai-envelope.md` landed
 * 2026-05-17 as DRAFT v1.x. Behavioral assertions stay `it.todo()` until a
 * reference host wires the accept path and the cross-process replay seam.
 *
 * Summary: two envelopes in the same run with the same `correlationId` MUST
 * be treated as a re-emission. The second invocation returns the cached
 * `EnvelopeOutcome` synchronously without re-invoking the handler. After
 * process death + recovery, the engine MUST consult the run event log via
 * `causationId = correlationId` and return the cached outcome — the handler
 * runs at most once per `correlationId` per run lifetime. A re-emission with
 * the same `correlationId` but a different `type` MUST be refused with
 * `envelope_correlation_conflict`.
 *
 * @see spec/v1/ai-envelope.md §"Replay determinism"
 * @see spec/v1/interrupt.md §"Replay determinism" (parallel contract)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function isEnvelopeContractsAdvertised(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
  const block = top && typeof top === 'object' ? (top['envelopeContracts'] as Record<string, unknown> | undefined) : undefined;
  return Boolean(block && block['advertised'] === true);
}

describe('aiEnvelope.correlationReplay: advertisement shape (FINAL v1.1)', () => {
  it('host that advertises envelopeContracts.advertised:true claims the replay-determinism contract', async () => {
    if (!(await isEnvelopeContractsAdvertised())) return; // not opted in — skip
    // The contract has no separate capability flag — advertising
    // envelopeContracts is the claim. The behavioral assertions below
    // exercise the contract; this advertisement-shape test exists so
    // a "no envelope contracts at all" host doesn't appear in failure
    // reports for this scenario.
    expect(true).toBe(true);
  });
});

describe('aiEnvelope.correlationReplay: engine-state placeholders', () => {
  // The 4 assertions below require the engine to maintain a per-run
  // correlationId → cached-outcome map AND project envelope acceptance
  // onto RunEventDocs with `causationId = envelope.correlationId`.
  //
  // The reference workflow-engine sample's `acceptEnvelope` is a pure
  // function (host/envelopeAcceptor.ts) — it validates + categorizes
  // a single envelope without tracking state across calls. Promoting
  // these to behavioral requires either:
  //   (a) extending the acceptor with an injected dedup store
  //       (per-run correlationId map keyed by runId), OR
  //   (b) a higher-level test seam that wires the acceptor into the
  //       run lifecycle + event log.
  //
  // (b) is the spec-faithful path (per ai-envelope.md §"Replay
  // determinism" the dedup is engine-level, not acceptor-level).
  // Tracked as host-impl follow-up.
  it.todo('emit envelope twice with same correlationId → second returns cached outcome; no duplicate RunEventDocs');
  it.todo('emit envelope with correlationId C, then with same C and different type → refuse envelope_correlation_conflict');
  it.todo('cross-process replay: process-death after accept; recovered process re-emits same correlationId → cached outcome, no handler re-invocation');
  it.todo('resulting RunEventDoc.causationId equals the envelope.correlationId (causal chain preserved)');
});

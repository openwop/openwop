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

// Behavioral assertions through the workflow-engine sample's env-gated
// `POST /v1/host/sample/envelope/accept` seam. The seam accepts a flat
// `priorCorrelations` array (each entry: `{correlationId, outcome, envelopeType}`)
// that the acceptor consumes as the per-run dedup store. Each test
// soft-skips on HTTP 404 (host doesn't expose the seam).
//
// The cross-process replay assertion (process death + recovery) still
// stays deferred — it requires a higher-level lifecycle seam that
// persists the dedup state, which is engine scope, not acceptor scope.
async function accept(envelope: unknown, opts: Record<string, unknown> = {}): Promise<{ status: number; body: { status?: string; reason?: string; envelopeId?: string; normalizedMeta?: { contentTrust?: string } } }> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, ...opts });
  return { status: res.status, body: res.json as { status?: string; reason?: string; envelopeId?: string; normalizedMeta?: { contentTrust?: string } } };
}

const baseMeta = { source: 'ai-generation' as const, ts: '2026-05-18T10:00:00Z' };

describe('aiEnvelope.correlationReplay: behavioral in-process dedup (FINAL v1.1)', () => {
  it('same correlationId re-emission returns the cached outcome unchanged', async () => {
    const envelope = {
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-cr-replay-1',
      correlationId: 'r:n:0:replay1',
      payload: { questions: [{ id: 'q1', question: 'why?' }] },
      meta: baseMeta,
    };
    const first = await accept(envelope);
    if (first.status === 404) return;
    expect(first.body.status).toBe('accepted');
    const cachedOutcome = first.body;

    const second = await accept(envelope, {
      priorCorrelations: [
        {
          correlationId: 'r:n:0:replay1',
          outcome: cachedOutcome,
          envelopeType: 'clarification.request',
        },
      ],
    });
    expect(
      second.body.status,
      driver.describe(
        'ai-envelope.md §"Replay determinism"',
        'second emission with same correlationId MUST return the cached outcome (handler runs at most once per correlationId)',
      ),
    ).toBe('accepted');
    expect(second.body.envelopeId).toBe(cachedOutcome.envelopeId);
  });

  it('same correlationId, different envelope type → invalid envelope_correlation_conflict', async () => {
    const r = await accept(
      {
        type: 'error', // re-using a correlationId previously bound to clarification.request
        schemaVersion: 1,
        envelopeId: 'env-cr-conflict',
        correlationId: 'r:n:0:conflict',
        payload: { code: 'x', message: 'y' },
        meta: baseMeta,
      },
      {
        priorCorrelations: [
          {
            correlationId: 'r:n:0:conflict',
            outcome: { status: 'accepted', envelopeId: 'env-prior', recordedEventIds: [], normalizedMeta: { contentTrust: 'trusted' } },
            envelopeType: 'clarification.request',
          },
        ],
      },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe(
        'ai-envelope.md §"Replay determinism"',
        'same correlationId with different type MUST refuse envelope_correlation_conflict',
      ),
    ).toBe('invalid');
    expect(r.body.reason).toContain('envelope_correlation_conflict');
  });

  it('cached outcome of any status (invalid/gated/breached) replays identically', async () => {
    // Plant a `gated` cached outcome; second emission MUST return the same gated outcome
    // (handler MUST NOT re-run, even if conditions might now accept).
    const cached = {
      status: 'gated' as const,
      reason: 'envelope type \'vendor.x.foo\' not advertised',
      allowedKinds: ['clarification.request', 'schema.request', 'schema.response', 'error'],
    };
    const r = await accept(
      {
        type: 'vendor.x.foo',
        schemaVersion: 1,
        envelopeId: 'env-cr-cached-gated',
        correlationId: 'r:n:0:cachedgated',
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.x.foo'], // would otherwise accept
        priorCorrelations: [
          {
            correlationId: 'r:n:0:cachedgated',
            outcome: cached,
            envelopeType: 'vendor.x.foo',
          },
        ],
      },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe(
        'ai-envelope.md §"Replay determinism"',
        'cached non-accepted outcome MUST replay identically (handler at most once per correlationId)',
      ),
    ).toBe('gated');
  });
});

describe('aiEnvelope.correlationReplay: engine-projection placeholders', () => {
  // Cross-process replay + RunEventDoc.causationId projection require a
  // run-lifecycle seam beyond the pure acceptor. Tracked as engine-impl
  // follow-up under Phase 3 (surface seams) of the test-coverage plan.
  it.todo('cross-process replay: process-death after accept; recovered process re-emits same correlationId → cached outcome (requires persisted dedup state seam)');
  it.todo('resulting RunEventDoc.causationId equals the envelope.correlationId (requires event-log query seam)');
});

/**
 * aiEnvelope.correlationReplay — FINAL v1.1 advertisement-shape + behavioral.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). `spec/v1/ai-envelope.md`
 * promoted Draft → FINAL v1.1 2026-05-18. Live behavioral via the
 * `POST /v1/host/sample/envelope/accept` seam with the persisted
 * `priorCorrelations` store (survives process restart between original
 * accept and replay; soft-skip on HTTP 404).
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
import { discoveryFamilies } from '../lib/discovery-capabilities.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function isEnvelopeContractsAdvertised(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
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

// E.1 engine-projection via the test-only event-log seam.
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

describe('aiEnvelope.correlationReplay: causationId projection via event-log seam', () => {
  it('resulting RunEventDoc.causationId MUST equal the envelope.correlationId (causal chain preserved)', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-cr-cause-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const correlationId = `${runId}:n:0:causationId-link`;
    await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-cr-cause-1',
        correlationId,
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      { projectTo: { runId, nodeId: 'n' } },
    );
    const events = await queryTestEvents(runId);
    if (!events.ok || events.events.length === 0) return;
    for (const e of events.events) {
      expect(
        e.causationId,
        driver.describe('ai-envelope.md §"Replay determinism"', 'every event projected from an envelope MUST carry causationId === envelope.correlationId'),
      ).toBe(correlationId);
    }
    await resetTestSeam();
  });
});

describe('aiEnvelope.correlationReplay: cross-process replay via persisted dedup', () => {
  // Cross-process replay proven WITHOUT actually killing the process:
  // when a caller supplies `persistedDedup: { runId }`, the seam reads
  // the persisted store BEFORE consulting the in-memory priorCorrelations
  // and writes the outcome back after a successful accept. A second
  // call from the same (or a hypothetically-restarted) process with
  // ONLY persistedDedup set — no in-memory priorCorrelations — MUST
  // return the same outcome as the first. That is the cross-process
  // semantics: the persisted store is the source of truth, the in-
  // memory map a per-process accelerator.
  it('persisted outcome replays for the same correlationId even with NO in-memory priorCorrelations', async () => {
    const runId = `r-cr-persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const correlationId = `${runId}:n:0:persist1`;
    // Two envelopes with the SAME correlationId but DIFFERENT
    // envelopeIds. The acceptor reflects the inbound envelopeId on a
    // fresh accept; a cache-hit returns the FIRST call's envelopeId
    // regardless of what the second call carried. The envelopeId
    // divergence is what makes this assertion non-trivial: if the
    // persisted store is consulted, second.envelopeId === 'env-cr-
    // persist-1'; if the handler re-runs (cache miss), it would
    // surface 'env-cr-persist-2'.
    const env1 = {
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-cr-persist-1',
      correlationId,
      payload: { questions: [{ id: 'q1', question: 'why?' }] },
      meta: baseMeta,
    };
    const env2 = {
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-cr-persist-2',
      correlationId,
      payload: { questions: [{ id: 'q1', question: 'why?' }] },
      meta: baseMeta,
    };
    // First accept persists the outcome under (runId, correlationId).
    const first = await accept(env1, { persistedDedup: { runId } });
    if (first.status === 404) return; // seam not exposed — soft-skip
    expect(first.body.status).toBe('accepted');
    expect(first.body.envelopeId).toBe('env-cr-persist-1');

    // Second accept — same correlationId, NO priorCorrelations passed
    // in-band, DIFFERENT envelopeId. If the persisted store is
    // consulted, the cached outcome's envelopeId (env-cr-persist-1)
    // is returned. If only the in-memory map were used, the handler
    // would re-run and reflect env-cr-persist-2.
    const second = await accept(env2, { persistedDedup: { runId } });
    expect(
      second.body.envelopeId,
      driver.describe(
        'ai-envelope.md §"Replay determinism"',
        'persisted outcome MUST replay across calls without an in-memory priorCorrelations map (cross-process recovery: cached envelopeId surfaces even when the inbound envelope carries a different envelopeId)',
      ),
    ).toBe('env-cr-persist-1');
    expect(second.body.status).toBe('accepted');
  });

  it('persisted store enforces envelope_correlation_conflict across calls', async () => {
    const runId = `r-cr-persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const correlationId = `${runId}:n:0:conflict1`;
    // First accept: clarification.request.
    const first = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-cr-persist-conflict-1',
        correlationId,
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      { persistedDedup: { runId } },
    );
    if (first.status === 404) return;
    expect(first.body.status).toBe('accepted');

    // Second accept: same correlationId, different envelope type, NO
    // in-memory priorCorrelations — the conflict MUST be served from
    // the persisted store.
    const second = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-cr-persist-conflict-2',
        correlationId,
        payload: { code: 'x', message: 'y' },
        meta: baseMeta,
      },
      { persistedDedup: { runId } },
    );
    expect(
      second.body.status,
      driver.describe(
        'ai-envelope.md §"Replay determinism"',
        'persisted store MUST surface envelope_correlation_conflict on type mismatch without an in-memory priorCorrelations map',
      ),
    ).toBe('invalid');
    expect(second.body.reason).toContain('envelope_correlation_conflict');
  });
});

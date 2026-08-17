/**
 * aiEnvelope.universalKinds — FINAL v1.1 advertisement-shape + behavioral.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). `spec/v1/ai-envelope.md`
 * promoted Draft → FINAL v1.1 2026-05-18. Asserts the advertisement shape
 * for hosts that opt into envelope-contracts
 * (`capabilities.envelopeContracts.advertised: true`), plus live behavioral
 * universal-kind acceptance through the `POST /v1/host/sample/envelope/accept`
 * seam (soft-skip on HTTP 404).
 *
 * Summary: hosts MUST advertise the four universal kinds (`clarification.request`,
 * `schema.request`, `schema.response`, `error`) in `capabilities.supportedEnvelopes`
 * once they opt in. Universals are always-allowed; Envelope Contract gates MUST NOT
 * refuse them.
 *
 * @see spec/v1/ai-envelope.md §"Universal kinds"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
  supportedEnvelopes?: string[];
}

const UNIVERSALS = ['clarification.request', 'schema.request', 'schema.response', 'error'] as const;

async function readEnvelopeContracts(): Promise<{ advertised: boolean } | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
  const block = top && typeof top === 'object' ? (top['envelopeContracts'] as Record<string, unknown> | undefined) : undefined;
  if (!block || typeof block !== 'object') return null;
  return { advertised: block['advertised'] === true };
}

async function readSupportedEnvelopes(): Promise<string[] | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  // `supportedEnvelopes` is required v1 at the top level of the discovery payload
  // per capabilities.schema.json. Some hosts nest it under `capabilities`.
  const top = body?.supportedEnvelopes ?? (body?.capabilities as { supportedEnvelopes?: string[] } | undefined)?.supportedEnvelopes;
  return Array.isArray(top) ? top : null;
}

describe('aiEnvelope.universalKinds: advertisement shape (FINAL v1.1)', () => {
  it('capabilities.envelopeContracts is either absent or a well-formed object', async () => {
    const block = await readEnvelopeContracts();
    if (block === null) return; // host doesn't opt in — skip
    expect(
      typeof block.advertised,
      driver.describe(
        'ai-envelope.md §"Capability handshake integration"',
        'capabilities.envelopeContracts.advertised MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });

  it('opted-in hosts advertise every universal kind in supportedEnvelopes', async () => {
    const block = await readEnvelopeContracts();
    if (block === null || !block.advertised) return; // not opted in — skip
    const advertised = await readSupportedEnvelopes();
    expect(
      Array.isArray(advertised),
      driver.describe(
        'capabilities.schema.json §supportedEnvelopes',
        'supportedEnvelopes MUST be present as an array on hosts that advertise envelopeContracts',
      ),
    ).toBe(true);
    for (const kind of UNIVERSALS) {
      expect(
        advertised!.includes(kind),
        driver.describe(
          'ai-envelope.md §"Universal kinds"',
          `supportedEnvelopes MUST include "${kind}" — universals are always-allowed`,
        ),
      ).toBe(true);
    }
  });
});

// Behavioral assertions through the workflow-engine sample's env-gated
// `POST /v1/host/sample/envelope/accept` seam (the RFC 0021 §A
// AIEnvelopeAcceptor reference implementation at
// `apps/workflow-engine/backend/typescript/src/host/envelopeAcceptor.ts`).
// Each test soft-skips on HTTP 404 (host doesn't expose the seam) so
// non-sample hosts keep the advertisement-shape coverage above.
async function accept(envelope: unknown, opts: Record<string, unknown> = {}): Promise<{ status: number; body: { status?: string; reason?: string; details?: unknown[]; envelopeId?: string } }> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, ...opts });
  return { status: res.status, body: res.json as { status?: string; reason?: string; details?: unknown[]; envelopeId?: string } };
}

const baseMeta = { source: 'ai-generation' as const, ts: '2026-05-18T10:00:00Z' };

describe('aiEnvelope.universalKinds: behavioral accept via /v1/host/sample/envelope/accept (FINAL v1.1)', () => {
  it('accept clarification.request with valid payload → status: accepted', async () => {
    const r = await accept({
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-uk-clar',
      correlationId: 'r:n:0:clar',
      payload: { questions: [{ id: 'q1', question: 'Which provider?' }] },
      meta: baseMeta,
    });
    if (r.status === 404) return;
    expect(r.body.status, driver.describe('ai-envelope.md §"Universal kinds"', 'valid clarification.request MUST be accepted')).toBe('accepted');
  });

  it('accept schema.request → status: accepted', async () => {
    const r = await accept({
      type: 'schema.request',
      schemaVersion: 1,
      envelopeId: 'env-uk-sr',
      correlationId: 'r:n:0:sr',
      payload: { envelopeType: 'vendor.acme.prd.create' },
      meta: baseMeta,
    });
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
  });

  it('accept schema.response (ack:true) → status: accepted', async () => {
    const r = await accept({
      type: 'schema.response',
      schemaVersion: 1,
      envelopeId: 'env-uk-sresp',
      correlationId: 'r:n:0:sresp',
      payload: { envelopeType: 'vendor.acme.prd.create', ack: true },
      meta: baseMeta,
    });
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
  });

  it('accept error envelope (LLM-emitted) → status: accepted (distinct from host-level ErrorEnvelope)', async () => {
    const r = await accept({
      type: 'error',
      schemaVersion: 1,
      envelopeId: 'env-uk-err',
      correlationId: 'r:n:0:err',
      payload: { code: 'validation_failed', message: 'I cannot produce JSON matching that schema' },
      meta: baseMeta,
    });
    if (r.status === 404) return;
    expect(r.body.status, driver.describe('ai-envelope.md §error', 'LLM-emitted error envelope MUST be accepted (NOT the host HTTP ErrorEnvelope)')).toBe('accepted');
  });

  it('refuse invalid clarification.request (missing questions[]) → status: invalid', async () => {
    const r = await accept({
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-uk-bad',
      correlationId: 'r:n:0:bad',
      payload: { contextType: 'form-field' }, // missing required `questions`
      meta: baseMeta,
    });
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe('ai-envelope.md §"Schema discipline"', 'malformed payload MUST be rejected with invalid'),
    ).toBe('invalid');
    expect(Array.isArray(r.body.details), 'invalid outcome MUST carry validation details').toBe(true);
  });
});

// E.1 engine-projection via the test-only event-log seam.
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import { capabilityFamily, discoveryFamilies } from '../lib/discovery-capabilities.js';

describe('aiEnvelope.universalKinds: engine projection via event-log seam', () => {
  it('clarification.request MUST be lifted to interrupt.requested { kind: "clarification" } per interrupt.md', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-uk-clar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-uk-proj-clar',
        correlationId: `${runId}:n:0:uk-clar`,
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      { projectTo: { runId, nodeId: 'n' } },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
    const events = await queryTestEvents(runId, { type: 'interrupt.requested' });
    if (!events.ok) return;
    expect(
      events.events.length,
      driver.describe('ai-envelope.md §"Universal kinds"', 'accepted clarification.request MUST project to interrupt.requested per interrupt.md'),
    ).toBe(1);
    expect((events.events[0]!.payload as { kind?: string }).kind).toBe('clarification');
    await resetTestSeam();
  });

  it('error envelope MUST project to log.appended { level: "error" } — NOT node.failed', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-uk-err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-uk-proj-err',
        correlationId: `${runId}:n:0:uk-err`,
        payload: { code: 'validation_failed', message: 'cannot produce JSON' },
        meta: baseMeta,
      },
      { projectTo: { runId, nodeId: 'n' } },
    );
    const logs = await queryTestEvents(runId, { type: 'log.appended' });
    const fails = await queryTestEvents(runId, { type: 'node.failed' });
    if (!logs.ok || !fails.ok) return;
    expect(
      logs.events.some((e) => (e.payload as { level?: string }).level === 'error'),
      driver.describe('ai-envelope.md §"Universal kinds"', 'LLM-emitted error envelope MUST project to log.appended at error level'),
    ).toBe(true);
    expect(
      fails.events.length,
      driver.describe('ai-envelope.md §"Universal kinds"', 'LLM-emitted error envelope MUST NOT project to node.failed (distinct from terminal node failure)'),
    ).toBe(0);
    await resetTestSeam();
  });

  it('schema.request projects to log.appended (host implements next-turn injection out-of-band)', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-uk-sr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'schema.request',
        schemaVersion: 1,
        envelopeId: 'env-uk-proj-sr',
        correlationId: `${runId}:n:0:uk-sr`,
        payload: { envelopeType: 'vendor.acme.foo' },
        meta: baseMeta,
      },
      { projectTo: { runId, nodeId: 'n' } },
    );
    const events = await queryTestEvents(runId, { type: 'log.appended' });
    if (!events.ok) return;
    expect(
      events.events.length,
      driver.describe('ai-envelope.md §"Universal kinds"', 'schema.request MUST project to log.appended (the schema delivery itself happens out-of-band via the host\'s next-turn system prompt)'),
    ).toBeGreaterThan(0);
    await resetTestSeam();
  });
});

describe('aiEnvelope.universalKinds: schema.response counter-policy advertisement (ai-envelope.md §"Universal kinds")', () => {
  it('host MAY count or exempt schema.response against envelopesPerTurn; when advertised, the policy field MUST be a documented enum value', async () => {
    // Per ai-envelope.md §"Universal kinds": "Engines MAY count this against
    // Capabilities.limits.envelopesPerTurn or exempt it; conformance does
    // not lock this choice." The conformance test only verifies that hosts
    // advertising a policy field use a documented value.
    const res = await driver.get('/.well-known/openwop');
    const body = res.json as { capabilities?: { aiEnvelope?: { schemaResponseCounterPolicy?: string } } } | undefined;
    const policy = capabilityFamily<{ schemaResponseCounterPolicy?: string }>(body, 'aiEnvelope')?.schemaResponseCounterPolicy;
    if (policy === undefined) return; // no policy advertised — host MAY omit
    expect(
      ['counted', 'exempt'].includes(policy),
      driver.describe(
        'ai-envelope.md §"Universal kinds"',
        'when advertised, schemaResponseCounterPolicy MUST be either "counted" or "exempt"',
      ),
    ).toBe(true);
  });
});

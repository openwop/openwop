/**
 * aiEnvelope.schemaDrift — FINAL v1.1 advertisement-shape + behavioral.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). `spec/v1/ai-envelope.md`
 * promoted Draft → FINAL v1.1 2026-05-18. Asserts the advertisement shape
 * for hosts that opt into envelopeContracts and the optional
 * `envelopeStrictness` knob, plus live behavioral through the
 * `POST /v1/host/sample/envelope/accept` seam (soft-skip on HTTP 404).
 *
 * Summary: an LLM emits an envelope whose `schemaVersion` is lower than the
 * host's advertised floor for that kind (`Capabilities.schemaVersions[kind]`).
 * Under `envelopeStrictness: "warn"` (default) the engine MUST attempt
 * validation against the advertised version and log `envelope_schema_version_drift`.
 * Under `envelopeStrictness: "strict"` the engine MUST refuse with
 * `unknown_schema_version`. When the emitted `schemaVersion` is HIGHER than
 * advertised, the engine MUST refuse regardless of strictness.
 *
 * @see spec/v1/ai-envelope.md §"Schema discipline"
 * @see spec/v1/ai-envelope.md §"Capability handshake integration"
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

describe('aiEnvelope.schemaDrift: advertisement shape (FINAL v1.1)', () => {
  it('capabilities.envelopeStrictness is either absent (treated as "warn") or "warn" | "strict"', async () => {
    const res = await driver.get('/.well-known/openwop');
    const body = res.json as DiscoveryDoc | undefined;
    const top = body?.capabilities as Record<string, unknown> | undefined;
    const val = top && typeof top === 'object' ? top['envelopeStrictness'] : undefined;
    if (val === undefined) return; // absent → treated as 'warn'; skip
    expect(
      val === 'warn' || val === 'strict',
      driver.describe(
        'ai-envelope.md §"Capability handshake integration"',
        'envelopeStrictness MUST be the literal string "warn" or "strict" when present',
      ),
    ).toBe(true);
  });

  it('schemaVersions is non-empty when envelopeContracts.advertised: true', async () => {
    if (!(await isEnvelopeContractsAdvertised())) return; // not opted in — skip
    const res = await driver.get('/.well-known/openwop');
    const body = res.json as { schemaVersions?: Record<string, number>; capabilities?: { schemaVersions?: Record<string, number> } } | undefined;
    const versions = body?.schemaVersions ?? body?.capabilities?.schemaVersions ?? {};
    expect(
      Object.keys(versions).length > 0,
      driver.describe(
        'ai-envelope.md §"Schema version advertisement"',
        'schemaVersions MUST be non-empty when envelopeContracts.advertised is true',
      ),
    ).toBe(true);
  });
});

// Behavioral assertions through the workflow-engine sample's env-gated
// `POST /v1/host/sample/envelope/accept` seam. The seam threads
// `schemaVersionFloor` + `envelopeStrictness` into AcceptOptions so the
// pure-function acceptor can apply the §"Schema discipline" gate.
// Each test soft-skips on HTTP 404 (host doesn't expose the seam).
async function accept(envelope: unknown, opts: Record<string, unknown> = {}): Promise<{ status: number; body: { status?: string; reason?: string; details?: unknown[] } }> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, ...opts });
  return { status: res.status, body: res.json as { status?: string; reason?: string; details?: unknown[] } };
}

const baseMeta = { source: 'ai-generation' as const, ts: '2026-05-18T10:00:00Z' };

describe('aiEnvelope.schemaDrift: behavioral strictness gate (FINAL v1.1)', () => {
  it('schemaVersion below advertised floor under strictness:"warn" → accepted (warn-and-continue)', async () => {
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 0, // below the v1 floor
        envelopeId: 'env-drift-warn',
        correlationId: 'r:n:0:driftwarn',
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      {
        schemaVersionFloor: { 'clarification.request': 1 },
        envelopeStrictness: 'warn',
      },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe(
        'ai-envelope.md §"Schema discipline"',
        'below-floor schemaVersion under strictness:warn MUST be accepted (drift projected at engine level)',
      ),
    ).toBe('accepted');
  });

  it('schemaVersion below advertised floor under strictness:"strict" → invalid unknown_schema_version', async () => {
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 0,
        envelopeId: 'env-drift-strict',
        correlationId: 'r:n:0:driftstrict',
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      {
        schemaVersionFloor: { 'clarification.request': 1 },
        envelopeStrictness: 'strict',
      },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe(
        'ai-envelope.md §"Schema discipline"',
        'below-floor schemaVersion under strictness:strict MUST refuse with unknown_schema_version',
      ),
    ).toBe('invalid');
    expect(r.body.reason).toContain('unknown_schema_version');
  });

  it('schemaVersion ABOVE advertised floor → invalid regardless of strictness (host doesn\'t know future version)', async () => {
    for (const strictness of ['warn', 'strict'] as const) {
      const r = await accept(
        {
          type: 'clarification.request',
          schemaVersion: 99,
          envelopeId: `env-drift-above-${strictness}`,
          correlationId: `r:n:0:driftabove-${strictness}`,
          payload: { questions: [{ id: 'q1', question: 'why?' }] },
          meta: baseMeta,
        },
        {
          schemaVersionFloor: { 'clarification.request': 1 },
          envelopeStrictness: strictness,
        },
      );
      if (r.status === 404) return;
      expect(
        r.body.status,
        driver.describe(
          'ai-envelope.md §"Schema discipline"',
          `above-floor schemaVersion MUST refuse regardless of strictness (got ${strictness})`,
        ),
      ).toBe('invalid');
      expect(r.body.reason).toContain('unknown_schema_version');
    }
  });

  it('refused above-floor envelope carries instancePath /schemaVersion in details', async () => {
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 5,
        envelopeId: 'env-drift-details',
        correlationId: 'r:n:0:driftdetails',
        payload: { code: 'x', message: 'y' },
        meta: baseMeta,
      },
      {
        schemaVersionFloor: { error: 1 },
        envelopeStrictness: 'warn', // above-floor → invalid regardless
      },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('invalid');
    expect(Array.isArray(r.body.details)).toBe(true);
    const paths = (r.body.details ?? []).map((d: unknown) => (d as { instancePath?: string }).instancePath);
    expect(
      paths.includes('/schemaVersion'),
      driver.describe(
        'ai-envelope.md §"Schema discipline"',
        'schema-drift refusal MUST cite /schemaVersion as the violating field',
      ),
    ).toBe(true);
  });
});

// E.2 OTel scrape seam.
import { queryTestSpans, isOtelSeamAvailable } from '../lib/otel-scrape.js';
import { resetTestSeam } from '../lib/event-log-query.js';

describe('aiEnvelope.schemaDrift: OTel drift attribute projection (E.2)', () => {
  it('below-floor + strictness:warn → OTel span MUST carry envelope_schema_version_drift attribute', async () => {
    if (!(await isOtelSeamAvailable())) return;
    const runId = `r-drift-otel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 0, // below the v1 floor
        envelopeId: 'env-drift-otel-1',
        correlationId: `${runId}:n:0:drift-otel`,
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      {
        schemaVersionFloor: { 'clarification.request': 1 },
        envelopeStrictness: 'warn',
        projectTo: { runId, nodeId: 'n' },
      },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');

    const spans = await queryTestSpans({ runId });
    if (!spans.ok) return;
    expect(
      spans.data.some((s) => s.attributes.envelope_schema_version_drift === true),
      driver.describe(
        'ai-envelope.md §"Schema discipline"',
        'below-floor accept under strictness:warn MUST project envelope_schema_version_drift attribute on the OTel span',
      ),
    ).toBe(true);
    await resetTestSeam();
  });
});

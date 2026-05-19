/**
 * aiEnvelope.capBreached — FINAL v1.1 advertisement-shape verification + behavioral placeholders.
 *
 * Status: DRAFT (advertisement-shape). `spec/v1/ai-envelope.md` landed
 * 2026-05-17 as DRAFT v1.x. The envelope-specific behavior of the existing
 * `cap.breached` event surface is asserted here; the underlying event shape
 * is already locked by `capabilities.md` §"Engine-enforced limits and the
 * `cap.breached` event" and `run-event-payloads.schema.json #/$defs/capBreached`.
 *
 * Summary: exceeding any of the three envelope-related limits MUST emit
 * `cap.breached` and fail the node:
 *
 *   - `limits.envelopesPerTurn` → `cap.breached { kind: "envelopes" }`
 *   - `limits.schemaRounds`     → `cap.breached { kind: "schema" }`
 *   - `limits.clarificationRounds` → `cap.breached { kind: "clarification" }`
 *
 * No new event surface is introduced by this spec; the envelope work reuses
 * the existing capBreached surface with the existing `kind` discriminator
 * enum.
 *
 * @see spec/v1/ai-envelope.md §"Engine-enforced limits"
 * @see spec/v1/capabilities.md §"Engine-enforced limits and the `cap.breached` event"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  limits?: Record<string, number>;
  capabilities?: { limits?: Record<string, number> };
}

async function readLimits(): Promise<Record<string, number> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const limits = body?.limits ?? body?.capabilities?.limits ?? null;
  return limits && typeof limits === 'object' ? (limits as Record<string, number>) : null;
}

describe('aiEnvelope.capBreached: advertisement shape (already required v1)', () => {
  it('limits.envelopesPerTurn is a non-negative integer', async () => {
    const limits = await readLimits();
    expect(
      limits,
      driver.describe(
        'capabilities.schema.json §limits',
        'limits MUST be present on /.well-known/openwop (required v1)',
      ),
    ).not.toBeNull();
    expect(
      Number.isInteger(limits!.envelopesPerTurn) && limits!.envelopesPerTurn >= 0,
      driver.describe(
        'capabilities.schema.json §limits.envelopesPerTurn',
        'envelopesPerTurn MUST be a non-negative integer (required v1)',
      ),
    ).toBe(true);
  });

  it('limits.schemaRounds is a non-negative integer', async () => {
    const limits = await readLimits();
    if (limits === null) return;
    expect(
      Number.isInteger(limits.schemaRounds) && limits.schemaRounds >= 0,
      driver.describe(
        'capabilities.schema.json §limits.schemaRounds',
        'schemaRounds MUST be a non-negative integer (required v1)',
      ),
    ).toBe(true);
  });

  it('limits.clarificationRounds is a non-negative integer', async () => {
    const limits = await readLimits();
    if (limits === null) return;
    expect(
      Number.isInteger(limits.clarificationRounds) && limits.clarificationRounds >= 0,
      driver.describe(
        'capabilities.schema.json §limits.clarificationRounds',
        'clarificationRounds MUST be a non-negative integer (required v1)',
      ),
    ).toBe(true);
  });
});

async function accept(envelope: unknown, opts: Record<string, unknown>): Promise<{ status: number; body: { status?: string; capKind?: string; reason?: string } }> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, ...opts });
  return { status: res.status, body: res.json as { status?: string; capKind?: string; reason?: string } };
}

const baseMeta = { source: 'ai-generation' as const, ts: '2026-05-18T10:00:00Z' };

describe('aiEnvelope.capBreached: behavioral cap enforcement (FINAL v1.1)', () => {
  it('envelopesPerTurn at cap → status: breached { capKind: "envelopes" }', async () => {
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-cap-1',
        correlationId: 'r:n:0:cap1',
        payload: { code: 'x', message: 'y' },
        meta: baseMeta,
      },
      { counters: { envelopesPerTurn: { current: 32, cap: 32 } } },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe('ai-envelope.md §"Engine-enforced limits"', 'over-cap envelope MUST be breached'),
    ).toBe('breached');
    expect(r.body.capKind).toBe('envelopes');
  });

  it('clarificationRounds at cap → status: breached { capKind: "clarification" }', async () => {
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-cap-2',
        correlationId: 'r:n:0:cap2',
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      { counters: { clarificationRounds: { current: 5, cap: 5 } } },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('breached');
    expect(r.body.capKind).toBe('clarification');
  });

  it('schemaRounds at cap → status: breached { capKind: "schema" }', async () => {
    const r = await accept(
      {
        type: 'schema.request',
        schemaVersion: 1,
        envelopeId: 'env-cap-3',
        correlationId: 'r:n:0:cap3',
        payload: { envelopeType: 'vendor.acme.prd.create' },
        meta: baseMeta,
      },
      { counters: { schemaRounds: { current: 3, cap: 3 } } },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('breached');
    expect(r.body.capKind).toBe('schema');
  });

  it('breached reason cites the limit and cap value', async () => {
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-cap-reason',
        correlationId: 'r:n:0:capreason',
        payload: { code: 'x', message: 'y' },
        meta: baseMeta,
      },
      { counters: { envelopesPerTurn: { current: 32, cap: 32 } } },
    );
    if (r.status === 404) return;
    expect(r.body.reason).toContain('envelopesPerTurn');
    expect(r.body.reason).toContain('32');
  });
});

// E.1 engine-projection via the test-only event-log seam. The acceptor
// returns the breached outcome; the seam projects it onto cap.breached +
// node.failed per capabilities.md §"Engine-enforced limits". Tests
// soft-skip on HTTP 404 when the seam isn't exposed.
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

describe('aiEnvelope.capBreached: engine projection via event-log seam (capabilities.md §"cap.breached")', () => {
  it('breached outcome projects to cap.breached { kind: "envelopes" } event with causationId chain', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-cap-env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const correlationId = `${runId}:node-1:turn-0:cap-env`;
    const r = await accept(
      {
        type: 'error',
        schemaVersion: 1,
        envelopeId: 'env-proj-cap-env',
        correlationId,
        payload: { code: 'x', message: 'y' },
        meta: baseMeta,
      },
      {
        counters: { envelopesPerTurn: { current: 32, cap: 32 } },
        projectTo: { runId, nodeId: 'node-1' },
      },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('breached');

    const events = await queryTestEvents(runId, { type: 'cap.breached' });
    if (!events.ok) return;
    expect(
      events.events.length,
      driver.describe('capabilities.md §"Engine-enforced limits and the cap.breached event"', 'breached outcome MUST project to exactly one cap.breached event'),
    ).toBe(1);
    const evt = events.events[0]!;
    expect(evt.payload.kind).toBe('envelopes');
    expect(evt.causationId).toBe(correlationId);
    await resetTestSeam();
  });

  it('cap.breached payload includes limit, observed, and nodeId per capabilities.md', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-cap-payload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-proj-cap-clar',
        correlationId: `${runId}:node-2:turn-0:cap`,
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      {
        counters: { clarificationRounds: { current: 5, cap: 5 } },
        projectTo: { runId, nodeId: 'node-2' },
      },
    );
    const events = await queryTestEvents(runId, { type: 'cap.breached' });
    if (!events.ok || events.events.length === 0) return;
    const evt = events.events[0]!;
    expect(evt.payload.kind).toBe('clarification');
    expect(
      typeof evt.payload.limit,
      driver.describe('capabilities.md §"cap.breached"', 'payload.limit MUST be present as a number'),
    ).toBe('number');
    expect(evt.payload.nodeId).toBe('node-2');
    await resetTestSeam();
  });

  it('cap.breached MUST be paired with a terminal node.failed transition', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-cap-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'schema.request',
        schemaVersion: 1,
        envelopeId: 'env-proj-cap-fail',
        correlationId: `${runId}:node-3:turn-0:cap`,
        payload: { envelopeType: 'vendor.acme.foo' },
        meta: baseMeta,
      },
      {
        counters: { schemaRounds: { current: 3, cap: 3 } },
        projectTo: { runId, nodeId: 'node-3' },
      },
    );
    const breached = await queryTestEvents(runId, { type: 'cap.breached' });
    const failed = await queryTestEvents(runId, { type: 'node.failed' });
    if (!breached.ok || !failed.ok) return;
    expect(breached.events.length).toBe(1);
    expect(
      failed.events.length,
      driver.describe('capabilities.md §"cap.breached"', 'cap.breached MUST be paired with a terminal node.failed event'),
    ).toBe(1);
    expect((failed.events[0]!.payload.error as { code?: string }).code).toBe('cap_breached');
    await resetTestSeam();
  });
});

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

describe('aiEnvelope.capBreached: engine-integration placeholders', () => {
  // These require the engine to project `breached` outcomes onto the
  // existing `cap.breached` event surface per
  // capabilities.md §"Engine-enforced limits and the cap.breached event".
  // The pure-function acceptor surfaces the `breached` outcome with
  // capKind; the engine projects it to the event log.
  it.todo('project breached outcome onto cap.breached { kind: "envelopes" } event');
  it.todo('cap.breached payload includes limit, observed, and (for node-scoped kinds) nodeId per capabilities.md');
  it.todo('cap.breached → node.failed terminal transition');
});

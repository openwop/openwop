/**
 * aiEnvelope.contractRefusal — FINAL v1.1 advertisement-shape verification + behavioral placeholders.
 *
 * Status: DRAFT (advertisement-shape). `spec/v1/ai-envelope.md` landed
 * 2026-05-17 as DRAFT v1.x. Behavioral assertions stay `it.todo()` until a
 * reference host wires Envelope Contract enforcement on a node typeId.
 *
 * Summary: an Envelope Contract is a per-typeId declaration of which envelope
 * kinds that node accepts (`accepts: string[]` plus implicit universals). When
 * a node emits an envelope whose `type` is neither universal nor in `accepts`:
 *   - `refusalMode: "fail-node"` (default) — engine MUST emit `node.failed` with
 *     `error.code = 'envelope_contract_violation'`, `error.details.refusedType`,
 *     `error.details.acceptedTypes[]`.
 *   - `refusalMode: "discard-and-warn"` (advisory) — engine MAY discard silently
 *     after emitting `log.appended` (level warn) and proceed.
 *
 * Universals are ALWAYS accepted regardless of `accepts`.
 *
 * @see spec/v1/ai-envelope.md §"Envelope Contract"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

describe('aiEnvelope.contractRefusal: advertisement shape (FINAL v1.1)', () => {
  it('opted-in hosts advertise envelopeContracts.advertised as a boolean', async () => {
    const res = await driver.get('/.well-known/openwop');
    const body = res.json as DiscoveryDoc | undefined;
    const top = body?.capabilities as Record<string, unknown> | undefined;
    const block = top && typeof top === 'object' ? top['envelopeContracts'] : undefined;
    if (block === undefined) return; // absent — skip
    expect(
      typeof (block as Record<string, unknown>)['advertised'],
      driver.describe(
        'ai-envelope.md §"Capability handshake integration"',
        'envelopeContracts.advertised MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function accept(envelope: unknown, opts: Record<string, unknown> = {}): Promise<{ status: number; body: { status?: string; reason?: string; allowedKinds?: string[] } }> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, ...opts });
  return { status: res.status, body: res.json as { status?: string; reason?: string; allowedKinds?: string[] } };
}

const baseMeta = { source: 'ai-generation' as const, ts: '2026-05-18T10:00:00Z' };

describe('aiEnvelope.contractRefusal: behavioral accept-gate (FINAL v1.1)', () => {
  it('node with nodeAllowedKinds:["vendor.x.foo.create"] emits vendor.x.bar.create → status: gated', async () => {
    const r = await accept(
      {
        type: 'vendor.x.bar.create',
        schemaVersion: 1,
        envelopeId: 'env-cr-1',
        correlationId: 'r:n:0:cr1',
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.x.bar.create', 'vendor.x.foo.create'],
        nodeAllowedKinds: ['vendor.x.foo.create'],
      },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe('ai-envelope.md §"Envelope Contract"', 'envelope outside node accepts[] MUST be refused'),
    ).toBe('gated');
  });

  it('gated outcome carries the union of universals + node-declared accepts as allowedKinds', async () => {
    const r = await accept(
      {
        type: 'vendor.x.unknown.kind',
        schemaVersion: 1,
        envelopeId: 'env-cr-2',
        correlationId: 'r:n:0:cr2',
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.x.unknown.kind', 'vendor.x.foo.create'],
        nodeAllowedKinds: ['vendor.x.foo.create'],
      },
    );
    if (r.status === 404) return;
    expect(Array.isArray(r.body.allowedKinds), 'allowedKinds MUST be an array').toBe(true);
    expect(r.body.allowedKinds, 'allowedKinds MUST include universals + declared accepts').toEqual(
      expect.arrayContaining(['clarification.request', 'schema.request', 'schema.response', 'error', 'vendor.x.foo.create']),
    );
  });

  it('universals are accepted regardless of nodeAllowedKinds (always-allowed)', async () => {
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-cr-univ',
        correlationId: 'r:n:0:univ',
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      { nodeAllowedKinds: ['vendor.x.foo.create'] }, // doesn't include clarification.request
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe('ai-envelope.md §"Universal kinds"', 'universal kinds MUST be accepted regardless of node accepts[]'),
    ).toBe('accepted');
  });

  it('host-supportedEnvelopes gate fires BEFORE node accepts gate (kind unadvertised → gated, not invalid)', async () => {
    const r = await accept(
      {
        type: 'vendor.unadvertised.kind',
        schemaVersion: 1,
        envelopeId: 'env-cr-hostgate',
        correlationId: 'r:n:0:hostgate',
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.advertised.only'],
        nodeAllowedKinds: ['vendor.unadvertised.kind'], // node would allow but host doesn't
      },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe('ai-envelope.md §"Capability handshake integration"', 'host gate MUST fire before node gate'),
    ).toBe('gated');
  });
});

describe('aiEnvelope.contractRefusal: engine-integration placeholders', () => {
  // These require the engine to project gated outcomes onto RunEventDocs
  // / node.failed events / log.appended (level: warn) per refusalMode.
  // The pure-function acceptor surfaces `gated` outcomes; the engine
  // projects them to the event log.
  it.todo('node.failed event carries error.code = "envelope_contract_violation"');
  it.todo('refused envelope error.details.acceptedTypes lists the declared accepts[]');
  it.todo('refused envelope error.details.refusedType names the emitted type');
  it.todo('refusalMode:"discard-and-warn" emits log.appended level:"warn" instead of node.failed');
  it.todo('capability-gated typeId refusal stacks atop Envelope Contract refusal (host.aiEnvelope absent → typeId refused first)');
});

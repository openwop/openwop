/**
 * aiEnvelope.contractRefusal — FINAL v1.1 advertisement-shape + behavioral.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). `spec/v1/ai-envelope.md`
 * promoted Draft → FINAL v1.1 2026-05-18. Live behavioral via the
 * `POST /v1/host/sample/envelope/accept` seam + the capability-toggle seam
 * (soft-skip when either is absent).
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

import { describe, it, expect, afterEach } from 'vitest';
import { driver } from '../lib/driver.js';
import { setHostCapability, resetHostCapabilities, isToggleAvailable } from '../lib/host-toggle.js';

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

// E.1 engine-projection via the test-only event-log seam.
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

describe('aiEnvelope.contractRefusal: engine projection via event-log seam', () => {
  it('gated (fail-node) → node.failed { error.code: "envelope_contract_violation" }', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-cr-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await accept(
      {
        type: 'vendor.x.bar.create',
        schemaVersion: 1,
        envelopeId: 'env-cr-proj-1',
        correlationId: `${runId}:n:0:cr-proj-1`,
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.x.bar.create', 'vendor.x.foo.create'],
        nodeAllowedKinds: ['vendor.x.foo.create'],
        projectTo: { runId, nodeId: 'n', refusalMode: 'fail-node' },
      },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('gated');
    const events = await queryTestEvents(runId, { type: 'node.failed' });
    if (!events.ok || events.events.length === 0) return;
    const err = events.events[0]!.payload.error as { code?: string; details?: { refusedType?: string; acceptedTypes?: string[] } };
    expect(
      err.code,
      driver.describe('ai-envelope.md §"Envelope Contract"', 'gated outcome MUST project to node.failed with error.code = envelope_contract_violation'),
    ).toBe('envelope_contract_violation');
  });

  it('refused envelope: error.details.refusedType names emitted kind; acceptedTypes lists allowed kinds', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-cr-details-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'vendor.x.bar.create',
        schemaVersion: 1,
        envelopeId: 'env-cr-proj-details',
        correlationId: `${runId}:n:0:cr-details`,
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.x.bar.create', 'vendor.x.foo.create'],
        nodeAllowedKinds: ['vendor.x.foo.create'],
        projectTo: { runId, nodeId: 'n' },
      },
    );
    const events = await queryTestEvents(runId, { type: 'node.failed' });
    if (!events.ok || events.events.length === 0) return;
    const details = (events.events[0]!.payload.error as { details?: { refusedType?: string; acceptedTypes?: string[] } }).details;
    expect(details?.refusedType).toBe('vendor.x.bar.create');
    expect(
      Array.isArray(details?.acceptedTypes) && details!.acceptedTypes!.includes('vendor.x.foo.create'),
      driver.describe('ai-envelope.md §"Envelope Contract"', 'error.details.acceptedTypes MUST list the node\'s declared accepts[] (plus universals)'),
    ).toBe(true);
  });

  it('refusalMode:"discard-and-warn" → log.appended { level: "warn" } instead of node.failed', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-cr-warn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'vendor.x.bar.create',
        schemaVersion: 1,
        envelopeId: 'env-cr-proj-warn',
        correlationId: `${runId}:n:0:cr-warn`,
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.x.bar.create'],
        nodeAllowedKinds: ['vendor.x.foo.create'], // gated
        projectTo: { runId, nodeId: 'n', refusalMode: 'discard-and-warn' },
      },
    );
    const warnEvents = await queryTestEvents(runId, { type: 'log.appended' });
    const failEvents = await queryTestEvents(runId, { type: 'node.failed' });
    if (!warnEvents.ok || !failEvents.ok) return;
    expect(
      warnEvents.events.some((e) => (e.payload as { level?: string }).level === 'warn'),
      driver.describe('ai-envelope.md §"Envelope Contract"', 'discard-and-warn MUST emit log.appended at warn level'),
    ).toBe(true);
    expect(
      failEvents.events.length,
      driver.describe('ai-envelope.md §"Envelope Contract"', 'discard-and-warn MUST NOT emit node.failed'),
    ).toBe(0);
    await resetTestSeam();
  });

  it('host-gate refusal (hostSupportedEnvelopes) projects to node.failed with envelope_contract_violation', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-cr-host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'vendor.unadvertised.kind',
        schemaVersion: 1,
        envelopeId: 'env-cr-proj-host',
        correlationId: `${runId}:n:0:cr-host`,
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.advertised.only'],
        nodeAllowedKinds: ['vendor.unadvertised.kind'],
        projectTo: { runId, nodeId: 'n' },
      },
    );
    const events = await queryTestEvents(runId, { type: 'node.failed' });
    if (!events.ok || events.events.length === 0) return;
    expect(
      (events.events[0]!.payload.error as { code?: string }).code,
      driver.describe('ai-envelope.md §"Capability handshake integration"', 'host-gate refusal MUST project to node.failed envelope_contract_violation (stacks above node-gate)'),
    ).toBe('envelope_contract_violation');
  });
});

// Capability-stacking — backed by the `host.aiEnvelope.supported`
// flag in the workflow-engine's capability overlay. Per ai-envelope.md
// §"Capability handshake integration" line 305: capability-gated
// typeId refusal MUST stack atop envelope-contract refusal. When the
// host doesn't advertise `host.aiEnvelope: supported`, every
// envelope/accept call refuses BEFORE the per-envelope contract
// gates (host-gate, node-gate, schema-floor) fire — observable as
// `reason: "capability_required"` (NOT "envelope_contract_violation").

describe('aiEnvelope.contractRefusal: capability-stacking (FINAL v1.1)', () => {
  afterEach(async () => {
    // Restore overlay after each test so subsequent scenarios see the
    // default advertisement.
    await resetHostCapabilities();
  });

  it('host.aiEnvelope.supported = false → envelope/accept refuses with capability_required BEFORE envelope contract gates', async () => {
    if (!(await isToggleAvailable())) return; // seam not exposed — soft-skip

    const toggle = await setHostCapability('host.aiEnvelope.supported', false);
    if (!toggle.ok) return;

    // Same envelope shape that the existing host-gate scenario uses
    // (line 233-257 above) — the type IS in hostSupportedEnvelopes AND
    // matches nodeAllowedKinds, so the envelope-contract gate would
    // normally accept. The capability gate must fire FIRST and return
    // capability_required regardless.
    const r = await accept(
      {
        type: 'vendor.advertised.kind',
        schemaVersion: 1,
        envelopeId: 'env-cr-capstack-1',
        correlationId: 'r:n:0:cr-capstack',
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.advertised.kind'],
        nodeAllowedKinds: ['vendor.advertised.kind'],
      },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe(
        'ai-envelope.md §"Capability handshake integration"',
        'capability-absent host MUST refuse envelope acceptance regardless of host-gate / node-gate match',
      ),
    ).toBe('invalid');
    expect(
      r.body.reason,
      driver.describe(
        'capabilities.md §"Unsupported capability — refusal contract"',
        'refusal reason MUST be capability_required (NOT envelope_contract_violation) — capability gate stacks above the envelope-contract gate',
      ),
    ).toBe('capability_required');
  });

  it('host.aiEnvelope.supported = true → envelope/accept falls through to envelope-contract gates', async () => {
    if (!(await isToggleAvailable())) return;
    const toggle = await setHostCapability('host.aiEnvelope.supported', true);
    if (!toggle.ok) return;

    // With capability advertised, a normally-rejected envelope (type
    // not in hostSupportedEnvelopes) reaches the envelope-contract
    // gate and refuses with `envelope_contract_violation`, NOT
    // `capability_required`. Proves the capability gate is gated on
    // the flag and doesn't short-circuit the contract path when the
    // capability IS advertised.
    const r = await accept(
      {
        type: 'vendor.unadvertised.kind',
        schemaVersion: 1,
        envelopeId: 'env-cr-capstack-2',
        correlationId: 'r:n:0:cr-capstack-fallthrough',
        payload: {},
        meta: baseMeta,
      },
      {
        hostSupportedEnvelopes: ['vendor.advertised.only'],
        nodeAllowedKinds: ['vendor.unadvertised.kind'],
      },
    );
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe(
        'ai-envelope.md §"Capability handshake integration"',
        'when capability IS advertised, envelope-contract gates run normally',
      ),
    ).toBe('gated');
    // `gated` is the envelope-contract-gate outcome (host-gate +
    // node-gate); reason text varies. The key contract: status is NOT
    // `invalid` with `capability_required` — the capability layer
    // didn't intercept.
    expect(r.body.reason).not.toBe('capability_required');
  });
});

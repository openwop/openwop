/**
 * model-capability-insufficient — RFC 0031 §B step 4 + §D runtime behavior.
 *
 * Capability-gated on `capabilities.modelCapabilities.supported: true`.
 * Drives the host's `POST /v1/host/sample/test/evaluate-model-capability-gate`
 * seam through the refusal branches of the §B 4-step dispatch flow.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B step 4 + §D
 * @see schemas/run-event-payloads.schema.json §modelCapabilityInsufficient
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface GateResponse {
  outcome?: {
    route?: 'dispatch' | 'substitute' | 'refuse';
    missingCapabilities?: string[];
    fallbackAttempted?: boolean;
  };
  event?: { type?: string; payload?: Record<string, unknown> } | null;
}

async function evaluateGate(input: Record<string, unknown>): Promise<{ status: number; body: GateResponse }> {
  const res = await driver.post('/v1/host/sample/test/evaluate-model-capability-gate', input);
  return { status: res.status, body: res.json as GateResponse };
}

describe.skipIf(HTTP_SKIP)('model-capability-insufficient: dispatch refusal (RFC 0031 §B step 4 + §D)', () => {
  it('unmet + NO fallbackModel declared → refuse with fallbackAttempted: false', async () => {
    const r = await evaluateGate({
      module: { requiredModelCapabilities: ['structured-output', 'reasoning'] },
      // no fallbackModel
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      supportedProviders: ['unknown-vendor'],
      nodeId: 'editor-node',
    });
    if (r.status === 404) return;
    expect(r.body.outcome?.route).toBe('refuse');
    expect(r.body.outcome?.fallbackAttempted).toBe(false);
    expect(r.body.event?.type).toBe('model.capability.insufficient');
    const payload = (r.body.event?.payload ?? {}) as Record<string, unknown>;
    expect(payload.nodeId).toBe('editor-node');
    expect(payload.provider).toBe('unknown-vendor');
    expect(payload.fallbackAttempted).toBe(false);
    expect(Array.isArray(payload.missingCapabilities)).toBe(true);
  });

  it('unmet + fallback declared but provider NOT in supportedProviders → refuse with fallbackAttempted: true', async () => {
    const r = await evaluateGate({
      module: {
        requiredModelCapabilities: ['structured-output'],
        fallbackModel: { provider: 'unauthenticated-vendor', model: 'foo' },
      },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      // Fallback's provider is NOT in supportedProviders — host cannot
      // authenticate per RFC 0031 §B step 3 final clause.
      supportedProviders: ['anthropic', 'unknown-vendor'],
    });
    if (r.status === 404) return;
    expect(r.body.outcome?.route).toBe('refuse');
    expect(
      r.body.outcome?.fallbackAttempted,
      'RFC 0031 §B step 4: fallbackAttempted: true when fallback.provider is not in supportedProviders',
    ).toBe(true);
    expect(r.body.event?.type).toBe('model.capability.insufficient');
  });

  it('unmet + substitutionSupported: false (host posture) → refuse with fallbackAttempted: false', async () => {
    const r = await evaluateGate({
      module: {
        requiredModelCapabilities: ['structured-output'],
        fallbackModel: { provider: 'anthropic', model: 'claude-opus-4-7' },
      },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: false,
      supportedProviders: ['anthropic', 'unknown-vendor'],
    });
    if (r.status === 404) return;
    expect(r.body.outcome?.route).toBe('refuse');
    expect(
      r.body.outcome?.fallbackAttempted,
      'substitutionSupported: false means the host MUST NOT attempt fallback per RFC 0031 §E',
    ).toBe(false);
  });

  it('recursive fallback NOT permitted — fallback that itself fails capability check → refuse with fallbackAttempted: true', async () => {
    // Construct a scenario where fallback's provider is in supportedProviders
    // BUT the fallback provider itself doesn't advertise the required capability.
    // The probe map's 'unknown-vendor-2' has empty capabilities; the gate
    // refuses with fallbackAttempted: true (RFC 0031 §"Unresolved questions" #3).
    const r = await evaluateGate({
      module: {
        requiredModelCapabilities: ['structured-output'],
        fallbackModel: { provider: 'unknown-vendor-2', model: 'fallback-model' },
      },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      supportedProviders: ['unknown-vendor', 'unknown-vendor-2'],
    });
    if (r.status === 404) return;
    expect(r.body.outcome?.route).toBe('refuse');
    expect(
      r.body.outcome?.fallbackAttempted,
      'RFC 0031 §"Unresolved questions" #3: no recursive fallback — fallbackAttempted: true when the declared fallback itself fails',
    ).toBe(true);
  });
});

// The end-to-end pipeline — NodeModule registered with `requiredModelCapabilities`
// → executor refuses with `capability_not_provided` + emits `model.capability.insufficient`
// into the run event log — remains an `it.todo()` placeholder until the
// conformance harness has a NodeModule-registration test seam that can
// register a synthetic node with declared capabilities.

describe('model-capability-insufficient: end-to-end refusal through executor', () => {
  it.todo(
    'workflow with a node declaring requiredModelCapabilities the active provider does not satisfy fails with RunSnapshot.error.code = "capability_not_provided" AND emits model.capability.insufficient into the run event log BEFORE node.failed',
  );
  it.todo(
    'NO envelope emission occurs after the refusal (no node.completed, provider.usage, or envelope-reliability events)',
  );
});

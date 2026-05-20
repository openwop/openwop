/**
 * model-capability-substituted — RFC 0031 §B step 3 + §D + §F runtime behavior.
 *
 * Capability-gated on `capabilities.modelCapabilities.supported: true`.
 *
 * Drives the host's `POST /v1/host/sample/test/evaluate-model-capability-gate`
 * seam with synthetic inputs that hit each branch of the §B 4-step dispatch
 * flow. The seam runs the pure `evaluateModelCapabilityGate()` evaluator
 * and returns both the routing outcome AND the event payload the host
 * would emit. Conformance asserts the decision-matrix + the event payload
 * shape per RFC 0031 §D `modelCapabilitySubstituted`.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §D + §F
 * @see spec/v1/host-capabilities.md §"Model-capability declarations"
 * @see schemas/run-event-payloads.schema.json §modelCapabilitySubstituted
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    modelCapabilities?: {
      supported?: unknown;
      substitutionSupported?: unknown;
      advertised?: unknown;
    };
  };
}

interface GateOutcome {
  route?: 'dispatch' | 'substitute' | 'refuse';
  originalProvider?: string;
  originalModel?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  missingCapabilities?: string[];
  fallbackAttempted?: boolean;
}

interface GateResponse {
  outcome?: GateOutcome;
  event?: { type?: string; payload?: Record<string, unknown> } | null;
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

async function evaluateGate(input: Record<string, unknown>): Promise<{ status: number; body: GateResponse }> {
  const res = await driver.post('/v1/host/sample/test/evaluate-model-capability-gate', input);
  return { status: res.status, body: res.json as GateResponse };
}

describe.skipIf(HTTP_SKIP)('model-capability-substituted: advertisement shape (RFC 0031 §E)', () => {
  it('capabilities.modelCapabilities (when present) conforms to RFC 0031 §E', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const mc = d.capabilities?.modelCapabilities;
    if (mc === undefined) return;
    expect(typeof mc.supported, 'modelCapabilities.supported MUST be boolean').toBe('boolean');
    if (mc.advertised !== undefined) {
      expect(Array.isArray(mc.advertised), 'modelCapabilities.advertised MUST be an array').toBe(true);
      const SPEC_RESERVED = ['structured-output', 'discriminator-enum', 'long-context', 'reasoning', 'function-calling'];
      for (const id of mc.advertised as unknown[]) {
        expect(typeof id, 'each advertised identifier MUST be a string').toBe('string');
        const idStr = String(id);
        const isReserved = SPEC_RESERVED.includes(idStr);
        const isHostExt = /^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(idStr);
        expect(
          isReserved || isHostExt,
          `advertised identifier "${idStr}" MUST be spec-reserved or match x-host-<host>-<key> pattern (RFC 0031 §C)`,
        ).toBe(true);
      }
    }
    if (mc.substitutionSupported !== undefined) {
      expect(typeof mc.substitutionSupported, 'substitutionSupported MUST be boolean').toBe('boolean');
    }
  });
});

describe.skipIf(HTTP_SKIP)('model-capability-substituted: dispatch behavior (RFC 0031 §B step 3 + §D)', () => {
  it('all required capabilities met → outcome: dispatch (no event emitted)', async () => {
    const r = await evaluateGate({
      module: { requiredModelCapabilities: ['structured-output', 'function-calling'] },
      activeProvider: 'anthropic',
      activeModel: 'claude-3-5-sonnet',
      substitutionSupported: true,
      supportedProviders: ['anthropic', 'openai'],
    });
    if (r.status === 404) return; // host doesn't expose the seam
    expect(r.body.outcome?.route, 'RFC 0031 §B step 2: all met → dispatch').toBe('dispatch');
    expect(r.body.event, 'no event emitted when gate is a no-op').toBeNull();
  });

  it('unmet + fallback declared + authenticatable → outcome: substitute + event with originalProvider/originalModel/fallbackProvider/fallbackModel/missingCapabilities', async () => {
    const r = await evaluateGate({
      module: {
        requiredModelCapabilities: ['structured-output', 'long-context'],
        fallbackModel: { provider: 'anthropic', model: 'claude-opus-4-7' },
      },
      // Simulate an active provider that doesn't advertise long-context.
      // The seam's probe map returns the spec-known capability set for
      // known providers; we use an unknown provider id here so the gate
      // sees an empty advertised set and refuses to substitute (no — wait,
      // we declare a fallback that IS in supportedProviders, so the gate
      // substitutes). Use 'unknown-vendor' as the original provider and
      // 'anthropic' as the fallback (which IS in the host's known
      // providers and advertises structured-output + long-context).
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      supportedProviders: ['anthropic', 'openai', 'unknown-vendor'],
      nodeId: 'writer-node',
    });
    if (r.status === 404) return;
    expect(r.body.outcome?.route, 'RFC 0031 §B step 3: unmet + fallback + auth → substitute').toBe('substitute');
    expect(r.body.event?.type).toBe('model.capability.substituted');
    const payload = (r.body.event?.payload ?? {}) as Record<string, unknown>;
    expect(payload.nodeId, 'payload.nodeId MUST mirror the request').toBe('writer-node');
    expect(payload.originalProvider).toBe('unknown-vendor');
    expect(payload.originalModel).toBe('unknown-model');
    expect(payload.fallbackProvider).toBe('anthropic');
    expect(payload.fallbackModel).toBe('claude-opus-4-7');
    expect(
      Array.isArray(payload.missingCapabilities) &&
        (payload.missingCapabilities as string[]).includes('structured-output'),
      'missingCapabilities MUST include the subset of required caps the active model did not satisfy',
    ).toBe(true);
  });

  it('unmet + substitutionSupported: false → outcome: refuse with fallbackAttempted: false (host posture override)', async () => {
    const r = await evaluateGate({
      module: {
        requiredModelCapabilities: ['structured-output'],
        // Fallback declared but the gate refuses BEFORE attempting because the
        // host's posture is "no substitution" per RFC 0031 §E.
        fallbackModel: { provider: 'anthropic', model: 'claude-opus-4-7' },
      },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: false,
      supportedProviders: ['anthropic', 'unknown-vendor'],
    });
    if (r.status === 404) return;
    expect(r.body.outcome?.route, "substitutionSupported: false MUST refuse even with fallback declared").toBe('refuse');
    expect(r.body.event?.type).toBe('model.capability.insufficient');
    expect((r.body.event?.payload as { fallbackAttempted?: boolean }).fallbackAttempted).toBe(false);
  });
});

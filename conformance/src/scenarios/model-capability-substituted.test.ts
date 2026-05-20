/**
 * model-capability-substituted — RFC 0031 §B step 3 + §D + §F runtime behavior.
 *
 * Capability-gated on `capabilities.modelCapabilities.supported: true` AND
 * `capabilities.modelCapabilities.substitutionSupported: true` AND the host's
 * test seam `POST /v1/host/sample/test/synthesize-model-capability-event`.
 *
 * Asserts:
 *   1. When a NodeModule declares `requiredModelCapabilities` that the active
 *      model does NOT advertise AND `fallbackModel` is reachable, the host
 *      emits exactly one `model.capability.substituted` event with the missing
 *      capability set populated and the fallback coordinates (or `[REDACTED]`
 *      when the host's workspace policy redacts the multi-vendor posture per
 *      SECURITY invariant `model-capability-substituted-no-credential-disclosure`).
 *   2. Dispatch proceeds with the fallback model (no `model.capability.insufficient`
 *      fires; the node executes normally).
 *
 * Behavioral assertions are `it.todo()` until a reference workflow-engine
 * advertises the capability + ships the dispatch gate.
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

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
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
      for (const id of mc.advertised as unknown[]) {
        expect(typeof id, 'each advertised identifier MUST be a string').toBe('string');
        const idStr = String(id);
        const SPEC_RESERVED = ['structured-output', 'discriminator-enum', 'long-context', 'reasoning', 'function-calling'];
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

// Behavioral assertions through the host's `synthesize-model-capability-event`
// test seam. Promote from `it.todo()` to live assertions when the reference
// workflow-engine implements the dispatch gate + event emission.

describe('model-capability-substituted: dispatch behavior (RFC 0031 §B step 3 + §D)', () => {
  it.todo(
    'when active model lacks a required capability AND fallbackModel is declared AND fallback authentication succeeds, the host emits exactly one `model.capability.substituted` event',
  );
  it.todo(
    '`missingCapabilities[]` MUST list the subset of `NodeModule.requiredModelCapabilities` the active model did not satisfy',
  );
  it.todo(
    'dispatch proceeds with the fallback model — node executes normally, no `model.capability.insufficient` fires',
  );
  it.todo(
    'event emission ordering MUST be: capability check → substitution → emit telemetry → dispatch (RFC 0031 §B)',
  );
  it.todo(
    "when the host's workspace policy redacts multi-vendor posture, `fallbackProvider` + `fallbackModel` both appear as `\"[REDACTED]\"` (all-or-nothing per SECURITY invariant `model-capability-substituted-no-credential-disclosure`)",
  );
});

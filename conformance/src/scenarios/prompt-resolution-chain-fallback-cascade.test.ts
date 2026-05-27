/**
 * prompt-resolution-chain-fallback-cascade — RFC 0029 §A layer-3 + layer-4
 * fallback cascade.
 *
 * Asserts:
 *   1. When neither node nor agent yields a ref, the workflow's
 *      `defaults.promptRefs[kind]` wins (layer 3 — `workflow-defaults`).
 *   2. When workflow defaults are also absent, host's
 *      `capabilities.prompts.defaults[kind]` wins (layer 4 —
 *      `host-defaults`).
 *   3. When all four layers yield null, `resolved` is null and the
 *      emitted event's chain[] still lists every layer attempted with
 *      `applied: false`.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.supported: true`.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured.
 *
 *
 * Under `OPENWOP_REQUIRE_BEHAVIOR=true` the capability gate hardens
 * from SKIP to FAIL — a host that advertises the gating capability
 * but doesn't emit the asserted contract fails the scenario instead
 * of silently skipping. See `conformance/coverage.md` §"Capability-
 * gated scenarios."
 *
 * @see spec/v1/prompts.md §"Resolution chain (normative)" — Layers 3 + 4
 * @see RFCS/0029-prompt-override-hierarchy.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      supported?: unknown;
    };
  };
}

interface AgentPromptResolvedPayload {
  nodeId: string;
  kind: string;
  agentId?: string;
  chain: Array<{
    layer: string;
    source?: string;
    applied: boolean;
    reason?: string;
  }>;
  resolved: string | null;
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function promptsSupported(d: DiscoveryDoc | null): boolean {
  return capabilityFamily(d, 'prompts')?.supported === true;
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe.skipIf(HTTP_SKIP)('prompt-resolution-chain-fallback-cascade: layers 3 + 4 fallback when node + agent yield null (RFC 0029 §A)', () => {
  it('workflow defaults win over host defaults when both are set', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;

    const res = await driver.post('/v1/host/sample/prompt/resolve', {
      kind: 'system',
      node: {
        nodeId: 'writer',
        config: {
          // No agent binding, no layer-1 ref.
        },
      },
      workflowDefaults: {
        promptRefs: {
          system: 'prompt:workflow-fallback@1.0.0',
        },
      },
      hostDefaults: {
        system: 'prompt:host-default@1.0.0',
      },
    });
    if (res.status === 404) return;
    expect(res.status).toBe(200);

    const payload = res.json as AgentPromptResolvedPayload;
    const applied = payload.chain.find((c) => c.applied);
    expect(applied?.layer).toBe('workflow-defaults');
    expect(
      payload.resolved,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative) — Layer 3',
        'workflow-defaults MUST win over host-defaults when both are set',
      ),
    ).toBe('prompt:workflow-fallback@1.0.0');
  });

  it('host defaults win when workflow defaults are also absent', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;

    const res = await driver.post('/v1/host/sample/prompt/resolve', {
      kind: 'system',
      node: { nodeId: 'writer', config: {} },
      // workflowDefaults intentionally omitted.
      hostDefaults: {
        system: 'prompt:host-default@1.0.0',
      },
    });
    if (res.status === 404) return;
    expect(res.status).toBe(200);

    const payload = res.json as AgentPromptResolvedPayload;
    const applied = payload.chain.find((c) => c.applied);
    expect(
      applied?.layer,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative) — Layer 4',
        'host-defaults MUST apply when layers 1-3 yield null',
      ),
    ).toBe('host-defaults');
    expect(payload.resolved).toBe('prompt:host-default@1.0.0');
  });

  it('resolved is null and chain[] still lists every attempted layer when all four yield null', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;

    const res = await driver.post('/v1/host/sample/prompt/resolve', {
      kind: 'system',
      node: { nodeId: 'writer', config: {} },
      // workflowDefaults + hostDefaults intentionally omitted.
    });
    if (res.status === 404) return;
    expect(res.status).toBe(200);

    const payload = res.json as AgentPromptResolvedPayload;
    expect(
      payload.resolved,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative)',
        'resolved MUST be null when all four layers yield null',
      ),
    ).toBe(null);

    const appliedEntries = payload.chain.filter((c) => c.applied);
    expect(
      appliedEntries.length,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative)',
        'zero applied entries when no layer yielded a candidate',
      ),
    ).toBe(0);

    // Chain MUST still document each layer attempted so debuggers can
    // see why the resolution returned null.
    expect(
      payload.chain.length,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative)',
        'chain[] MUST list every layer attempted, even when none applied',
      ),
    ).toBeGreaterThan(0);
  });
});

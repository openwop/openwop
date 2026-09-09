/**
 * prompt-resolution-chain-node-wins — RFC 0029 §A layer-1 precedence.
 *
 * Asserts: when a workflow node carries `config.systemPromptRef` AND the
 * node is bound to an agent whose `AgentManifest.promptOverrides.system`
 * AND `AgentManifest.systemPromptRef` are both set, the layer-1 node-
 * config ref wins. The emitted `agent.promptResolved.chain[0]` MUST be
 * `layer: "node"` with `applied: true`, and `resolved` MUST equal the
 * node's ref.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.supported: true` (resolution is gated on Phase A).
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured (the
 * server-free subset of the gate can't exercise this — it requires a
 * live reference-host resolution seam).
 *
 *
 * Under `OPENWOP_REQUIRE_BEHAVIOR=true` the capability gate hardens
 * from SKIP to FAIL — a host that advertises the gating capability
 * but doesn't emit the asserted contract fails the scenario instead
 * of silently skipping. See `conformance/coverage.md` §"Capability-
 * gated scenarios."
 *
 * @see spec/v1/prompts.md §"Resolution chain (normative)" — Layer 1
 * @see RFCS/0029-prompt-override-hierarchy.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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

describe.skipIf(HTTP_SKIP)('prompt-resolution-chain-node-wins: layer-1 node-config supersedes lower layers (RFC 0029 §A)', () => {
  it('node-level systemPromptRef wins over agent intrinsic + workflow defaults + host defaults', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-supported', promptsSupported(d))) return;

    // Driver test-seam endpoint: instructs the reference host to resolve
    // a PromptRef for a (nodeId, kind) pair against a fixture inputs
    // bundle that exercises every layer of the chain. Returns the
    // emitted `agent.promptResolved` event payload synchronously so the
    // scenario can assert without subscribing to the run event log.
    const res = await driver.post('/v1/host/sample/prompt/resolve', {
      kind: 'system',
      node: {
        nodeId: 'writer',
        config: {
          // Layer 1 explicit ref — should win.
          systemPromptRef: 'prompt:experimental-writer@2.0.0',
          agentId: 'vendor.acme.writer-agent',
        },
      },
      agentManifest: {
        agentId: 'vendor.acme.writer-agent',
        // Layer 2 candidates (intrinsic + overrides) — should be
        // recorded in the chain with applied: false.
        systemPromptRef: 'prompts/intrinsic.md',
        promptOverrides: {
          system: 'prompt:editorial-house-style@1.0.0',
        },
      },
      workflowDefaults: {
        promptRefs: {
          // Layer 3 candidate — should be applied: false.
          system: 'prompt:workflow-default@1.0.0',
        },
      },
      hostDefaults: {
        // Layer 4 candidate — should be applied: false.
        system: 'prompt:host-default@1.0.0',
      },
    });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (host doesn\'t expose the seam) (seam, prior step, or fixture unavailable)'); // host doesn't expose the seam
    expect(res.status, req('openwop.it.prompt-resolution-chain-node-wins.node-level-systempromptref-wins-over-agent-intrinsic-workflow-defaults-host-defa', 'spec/v1/prompts.md §Resolution chain (normative)', 'resolve seam MUST return 200')).toBe(200);

    const payload = res.json as AgentPromptResolvedPayload;

    expect(
      payload.kind,
      req('openwop.it.prompt-resolution-chain-node-wins.node-level-systempromptref-wins-over-agent-intrinsic-workflow-defaults-host-defa', 
        'spec/v1/prompts.md §Resolution chain (normative)',
        'agent.promptResolved.kind MUST match the requested kind',
      ),
    ).toBe('system');

    expect(
      payload.resolved,
      req('openwop.it.prompt-resolution-chain-node-wins.node-level-systempromptref-wins-over-agent-intrinsic-workflow-defaults-host-defa', 
        'spec/v1/prompts.md §Resolution chain (normative) — Layer 1',
        'node-level systemPromptRef MUST win over agent intrinsic + overrides + workflow defaults + host defaults',
      ),
    ).toBe('prompt:experimental-writer@2.0.0');

    // chain[] MUST list the layers attempted in precedence order. The
    // node layer (first entry of the resolution chain) MUST carry
    // applied: true; every other layer applied: false.
    expect(Array.isArray(payload.chain), req('openwop.it.prompt-resolution-chain-node-wins.node-level-systempromptref-wins-over-agent-intrinsic-workflow-defaults-host-defa', 'spec/v1/prompts.md §Resolution chain (normative) — Layer 1', 'agent.promptResolved.chain MUST be an array')).toBe(true);
    expect(payload.chain.length).toBeGreaterThan(0);

    const appliedEntries = payload.chain.filter((c) => c.applied);
    expect(
      appliedEntries.length,
      req('openwop.it.prompt-resolution-chain-node-wins.node-level-systempromptref-wins-over-agent-intrinsic-workflow-defaults-host-defa', 
        'spec/v1/prompts.md §Resolution chain (normative)',
        'exactly one chain entry MUST carry applied: true',
      ),
    ).toBe(1);
    expect(appliedEntries[0]?.layer).toBe('node');
    expect(appliedEntries[0]?.source).toBe('prompt:experimental-writer@2.0.0');
  });
});

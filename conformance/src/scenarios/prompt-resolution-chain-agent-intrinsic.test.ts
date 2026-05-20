/**
 * prompt-resolution-chain-agent-intrinsic — RFC 0029 §A layer-2
 * agent-intrinsic precedence.
 *
 * Asserts: when a workflow node has no layer-1 systemPromptRef but is
 * bound to an agent whose `AgentManifest.systemPromptRef` (or
 * `systemPrompt`) is set, the agent's intrinsic prompt wins. The
 * emitted `agent.promptResolved.chain` MUST show
 * `layer: "agent-intrinsic"` with `applied: true`, and `resolved` MUST
 * be a synthetic PromptRef projected from the manifest's intrinsic
 * surface.
 *
 * Capability-gated: skips when the host doesn't advertise BOTH
 * `capabilities.prompts.supported: true` AND
 * `capabilities.prompts.agentBindings: true`.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured.
 *
 * @see spec/v1/prompts.md §"Resolution chain (normative)" — Layer 2
 * @see RFCS/0029-prompt-override-hierarchy.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      supported?: unknown;
      agentBindings?: unknown;
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

function promptsAgentBindings(d: DiscoveryDoc | null): boolean {
  const p = d?.capabilities?.prompts;
  if (!p) return false;
  return p.supported === true && p.agentBindings === true;
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe.skipIf(HTTP_SKIP)('prompt-resolution-chain-agent-intrinsic: layer-2 agent intrinsic wins when node has no override (RFC 0029 §A)', () => {
  it('agent intrinsic systemPromptRef wins over workflow defaults + host defaults when node has no layer-1 ref', async () => {
    const d = await readDiscovery();
    if (!promptsAgentBindings(d)) return;

    const res = await driver.post('/v1/host/sample/prompt/resolve', {
      kind: 'system',
      node: {
        nodeId: 'writer',
        config: {
          // Layer 1 absent — no systemPromptRef on node.
          agentId: 'vendor.acme.writer-agent',
        },
      },
      agentManifest: {
        agentId: 'vendor.acme.writer-agent',
        // Layer 2 intrinsic — should win.
        systemPromptRef: 'prompts/intrinsic.md',
        // Layer 2 overrides also set — for `system` kind, intrinsic
        // takes precedence over overrides per RFC 0029 §A.
        promptOverrides: {
          system: 'prompt:editorial-house-style@1.0.0',
        },
      },
      workflowDefaults: {
        promptRefs: {
          system: 'prompt:workflow-default@1.0.0',
        },
      },
      hostDefaults: {
        system: 'prompt:host-default@1.0.0',
      },
    });
    if (res.status === 404) return;
    expect(res.status).toBe(200);

    const payload = res.json as AgentPromptResolvedPayload;

    const appliedEntries = payload.chain.filter((c) => c.applied);
    expect(
      appliedEntries.length,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative)',
        'exactly one chain entry MUST carry applied: true',
      ),
    ).toBe(1);
    expect(
      appliedEntries[0]?.layer,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative) — Layer 2',
        'system-kind resolution MUST prefer agent intrinsic (systemPromptRef) over agent-overrides when both are set',
      ),
    ).toBe('agent-intrinsic');

    expect(
      payload.resolved,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative) — Layer 2',
        'resolved MUST mirror the winning chain entry source',
      ),
    ).toBe(appliedEntries[0]?.source ?? null);

    expect(
      payload.agentId,
      driver.describe(
        'spec/v1/prompts.md §Resolution chain (normative)',
        'agent.promptResolved.agentId MUST be set when config.agentId resolves to a known agent',
      ),
    ).toBe('vendor.acme.writer-agent');
  });
});

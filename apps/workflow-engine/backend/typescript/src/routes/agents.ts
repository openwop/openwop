/**
 * CLI-friendly agent-inventory endpoint.
 *
 * Namespace: sample-extension under `/v1/host/sample/*`; this is NOT part
 * of the normative OpenWOP wire contract. OpenWOP has no `/v1/agents`
 * surface — "agents" are not a first-class registry. In the multi-agent
 * execution model (RFC 0037 / 0039 / 0040), an agent is an *identity*
 * attached to the agent-attributed node types the host can run:
 *   - `core.orchestrator.supervisor` — the supervising agent that emits
 *     `runOrchestratorDecided` decisions (RFC 0022 §A / RFC 0006 §B).
 *   - `core.dispatch` — drives the per-decision sub-agent dispatch loop
 *     and emits `agent.*` causation events (RFC 0040).
 *   - `vendor.openwop-sample.chat-responder` — the managed-provider chat
 *     agent that emits `agent.reasoned` / `agent.reasoning.delta`.
 *
 * This route derives a small, read-only inventory of those agent roles
 * from the live node registry plus the host's advertised `agents`
 * reasoning posture, giving `openwop agents {list,info}` something stable
 * to render without inventing a new normative surface. Absent any of the
 * agent-attributed node types (e.g. a host that registered none), the
 * inventory is simply shorter.
 */

import type { Express } from 'express';
import { getNodeRegistry } from '../executor/nodeRegistry.js';
import { getEnvelopeReasoningConfig } from '../host/envelopeReasoningConfig.js';

/** Stable role descriptors for the agent-attributed node types. */
interface AgentRole {
  /** Stable agent id (also the node typeId it is attributed to). */
  readonly agentId: string;
  readonly role: 'supervisor' | 'dispatch' | 'responder';
  readonly label: string;
  readonly description: string;
  /** Node typeId that must be registered for this role to be present. */
  readonly nodeTypeId: string;
  /** RFC tags for provenance. */
  readonly rfcs: readonly string[];
}

const AGENT_ROLES: readonly AgentRole[] = [
  {
    agentId: 'core.orchestrator.supervisor',
    role: 'supervisor',
    label: 'Supervisor',
    description:
      'Plans work and emits per-decision orchestrator decisions consumed by the dispatch loop.',
    nodeTypeId: 'core.orchestrator.supervisor',
    rfcs: ['RFC 0006', 'RFC 0022', 'RFC 0037'],
  },
  {
    agentId: 'core.dispatch',
    role: 'dispatch',
    label: 'Dispatch loop',
    description:
      'Drives the supervisor decisions, dispatching sub-agents and emitting agent.* causation events.',
    nodeTypeId: 'core.dispatch',
    rfcs: ['RFC 0037', 'RFC 0040'],
  },
  {
    agentId: 'vendor.openwop-sample.chat-responder',
    role: 'responder',
    label: 'Chat responder',
    description:
      'Managed-provider chat agent; emits agent.reasoned and agent.reasoning.delta during a turn.',
    nodeTypeId: 'vendor.openwop-sample.chat-responder',
    rfcs: ['RFC 0024', 'RFC 0037'],
  },
];

export function registerAgentRoutes(app: Express): void {
  app.get('/v1/host/sample/agents', (_req, res) => {
    res.json(buildAgentInventory());
  });

  app.get('/v1/host/sample/agents/:agentId', (req, res) => {
    const agent = buildAgentInventory().agents.find((a) => a.agentId === req.params.agentId);
    if (!agent) {
      res.status(404).json({
        error: 'not_found',
        message: `agent '${req.params.agentId}' is not present on this host`,
      });
      return;
    }
    res.json(agent);
  });
}

export interface AgentInventoryEntry {
  agentId: string;
  role: AgentRole['role'];
  label: string;
  description: string;
  nodeTypeId: string;
  /** Whether the backing node type is registered (runnable) on this host. */
  available: boolean;
  rfcs: readonly string[];
  /** Host-advertised reasoning posture (shared with the discovery `agents` block). */
  reasoning: { verbosity: string; streaming: boolean };
}

export function buildAgentInventory(): {
  agents: AgentInventoryEntry[];
  reasoning: { verbosity: string; streaming: boolean };
} {
  const registry = getNodeRegistry();
  const registered = new Set(registry.listTypeIds());
  // Mirror the discovery `agents.reasoning` posture so the inventory and
  // the advertisement can't drift. `getEnvelopeReasoningConfig()` governs
  // the envelope-reasoning directive; verbosity/streaming defaults match
  // the discovery advertisement's static `reasoning` block.
  const reasoningCfg = getEnvelopeReasoningConfig();
  const reasoning = {
    verbosity: 'full',
    streaming: reasoningCfg.supported,
  };

  const agents = AGENT_ROLES
    // Only surface roles whose backing node type is actually present.
    .filter((r) => registered.has(r.nodeTypeId))
    .map((r) => ({
      agentId: r.agentId,
      role: r.role,
      label: r.label,
      description: r.description,
      nodeTypeId: r.nodeTypeId,
      available: true,
      rfcs: r.rfcs,
      reasoning,
    }));

  return { agents, reasoning };
}

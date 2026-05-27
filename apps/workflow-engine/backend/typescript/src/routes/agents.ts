/**
 * CLI-friendly agent-inventory endpoint (INTERIM, read-only).
 *
 * Namespace: sample-extension under `/v1/host/sample/*`; this is NOT part
 * of the normative OpenWOP wire contract.
 *
 * IMPORTANT — this is a placeholder, not the intended end state. Agents ARE
 * a first-class OpenWOP surface: RFC 0003 + `schemas/agent-manifest.schema.json`
 * define the `AgentManifest`, ~31 of which ship across `packs/core.openwop.agents.*`,
 * and `host.agentRuntime` is a FINAL capability in `spec/v1/host-capabilities.md`.
 * What this demo host lacks is the *runtime* that consumes them — nothing loads
 * pack `agents[]` into an AgentRegistry (the pack loaders read only `manifest.nodes`),
 * and `host.agentRuntime` is neither present in `capabilities.schema.json` nor
 * advertised/implemented here. So this route cannot yet list installed manifest
 * agents. See docs/OPENWOP-AGENT-RUNTIME-ANALYSIS.md + OPENWOP-AGENT-RUNTIME-HANDOFF.md.
 *
 * As an interim, it derives a read-only inventory from the agent-attributed
 * node roles the host can actually run today (RFC 0037 / 0039 / 0040, where an
 * agent is an *identity* stamped on events emitted by a node):
 *   - `core.orchestrator.supervisor` — the supervising agent that emits
 *     `runOrchestratorDecided` decisions (RFC 0022 §A / RFC 0006 §B).
 *   - `core.dispatch` — drives the per-decision sub-agent dispatch loop
 *     and emits `agent.*` causation events (RFC 0040).
 *   - `vendor.openwop-sample.chat-responder` — the managed-provider chat
 *     agent that emits `agent.reasoned` / `agent.reasoning.delta`.
 *
 * This gives `openwop agents {list,info}` something stable to render. It is to
 * be REPLACED by a registry-backed inventory once the agent runtime is built.
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

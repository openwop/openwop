/**
 * Manifest-agent inventory + dispatch (RFC 0070).
 *
 * Namespace: sample-extension under `/v1/host/sample/*`; not part of the
 * normative wire contract (the RFC 0070 §Unresolved-questions entry tracks
 * whether `/v1/agents` should be promoted to normative).
 *
 * This is the registry-backed surface that replaces the prior 3-constant
 * placeholder: it lists the agent manifests this host actually loaded from
 * pack `agents[]` (RFC 0003) into the AgentRegistry, and dispatches one via
 * the RFC 0070 floor (`runAgentDispatch`). When the host advertises
 * `capabilities.agents.manifestRuntime`, these reflect real installed agents.
 */

import type { Express } from 'express';
import { getAgentRegistry, type ResolvedAgentManifest } from '../executor/agentRegistry.js';
import { runAgentDispatch, AgentNotFoundError, type AgentDispatchRequest } from '../host/agentDispatch.js';

interface AgentInventoryEntry {
  agentId: string;
  persona: string;
  label: string;
  description?: string;
  modelClass: string;
  packName: string;
  packVersion: string;
  toolAllowlist: string[];
  hasHandoffSchemas: boolean;
  memoryShape?: ResolvedAgentManifest['memoryShape'];
  confidenceThreshold?: number;
  degraded?: string[];
}

function toEntry(a: ResolvedAgentManifest): AgentInventoryEntry {
  return {
    agentId: a.agentId,
    persona: a.persona,
    label: a.label ?? a.persona,
    description: a.description,
    modelClass: a.modelClass,
    packName: a.packName,
    packVersion: a.packVersion,
    toolAllowlist: a.toolAllowlist ?? [],
    hasHandoffSchemas: Boolean(a.handoff?.taskSchema || a.handoff?.returnSchema),
    memoryShape: a.memoryShape,
    confidenceThreshold: a.confidence?.defaultThreshold,
    degraded: a.degraded && a.degraded.length > 0 ? a.degraded : undefined,
  };
}

export function registerAgentRoutes(app: Express): void {
  // RFC 0072 §A — NORMATIVE read-only inventory (matches agent-inventory-response.schema.json).
  // Auth-gated (registered after authMiddleware in index.ts). This host advertises
  // capabilities.agents.manifestRuntime UNCONDITIONALLY (discovery.ts), so the route
  // is always live; a host that gates the advertisement MUST 404 these endpoints when
  // it does not advertise the capability (RFC 0072 §A: "MUST serve iff advertised").
  app.get('/v1/agents', (_req, res) => {
    const agents = getAgentRegistry().list().map(toEntry);
    res.json({ agents, total: agents.length });
  });
  app.get('/v1/agents/:agentId', (req, res) => {
    const a = getAgentRegistry().get(req.params.agentId);
    if (!a) {
      res.status(404).json({ error: 'not_found', message: `agent '${req.params.agentId}' is not installed on this host` });
      return;
    }
    res.json(toEntry(a));
  });

  // Sample-extension aliases (RFC 0070 convenience; non-normative). The list
  // form additionally reports the host's runtime posture for the CLI.
  app.get('/v1/host/sample/agents', (_req, res) => {
    const agents = getAgentRegistry().list().map(toEntry);
    res.json({ agents, total: agents.length, runtime: { manifestRuntime: true } });
  });
  app.get('/v1/host/sample/agents/:agentId', (req, res) => {
    const a = getAgentRegistry().get(req.params.agentId);
    if (!a) {
      res.status(404).json({ error: 'not_found', message: `agent '${req.params.agentId}' is not installed on this host` });
      return;
    }
    res.json(toEntry(a));
  });

  // Dispatch one turn of a manifest agent (RFC 0070 floor).
  app.post('/v1/host/sample/agents/:agentId/dispatch', (req, res) => {
    const body = (req.body ?? {}) as Partial<AgentDispatchRequest>;
    try {
      const result = runAgentDispatch({
        agentId: req.params.agentId,
        task: body.task,
        availableTools: Array.isArray(body.availableTools) ? body.availableTools : undefined,
        confidenceThreshold: typeof body.confidenceThreshold === 'number' ? body.confidenceThreshold : undefined,
        simulateConfidence: typeof body.simulateConfidence === 'number' ? body.simulateConfidence : undefined,
        validateHandoff: body.validateHandoff,
      });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        res.status(404).json({ error: 'agent_not_found', message: err.message });
        return;
      }
      res.status(500).json({ error: 'dispatch_error', message: err instanceof Error ? err.message : String(err) });
    }
  });
}

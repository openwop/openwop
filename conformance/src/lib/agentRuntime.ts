/**
 * Shared helper for the RFC 0070 agents.manifestRuntime conformance scenario.
 * Lives in lib/ (not a *.test.ts) so scenarios import it via `../lib/agentRuntime.js`.
 */
import { driver } from './driver.js';

interface DiscoveryDoc {
  capabilities?: { agents?: { manifestRuntime?: Record<string, unknown> } };
}

/** Reads `capabilities.agents.manifestRuntime` from discovery; null when unadvertised. */
export async function readManifestRuntimeCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const mr = (res.json as DiscoveryDoc | undefined)?.capabilities?.agents?.manifestRuntime;
  return mr && typeof mr === 'object' ? mr : null;
}

interface AgentInventory {
  agents?: Array<{ agentId?: string; [k: string]: unknown }>;
  total?: number;
}

/** GET the NORMATIVE manifest-agent inventory (RFC 0072 §A `GET /v1/agents`);
 *  null when the host doesn't advertise the capability (404/405/501). */
export async function listManifestAgents(): Promise<AgentInventory | null> {
  const res = await driver.get('/v1/agents');
  if (res.status === 404 || res.status === 405 || res.status === 501) return null;
  return (res.json as AgentInventory | undefined) ?? {};
}

export interface DispatchResult {
  agentId?: string;
  status?: string;
  toolSurface?: string[];
  confidence?: number;
  threshold?: number;
  events?: Array<{ type?: string; agentId?: string; decision?: string; [k: string]: unknown }>;
  result?: unknown;
  error?: { code?: string; message?: string };
}

/** Dispatch one manifest-agent turn via the host-sample seam; null when absent. */
export async function dispatchAgent(agentId: string, body: Record<string, unknown>): Promise<DispatchResult | null> {
  const res = await driver.post(`/v1/host/sample/agents/${encodeURIComponent(agentId)}/dispatch`, body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as DispatchResult | undefined) ?? {};
}

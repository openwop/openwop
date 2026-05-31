/**
 * Agents inventory client — wraps the SDK's `agents` + `userAgents`
 * surfaces (RFC 0072 §A normative `GET /v1/agents` +
 * `/v1/agents/{agentId}` + sample-extension
 * `POST/DELETE /v1/host/sample/agents` +
 * `GET/POST /v1/host/sample/registry/agent-packs`).
 *
 * The frontend pattern is one thin module per backend surface (see
 * `runsClient.ts`, `interruptsClient.ts`, etc.); these wrappers
 * adapt the SDK's `null`-on-404 convention to the frontend's
 * "empty array means none, error means broken" convention so call
 * sites don't have to dance around the gating semantics.
 */

import { getSdkClient } from './runsClient.js';
import { authedHeaders, config, fetchOpts } from './config.js';
import type {
  AgentInventoryEntry,
  AgentPackSummary as SdkAgentPackSummary,
  UserAgentRecord,
} from '@openwop/openwop';

export type AgentEntry = AgentInventoryEntry;
export type AgentPackSummary = SdkAgentPackSummary;

/** List all manifest agents the host has installed. Returns an empty
 *  array (not null) when the host doesn't advertise
 *  `capabilities.agents.manifestRuntime` — call sites care about
 *  "what can I show in the UI", not about the discovery gate. */
export async function listAgents(): Promise<readonly AgentEntry[]> {
  const resp = await getSdkClient().agents.list();
  if (!resp) return [];
  return resp.agents;
}

/** Fetch a single agent by id. Returns `null` when the host doesn't
 *  advertise the capability OR when the id is unknown — call sites
 *  treat both as "not available", same as a missing pack. */
export async function getAgent(agentId: string): Promise<AgentEntry | null> {
  return getSdkClient().agents.get(agentId);
}

/** Create a user-authored agent via `POST /v1/host/sample/agents`
 *  (sample-extension). Returns the projected record on success;
 *  the underlying SDK throws on validation / conflict / forbidden
 *  with the server error body in the message. */
export interface CreateUserAgentInput {
  persona: string;
  label?: string;
  description?: string;
  modelClass: 'chat' | 'reasoning' | 'coding' | 'extraction';
  systemPrompt: string;
  toolAllowlist?: string[];
  memoryShape?: {
    scratchpad?: boolean;
    conversation?: boolean;
    longTerm?: boolean;
  };
  confidenceThreshold?: number;
}

export async function createUserAgent(input: CreateUserAgentInput): Promise<UserAgentRecord> {
  return await getSdkClient().userAgents.create(input);
}

export async function listAvailableAgentPacks(): Promise<readonly AgentPackSummary[]> {
  const resp = await getSdkClient().userAgents.listAvailablePacks();
  if (!resp) return [];
  return resp.packs;
}

export async function installAgentPack(name: string, version?: string): Promise<void> {
  await getSdkClient().userAgents.installPack(version !== undefined ? { name, version } : { name });
}

/** Delete a user-authored agent. Returns `true` when the row was
 *  removed; `false` when the agent didn't exist. Throws when the
 *  agent belongs to a different workspace (403) or is
 *  pack-installed. */
export async function deleteUserAgent(agentId: string): Promise<boolean> {
  return await getSdkClient().userAgents.delete(agentId);
}

/** Projection returned by the editable-instructions PATCH. */
export interface UserAgentProjection {
  agentId: string;
  persona: string;
  label?: string;
  description?: string;
  modelClass: string;
  systemPrompt: string;
  toolAllowlist: string[];
  memoryShape: { scratchpad: boolean; conversation: boolean; longTerm: boolean };
  confidenceThreshold?: number;
}

/** Edit a user-authored agent's instructions + persona-shaping metadata via
 *  `PATCH /v1/host/sample/agents/:id` (sample-extension; not in the SDK).
 *  `persona` is immutable — omit it. The response carries the saved
 *  `systemPrompt` (the read projection on `GET /v1/agents` omits it). */
export async function updateUserAgent(
  agentId: string,
  patch: {
    label?: string;
    description?: string;
    modelClass?: 'chat' | 'reasoning' | 'coding' | 'extraction';
    systemPrompt?: string;
    toolAllowlist?: string[];
    memoryShape?: { scratchpad?: boolean; conversation?: boolean; longTerm?: boolean };
    confidenceThreshold?: number;
  },
): Promise<UserAgentProjection> {
  const res = await fetch(
    `${config.baseUrl}/v1/host/sample/agents/${encodeURIComponent(agentId)}`,
    fetchOpts({ method: 'PATCH', headers: authedHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(patch) }),
  );
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch { /* ignore */ }
    throw new Error(`updateUserAgent failed: ${detail}`);
  }
  return (await res.json()) as UserAgentProjection;
}

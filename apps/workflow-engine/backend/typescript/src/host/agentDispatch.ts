/**
 * RFC 0070 — dispatch a pack-declared manifest agent (the runtime floor).
 *
 * Resolves an agent from the AgentRegistry (RFC 0003) and runs ONE deterministic
 * agent turn, honoring the floor contracts:
 *   - system prompt resolved from the manifest (RFC 0003 §C);
 *   - tool surface filtered to the agent's `toolAllowlist` (RFC 0002 §A14);
 *   - inbound task validated against `handoff.taskSchemaRef` and the produced
 *     result against `handoff.returnSchemaRef` (RFC 0003 §D), when the host
 *     advertises `agents.manifestRuntime.handoffValidation`;
 *   - confidence-threshold escalation (RFC 0002 §F): a sub-threshold decision
 *     escalates instead of proceeding;
 *   - attributed `agent.*` events (RFC 0002 §A) carrying the agentId;
 *   - BYOK/SR-1: no credential material is placed in events or the result.
 *
 * The turn itself is deterministic (no live model call) so the seam is
 * replay-safe and conformance-stable — it proves the dispatch CONTRACTS, not
 * model quality. A real model turn rides the existing provider dispatch; that
 * (and crew/orchestrator integration) is sequenced as a tier-up.
 *
 * Backs `POST /v1/host/sample/agents/{agentId}/dispatch`.
 *
 * @see RFCS/0070-agent-manifest-runtime.md
 */

import Ajv2020 from 'ajv/dist/2020.js';
import { getAgentRegistry, type ResolvedAgentManifest } from '../executor/agentRegistry.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });

export class AgentNotFoundError extends Error {
  constructor(public agentId: string) {
    super(`agent '${agentId}' is not installed on this host`);
    this.name = 'AgentNotFoundError';
  }
}

export interface AgentDispatchRequest {
  /** The manifest agentId to dispatch. */
  agentId: string;
  /** Inbound task payload (validated against handoff.taskSchemaRef). */
  task?: unknown;
  /** Tool surface the host offers this turn; intersected with toolAllowlist. */
  availableTools?: string[];
  /** Per-run confidence threshold override (RFC 0002 §F). */
  confidenceThreshold?: number;
  /** Deterministic hook: the confidence the turn emits (default 0.9). Lets a
   *  caller drive the §F escalation path without a live model. */
  simulateConfidence?: number;
  /** Honor handoff schema validation (mirrors the host's
   *  agents.manifestRuntime.handoffValidation advertisement). Default true. */
  validateHandoff?: boolean;
}

export interface AgentEvent {
  type: 'agent.reasoned' | 'agent.decided';
  agentId: string;
  [k: string]: unknown;
}

export interface AgentDispatchResult {
  agentId: string;
  persona: string;
  modelClass: string;
  status: 'completed' | 'failed' | 'escalated';
  /** toolAllowlist-filtered surface actually offered to the agent (§A14). */
  toolSurface: string[];
  confidence: number;
  threshold: number;
  events: AgentEvent[];
  result?: unknown;
  error?: { code: string; message: string };
}

/** RFC 0002 §A14 — intersect the host-offered tools with the agent's allowlist.
 *  Absent allowlist ⇒ no tools (the conservative host policy from the schema). */
function filterTools(available: string[], allowlist: string[] | undefined): string[] {
  if (!allowlist) return [];
  const allow = new Set(allowlist);
  return available.filter((t) => allow.has(t));
}

/** Build a minimal value satisfying a (simple) JSON Schema 2020-12 object so the
 *  deterministic turn can produce a return-schema-conformant result. Covers the
 *  common top-level `required` + `type` shape; anything richer falls back to {}. */
function stubFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return { ok: true };
  const s = schema as { type?: string; required?: string[]; properties?: Record<string, { type?: string }> };
  if (s.type && s.type !== 'object') return stubScalar(s.type);
  const out: Record<string, unknown> = {};
  for (const key of s.required ?? []) {
    out[key] = stubScalar(s.properties?.[key]?.type);
  }
  return out;
}
function stubScalar(type: string | undefined): unknown {
  switch (type) {
    case 'string': return 'ok';
    case 'number': case 'integer': return 0;
    case 'boolean': return true;
    case 'array': return [];
    case 'object': return {};
    default: return 'ok';
  }
}

/**
 * Dispatch one turn of a manifest agent. Throws AgentNotFoundError when the
 * agentId is not in the registry (caller maps to 404).
 */
export function runAgentDispatch(req: AgentDispatchRequest): AgentDispatchResult {
  const agent = getAgentRegistry().get(req.agentId);
  if (!agent) throw new AgentNotFoundError(req.agentId);

  const validate = req.validateHandoff !== false;
  const toolSurface = filterTools(req.availableTools ?? [], agent.toolAllowlist);
  const confidence = typeof req.simulateConfidence === 'number' ? req.simulateConfidence : 0.9;
  const threshold = typeof req.confidenceThreshold === 'number'
    ? req.confidenceThreshold
    : (agent.confidence?.defaultThreshold ?? 0.7);

  const base = (status: AgentDispatchResult['status'], extra: Partial<AgentDispatchResult>): AgentDispatchResult => ({
    agentId: agent.agentId, persona: agent.persona, modelClass: agent.modelClass,
    status, toolSurface, confidence, threshold, events: [], ...extra,
  });

  // §D inbound task validation (RFC 0003 §D), gated on handoffValidation.
  if (validate && agent.handoff?.taskSchema) {
    if (!validateAgainst(agent.handoff.taskSchema, req.task)) {
      return base('failed', { error: { code: 'task_schema_violation', message: ajvErrors() } });
    }
  }

  // The deterministic turn: a reasoning event, then a decision. (No model call,
  // no credentials — SR-1 holds by construction.)
  const events: AgentEvent[] = [
    { type: 'agent.reasoned', agentId: agent.agentId, summary: `${agent.persona} evaluated the task against ${toolSurface.length} permitted tool(s).` },
  ];

  // §F confidence escalation — below threshold MUST escalate, not proceed.
  if (confidence < threshold) {
    events.push({ type: 'agent.decided', agentId: agent.agentId, decision: 'escalate', confidence });
    return base('escalated', { events });
  }

  // Produce a deterministic result; when a return schema is declared, make it
  // conform (and validate, RFC 0003 §D).
  const result = agent.handoff?.returnSchema ? stubFromSchema(agent.handoff.returnSchema) : { ok: true, agentId: agent.agentId };
  if (validate && agent.handoff?.returnSchema && !validateAgainst(agent.handoff.returnSchema, result)) {
    events.push({ type: 'agent.decided', agentId: agent.agentId, decision: 'final', confidence });
    return base('failed', { events, error: { code: 'return_schema_violation', message: ajvErrors() } });
  }
  events.push({ type: 'agent.decided', agentId: agent.agentId, decision: 'final', confidence });
  return base('completed', { events, result });
}

let lastErrors = '';
function validateAgainst(schema: unknown, value: unknown): boolean {
  try {
    const fn = ajv.compile(schema as object);
    const ok = fn(value) as boolean;
    lastErrors = ok ? '' : ajv.errorsText(fn.errors, { separator: '; ' });
    return ok;
  } catch (err) {
    lastErrors = err instanceof Error ? err.message : String(err);
    return false;
  }
}
function ajvErrors(): string {
  return lastErrors || 'schema validation failed';
}

/** Read-only inventory of installed manifest agents (registry-backed). */
export function listManifestAgents(): ResolvedAgentManifest[] {
  return [...getAgentRegistry().list()];
}

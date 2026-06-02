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
 * Two turn modes share the SAME floor contracts (tool filtering, §D schema
 * validation, §F escalation, SR-1):
 *   - `runAgentDispatch` — the DETERMINISTIC seam (no model call). Replay-safe
 *     and conformance-stable; proves the dispatch CONTRACTS, not model quality.
 *     This stays the default so the conformance harness is unaffected.
 *   - `runAgentDispatchLive` — a REAL model turn via an injected `callAI`
 *     (the host's `ctx.callAI`, managed or BYOK). The agent's `modelClass` is
 *     resolved to a concrete `(provider, model)` (modelClassResolver) and, when
 *     a return schema is declared, the call runs in structured-output mode and
 *     the parsed payload is validated against it.
 *
 * Backs `POST /v1/host/sample/agents/{agentId}/dispatch` (live when the request
 * sets `live: true` and the host wired an AI adapter).
 *
 * @see RFCS/0070-agent-manifest-runtime.md
 */

import { getAgentRegistry, type ResolvedAgentManifest } from '../executor/agentRegistry.js';
import type { AiCallRequest, AiCallResult } from '../executor/types.js';
import { resolveModelForClass, type ResolveModelOptions } from './modelClassResolver.js';

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
  /** Whether this turn made a real model call (live) or ran the deterministic
   *  seam. Lets callers/telemetry distinguish the two. */
  live?: boolean;
  /** Concrete provider/model the live turn resolved from the agent's modelClass
   *  (absent for the deterministic seam). */
  provider?: string;
  model?: string;
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
function stubFromSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 8) return { ok: true };
  const s = schema as {
    type?: string; required?: string[];
    properties?: Record<string, unknown>; items?: unknown;
  };
  if (s.type && s.type !== 'object') return stubScalar(s.type);
  const out: Record<string, unknown> = {};
  for (const key of s.required ?? []) {
    const propSchema = s.properties?.[key] as { type?: string } | undefined;
    // Recurse into required object properties so nested `required` constraints
    // are satisfied (not just top-level scalars).
    out[key] = propSchema?.type === 'object'
      ? stubFromSchema(propSchema, depth + 1)
      : stubScalar(propSchema?.type);
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

  // §D inbound task validation (RFC 0003 §D), gated on handoffValidation. Uses
  // the validator pre-compiled at load — no per-dispatch Ajv recompile.
  if (validate && agent.handoff?.validateTask) {
    const r = agent.handoff.validateTask(req.task);
    if (!r.ok) {
      return base('failed', { error: { code: 'task_schema_violation', message: r.errors ?? 'task schema validation failed' } });
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
  // conform (and validate via the pre-compiled validator, RFC 0003 §D).
  const result = agent.handoff?.returnSchema ? stubFromSchema(agent.handoff.returnSchema) : { ok: true, agentId: agent.agentId };
  if (validate && agent.handoff?.validateReturn) {
    const r = agent.handoff.validateReturn(result);
    if (!r.ok) {
      events.push({ type: 'agent.decided', agentId: agent.agentId, decision: 'final', confidence });
      return base('failed', { events, error: { code: 'return_schema_violation', message: r.errors ?? 'return schema validation failed' } });
    }
  }
  events.push({ type: 'agent.decided', agentId: agent.agentId, decision: 'final', confidence });
  return base('completed', { events, result });
}

// ── Live dispatch (real model turn) ──────────────────────────────────────

/** A bound `ctx.callAI` (from `createAiProvidersAdapter(scope).callAI`). Injected
 *  so this module stays free of the heavy adapter/secrets construction and is
 *  unit-testable with a mock. */
export type CallAi = (req: AiCallRequest) => Promise<AiCallResult>;

export interface LiveDispatchDeps {
  /** The real provider call (managed or BYOK), already scoped to a run/tenant. */
  callAI: CallAi;
  /** Provider/model resolution hints. Defaults to `preferManaged: true` so an
   *  agent can take a real turn with no BYOK setup. */
  modelOptions?: ResolveModelOptions;
  /** BYOK credentialRef to pass through (non-managed turns). */
  credentialRef?: string;
}

/** Render the inbound task into a single user message. */
function taskToMessage(task: unknown): string {
  if (task === undefined || task === null) return 'Begin the task.';
  if (typeof task === 'string') return task;
  try {
    return JSON.stringify(task, null, 2);
  } catch {
    return String(task);
  }
}

/** Pull a numeric `confidence` from a structured result, if present. */
function confidenceFromData(data: unknown): number | undefined {
  if (data && typeof data === 'object' && typeof (data as { confidence?: unknown }).confidence === 'number') {
    return (data as { confidence: number }).confidence;
  }
  return undefined;
}

/**
 * Dispatch one LIVE turn of a manifest agent — a real model call via the
 * injected `callAI`, wrapped in the same floor contracts as the deterministic
 * seam: tool-allowlist filtering (§A14), §D task/return schema validation,
 * §F confidence escalation, and SR-1 (no credential material in the result).
 *
 * The agent's `modelClass` is resolved to a concrete `(provider, model)` here
 * (modelClassResolver). When the agent declares a return schema, the call runs
 * in structured-output mode and the parsed payload is validated against it.
 *
 * Throws AgentNotFoundError when the agentId is not installed (caller → 404).
 * Provider failures are returned as `status: 'failed'` with the provider's
 * error code — they are not thrown.
 */
export async function runAgentDispatchLive(
  req: AgentDispatchRequest,
  deps: LiveDispatchDeps,
): Promise<AgentDispatchResult> {
  const agent = getAgentRegistry().get(req.agentId);
  if (!agent) throw new AgentNotFoundError(req.agentId);

  const validate = req.validateHandoff !== false;
  const toolSurface = filterTools(req.availableTools ?? [], agent.toolAllowlist);
  const threshold = typeof req.confidenceThreshold === 'number'
    ? req.confidenceThreshold
    : (agent.confidence?.defaultThreshold ?? 0.7);

  const base = (status: AgentDispatchResult['status'], extra: Partial<AgentDispatchResult>): AgentDispatchResult => ({
    agentId: agent.agentId, persona: agent.persona, modelClass: agent.modelClass,
    status, toolSurface, confidence: 1, threshold, events: [], live: true, ...extra,
  });

  // §D inbound task validation.
  if (validate && agent.handoff?.validateTask) {
    const r = agent.handoff.validateTask(req.task);
    if (!r.ok) {
      return base('failed', { error: { code: 'task_schema_violation', message: r.errors ?? 'task schema validation failed' } });
    }
  }

  // Resolve modelClass → concrete (provider, model). Default to the managed tier
  // so no BYOK is required for an out-of-the-box live turn.
  const resolved = resolveModelForClass(agent.modelClass, deps.modelOptions ?? { preferManaged: true });
  if (!resolved) {
    return base('failed', { error: { code: 'no_model_available', message: `no provider/model resolves for modelClass '${agent.modelClass}'` } });
  }
  const credentialRef = resolved.managed ? `managed:${resolved.provider}` : (deps.credentialRef ?? resolved.provider);

  const request: AiCallRequest = {
    provider: resolved.provider,
    model: resolved.model,
    systemPrompt: agent.systemPrompt,
    messages: [{ role: 'user', content: taskToMessage(req.task) }],
    credentialRef,
    ...(agent.handoff?.returnSchema ? { responseSchema: agent.handoff.returnSchema as Record<string, unknown> } : {}),
  };

  let out: AiCallResult;
  try {
    out = await deps.callAI(request);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? 'provider_error';
    return base('failed', {
      provider: resolved.provider, model: resolved.model,
      error: { code, message: err instanceof Error ? err.message : String(err) },
    });
  }

  const result = agent.handoff?.returnSchema ? out.data : { content: out.content ?? '' };
  // §F confidence escalation — only when the model's structured output declares
  // a numeric confidence (we never fabricate one for a live turn).
  const confidence = confidenceFromData(out.data) ?? (typeof req.simulateConfidence === 'number' ? req.simulateConfidence : 1);
  const events: AgentEvent[] = [
    { type: 'agent.reasoned', agentId: agent.agentId, summary: `${agent.persona} ran a ${resolved.provider}/${resolved.model} turn over ${toolSurface.length} permitted tool(s).` },
  ];
  if (confidence < threshold) {
    events.push({ type: 'agent.decided', agentId: agent.agentId, decision: 'escalate', confidence });
    return base('escalated', { provider: resolved.provider, model: resolved.model, confidence, events });
  }

  // §D return-schema validation against the real model output.
  if (validate && agent.handoff?.returnSchema && agent.handoff.validateReturn) {
    const r = agent.handoff.validateReturn(result);
    if (!r.ok) {
      events.push({ type: 'agent.decided', agentId: agent.agentId, decision: 'final', confidence });
      return base('failed', {
        provider: resolved.provider, model: resolved.model, confidence, events,
        error: { code: 'return_schema_violation', message: r.errors ?? 'return schema validation failed' },
      });
    }
  }
  events.push({ type: 'agent.decided', agentId: agent.agentId, decision: 'final', confidence });
  return base('completed', { provider: resolved.provider, model: resolved.model, confidence, events, result });
}

/** Read-only inventory of installed manifest agents (registry-backed). */
export function listManifestAgents(): ResolvedAgentManifest[] {
  return [...getAgentRegistry().list()];
}

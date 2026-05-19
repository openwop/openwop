/**
 * Reasoning + agent event emission helpers — Phase I.2.
 *
 * Centralizes the canonical envelope shape for the 5 reasoning events
 * named in `capabilities.md` §`agents` (Phase 1):
 *
 *   - `agent.reasoned`         — internal reasoning trace (governed by
 *                                `reasoning.verbosity`)
 *   - `agent.toolCalled`       — tool/function invocation request
 *   - `agent.toolReturned`     — tool/function invocation result
 *   - `agent.handoff`          — agent-to-agent context transfer
 *   - `agent.decided`          — final decision with confidence
 *   - `runOrchestrator.decided` — supervisor-tier decision (RFC 0006)
 *
 * Every event carries an `AgentRef` so downstream consumers can
 * attribute behavior to a specific agent identity per
 * `agent-ref-positioning.md` §"Per-event footprint".
 *
 * **Verbosity gating.** When the host's effective `reasoning.verbosity`
 * is `"off"`, `agent.reasoned` MUST be suppressed entirely. `"summary"`
 * truncates the `reasoning` field to the resolved `tokenLimit` (default
 * 512 tokens; the reference uses 4-bytes-per-token as the approximation
 * shared with the AI proxy stub). `"full"` emits verbatim.
 *
 * **Production deployers** route real LLM model traces into these
 * helpers; the reference host emits a `runOrchestrator.decided` event
 * from the deterministic `core.orchestrator.supervisor` case so the
 * shape stays exercised even without an LLM call.
 *
 * @see spec/v1/capabilities.md §`agents` (Phase 1)
 * @see spec/v1/agent-ref-positioning.md
 * @see schemas/agent-ref.schema.json
 */

/** Minimal AgentRef shape — schemas/agent-ref.schema.json §"AgentRef". */
export interface AgentRef {
  readonly agentId: string;
  readonly modelClass?: 'reasoning' | 'tool-using' | 'chat';
  readonly memoryRef?: string;
  readonly version?: string;
}

export type ReasoningVerbosity = 'off' | 'summary' | 'full';

export interface AgentReasonedPayload {
  agent: AgentRef;
  reasoning: string;
  /** Optional model trace bytes used; clients display per verbosity. */
  tokensUsed?: number;
}

export interface AgentToolCalledPayload {
  agent: AgentRef;
  toolCallId: string;
  toolName: string;
  /** SHA-256 hex of the argument JSON — raw args are NEVER on event. */
  argumentsSha256: string;
}

export interface AgentToolReturnedPayload {
  agent: AgentRef;
  toolCallId: string;
  /** SHA-256 hex of the result JSON. */
  resultSha256: string;
  isError: boolean;
  durationMs: number;
}

export interface AgentHandoffPayload {
  fromAgent: AgentRef;
  toAgent: AgentRef;
  /** Brief human-readable rationale. */
  reason: string;
}

export interface AgentDecidedPayload {
  agent: AgentRef;
  /** Free-form decision label (host or fixture defines vocabulary). */
  decision: string;
  /** Required confidence ∈ [0, 1] per CP-1 escalation contract. */
  confidence: number;
  /** Optional human-readable rationale. */
  rationale?: string;
}

export interface RunOrchestratorDecidedPayload {
  /** Supervisor's AgentRef per RunSnapshot.runOrchestrator. */
  supervisor: AgentRef;
  /** OrchestratorDecision discriminator per schemas/orchestrator-decision.schema.json. */
  decision: {
    kind: 'next-worker' | 'ask-user' | 'terminate';
    /** Decision-specific fields; host MAY extend. */
    [key: string]: unknown;
  };
  /** Confidence ∈ [0, 1] for CP-1 escalation check. */
  confidence: number;
}

/**
 * Trim a reasoning string to the configured token budget using the
 * 4-bytes-per-token approximation (consistent with ai-proxy.ts).
 */
function truncateReasoning(
  reasoning: string,
  tokenLimit: number,
): { reasoning: string; tokensUsed: number; truncated: boolean } {
  const byteLimit = tokenLimit * 4;
  const buf = Buffer.from(reasoning, 'utf8');
  if (buf.byteLength <= byteLimit) {
    return {
      reasoning,
      tokensUsed: Math.ceil(buf.byteLength / 4),
      truncated: false,
    };
  }
  // Truncate to byteLimit-3 then append "…" — keep valid UTF-8 by
  // decoding then re-encoding the substring.
  const truncatedBuf = buf.subarray(0, Math.max(0, byteLimit - 3));
  return {
    reasoning: truncatedBuf.toString('utf8') + '…',
    tokensUsed: tokenLimit,
    truncated: true,
  };
}

/**
 * Build an `agent.reasoned` payload respecting the host's effective
 * verbosity. Returns `null` when verbosity is `"off"` — caller
 * suppresses the emission entirely (callers check for null before
 * appending).
 */
export function buildAgentReasonedPayload(
  agent: AgentRef,
  reasoning: string,
  options: { verbosity: ReasoningVerbosity; tokenLimit?: number },
): AgentReasonedPayload | null {
  if (options.verbosity === 'off') return null;
  if (options.verbosity === 'full') {
    return {
      agent,
      reasoning,
      tokensUsed: Math.ceil(Buffer.byteLength(reasoning, 'utf8') / 4),
    };
  }
  const limit = options.tokenLimit ?? 512;
  const trimmed = truncateReasoning(reasoning, limit);
  return { agent, reasoning: trimmed.reasoning, tokensUsed: trimmed.tokensUsed };
}

/**
 * Resolve the effective reasoning verbosity for a run. Precedence per
 * spec §`agents.reasoning`:
 *   1. RunOptions.configurable.reasoningVerbosity
 *   2. Host default
 *   3. `"summary"` fallback
 */
export function resolveReasoningVerbosity(
  runConfigurable: Record<string, unknown> | null | undefined,
  hostDefault: ReasoningVerbosity = 'summary',
): ReasoningVerbosity {
  const v = (runConfigurable ?? {})['reasoningVerbosity'];
  if (v === 'off' || v === 'summary' || v === 'full') return v;
  return hostDefault;
}

/** Capability advertisement shape per capabilities.md §`agents`. */
export const REFERENCE_AGENTS_CAPABILITY = {
  supported: true,
  profile: 'wop-agents-full',
  modelClasses: ['reasoning', 'tool-using', 'chat'] as const,
  orchestratorPattern: 'delegate.smart',
  memoryBackends: ['long-term'] as const,
  orchestrator: true,
  dispatch: true,
  // RFC 0022 §A — host honors inputMapping / outputMapping /
  // perWorkerInputMappings / perWorkerOutputMappings on DispatchConfig.
  dispatchMapping: true,
  // RFC 0024 — host emits incremental `agent.reasoning.delta` events
  // for any `core.conformance.mock-agent` invocation that supplies
  // `mockReasoning.streamChunks` (the only emission path that varies
  // chunked output on this host today). Other emitters honor the
  // closing-event-only contract, which `streaming: true` still allows.
  reasoning: { verbosity: 'summary' as const, tokenLimit: 512, streaming: true },
} as const;

/**
 * RFC 0022 §B — `capabilities.subWorkflow` advertisement. The baseline
 * `core.subWorkflow` contract is unconditional; this top-level block
 * carries the additive RFC 0022 extension flags.
 */
export const REFERENCE_SUBWORKFLOW_CAPABILITY = {
  // RFC 0022 §B — host honors `inputMapping` on `core.subWorkflow` and
  // seeds child variables from parent-variable projections after the
  // `defaultValue` fold.
  inputMapping: true,
} as const;

/**
 * RFC 0023 §B.2 — `capabilities.conformance` block. Advertised because
 * the host registers the conformance-only `core.conformance.mock-agent`
 * typeId. The §B.1 registration gate refuses the typeId for workflow
 * ids outside the `conformance-*` prefix even with this flag set —
 * the flag exists for hosts that want to advertise the typeId is
 * reachable from the conformance suite, not that it is reachable from
 * arbitrary tenants.
 */
export const REFERENCE_CONFORMANCE_CAPABILITY = {
  mockAgent: true,
} as const;

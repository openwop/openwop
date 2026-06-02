/**
 * Executor-internal types.
 *
 * `NodeModule` is the contract every node-pack entry must satisfy. The
 * shape is intentionally narrow — a single async `execute(ctx)` function
 * returning `success`, `failure`, or `suspended`. Real openwop hosts
 * extend with retry policies, side-effect tracking, etc.; the sample
 * keeps it minimal.
 */

import type { A2aSurface } from '../host/a2aSurface.js';
import type { KanbanSurface } from '../host/kanbanSurface.js';
import type { KnowledgeSurface } from '../host/knowledgeSurface.js';
import type { ChatSurface } from '../host/chatSurface.js';
import type { CanvasSurface } from '../host/canvasSurface.js';
import type { WebResearchSurface } from '../host/webResearchSurface.js';
import type { LaunchStudioSurface } from '../host/launchStudioSurface.js';

/**
 * Single message in a chat-style AI request. Field shapes mirror
 * `spec/v1/host-capabilities.md §host.aiProviders` verbatim.
 */
export interface AiCallMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Request shape for `ctx.callAI(...)`. Implements the spec's
 * §host.aiProviders contract. `responseSchema` switches the call into
 * structured-output mode; `embeddingMode` switches into embeddings
 * mode (declared for type-completeness; sample host returns
 * `host_capability_missing` for embeddings).
 */
export interface AiCallRequest {
  /** Provider id — MUST be in the host's advertised aiProviders.supported list. */
  provider: string;
  /** Provider-specific model id. */
  model: string;
  /** Optional system prompt (top-level for Anthropic / Gemini; first message for OpenAI). */
  systemPrompt?: string;
  /** Conversation. Non-empty unless `embeddingMode` is true. */
  messages: ReadonlyArray<AiCallMessage>;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: ReadonlyArray<string>;
  /** When present, the host requests structured-output mode and
   *  attempts to parse the result against this JSON Schema. */
  responseSchema?: Record<string, unknown>;
  /** When true, this is an embedding request — `messages` is treated
   *  as the input text (first message's content). */
  embeddingMode?: boolean;
  /** Optional dimensions for the embedding (provider-dependent). */
  dimensions?: number;
  /** BYOK credentialRef. Required when policy is `required`; otherwise
   *  the host MAY route through its own credential of last resort. */
  credentialRef?: string;
}

/**
 * Result shape for `ctx.callAI(...)`. Note: `credentialRefHashed` is
 * the SHA-256 of `credentialRef` — the cleartext API key NEVER
 * appears in the result. This is enforced by
 * `aiProviders/aiProvidersHost.ts`.
 */
export interface AiCallResult {
  /** Free-form chat output. Absent for structured-output / embedding modes. */
  content?: string;
  /** Parsed structured-output payload. Present iff `responseSchema` was supplied. */
  data?: unknown;
  /** Embedding vector. Present iff `embeddingMode` was true. */
  embedding?: ReadonlyArray<number>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  /** Canonical: `stop` | `length` | `content-filter` | `tool-call` | `other`. */
  finishReason?: 'stop' | 'length' | 'content-filter' | 'tool-call' | 'other';
  model?: string;
  /** SHA-256 hex of the credentialRef used (NEVER the cleartext key). */
  credentialRefHashed?: string;
}

/** Tool definition handed to `ctx.callAIWithTools(...)`. */
export interface AiTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AiToolCallRequest extends Omit<AiCallRequest, 'responseSchema' | 'embeddingMode' | 'dimensions'> {
  tools: ReadonlyArray<AiTool>;
}

/** Tool-use block from a single `callAIWithTools` round. Pack-level
 *  workflow code orchestrates execution + replies by appending tool
 *  results to its `messages` array on the next call. */
export interface AiToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AiToolCallResult extends AiCallResult {
  /** Tool-use requests from the model. Empty array when the model
   *  produced only text. */
  toolCalls?: ReadonlyArray<AiToolUseBlock>;
}

export interface NodeContext {
  runId: string;
  nodeId: string;
  tenantId: string;
  scopeId?: string;
  inputs: unknown;
  config?: Record<string, unknown>;
  /** Multi-Agent Shift Phase 1 — the node's authoring-time agent pin
   *  (`node.agent`, an `agent-ref.schema.json`), surfaced so node modules
   *  can honor `nodes[].agent.agentId`. Undefined when the node carries no
   *  pin. Distinct from `config`, which the schema models as a sibling. */
  nodeAgent?: { agentId: string };
  /** Run-level configurable overlay from RunOptions.configurable. */
  configurable: Record<string, unknown>;
  /** ctx.triggerData — the run-scoped trigger payload the `core.openwop.triggers`
   *  entry nodes surface to downstream nodes. Captured at run start, identical
   *  for every node (replay-safe). `undefined` for runs not started by a
   *  trigger that carries a payload. */
  triggerData?: unknown;
  /** Per-attempt counter; first attempt = 1. */
  attempt: number;
  /** Trust boundary of inputs entering this node (RFC 0020 §D).
   *
   *   - `'trusted'` (default): inputs come from authenticated openwop callers,
   *     internal workflow chaining, or other host-trusted sources.
   *   - `'untrusted'`: inputs originated from an external untrusted boundary
   *     (e.g. inbound MCP `tools/call.arguments`, A2A peer messages, raw
   *     webhook payloads). Pack nodes that forward this content to LLM
   *     surfaces SHOULD mark it as untrusted per the
   *     `threat-model-prompt-injection.md` UNTRUSTED-marker convention.
   *
   * Read from `run.metadata.trustBoundary` at run-start; constant across
   * the run. Defaults to `'trusted'` when metadata is absent. */
  trustBoundary?: 'trusted' | 'untrusted';
  /** Resolved BYOK secret values keyed by `credentialRef`. Empty if none required. */
  secrets: Record<string, string>;
  /**
   * Emit a side-effect-free event into the run log.
   *
   * Returns the persisted event's `eventId` + `sequence` so the node
   * can build downstream `causationId` chains per RFC 0002 §B (e.g.,
   * `agent.toolReturned.causationId MUST equal agent.toolCalled.eventId`).
   * Callers that don't need the return value can ignore it — additive
   * relative to the prior `Promise<void>` signature.
   */
  emit(type: string, payload: unknown): Promise<{ eventId: string; sequence: number }>;
  /**
   * Spec-defined AI provider entry point per
   * `spec/v1/host-capabilities.md §host.aiProviders`. Present when
   * the host advertises `capabilities.aiProviders.supported`.
   * Routes through host-managed credential resolution + policy
   * enforcement; the cleartext API key never crosses the call
   * boundary back into the node.
   */
  callAI?(req: AiCallRequest): Promise<AiCallResult>;
  /**
   * Tool-calling variant. Present iff the host advertises
   * `aiProviders.toolCalling.supported`. Anthropic-only in this sample.
   */
  callAIWithTools?(req: AiToolCallRequest): Promise<AiToolCallResult>;
  /**
   * Host capability surfaces per RFCs 0014–0019. Present when the host
   * wires `initInMemorySurfaces()` (demo) or a real-backend equivalent.
   * Pack delegates index into these maps directly; the index signatures
   * are intentionally loose to match how packs spread `{ ...config,
   * ...inputs }` into surface methods. See
   * `src/host/inMemorySurfaces.ts` for the demo implementation and
   * the surface-shape comments next to each field.
   */
  storage?: HostStorageSurfaces;
  /** ctx.db.{sql, vector, …} — see RFC 0018. */
  db?: HostDbSurfaces;
  /** ctx.fs — RFC 0014 file-system surface. */
  fs?: HostFsSurface;
  /** ctx.queueBus — RFC 0017 messaging bus (used by core.messaging.* nodes). */
  queueBus?: HostQueueBusSurface;
  /** ctx.observability — used by core.openwop.obs nodes. */
  observability?: HostObservabilitySurface;
  /** ctx.a2a — RFC 0076 §A `host.a2a`. The A2A (Agent-to-Agent) client the
   *  `core.openwop.a2a` pack delegates to (`spec/v1/a2a-integration.md`). */
  a2a?: A2aSurface;
  /** ctx.kanban — `host.kanban`. The `vendor.myndhyve.kanban` pack's bridge to
   *  the demo kanban store (`spec/v1/host-capabilities.md §host.kanban`). */
  kanban?: KanbanSurface;
  /** ctx.knowledge — `host.knowledge`. Lexical RAG retrieval for the
   *  `vendor.myndhyve.knowledge-tools` pack (§host.knowledge). */
  knowledge?: KnowledgeSurface;
  /** ctx.chat — `host.chat`. The `vendor.myndhyve.chat` pack's bridge to the
   *  demo chat store (`spec/v1/host-capabilities.md §host.chat`). */
  chat?: ChatSurface;
  /** ctx.canvas — `host.canvas`. Durable shared-canvas store for the
   *  `vendor.myndhyve.canvas` pack (§host.canvas). */
  canvas?: CanvasSurface;
  /** ctx.webResearch — `host.webResearch` (§host.webResearch). */
  webResearch?: WebResearchSurface;
  /** ctx.launchStudio — `host.launchStudio` (§host.launchStudio). */
  launchStudio?: LaunchStudioSurface;
  /** ctx.userId — opaque principal id for vendor surfaces that key context on
   *  a user (e.g. launch-studio). The sample host sets it to the run tenant. */
  userId?: string;
  /** ctx.variables — run-scoped mutable variable bag (get/set), backed by the
   *  variables runtime. Used by launch-studio to thread step context. */
  variables?: { get(name: string): unknown; set(name: string, value: unknown): void };
  /** ctx.mcp — RFC 0020 host-side MCP server. The `expose` method is a
   *  no-op for hosts that build their MCP registry declaratively (by
   *  scanning workflow definitions). Pack delegates from
   *  core.openwop.mcp.expose-* call this and expect a `{handle}` result. */
  mcp?: {
    expose: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  /** ctx.respondToWebhook — the `core.openwop.triggers` webhook-respond node's
   *  reply channel. The host durably records the intended HTTP reply; absent
   *  on hosts where the pack should fall back to surfacing it as node outputs. */
  respondToWebhook?(response: { status?: number; headers?: Record<string, string>; body?: unknown }): Promise<void>;
}

/** Loose-typed surface map. The concrete shape lives in
 *  `host/inMemorySurfaces.ts`; this signature only constrains that
 *  every method is async + returns a record. Tightening this would
 *  require importing the concrete `KvSurface | TableSurface | …`
 *  union here, but those types belong to the host layer, not the
 *  executor — so we use a structural shape that matches the pack
 *  delegate's call site. */
type HostSurfaceMethod = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
type HostSurfaceCollection = { readonly [method: string]: HostSurfaceMethod };

export interface HostStorageSurfaces {
  kv?: HostSurfaceCollection;
  table?: HostSurfaceCollection;
  cache?: HostSurfaceCollection;
  blob?: HostSurfaceCollection;
  queue?: HostSurfaceCollection;
}
export interface HostDbSurfaces {
  sql?: HostSurfaceCollection;
  nosql?: HostSurfaceCollection;
  search?: HostSurfaceCollection;
  vector?: HostSurfaceCollection;
}
export type HostFsSurface = HostSurfaceCollection & {
  image?: HostSurfaceCollection;
  pdf?: HostSurfaceCollection;
  archive?: HostSurfaceCollection;
  ftp?: HostSurfaceCollection;
  sftp?: HostSurfaceCollection;
  ssh?: HostSurfaceCollection;
};
export type HostQueueBusSurface = HostSurfaceCollection;
export type HostObservabilitySurface = HostSurfaceCollection;

export type NodeOutcome =
  | { status: 'success'; outputs: unknown }
  | { status: 'failure'; error: { code: string; message: string }; retryable?: boolean }
  | {
      status: 'suspended';
      interrupt: {
        kind: 'approval' | 'clarification' | 'refinement' | 'cancellation' | 'external-event';
        data: unknown;
        resumeSchema?: Record<string, unknown>;
      };
    };

export interface NodeModule {
  typeId: string;
  version: string;
  /** Capability requirements — checked against runtimeCapabilities at register time. */
  requires?: readonly string[];
  /** Secret requirements — node manifest declares these; resolver fetches at execute time. */
  requiresSecrets?: readonly { id: string; provider: string; scope: string }[];
  /** RFC 0031 §B. Model capabilities this NodeModule requires the active
   *  model to advertise. Distinct from `requires`, which gates on HOST
   *  capabilities — this field gates on MODEL capabilities. Spec-reserved
   *  identifiers: `structured-output`, `discriminator-enum`, `long-context`,
   *  `reasoning` (model-native thinking-tokens), `function-calling`.
   *  Host-private extensions MUST prefix with `x-host-<host>-<key>`.
   *  Empty array (or absent field) means no model-capability requirements. */
  requiredModelCapabilities?: readonly string[];
  /** RFC 0031 §B. Substitute model coordinates the host MAY use if the
   *  active model lacks the declared `requiredModelCapabilities`. When
   *  the host advertises `capabilities.modelCapabilities.substitutionSupported: true`
   *  AND can authenticate to `fallbackModel.provider`, the host substitutes
   *  and emits `model.capability.substituted`. When `substitutionSupported`
   *  is false (the reference host's current posture) OR the field is
   *  absent, the host refuses on any unmet capability. Recursive substitution
   *  is NOT permitted (RFC 0031 §"Unresolved questions" #3). */
  fallbackModel?: { provider: string; model: string };
  execute(ctx: NodeContext): Promise<NodeOutcome>;
}

/** DAG edge between two nodes. Mirrors `WorkflowEdge` in
 *  `spec/v1/workflow-definition.schema.json`. */
export interface EdgeDef {
  edgeId: string;
  sourceNodeId: string;
  /** Source output port. Defaults to `'output'`. */
  sourceOutput?: string;
  targetNodeId: string;
  /** Target input port. Defaults to `'input'`. */
  targetInput?: string;
  /** Fan-in semantics for the target. Defaults to `'all_success'`. */
  triggerRule?: 'all_success' | 'any_success' | 'all_complete' | 'none_failed' | 'any_failed';
  /** Optional condition predicate evaluated against the source's output.
   *  When false, this edge contributes no input to the target (but
   *  triggerRule may still fire the target via other edges). */
  condition?: {
    path: string;
    op: 'eq' | 'neq' | 'truthy' | 'falsy' | 'exists' | 'contains';
    value?: unknown;
  };
  label?: string;
}

/** Workflow definition — stored either in the workflows table or in-memory.
 *  Accepts both the legacy linear shape (nodes only) and the spec-canonical
 *  DAG shape (nodes + edges). The executor delegates to the DAG scheduler
 *  whenever `edges` is non-empty; pure-linear runs are a degenerate case of
 *  the same scheduler with a chain of single-edge connections. */
export interface WorkflowDefinition {
  workflowId: string;
  nodes: ReadonlyArray<{
    nodeId: string;
    typeId: string;
    config?: Record<string, unknown>;
    /** Per-port input declarations from the fixture's `inputs:` block.
     *  Each entry is either:
     *   - a literal value (passed through unchanged), OR
     *   - a reference shape `{type: 'variable', variableName: string}`
     *     that the executor resolves against the run's variable bag
     *     before invoking the node (per `host/variablesRuntime.ts`).
     *  Future shapes (`{type: 'literal', value}`, `{type: 'config'}`,
     *  etc.) can be added without breaking the resolution interface. */
    inputs?: Record<string, unknown>;
    /** RFC 0065 — author hint that this terminal node's output is the
     *  workflow's canonical-deliverable artifact. Advisory; executor
     *  ignores the value. Forwarded round-trip so consuming tools
     *  (chat-surface completion cards, run-detail page, third-party
     *  hosts) can pick a primary output deterministically. */
    outputRole?: 'primary' | 'secondary';
    /** Multi-Agent Shift Phase 1 (`agent-ref.schema.json`). Optional
     *  authoring-time pin of which agent executes this node. Surfaced on
     *  `NodeContext.nodeAgent` so node modules (e.g. the conformance mock
     *  agent) can resolve the pinned `agentId`; the engine MAY override it
     *  at runtime via dispatch/orchestrator per the schema description. */
    agent?: { agentId: string };
  }>;
  /** DAG edges. When absent or empty, the executor builds an implicit linear
   *  chain from `nodes` (back-compat path for callers that pre-date the
   *  scheduler). */
  edges?: ReadonlyArray<EdgeDef>;
  /** Input schema (informational only in this sample; real hosts validate via Ajv). */
  inputSchema?: Record<string, unknown>;
  configurableSchema?: Record<string, unknown>;
  /** Variable declarations — per `spec/v1/workflow-definition.schema.json
   *  §variables`. The runtime seeds a per-run variable bag from these
   *  defaults at run-create time (`POST /v1/runs.inputs[name]` overrides
   *  `defaultValue` per `host/variablesRuntime.ts`). Read back via
   *  `RunSnapshot.variables` on `GET /v1/runs/{runId}`. */
  variables?: ReadonlyArray<{
    name: string;
    type?: string;
    description?: string;
    required?: boolean;
    defaultValue?: unknown;
  }>;
}

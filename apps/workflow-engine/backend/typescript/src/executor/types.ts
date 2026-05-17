/**
 * Executor-internal types.
 *
 * `NodeModule` is the contract every node-pack entry must satisfy. The
 * shape is intentionally narrow — a single async `execute(ctx)` function
 * returning `success`, `failure`, or `suspended`. Real openwop hosts
 * extend with retry policies, side-effect tracking, etc.; the sample
 * keeps it minimal.
 */

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
  /** Run-level configurable overlay from RunOptions.configurable. */
  configurable: Record<string, unknown>;
  /** Per-attempt counter; first attempt = 1. */
  attempt: number;
  /** Resolved BYOK secret values keyed by `credentialRef`. Empty if none required. */
  secrets: Record<string, string>;
  /** Emit a side-effect-free event into the run log. */
  emit(type: string, payload: unknown): Promise<void>;
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
        kind: 'approval' | 'clarification' | 'refinement' | 'cancellation';
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
  execute(ctx: NodeContext): Promise<NodeOutcome>;
}

/** Workflow definition — stored either in the workflows table or in-memory. */
export interface WorkflowDefinition {
  workflowId: string;
  /** Linear node sequence. Sample doesn't model branching DAGs (use core.subWorkflow + interrupt for control flow). */
  nodes: ReadonlyArray<{
    nodeId: string;
    typeId: string;
    config?: Record<string, unknown>;
  }>;
  /** Input schema (informational only in this sample; real hosts validate via Ajv). */
  inputSchema?: Record<string, unknown>;
  configurableSchema?: Record<string, unknown>;
}

/**
 * Request/response types for the openwop REST surface.
 *
 * Mirrors `api/openapi.yaml` and the JSON Schemas in
 * `schemas/`. Hand-authored rather than codegen'd — see
 * SDK README §rationale.
 *
 * Forward-compat: types use `string` (not narrow unions) for fields whose
 * spec'd values may grow over time (status enums, event types, error codes).
 * Consumers wanting exhaustive narrowing should `as const` their checks
 * rather than relying on the SDK to refuse unknown values.
 */

/** Run statuses per `RunSnapshot.status` in OpenAPI. */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'waiting-approval'
  | 'waiting-input'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Capabilities {
  protocolVersion: string;
  supportedEnvelopes: readonly string[];
  schemaVersions: Record<string, number>;
  limits: {
    clarificationRounds: number;
    schemaRounds: number;
    envelopesPerTurn: number;
    maxNodeExecutions?: number;
  };
  extensions?: Record<string, unknown>;
  // Network-handshake superset (all `(future)` fields per capabilities.md)
  implementation?: { name?: string; version?: string; vendor?: string };
  engineVersion?: number;
  eventLogSchemaVersion?: number;
  supportedTransports?: readonly ('rest' | 'mcp' | 'a2a' | 'grpc')[];
  configurable?: Record<string, unknown>;
  observability?: Record<string, unknown>;
  minClientVersion?: string;
}

export interface RunSnapshot {
  runId: string;
  workflowId: string;
  status: RunStatus;
  currentNodeId?: string;
  startedAt?: string;
  completedAt?: string;
  nodeStates?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  channels?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

/**
 * Per-run parameter overlay carried in `RunOptions.configurable`. Reserved
 * keys are typed; unknown keys are passed through verbatim. See
 * `run-options.md`.
 */
export interface RunConfigurable {
  /** Override the per-run node-execution ceiling. Clamped server-side. */
  recursionLimit?: number;
  /** Override AI model for nodes that consume `ctx.config.configurable.model`. */
  model?: string;
  /** Override AI temperature (server SHOULD enforce 0..2). */
  temperature?: number;
  /** Override AI max-tokens cap. */
  maxTokens?: number;
  /** Per-prompt-ID variant override map. */
  promptOverrides?: Record<string, string>;
  /** Implementation-specific extensions; passed through verbatim. */
  [key: string]: unknown;
}

export interface CreateRunRequest {
  workflowId: string;
  inputs?: Record<string, unknown>;
  tenantId?: string;
  scopeId?: string;
  callbackUrl?: string;
  configurable?: RunConfigurable;
  tags?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
  eventsUrl: string;
  statusUrl?: string;
}

export interface CancelRunRequest {
  reason?: string;
}

export interface CancelRunResponse {
  runId: string;
  status: 'cancelled' | 'cancelling';
}

/**
 * Portable JSON diagnostic export for a single run per
 * `spec/v1/debug-bundle.md` + `schemas/debug-bundle.schema.json`.
 *
 * Hosts MAY omit non-required fields. Consumers MUST treat masked /
 * omitted / hashed values as the spec-canonical content per the host's
 * advertised `redactionMode` — they are NOT placeholders for missing
 * data.
 */
export interface DebugBundle {
  bundleVersion: string;
  generatedAt: string;
  host: { name?: string; version?: string; vendor?: string };
  run: Record<string, unknown>;
  events: ReadonlyArray<Record<string, unknown>>;
  redactionApplied: boolean;
  /** Reflects the host's `capabilities.compliance.defaultMode`. */
  redactionMode: 'mask' | 'omit' | 'hash' | 'passthrough';
  /** True when the bundle hit the host's size cap; pair with `truncatedReason`. */
  truncated?: boolean;
  truncatedReason?: string;
  [key: string]: unknown;
}

export interface DebugBundleOptions {
  /** Optional host-extension query parameter to lower the size cap for testing. Spec-canonical hosts SHOULD prefer `host.<vendor>.<query>` namespacing; this is the SQLite-reference convention. */
  maxEvents?: number;
}

export interface PauseRunRequest {
  reason?: string;
  drainPolicy?: 'immediate' | 'drain-current-node';
}

export interface PauseRunResponse {
  runId: string;
  status: 'paused';
  pausedAt?: string;
}

export interface ResumeRunRequest {
  reason?: string;
}

export interface ResumeRunResponse {
  runId: string;
  status: 'running';
  resumedAt?: string;
}

// rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1).
export interface BulkCancelRunsRequest {
  runIds: readonly string[];
  reason?: string;
}

export interface BulkCancelRunResult {
  runId: string;
  ok: boolean;
  status?: 'cancelled' | 'cancelling';
  error?: { error: string; message: string; details?: Record<string, unknown> };
}

export interface BulkCancelRunsResponse {
  results: BulkCancelRunResult[];
}

// auth-profiles.md §"openwop-audit-log-integrity" §4. The response
// shape is canonically defined by schemas/audit-verify-result.schema.json;
// this TS view tracks the same fields with names normalized to
// camelCase. Hosts that don't advertise the profile return 404.
export interface AuditVerifyResult {
  fromSeq: number;
  toSeq: number;
  chainValid: boolean;
  checkpointsValid?: boolean;
  checkpoints: AuditVerifyCheckpoint[];
  anomalies: AuditVerifyAnomaly[];
}

export interface AuditVerifyCheckpoint {
  checkpoint: string;
  atSequence: number;
  merkleRoot: string;
  signature: string;
}

export interface AuditVerifyAnomaly {
  atSeq: number;
  expectedPrevHash: string;
  actualPrevHash: string;
}

export interface ForkRunRequest {
  fromSeq: number;
  mode: 'replay' | 'branch';
  runOptionsOverlay?: Record<string, unknown>;
}

export interface ForkRunResponse {
  runId: string;
  sourceRunId: string;
  fromSeq?: number;
  mode: 'replay' | 'branch';
  status: RunStatus;
  eventsUrl: string;
}

export interface ResolveInterruptRequest {
  resumeValue: unknown;
}

export interface ResolveInterruptResponse {
  runId: string;
  nodeId: string;
  status: RunStatus;
}

/**
 * Token-scoped interrupt inspection response — mirrors `suspend-request.schema.json`
 * (the `InterruptPayload` shape).
 */
export interface InterruptByTokenInspection {
  kind: 'approval' | 'clarification' | 'external-event' | 'custom';
  key: string;
  resumeSchema?: Record<string, unknown>;
  timeoutMs?: number;
  data: unknown;
}

export interface ResolveInterruptByTokenResponse {
  // Server-defined shape (openapi declares `type: object`); kept as
  // unknown-typed object so SDK consumers narrow per implementation.
  [key: string]: unknown;
}

export interface PollEventsResponse {
  events: readonly RunEventDoc[];
  isComplete: boolean;
}

/** Mirror of `run-event.schema.json` — top-level shape only. */
export interface RunEventDoc {
  eventId: string;
  runId: string;
  nodeId?: string;
  type: string; // RunEventType — string-typed for forward compat
  payload: unknown;
  timestamp: string;
  sequence: number;
  schemaVersion?: number;
  engineVersion?: string;
  causationId?: string;
}

export interface ErrorEnvelope {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export type StreamMode = 'values' | 'updates' | 'messages' | 'debug';

// ─── BYOK / AI providers (Phase H.1 + H.1″) ─────────────────────────────

/**
 * AI policy mode advertised by the host per `capabilities.md`
 * §`aiProviders.policies`. Hosts MAY advertise a subset; clients MUST
 * tolerate any subset.
 *
 *   - `disabled`   — provider MUST NOT be used at all
 *   - `optional`   — no restriction (default)
 *   - `required`   — provider call MUST carry a `credentialRef`
 *   - `restricted` — model MUST match the policy's `allowedModels`
 */
export type AIPolicyMode = 'disabled' | 'optional' | 'required' | 'restricted';

/**
 * Closed-set deny reason returned in `provider_policy_denied.details.reason`
 * per spec §"Wire-format error".
 */
export type AIPolicyDenyReason =
  | 'provider_disabled'
  | 'byok_required'
  | 'byok_required_but_unresolved'
  | 'model_not_allowed';

/**
 * Capability advertisement payload mirroring spec §`aiProviders` +
 * §`aiProviders.policies`. Optional sub-fields are absent on hosts
 * that don't enforce per-provider policies.
 */
export interface AIProvidersCapability {
  /** Provider ids the host's AI-proxy can route to. */
  supported: readonly string[];
  /** Subset of `supported` for which BYOK is permitted. */
  byok: readonly string[];
  /** Optional 4-mode policy enforcement advertisement. */
  policies?: {
    modes: readonly AIPolicyMode[];
    scopes?: readonly string[];
    errorCode?: string;
  };
}

/**
 * Opaque host-issued reference to a stored secret. Sent via
 * `RunOptions.configurable.ai.credentialRef`; the host resolves
 * server-side and never echoes the cleartext back to the client.
 * Per `auth.md` §"Secret resolution" + SR-1.
 */
export type AICredentialRef = string;

/**
 * AI overlay slot on `RunConfigurable.ai`. Picks the provider+model
 * and (optionally) names a credentialRef the host MUST resolve.
 */
export interface AIRunOverlay {
  provider?: string;
  model?: string;
  credentialRef?: AICredentialRef;
  /** Implementation extensions; passed through verbatim. */
  [key: string]: unknown;
}

// ─── MCP client (Phase H.2) ─────────────────────────────────────────────

/**
 * Capability advertisement for hosts that operate an MCP client.
 * Mirrors `examples/hosts/postgres/src/mcp-client.ts` reference shape.
 * `trustBoundary: "untrusted"` is REQUIRED per
 * threat-model-prompt-injection.md §"UNTRUSTED marker": tool output is
 * adversarial-tolerant and downstream LLM nodes treat it as user data.
 */
export interface McpClientCapability {
  supported: true;
  transports: readonly string[];
  defaultTimeoutMs?: number;
  trustBoundary: 'untrusted';
}

/** Wire shape of the `core.mcp.toolCall` node config. */
export interface McpToolCallNodeConfig {
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
}

/** Sanitized summary emitted on the `mcp.invoked` event payload (MCP-1). */
export interface McpInvokedSummary {
  serverId: string;
  toolName: string;
  argumentsSha256: string;
  resultSha256: string;
  resultLength: number;
  isError: boolean;
  durationMs: number;
}

// ─── HTTP client (Phase H.3) ────────────────────────────────────────────

/** Capability advertisement for hosts that implement `core.http.request`. */
export interface HttpClientCapability {
  supported: true;
  methods: readonly ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD')[];
  defaultTimeoutMs?: number;
  maxResponseBodyBytes: number;
  ssrfGuard: boolean;
  redirectPolicy?: 'follow' | 'reject';
}

/** Wire shape of the `core.http.request` node config. */
export interface HttpRequestNodeConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  expectStatus?: number | readonly number[];
}

// ─── Agent memory / MemoryAdapter (Phase I.1) ───────────────────────────

/** Mirror of `schemas/memory-entry.schema.json`. */
export interface MemoryEntry {
  id: string;
  content: string;
  tags: readonly string[];
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Optional TTL. Entries past `expiresAt` MUST NOT surface from list/get. */
  expiresAt?: string;
}

/** Mirror of `schemas/memory-list-options.schema.json`. */
export interface MemoryListOptions {
  /** Host MAY further bound. */
  limit?: number;
  /** Filter to entries carrying this tag. */
  tag?: string;
}

/** Capability advertisement shape per capabilities.md §`memory`. */
export interface MemoryCapability {
  supported: true;
  maxEntrySizeBytes: number;
  ttlSupported: boolean;
}

// ─── Reasoning + agent events (Phase I.2) ───────────────────────────────

/** Mirror of `schemas/agent-ref.schema.json`. */
export interface AgentRef {
  agentId: string;
  modelClass?: 'reasoning' | 'tool-using' | 'chat';
  memoryRef?: string;
  version?: string;
}

/** Reasoning verbosity per capabilities.md §`agents.reasoning`. */
export type ReasoningVerbosity = 'off' | 'summary' | 'full';

/** Capability advertisement shape per capabilities.md §`agents` (Phase 1-6). */
export interface AgentsCapability {
  supported: true;
  profile?: string;
  modelClasses?: readonly ('reasoning' | 'tool-using' | 'chat')[];
  orchestratorPattern?: string;
  memoryBackends?: readonly string[];
  orchestrator?: boolean;
  dispatch?: boolean;
  reasoning?: {
    verbosity: ReasoningVerbosity;
    tokenLimit?: number;
  };
}

// ─── Auth profile claims (Phase I.5 + I.6) ──────────────────────────────

/** Profile identifiers per auth-profiles.md. */
export type AuthProfileClaim =
  | 'openwop-audit-log-integrity'
  | 'openwop-auth-api-key-rotation'
  | 'openwop-auth-oauth2-client-credentials'
  | 'openwop-auth-oidc-user-bearer'
  | 'openwop-auth-mtls'
  | 'openwop-discovery-auth-scoped'
  | 'openwop-interrupt-quorum'
  | 'openwop-interrupt-auth-required'
  | 'openwop-interrupt-external-event'
  | 'openwop-interrupt-cascade-cancel'
  | 'openwop-production';

/** Rotation advertisement shape per auth-profiles.md §"openwop-auth-api-key-rotation". */
export interface AuthRotationCapability {
  supported: true;
  minGraceSeconds: number;
}

/** Auth-scoped discovery advertisement per RFC 0011 §A. */
export interface DiscoveryAuthScopedCapability {
  supported: true;
  mode: 'same-endpoint';
}

/**
 * Thrown when the server returns a non-2xx response. Carries the original
 * status, parsed error envelope (if available), the raw response text,
 * and any `traceparent` the server returned (per
 * `observability.md` §Trace context propagation —
 * "Clients SHOULD display the trace ID in error messages so operators
 * can search backend traces").
 */
export class WopError extends Error {
  readonly status: number;
  readonly envelope: ErrorEnvelope | undefined;
  readonly rawText: string;
  /** W3C `traceparent` from the response headers, when present. */
  readonly traceparent: string | undefined;
  /** 32-hex-char trace ID extracted from `traceparent`, when parseable. */
  readonly traceId: string | undefined;

  constructor(
    status: number,
    rawText: string,
    envelope: ErrorEnvelope | undefined,
    traceparent: string | undefined,
  ) {
    const traceId = traceparent ? extractTraceId(traceparent) : undefined;
    const baseMessage = envelope?.message ?? `openwop request failed: HTTP ${status}`;
    const messageWithTrace = traceId ? `${baseMessage} (trace=${traceId})` : baseMessage;
    super(messageWithTrace);
    this.name = 'WopError';
    this.status = status;
    this.rawText = rawText;
    this.envelope = envelope;
    this.traceparent = traceparent;
    this.traceId = traceId;
  }
}

/**
 * Extract the 32-hex trace ID from a W3C traceparent header. Format:
 * `00-<32-hex>-<16-hex>-<2-hex>`. Returns undefined for malformed
 * input — never throws (errors during error construction would be
 * truly miserable).
 */
function extractTraceId(traceparent: string): string | undefined {
  const parts = traceparent.split('-');
  if (parts.length < 3) return undefined;
  const traceId = parts[1];
  if (!traceId || !/^[0-9a-f]{32}$/i.test(traceId)) return undefined;
  return traceId;
}

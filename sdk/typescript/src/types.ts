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

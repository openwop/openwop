/**
 * @openwop/openwop — TypeScript reference SDK for OpenWOP-compliant servers.
 *
 * Public surface:
 *   - OpenwopClient (auth + endpoint methods)
 *   - WopError (typed error wrapping ErrorEnvelope)
 *   - All request/response types mirroring the OpenAPI spec
 *   - streamEvents helper for advanced SSE use cases
 *
 * See README.md for usage examples.
 */

export { OpenwopClient } from './client.js';
export type { OpenwopClientOptions, MutationOptions } from './client.js';
export { WopError } from './types.js';
export type {
  AuditVerifyAnomaly,
  AuditVerifyCheckpoint,
  AuditVerifyResult,
  BulkCancelRunResult,
  BulkCancelRunsRequest,
  BulkCancelRunsResponse,
  Capabilities,
  CancelRunRequest,
  CancelRunResponse,
  CreateRunRequest,
  CreateRunResponse,
  ErrorEnvelope,
  ForkRunRequest,
  ForkRunResponse,
  DebugBundle,
  DebugBundleOptions,
  RegisterWebhookRequest,
  RegisterWebhookResponse,
  InterruptByTokenInspection,
  PauseRunRequest,
  PauseRunResponse,
  PollEventsResponse,
  ResolveInterruptByTokenResponse,
  ResolveInterruptRequest,
  ResolveInterruptResponse,
  ResumeRunRequest,
  ResumeRunResponse,
  RunConfigurable,
  RunDiffEventDiff,
  RunDiffResponse,
  RunEventDoc,
  RunSnapshot,
  RunStatus,
  StreamMode,
  TypedRunEvent,
  // RFC 0059 — agent workspace (spec/v1/agent-workspace.md)
  WorkspaceFile,
  PutWorkspaceFileRequest,
  AgentReasonedPayload,
  AgentReasoningDeltaPayload,
  AgentToolCalledPayload,
  AgentToolReturnedPayload,
  AgentHandoffPayload,
  AgentDecidedPayload,
  MemoryWrittenPayload,
  // RFC 0027 + RFC 0028 — Prompt library (spec/v1/prompts.md)
  GetPromptRequest,
  ListPromptsRequest,
  ListPromptsResponse,
  PromptKind,
  PromptRef,
  PromptTemplate,
  PromptVariable,
  RenderPromptRequest,
  RenderPromptResponse,
} from './types.js';
export { streamEvents } from './sse.js';
export type { EventsStreamContext, EventsStreamOptions } from './sse.js';

// RFC 0002 + RFC 0024 typed event helpers — type guards over `RunEventDoc`
// plus a high-level streaming-reasoning subscription helper.
export {
  isAgentReasoned,
  isAgentReasoningDelta,
  isAgentToolCalled,
  isAgentToolReturned,
  isAgentHandoff,
  isAgentDecided,
  isMemoryWritten,
  subscribeToAgentReasoning,
} from './event-helpers.js';
export type {
  AgentReasoningCallbacks,
  Unsubscribe,
} from './event-helpers.js';

// Run-status + run-error helpers (added in 1). Forward-compat predicates
// over the wire-format unions declared above; full design + rationale in
// `run-helpers.ts`.
export {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  HTTP_ERROR_CODES,
  isHttpErrorCode,
  RUN_ERROR_CODES,
  isRunErrorCode,
} from './run-helpers.js';
export type {
  ActiveRunStatus,
  TerminalRunStatus,
  HttpErrorCode,
  RunErrorCode,
  RunError,
} from './run-helpers.js';

// Cost-attribution allowlist + sanitizer helpers
// (`spec/v1/observability.md §"Cost attribution attributes"`). Single
// source of truth for the canonical attribute names so independent
// hosts share one list instead of each re-deriving it.
export {
  OPENWOP_COST_ATTRIBUTE_NAMES,
  sanitizeCostAttributes,
} from './cost-attribution.js';
export type { OpenwopCostAttributeName } from './cost-attribution.js';

// Webhook-delivery verification helpers (SDK-3 close-out 2026-05-15).
// HMAC-SHA256 + timestamp freshness window verification per
// spec/v1/webhooks.md §"Signature recipe". Receivers MUST verify both
// the HMAC AND the timestamp to defeat replay attacks.
export {
  DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS,
  verifyWebhookSignature,
  signWebhookDelivery,
} from './webhook-helpers.js';
export type {
  VerifyWebhookSignatureOptions,
  VerifyWebhookOutcome,
} from './webhook-helpers.js';

// Public-registry read helpers (SDK-5 close-out 2026-05-15). Read-only
// typed client for the public node-pack registry at packs.openwop.dev
// per spec/v1/registry-operations.md.
export { RegistryClient } from './registry-helpers.js';
export type {
  RegistryClientOptions,
  RegistryDiscovery,
  RegistryIndex,
  RegistryIndexEntry,
  RegistryPackMetadata,
  RegistryVersionManifest,
} from './registry-helpers.js';

// AI Envelope types (DRAFT v1.x — spec/v1/ai-envelope.md). Inbound LLM-emission
// envelope, distinct from RunEventDoc (outbound) and ErrorEnvelope (host HTTP).
export type {
  AIEnvelope,
  AIEnvelopeErrorPayload,
  ClarificationRequestPayload,
  EnvelopeContract,
  EnvelopeContractRefusal,
  EnvelopeContractsCapability,
  EnvelopeMeta,
  EnvelopeOutcome,
  EnvelopeStrictness,
  PartialInfo,
  SchemaRequestPayload,
  SchemaResponsePayload,
  ValidationDetail,
} from './types.js';

// RFC 0030 §A `reasoning` field prompt-directive helper. Hosts that
// advertise `capabilities.envelopes.reasoning.supported: true` use this
// to synthesize the system-prompt fragment that instructs the model to
// populate the OPTIONAL `reasoning` field. See `envelope-directive.ts`
// for the operational note on `"mandatory"` strength (provider-side
// refusal risk per the 2026-05-21 RFC 0030 amendment).
export { buildReasoningDirective } from './envelope-directive.js';
export type { ReasoningDirectiveStrength } from './envelope-directive.js';

// RFC 0032 §B.3 + RFC 0033 §D refusal detection helper. Normalizes
// per-provider safety-stop signals (Anthropic `stop_reason: "refusal"`,
// OpenAI `message.refusal` + `finish_reason: "content_filter"`, Gemini
// `finishReason: "SAFETY"` + `promptFeedback.blockReason: "SAFETY"`)
// to a canonical `{ refusalText, safetyCategory?, provider }` shape.
// Hosts route the non-null return through `envelope.refusal` emission
// + the `envelope_refusal` terminal error code (RFC 0033 §F).
// **SECURITY:** Pass `refusalText` through the BYOK redaction harness
// BEFORE persistence — this helper does NOT redact.
export { parseRefusal } from './parse-refusal.js';
export type { RefusalProvider, RefusalSignal } from './parse-refusal.js';

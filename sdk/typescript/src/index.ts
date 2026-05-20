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
  RunEventDoc,
  RunSnapshot,
  RunStatus,
  StreamMode,
  TypedRunEvent,
  AgentReasonedPayload,
  AgentReasoningDeltaPayload,
  AgentToolCalledPayload,
  AgentToolReturnedPayload,
  AgentHandoffPayload,
  AgentDecidedPayload,
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

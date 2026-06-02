/**
 * Internal types shared across the workflow-engine sample backend.
 *
 * Wire-shape types (CreateRunRequest, RunSnapshot, RunEventDoc, etc.)
 * come from `@openwop/openwop`. This module adds the host-internal
 * shapes — Principal, RunRecord, EventRecord, InterruptRecord — that
 * the storage adapters and route handlers pass between themselves.
 */

import type {
  CreateRunRequest,
  ErrorEnvelope,
  RunStatus,
  StreamMode,
} from '@openwop/openwop';

export type { CreateRunRequest, ErrorEnvelope, RunStatus, StreamMode };

/** Synthetic principal returned by the stub auth middleware. */
export interface Principal {
  /** Opaque principal identifier (Bearer-token claim or stub-derived). */
  principalId: string;
  /** Tenants this principal may operate under. Empty array = no access. */
  tenants: readonly string[];
  /** Bearer token presented (sample only — never log in production). */
  token: string;
}

/** Persisted run record. Wire shape derives from this via projection. */
export interface RunRecord {
  runId: string;
  workflowId: string;
  tenantId: string;
  scopeId?: string;
  status: RunStatus;
  inputs: unknown;
  metadata: Record<string, unknown>;
  configurable: Record<string, unknown>;
  callbackUrl?: string;
  idempotencyKey?: string;
  parentRunId?: string;
  parentSeq?: number;
  forkMode?: 'replay' | 'branch';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: { code: string; message: string };
  /** Current node, when in a running/waiting state. */
  currentNodeId?: string;
  /** Serialized DAG scheduler snapshot — populated when the run pauses on
   *  one or more suspended branches. JSON-encoded `SerializedSnapshot`
   *  (see executor/executor.ts). Absent for non-DAG (legacy linear) runs. */
  schedulerSnapshot?: string;
  /** RFC 0040 / RFC 0083 §C-3 — optional id of the event/delivery that caused
   *  this run. When set, it is stamped as `run.started`'s `causationId` so
   *  `/ancestry` resolves the cause → run (e.g. a trigger delivery → run). */
  causationId?: string;
  /** Multi-instance dispatch lease. Set by `executeRun` at start to the
   *  instance id that is executing the run; the lease (`dispatchLeaseExpiresAt`,
   *  epoch ms) outlives the max legal runtime, so an alive run is never
   *  re-dispatched. The `runDispatchSweeper` re-dispatches `pending`/`running`
   *  runs whose lease has expired (the owning instance crashed). Cleared
   *  implicitly: terminal/`waiting-*` status excludes a run from the sweep. */
  dispatchOwner?: string | null;
  dispatchLeaseExpiresAt?: number | null;
}

/** Persisted run event with monotonic sequence per run. */
export interface EventRecord {
  eventId: string;
  runId: string;
  sequence: number;
  type: string;
  nodeId?: string;
  payload: unknown;
  timestamp: string;
  causationId?: string;
}

/** Persisted RFC 0056 annotation (a per-run side-resource — NOT a replayable
 *  event-log entry). `correction`/`note` are stored already secret-redacted. */
export interface AnnotationRecord {
  annotationId: string;
  runId: string;
  tenantId: string;
  /** Full annotation document (annotation.schema.json shape), redacted. */
  payload: unknown;
  createdAt: string;
}

/** Persisted interrupt awaiting resolution. */
export interface InterruptRecord {
  interruptId: string;
  runId: string;
  nodeId: string;
  kind: 'approval' | 'clarification' | 'refinement' | 'cancellation' | 'external-event';
  /** Signed token usable via POST /v1/interrupts/{token}. */
  token: string;
  data: unknown;
  resumeSchema?: Record<string, unknown>;
  createdAt: string;
  /** Set when resolved. */
  resolvedAt?: string;
  resolvedValue?: unknown;
}

/** Persisted webhook subscription. */
export interface WebhookSubscriptionRecord {
  subscriptionId: string;
  url: string;
  events: readonly string[];
  tags?: readonly string[];
  /** HMAC-SHA256 secret. Stored in plaintext in this sample (use KMS in production). */
  secret: string;
  createdAt: string;
}

/**
 * Durable webhook-delivery queue row. Each subscription that matches an emitted
 * event gets one row; the background worker (`webhookWorker.ts`) claims due
 * rows, POSTs the signed delivery, and either marks it `delivered` or reschedules
 * it with exponential backoff until `maxAttempts` is reached (then `dead`).
 *
 * The claim lease (`claimedBy` + `claimExpiresAt`) makes the queue
 * multi-instance-safe: a crashed worker's lease expires and another instance
 * re-claims the row, so deliveries survive a process crash rather than being
 * dropped (the prior `setImmediate` fire-and-forget path lost them).
 */
export interface WebhookDeliveryRecord {
  deliveryId: string;
  subscriptionId: string;
  url: string;
  /** HMAC-SHA256 secret captured at enqueue time (the subscription may be deleted before delivery). */
  secret: string;
  eventType: string;
  /** The exact JSON body to POST (a serialized EventRecord). */
  payload: string;
  status: 'pending' | 'delivered' | 'dead';
  attempts: number;
  maxAttempts: number;
  /** Epoch ms; a row is due when `status === 'pending'` AND `nextAttemptAt <= now`. */
  nextAttemptAt: number;
  /** Claim lease: worker id + expiry (epoch ms). A due row whose lease is absent or expired is re-claimable. */
  claimedBy?: string | null;
  claimExpiresAt?: number | null;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Idempotency key replay entry. */
export interface IdempotencyRecord {
  key: string;
  responseBody: string;
  responseStatus: number;
  createdAt: string;
}

/** Persisted chat-session header. Mirrors the FE `ChatSession` minus
 *  the messages array (kept in a separate table for unbounded growth +
 *  paged loads). Tied to a tenantId so the sample-extension routes
 *  can scope listings by tenant. Sample-grade: no per-user concept;
 *  all sessions for a tenant are visible to that tenant's principal. */
export interface ChatSessionRecord {
  sessionId: string;
  tenantId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Cached count; updated on append/reset. Sample-grade — caller-
   *  authoritative count is `listChatSessionMessages(sessionId).length`. */
  messageCount: number;
}

/** One message inside a chat session. Content is a JSON string (the
 *  FE's ChatMessage shape carries multimodal content, thoughts, agent
 *  events, citations, etc. — we don't shred them into columns). */
export interface ChatMessageRecord {
  messageId: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'workflow_run';
  /** Serialized ChatMessage minus the id (the id is on this row). */
  content: string;
  /** Serialized meta (provider, model, tokens, error, citations, etc.)
   *  — null when the bubble has no meta (user turns, system banners). */
  meta: string | null;
  createdAt: string;
}

/** Run-create request augmented with the resolved principal. */
export interface InternalCreateRunRequest extends CreateRunRequest {
  workflowId: string;
  tenantId: string;
}

/**
 * Notification surface (PR #143).
 *
 * Persisted per-tenant inbox of action-needed signals. Each row is one
 * notification. The wire shape mirrors this almost exactly, modulo the
 * snake_case → camelCase translation done by the row mapper.
 *
 * `type` is a dotted-namespace string. Today's emitters use:
 *   - `workflow.approval_needed` — HITL interrupt opened (action: resume the run)
 *   - `workflow.input_needed`    — clarification/refinement interrupt
 *   - `workflow.failed`          — run terminated with an error
 *   - `system.alert`             — operator-level signal
 *
 * The set is open — clients render unknown types via a generic shape.
 */
export type NotificationType =
  | 'workflow.approval_needed'
  | 'workflow.input_needed'
  | 'workflow.failed'
  | 'workflow.completed'
  | 'system.alert';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type NotificationStatus = 'unread' | 'read' | 'archived';

export interface NotificationRecord {
  notificationId: string;
  tenantId: string;
  type: NotificationType | string;
  priority: NotificationPriority;
  status: NotificationStatus;
  title: string;
  message: string;
  /** Workflow-run pointer when the notification is run-scoped. */
  runId?: string;
  workflowId?: string;
  nodeId?: string;
  interruptId?: string;
  /** SPA deep-link the notification clicks through to. */
  actionUrl?: string;
  /** Arbitrary per-type payload — kind, resumeSchema digest, etc. */
  metadata?: Record<string, unknown>;
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
}

/**
 * Web Push subscription record (RFC 8030). One row per browser/device
 * per tenant — a user with two laptops + a phone produces three rows.
 *
 * `endpoint` + `p256dhKey` + `authKey` are the three opaque values the
 * browser handed us at subscribe time. The `web-push` library uses all
 * three to encrypt the payload before delivering to the user agent.
 * Treated like credentials: anyone with all three can push to that
 * browser, so we serve them only over auth'd routes and never log
 * verbatim.
 */
export interface PushSubscriptionRecord {
  subscriptionId: string;
  tenantId: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  userAgent?: string;
  createdAt: string;
  lastUsedAt?: string;
}

/**
 * User-authored agent record (phase E1, 2026-05-28).
 *
 * Persisted shape backing `POST /v1/host/sample/agents`. On boot the
 * app reads every row and registers it with the in-process
 * `AgentRegistry` (RFC 0070); the existing `GET /v1/agents` /
 * `/v1/agents/:agentId` inventory routes then project both
 * pack-installed and user-authored agents through the same surface.
 *
 * `agentId` shape: `user.<tenantId>.<personaSlug>` — the `user.`
 * prefix avoids collision with pack ids (always begin with the pack
 * name). Per-tenant scoping means `user.acme.code-reviewer` and
 * `user.beta.code-reviewer` can coexist.
 */
export interface UserAgentRecord {
  agentId: string;
  tenantId: string;
  persona: string;
  label?: string;
  description?: string;
  modelClass: string;
  systemPrompt: string;
  toolAllowlist: string[];
  memoryShape: {
    scratchpad: boolean;
    conversation: boolean;
    longTerm: boolean;
  };
  confidenceThreshold?: number;
  createdAt: string;
}

/**
 * Canonical openwop error codes used inside the sample. Wire shape is
 * `ErrorEnvelope`; the route handlers map host-internal exceptions to
 * these codes via `mapErrorToEnvelope()`.
 */
export type OpenwopErrorCode =
  | 'invalid_request'
  | 'validation_error'
  | 'unauthenticated'
  | 'forbidden'
  | 'forbidden_tenant'
  | 'forbidden_scope'
  | 'not_found'
  | 'workflow_not_found'
  | 'run_not_found'
  | 'interrupt_not_found'
  | 'interrupt_already_resolved'
  | 'interrupt_gone'
  | 'invalid_interrupt_token'
  | 'idempotency_key_conflict'
  | 'idempotency_key_replay_mismatch'
  | 'host_capability_missing'
  | 'capability_not_provided'
  | 'credential_required'
  | 'credential_forbidden'
  | 'credential_unavailable'
  // Managed-provider preflight in POST /v1/runs (routes/runs.ts): an
  // anon caller submitting a workflow that pins any node to a
  // `managed:*` credentialRef. Same code the managed dispatch path
  // emits at chat-node execution time, just surfaced earlier.
  | 'sign_in_required'
  | 'fork_invalid_seq'
  | 'fork_unsupported_mode'
  | 'rate_limited'
  | 'unsupported_stream_mode'
  | 'internal_error'
  // Pack-registry codes per spec/v1/node-packs.md §"Registry HTTP API"
  | 'invalid_pack_name'
  | 'invalid_pack_scope'
  | 'invalid_version'
  | 'invalid_body'
  | 'pack_not_found'
  | 'signature_not_available'
  // RFC 0025 — additional publish-error codes surfaced by the
  // test-mode mirror namespace `/v1/packs-test/*` (mirror of the
  // production publish surface). The full 19-code catalog is also
  // documented at node-packs.md §"PUT /v1/packs/{name}/-/{version}.tgz".
  | 'tarball_gunzip_failed'
  | 'tarball_too_large'
  | 'tarball_manifest_missing'
  | 'tarball_manifest_too_large'
  | 'tarball_manifest_not_json'
  | 'tarball_entry_missing'
  | 'tarball_entry_too_large'
  | 'tarball_path_traversal'
  | 'tarball_tar_parse_failed'
  | 'invalid_manifest'
  | 'manifest_mismatch'
  | 'manifest_name_mismatch'
  | 'manifest_version_mismatch'
  | 'pack_integrity_failure'
  | 'unsupported_runtime'
  | 'conflict'
  | 'version_conflict'
  | 'unpublish_window_expired'
  // Webhook codes per spec/v1/webhooks.md
  | 'webhook_url_rejected'
  | 'subscription_not_found';

export class OpenwopError extends Error {
  constructor(
    public readonly code: OpenwopErrorCode,
    message: string,
    public readonly httpStatus: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OpenwopError';
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

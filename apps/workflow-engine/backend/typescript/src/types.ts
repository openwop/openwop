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

/** Persisted interrupt awaiting resolution. */
export interface InterruptRecord {
  interruptId: string;
  runId: string;
  nodeId: string;
  kind: 'approval' | 'clarification' | 'refinement' | 'cancellation';
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

/** Idempotency key replay entry. */
export interface IdempotencyRecord {
  key: string;
  responseBody: string;
  responseStatus: number;
  createdAt: string;
}

/** Run-create request augmented with the resolved principal. */
export interface InternalCreateRunRequest extends CreateRunRequest {
  workflowId: string;
  tenantId: string;
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
  | 'invalid_interrupt_token'
  | 'idempotency_key_conflict'
  | 'idempotency_key_replay_mismatch'
  | 'host_capability_missing'
  | 'capability_not_provided'
  | 'credential_required'
  | 'credential_forbidden'
  | 'credential_unavailable'
  | 'fork_invalid_seq'
  | 'fork_unsupported_mode'
  | 'rate_limited'
  | 'internal_error'
  // Pack-registry codes per spec/v1/node-packs.md §"Registry HTTP API"
  | 'invalid_pack_name'
  | 'invalid_version'
  | 'pack_not_found'
  | 'signature_not_available'
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

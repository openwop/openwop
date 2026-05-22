"""
Request/response types mirroring the OpenAPI 3.1 spec
(`api/openapi.yaml`) and JSON Schemas
(`schemas/`).

Hand-authored rather than codegen'd — see SDK README §rationale.
String-typed enums (Literal aliases) for fields whose spec'd values
may grow over time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# ── Type aliases ────────────────────────────────────────────────────────

RunStatus = Literal[
    "pending",
    "running",
    "paused",
    "waiting-approval",
    "waiting-input",
    "completed",
    "failed",
    "cancelled",
]
"""Run statuses per `RunSnapshot.status` in OpenAPI."""

StreamMode = Literal["values", "updates", "messages", "debug"]


# ── Capabilities ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CapabilitiesLimits:
    clarificationRounds: int
    schemaRounds: int
    envelopesPerTurn: int
    maxNodeExecutions: int | None = None


@dataclass(frozen=True)
class Capabilities:
    protocolVersion: str
    supportedEnvelopes: list[str]
    schemaVersions: dict[str, int]
    limits: CapabilitiesLimits
    extensions: dict[str, Any] | None = None
    # Network-handshake superset (all (future) per capabilities.md)
    implementation: dict[str, Any] | None = None
    engineVersion: int | None = None
    eventLogSchemaVersion: int | None = None
    supportedTransports: list[str] | None = None
    configurable: dict[str, Any] | None = None
    observability: dict[str, Any] | None = None
    minClientVersion: str | None = None


# ── RunSnapshot ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class RunSnapshotError:
    code: str
    message: str
    details: dict[str, Any] | None = None


@dataclass(frozen=True)
class RunSnapshot:
    runId: str
    workflowId: str
    status: RunStatus
    currentNodeId: str | None = None
    startedAt: str | None = None
    completedAt: str | None = None
    nodeStates: dict[str, Any] | None = None
    variables: dict[str, Any] | None = None
    channels: dict[str, Any] | None = None
    error: RunSnapshotError | None = None
    engineVersion: str | None = None
    eventLogSchemaVersion: int | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    configurable: dict[str, Any] | None = None


# ── RunOptions / configurable ───────────────────────────────────────────

@dataclass
class RunConfigurable:
    """Per-run parameter overlay carried in `RunOptions.configurable`.

    Reserved keys are typed; unknown keys are passed through verbatim
    via `extras`. See `run-options.md`.
    """

    recursionLimit: int | None = None
    model: str | None = None
    temperature: float | None = None
    maxTokens: int | None = None
    promptOverrides: dict[str, str] | None = None
    extras: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.recursionLimit is not None:
            out["recursionLimit"] = self.recursionLimit
        if self.model is not None:
            out["model"] = self.model
        if self.temperature is not None:
            out["temperature"] = self.temperature
        if self.maxTokens is not None:
            out["maxTokens"] = self.maxTokens
        if self.promptOverrides is not None:
            out["promptOverrides"] = dict(self.promptOverrides)
        out.update(self.extras)
        return out


# ── Run lifecycle requests/responses ────────────────────────────────────

@dataclass
class CreateRunRequest:
    workflowId: str
    inputs: dict[str, Any] | None = None
    tenantId: str | None = None
    scopeId: str | None = None
    callbackUrl: str | None = None
    configurable: RunConfigurable | dict[str, Any] | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class CreateRunResponse:
    runId: str
    status: RunStatus
    eventsUrl: str
    statusUrl: str | None = None


@dataclass
class CancelRunRequest:
    reason: str | None = None


@dataclass(frozen=True)
class CancelRunResponse:
    runId: str
    status: Literal["cancelled", "cancelling"]


@dataclass
class PauseRunRequest:
    reason: str | None = None
    drainPolicy: Literal["immediate", "drain-current-node"] | None = None


@dataclass(frozen=True)
class PauseRunResponse:
    runId: str
    status: Literal["paused"]
    pausedAt: str | None = None


@dataclass
class ResumeRunRequest:
    reason: str | None = None


@dataclass(frozen=True)
class ResumeRunResponse:
    runId: str
    status: Literal["running"]
    resumedAt: str | None = None


# spec/v1/webhooks.md — webhook subscription register / unregister.
@dataclass
class RegisterWebhookRequest:
    url: str
    events: list[str]
    secret: str | None = None
    tags: list[str] | None = None


@dataclass(frozen=True)
class RegisterWebhookResponse:
    """Response from POST /v1/webhooks.

    The ``secret`` field is returned ONCE on registration — store it
    server-side for HMAC verification. The host cannot recover it.
    """

    subscriptionId: str
    url: str
    secret: str
    eventTypes: list[str]
    createdAt: str


# spec/v1/debug-bundle.md — portable JSON diagnostic export.
@dataclass(frozen=True)
class DebugBundle:
    """Portable JSON export of a single run's diagnostic state.

    Hosts MAY omit non-required fields. Consumers MUST treat masked /
    omitted / hashed values as the spec-canonical content per
    ``redactionMode`` — they are NOT placeholders for missing data.
    """

    bundleVersion: str
    generatedAt: str
    host: dict[str, Any]
    run: dict[str, Any]
    events: list[dict[str, Any]]
    redactionApplied: bool
    redactionMode: Literal["mask", "omit", "hash", "passthrough"]
    truncated: bool | None = None
    truncatedReason: str | None = None


# rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1).
@dataclass
class BulkCancelRunsRequest:
    runIds: list[str]
    reason: str | None = None


@dataclass(frozen=True)
class BulkCancelRunResult:
    runId: str
    ok: bool
    status: Literal["cancelled", "cancelling"] | None = None
    error: dict[str, Any] | None = None


@dataclass(frozen=True)
class BulkCancelRunsResponse:
    results: list[BulkCancelRunResult]


# auth-profiles.md §"openwop-audit-log-integrity" §4 — verify endpoint.
@dataclass(frozen=True)
class AuditVerifyCheckpoint:
    checkpoint: str
    atSequence: int
    merkleRoot: str
    signature: str


@dataclass(frozen=True)
class AuditVerifyAnomaly:
    atSeq: int
    expectedPrevHash: str
    actualPrevHash: str


@dataclass(frozen=True)
class AuditVerifyResult:
    fromSeq: int
    toSeq: int
    chainValid: bool
    checkpoints: list[AuditVerifyCheckpoint]
    anomalies: list[AuditVerifyAnomaly]
    checkpointsValid: bool | None = None


@dataclass
class ForkRunRequest:
    fromSeq: int
    mode: Literal["replay", "branch"]
    runOptionsOverlay: dict[str, Any] | None = None


@dataclass(frozen=True)
class ForkRunResponse:
    runId: str
    sourceRunId: str
    mode: Literal["replay", "branch"]
    status: RunStatus
    eventsUrl: str
    fromSeq: int | None = None


# ── RFC 0040 Phase 3 cross-host causation ───────────────────────────────


@dataclass(frozen=True)
class RunAncestryParent:
    runId: str
    hostId: str
    cause: Literal["mcp-tool-call", "a2a-message", "core.subWorkflow", "core.dispatch"]
    wellKnownUrl: str | None = None


@dataclass(frozen=True)
class RunAncestryResponse:
    """RFC 0040 §C response shape — `GET /v1/runs/{runId}/ancestry`.

    `parent: None` for top-level runs (not dispatched from any other run);
    when set, `parent.wellKnownUrl` identifies the parent host's discovery
    doc URL so callers walk the chain across hosts one hop at a time.
    Capability-gated on
    `capabilities.multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported`.
    """

    runId: str
    hostId: str
    parent: RunAncestryParent | None


# ── HITL ────────────────────────────────────────────────────────────────

@dataclass
class ResolveInterruptRequest:
    resumeValue: Any


@dataclass(frozen=True)
class ResolveInterruptResponse:
    runId: str
    nodeId: str
    status: RunStatus


@dataclass(frozen=True)
class InterruptByTokenInspection:
    """Mirror of `suspend-request.schema.json` (InterruptPayload)."""

    kind: Literal["approval", "clarification", "external-event", "custom"]
    key: str
    data: Any
    resumeSchema: dict[str, Any] | None = None
    timeoutMs: int | None = None


# ── Events / poll ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class RunEventDoc:
    """Mirror of `run-event.schema.json` — top-level shape only.

    Per-event payload schemas live in `run-event-payloads.schema.json`;
    the SDK keeps `payload` as `Any` for forward-compat (consumers that
    want strict per-event validation should layer the payloads schema
    via Ajv/jsonschema themselves).
    """

    eventId: str
    runId: str
    type: str
    payload: Any
    timestamp: str
    sequence: int
    nodeId: str | None = None
    schemaVersion: int | None = None
    engineVersion: str | None = None
    causationId: str | None = None


@dataclass(frozen=True)
class PollEventsResponse:
    events: list[RunEventDoc]
    isComplete: bool


# ── Error envelope ──────────────────────────────────────────────────────

HTTP_ERROR_CODES = frozenset(
    {
        # Auth / access
        "unauthenticated",
        "forbidden",
        "key_expired",
        "key_revoked",
        # Request / routing
        "validation_error",
        "not_found",
        "rate_limited",
        # Idempotency / run creation conflicts
        "run_already_active",
        "idempotency_in_flight",
        "idempotency_key_mismatch",
        # Streaming / protocol negotiation
        "unsupported_stream_mode",
        "force_engine_version_forbidden",
        "mock_provider_forbidden",
        # Capability / credential negotiation
        "capability_not_provided",
        "capability_required",
        "credential_required",
        "credential_forbidden",
        "credential_unavailable",
        # Node-pack lifecycle (registry + lockfile)
        "pack_integrity_mismatch",
        "pack_signature_invalid",
        "pack_peer_dependency_missing",
        "pack_lockfile_incomplete",
        "pack_version_not_found",
        # HITL / interrupt callbacks
        "interrupt_not_found",
        "approval_token_invalid",
        "approval_token_expired",
        "approval_token_consumed",
        # Phase H.1″ — AI provider policy enforcement.
        "provider_policy_denied",
        # Phase H.2 — MCP client.
        "mcp_server_not_configured",
        "mcp_timeout",
        "mcp_network_error",
        "mcp_server_error",
        "mcp_protocol_error",
        "mcp_tool_error",
        # Phase H.3 — HTTP client.
        "http_url_rejected",
        "http_timeout",
        "http_network_error",
        "http_unexpected_status",
        # Phase H webhook codes (spec-de-facto).
        "webhook_url_rejected",
        "subscription_not_found",
        # Generic server failure
        "internal_error",
    }
)
"""Canonical REST/MCP `ErrorEnvelope.error` codes for common branching."""


def is_http_error_code(value: object) -> bool:
    """Return True when *value* is a known canonical HTTP error code."""

    return isinstance(value, str) and value in HTTP_ERROR_CODES


@dataclass(frozen=True)
class ErrorEnvelope:
    error: str
    message: str
    details: dict[str, Any] | None = None


# ─── Run statuses (forward-compatible) ────────────────────────────────────

ACTIVE_RUN_STATUSES: frozenset[str] = frozenset(
    {
        "pending",
        "running",
        "paused",
        "waiting-approval",
        "waiting-input",
    }
)
"""Run statuses considered active — the run MAY still transition.

Hosts MAY emit additional terminal values per the schema's forward-compat
clause (e.g., ``timed-out``, ``interrupted``); readers MUST treat unknown
statuses as terminal-unknown, NOT as still-active. Match the TypeScript
SDK's ``ACTIVE_RUN_STATUSES`` constant + ``isTerminalRunStatus`` predicate.
"""

TERMINAL_RUN_STATUSES: frozenset[str] = frozenset(
    {
        "completed",
        "failed",
        "cancelled",
    }
)
"""Spec-known terminal statuses. Hosts MAY emit additional terminal values;
use :func:`is_terminal_run_status` for forward-compat checks instead of
literal-set membership.
"""


def is_terminal_run_status(status: str) -> bool:
    """Return True when ``status`` indicates the run will not transition further.

    Implemented as a negative check against :data:`ACTIVE_RUN_STATUSES` — any
    value NOT in the spec's known-active set is treated as terminal. This
    implements the schema's forward-compat clause; the alternative (positive
    check against :data:`TERMINAL_RUN_STATUSES`) would loop polling forever
    on any unknown value.
    """

    return isinstance(status, str) and status not in ACTIVE_RUN_STATUSES


# ─── Run-document error codes ─────────────────────────────────────────────

RUN_ERROR_CODES: frozenset[str] = frozenset(
    {
        # Authorization / access
        "auth_required",
        "forbidden",
        "workspace_not_found",
        # Run-state conflicts
        "run_already_active",
        "run_not_found",
        "run_terminal",
        "engine_version_mismatch",
        # Validation
        "invalid_workflow_definition",
        "invalid_trigger_input",
        "node_type_not_found",
        "config_validation_failed",
        # Quota / budget
        "token_budget_exceeded",
        "concurrent_run_limit_reached",
        "rate_limited",
        # Execution
        "node_timeout",
        "global_timeout",
        "node_execution_failed",
        "external_call_failed",
        "recursion_limit_exceeded",
        "capability_not_provided",
        # Approval
        "approval_timeout",
        "approval_token_invalid",
        "approval_token_expired",
        "approval_token_consumed",
        # Persistence
        "persistence_failed",
        "doc_budget_exceeded",
    }
)
"""Run-document error codes — stable identifiers used in
``RunSnapshot.error.code`` when a run reaches ``failed``. Distinct from
:data:`HTTP_ERROR_CODES` (which describe HTTP-level request failures).
Matches the TypeScript SDK's ``RUN_ERROR_CODES`` constant.
"""


def is_run_error_code(value: object) -> bool:
    """Return True when ``value`` is a known canonical run-document error code."""

    return isinstance(value, str) and value in RUN_ERROR_CODES

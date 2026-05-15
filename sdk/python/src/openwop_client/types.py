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

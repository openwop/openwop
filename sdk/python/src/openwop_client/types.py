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
    # RFC 0058 run-execution bounds.
    maxRunDurationMs: int | None = None
    maxLoopIterations: int | None = None


# The `kind` discriminator on a `cap.breached` payload
# (run-event-payloads.schema.json#capBreached): four engine kinds + RFC 0008 §K
# wasm-* runtime caps + RFC 0058 run-scoped bounds.
CapBreachedKind = Literal[
    "clarification",
    "schema",
    "envelopes",
    "node-executions",
    "wasm-memory",
    "wasm-fuel",
    "wasm-execution-time",
    "run-duration",
    "loop-iterations",
]


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
    runTimeoutMs: int | None = None  # RFC 0058
    maxLoopIterations: int | None = None  # RFC 0058
    model: str | None = None
    temperature: float | None = None
    maxTokens: int | None = None
    promptOverrides: dict[str, str] | None = None
    extras: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.recursionLimit is not None:
            out["recursionLimit"] = self.recursionLimit
        if self.runTimeoutMs is not None:
            out["runTimeoutMs"] = self.runTimeoutMs
        if self.maxLoopIterations is not None:
            out["maxLoopIterations"] = self.maxLoopIterations
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


# ── RFC 0056 run feedback / annotations ─────────────────────────────────


@dataclass(frozen=True)
class Annotation:
    """RFC 0056 persisted annotation (``annotation.schema.json``). A side-
    resource — not a replayable run-event-log entry. ``signal`` is a dict
    discriminated by ``kind`` (rating / correction / label / flag)."""

    annotationId: str
    target: dict[str, str]
    signal: dict[str, Any]
    actor: dict[str, str]
    createdAt: str
    note: str | None = None


@dataclass(frozen=True)
class CreateAnnotationRequest:
    """Request body for ``create_annotation`` (``annotation-create.schema.json``).
    The host assigns ``annotationId`` / ``createdAt`` / ``actor`` and binds
    ``target.runId``; the client supplies only the signal (+ optional anchor
    and note)."""

    signal: dict[str, Any]
    target: dict[str, str] | None = None
    note: str | None = None


# ── RFC 0059 agent workspace ────────────────────────────────────────────


@dataclass(frozen=True)
class WorkspaceFile:
    """RFC 0059 versioned, tenant·workspace-scoped ground-truth file
    (``workspace-file.schema.json``). The ``list`` endpoint returns this shape
    minus ``content`` (metadata only)."""

    path: str
    content: str
    version: int
    updatedAt: str
    contentType: str | None = None
    etag: str | None = None


@dataclass(frozen=True)
class PutWorkspaceFileRequest:
    """Request body for ``put_workspace_file`` (``workspace-file-create.schema.json``).
    ``path`` is URL-bound; the host assigns ``version`` / ``etag`` / ``updatedAt``.
    Optimistic concurrency is expressed via the ``If-Match`` header, not the body."""

    content: str
    contentType: str | None = None


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
        "run_timeout",
        "loop_limit_exceeded",
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


@dataclass(frozen=True)
class AgentInventoryEntry:
    """RFC 0072 §A — one installed manifest agent, as projected by
    ``GET /v1/agents`` / ``GET /v1/agents/{agentId}``. Read-only — never carries
    the system-prompt body, resolved handoff schemas, or credentials (SR-1)."""

    agentId: str
    persona: str
    label: str
    modelClass: str
    packName: str
    packVersion: str
    toolAllowlist: list[str]
    hasHandoffSchemas: bool
    description: str | None = None
    memoryShape: dict[str, bool] | None = None
    confidenceThreshold: float | None = None
    # RFC 0072 §C — optional capability tiers this host does not satisfy, inert here.
    degraded: list[str] | None = None


# ── RFC 0054 run diff (run-diff-response.schema.json) ───────────────────


@dataclass(frozen=True)
class RunDiffEventDiff:
    """One per-event entry in a :class:`RunDiffResponse`. ``aEvent`` is absent
    when ``op == 'added'``; ``bEvent`` is absent when ``op == 'removed'``."""

    seq: int
    op: Literal["added", "removed", "changed"]
    aEvent: dict[str, Any] | None = None
    bEvent: dict[str, Any] | None = None


@dataclass(frozen=True)
class RunDiffResponse:
    """RFC 0054 — response from ``GET /v1/runs/{runId}:diff?against={otherRunId}``
    (``run-diff-response.schema.json``). Deterministic, replay-aware structured
    diff of two runs' event sequences + terminal states. ``divergedAtSeq`` is
    ``None`` and ``eventDiffs`` is empty when the two logs are identical."""

    a: str
    b: str
    divergedAtSeq: int | None
    eventDiffs: list[RunDiffEventDiff]
    stateDiff: dict[str, Any]
    truncated: bool | None = None


# ── RFC 0078 portable tool catalog (tool-descriptor.schema.json) ────────


@dataclass(frozen=True)
class ToolDescriptor:
    """RFC 0078 §B — a portable tool descriptor as projected onto the host's
    ``GET /v1/tools`` catalog (``tool-descriptor.schema.json``). Source-agnostic;
    ``safetyTier`` / ``egress`` / ``approval`` let a caller reason about a tool's
    blast radius before invoking it."""

    toolId: str
    source: Literal["node-pack", "workflow", "mcp", "connector", "host-extension"]
    safetyTier: Literal["pure", "read", "write", "exec"]
    title: str | None = None
    description: str | None = None
    inputSchema: dict[str, Any] | None = None
    outputSchema: dict[str, Any] | None = None
    auth: dict[str, Any] | None = None
    egress: Literal["none", "safe-fetch", "host-mediated", "host-owned"] | None = None
    approval: Literal["never", "conditional", "always"] | None = None
    replayPolicy: (
        Literal["deterministic", "idempotent", "non-deterministic"] | None
    ) = None
    costHint: str | None = None
    latencyHint: str | None = None


# ── RFC 0082 agent deployment lifecycle ─────────────────────────────────

DeploymentState = Literal[
    "draft",
    "test",
    "staged",
    "active",
    "paused",
    "deprecated",
    "rolled-back",
]
"""The seven-state deployment lifecycle (RFC 0082 §C)."""


@dataclass(frozen=True)
class AgentDeployment:
    """RFC 0082 §C — a per-(agentId, version) deployment record, returned by
    ``agents_list_deployments`` / ``agents_transition_deployment``
    (``agent-deployment.schema.json``). Host-runtime state distinct from the
    immutable manifest and the registry's published tags."""

    agentId: str
    version: str
    state: DeploymentState
    canaryPercent: float | None = None
    rollbackPointer: str | None = None
    channels: list[str] | None = None
    evalRunId: str | None = None
    approvalGateId: str | None = None


@dataclass
class AgentDeploymentTransition:
    """RFC 0082 §E — the ``agents_transition_deployment`` request body
    (``agent-deployment-transition.schema.json``). The host authorizes it
    fail-closed (RFC 0049 ``deploy:*``), runs any RFC 0051 approvalGate, and
    enforces RFC 0081 ``requiredEval`` before emitting ``deployment.promoted``."""

    version: str
    transition: Literal["promote", "pause", "deprecate", "rollback", "adjust-canary"]
    toState: DeploymentState | None = None
    channel: str | None = None
    canaryPercent: float | None = None
    evalRunId: str | None = None
    reason: str | None = None


# ── RFC 0086 standing agent roster (agent-roster-*.schema.json) ──────────


@dataclass(frozen=True)
class AgentRosterEntry:
    """RFC 0086 §A — a standing agent INSTANCE: a ``host:<id>`` AgentRef that
    references a manifest/deployment and owns a workflow portfolio
    (``agent-roster-entry.schema.json``)."""

    rosterId: str
    persona: str
    agentRef: dict[str, Any]
    owner: dict[str, Any]
    workflows: list[str] | None = None
    enabled: bool | None = None
    label: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class AgentRosterResponse:
    """Response for ``GET /v1/agents/roster`` (RFC 0086 §B,
    ``agent-roster-response.schema.json``)."""

    roster: list[AgentRosterEntry]
    total: int


# ── RFC 0087 agent org-chart (agent-org-chart.schema.json) ──────────────


@dataclass(frozen=True)
class OrgChartDepartment:
    """RFC 0087 §A — an org-chart department (a tree node via
    ``parentDepartmentId``)."""

    departmentId: str
    name: str
    parentDepartmentId: str | None
    roles: list[dict[str, str]]


@dataclass(frozen=True)
class OrgChartMember:
    """RFC 0087 §A — an org-chart member (a roster instance placed in a
    dept/role)."""

    rosterId: str
    departmentId: str
    roleId: str
    reportsTo: str | None


@dataclass(frozen=True)
class AgentOrgChart:
    """RFC 0087 §A — the descriptive org-chart over roster members
    (``agent-org-chart.schema.json``). Carries no authority-bearing field by
    design (§B ``org-position-no-authority-escalation``)."""

    owner: dict[str, Any]
    departments: list[OrgChartDepartment]
    members: list[OrgChartMember]


@dataclass(frozen=True)
class OrgChartResponsibilityView:
    """Response for ``GET /v1/agents/org-chart/{departmentId}`` (RFC 0087 §D,
    ``org-chart-responsibility-view.schema.json``) — the department subtree +
    the responsibility roll-up (union of member portfolios)."""

    department: OrgChartDepartment
    members: list[OrgChartMember]
    responsibilities: list[str]


# ── RFC 0081 agent evaluation (eval-summary.schema.json) ────────────────

AgentModelClass = Literal[
    "reasoning",
    "writing",
    "coding",
    "research",
    "classification",
    "general",
]
"""Abstract model class (RFC 0002 / RFC 0003 manifest vocabulary)."""


@dataclass(frozen=True)
class EvalSafetyFinding:
    """A redaction-safe safety finding ({kind, severity} descriptor — never
    excerpted content)."""

    kind: str
    severity: Literal["low", "medium", "high", "critical"]


@dataclass(frozen=True)
class EvalTaskResult:
    """Per-task result on an :class:`EvalSummary` (content-free: scores +
    scalars + ids)."""

    taskId: str
    score: float
    passed: bool
    costUsd: float | None = None
    latencyMs: float | None = None
    schemaValid: bool | None = None
    safetyFindings: list[EvalSafetyFinding] | None = None


@dataclass(frozen=True)
class EvalRegression:
    """The regression block on an :class:`EvalSummary` (RFC 0081 §D
    ``regression`` mode)."""

    baselineRunId: str
    scoreDelta: float
    diffRef: str | None = None


@dataclass(frozen=True)
class EvalSummary:
    """RFC 0081 §C — the terminal scorecard of an eval run, read via
    ``runs_eval_summary(runId)`` (``eval-summary.schema.json``). Content-free:
    scores, scalars, ids, and redaction-safe safety descriptors only
    (``eval-summary-no-content-leak``)."""

    suiteId: str
    suiteVersion: str
    aggregateScore: float
    passed: bool
    taskCount: int
    passedCount: int
    tasks: list[EvalTaskResult]
    evaluatedModelClass: AgentModelClass | None = None
    totalCostUsd: float | None = None
    regression: EvalRegression | None = None


# ── RFC 0027 / RFC 0028 prompt library (prompt-template.schema.json) ────

PromptKind = Literal["system", "user", "few-shot", "schema-hint"]
"""Role a PromptTemplate plays when composed into an LLM call
(``prompt-kind.schema.json``)."""


@dataclass
class PromptVariable:
    """Typed interpolation slot in a :class:`PromptTemplate`
    (``prompt-template.schema.json#/$defs/PromptVariable``)."""

    name: str
    type: Literal["string", "number", "boolean", "array", "object"]
    required: bool
    source: Literal["input", "variable", "secret", "context"] | None = None
    extractPath: str | None = None
    defaultValue: Any | None = None
    description: str | None = None


@dataclass
class PromptTemplate:
    """RFC 0027 / RFC 0028 — named, versioned, variable-bound prompt body
    (``prompt-template.schema.json``). Used as both request body
    (``create``/``update``) and 2xx response shape."""

    templateId: str
    version: str
    kind: PromptKind
    text: str
    name: str | None = None
    description: str | None = None
    variables: list[PromptVariable] | None = None
    modelHints: dict[str, Any] | None = None
    tags: list[str] | None = None
    meta: dict[str, Any] | None = None


@dataclass
class ListPromptsRequest:
    """Filter set for ``prompts_list(...)`` per RFC 0028 §A."""

    kind: PromptKind | None = None
    tag: str | None = None
    modelClass: str | None = None
    source: Literal["host", "pack", "user"] | None = None
    cursor: str | None = None
    limit: int | None = None


@dataclass(frozen=True)
class ListPromptsResponse:
    """Response for ``prompts_list(...)`` — the 200 body of
    ``GET /v1/prompts``."""

    items: list[PromptTemplate]
    nextCursor: str | None = None


@dataclass
class RenderPromptRequest:
    """Request shape for ``prompts_render(...)`` per RFC 0028 §A. ``ref`` is a
    ``prompt-ref.schema.json`` value — the stringy ``prompt:<id>[@<ver>]`` form
    or the structured object form. Secret-source bindings MUST carry
    ``[REDACTED:<credentialRef>]`` markers (SR-1)."""

    ref: str | dict[str, Any]
    variables: dict[str, Any]
    contentTrust: Literal["trusted", "untrusted"] | None = None


@dataclass(frozen=True)
class RenderPromptResponse:
    """Response for ``prompts_render(...)``. ``hash`` / ``variableHashes`` are
    always present; ``composed`` populates only under
    ``capabilities.prompts.observability: "full"``."""

    hash: str
    refs: list[str]
    variableHashes: dict[str, str]
    composed: str | None = None
    contentTrust: Literal["trusted", "untrusted"] | None = None

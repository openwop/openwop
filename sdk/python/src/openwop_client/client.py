"""
OpenwopClient — synchronous Python HTTP client for the openwop REST surface.

Mirrors the TypeScript SDK at `../typescript/src/openwop.ts`. Each method
maps 1:1 to a documented endpoint in `../../api/openapi.yaml`. Zero
third-party deps — pure `urllib.request`.
"""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from typing import Any, Iterator, Literal, Sequence, cast
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .errors import WopError
from .sse import stream_events
from .types import (
    AgentDeployment,
    AgentDeploymentTransition,
    AgentInventoryEntry,
    AgentOrgChart,
    AgentRosterEntry,
    AgentRosterResponse,
    AuditVerifyAnomaly,
    AuditVerifyCheckpoint,
    AuditVerifyResult,
    BulkCancelRunResult,
    BulkCancelRunsRequest,
    BulkCancelRunsResponse,
    Capabilities,
    CapabilitiesLimits,
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
    ErrorEnvelope,
    ForkRunRequest,
    ForkRunResponse,
    Annotation,
    CreateAnnotationRequest,
    WorkspaceFile,
    PutWorkspaceFileRequest,
    InterruptByTokenInspection,
    DebugBundle,
    EvalRegression,
    EvalSafetyFinding,
    EvalSummary,
    EvalTaskResult,
    ListPromptsRequest,
    ListPromptsResponse,
    OrgChartDepartment,
    OrgChartMember,
    OrgChartResponsibilityView,
    PauseRunRequest,
    PauseRunResponse,
    PromptTemplate,
    RegisterWebhookRequest,
    RegisterWebhookResponse,
    PollEventsResponse,
    RenderPromptRequest,
    RenderPromptResponse,
    ResolveInterruptRequest,
    ResolveInterruptResponse,
    ResumeRunRequest,
    ResumeRunResponse,
    RunAncestryParent,
    RunAncestryResponse,
    RunConfigurable,
    RunDiffEventDiff,
    RunDiffResponse,
    RunEventDoc,
    RunSnapshot,
    RunSnapshotError,
    RunStatus,
    StreamMode,
    ToolDescriptor,
)


def _to_jsonable(obj: Any) -> Any:
    """Convert dataclasses → dicts; pass through plain JSON values."""
    if isinstance(obj, RunConfigurable):
        return obj.to_dict()
    if is_dataclass(obj) and not isinstance(obj, type):
        return {k: _to_jsonable(v) for k, v in asdict(obj).items() if v is not None}
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_jsonable(v) for v in obj]
    return obj


def _to_workspace_file(d: dict[str, Any]) -> WorkspaceFile:
    """Map a workspace-file.schema.json response dict into a WorkspaceFile."""
    return WorkspaceFile(
        path=str(d["path"]),
        content=str(d.get("content", "")),
        version=int(d["version"]),
        updatedAt=str(d["updatedAt"]),
        contentType=d.get("contentType"),
        etag=d.get("etag"),
    )


def _capabilities_from_dict(d: dict[str, Any]) -> Capabilities:
    raw_limits = d.get("limits", {})
    limits = CapabilitiesLimits(
        clarificationRounds=int(raw_limits["clarificationRounds"]),
        schemaRounds=int(raw_limits["schemaRounds"]),
        envelopesPerTurn=int(raw_limits["envelopesPerTurn"]),
        maxNodeExecutions=raw_limits.get("maxNodeExecutions"),
        maxRunDurationMs=raw_limits.get("maxRunDurationMs"),
        maxLoopIterations=raw_limits.get("maxLoopIterations"),
    )
    return Capabilities(
        protocolVersion=str(d["protocolVersion"]),
        supportedEnvelopes=list(d.get("supportedEnvelopes", [])),
        schemaVersions=dict(d.get("schemaVersions", {})),
        limits=limits,
        extensions=d.get("extensions"),
        implementation=d.get("implementation"),
        engineVersion=d.get("engineVersion"),
        eventLogSchemaVersion=d.get("eventLogSchemaVersion"),
        supportedTransports=d.get("supportedTransports"),
        configurable=d.get("configurable"),
        observability=d.get("observability"),
        minClientVersion=d.get("minClientVersion"),
    )


def _agent_inventory_entry_from_dict(d: dict[str, Any]) -> AgentInventoryEntry:
    return AgentInventoryEntry(
        agentId=str(d["agentId"]),
        persona=str(d.get("persona", "")),
        label=str(d.get("label", d.get("persona", ""))),
        modelClass=str(d.get("modelClass", "")),
        packName=str(d.get("packName", "")),
        packVersion=str(d.get("packVersion", "")),
        toolAllowlist=list(d.get("toolAllowlist", [])),
        hasHandoffSchemas=bool(d.get("hasHandoffSchemas", False)),
        description=d.get("description"),
        memoryShape=d.get("memoryShape"),
        confidenceThreshold=d.get("confidenceThreshold"),
        degraded=d.get("degraded"),
    )


def _run_snapshot_from_dict(d: dict[str, Any]) -> RunSnapshot:
    err_dict = d.get("error")
    err = (
        RunSnapshotError(
            code=str(err_dict.get("code", "")),
            message=str(err_dict.get("message", "")),
            details=err_dict.get("details"),
        )
        if isinstance(err_dict, dict)
        else None
    )
    return RunSnapshot(
        runId=str(d["runId"]),
        workflowId=str(d["workflowId"]),
        status=cast(RunStatus, d["status"]),
        currentNodeId=d.get("currentNodeId"),
        startedAt=d.get("startedAt"),
        completedAt=d.get("completedAt"),
        nodeStates=d.get("nodeStates"),
        variables=d.get("variables"),
        channels=d.get("channels"),
        error=err,
        engineVersion=d.get("engineVersion"),
        eventLogSchemaVersion=d.get("eventLogSchemaVersion"),
        tags=d.get("tags"),
        metadata=d.get("metadata"),
        configurable=d.get("configurable"),
    )


def _event_from_dict(d: dict[str, Any]) -> RunEventDoc:
    return RunEventDoc(
        eventId=str(d["eventId"]),
        runId=str(d["runId"]),
        type=str(d["type"]),
        payload=d.get("payload"),
        timestamp=str(d["timestamp"]),
        sequence=int(d["sequence"]),
        nodeId=d.get("nodeId"),
        schemaVersion=d.get("schemaVersion"),
        engineVersion=d.get("engineVersion"),
        causationId=d.get("causationId"),
    )


def _tool_descriptor_from_dict(d: dict[str, Any]) -> ToolDescriptor:
    return ToolDescriptor(
        toolId=str(d["toolId"]),
        source=cast(Any, d["source"]),
        safetyTier=cast(Any, d["safetyTier"]),
        title=d.get("title"),
        description=d.get("description"),
        inputSchema=d.get("inputSchema"),
        outputSchema=d.get("outputSchema"),
        auth=d.get("auth"),
        egress=d.get("egress"),
        approval=d.get("approval"),
        replayPolicy=d.get("replayPolicy"),
        costHint=d.get("costHint"),
        latencyHint=d.get("latencyHint"),
    )


def _agent_deployment_from_dict(d: dict[str, Any]) -> AgentDeployment:
    return AgentDeployment(
        agentId=str(d["agentId"]),
        version=str(d["version"]),
        state=cast(Any, d["state"]),
        canaryPercent=d.get("canaryPercent"),
        rollbackPointer=d.get("rollbackPointer"),
        channels=d.get("channels"),
        evalRunId=d.get("evalRunId"),
        approvalGateId=d.get("approvalGateId"),
    )


def _roster_entry_from_dict(d: dict[str, Any]) -> AgentRosterEntry:
    return AgentRosterEntry(
        rosterId=str(d["rosterId"]),
        persona=str(d["persona"]),
        agentRef=dict(d.get("agentRef", {})),
        owner=dict(d.get("owner", {})),
        workflows=d.get("workflows"),
        enabled=d.get("enabled"),
        label=d.get("label"),
        description=d.get("description"),
    )


def _org_department_from_dict(d: dict[str, Any]) -> OrgChartDepartment:
    return OrgChartDepartment(
        departmentId=str(d["departmentId"]),
        name=str(d["name"]),
        parentDepartmentId=d.get("parentDepartmentId"),
        roles=[dict(r) for r in d.get("roles", [])],
    )


def _org_member_from_dict(d: dict[str, Any]) -> OrgChartMember:
    return OrgChartMember(
        rosterId=str(d["rosterId"]),
        departmentId=str(d["departmentId"]),
        roleId=str(d["roleId"]),
        reportsTo=d.get("reportsTo"),
    )


def _eval_summary_from_dict(d: dict[str, Any]) -> EvalSummary:
    tasks = [
        EvalTaskResult(
            taskId=str(t["taskId"]),
            score=float(t["score"]),
            passed=bool(t["passed"]),
            costUsd=t.get("costUsd"),
            latencyMs=t.get("latencyMs"),
            schemaValid=t.get("schemaValid"),
            safetyFindings=(
                [
                    EvalSafetyFinding(kind=str(f["kind"]), severity=cast(Any, f["severity"]))
                    for f in t["safetyFindings"]
                ]
                if t.get("safetyFindings") is not None
                else None
            ),
        )
        for t in d.get("tasks", [])
    ]
    reg_d = d.get("regression")
    regression = (
        EvalRegression(
            baselineRunId=str(reg_d["baselineRunId"]),
            scoreDelta=float(reg_d["scoreDelta"]),
            diffRef=reg_d.get("diffRef"),
        )
        if isinstance(reg_d, dict)
        else None
    )
    return EvalSummary(
        suiteId=str(d["suiteId"]),
        suiteVersion=str(d["suiteVersion"]),
        aggregateScore=float(d["aggregateScore"]),
        passed=bool(d["passed"]),
        taskCount=int(d["taskCount"]),
        passedCount=int(d["passedCount"]),
        tasks=tasks,
        evaluatedModelClass=d.get("evaluatedModelClass"),
        totalCostUsd=d.get("totalCostUsd"),
        regression=regression,
    )


def _prompt_template_from_dict(d: dict[str, Any]) -> PromptTemplate:
    return PromptTemplate(
        templateId=str(d["templateId"]),
        version=str(d["version"]),
        kind=cast(Any, d["kind"]),
        text=str(d["text"]),
        name=d.get("name"),
        description=d.get("description"),
        variables=d.get("variables"),
        modelHints=d.get("modelHints"),
        tags=d.get("tags"),
        meta=d.get("meta"),
    )


def _run_diff_from_dict(d: dict[str, Any]) -> RunDiffResponse:
    diffs = [
        RunDiffEventDiff(
            seq=int(e["seq"]),
            op=cast(Any, e["op"]),
            aEvent=e.get("aEvent"),
            bEvent=e.get("bEvent"),
        )
        for e in d.get("eventDiffs", [])
    ]
    return RunDiffResponse(
        a=str(d["a"]),
        b=str(d["b"]),
        divergedAtSeq=d.get("divergedAtSeq"),
        eventDiffs=diffs,
        stateDiff=dict(d.get("stateDiff", {})),
        truncated=d.get("truncated"),
    )


class OpenwopClient:
    """Synchronous HTTP client for any OpenWOP-compliant server.

    Args:
        base_url:  Server root, e.g., `https://api.example.com`.
        api_key:   Bearer-style API key. See `../../auth.md`.
        timeout:   Per-request timeout in seconds. Default 30.

    Example:
        >>> client = OpenwopClient(base_url="https://api.example.com", api_key="hk_test_...")
        >>> caps = client.discovery_capabilities()
        >>> print(caps.protocolVersion)
        >>> resp = client.runs_create(CreateRunRequest(workflowId="my-wf"))
    """

    def __init__(self, base_url: str, api_key: str, timeout: float = 30.0) -> None:
        if not base_url:
            raise ValueError("OpenwopClient: base_url is required")
        if not api_key:
            raise ValueError("OpenwopClient: api_key is required")
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout

    # ── Discovery ────────────────────────────────────────────────────
    def discovery_capabilities(self) -> Capabilities:
        d = self._request_json("GET", "/.well-known/openwop", authenticated=False)
        return _capabilities_from_dict(d)

    def discovery_openapi(self) -> dict[str, Any]:
        return self._request_json("GET", "/v1/openapi.json", authenticated=False)

    # ── Workflows ────────────────────────────────────────────────────
    def workflows_get(self, workflow_id: str) -> dict[str, Any]:
        return self._request_json("GET", f"/v1/workflows/{workflow_id}")

    # ── Runs ─────────────────────────────────────────────────────────
    def runs_create(
        self,
        body: CreateRunRequest,
        *,
        idempotency_key: str | None = None,
        dedup: bool = False,
    ) -> CreateRunResponse:
        headers = self._mutation_headers(idempotency_key=idempotency_key, dedup=dedup)
        d = self._request_json("POST", "/v1/runs", body=_to_jsonable(body), headers=headers)
        return CreateRunResponse(
            runId=str(d["runId"]),
            status=cast(RunStatus, d["status"]),
            eventsUrl=str(d["eventsUrl"]),
            statusUrl=d.get("statusUrl"),
        )

    def runs_get(self, run_id: str) -> RunSnapshot:
        d = self._request_json("GET", f"/v1/runs/{run_id}")
        return _run_snapshot_from_dict(d)

    def runs_debug_bundle(
        self,
        run_id: str,
        *,
        max_events: int | None = None,
    ) -> DebugBundle | None:
        """Fetch the portable JSON diagnostic export per
        ``spec/v1/debug-bundle.md``.

        Returns ``None`` when the host doesn't advertise
        ``capabilities.debugBundle.supported: true`` (endpoint returns
        404 per the spec). The host's ``redactionMode`` reflects its
        advertised ``capabilities.compliance.defaultMode``; callers MUST
        treat masked/omitted/hashed values as the spec-canonical content.
        """

        path = f"/v1/runs/{run_id}/debug-bundle"
        if max_events is not None:
            path = f"{path}?maxEvents={max_events}"
        try:
            d = self._request_json("GET", path)
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return DebugBundle(
            bundleVersion=str(d["bundleVersion"]),
            generatedAt=str(d["generatedAt"]),
            host=cast(dict[str, Any], d.get("host", {})),
            run=cast(dict[str, Any], d.get("run", {})),
            events=cast(list[dict[str, Any]], d.get("events", [])),
            redactionApplied=bool(d["redactionApplied"]),
            redactionMode=cast(
                Literal["mask", "omit", "hash", "passthrough"],
                d["redactionMode"],
            ),
            truncated=d.get("truncated"),
            truncatedReason=d.get("truncatedReason"),
        )

    def runs_cancel(
        self,
        run_id: str,
        body: CancelRunRequest | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> CancelRunResponse:
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            f"/v1/runs/{run_id}/cancel",
            body=_to_jsonable(body) if body is not None else {},
            headers=headers,
        )
        return CancelRunResponse(runId=str(d["runId"]), status=d["status"])

    def runs_pause(
        self,
        run_id: str,
        body: PauseRunRequest | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> PauseRunResponse:
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            f"/v1/runs/{run_id}:pause",
            body=_to_jsonable(body) if body is not None else {},
            headers=headers,
        )
        return PauseRunResponse(
            runId=str(d["runId"]),
            status=cast(Literal["paused"], d["status"]),
            pausedAt=d.get("pausedAt"),
        )

    def runs_resume(
        self,
        run_id: str,
        body: ResumeRunRequest | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> ResumeRunResponse:
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            f"/v1/runs/{run_id}:resume",
            body=_to_jsonable(body) if body is not None else {},
            headers=headers,
        )
        return ResumeRunResponse(
            runId=str(d["runId"]),
            status=cast(Literal["running"], d["status"]),
            resumedAt=d.get("resumedAt"),
        )

    def runs_bulk_cancel(
        self,
        body: BulkCancelRunsRequest,
        *,
        idempotency_key: str | None = None,
    ) -> BulkCancelRunsResponse:
        """Bulk-cancel a set of in-flight runs.

        Per rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1).
        Returns 200 + per-id results array whenever the request reaches
        the host; partial failures surface inside the array (each entry
        carries ``ok: bool`` + optional ``error``). Over-cap requests
        (>100 runIds by spec) return 400 validation_error.
        """
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            "/v1/runs:bulk-cancel",
            body=_to_jsonable(body),
            headers=headers,
        )
        results = [
            BulkCancelRunResult(
                runId=str(r["runId"]),
                ok=bool(r["ok"]),
                status=r.get("status"),
                error=r.get("error"),
            )
            for r in d.get("results", [])
        ]
        return BulkCancelRunsResponse(results=results)

    def audit_verify(self, from_seq: int, to_seq: int) -> AuditVerifyResult:
        """Verify the audit-log hash chain over ``[from_seq, to_seq]``.

        Per auth-profiles.md §"openwop-audit-log-integrity" §4. Requires
        the ``audit:read`` scope on the API key. Hosts that do NOT
        advertise the profile return 404 (raised as :class:`WopError`).
        """
        query = urlencode({"fromSeq": from_seq, "toSeq": to_seq})
        d = self._request_json(
            "GET",
            f"/v1/audit/verify?{query}",
        )
        checkpoints = [
            AuditVerifyCheckpoint(
                checkpoint=str(c["checkpoint"]),
                atSequence=int(c["atSequence"]),
                merkleRoot=str(c["merkleRoot"]),
                signature=str(c["signature"]),
            )
            for c in d.get("checkpoints", [])
        ]
        anomalies = [
            AuditVerifyAnomaly(
                atSeq=int(a["atSeq"]),
                expectedPrevHash=str(a["expectedPrevHash"]),
                actualPrevHash=str(a["actualPrevHash"]),
            )
            for a in d.get("anomalies", [])
        ]
        return AuditVerifyResult(
            fromSeq=int(d["fromSeq"]),
            toSeq=int(d["toSeq"]),
            chainValid=bool(d["chainValid"]),
            checkpoints=checkpoints,
            anomalies=anomalies,
            checkpointsValid=d.get("checkpointsValid"),
        )

    def webhooks_register(
        self,
        body: RegisterWebhookRequest,
        *,
        idempotency_key: str | None = None,
    ) -> RegisterWebhookResponse:
        """Register a webhook subscription per ``spec/v1/webhooks.md``.

        The signing ``secret`` is returned ONCE in the response — store
        it server-side for HMAC verification. The host cannot recover
        it later.
        """

        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            "/v1/webhooks",
            body=_to_jsonable(body),
            headers=headers,
        )
        return RegisterWebhookResponse(
            subscriptionId=str(d["subscriptionId"]),
            url=str(d["url"]),
            secret=str(d["secret"]),
            eventTypes=list(d.get("eventTypes", [])),
            createdAt=str(d["createdAt"]),
        )

    def webhooks_unregister(self, subscription_id: str) -> None:
        """Unregister a webhook subscription.

        Raises :class:`WopError` with code ``subscription_not_found``
        when the subscription_id is unknown.
        """

        self._request_json("DELETE", f"/v1/webhooks/{subscription_id}")

    def runs_fork(
        self,
        run_id: str,
        body: ForkRunRequest,
        *,
        idempotency_key: str | None = None,
    ) -> ForkRunResponse:
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            f"/v1/runs/{run_id}:fork",
            body=_to_jsonable(body),
            headers=headers,
        )
        return ForkRunResponse(
            runId=str(d["runId"]),
            sourceRunId=str(d["sourceRunId"]),
            mode=d["mode"],
            status=cast(RunStatus, d["status"]),
            eventsUrl=str(d["eventsUrl"]),
            fromSeq=d.get("fromSeq"),
        )

    def create_annotation(
        self,
        run_id: str,
        body: CreateAnnotationRequest,
        *,
        idempotency_key: str | None = None,
    ) -> Annotation:
        """RFC 0056 — record a non-blocking quality annotation on a run.

        Raises ``WopError`` on non-2xx (501 when the host doesn't advertise
        ``capabilities.feedback.supported``)."""
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            f"/v1/runs/{run_id}/annotations",
            body=_to_jsonable(body),
            headers=headers,
        )
        return Annotation(
            annotationId=str(d["annotationId"]),
            target=dict(d.get("target", {})),
            signal=dict(d.get("signal", {})),
            actor=dict(d.get("actor", {})),
            createdAt=str(d["createdAt"]),
            note=d.get("note"),
        )

    def list_annotations(self, run_id: str) -> list[Annotation] | None:
        """RFC 0056 — list a run's annotations (tenant-scoped). Returns ``None``
        when the host doesn't advertise ``capabilities.feedback`` (404/501)."""
        try:
            d = self._request_json("GET", f"/v1/runs/{run_id}/annotations")
        except WopError as err:
            if err.status in (404, 501):
                return None
            raise
        return [
            Annotation(
                annotationId=str(a["annotationId"]),
                target=dict(a.get("target", {})),
                signal=dict(a.get("signal", {})),
                actor=dict(a.get("actor", {})),
                createdAt=str(a["createdAt"]),
                note=a.get("note"),
            )
            for a in d.get("annotations", [])
        ]

    def agents_list(self) -> list[AgentInventoryEntry] | None:
        """RFC 0072 §A — list installed manifest agents. Read-only; returns
        ``None`` when the host doesn't advertise
        ``capabilities.agents.manifestRuntime`` (the endpoint 404s). Dispatch is
        not here: a manifest agent runs as a ``runs.create`` whose workflow node
        pins it via ``WorkflowNode.agent`` (RFC 0072 §B)."""
        try:
            d = self._request_json("GET", "/v1/agents")
        except WopError as err:
            if err.status in (404, 501):
                return None
            raise
        return [_agent_inventory_entry_from_dict(a) for a in d.get("agents", [])]

    def agents_get(self, agent_id: str) -> AgentInventoryEntry | None:
        """RFC 0072 §A — one installed manifest agent's inventory entry, or
        ``None`` when absent / the capability is unadvertised (404)."""
        try:
            d = self._request_json("GET", f"/v1/agents/{agent_id}")
        except WopError as err:
            if err.status in (404, 501):
                return None
            raise
        return _agent_inventory_entry_from_dict(d)

    def agents_list_deployments(
        self, agent_id: str
    ) -> list[AgentDeployment] | None:
        """RFC 0082 §C/§E — list a manifest agent's deployment records
        (``GET /v1/agents/{agentId}/deployments``). Returns ``None`` when the host
        doesn't advertise ``capabilities.agents.deployment`` (the endpoint 404s)."""
        try:
            d = self._request_json_any("GET", f"/v1/agents/{agent_id}/deployments")
        except WopError as err:
            if err.status == 404:
                return None
            raise
        items = d if isinstance(d, list) else d.get("deployments", d.get("items", []))
        return [_agent_deployment_from_dict(x) for x in items]

    def agents_transition_deployment(
        self,
        agent_id: str,
        body: AgentDeploymentTransition,
        *,
        idempotency_key: str | None = None,
    ) -> AgentDeployment:
        """RFC 0082 §E — request a deployment state transition (promote / pause /
        deprecate / rollback / adjust-canary) via
        ``POST /v1/agents/{agentId}/deployments``. The host authorizes fail-closed
        (RFC 0049 ``deploy:*``), runs any RFC 0051 approvalGate, and enforces RFC
        0081 ``requiredEval`` before emitting ``deployment.promoted``. Returns the
        updated record; raises ``WopError`` on non-2xx (403 fail-closed /
        ``eval_gate_unmet``; 400 ``no_active_deployment`` / unsupported state)."""
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            f"/v1/agents/{agent_id}/deployments",
            body=_to_jsonable(body),
            headers=headers,
        )
        return _agent_deployment_from_dict(d)

    def agents_list_roster(self) -> AgentRosterResponse | None:
        """RFC 0086 §B — list the standing agent roster (named instances + their
        workflow portfolios) visible to the caller (``GET /v1/agents/roster``).
        Returns ``None`` when the host doesn't advertise
        ``capabilities.agents.roster`` (the endpoint 404s)."""
        try:
            d = self._request_json("GET", "/v1/agents/roster")
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return AgentRosterResponse(
            roster=[_roster_entry_from_dict(r) for r in d.get("roster", [])],
            total=int(d.get("total", 0)),
        )

    def agents_get_roster_entry(self, roster_id: str) -> AgentRosterEntry | None:
        """RFC 0086 §B — return one standing roster entry
        (``GET /v1/agents/roster/{rosterId}``). Returns ``None`` on 404 (no such
        entry, cross-tenant, or the capability is unadvertised)."""
        try:
            d = self._request_json("GET", f"/v1/agents/roster/{roster_id}")
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return _roster_entry_from_dict(d)

    def agents_get_org_chart(self) -> AgentOrgChart | None:
        """RFC 0087 §C — return the caller's agent org-chart (departments + roles
        + ``reportsTo`` over roster members; descriptive — confers no authority)
        via ``GET /v1/agents/org-chart``. Returns ``None`` when the host doesn't
        advertise ``capabilities.agents.orgChart`` (404)."""
        try:
            d = self._request_json("GET", "/v1/agents/org-chart")
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return AgentOrgChart(
            owner=dict(d.get("owner", {})),
            departments=[_org_department_from_dict(x) for x in d.get("departments", [])],
            members=[_org_member_from_dict(x) for x in d.get("members", [])],
        )

    def agents_get_org_chart_department(
        self, department_id: str, *, recursive: bool | None = None
    ) -> OrgChartResponsibilityView | None:
        """RFC 0087 §D — one department's subtree + responsibility roll-up (the
        union of its members' RFC 0086 portfolios) via
        ``GET /v1/agents/org-chart/{departmentId}``. Pass ``recursive=False`` to
        scope the roll-up to direct members. Returns ``None`` on 404
        (unknown/cross-tenant department, or the capability is unadvertised)."""
        path = f"/v1/agents/org-chart/{quote(department_id, safe='')}"
        if recursive is False:
            path += "?recursive=false"
        try:
            d = self._request_json("GET", path)
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return OrgChartResponsibilityView(
            department=_org_department_from_dict(d["department"]),
            members=[_org_member_from_dict(x) for x in d.get("members", [])],
            responsibilities=list(d.get("responsibilities", [])),
        )

    # ── Tools (RFC 0078 portable tool catalog) ───────────────────────
    def tools_list(self) -> list[ToolDescriptor] | None:
        """RFC 0078 §B — list the portable ``ToolDescriptor``s visible to the
        caller (``GET /v1/tools``). Returns ``None`` when the host doesn't
        advertise ``capabilities.toolCatalog`` (the endpoint 404s)."""
        try:
            d = self._request_json_any("GET", "/v1/tools")
        except WopError as err:
            if err.status == 404:
                return None
            raise
        items = d if isinstance(d, list) else d.get("tools", d.get("items", []))
        return [_tool_descriptor_from_dict(t) for t in items]

    def tools_get(self, tool_id: str) -> ToolDescriptor | None:
        """RFC 0078 §B — return one ``ToolDescriptor`` by its stable ``toolId``
        (``GET /v1/tools/{toolId}``). Returns ``None`` on 404 (no such tool, or
        the capability is unadvertised)."""
        try:
            d = self._request_json("GET", f"/v1/tools/{quote(tool_id, safe='')}")
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return _tool_descriptor_from_dict(d)

    # ── Prompt library (RFC 0027 / RFC 0028) ─────────────────────────
    def prompts_list(
        self, req: ListPromptsRequest | None = None
    ) -> ListPromptsResponse:
        """RFC 0028 §A — list prompt templates available to the caller
        (``GET /v1/prompts``). Supports kind / tag / modelClass / source filters
        + opaque cursor pagination. Raises ``WopError`` 501 when the host doesn't
        advertise ``capabilities.prompts.endpointsSupported``."""
        params: dict[str, str] = {}
        if req is not None:
            if req.kind:
                params["kind"] = req.kind
            if req.tag:
                params["tag"] = req.tag
            if req.modelClass:
                params["modelClass"] = req.modelClass
            if req.source:
                params["source"] = req.source
            if req.cursor:
                params["cursor"] = req.cursor
            if req.limit is not None:
                params["limit"] = str(req.limit)
        qs = "?" + urlencode(params) if params else ""
        d = self._request_json("GET", f"/v1/prompts{qs}")
        return ListPromptsResponse(
            items=[_prompt_template_from_dict(t) for t in d.get("items", [])],
            nextCursor=d.get("nextCursor"),
        )

    def prompts_get(
        self,
        template_id: str,
        *,
        version: str | None = None,
        library_id: str | None = None,
    ) -> PromptTemplate | None:
        """RFC 0028 §A — fetch a single ``PromptTemplate`` by id
        (``GET /v1/prompts/{templateId}``). Optionally pin a SemVer ``version``;
        pass ``library_id`` to disambiguate when multiple installed packs ship the
        same templateId. Returns ``None`` on 404."""
        params: dict[str, str] = {}
        if version:
            params["version"] = version
        if library_id:
            params["libraryId"] = library_id
        qs = "?" + urlencode(params) if params else ""
        try:
            d = self._request_json(
                "GET", f"/v1/prompts/{quote(template_id, safe='')}{qs}"
            )
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return _prompt_template_from_dict(d)

    def prompts_create(
        self,
        template: PromptTemplate,
        *,
        idempotency_key: str | None = None,
    ) -> None:
        """RFC 0028 §A — create a new user-source ``PromptTemplate``
        (``POST /v1/prompts`` → 201, no body). Requires
        ``capabilities.prompts.mutableLibrary: true``. Raises ``WopError`` on
        non-2xx (409 ``prompt_already_exists``; 403 read-only; 501 unsupported)."""
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        self._request_json(
            "POST",
            "/v1/prompts",
            body=_to_jsonable(template),
            headers=headers,
        )

    def prompts_update(
        self,
        template_id: str,
        template: PromptTemplate,
        *,
        idempotency_key: str | None = None,
    ) -> PromptTemplate:
        """RFC 0028 §A — replace an existing user-source ``PromptTemplate``
        (``PUT /v1/prompts/{templateId}``). Submitted SemVer MUST be strictly
        greater than stored. Requires ``capabilities.prompts.mutableLibrary:
        true``. Pack-sourced / host-built-in templates are read-only (host
        returns 403). Returns the stored template."""
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "PUT",
            f"/v1/prompts/{quote(template_id, safe='')}",
            body=_to_jsonable(template),
            headers=headers,
        )
        return _prompt_template_from_dict(d)

    def prompts_delete(self, template_id: str) -> None:
        """RFC 0028 §A — delete a user-source ``PromptTemplate``
        (``DELETE /v1/prompts/{templateId}`` → 204). Requires
        ``capabilities.prompts.mutableLibrary: true``. Pack-sourced / host-built-in
        templates are read-only (host returns 403). Raises ``WopError`` on
        non-2xx (404 unknown id)."""
        self._request_json("DELETE", f"/v1/prompts/{quote(template_id, safe='')}")

    def prompts_render(self, req: RenderPromptRequest) -> RenderPromptResponse:
        """RFC 0028 §A — render a ``PromptTemplate`` with supplied variable
        bindings (``POST /v1/prompts:render``). Returns composed body (only under
        ``observability: "full"``) + sha256 hash + per-variable hashes. Does NOT
        dispatch an LLM call. Secret-source variable values MUST be supplied as
        ``[REDACTED:<credentialRef>]`` markers (SR-1)."""
        body: dict[str, Any] = {"ref": req.ref, "variables": req.variables}
        if req.contentTrust is not None:
            body["contentTrust"] = req.contentTrust
        d = self._request_json("POST", "/v1/prompts:render", body=body)
        return RenderPromptResponse(
            hash=str(d["hash"]),
            refs=list(d.get("refs", [])),
            variableHashes=dict(d.get("variableHashes", {})),
            composed=d.get("composed"),
            contentTrust=d.get("contentTrust"),
        )

    def list_workspace_files(
        self, *, prefix: str | None = None
    ) -> list[WorkspaceFile] | None:
        """RFC 0059 — list workspace file metadata (no bodies) for the caller's
        ``{tenant, workspace}``. ``prefix`` filters the flat ``path`` namespace.
        Returns ``None`` when the host doesn't advertise
        ``capabilities.workspace.supported`` (501)."""
        path = "/v1/host/workspace/files"
        if prefix is not None:
            path += "?prefix=" + quote(prefix, safe="")
        try:
            d = self._request_json("GET", path)
        except WopError as err:
            if err.status == 501:
                return None
            raise
        return [_to_workspace_file(f) for f in d.get("files", [])]

    def get_workspace_file(
        self, file_path: str, *, version: int | None = None
    ) -> WorkspaceFile | None:
        """RFC 0059 — read one workspace file. Pass ``version`` for a historical
        snapshot when ``capabilities.workspace.versioned``. Returns ``None`` when
        the file is absent (404) or the capability is unadvertised (501)."""
        path = "/v1/host/workspace/files/" + quote(file_path, safe="")
        if version is not None:
            path += "?version=" + str(version)
        try:
            d = self._request_json("GET", path)
        except WopError as err:
            if err.status in (404, 501):
                return None
            raise
        return _to_workspace_file(d)

    def put_workspace_file(
        self,
        file_path: str,
        body: PutWorkspaceFileRequest,
        *,
        if_match: str | None = None,
        idempotency_key: str | None = None,
    ) -> WorkspaceFile:
        """RFC 0059 — atomic create/replace of a workspace file. Pass ``if_match``
        (the file's current ``etag``) for optimistic concurrency; a stale token
        raises ``WopError`` with status 409 (``workspace_conflict``). Content beyond
        ``capabilities.workspace.maxFileBytes`` raises 413 (``workspace_too_large``)."""
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        if if_match is not None:
            headers["If-Match"] = if_match
        d = self._request_json(
            "PUT",
            "/v1/host/workspace/files/" + quote(file_path, safe=""),
            body=_to_jsonable(body),
            headers=headers,
        )
        return _to_workspace_file(d)

    def delete_workspace_file(
        self,
        file_path: str,
        *,
        idempotency_key: str | None = None,
    ) -> bool:
        """RFC 0059 — delete a workspace file. Returns ``True`` on success (204),
        ``False`` when the file is absent (404) or the capability is
        unadvertised (501)."""
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        try:
            self._request_json(
                "DELETE",
                "/v1/host/workspace/files/" + quote(file_path, safe=""),
                headers=headers,
            )
            return True
        except WopError as err:
            if err.status in (404, 501):
                return False
            raise

    def runs_ancestry(self, run_id: str) -> RunAncestryResponse | None:
        """Fetch the run's immediate parent in the cross-host composition
        chain per RFC 0040 §C — ``GET /v1/runs/{runId}/ancestry``.

        Returns ``None`` when the host doesn't advertise
        ``capabilities.multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported: true``
        (endpoint returns 404 in that case per
        ``spec/v1/multi-agent-execution.md`` §"GET /v1/runs/{runId}/ancestry").

        On 200 the response's ``parent`` is ``None`` for top-level runs;
        when set, ``parent.wellKnownUrl`` identifies the parent host's
        discovery URL so callers walk the chain one hop at a time.
        """

        try:
            d = self._request_json("GET", f"/v1/runs/{run_id}/ancestry")
        except WopError as err:
            if err.status == 404:
                return None
            raise
        parent_d = d.get("parent")
        parent = (
            RunAncestryParent(
                runId=str(parent_d["runId"]),
                hostId=str(parent_d["hostId"]),
                cause=parent_d["cause"],
                wellKnownUrl=parent_d.get("wellKnownUrl"),
            )
            if parent_d is not None
            else None
        )
        return RunAncestryResponse(
            runId=str(d["runId"]),
            hostId=str(d["hostId"]),
            parent=parent,
        )

    def runs_diff(self, run_id: str, against: str) -> RunDiffResponse | None:
        """RFC 0054 — deterministic, replay-aware structured diff of two runs
        (typically a run and its ``:fork``) via
        ``GET /v1/runs/{runId}:diff?against={otherRunId}``. Requires ``runs:read``
        on BOTH ``run_id`` and ``against``. Returns ``None`` when the host
        doesn't implement the endpoint (404). ``divergedAtSeq`` is ``None`` and
        ``eventDiffs`` is empty when the two logs are identical."""
        path = (
            f"/v1/runs/{quote(run_id, safe='')}:diff"
            f"?against={quote(against, safe='')}"
        )
        try:
            d = self._request_json("GET", path)
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return _run_diff_from_dict(d)

    def runs_eval_summary(self, run_id: str) -> EvalSummary | None:
        """RFC 0081 §C — the ``EvalSummary`` scorecard for a terminal eval run
        (``GET /v1/runs/{runId}/eval-summary``). Returns ``None`` when the host
        doesn't advertise ``capabilities.agents.evalSuite`` or the run isn't an
        eval run (404). Raises ``WopError`` 409 while the run is still in
        progress."""
        try:
            d = self._request_json("GET", f"/v1/runs/{run_id}/eval-summary")
        except WopError as err:
            if err.status == 404:
                return None
            raise
        return _eval_summary_from_dict(d)

    def runs_get_artifact(
        self, run_id: str, artifact_id: str
    ) -> dict[str, Any] | None:
        """Read a run-produced artifact by id
        (``GET /v1/runs/{runId}/artifacts/{artifactId}``). The artifact body is
        implementation-defined per the host. Returns ``None`` on 404 (no such
        artifact, or the host doesn't store artifacts)."""
        path = (
            f"/v1/runs/{quote(run_id, safe='')}"
            f"/artifacts/{quote(artifact_id, safe='')}"
        )
        try:
            return self._request_json("GET", path)
        except WopError as err:
            if err.status == 404:
                return None
            raise

    def runs_poll_events(
        self,
        run_id: str,
        *,
        last_sequence: int | None = None,
        timeout_seconds: int | None = None,
    ) -> PollEventsResponse:
        params: dict[str, str] = {}
        if last_sequence is not None:
            params["lastSequence"] = str(last_sequence)
        if timeout_seconds is not None:
            params["timeout"] = str(timeout_seconds)
        qs = "?" + urlencode(params) if params else ""
        d = self._request_json("GET", f"/v1/runs/{run_id}/events/poll{qs}")
        return PollEventsResponse(
            events=[_event_from_dict(e) for e in d.get("events", [])],
            isComplete=bool(d.get("isComplete", False)),
        )

    def runs_events(
        self,
        run_id: str,
        *,
        stream_mode: StreamMode | Sequence[StreamMode] | None = None,
        last_event_id: str | None = None,
        timeout_seconds: float = 30.0,
        buffer_ms: int | None = None,
    ) -> Iterator[RunEventDoc]:
        """SSE consumer. Connection auto-closes when the server closes the
        stream (terminal run event); break out of the loop to terminate early.

        ``stream_mode`` accepts a single mode or a sequence of modes for
        S4 mixed-mode (sequences serialize to comma-separated). ``buffer_ms``
        is the S3 batching hint (0..5000); the SDK transparently flattens
        batched arrays back into per-event yields.
        """
        return stream_events(
            self._base_url,
            self._api_key,
            run_id,
            stream_mode=stream_mode,
            last_event_id=last_event_id,
            timeout_seconds=timeout_seconds,
            buffer_ms=buffer_ms,
        )

    # ── HITL interrupts ──────────────────────────────────────────────
    def interrupts_resolve_by_run(
        self,
        run_id: str,
        node_id: str,
        body: ResolveInterruptRequest,
        *,
        idempotency_key: str | None = None,
    ) -> ResolveInterruptResponse:
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        d = self._request_json(
            "POST",
            f"/v1/runs/{run_id}/interrupts/{node_id}",
            body={"resumeValue": body.resumeValue},
            headers=headers,
        )
        return ResolveInterruptResponse(
            runId=str(d["runId"]),
            nodeId=str(d["nodeId"]),
            status=cast(RunStatus, d["status"]),
        )

    def interrupts_inspect_by_token(self, token: str) -> InterruptByTokenInspection:
        d = self._request_json("GET", f"/v1/interrupts/{token}", authenticated=False)
        return InterruptByTokenInspection(
            kind=d["kind"],
            key=str(d["key"]),
            data=d["data"],
            resumeSchema=d.get("resumeSchema"),
            timeoutMs=d.get("timeoutMs"),
        )

    def interrupts_resolve_by_token(
        self,
        token: str,
        body: ResolveInterruptRequest,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        headers = self._mutation_headers(idempotency_key=idempotency_key)
        return self._request_json(
            "POST",
            f"/v1/interrupts/{token}",
            body={"resumeValue": body.resumeValue},
            headers=headers,
            authenticated=False,
        )

    # ── Internals ────────────────────────────────────────────────────
    def _mutation_headers(
        self,
        *,
        idempotency_key: str | None = None,
        dedup: bool = False,
    ) -> dict[str, str]:
        h: dict[str, str] = {}
        if idempotency_key:
            h["Idempotency-Key"] = idempotency_key
        if dedup:
            h["X-Dedup"] = "enforce"
        return h

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        headers: dict[str, str] | None = None,
        authenticated: bool = True,
    ) -> dict[str, Any]:
        decoded, text, traceparent = self._request_decoded(
            method, path, body=body, headers=headers, authenticated=authenticated
        )
        if decoded is None:
            return {}
        if not isinstance(decoded, dict):
            # Discovery /v1/openapi.json returns a top-level OpenAPI object
            # which IS a dict. RunSnapshot is a dict. Other endpoints
            # similarly return objects. Anything else is unexpected here.
            raise WopError(
                200,
                text,
                ErrorEnvelope(error="invalid_json", message="Expected JSON object"),
                traceparent,
            )
        return decoded

    def _request_json_any(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        headers: dict[str, str] | None = None,
        authenticated: bool = True,
    ) -> Any:
        """Like :meth:`_request_json` but tolerates a top-level JSON array
        (e.g. ``GET /v1/tools`` / ``GET /v1/agents/{id}/deployments`` return a
        bare array). Returns the decoded value verbatim (``{}`` for an empty
        body)."""
        decoded, text, traceparent = self._request_decoded(
            method, path, body=body, headers=headers, authenticated=authenticated
        )
        if decoded is None:
            return {}
        if not isinstance(decoded, (dict, list)):
            raise WopError(
                200,
                text,
                ErrorEnvelope(error="invalid_json", message="Expected JSON object or array"),
                traceparent,
            )
        return decoded

    def _request_decoded(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        headers: dict[str, str] | None = None,
        authenticated: bool = True,
    ) -> tuple[Any, str, str | None]:
        """Issue the request and JSON-decode the 2xx body. Returns
        ``(decoded_or_None, raw_text, traceparent)``; ``decoded`` is ``None`` for
        an empty body. Raises :class:`WopError` on non-2xx or non-JSON 2xx."""
        url = f"{self._base_url}{path}"
        all_headers: dict[str, str] = {"Accept": "application/json"}
        if headers:
            all_headers.update(headers)
        if body is not None and "Content-Type" not in all_headers:
            all_headers["Content-Type"] = "application/json"
        if authenticated:
            all_headers["Authorization"] = f"Bearer {self._api_key}"

        data: bytes | None = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")

        req = Request(url, data=data, headers=all_headers, method=method)
        try:
            with urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read()
                traceparent = resp.headers.get("traceparent")
        except HTTPError as http_err:
            raw_text = http_err.read().decode("utf-8", errors="replace")
            traceparent = http_err.headers.get("traceparent") if http_err.headers else None
            envelope = self._parse_envelope(raw_text)
            raise WopError(http_err.code, raw_text, envelope, traceparent) from http_err
        except URLError as url_err:
            # Wrap network errors uniformly so callers don't have to
            # distinguish urllib's exception zoo from WopError.
            raise WopError(0, str(url_err), None, None) from url_err

        text = raw.decode("utf-8", errors="replace")
        if not text:
            return None, text, traceparent
        try:
            decoded = json.loads(text)
        except json.JSONDecodeError as decode_err:
            raise WopError(
                200,
                text,
                ErrorEnvelope(
                    error="invalid_json",
                    message="Server returned non-JSON body for a 2xx response",
                ),
                traceparent,
            ) from decode_err
        return decoded, text, traceparent

    @staticmethod
    def _parse_envelope(text: str) -> ErrorEnvelope | None:
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return None
        if not isinstance(parsed, dict):
            return None
        if "error" not in parsed or "message" not in parsed:
            return None
        return ErrorEnvelope(
            error=str(parsed["error"]),
            message=str(parsed["message"]),
            details=parsed.get("details"),
        )

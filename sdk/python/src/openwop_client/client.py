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
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .errors import WopError
from .sse import stream_events
from .types import (
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
    InterruptByTokenInspection,
    DebugBundle,
    PauseRunRequest,
    PauseRunResponse,
    RegisterWebhookRequest,
    RegisterWebhookResponse,
    PollEventsResponse,
    ResolveInterruptRequest,
    ResolveInterruptResponse,
    ResumeRunRequest,
    ResumeRunResponse,
    RunAncestryParent,
    RunAncestryResponse,
    RunConfigurable,
    RunEventDoc,
    RunSnapshot,
    RunSnapshotError,
    RunStatus,
    StreamMode,
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


def _capabilities_from_dict(d: dict[str, Any]) -> Capabilities:
    raw_limits = d.get("limits", {})
    limits = CapabilitiesLimits(
        clarificationRounds=int(raw_limits["clarificationRounds"]),
        schemaRounds=int(raw_limits["schemaRounds"]),
        envelopesPerTurn=int(raw_limits["envelopesPerTurn"]),
        maxNodeExecutions=raw_limits.get("maxNodeExecutions"),
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
            return {}
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

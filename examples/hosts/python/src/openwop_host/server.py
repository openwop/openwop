"""HTTP server + request handlers.

Mirrors `examples/hosts/in-memory/src/server.ts`. Uses
`http.server.ThreadingHTTPServer` so each request gets its own thread
(SSE handlers can park on a Condition without blocking other requests).

Routes (per `spec/v1/rest-endpoints.md`):

    GET   /.well-known/openwop       — discovery
    GET   /v1/openapi.json           — minimal OpenAPI stub
    POST  /v1/runs                   — create run (Layer-1 idempotent)
    GET   /v1/runs/{runId}           — run snapshot
    POST  /v1/runs/{runId}/cancel    — cancel
    GET   /v1/runs/{runId}/events    — SSE stream (Last-Event-ID supported)
    GET   /v1/runs/{runId}/events/poll
    GET   /v1/runs/{runId}/debug-bundle

Single-tenant; auth is bearer-token equality against an env-configured
key. Production hosts replace this with real JWT verification.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse, parse_qs


def _now_iso() -> str:
    """RFC 3339 timestamp with microseconds + Z suffix per debug-bundle.md."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

from .fixtures import load_fixtures
from .idempotency import IdempotencyCache, IdempotencyEntry
from .runs import (
    RunRegistry,
    iter_events_since,
    wait_for_next_event_or_terminal,
)
from .webhooks import WebhookRegistry, WebhookUrlRejected, fan_out_event
import time

_RUN_ID_RE = re.compile(r"^/v1/runs/([^/]+)$")
_RUN_CANCEL_RE = re.compile(r"^/v1/runs/([^/]+)/cancel$")
_RUN_PAUSE_RE = re.compile(r"^/v1/runs/([^/]+):pause$")
_RUN_RESUME_RE = re.compile(r"^/v1/runs/([^/]+):resume$")
_RUN_EVENTS_POLL_RE = re.compile(r"^/v1/runs/([^/]+)/events/poll$")
_RUN_EVENTS_SSE_RE = re.compile(r"^/v1/runs/([^/]+)/events$")
_RUN_DEBUG_BUNDLE_RE = re.compile(r"^/v1/runs/([^/]+)/debug-bundle$")
_BULK_CANCEL_RE = re.compile(r"^/v1/runs:bulk-cancel$")
_WEBHOOKS_RE = re.compile(r"^/v1/webhooks$")
_WEBHOOK_ID_RE = re.compile(r"^/v1/webhooks/([^/]+)$")


# capabilities.md §"Unsupported capability — refusal contract":
# every spec-standardized typeId belongs to exactly one capability key.
# The host MUST refuse create-run with `capability_required` if a node's
# typeId is gated by a capability the host does NOT advertise.
GATED_TYPEID_MAP: dict[str, str] = {
    "core.llm.chat": "aiProviders",
    "core.llm.completion": "aiProviders",
    "core.subWorkflow": "subWorkflows",
    "core.orchestrator.supervisor": "orchestrator",
    "core.dispatch": "dispatch",
    "core.channelWrite": "channels",
    "core.identity": "identity",
    "core.http.request": "httpClient",
    "core.mcp.toolCall": "mcpClient",
}

# Python stdlib-only reference host advertises NONE of the gated
# capabilities. core.noop and core.delay are unconditionally available
# (no capability key) — every other typeId triggers a refusal.
HOST_ADVERTISED_GATED_CAPABILITIES: frozenset[str] = frozenset()


# rest-endpoints.md:95 — bulk-cancel REQUIRES a host-defined upper bound
# (RECOMMENDED 100). Requests exceeding this cap are refused with 400
# `validation_error` + `details.maxRunIds`.
MAX_BULK_CANCEL_RUN_IDS = 100


class _State:
    """Shared mutable state injected into the handler class."""

    def __init__(self) -> None:
        self.workflows: dict[str, dict[str, Any]] = load_fixtures()
        self.webhooks = WebhookRegistry()
        # Wire every run-event append into the webhook fan-out so registered
        # subscribers receive HMAC-signed deliveries per webhooks.md.
        # Fire-and-forget background threads — registry mutation is thread-safe.
        self.runs = RunRegistry(
            self.workflows,
            event_hook=lambda payload: fan_out_event(self.webhooks, payload),
        )
        self.idempotency = IdempotencyCache()
        self.api_key = os.environ.get("OPENWOP_API_KEY", "openwop-inmem-dev-key")


def make_handler(state: _State) -> type[BaseHTTPRequestHandler]:
    """Return a BaseHTTPRequestHandler subclass closed over `state`."""

    class Handler(BaseHTTPRequestHandler):
        # Silence default access-log spam; the host prints its own startup line.
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

        # ─── helpers ─────────────────────────────────────────────────

        def _send_json(self, status: int, payload: Any, extra_headers: dict[str, str] | None = None) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra_headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _send_error_envelope(
            self, status: int, code: str, message: str, extra: dict[str, Any] | None = None
        ) -> None:
            payload: dict[str, Any] = {"error": code, "message": message}
            if extra:
                payload.update(extra)
            self._send_json(status, payload)

        def _check_auth(self) -> bool:
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                self._send_error_envelope(401, "unauthenticated", "Missing or malformed Authorization header.")
                return False
            token = auth[len("Bearer "):].strip()
            if token != state.api_key:
                self._send_error_envelope(401, "invalid_credential", "Bearer token rejected.")
                return False
            return True

        def _read_body(self) -> str:
            length = int(self.headers.get("Content-Length") or "0")
            if length == 0:
                return ""
            return self.rfile.read(length).decode("utf-8")

        def _check_layer1_idempotency(
            self, endpoint: str, body_text: str
        ) -> tuple[str | None, str, bool]:
            """Layer-1 cache lookup helper per idempotency.md §"Cache key composition".

            Returns (idempotency_key, body_hash, replayed). When `replayed=True`,
            this helper has ALREADY written the cached response to the wire and
            the caller MUST return immediately. When `replayed=False`, the
            caller MAY proceed to execute and SHOULD call `_store_idempotent`
            with the final response to register the cache entry.

            On Idempotency-Key reuse with a different body, this helper writes
            a 409 `idempotency_key_conflict` response and signals replayed=True
            so the caller short-circuits cleanly.
            """
            idempotency_key = self.headers.get("Idempotency-Key")
            body_hash = IdempotencyCache.hash_body(body_text)
            if not idempotency_key:
                return None, body_hash, False
            cache_key = IdempotencyCache.cache_key(endpoint, idempotency_key)
            cached = state.idempotency.get(cache_key)
            if cached is None:
                return idempotency_key, body_hash, False
            if cached.body_hash != body_hash:
                self._send_error_envelope(
                    409,
                    "idempotency_key_conflict",
                    "Idempotency-Key reused with a different request body.",
                )
                return idempotency_key, body_hash, True
            raw = cached.body.encode("utf-8")
            self.send_response(cached.status)
            self.send_header("Content-Type", cached.content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("openwop-Idempotent-Replay", "true")
            self.end_headers()
            self.wfile.write(raw)
            return idempotency_key, body_hash, True

        def _store_idempotent(
            self,
            endpoint: str,
            idempotency_key: str | None,
            body_hash: str,
            status: int,
            response_payload: dict[str, Any],
        ) -> None:
            if not idempotency_key:
                return
            cache_key = IdempotencyCache.cache_key(endpoint, idempotency_key)
            state.idempotency.put(
                cache_key,
                IdempotencyEntry(
                    status=status,
                    body=json.dumps(response_payload),
                    content_type="application/json",
                    body_hash=body_hash,
                    stored_at=time.time(),
                ),
            )

        # ─── routes ──────────────────────────────────────────────────

        def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler signature
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/.well-known/openwop":
                self._handle_discovery()
                return
            if path == "/v1/openapi.json":
                self._handle_openapi()
                return
            m = _RUN_EVENTS_POLL_RE.match(path)
            if m:
                self._handle_events_poll(m.group(1), parsed.query)
                return
            m = _RUN_EVENTS_SSE_RE.match(path)
            if m:
                self._handle_events_sse(m.group(1))
                return
            m = _RUN_DEBUG_BUNDLE_RE.match(path)
            if m:
                self._handle_debug_bundle(m.group(1))
                return
            m = _RUN_ID_RE.match(path)
            if m:
                self._handle_get_run(m.group(1))
                return
            self._send_error_envelope(404, "not_found", f"No route for GET {path}")

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/v1/runs":
                self._handle_create_run()
                return
            if _BULK_CANCEL_RE.match(path):
                self._handle_bulk_cancel()
                return
            if _WEBHOOKS_RE.match(path):
                self._handle_register_webhook()
                return
            m = _RUN_CANCEL_RE.match(path)
            if m:
                self._handle_cancel_run(m.group(1))
                return
            m = _RUN_PAUSE_RE.match(path)
            if m:
                self._handle_pause_run(m.group(1))
                return
            m = _RUN_RESUME_RE.match(path)
            if m:
                self._handle_resume_run(m.group(1))
                return
            self._send_error_envelope(404, "not_found", f"No route for POST {path}")

        def do_DELETE(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path
            m = _WEBHOOK_ID_RE.match(path)
            if m:
                self._handle_unregister_webhook(m.group(1))
                return
            self._send_error_envelope(404, "not_found", f"No route for DELETE {path}")

        # ─── handlers ────────────────────────────────────────────────

        def _handle_discovery(self) -> None:
            payload = {
                "protocolVersion": "1.0",
                "implementation": {
                    "name": "openwop-host-in-memory-python",
                    "version": "1.0.0",
                    "vendor": "openwop-spec (reference example)",
                },
                "supportedEnvelopes": [],
                "schemaVersions": {},
                "limits": {
                    "clarificationRounds": 0,
                    "schemaRounds": 0,
                    "envelopesPerTurn": 0,
                    "maxNodeExecutions": 1000,
                },
                "supportedTransports": ["rest"],
                "debugBundle": {"supported": True},
                "capabilities": {
                    # capabilities.md §`runs.pauseResume` — drainPolicies is
                    # a closed-array of host-supported policies. This host
                    # implements drain-current-node only; `immediate` is
                    # refused by the :pause endpoint with 422.
                    "runs": {
                        "pauseResume": {"supported": True, "drainPolicies": ["drain-current-node"]},
                        "bulkCancel": {"supported": True, "maxRunIds": 100},
                    },
                    # capabilities.md §`webhooks.signatureAlgorithms` —
                    # array of advertised algorithm tags. v1 = HMAC-SHA256
                    # over `{timestamp}.{rawBody}` per webhooks.md.
                    "webhooks": {
                        "supported": True,
                        "signatureAlgorithms": ["v1"],
                    },
                    # Gated typeIds the host explicitly does NOT implement.
                    # Workflows containing these nodes are refused at create
                    # time with `capability_required` per capabilities.md.
                    "refusedCapabilities": sorted(
                        {
                            cap
                            for cap in GATED_TYPEID_MAP.values()
                            if cap not in HOST_ADVERTISED_GATED_CAPABILITIES
                        }
                    ),
                },
                "fixtures": sorted(state.workflows.keys()),
            }
            self._send_json(200, payload, {"Cache-Control": "public, max-age=300"})

        def _handle_openapi(self) -> None:
            self._send_json(
                200,
                {
                    "openapi": "3.1",
                    "info": {
                        "title": "openwop in-memory reference host (Python)",
                        "version": "1.0.0",
                        "description": (
                            "Stub OpenAPI document. Full canonical bundle at api/openapi.yaml in the openwop repo."
                        ),
                    },
                    "paths": {
                        "/.well-known/openwop": {"get": {"summary": "Capability discovery"}},
                        "/v1/runs": {"post": {"summary": "Create run"}},
                        "/v1/runs/{runId}": {"get": {"summary": "Get run snapshot"}},
                        "/v1/runs/{runId}/cancel": {"post": {"summary": "Cancel run"}},
                        "/v1/runs/{runId}/events": {"get": {"summary": "SSE event stream"}},
                        "/v1/runs/{runId}/events/poll": {"get": {"summary": "Polling event read"}},
                    },
                },
            )

        def _handle_create_run(self) -> None:
            if not self._check_auth():
                return
            body_text = self._read_body()
            try:
                parsed = json.loads(body_text) if body_text else {}
            except json.JSONDecodeError:
                self._send_error_envelope(400, "validation_error", "Request body MUST be valid JSON.")
                return

            workflow_id = parsed.get("workflowId")
            if not isinstance(workflow_id, str):
                self._send_error_envelope(400, "validation_error", "workflowId MUST be a string.")
                return
            if workflow_id not in state.workflows:
                self._send_error_envelope(404, "workflow_not_found", "Unknown workflowId.")
                return

            # Pre-emptive capability refusal per capabilities.md §"Unsupported
            # capability — refusal contract". Scan workflow nodes for any
            # typeId that is gated by a capability the host does NOT advertise
            # and return 422 `capability_required` with the canonical envelope:
            #   details.requiredCapability, details.offendingTypeId, details.nodeId
            workflow_def = state.workflows[workflow_id]
            for node in workflow_def.get("nodes", []) or []:
                type_id = node.get("typeId", "") if isinstance(node, dict) else ""
                gating = GATED_TYPEID_MAP.get(type_id)
                if gating and gating not in HOST_ADVERTISED_GATED_CAPABILITIES:
                    self._send_error_envelope(
                        422,
                        "capability_required",
                        f'Workflow "{workflow_id}" references {type_id}, but this host '
                        f"does not advertise capabilities.{gating}: true.",
                        {"details": {
                            "requiredCapability": gating,
                            "offendingTypeId": type_id,
                            "nodeId": node.get("id"),
                        }},
                    )
                    return

            inputs = parsed.get("inputs") or {}
            if not isinstance(inputs, dict):
                self._send_error_envelope(400, "validation_error", "inputs MUST be an object when provided.")
                return

            # Layer-1 idempotency.
            idempotency_key = self.headers.get("Idempotency-Key")
            incoming_body_hash = IdempotencyCache.hash_body(body_text)
            if idempotency_key:
                cache_key = IdempotencyCache.cache_key("POST /v1/runs", idempotency_key)
                cached = state.idempotency.get(cache_key)
                if cached is not None:
                    if cached.body_hash != incoming_body_hash:
                        self._send_error_envelope(
                            409,
                            "idempotency_key_conflict",
                            "Idempotency-Key reused with a different request body.",
                        )
                        return
                    raw = cached.body.encode("utf-8")
                    self.send_response(cached.status)
                    self.send_header("Content-Type", cached.content_type)
                    self.send_header("Content-Length", str(len(raw)))
                    self.send_header("openwop-Idempotent-Replay", "true")
                    self.end_headers()
                    self.wfile.write(raw)
                    return

            run = state.runs.create_and_start(workflow_id, inputs)
            response_body = {
                "runId": run.run_id,
                "status": run.status,
                "workflowId": run.workflow_id,
                "startedAt": run.started_at,
            }
            response_text = json.dumps(response_body)

            if idempotency_key:
                cache_key = IdempotencyCache.cache_key("POST /v1/runs", idempotency_key)
                state.idempotency.put(
                    cache_key,
                    IdempotencyEntry(
                        status=201,
                        body=response_text,
                        content_type="application/json",
                        body_hash=incoming_body_hash,
                        stored_at=time.time(),
                    ),
                )

            raw = response_text.encode("utf-8")
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("openwop-Idempotent-Replay", "false" if idempotency_key else "")
            self.end_headers()
            self.wfile.write(raw)

        def _handle_get_run(self, run_id: str) -> None:
            if not self._check_auth():
                return
            run = state.runs.get(run_id)
            if run is None:
                self._send_error_envelope(404, "run_not_found", f"Unknown runId: {run_id}")
                return
            snapshot: dict[str, Any] = {
                "runId": run.run_id,
                "workflowId": run.workflow_id,
                "status": run.status,
                "inputs": run.inputs,
                "startedAt": run.started_at,
                "endedAt": run.ended_at,
            }
            if run.error is not None:
                snapshot["error"] = run.error
            self._send_json(200, snapshot)

        def _handle_cancel_run(self, run_id: str) -> None:
            if not self._check_auth():
                return
            self._read_body()
            run = state.runs.get(run_id)
            if run is None:
                self._send_error_envelope(404, "run_not_found", f"Unknown runId: {run_id}")
                return
            if run.is_terminal():
                self._send_json(200, {"runId": run_id, "status": run.status, "alreadyTerminal": True})
                return
            state.runs.cancel(run_id)
            self._send_json(200, {"runId": run_id, "status": "cancelling"})

        def _handle_pause_run(self, run_id: str) -> None:
            """POST /v1/runs/{runId}:pause per rest-endpoints.md §pause/resume.

            Body (optional):
                { "reason": "...", "drainPolicy": "drain-current-node | immediate" }

            This host implements `drain-current-node` only; `immediate`
            requests are refused with 422 `validation_error` +
            `details.unsupportedDrainPolicy` per the host's advertised
            `capabilities.runs.pauseResume.drainPolicies` array.

            Response: 202 + { runId, status: "paused", pausedAt: ISO8601 }.
            Already-paused / terminal / un-pausable: 409 +
            `details.runStatus` carrying the current state.
            """
            if not self._check_auth():
                return
            body_text = self._read_body()
            try:
                body = json.loads(body_text) if body_text else {}
            except json.JSONDecodeError:
                self._send_error_envelope(400, "validation_error", "Body MUST be valid JSON.")
                return
            if not isinstance(body, dict):
                self._send_error_envelope(400, "validation_error", "Body MUST be an object.")
                return
            drain_policy = body.get("drainPolicy", "drain-current-node")
            if drain_policy != "drain-current-node":
                self._send_error_envelope(
                    422,
                    "validation_error",
                    f'drainPolicy "{drain_policy}" is not supported by this host.',
                    {"details": {"unsupportedDrainPolicy": drain_policy,
                                 "supportedDrainPolicies": ["drain-current-node"]}},
                )
                return

            endpoint = f"POST /v1/runs/{run_id}:pause"
            idem_key, body_hash, replayed = self._check_layer1_idempotency(endpoint, body_text)
            if replayed:
                return

            run, outcome = state.runs.pause(run_id)
            if outcome == "not_found":
                self._send_error_envelope(404, "not_found", f"Unknown runId: {run_id}")
                return
            assert run is not None
            if outcome in ("terminal", "already_paused"):
                self._send_error_envelope(
                    409,
                    "validation_error",
                    f"Run {run_id} cannot be paused (current status: {run.status}).",
                    {"details": {"runStatus": run.status}},
                )
                return
            paused_at = _now_iso()
            response = {"runId": run_id, "status": "paused", "pausedAt": paused_at}
            self._store_idempotent(endpoint, idem_key, body_hash, 202, response)
            self._send_json(202, response)

        def _handle_resume_run(self, run_id: str) -> None:
            """POST /v1/runs/{runId}:resume per rest-endpoints.md §pause/resume.

            Response: 202 + { runId, status: "running", resumedAt: ISO8601 }.
            Not-paused / terminal: 409 + `details.runStatus`.
            """
            if not self._check_auth():
                return
            body_text = self._read_body()

            endpoint = f"POST /v1/runs/{run_id}:resume"
            idem_key, body_hash, replayed = self._check_layer1_idempotency(endpoint, body_text)
            if replayed:
                return

            run, outcome = state.runs.resume(run_id)
            if outcome == "not_found":
                self._send_error_envelope(404, "not_found", f"Unknown runId: {run_id}")
                return
            assert run is not None
            if outcome in ("terminal", "not_paused"):
                self._send_error_envelope(
                    409,
                    "validation_error",
                    f"Run {run_id} is not paused (current status: {run.status}).",
                    {"details": {"runStatus": run.status}},
                )
                return
            resumed_at = _now_iso()
            response = {"runId": run_id, "status": "running", "resumedAt": resumed_at}
            self._store_idempotent(endpoint, idem_key, body_hash, 202, response)
            self._send_json(202, response)

        def _handle_bulk_cancel(self) -> None:
            """POST /v1/runs:bulk-cancel per rest-endpoints.md §"Bulk cancel".

            Body:
                { "runIds": ["run-…", …], "reason"?: "string" }

            `runIds` MUST be a non-empty array of 1..MAX_BULK_CANCEL_RUN_IDS
            entries; oversized requests get 400 + `details.maxRunIds`.

            Response 200 + `{ results: [{runId, ok, status?, error?}] }`.
            Order of `results[]` MUST match the request's `runIds` order.
            """
            if not self._check_auth():
                return
            body_text = self._read_body()
            try:
                body = json.loads(body_text) if body_text else {}
            except json.JSONDecodeError:
                self._send_error_envelope(400, "validation_error", "Request body MUST be valid JSON.")
                return
            if not isinstance(body, dict):
                self._send_error_envelope(400, "validation_error", "Body MUST be an object.")
                return

            requested = body.get("runIds")
            if not isinstance(requested, list) or not requested:
                self._send_error_envelope(
                    400,
                    "validation_error",
                    "runIds MUST be a non-empty array of run-id strings.",
                )
                return
            if not all(isinstance(x, str) and x for x in requested):
                self._send_error_envelope(
                    400,
                    "validation_error",
                    "Every runIds entry MUST be a non-empty string.",
                )
                return
            if len(requested) > MAX_BULK_CANCEL_RUN_IDS:
                self._send_error_envelope(
                    400,
                    "validation_error",
                    f"runIds exceeds host cap ({len(requested)} > {MAX_BULK_CANCEL_RUN_IDS}).",
                    {"details": {"maxRunIds": MAX_BULK_CANCEL_RUN_IDS}},
                )
                return

            endpoint = "POST /v1/runs:bulk-cancel"
            idem_key, body_hash, replayed = self._check_layer1_idempotency(endpoint, body_text)
            if replayed:
                return

            results: list[dict[str, Any]] = []
            for rid in requested:
                run = state.runs.get(rid)
                if run is None:
                    results.append({
                        "runId": rid,
                        "ok": False,
                        "error": {"code": "not_found", "message": f"Unknown runId: {rid}"},
                    })
                    continue
                if run.is_terminal():
                    # Already-terminal runs report ok:true with the existing
                    # terminal status per rest-endpoints.md:118 ("re-issuing
                    # the same bulk request returns the same per-id outcomes
                    # — already-cancelled runs return ok: true, status:
                    # 'cancelled'"). Surfacing run_terminal as ok:false would
                    # break the documented re-issue idempotency.
                    results.append({"runId": rid, "ok": True, "status": run.status})
                    continue
                state.runs.cancel(rid)
                results.append({"runId": rid, "ok": True, "status": "cancelling"})

            response = {"results": results}
            self._store_idempotent(endpoint, idem_key, body_hash, 200, response)
            self._send_json(200, response)

        # ─── Webhooks ────────────────────────────────────────────────

        def _handle_register_webhook(self) -> None:
            """POST /v1/webhooks — register a signed-delivery subscriber.

            Body shape per webhooks.md §"Registering subscribers":
                {
                  "url": "https://receiver.example.com/openwop",
                  "secret": "<optional; host generates if absent>",
                  "eventTypes": ["run.completed", ...]   // optional; empty/absent = all
                }

            Response includes the secret EXACTLY ONCE — callers MUST persist
            it client-side; the host never re-issues a subscription's secret.
            """
            if not self._check_auth():
                return
            body_text = self._read_body()
            try:
                body = json.loads(body_text) if body_text else {}
            except json.JSONDecodeError:
                self._send_error_envelope(400, "validation_error", "Body MUST be valid JSON.")
                return
            if not isinstance(body, dict):
                self._send_error_envelope(400, "validation_error", "Body MUST be an object.")
                return

            url = body.get("url")
            if not isinstance(url, str) or not url:
                self._send_error_envelope(400, "validation_error", "url MUST be a non-empty string.")
                return
            secret = body.get("secret")
            if secret is not None and not isinstance(secret, str):
                self._send_error_envelope(400, "validation_error", "secret MUST be a string when provided.")
                return
            event_types = body.get("eventTypes")
            if event_types is not None and (
                not isinstance(event_types, list) or not all(isinstance(x, str) for x in event_types)
            ):
                self._send_error_envelope(
                    400, "validation_error", "eventTypes MUST be an array of strings when provided."
                )
                return

            try:
                sub = state.webhooks.register(url, secret=secret, event_types=event_types)
            except WebhookUrlRejected as e:
                # webhooks.md §"SSRF guard" — rejections surface as a
                # standard `validation_error` envelope with the
                # specific reason carried in details.reason. Using a
                # host-invented code would split the SDK's known
                # HTTP_ERROR_CODES catalog (see run-helpers.ts).
                self._send_error_envelope(
                    400,
                    "validation_error",
                    "webhook url rejected by SSRF guard",
                    {"details": {"reason": e.reason}},
                )
                return
            self._send_json(201, sub.to_public_dict())

        def _handle_unregister_webhook(self, subscription_id: str) -> None:
            """DELETE /v1/webhooks/{subscriptionId} — remove a subscriber."""
            if not self._check_auth():
                return
            removed = state.webhooks.unregister(subscription_id)
            if not removed:
                self._send_error_envelope(
                    404, "webhook_not_found", f"Unknown subscriptionId: {subscription_id}"
                )
                return
            self._send_json(200, {"subscriptionId": subscription_id, "deleted": True})

        def _handle_events_poll(self, run_id: str, query: str) -> None:
            if not self._check_auth():
                return
            run = state.runs.get(run_id)
            if run is None:
                self._send_error_envelope(404, "run_not_found", f"Unknown runId: {run_id}")
                return
            params = parse_qs(query)
            since_param = params.get("since", [None])[0]
            since = int(since_param) if since_param is not None and since_param.isdigit() else -1
            events = [e.to_dict() for e in iter_events_since(run, since)]
            last_seq = events[-1]["seq"] if events else since
            self._send_json(
                200,
                {
                    "runId": run_id,
                    "events": events,
                    "lastEventSeq": last_seq,
                    "runStatus": run.status,
                    "isTerminal": run.is_terminal(),
                },
            )

        def _handle_events_sse(self, run_id: str) -> None:
            if not self._check_auth():
                return
            run = state.runs.get(run_id)
            if run is None:
                self._send_error_envelope(404, "run_not_found", f"Unknown runId: {run_id}")
                return

            last_event_id_header = self.headers.get("Last-Event-ID", "")
            resume_after = -1
            try:
                resume_after = int(last_event_id_header) if last_event_id_header else -1
            except ValueError:
                resume_after = -1

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            def write_event(event: Any) -> bool:
                """Return False on broken pipe (client disconnected)."""
                try:
                    payload = (
                        f"id: {event.seq}\n"
                        f"event: {event.type}\n"
                        f"data: {json.dumps(event.to_dict())}\n\n"
                    ).encode("utf-8")
                    self.wfile.write(payload)
                    self.wfile.flush()
                    return True
                except (BrokenPipeError, ConnectionResetError):
                    return False

            # Drain backlog past the resume point.
            highest_emitted = resume_after
            for event in list(iter_events_since(run, resume_after)):
                if not write_event(event):
                    return
                highest_emitted = event.seq

            if run.is_terminal():
                return

            # Live tail.
            while True:
                wait_for_next_event_or_terminal(run, highest_emitted, timeout_s=25.0)
                pending = list(iter_events_since(run, highest_emitted))
                for event in pending:
                    if not write_event(event):
                        return
                    highest_emitted = event.seq
                    if event.type in {"run.completed", "run.failed", "run.cancelled"}:
                        return
                if run.is_terminal() and not pending:
                    return

        def _handle_debug_bundle(self, run_id: str) -> None:
            """GET /v1/runs/{runId}/debug-bundle — portable diagnostic export.

            Per spec/v1/debug-bundle.md + schemas/debug-bundle.schema.json:
              - bundleVersion MUST match `^[0-9]+\\.[0-9]+$` ("1.0" for v1.x).
              - metrics.eventCount MUST equal events.length (the count of
                events actually included in this response). When the event
                log is truncated, the original count is preserved separately
                in `truncatedOriginalCount` so callers can decide whether
                to re-request a paged view.
              - redactionApplied / redactionMode describe the masking policy
                in effect (this host uses `omit` — user-supplied inputs and
                event `data` payloads are dropped). Production hosts MAY use
                `mask` or `hash` per capabilities.compliance.defaultMode.

            Truncation policy: cap at MAX_EVENTS_PER_BUNDLE events. When
            exceeded, the first half + last half are kept (causally most-
            interesting envelopes; head-and-tail style) and `truncated: true`
            + `truncatedReason` is set.
            """
            if not self._check_auth():
                return
            run = state.runs.get(run_id)
            if run is None:
                self._send_error_envelope(404, "run_not_found", f"Unknown runId: {run_id}")
                return

            MAX_EVENTS_PER_BUNDLE = 1000
            original_event_count = len(run.events)
            truncated = original_event_count > MAX_EVENTS_PER_BUNDLE
            if truncated:
                # Head + tail (preserves run.started + recent activity).
                half = MAX_EVENTS_PER_BUNDLE // 2
                kept = list(run.events[:half]) + list(run.events[-half:])
            else:
                kept = list(run.events)

            node_ids = {e.node_id for e in kept if e.node_id is not None}

            # Redaction: omit event `data` payloads (may carry interrupt
            # configs, approval tokens, BYOK credentialRefs, LLM messages).
            # Receivers wanting the full payload MUST use authenticated
            # GET /v1/runs/{id} or specialized inspection endpoints.
            rendered_events = [
                {
                    "sequence": e.seq,
                    "type": e.type,
                    "timestamp": e.timestamp,
                    "nodeId": e.node_id,
                    # `data` intentionally omitted per redaction policy.
                }
                for e in kept
            ]

            bundle: dict[str, Any] = {
                "bundleVersion": "1.0",
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "host": {
                    "name": "openwop-host-in-memory-python",
                    "version": "1.0.0",
                    "vendor": "openwop-spec (reference example)",
                },
                "run": {
                    "runId": run.run_id,
                    "workflowId": run.workflow_id,
                    "status": run.status,
                    "inputs": {},  # redaction: omit user-supplied inputs
                    "startedAt": run.started_at,
                    "endedAt": run.ended_at,
                    "variables": {},
                    **({"error": run.error} if run.error else {}),
                },
                "events": rendered_events,
                "spans": [],
                "metrics": {
                    "nodeCount": len(node_ids),
                    "eventCount": len(rendered_events),
                },
                "redactionApplied": True,
                "redactionMode": "omit",
            }
            if truncated:
                bundle["truncated"] = True
                bundle["truncatedReason"] = "events_truncated_to_size_cap"
                bundle["truncatedOriginalCount"] = original_event_count
            self._send_json(200, bundle, {"Cache-Control": "no-store"})

    return Handler


def serve(host: str, port: int) -> tuple[ThreadingHTTPServer, _State, threading.Thread]:
    """Build + start the server. Returns (server, state, thread)."""
    state = _State()
    handler_cls = make_handler(state)
    server = ThreadingHTTPServer((host, port), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="openwop-host-http")
    thread.start()
    return server, state, thread

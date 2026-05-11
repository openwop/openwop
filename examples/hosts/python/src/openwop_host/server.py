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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse, parse_qs

from .fixtures import load_fixtures
from .idempotency import IdempotencyCache, IdempotencyEntry
from .runs import (
    RunRegistry,
    iter_events_since,
    wait_for_next_event_or_terminal,
)
import time

_RUN_ID_RE = re.compile(r"^/v1/runs/([^/]+)$")
_RUN_CANCEL_RE = re.compile(r"^/v1/runs/([^/]+)/cancel$")
_RUN_EVENTS_POLL_RE = re.compile(r"^/v1/runs/([^/]+)/events/poll$")
_RUN_EVENTS_SSE_RE = re.compile(r"^/v1/runs/([^/]+)/events$")
_RUN_DEBUG_BUNDLE_RE = re.compile(r"^/v1/runs/([^/]+)/debug-bundle$")


class _State:
    """Shared mutable state injected into the handler class."""

    def __init__(self) -> None:
        self.workflows: dict[str, dict[str, Any]] = load_fixtures()
        self.runs = RunRegistry(self.workflows)
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
            m = _RUN_CANCEL_RE.match(path)
            if m:
                self._handle_cancel_run(m.group(1))
                return
            self._send_error_envelope(404, "not_found", f"No route for POST {path}")

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
            if not self._check_auth():
                return
            run = state.runs.get(run_id)
            if run is None:
                self._send_error_envelope(404, "run_not_found", f"Unknown runId: {run_id}")
                return
            node_ids = {e.node_id for e in run.events if e.node_id is not None}
            bundle = {
                "bundleVersion": "1",
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
                    "inputs": {},  # redaction: omit user-supplied inputs from bundle
                    "startedAt": run.started_at,
                    "endedAt": run.ended_at,
                    "variables": {},
                    **({"error": run.error} if run.error else {}),
                },
                "events": [
                    {
                        "sequence": e.seq,
                        "type": e.type,
                        "timestamp": e.timestamp,
                        "nodeId": e.node_id,
                        "data": e.data,
                    }
                    for e in run.events
                ],
                "spans": [],
                "metrics": {
                    "nodeCount": len(node_ids),
                    "eventCount": len(run.events),
                },
                "redactionApplied": True,
                "redactionMode": "omit",
            }
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

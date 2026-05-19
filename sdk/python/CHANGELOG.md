# `openwop-client` Changelog

## [1.0 — additions] — 2026-05-19 — typed `agent.*` event helpers (RFC 0024)

- **New module** `openwop_client.events` exposing six `TypedDict` payload classes — `AgentReasonedPayload`, `AgentReasoningDeltaPayload`, `AgentToolCalledPayload`, `AgentToolReturnedPayload`, `AgentHandoffPayload`, `AgentDecidedPayload` — mirroring the canonical `schemas/run-event-payloads.schema.json` $defs.
- **Six runtime predicates** `is_agent_reasoned(ev)` / `is_agent_reasoning_delta(ev)` / `is_agent_tool_called(ev)` / `is_agent_tool_returned(ev)` / `is_agent_handoff(ev)` / `is_agent_decided(ev)` — return `True` only when the `type` discriminator matches AND the payload carries the required wire-contract fields with correct primitive types. `is_agent_reasoning_delta` validates `sequence` is a non-negative integer (and rejects `bool` despite Python's `int` subclassing).
- **Six typed extractors** `agent_*_payload(ev)` — return the typed payload on a match, `None` on a miss. Convenience for the `if (p := agent_reasoning_delta_payload(ev)) is not None:` idiom.
- Re-exports for all 19 new public symbols under `openwop_client.__all__`.
- 19 unittest cases in `tests/test_events.py` covering true-positive / true-negative matrix (incl. `bool`-as-`int` sequence rejection — Python's `bool` subclasses `int`), extractor `None`-on-miss, unknown-event-type tolerance per `COMPATIBILITY.md §2.1`, and schema-mirror sanity (reads the canonical JSON schema and asserts required-field parity per $def).
- Stdlib-only (`typing` + `json` + `pathlib` for tests). No third-party deps.

## [1.0 — additions] — 2026-05-15 — pause/resume helpers

- **New run-control helpers.** `OpenwopClient.runs_pause(run_id, body=None, *, idempotency_key=None)` calls `POST /v1/runs/{id}:pause`; `OpenwopClient.runs_resume(run_id, body=None, *, idempotency_key=None)` calls `POST /v1/runs/{id}:resume`. New dataclasses exported: `PauseRunRequest`, `PauseRunResponse`, `ResumeRunRequest`, `ResumeRunResponse`.

## [1.0 — additions] — 2026-05-12 — Phase B SDK helpers + pack-lockfile error codes

- **New methods for Phase B endpoints.** `OpenwopClient.runs_bulk_cancel(body, *, idempotency_key=None)` calls `POST /v1/runs:bulk-cancel` per `rest-endpoints.md` (closes R1); `OpenwopClient.audit_verify(from_seq, to_seq)` calls `GET /v1/audit/verify` per `auth-profiles.md` §`openwop-audit-log-integrity`. New dataclasses exported: `BulkCancelRunsRequest`, `BulkCancelRunsResponse`, `BulkCancelRunResult`, `AuditVerifyResult`, `AuditVerifyCheckpoint`, `AuditVerifyAnomaly`.
- **5 new pack-lockfile error codes** added to `HTTP_ERROR_CODES` per `node-packs.md` §"Dependency resolution + lockfile": `pack_integrity_mismatch`, `pack_signature_invalid`, `pack_peer_dependency_missing`, `pack_lockfile_incomplete`, `pack_version_not_found`. `is_http_error_code()` returns True for all.

## [1.0 — additions] — 2026-05-12 — capability_required error code

- `HTTP_ERROR_CODES` gains `"capability_required"` per `spec/v1/capabilities.md` §"Unsupported capability — refusal contract" (Phase A close-out). Emitted by hosts that refuse a workflow referencing a capability-gated typeId (`core.conversationGate`, `core.orchestrator.supervisor`, `core.dispatch`) without the advertised gating capability. `is_http_error_code("capability_required")` returns True.

## [1.0] — 2026-04-27

Aligned with openwop spec v1 final. Pinned to v1.0 alongside the spec corpus tag and the TypeScript + Go reference SDKs.

### What's covered

- All 12 documented REST endpoints have a 1:1 SDK method (discovery, workflows, runs lifecycle, SSE + poll events, cancel, fork, interrupt resolve by run + by token).
- `Idempotency-Key` supported on every mutation method via the `idempotency_key=` keyword argument.
- Canonical HTTP error-code helpers: `HTTP_ERROR_CODES` and `is_http_error_code()` for REST/MCP `ErrorEnvelope.error` branching.
- Synchronous-generator SSE consumer accepts `stream_mode` as a single value or a sequence (S4), accepts `buffer_ms=` query forwarding (S3), and transparently flattens `event: batch` arrays back into per-event yields.
- Trace-ID surfacing — `WopError` captures W3C `traceparent` from response headers and exposes `error.trace_id`; `str(error)` auto-suffixes `(trace=<id>)` per `observability.md` §Trace context propagation.
- Zero runtime dependencies — pure Python stdlib (`urllib`, `email`, `json`).

### v1.x additions

- Async client (`AsyncOpenwopClient` via `httpx`).
- Webhook subscription helpers.
- Hosted registry publishing helpers.
- Application-level retry helpers.

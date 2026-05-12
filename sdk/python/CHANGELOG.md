# `openwop-client` Changelog

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

# `openwopclient` Changelog

## [1.0] — 2026-04-27

Aligned with openwop spec v1 final. Pinned to v1.0 alongside the spec corpus tag and the TypeScript + Python reference SDKs.

### What's covered

- All 12 documented REST endpoints have a 1:1 SDK method (discovery, workflows, runs lifecycle, SSE + poll events, cancel, fork, interrupt resolve by run + by token).
- `Idempotency-Key` + `X-Dedup` supported on every mutation method via `MutationOptions{IdempotencyKey, Dedup}`.
- Canonical HTTP error-code helpers: `HTTPErrorCodes`, `HTTPError*` constants, and `IsHTTPErrorCode()` for REST/MCP `ErrorEnvelope.Error` branching.
- Channel-based SSE consumer (`StreamEvents`) accepts `StreamModes []StreamMode` (S4), accepts `BufferMs` query forwarding (S3), and transparently flattens `event: batch` arrays back into per-event channel sends. Buffered with 16 slots; backpressure on slow consumers.
- Trace-ID surfacing — `*WopError` captures W3C `Traceparent` from response headers and exposes `err.TraceID`; `err.Error()` auto-suffixes `(trace=<id>)` per `observability.md` §Trace context propagation.
- Zero external dependencies — pure stdlib Go (`net/http`, `encoding/json`, `bufio`).

### v1.x additions

- Webhook subscription helpers.
- Hosted registry publishing helpers.
- Application-level retry helpers.
- Builder-pattern API.

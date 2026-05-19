# `openwopclient` Changelog

## [1.0 — additions] — 2026-05-19 — typed `agent.*` event helpers (RFC 0024)

- **New file** `events.go` exposing typed payload structs for the six `agent.*` event types — `AgentReasonedPayload`, `AgentReasoningDeltaPayload`, `AgentToolCalledPayload`, `AgentToolReturnedPayload`, `AgentHandoffPayload`, `AgentDecidedPayload` — mirroring the canonical `schemas/run-event-payloads.schema.json` $defs.
- **Six predicates** `IsAgentReasoned(ev)` / `IsAgentReasoningDelta(ev)` / `IsAgentToolCalled(ev)` / `IsAgentToolReturned(ev)` / `IsAgentHandoff(ev)` / `IsAgentDecided(ev)` — return `true` only when the `Type` discriminator matches AND the payload carries the required wire-contract fields. `IsAgentReasoningDelta` accepts both `float64` (the default `json.Unmarshal` numeric type) and `int` for the `sequence` field; rejects negatives and non-integer floats.
- **Six unmarshaler helpers** `UnmarshalAgent*(ev) (payload, error)` — return the typed payload on a match. Returns the sentinel `ErrNotMatchingEvent` (checkable via `errors.Is`) on a type-discriminator mismatch, or a wrapped JSON-decode error on payload corruption. Internally re-marshals + decodes to preserve forward-compat (unknown JSON keys are silently dropped by the decoder).
- **`ReasoningVerbosity` type** plus three exported constants (`ReasoningVerbosityOff` / `ReasoningVerbositySummary` / `ReasoningVerbosityFull`).
- 7 test functions in `events_test.go` covering true-positives, true-negatives (bad sequence types incl. `bool`-as-int rejection, missing required fields, wrong field names for `agent.handoff`, non-map payloads, unknown event types), `Unmarshal*` error semantics, and a table-driven schema-mirror sanity test.
- `go vet` clean; `gofmt -l` clean for `events.go` + `events_test.go`. No new module deps.

## [1.0 — additions] — 2026-05-15 — pause/resume helpers

- **New run-control helpers.** `OpenwopClient.PauseRun(ctx, runID, body, opts)` calls `POST /v1/runs/{id}:pause`; `OpenwopClient.ResumeRun(ctx, runID, body, opts)` calls `POST /v1/runs/{id}:resume`. New types: `PauseRunRequest`, `PauseRunResponse`, `ResumeRunRequest`, `ResumeRunResponse`.

## [1.0 — additions] — 2026-05-12 — Phase B SDK helpers + pack-lockfile error codes

- **New methods for Phase B endpoints.** `OpenwopClient.BulkCancelRuns(ctx, body, opts)` calls `POST /v1/runs:bulk-cancel` per `rest-endpoints.md` (closes R1); `OpenwopClient.VerifyAuditLog(ctx, fromSeq, toSeq)` calls `GET /v1/audit/verify` per `auth-profiles.md` §`openwop-audit-log-integrity`. New types: `BulkCancelRunsRequest`, `BulkCancelRunsResponse`, `BulkCancelRunResult`, `AuditVerifyResult`, `AuditVerifyCheckpoint`, `AuditVerifyAnomaly`.
- **5 new pack-lockfile error constants** added to `HTTPErrorCodes` per `node-packs.md` §"Dependency resolution + lockfile": `HTTPErrorPackIntegrityMismatch`, `HTTPErrorPackSignatureInvalid`, `HTTPErrorPackPeerDependencyMissing`, `HTTPErrorPackLockfileIncomplete`, `HTTPErrorPackVersionNotFound`. `IsHTTPErrorCode()` returns true for all.

## [1.0 — additions] — 2026-05-12 — capability_required error code

- `HTTPErrorCapabilityRequired` constant added to `HTTPErrorCodes` slice per `spec/v1/capabilities.md` §"Unsupported capability — refusal contract" (Phase A close-out). Emitted by hosts that refuse a workflow referencing a capability-gated typeId (`core.conversationGate`, `core.orchestrator.supervisor`, `core.dispatch`) without the advertised gating capability. `IsHTTPErrorCode("capability_required")` returns true.

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

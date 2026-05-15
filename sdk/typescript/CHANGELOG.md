# `@openwop/openwop` Changelog

## [1.0 — additions] — 2026-05-15 — pause/resume helpers

- **New run-control helpers.** `client.runs.pause(runId, body?, opts?)` calls `POST /v1/runs/{id}:pause`; `client.runs.resume(runId, body?, opts?)` calls `POST /v1/runs/{id}:resume`. New exported types: `PauseRunRequest`, `PauseRunResponse`, `ResumeRunRequest`, `ResumeRunResponse`.

## [1.0 — additions] — 2026-05-12 — Phase B SDK helpers + pack-lockfile error codes

- **New helpers for Phase B endpoints.** `client.runs.bulkCancel(body, opts?)` calls `POST /v1/runs:bulk-cancel` per `rest-endpoints.md` (closes R1); `client.audit.verify(fromSeq, toSeq)` calls `GET /v1/audit/verify` per `auth-profiles.md` §`openwop-audit-log-integrity`. New types exported: `BulkCancelRunsRequest`, `BulkCancelRunsResponse`, `BulkCancelRunResult`, `AuditVerifyResult`, `AuditVerifyCheckpoint`, `AuditVerifyAnomaly`.
- **5 new pack-lockfile error codes** added to `HTTP_ERROR_CODES` per `node-packs.md` §"Dependency resolution + lockfile": `pack_integrity_mismatch`, `pack_signature_invalid`, `pack_peer_dependency_missing`, `pack_lockfile_incomplete`, `pack_version_not_found`. `isHttpErrorCode()` narrows correctly.

## [1.0 — additions] — 2026-05-12 — capability_required error code

- `HTTP_ERROR_CODES` gains `'capability_required'` per `spec/v1/capabilities.md` §"Unsupported capability — refusal contract" (Phase A close-out). Emitted by hosts that refuse a workflow referencing a capability-gated typeId (`core.conversationGate`, `core.orchestrator.supervisor`, `core.dispatch`) without the advertised gating capability. `isHttpErrorCode('capability_required')` narrows correctly.

## [1.0] — 2026-04-27

Aligned with openwop spec v1 final. Pinned to v1.0 alongside the spec corpus tag and the Python + Go reference SDKs.

### What's covered

- All 12 documented REST endpoints have a 1:1 SDK method (discovery, workflows, runs lifecycle, SSE + poll events, cancel, fork, interrupt resolve by run + by token).
- `Idempotency-Key` supported on every mutation method via the `idempotencyKey` option.
- Canonical HTTP error-code helpers: `HTTP_ERROR_CODES`, `HttpErrorCode`, and `isHttpErrorCode()` for REST/MCP `ErrorEnvelope.error` branching. `RUN_ERROR_CODES` remains scoped to `RunSnapshot.error.code`.
- Typed `RunConfigurable` surface with reserved keys (`recursionLimit`, `model`, `temperature`, `maxTokens`, `promptOverrides`) plus pass-through for impl extensions.
- SSE consumer accepts `streamMode` as a single value or an array (S4), accepts `bufferMs` query forwarding (S3), and transparently flattens `event: batch` arrays back into per-event yields so existing consumers don't change.
- Trace-ID surfacing — `WopError` captures W3C `traceparent` from response headers and exposes `error.traceId`; `error.toString()` auto-suffixes `(trace=<id>)` per `observability.md` §Trace context propagation.
- Zero runtime dependencies. Hand-authored to mirror the OpenAPI surface 1:1 (rationale in README §rationale).

### v1.x additions

- Webhook subscription helpers.
- Hosted registry publishing helpers.
- Application-level retry helpers.
- Dedicated browser entrypoint (`@openwop/openwop/browser`).

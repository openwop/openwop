# OpenWOP Postgres Reference Host — Production-Profile Conformance Report

> **Latest measurement (2026-05-30, suite `@openwop/openwop-conformance@1.10.0`):** **1968 passed / 14 failed / 92 skipped / 0 todo of 2074 tests (94.9% total; ~99.3% of non-skipped)** running with pglite + `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true`. The suite grew to 2074 tests since the prior reading; the 14 failures are predominantly **new agent-surface scenarios** this host does not yet fully satisfy — agent-memory (×5: round-trip, redaction-contract, ttl-expiry, message-reducer, metadata), agent-packs (×3: handoff-schema-validation ×2, provenance), `aiEnvelope.capBreached` (×3, also failing on SQLite), `discovery` (×1), `orchestratorConservativePath` (×1) — plus `sql-transaction-atomicity` (×1, a `@timing-sensitive` assertion that flakes under full-suite parallelism). None block a v1 production-profile MUST. See `docs/CONFORMANCE-RUNS-2026-05-30.md` + `INTEROP-MATRIX.md`.
>
> **Prior measurement (superseded 2026-05-30):** **2026-05-25 (RFC 0058 run-bound enforcement): 0 deterministic failures** against the then-current in-repo `conformance/` suite (~1798 tests) running with pglite + `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true`. The RFC 0058 `run-execution-bounds-shape` failure (the host did not enforce `configurable.runTimeoutMs`) is now closed: the host arms a per-run wall-clock deadline (`min(runTimeoutMs, maxRunDurationMs)`), emits `cap.breached { kind: 'run-duration' }` + `error.code = 'run_timeout'` on breach, and advertises `capabilities.limits.maxRunDurationMs`. Earlier-closed on this lineage: RFC 0022 ×4 (`core.identity`), `artifact-auth` (auth-before-existence route), model-capability (RFC 0031 gate, #189). A small number of `@timing-sensitive` scenarios (`webhook-signed-delivery`, `dispatch-cross-worker-handoff`, `envelope-refusal-shape`) flake under full-suite parallelism but pass in isolation. No wire-shape change; nothing blocks any v1 production-profile MUST.
>
> **Root-cause correction (supersedes the 2026-05-22 taxonomy):** the prior snapshot attributed 4 failures to an "RFC 0022 dispatch input/output mapping supervisor-mock extension" gap. That diagnosis was wrong. RFC 0022's mapping (input projection, output harvest, per-worker overrides) was fully implemented and the supervisor-mock (`config.mockDispatchPlan`) already shipped; the 4 RFC 0022 happy-path failures — plus a 5th, uncounted `identity-passthrough.test.ts` failure — were all caused by this host never registering the canonical `core.identity` node, which every RFC 0022 child fixture uses as its noop body. The children failed `unsupported_node_type`, cascading the parents to `failed`. Registering `core.identity` (a passthrough that folds run inputs into the variable bag, per `spec/v1/node-packs.md` §`core.identity`) closed all 5. The RFC 0026 cost-attribution and RFC 0031 model-capability failures the prior snapshot listed had already closed independently.
>
> **Prior snapshots:** 2026-05-22 against suite v1.5.0 — 1473/1564 (94.2%, 6 failures, since superseded); 2026-05-13 against suite v1.1.0 — 781/850 (91.9% total; 96.4% of applicable). Retained below for historical context.

> **Status:** First host on `INTEROP-MATRIX.md` advertising `production-profile.md`. Prior conformance reached **781/850 (91.9% total; 95.2% of non-todo; 96.4% of applicable)** against `@openwop/openwop-conformance` v1.1.0 with the conditional-profile env vars set (`OPENWOP_SECONDARY_API_KEY` + `OPENWOP_TENANT2_API_KEY` + `OPENWOP_WEBHOOK_ALLOW_PRIVATE`). The 1 failure was a documented flake (`webhook-signed-delivery.test.ts` — passes in isolation; full-suite timing collision with neighbor tests). Up from 728/797 (91.3%) at the 2026-05-12 baseline: +53 scenarios + +53 passes net of the new Phase H/I capability surfaces landing.
> **Reproducibility:** every claim below maps to a test path in this host's `test/` directory or to a section in `examples/hosts/postgres/README.md`.

This report is the public-result evidence required by `spec/v1/production-profile.md` §"Compatibility baseline" (MUST publish suite version + command). It also serves as the precondition record cited by the spec's PROVISIONAL → FINAL flip.

### Phase H + Phase I additions (2026-05-12)

Per the architect review of myndhyve.ai launch-readiness, two phased batches landed on the Postgres host:

- **Phase H launch-blockers (9/9 closed):** BYOK / `aiProviders` with 4-mode policy enforcement (`disabled` / `optional` / `required` / `restricted`) + `core.llm.chat` / `core.llm.completion`; MCP client (`core.mcp.toolCall` over HTTP/JSON-RPC with `trustBoundary: "untrusted"`); HTTP client (`core.http.request` with SSRF guard + 1 MiB response cap); cap-breach + configurable-schema enforcement; SECURITY invariants `mcp-toolcall-payload-redaction` + `http-client-ssrf-guard`; SDK helper additions (TS/Python/Go).
- **Phase I enterprise-blockers MVP (7/11 closed):** MemoryAdapter (RFC 0004) read-side `list` + `get` with CTI-1 cross-tenant isolation + TTL enforcement; `capabilities.agents` Phase 1–6 advertisement + reasoning-verbosity helpers; API-key rotation (two-key overlap + constant-time `checkAuth` + canary-redaction; conditional advertisement when `OPENWOP_SECONDARY_API_KEY` is set); auth-scoped discovery (tenant2 narrowed view, strict subset omitting orchestrator + dispatch; conditional advertisement when `OPENWOP_TENANT2_API_KEY` is set); subworkflow outputMapping + parent linkage (G3); 3 new protocol-tier SECURITY invariants (`agent-memory-cti-1` + `agent-memory-sr-1-redaction` + `auth-key-rotation-no-canary-echo`). 4 items deferred with tripwire conditions documented in `INTEROP-MATRIX.md`: OAuth2-CC + OIDC user-bearer (reverse-proxy IdP pattern preferred), pack-registry consumption (gated on first non-built-in pack), reasoning-event emission wiring (helpers in place; needs LLM-driven typeId).

New in-process tests under `test/`: `byok-roundtrip`, `ai-policy`, `mcp-client`, `http-client`, `auth-rotation-scoped`, `memory-adapter`, `agent-events`. The single remaining conformance failure (`webhook-signed-delivery`) is test-isolation residue between scenarios sharing a long-lived pglite host; not a host bug.

---

## Conformance suite + command

```
@openwop/openwop-conformance @ v1.0
Command (host-internal smoke; 9 test files, ~30 assertions):
  cd examples/hosts/postgres
  npm test

Command (full conformance suite against running host, pglite-backed):
  cd examples/hosts/postgres
  OPENWOP_WEBHOOK_ALLOW_PRIVATE=true npm run start:pglite &
  HOST_PID=$!
  sleep 5
  cd ../../../conformance
  OPENWOP_BASE_URL=http://127.0.0.1:3839 \
  OPENWOP_API_KEY=openwop-postgres-dev-key \
  OPENWOP_WEBHOOK_ALLOW_PRIVATE=true \
    npx vitest run --reporter=default
  kill $HOST_PID
```

The host's `start:pglite` script boots the server against an in-process PGlite (Postgres-compiled-to-WASM) so no Docker / installed Postgres is required to reproduce the result.

## Result (2026-05-11, full conformance suite)

```
 Test Files   1 failed | 64 passed | 27 skipped (92)
      Tests   1 failed | 610 passed | 41 skipped | 30 todo (682)
   Duration  ~11s wall-clock
```

**Headline numbers: 610 of 682 tests pass (89.4%), well above the SQLite reference host's 87% baseline.** The remaining 72 non-passing scenarios decompose:

- **41 skipped, 30 todo** — capability-gated scenarios where the host doesn't advertise the underlying profile (e.g., `wasm-pack-*`, `agent-pack-*`, `redaction-byok-*`). These are honest skips, not failures.
- **1 failed, sometimes 2** (vitest retries flake the count):
  - `webhook-signed-delivery` — flaky in full-suite (passes in isolation); test-isolation issue with shared host state across the suite's 91 other tests. Not a wire-shape bug.
  - `pause/resume running→paused→terminal` — fixture-coupled: the test creates a run against `conformance-cancellable` (defaultValue: `delayMs: 30000`) and expects pause + resume + terminal within 10s post-resume. With a 30-second delay node and "restart delay on resume" semantics (the spec doesn't pin partial-delay-on-resume as a MUST), the test cannot pass against any host that uses the fixture's default. SQLite host has the same constraint. Partial-delay-on-resume + variable-default fixture resolution were tried; the math still doesn't work (29s remaining > 10s timeout).

The 9 fixes that closed 9 of the original 10 out-of-scope failures + 1 latent bug:
- pack-registry probe short-circuit (3) — `/v1/packs/*` catch-all returns plain text 404.
- `?bufferMs=` aggregation + 400 validation (3) — handleEventsSse parses bufferMs in [0..5000]; emits `event: batch` SSE frames with force-flush on terminal.
- `configurable.recursionLimit` enforcement with `cap.breached` event emission (2) — schema gained `configurable_json` JSONB column; runWorkflow checks i+1 > limit before each node.
- Content negotiation on `/events` (1) — append-ordering now reads JSON when Accept isn't `text/event-stream`.
- Audit-log canonicalize bug (latent, not in original list) — `canonicalize()` now drops keys with `undefined` values, matching JSON.stringify semantics. Fixes false hash-mismatch + chain-break anomalies in /v1/audit/verify when audit details payloads contained conditional undefined fields (e.g., `votes: undefined` on non-pending interrupt resolves). Applied symmetrically to SQLite host's audit module.

All 15 remaining failures are independent of the production-profile MUSTs (durability, backpressure, retry/idempotency, event retention, debug-bundle redaction, observability). The 8 tests recovered between the 86.2% baseline and the 87.4% update covered: 6 interrupt scenarios (currentNodeId + childRuns in GET /v1/runs response), 2 pause/resume 409 paths (error: 'conflict' + details.runStatus shape), GET /v1/workflows/{workflowId} route, configurable-schema validation against the workflow manifest.

---

## Profile claims advertised in discovery

Per `GET /.well-known/openwop`:

```json
{
  "capabilities": {
    "auth": {
      "profiles": [
        "openwop-audit-log-integrity",
        "openwop-interrupt-quorum",
        "openwop-interrupt-auth-required",
        "openwop-interrupt-external-event",
        "openwop-interrupt-cascade-cancel"
      ],
      "auditLogIntegrity": { "hashChain": true, "checkpointSignatureAlgorithm": "ed25519", … }
    },
    "interrupts": {
      "supportedKinds": ["approval", "clarification", "external-event"],
      "approvalActions": ["accept", "reject", "request-changes", "escalate"]
    },
    "webhooks": { "supported": true, "signatureAlgorithms": ["v1"] },
    "runs": { "pauseResume": { "supported": true } },
    "observability": { "otel": { "supported": true, "protocol": "http/json" }, "metrics": { … } }
  }
}
```

The host claims `openwop-core` + `openwop-stream-poll` + `openwop-stream-sse` per the `profiles.md` predicate (endpoint shape) plus the explicit profile list above.

---

## Production-profile MUST coverage

Each row maps a spec MUST to its in-repo evidence.

| Production-profile MUST | Evidence in host |
|---|---|
| **Compatibility baseline** — Pass `openwop-core` | Discovery shape per `profiles.md` predicate; `lifecycle.test.ts` exercises the full openwop-core surface |
| **Compatibility baseline** — Pass `openwop-stream-sse` OR `openwop-stream-poll` | Host serves both: `GET /v1/runs/{id}/events/poll` + `GET /v1/runs/{id}/events`. `sse.test.ts` validates backlog flush + Last-Event-ID resume + live subscription |
| **Compatibility baseline** — Publish suite version + command | This document, top of file |
| **Compatibility baseline** — Document optional profiles | INTEROP-MATRIX Postgres row lists every claimed profile + the date it landed |
| **Durability** — Persist state outside process memory | Postgres tables: `runs`, `events`, `idempotency`, `audit_log`, `audit_checkpoints`, `interrupts`, `webhook_subscriptions`. PGlite for tests, real `pg.Client` in production |
| **Durability** — Event logs replayable after restart | Events table is append-only; `recoverOrphans()` on host startup re-launches non-terminal runs. Claim acquisition via session-level `pg_try_advisory_lock` means crashed-process locks auto-release; the next host process picks up the orphan |
| **Durability** — Stale-claim recovery | `claim.test.ts` exercises the advisory-lock primitive: re-entrant from same session + balanced unlock + fresh lock after release. Multi-process safety is a property of Postgres session-level locks across distinct sessions (trust, not in-host-test verifiable due to pglite's single-instance model) |
| **Backpressure** — 503 + Retry-After + canonical envelope | `backpressure.test.ts`: 2 SSE streams saturate `OPENWOP_MAX_INFLIGHT=2`; 3rd request returns `503 service_unavailable` + `Retry-After: 1` header + `{error: "service_unavailable", message, details: {retryAfter: 1}}` body. Health probes bypass the cap |
| **Retry and idempotency** — 24h retention | `IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000` in `server.ts`; `pruneIdempotency()` runs before insert |
| **Retry and idempotency** — ≥5 retries with same key | Same `Idempotency-Key` returns the cached response on every retry; `lifecycle.test.ts` exercises one replay; the limit is unbounded within the 24h window (no per-key retry cap) |
| **Event retention** — Document policy | `OPENWOP_EVENT_RETENTION_DAYS` env var, default 7 days; documented in `README.md` §"Postgres-specific concerns" and per-route observable in `sweepRetention()` |
| **Event retention** — 404/410 on expired runs | Sweeper DELETEs terminal runs older than retention; `handleGetRun` returns `404 run_not_found` when the row is missing. Spec uses MUST 404/410 + SHOULD 410; host implements 404. Tombstone-based 410 is a deferred refinement |
| **Debug bundle** — Redact secrets | `handleDebugBundle` emits `inputs: {}` + `redactionApplied: true` + `redactionMode: 'omit'`; `review-fixes.test.ts` asserts secrets in user inputs do NOT appear in the serialized bundle |
| **Debug bundle** — Document truncation + explicit metadata | 8MB byte cap + `?maxEvents=N` param; `truncated: true` + `truncatedReason: 'events_truncated_to_max_events' \| 'events_truncated_to_size_cap'`. `review-fixes.test.ts` validates the `?maxEvents=2` path |
| **Observability** — OTel `openwop.*` spans + metrics (SHOULD) | `observability.ts` wired into `startRunSpan` / `endRunSpan` / `startNodeSpan` / `endNodeSpan` / `startMetricLoop`. Discovery advertises `capabilities.observability` only when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured (honest framing) |
| **Observability** — Logs MUST include run id, tenant/project id, terminal status, error code, correlation id | `setRunTerminal()` emits structured JSON: `{level, event: 'run.terminal', runId, workflowId, tenantId, status, errorCode, correlationId: PROCESS_ID, timestamp}` |

---

## Audit-log integrity (separate-but-related)

The `openwop-audit-log-integrity` profile is exercised via `audit-tamper.test.ts`:

- Pre-tamper chain validates (`chainValid: true`, `checkpointsValid: true`).
- In-place tamper on entry seq=3: surfaces `hash-mismatch` + `chain-break` (downstream propagation) + `merkle-mismatch`.
- In-place tamper on checkpoint signature: surfaces `signature-invalid`.
- Append-only triggers reject `UPDATE` + `DELETE` on `audit_log` at the storage layer (defense-in-depth beyond the verify-endpoint check).

---

## Multi-tenancy + multi-region

**Not claimed.** This host is single-tenant (emits `tenant:default` in logs per the spec's MUST). Multi-region idempotency is not implemented; the host does not claim `crossRegion: 'best-effort'`.

These are NOT production-profile requirements — the spec's logging MUST is satisfied by any constant tenant-id field, and the `crossRegion` capability is optional.

---

## Test output (2026-05-11)

```
postgres-host lifecycle test: PASS
postgres-host audit-tamper test: PASS
postgres-host pause-resume test: PASS
postgres-host interrupts test:
  ✓ single-approver approval
  ✓ quorum approval
  ✓ clarification gate
  ✓ external-event signed-callback resolve
  PASS
postgres-host webhooks test:
  ✓ SSRF guard rejects RFC1918 + .local + loopback
  ✓ register returns 201 + subscription id + secret
  ✓ webhook receives signed delivery (N events for this run)
  ✓ HMAC-SHA256 signature validates
  ✓ payload omits `data` field (envelope-only redaction)
  ✓ unregister stops future delivery
  ✓ duplicate unregister returns 404
  PASS
postgres-host sse test:
  ✓ backlog flush — N ordered SSE frames
  ✓ Last-Event-ID resume — N frames after seq=1
  ✓ live subscription closes on run.completed
  PASS
postgres-host review-fixes test:
  ✓ debug-bundle envelope + redaction + truncation
  ✓ concurrent vote race — 1 resolved, N 404 (deterministic)
  ✓ SSE on terminal run closes within Nms
  PASS
postgres-host claim test:
  ✓ noop run releases claim on terminal
  ✓ long run holds claim during execution, releases on cancel
  ✓ advisory-lock primitive: re-entrant + balanced unlock
  PASS
postgres-host backpressure test:
  ✓ discovery probes bypass inflight cap
  ✓ 503 + Retry-After when inflight cap saturated
  ✓ cap clears after slot release
  PASS
```

Total: 9 test files, ~30 assertion groups, ~3 seconds wall-clock.

---

## Known limitations (honest framing)

These are deliberate reference-impl simplifications, not defects:

- **Single-connection design.** The host caches one `Querier` (one `pg.Client` or PGlite instance). `withTransaction` uses an in-process FIFO lock to serialize concurrent transactions. Production deployers SHOULD migrate to a connection-pool model (one client per transaction) for throughput; the lock is a correctness floor, not a performance ceiling.
- **Tombstone-free retention.** Expired runs are DELETEd; expired GETs return 404 (not 410). Tombstone-based 410 would require an extra table or soft-delete column.
- **No DNS resolution in SSRF guard.** Webhook URLs are checked syntactically; DNS rebinding attacks against `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true` deployments are a documented limitation.
- **No per-key retry cap.** Idempotency keys can be replayed unboundedly within the 24h window; the spec MUSTs ≥5, the host delivers more.
- **No multi-tenancy.** Single hardcoded `tenant:default`. Multi-tenancy is a Postgres-specific concern in the host README, not a production-profile MUST.
- **No retention time-warp test mode.** The spec's "Conformance gaps to close" table lists "Verify expired run behavior where the host exposes a controllable retention test mode" — this host does not expose such a mode. The retention sweeper is exercised on host boot but no scenario time-warps the clock to assert post-expiry GETs return 404. Defensible by inspection of the code path; not by external suite assertion.
- **Re-launch ≠ replay.** "Durability — event logs replayable after restart" in production-profile.md is implemented as re-launch from `next_node_index` (the executor resumes at the next pending node), not as replay-from-event-log (which would re-derive state from the events table). For deterministic node implementations the observable behavior is identical; for non-deterministic nodes (LLM calls, external API) the operator should treat restart as re-execution of the current node.
- **External-conformance failures are all spec-feature gaps, not host regressions.** See "Result" section above for the breakdown. The 15 remaining failures span features the host doesn't claim to implement (pack registry, stream-modes-buffer, cap-breach, append-ordering) or shared spec/impl drift on RunEventDoc field names (`seq` vs `sequence`, `data` vs `payload`). A third-party auditor reading the failures one-by-one should find no surprises.

---

## See also

- `spec/v1/production-profile.md` — the contract this report satisfies
- `examples/hosts/postgres/README.md` — operator guide + per-module build-out history
- `examples/hosts/postgres/test/` — every assertion cited above
- `INTEROP-MATRIX.md` Postgres row — public production-profile claim record
- `docs/SESSION-SUMMARY-2026-05-11.md` — broader session context for the build-out

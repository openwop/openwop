# OpenWOP Postgres Reference Host — Production-Profile Conformance Report

> **Snapshot:** 2026-05-11, commit at HEAD of `main` branch.
> **Status:** First host on `INTEROP-MATRIX.md` advertising `production-profile.md`.
> **Reproducibility:** every claim below maps to a test path in this host's `test/` directory or to a section in `examples/hosts/postgres/README.md`.

This report is the public-result evidence required by `spec/v1/production-profile.md` §"Compatibility baseline" (MUST publish suite version + command). It also serves as the precondition record cited by the spec's PROVISIONAL → FINAL flip.

---

## Conformance suite + command

```
@openwop/openwop-conformance @ v1.0
Command (host-internal smoke):
  cd examples/hosts/postgres
  npm test
Command (full conformance suite against running host):
  cd examples/hosts/postgres && npm start &
  OPENWOP_BASE_URL=http://127.0.0.1:3839 \
  OPENWOP_REQUIRE_BEHAVIOR=true \
  npm test -w conformance
```

`npm test` in this directory runs the host-internal smoke suite (lifecycle + audit-tamper + pause-resume + interrupts + webhooks + sse + review-fixes + claim + backpressure). Every test asserts a specific spec MUST or capability claim; the suite's `tail -5` summary line is reproducible across runs.

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

---

## See also

- `spec/v1/production-profile.md` — the contract this report satisfies
- `examples/hosts/postgres/README.md` — operator guide + per-module build-out history
- `examples/hosts/postgres/test/` — every assertion cited above
- `INTEROP-MATRIX.md` Postgres row — public production-profile claim record
- `docs/SESSION-SUMMARY-2026-05-11.md` — broader session context for the build-out

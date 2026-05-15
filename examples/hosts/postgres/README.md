# OpenWOP Postgres Reference Host

> **Status: WIRE-SURFACE PARITY (2026-05-11).** Run lifecycle + audit-log integrity + interrupts (4 profiles) + webhooks (HMAC v1 + SSRF guard) + SSE event stream + observability + debug-bundle + pause/resume all wired and tested against pglite in-process. Claim acquisition via Postgres advisory locks + backpressure (503/Retry-After) + event-retention sweeper are the remaining gates before this host can claim the `production` scale tier. Track 7 ports complete; the FINAL-flip preconditions are tracked at the bottom of this README.

---

## What works today

```
Wire surface advertised:
  GET  /.well-known/openwop          ✅
  GET  /v1/openapi.json              ✅
  POST /v1/runs                      ✅  (with Idempotency-Key replay)
  GET  /v1/runs/{runId}              ✅
  POST /v1/runs/{runId}/cancel       ✅
  GET  /v1/runs/{runId}/events/poll  ✅
  GET  /v1/runs/{runId}/debug-bundle  ✅
  POST /v1/runs/{runId}:pause         ✅
  POST /v1/runs/{runId}:resume        ✅
  GET  /v1/audit/verify              ✅
  POST /v1/runs/{runId}/interrupts/{nodeId}  ✅
  POST /v1/interrupts/{token}                ✅
  POST /v1/webhooks                          ✅
  DELETE /v1/webhooks/{subscriptionId}       ✅
  GET  /v1/runs/{runId}/events       ✅  (SSE with Last-Event-ID resume)

Node types in executor:
  core.noop                          ✅
  core.delay                         ✅
  core.approvalGate                  ✅
  core.clarificationGate             ✅
  core.interrupt                     ✅
  core.subWorkflow                   ✅
```

Discovery advertises `capabilities.auth.profiles: ['openwop-audit-log-integrity']` + the audit-log-integrity capability block (hashChain, Ed25519 checkpoint signature, public key, checkpoint cadence). All other profile claims fill in as the corresponding modules port over.

## Quick test (no Postgres install required)

```bash
cd examples/hosts/postgres
npm install     # pulls pg + @electric-sql/pglite (Postgres-on-WASM)
npm test        # spins up pglite in-process, boots the host, runs the full suite
```

`npm test` runs every `test/*.test.ts` file in series plus `npm run test:auth-rotation` (which sets `OPENWOP_API_KEY` + `OPENWOP_SECONDARY_API_KEY` + `OPENWOP_TENANT2_API_KEY` for the rotation-only scenario). As of 2026-05-15 the suite covers the original 9 wire-surface tests (lifecycle, audit-tamper, pause-resume, interrupts, webhooks, sse, claim, backpressure, review-fixes) plus 16 gap-closure additions touching agent events, BYOK + 4-mode AI policy, MCP, HTTP, memory adapter + RFC 0012 compaction, mTLS, multi-region idempotency + partition resolver, OAuth2/OIDC, pack consumer, reasoning events, audit-checkpoint export, API-key rotation. Total wall-clock ~90s.

Each test file is invoked as a separate `tsx` process. This is intentional — many tests set environment variables BEFORE dynamic-importing `src/server.ts` (e.g., `OPENWOP_MEMORY_COMPACTION`, `OPENWOP_FORCE_RATE_LIMIT`, `OPENWOP_MTLS_*`, `OPENWOP_AUDIT_KEY_DIR`), and the server module captures those values at evaluation time. Sharing a process across tests would leak earlier configurations into later imports. The cold-start cost is ~3s per file; collapsing into a single vitest run would require careful per-suite env restoration and is deferred.

## Running against a real Postgres

```bash
export OPENWOP_PG_DSN=postgres://user:pass@localhost:5432/openwop
export OPENWOP_PORT=3839
export OPENWOP_API_KEY=...
npm start
```

The host's `setupSchema()` creates `runs`, `events`, and `idempotency` tables if missing. For production, run that DDL via your migrator of choice and skip `setupSchema()` — see `src/schema.ts`.

## Architecture

```
src/
├── server.ts        # HTTP routes + executor (~700 LOC, async throughout)
├── schema.ts        # CREATE TABLE IF NOT EXISTS for runs/events/idempotency
├── audit.ts         # audit-log integrity (hash chain + Ed25519 checkpoints)
├── db.ts            # Querier interface (pg.Client + PGlite both satisfy)
└── observability.ts # OTel emitter (copied from SQLite host; not yet wired)

test/
├── lifecycle.test.ts                  # End-to-end wire-surface assertions via PGlite
├── audit-tamper.test.ts               # Host-internal tamper detection (entry + checkpoint + trigger)
├── audit-checkpoint-export.test.ts    # Portable checkpoint export + standalone verifier (CF-11)
├── pause-resume.test.ts               # Pause/resume routes + paused outcome
├── interrupts.test.ts                 # Quorum + auth-required + external-event + cascade-cancel
├── webhooks.test.ts                   # HMAC v1 signing + SSRF guard
├── sse.test.ts                        # SSE event stream + Last-Event-ID resume
├── review-fixes.test.ts               # Code-review carryover assertions
├── claim.test.ts                      # Postgres advisory-lock claim acquisition
├── backpressure.test.ts               # 503/Retry-After + event-retention sweeper
├── agent-events.test.ts               # AgentRef + handoff + decision events
├── ai-policy.test.ts                  # 4-mode BYOK policy per provider
├── byok-roundtrip.test.ts             # BYOK secret resolver + SR-1 redaction
├── byok-cross-provider.test.ts        # 3 providers × 4 modes redaction matrix (SEC-6)
├── http-client.test.ts                # core.http.request + SSRF guard + 1 MiB cap
├── mcp-client.test.ts                 # core.mcp.toolCall over JSON-RPC, trustBoundary untrusted
├── memory-adapter.test.ts             # CTI-1 cross-tenant isolation + SR-1 redaction
├── memory-compaction.test.ts          # RFC 0012 host-managed scheduler + carry-forward redaction
├── mtls.test.ts                       # openwop-auth-mtls advertisement + handshake (Phase I.7)
├── multi-region-idempotency.test.ts   # Resolver unit test (annex)
├── multi-region-partition.test.ts     # End-to-end partition simulation (CF-12/OPS-5)
├── oauth2-oidc.test.ts                # JWT validator + JWKS cache (Phase I.3/I.4)
├── pack-consumer.test.ts              # Install-time integrity + Ed25519 sig + version drift (PACK-1/2)
├── reasoning-event-emission.test.ts   # agent.reasoned + agent.decided + agent.toolCalled/Returned
└── auth-rotation-scoped.test.ts       # API-key rotation + auth-scoped discovery (Phase I.5/I.6)
```

`db.ts` defines a minimal `Querier` interface — `query(sql, params)` returning `{rows, rowCount}`. Both `pg.Client` and `PGlite` satisfy it. The host accepts an injected Querier via `setQuerier(...)` for tests; otherwise it opens `pg.Client` against `OPENWOP_PG_DSN`.

## Build-out plan (remaining)

Each item is a follow-up session. Order doesn't matter much; pick the one that unblocks the most conformance scenarios per unit of work.

### Per-module ports from the SQLite host

| Source | Postgres equivalent | Approximate LOC | Unlocks |
|---|---|---:|---|
| ~~`sqlite/src/audit.ts`~~ | ✅ ported (2026-05-11) — `src/audit.ts` | — | ✅ `audit-log-integrity.test.ts` + `test/audit-tamper.test.ts` |
| ~~`sqlite/src/interrupts.ts`~~ | ✅ ported (2026-05-11) — `src/interrupts.ts` (~470 LOC) | — | ✅ 6 interrupt scenarios + 4 optional profile claims (`openwop-interrupt-quorum/-auth-required/-external-event/-cascade-cancel`) |
| ~~`sqlite/src/webhooks.ts`~~ | ✅ ported (2026-05-11) — `src/webhooks.ts` (~260 LOC) | — | ✅ webhook scenarios + SSRF guard + HMAC v1 signing + 7 in-host smoke assertions |
| ~~`sqlite/src/observability.ts`~~ | ✅ wired (2026-05-11) — `startMetricLoop` + span helpers + traceparent | — | ✅ OTel emission + metric scenarios (active when `OTEL_EXPORTER_OTLP_ENDPOINT` set) |
| ~~`sqlite/src/server.ts` SSE path~~ | ✅ wired (2026-05-11) — `handleEventsSse` w/ backlog flush + Last-Event-ID resume + live subscription via `eventBus` | — | ✅ `stream-modes*.test.ts` + `streamReconnect.test.ts` |
| ~~`sqlite/src/server.ts` interrupts wiring~~ | ✅ wired (2026-05-11) — `handleResolveInterrupt` + `handleResolveInterruptByToken` + 4 node-type executors + parent/child cascade | — | (above) |
| ~~`sqlite/src/server.ts` debug bundle~~ | ✅ ported (2026-05-11) — `handleDebugBundle` with 8MB cap + maxEvents truncation | — | ✅ `debugBundle.test.ts` + `debug-bundle-truncation.test.ts` |
| ~~`sqlite/src/server.ts` pause/resume routes~~ | ✅ ported (2026-05-11) — `handlePauseRun` / `handleResumeRun` + paused outcome | — | ✅ `pause-resume.test.ts` (in-host `test/pause-resume.test.ts` validates wire surface) |
| ~~`sqlite/src/server.ts` claim acquisition~~ | ✅ wired (2026-05-11) — session-level `pg_try_advisory_lock(hashtext(runId))` + orphan recovery on host startup | — | ✅ multi-process scenarios + production-profile claim (precondition for `spec/v1/production-profile.md` FINAL flip) |

Approximate total port work: ~1700 LOC. Tractable in 4-6 focused sessions, one module per commit.

### Postgres-specific concerns to land alongside

These don't have direct SQLite equivalents:

1. **Multi-tenancy.** Add `tenant_id TEXT NOT NULL` to every table; composite primary keys. Bearer auth resolves to tenant via a `tenants` table. Currently the host is single-tenant. **Not a production-profile requirement** — the spec's logging MUST is satisfied with a hardcoded `tenant:default` field. Deferred follow-up.
2. ~~**Backpressure.**~~ ✅ wired (2026-05-11) — inflight semaphore sized from `OPENWOP_MAX_INFLIGHT` (default 100); 503 + Retry-After on overflow; discovery + OpenAPI are health-probe-exempt. Required by `production-profile.md` §"Backpressure".
3. ~~**Claim acquisition.**~~ ✅ wired (2026-05-11) — `SELECT pg_try_advisory_lock(hashtext(run_id))` session-scoped; orphan recovery on host startup; auto-release on connection drop (process crash). See Phase 5 commit.
4. ~~**`audit_log` SERIALIZABLE.**~~ ✅ handled (2026-05-11) — withTransaction holds an in-process FIFO lock that serializes overlapping transactions, plus the `audit_seq` sentinel row's UPDATE…RETURNING gives atomic seq allocation. The explicit SERIALIZABLE isolation level isn't strictly required given the lock, but production deployers SHOULD consider it as defense-in-depth.
5. **Multi-region idempotency.** Deferred. Only required for `crossRegion: 'best-effort'` capability claim, which is optional. Reference impl is single-region.

**Event retention** ✅ wired (2026-05-11) — `OPENWOP_EVENT_RETENTION_DAYS` (default 7); terminal runs older than retention window get purged via 6-hour sweeper; FK cascade removes events. Required by `production-profile.md` §"Event retention".

### Production-profile conformance

When the host advertises all required surfaces:
- `bash sdk/smoke/all.sh` (TS / Python / Go).
- `OPENWOP_REQUIRE_BEHAVIOR=true` full conformance suite.
- `restart-during-run.test.ts` + `staleClaim.test.ts` against the Postgres host.
- Add `production` to the scale-claim column on the INTEROP-MATRIX row.
- Submit a PR to flip `spec/v1/production-profile.md` from PROVISIONAL back to FINAL.

## See also

- `spec/v1/production-profile.md` — the spec contract this host will satisfy
- `spec/v1/storage-adapters.md` — `RunEventLogIO` + `SuspendIO` interfaces this host will implement
- `examples/hosts/sqlite/` — the host whose internal architecture this one mirrors
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Phase 2 T2.1 — the planning trail

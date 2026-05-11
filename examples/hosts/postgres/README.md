# OpenWOP Postgres Reference Host

> **Status: PARTIAL (2026-05-11).** Basic run lifecycle + audit-log integrity profile work against pglite in-process: discovery, run create, executor for `core.noop` + `core.delay`, terminal poll, cancellation, events poll, idempotency replay, `GET /v1/audit/verify` with hash-chain + signed-checkpoint verification + tamper detection. Interrupts / webhooks / observability / SSE are deferred to follow-up sessions per module. The full-feature-parity port is T2.1 in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`.

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
  GET  /v1/audit/verify              ✅
  GET  /v1/runs/{runId}/events       ⏳  (SSE — not yet wired)
  POST /v1/runs/{runId}/interrupts/{nodeId}  ⏳
  POST /v1/interrupts/{token}                ⏳
  GET  /v1/runs/{runId}/debug-bundle         ⏳
  POST /v1/webhooks                          ⏳
  POST /v1/runs/{runId}:pause                ⏳
  POST /v1/runs/{runId}:resume               ⏳

Node types in executor:
  core.noop                          ✅
  core.delay                         ✅
  core.approvalGate                  ⏳
  core.clarificationGate             ⏳
  core.interrupt                     ⏳
  core.subWorkflow                   ⏳
```

Discovery advertises `capabilities.auth.profiles: ['openwop-audit-log-integrity']` + the audit-log-integrity capability block (hashChain, Ed25519 checkpoint signature, public key, checkpoint cadence). All other profile claims fill in as the corresponding modules port over.

## Quick test (no Postgres install required)

```bash
cd examples/hosts/postgres
npm install     # pulls pg + @electric-sql/pglite (Postgres-on-WASM)
npm test        # spins up pglite in-process, boots the host, runs lifecycle assertions
```

Output:

```
postgres-host lifecycle test: PASS
postgres-host audit-tamper test: PASS
```

The lifecycle test exercises discovery, create, terminal poll, idempotency replay, and cancel-after-terminal. The audit-tamper test seeds five entries + a checkpoint, then mutates an entry in place and a checkpoint signature in place, and asserts the verify endpoint surfaces `hash-mismatch` / `chain-break` / `merkle-mismatch` / `signature-invalid` anomalies plus exercises the append-only triggers. Wall-clock ~2 seconds combined.

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
├── lifecycle.test.ts     # End-to-end wire-surface assertions via PGlite
└── audit-tamper.test.ts  # Host-internal tamper detection (entry + checkpoint + trigger)
```

`db.ts` defines a minimal `Querier` interface — `query(sql, params)` returning `{rows, rowCount}`. Both `pg.Client` and `PGlite` satisfy it. The host accepts an injected Querier via `setQuerier(...)` for tests; otherwise it opens `pg.Client` against `OPENWOP_PG_DSN`.

## Build-out plan (remaining)

Each item is a follow-up session. Order doesn't matter much; pick the one that unblocks the most conformance scenarios per unit of work.

### Per-module ports from the SQLite host

| Source | Postgres equivalent | Approximate LOC | Unlocks |
|---|---|---:|---|
| ~~`sqlite/src/audit.ts`~~ | ✅ ported (2026-05-11) — `src/audit.ts` | — | ✅ `audit-log-integrity.test.ts` + `test/audit-tamper.test.ts` |
| `sqlite/src/interrupts.ts` | port to async pg | ~400 | 6 interrupt scenarios (approval, clarification, quorum, auth-required, external-event, parent/child cascade) |
| `sqlite/src/webhooks.ts` | port to async pg | ~200 | webhook scenarios + SSRF guard tests |
| `sqlite/src/observability.ts` | already copied; wire into routes | (already ported) | OTel emission + metric scenarios |
| `sqlite/src/server.ts` SSE path | add SSE event stream | ~150 | `stream-modes*.test.ts` |
| `sqlite/src/server.ts` interrupts wiring | wire interrupt routes through the port | ~200 | (above) |
| `sqlite/src/server.ts` debug bundle | port to async pg | ~80 | `debugBundle.test.ts` + truncation |
| `sqlite/src/server.ts` pause/resume routes | port | ~50 | `pause-resume.test.ts` |
| `sqlite/src/server.ts` claim acquisition | use Postgres advisory locks instead of SQLite UPDATE pattern | ~100 | multi-process scenarios + production-profile claim |

Approximate total port work: ~1700 LOC. Tractable in 4-6 focused sessions, one module per commit.

### Postgres-specific concerns to land alongside

These don't have direct SQLite equivalents:

1. **Multi-tenancy.** Add `tenant_id TEXT NOT NULL` to every table; composite primary keys. Bearer auth resolves to tenant via a `tenants` table. Currently the host is single-tenant.
2. **Backpressure.** Wrap inbound HTTP with a semaphore sized from `OPENWOP_MAX_INFLIGHT`; return `503 service_unavailable` + `Retry-After` when full. Required by `production-profile.md`.
3. **Claim acquisition.** Replace the SQLite `UPDATE … WHERE claim_holder_id IS NULL OR claim_expires_at < ?` pattern with Postgres `SELECT pg_try_advisory_xact_lock(hashtext(run_id))`. Simpler and atomic.
4. **`audit_log` SERIALIZABLE.** Wrap insert in `BEGIN ISOLATION LEVEL SERIALIZABLE` so the prev-hash read + insert can't interleave with another writer. The reference SQLite host serializes via better-sqlite3's in-process tx; Postgres needs explicit isolation.
5. **Multi-region idempotency.** Replicate the `idempotency` table across regions; claim `crossRegion: 'best-effort'` in the discovery doc.

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

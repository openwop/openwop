# OpenWOP Postgres Reference Host

> **Status: SKELETON (2026-05-11).** Not runnable in its current form — boots, accepts discovery, but no executor wired in yet. This directory is the design + entry point for the eventual Postgres-backed reference host that will be the first claimant of `spec/v1/production-profile.md` (currently Provisional). The full build-out is T2.1 in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`.

---

## Why a Postgres host exists

Three reference hosts ship today: `examples/hosts/in-memory/` (Node, no persistence), `examples/hosts/sqlite/` (Node + better-sqlite3, single-machine durability), and `examples/hosts/python/` (Python 3.11 stdlib, no persistence). All three claim the `minimal` scale tier.

The `production-profile.md` profile requires:

- Durability across process restart (✅ SQLite host).
- Multi-tenant isolation at the storage layer (❌ SQLite host: hardcoded single tenant).
- Backpressure with canonical `503 + Retry-After` envelope (❌ SQLite host: no admission control).
- Multi-region idempotency cache (❌ SQLite host: single-region by definition).
- Cross-process scaling with shared event log + claim-acquisition lease (✅ SQLite host via `staleClaim.test.ts`; effectively single-host in practice).

A Postgres host is the natural place to satisfy these without inventing custom infrastructure: Postgres provides the durability, concurrent-writer semantics, advisory locks, and standard cloud-managed deployment story.

## What's here today

```
examples/hosts/postgres/
├── README.md              # this file
├── package.json           # @openwop/openwop-host-postgres skeleton
├── src/
│   └── server.ts          # boots; discovery only; no executor wired
└── (schema not yet committed — see "Schema" below)
```

The skeleton boots against `OPENWOP_PG_DSN`, exposes `GET /.well-known/openwop`, and returns 501 on every other route with a structured error envelope that points at this README. It's a placeholder that proves the build target is reachable, not a working host.

## Build-out plan

### Phase A: Storage adapter

Refactor the SQLite host's storage layer (`runs`, `events`, `idempotency`, `interrupts`, `audit_log`, `audit_checkpoints`, `webhook_subscriptions` tables) behind a small interface:

```typescript
interface StorageAdapter {
  insertRun(...): Promise<void>;
  loadRun(runId: string): Promise<RunRow | null>;
  acquireClaim(runId: string, holder: string, ttlMs: number): Promise<boolean>;
  appendEvent(runId: string, type: string, opts: ...): Promise<RunEvent>;
  // ...
}
```

The SQLite host implements `StorageAdapter` synchronously (better-sqlite3 is sync). The Postgres host implements it async via `pg`. The shared executor logic + route handlers live in a `host-core` package.

This refactor is the biggest single piece of T2.1 — the SQLite host's ~1900 LOC of inline SQL needs to graduate to a shared interface. Plan to do it in one careful pass against the SQLite host first (no behavior change), then port the interface to Postgres.

### Phase B: Postgres-specific concerns

Once `StorageAdapter` is factored:

1. **Schema migrations.** Use a real migrator (`node-pg-migrate` or hand-rolled `__schema_version`). SQLite host's CREATE TABLE IF NOT EXISTS pattern doesn't scale to multi-DB-environment deployments.
2. **Multi-tenancy.** Add `tenant_id TEXT NOT NULL` to every table; composite PKs / FKs. Bearer auth resolves to tenant via a `tenants` table.
3. **Claim acquisition via advisory locks.** Postgres `pg_try_advisory_xact_lock(hashtext(run_id))` instead of the SQLite UPDATE-with-claim-holder-id pattern. Simpler + atomic.
4. **`audit_log` hash chain.** Use a Postgres SEQUENCE for `seq` instead of AUTOINCREMENT; wrap insert in `BEGIN ISOLATION LEVEL SERIALIZABLE` so the prev-hash read + insert can't interleave with another writer.
5. **Backpressure.** Wrap inbound HTTP with a semaphore sized from `OPENWOP_MAX_INFLIGHT`; return `503 service_unavailable` + `Retry-After` when full. Connection-pool exhaustion in `pg` similarly surfaces as 503.
6. **Multi-region.** The idempotency table needs cross-region replication; the spec's multi-region annex allows `crossRegion: 'best-effort' | 'strict'` capability advertisement. For the reference host, claim `best-effort` (single-region with logical replication ack) — the `strict` claim requires global consensus and is out of reference-impl scope.

### Phase C: Production-profile conformance

When the host advertises all required surfaces:

- Run `bash sdk/smoke/all.sh` against it (TS/Python/Go).
- Run `OPENWOP_REQUIRE_BEHAVIOR=true` against the full conformance suite.
- Run the `restart-during-run.test.ts` and `staleClaim.test.ts` scenarios.
- Add a row to `INTEROP-MATRIX.md` advertising `production` scale.
- Submit a PR to flip `spec/v1/production-profile.md` from PROVISIONAL back to FINAL.

## Why this isn't shipped in full today

T2.1 is ~1000 LOC even with the storage-adapter refactor as a prerequisite. That's a dedicated multi-session effort. The skeleton + this README ship as the first piece so the design is concrete and the project's status on `production-profile.md` is honest (currently Provisional rather than defined-but-unmet).

## See also

- `spec/v1/production-profile.md` — the spec contract this host will satisfy
- `spec/v1/storage-adapters.md` — `RunEventLogIO` + `SuspendIO` interfaces this host will implement
- `examples/hosts/sqlite/` — the host whose internal architecture this one factors
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` §"Track 12: SDK Parity And Non-TS Reference Host" + §"Production profile" — the planning trail

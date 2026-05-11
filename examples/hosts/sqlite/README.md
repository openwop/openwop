# openwop Reference Host: SQLite

Single-process OpenWOP host backed by SQLite. Demonstrates **durable execution** — runs survive process restarts; events persist; claim acquisition prevents double-execution across crash-recovery cycles.

This README doubles as the **"Build Your Own Host" walkthrough**: read it top-to-bottom and you'll understand how to wire any backend store (Postgres, Cassandra, DynamoDB) to the openwop wire contract.

> **Not for production.** This host has no multi-tenancy, no real auth, no production hardening. SQLite is single-writer, so this host is single-process by design. Use it for understanding + reference, not for serving real traffic.

## Contents

- [Quick start](#quick-start) — boot the host
- [Demonstrate durability](#demonstrate-durability) — kill the process, restart, verify run state survived
- [Build Your Own Host: the walkthrough](#build-your-own-host-the-walkthrough) — guided 8-section reading of `src/server.ts`
  1. [Schema](#1-schema)
  2. [The event log IS the source of truth](#2-the-event-log-is-the-source-of-truth)
  3. [Claim acquisition](#3-claim-acquisition)
  4. [Run execution](#4-run-execution)
  5. [Idempotency](#5-idempotency)
  6. [The HTTP layer](#6-the-http-layer)
  7. [SSE event stream](#7-sse-event-stream)
  8. [Graceful shutdown](#8-graceful-shutdown)
- [Run conformance against this host](#run-conformance-against-this-host)
- [Stale-claim recovery (live as of 2026-05-01)](#stale-claim-recovery-live-as-of-2026-05-01)
- [What's next](#whats-next)

## Quick start

```bash
npm install
npm start
```

The server listens on `http://127.0.0.1:3838` by default. SQLite database lives at `./data/openwop-host.sqlite` (auto-created).

| Variable | Default | Purpose |
|---|---|---|
| `OPENWOP_HOST` | `127.0.0.1` | Bind address |
| `OPENWOP_PORT` | `3838` | Bind port (in-memory host uses 3737; SQLite uses 3838 to avoid conflict) |
| `OPENWOP_API_KEY` | `openwop-sqlite-dev-key` | Bearer token |
| `OPENWOP_SQLITE_PATH` | `./data/openwop-host.sqlite` | SQLite file location |
| `OPENWOP_CLAIM_TTL_MS` | `30000` | Lifetime of a run claim before another process can steal it. Tests use ≤ 2000. |
| `OPENWOP_HEARTBEAT_INTERVAL_MS` | `10000` | How often a holding process renews `claim_expires_at`. SHOULD be ≤ `OPENWOP_CLAIM_TTL_MS / 2`. |

## Demonstrate durability

```bash
# Terminal 1: start the host
npm start
```

```bash
# Terminal 2: create a long-running run, then kill the host mid-flight
RUN_ID=$(curl -s -X POST http://127.0.0.1:3838/v1/runs \
  -H "Authorization: Bearer openwop-sqlite-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"conformance-cancellable","inputs":{"delayMs":30000}}' \
  | jq -r '.runId')
echo "runId: $RUN_ID"

# Wait a moment, then kill the host (Ctrl-C in Terminal 1).
# In Terminal 1: restart with `npm start`.

# Back in Terminal 2: read the events the run already wrote
curl -s -H "Authorization: Bearer openwop-sqlite-dev-key" \
  "http://127.0.0.1:3838/v1/runs/$RUN_ID/events/poll" | jq
```

You'll see `run.started` + `node.started` (everything written before the kill) preserved on the SQLite side. The in-memory host can't do this — its events live in process memory and die with the process.

## Build Your Own Host: the walkthrough

This section is a guided reading of `src/server.ts`. The file is ~700 lines; it's intentionally a single file so you can read top-to-bottom without jumping. Section markers in the file (`// ─── ... ───`) match the headings below.

### 1. Schema

The schema is **3 tables**:

```sql
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error_json TEXT,
  claim_holder_id TEXT,         -- NULL when unclaimed
  claim_expires_at INTEGER      -- ms epoch
);

CREATE TABLE events (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  node_id TEXT,
  data_json TEXT,
  timestamp TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE idempotency (
  cache_key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  stored_at INTEGER NOT NULL
);
```

Translates verbatim to Postgres / MySQL / DynamoDB. The composite primary key `(run_id, seq)` on `events` is what makes monotonic event ordering free.

### 2. The event log IS the source of truth

Per `spec/v1/observability.md`, the event log is the durable record of run state. Every state transition writes an event before any side effect; on read, the snapshot view (`GET /v1/runs/{runId}`) is computed from the latest known state plus implicit defaults.

In this host, every `appendEvent()` call is a single `INSERT` that commits before the function returns. SQLite's WAL mode (`pragma journal_mode = WAL`) keeps writes fast without sacrificing durability.

When the process crashes, the next start sees:
- All `runs` rows with their current status (likely stuck at `running` if the crash was mid-execution).
- All `events` rows up to the last committed write.
- No in-flight aborters (process-local; gone with the process).

A real crash-recovery loop scans for runs with status `running` whose claim is expired, attempts to re-acquire the claim, and resumes. This reference host implements that behavior so the `staleClaim` conformance scenario can verify it.

### 3. Claim acquisition

A run that's mid-execution holds a **claim** — a lease on the right to execute it. Other processes seeing the run respect the claim until it expires. The mechanism:

```sql
UPDATE runs
SET claim_holder_id = ?, claim_expires_at = ?
WHERE run_id = ?
  AND (claim_holder_id IS NULL OR claim_expires_at < ?)
  AND status NOT IN ('completed', 'failed', 'cancelled');
```

`UPDATE` returns affected-row-count. 1 = we won the claim; 0 = someone else holds it (or the run is terminal).

The claim TTL is 30 seconds. A process that holds a claim for longer than 30s without renewal MUST assume another process can steal it; renewal is the heartbeat pattern. The `staleClaim` conformance scenario exercises the lapse-then-steal pattern.

This pattern translates to:
- Postgres: `SELECT FOR UPDATE SKIP LOCKED` plus an explicit lease column.
- DynamoDB: conditional UPDATE on the lease attribute.
- Redis: `SET NX EX 30`.

The protocol doesn't prescribe the mechanism, only the property: **two processes MUST NOT execute the same run concurrently and MUST NOT lose the run if the holder dies.**

### 4. Run execution

The execution loop is in `runWorkflow()`:

```
runWorkflow(runId):
  load run, abort if missing
  load workflow definition by workflow_id
  set status = 'running', emit 'run.started'
  for each node in definition:
    if status == 'cancelling', emit 'run.cancelled', terminate
    outcome = executeNode(node)
    if outcome == 'failed', emit 'run.failed', terminate
    if outcome == 'cancelled', emit 'run.cancelled', terminate
  emit 'run.completed' (or 'cancelled' if user requested mid-loop)
```

Every state transition is an `appendEvent()` call. The status column is also updated for fast snapshot reads, but **events are the truth**; if status and last-event ever disagree (e.g., a partial write), prefer events.

Cancellation propagates two ways: (1) within the executing process, an `AbortController` aborts in-flight `core.delay` sleeps; (2) across processes, the status column flip to `cancelling` is detected at the next loop iteration. Both paths converge on `run.cancelled` + setRunTerminal.

### 5. Idempotency

Layer-1 (HTTP) idempotency lives in the `idempotency` table. Cache key is `sha256(tenantId + endpoint + idempotency-key)`; stored entry includes `body_hash` so a retry with the same key + different body returns 409 per RFC 0002.

The cache TTL is 24 hours per `spec/v1/idempotency.md`. Eviction is done lazily (`pruneIdempotency()` runs on every `POST /v1/runs`); a real production host would run it on a schedule.

Layer-2 (per-side-effect) idempotency isn't needed here — this host's nodes (`core.noop` / `core.delay`) are pure. A host running `core.ai.callPrompt` or `core.payment.charge` would persist invocation results before returning to the executor and dedupe on retry.

### 6. The HTTP layer

Routes match openwop v1's spec:

| Method | Path | Owner |
|---|---|---|
| GET | `/.well-known/openwop` | `handleDiscovery` |
| GET | `/v1/openapi.json` | `handleOpenApi` |
| POST | `/v1/runs` | `handleCreateRun` |
| GET | `/v1/runs/{runId}` | `handleGetRun` |
| POST | `/v1/runs/{runId}/cancel` | `handleCancelRun` |
| GET | `/v1/runs/{runId}/events` | `handleEventsSse` (SSE stream) |
| GET | `/v1/runs/{runId}/events/poll` | `handleEventsPoll` (polling JSON) |
| GET | `/v1/runs/{runId}/debug-bundle` | `handleDebugBundle` (per `spec/v1/debug-bundle.md`) |

Authentication is a single `checkAuth()` helper that requires `Authorization: Bearer <key>` matching `OPENWOP_API_KEY`. Real hosts would verify a JWT or API-key DB lookup; this is the simplest correct contract.

### 7. SSE event stream

The SSE handler:
1. Replays the backlog (every event already in the DB) on connect.
2. Subscribes to a Node `EventEmitter` for new events emitted by the executor.
3. Closes the connection after the terminal event (`run.completed` / `run.failed` / `run.cancelled`).

If you want a simpler streaming model, drop the EventEmitter and have the executor poll the DB for new events between writes — but EventEmitter is cheaper for single-process hosts.

### 8. Graceful shutdown

On SIGINT/SIGTERM, the host:
1. Aborts every in-flight node (`runningAborters.abort()`).
2. Releases every claim it holds (so another process can pick up the run).
3. Closes the HTTP server.
4. Closes the SQLite connection.

This prevents stale claims that would block re-execution after a clean restart. A crash skips step 2; the next process picks up the claim after the 30s expiry.

## Run conformance against this host

```bash
# Terminal 1
cd examples/hosts/sqlite
npm install
npm start

# Terminal 2 (from repo root)
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3838 OPENWOP_API_KEY=openwop-sqlite-dev-key npx vitest run
```

See `conformance.md` (alongside this file) for the per-scenario pass/fail record.

## Stale-claim recovery (live as of 2026-05-01)

This host implements **heartbeat renewal + resume-on-startup**, the two halves of stale-claim recovery:

- **Heartbeat.** Every `OPENWOP_HEARTBEAT_INTERVAL_MS` (default 10s) while a run is mid-execution, the holding process renews `claim_expires_at`. As long as the process is alive and writing, the claim stays valid.
- **Resume on startup.** On boot, before the HTTP server starts accepting traffic, the host scans for runs with `status IN ('pending', 'running', 'cancelling')` AND `claim_holder_id IS NULL OR claim_expires_at < now`. For each, it tries to acquire the claim and dispatch `runWorkflow()`. If `run.started` is already in the event log, the resumed execution emits a `run.resumed` event with `data.resumedBy: <processId>` so observers see the handover.

This unlocks the `staleClaim.test.ts` conformance scenario. Try it manually:

```bash
# Terminal 1: short TTL so the test is fast
OPENWOP_PORT=4801 OPENWOP_SQLITE_PATH=/tmp/openwop-test.sqlite \
  OPENWOP_CLAIM_TTL_MS=2000 OPENWOP_HEARTBEAT_INTERVAL_MS=500 \
  npm start
# Wait for "listening on" message

# Terminal 2: start a long-running run, then SIGKILL terminal 1
RUN_ID=$(curl -s -X POST http://127.0.0.1:4801/v1/runs \
  -H "Authorization: Bearer openwop-sqlite-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"conformance-cancellable","inputs":{"delayMs":10000}}' \
  | jq -r '.runId')
echo "runId: $RUN_ID"
# Now SIGKILL the host in terminal 1 (or kill -9 by PID).

# Wait 3s for the claim to expire, then start a new host on a different port:
OPENWOP_PORT=4802 OPENWOP_SQLITE_PATH=/tmp/openwop-test.sqlite \
  OPENWOP_CLAIM_TTL_MS=2000 OPENWOP_HEARTBEAT_INTERVAL_MS=500 \
  npm start
# Boot output should include: "resume-on-startup: claimed 1 of 1 orphaned run(s)"

# Confirm B finished what A started:
curl -s -H "Authorization: Bearer openwop-sqlite-dev-key" \
  "http://127.0.0.1:4802/v1/runs/$RUN_ID/events/poll" | jq '.events[].type'
# Expected: run.started, node.started, run.resumed, node.completed, run.completed
```

The host's `core.delay` and `core.noop` nodes are pure — re-executing them after a kill is safe. **A production host with non-pure nodes (LLM calls, payments, emails) MUST persist invocation results before returning to the executor (Layer-2 idempotency per `idempotency.md`)** so a resume after a node-completion event doesn't double-fire side effects. Wiring Layer-2 dedup is host-implementation-defined; this reference example doesn't need it.

## What's next

If you want to evolve this into a more production-shaped host:

1. **Replace SQLite with Postgres.** `pg` driver; same schema; replace `BEGIN IMMEDIATE` with `SELECT FOR UPDATE SKIP LOCKED`. Now you can run multiple processes against the same DB.
2. ~~**Add heartbeating.**~~ ✅ Done.
3. ~~**Add resume-on-startup.**~~ ✅ Done.
4. **Wire a real auth layer.** JWT verification, scope checks, tenant isolation.
5. **Add the missing profiles.** This host claims `openwop-core` + `openwop-stream-{sse,poll}` + `openwop-debug-bundle`. Add `clarification.request` to `supportedEnvelopes` to claim `openwop-interrupts`. Wire `aiProviders.policies` to claim `openwop-provider-policy`. Etc.
6. **Add Layer-2 idempotency** before adding non-pure nodes. Persist invocation results in a separate table; on resume, skip re-execution if the prior result is already recorded.

The wire contract doesn't change as you add capabilities — your discovery payload advertises more, the conformance scenarios that gate on profiles run additional checks, and you're suddenly on multiple rows of `INTEROP-MATRIX.md`.

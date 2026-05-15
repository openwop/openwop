# Implementing an OpenWOP Host on a Durable-Execution Runtime

> STD-6 from `plans/openwop-protocol-gap-closure-plan.md`. Non-normative implementation guide for runtime engineers wiring OpenWOP onto Temporal, Restate, DBOS, Inngest, or comparable durable-execution substrates.

OpenWOP is a wire contract — REST + SSE + signed webhooks + JSON Schemas. The runtime that backs an OpenWOP host is your choice. Many adopters already operate a durable-execution substrate and want OpenWOP to compose with it rather than replace it. This page is the mapping recipe.

The protocol does not require any particular durable runtime. The four reference hosts under `examples/hosts/` show the surface-area in process-local form (in-memory, SQLite, Python stdlib, Postgres with claim acquisition). Production hosts MAY swap any of those internals for a durable substrate as long as the wire contract holds.

For broader composition stance see [`spec/v1/positioning.md`](../../spec/v1/positioning.md) §"Standards composition matrix" — durable runtimes appear in the last row.

---

## What each runtime provides natively

The shared problem each durable runtime solves: **deterministic resumption of a long-running process across worker restarts, crashes, and scale events**. The shapes diverge:

| Runtime | Native primitive | OpenWOP analogue |
|---|---|---|
| **Temporal** | Workflow (long-lived deterministic function) + Activities (side effects with retry) | OpenWOP run + node executions |
| **Restate** | Service handler with virtual journal | OpenWOP run + per-node event-log |
| **DBOS** | Workflow function with checkpoint-on-write | OpenWOP run + RunEventLogIO checkpoint |
| **Inngest** | Step function with `step.run()` boundaries | OpenWOP run + node-level event boundaries |

In every case the substrate gives you "this thing keeps running for a long time, survives crashes, and replays deterministically." OpenWOP adds: a public wire contract + HITL primitives + replay/fork + signed audit log + capability discovery.

---

## Recommended mapping

### One OpenWOP run = one durable workflow/handler invocation

Don't fan out runs across multiple durable invocations. The durable runtime's identity (workflow id / handler invocation id) becomes the OpenWOP `runId`. The two MUST track 1:1 across replays.

```
OpenWOP runId  ⇄  Temporal WorkflowID
              ⇄  Restate invocation id
              ⇄  DBOS workflow_uuid
              ⇄  Inngest run id
```

This makes `POST /v1/runs/{id}:fork` map cleanly onto Temporal's `RestartWorkflow` / Restate's replay-from-journal / DBOS's `forkWorkflow` / Inngest's manual re-trigger — all natively supported.

### One OpenWOP node execution = one activity / step / handler call

Side-effecting calls inside the durable workflow become OpenWOP node executions. The durable runtime's retry + idempotency guarantees become the OpenWOP node's retry behavior:

| Durable primitive | OpenWOP node behavior |
|---|---|
| Activity / step retried by the runtime | OpenWOP node emits `node.started` once, `node.retrying` per retry, `node.completed` / `node.failed` on terminal. |
| Activity timeout | OpenWOP node emits `node.failed` with `code: 'node_timeout'`. |
| Activity heartbeats | OpenWOP MAY emit `node.progress` events at heartbeat boundaries. |
| Activity cancellation | OpenWOP node emits `node.cancelled`. |

OpenWOP does NOT normate retry policy — you keep whatever your durable runtime ships. Just project the visible state transitions onto the canonical event vocabulary in [`observability.md`](../../spec/v1/observability.md) §"Canonical run lifecycle event names".

### Event log: the durable journal is your event log

Don't double-write. The durable runtime's journal IS your `RunEventLogIO` per [`storage-adapters.md`](../../spec/v1/storage-adapters.md). Project from the journal to the OpenWOP event-log shape at read time (`GET /v1/runs/{id}/events/poll` + SSE).

- **Temporal**: read from the workflow history. Each `workflow.event_recorded` projects to one OpenWOP `RunEvent`.
- **Restate**: read from the journal. Each completed step projects to one or more `RunEvent`s.
- **DBOS**: query the workflow's persisted state. The DBOS workflow trace maps to OpenWOP's event sequence.
- **Inngest**: read step results from Inngest's run history endpoint.

The mapping you maintain is:

```
durable-runtime-event  →  OpenWOP RunEvent { seq, runId, type, nodeId?, data, timestamp, causationId? }
```

Sequence numbers are critical: OpenWOP's wire contract guarantees `seq` is monotonic per-runId. Inherit this from the durable runtime's own journal sequence; do NOT compute it client-side.

### Suspend / resume = native suspend / resume

OpenWOP HITL interrupts (`waiting-approval` / `waiting-input` / `waiting-clarification` / `waiting-external-event`) project to native suspend:

| Runtime | Native suspend mechanism |
|---|---|
| Temporal | `Workflow.await` on a signal |
| Restate | `ctx.awakeable()` |
| DBOS | `WorkflowHandle.send()` with a deferred await |
| Inngest | `step.waitForEvent()` |

The signed-token callback per [`interrupt.md`](../../spec/v1/interrupt.md) §"Signed-token callback" becomes a webhook OR an out-of-band signal sender that resolves the native await. Either path is acceptable; the wire surface (`POST /v1/interrupts/{token}`) stays the same.

---

## What you must NOT skip

Durable runtimes don't give you these for free; you implement them as host concerns:

1. **Idempotency-Key on POST /v1/runs.** Your host MUST de-dup on the key per [`idempotency.md`](../../spec/v1/idempotency.md) Layer 1. The durable runtime's own dedup (e.g., Temporal's "reject duplicate workflow id") is necessary but NOT sufficient — Layer 1 lives at the HTTP layer above the runtime.
2. **Discovery payload.** Emit `/.well-known/openwop` accurately. Strict-mode conformance gates on this.
3. **Event-type vocabulary.** Project durable-runtime events to OpenWOP's canonical names per `observability.md`. Don't ship vendor event types under the `run.*` / `node.*` / `agent.*` / `cap.*` prefixes.
4. **Secret redaction (SR-1).** BYOK plaintext NEVER touches the durable journal in plaintext. Substitute `[REDACTED:<id>]` at the host layer BEFORE handing data to the runtime per [`auth.md`](../../spec/v1/auth.md) + RFC 0004 §D.
5. **Signed audit log** if you claim `openwop-audit-log-integrity`. The durable runtime's journal is NOT the audit log; the audit log is a separate Ed25519-checkpointed surface per [`auth-profiles.md`](../../spec/v1/auth-profiles.md) §"openwop-audit-log-integrity".
6. **Capability advertisement honesty.** Strict-mode conformance fails if you over-claim. See [`docs/PROFILE-DECISION-GUIDE.md`](../PROFILE-DECISION-GUIDE.md).

---

## Per-runtime call-outs

### Temporal

- **`WorkflowID` uniqueness:** OpenWOP `runId` MUST be unique per `(tenantId, workflowId)`. Encode tenant + OpenWOP workflow + UUID in the Temporal workflow id.
- **Search attributes:** mirror `runId` + `tenantId` as search attributes for operator queries.
- **Retry policy:** map OpenWOP's per-node retry policy onto Activity retry options.
- **Replay safety:** Temporal's deterministic-replay rules apply. OpenWOP's BYOK redaction MUST happen OUTSIDE the workflow function (in an Activity) so cleartext doesn't enter the workflow history.

### Restate

- **Virtual object handler:** model each OpenWOP run as one virtual object instance keyed by `runId`.
- **Awakeables:** map HITL interrupts onto `ctx.awakeable()`.
- **Side effects:** wrap external calls in `ctx.run()` so they're recorded in the journal.
- **Replay:** Restate's journal-driven replay handles `:fork` natively.

### DBOS

- **Workflow + child workflows:** OpenWOP's `core.subWorkflow` maps cleanly to DBOS child workflows. Carry trace-context per [`observability.md`](../../spec/v1/observability.md) §"Trace context propagation".
- **Transactional steps:** OpenWOP doesn't normate transactional semantics; DBOS adopters keep them as a host concern.

### Inngest

- **Step boundaries:** every `step.run()` becomes an OpenWOP node execution event boundary.
- **Function id ↔ workflowId:** Inngest function id is the OpenWOP `workflowId`; Inngest run id is `runId`.
- **No native HITL:** map interrupts onto `step.waitForEvent()` with a webhook receiver for the signed-token callback.

---

## What you skip if you adopt a durable runtime

Compared to writing an OpenWOP host from scratch (like the Postgres reference), you don't write:

- Workflow scheduler / queue.
- Retry-with-backoff per node.
- Replay-from-arbitrary-event (your runtime ships this).
- Crash recovery.
- Distributed lock acquisition for claim ownership (most runtimes do worker-affinity natively).

What you do write:

- The HTTP / SSE wire surface (~500-1000 LOC across discovery, runs, events, interrupts, errors).
- The capability advertisement layer.
- The HITL surface (interrupt creation + signed-token verification + resume).
- The Idempotency-Key Layer 1 cache.
- The redaction harness.
- The audit-log integrity surface if you claim that profile.

---

## See also

- [`spec/v1/positioning.md`](../../spec/v1/positioning.md) §"Standards composition matrix" — broader composition stance.
- [`spec/v1/storage-adapters.md`](../../spec/v1/storage-adapters.md) — `RunEventLogIO` + `SuspendIO` contracts that durable runtimes implement.
- [`spec/v1/observability.md`](../../spec/v1/observability.md) — canonical event vocabulary you project from runtime events.
- [`docs/IMPLEMENTER-PATH.md`](../IMPLEMENTER-PATH.md) — full implementer path.
- [`docs/PROFILE-DECISION-GUIDE.md`](../PROFILE-DECISION-GUIDE.md) — profile-selection decisions.
- Temporal: [docs.temporal.io](https://docs.temporal.io/)
- Restate: [docs.restate.dev](https://docs.restate.dev/)
- DBOS: [docs.dbos.dev](https://docs.dbos.dev/)
- Inngest: [www.inngest.com/docs](https://www.inngest.com/docs)

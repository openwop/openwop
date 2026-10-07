# Implementing an OpenWOP Host on a Durable-Execution Runtime

> Informative. An implementation guide for engineers putting an OpenWOP v2 host on Temporal, Restate, DBOS, Inngest or a comparable durable-execution substrate. It adds no obligation; the rules it points at are in [`spec/v2/core/`](../../spec/v2/core/).

OpenWOP is a wire contract: REST, SSE, signed webhooks and JSON Schemas ([`api/v2/openapi.yaml`](../../api/v2/openapi.yaml), [`schemas/v2/`](../../schemas/v2/)). The runtime behind a host is your choice. Many adopters already run a durable-execution substrate and want OpenWOP to sit on top of it rather than replace it. This page is the mapping recipe.

---

## What each runtime provides

Each of these runtimes solves the same problem: resuming a long-running process deterministically across worker restarts, crashes and scale events. The shapes differ:

| Runtime | Native primitive | OpenWOP analogue |
| --- | --- | --- |
| **Temporal** | Workflow (long-lived deterministic function) plus Activities (side effects with retry) | run plus node executions |
| **Restate** | Service handler with a virtual journal | run plus its event log |
| **DBOS** | Workflow function with checkpoint-on-write | run plus event-log checkpoint |
| **Inngest** | Step function with `step.run()` boundaries | run plus node-level event boundaries |

The substrate gives you "keeps running, survives crashes, replays deterministically". OpenWOP adds a public wire contract, human-in-the-loop interrupts, replay and fork, an optional signed audit log, and capability discovery.

---

## Recommended mapping

### One run is one durable invocation

Do not fan one run out across several durable invocations. The runtime's identity (workflow id, invocation id) backs the OpenWOP `runId`, and the two track 1:1 across replays.

```text
OpenWOP runId  ⇄  Temporal WorkflowID
              ⇄  Restate invocation id
              ⇄  DBOS workflow_uuid
              ⇄  Inngest run id
```

Fork (`POST /runs/{runId}:fork`, [`replay.md`](../../spec/v2/core/replay.md)) then lines up with Temporal's reset, Restate's replay-from-journal, DBOS's `forkWorkflow` or an Inngest re-trigger. The fork boundary and the byte-equivalence of the copied prefix are defined in `replay.md`; check them against what your runtime does, because a native restart is not automatically a conformant fork.

### One node execution is one activity, step or handler call

Side-effecting calls inside the durable workflow become node executions. Keep your runtime's retry policy; OpenWOP does not define one. Project the visible transitions onto the registered event types ([`events.md`](../../spec/v2/core/events.md) §"Types"; the registry is [`spec/v2/event-codemap.json`](../../spec/v2/event-codemap.json)):

| Durable primitive | Events the host emits |
| --- | --- |
| Activity or step started | `node.started` |
| Retried by the runtime | `node.retried` per retry |
| Terminal success or failure | `node.completed` or `node.failed`, with an error code from [`spec/v2/errors.json`](../../spec/v2/errors.json) |
| Cancellation | `node.cancelled` |

Do not emit vendor event types under protocol domains. A vendor type's first segment must be an org registered in [`spec/v2/declaration.json`](../../spec/v2/declaration.json) (`events.md` §"Types").

### The durable journal is your event log

Do not double-write. Project from the runtime's journal to the `RunEventDoc` shape ([`schemas/v2/run-event.schema.json`](../../schemas/v2/run-event.schema.json)) when serving the events channel and `GET /runs/{runId}/events/poll`.

- **Temporal**: read the workflow history.
- **Restate**: read the journal; each completed step projects to one or more events.
- **DBOS**: query the workflow's persisted state.
- **Inngest**: read step results from the run history endpoint.

```text
durable-runtime-event  →  RunEventDoc { eventId, runId, type, payload, timestamp, sequence, schemaVersion, nodeId?, causationId? }
```

`sequence` starts at `0` and strictly increases per run (`events.md` §"The envelope"). Derive it from the runtime's own journal order, on the server, never in a client.

### Interrupts are native suspends

A run waiting on a human (`waiting-approval`, `waiting-input`) or an external party (`waiting-external`) maps onto the runtime's suspend primitive:

| Runtime | Native suspend |
| --- | --- |
| Temporal | `Workflow.await` on a signal |
| Restate | `ctx.awakeable()` |
| DBOS | a deferred receive resolved by `send()` |
| Inngest | `step.waitForEvent()` |

The resolve surfaces stay the same whatever signals the runtime internally: `POST /runs/{runId}/interrupts/{nodeId}` and the signed-token `POST /interrupts/{token}` ([`interrupt.md`](../../spec/v2/core/interrupt.md) §"Resolve surfaces"). Of two concurrent resolves, exactly one succeeds.

---

## What the runtime does not give you

These are host concerns on top of any substrate:

1. **`Idempotency-Key` on writes.** Layer 1 is an HTTP-level record ([`idempotency.md`](../../spec/v2/core/idempotency.md) §"Layer 1"). The runtime's own dedupe (for example rejecting a duplicate workflow id) is necessary but not sufficient.
2. **Effect identity.** Duplicate delivery of accepted work must not produce duplicate external effects ([`idempotency.md`](../../spec/v2/core/idempotency.md) §"Layer 2", [`persistence.md`](../../spec/v2/core/persistence.md) §"Durable acceptance and recovery").
3. **Discovery.** Serve `/.well-known/openwop` accurately ([`capabilities.md`](../../spec/v2/core/capabilities.md)). Advertise only what you witness; conformance fails an over-claim.
4. **Secret redaction.** Resolved secret values never enter the durable journal in clear. Substitute `[REDACTED:<secretId>]` at the host layer before data reaches the runtime ([`host-services.md`](../../spec/v2/core/host-services.md) §`secrets`).
5. **Audit-log integrity**, if you advertise `auditLogIntegrity`. The journal is not the audit log; the audit log is a separate hash-chained, Ed25519-checkpointed log served at `GET /audit/verify` ([`security-defaults.md`](../../spec/v2/core/security-defaults.md) §"Audit-log integrity").
6. **A declared recovery bound.** `persistence.md` §"Durable acceptance and recovery" requires you to declare how long work can sit before another instance may resume it, per enforcing mechanism. Your runtime's timeouts are inputs to that bound, not the declaration itself. A durability rung (`durable-single-instance` and up) is claimed only with the evidence RFC 0158 §D names.

---

## Per-runtime notes

### Temporal

- **Workflow id uniqueness.** Encode tenant, OpenWOP workflow and a UUID in the Temporal workflow id so `runId` is unique per tenant.
- **Search attributes.** Mirror `runId` and the tenant id for operator queries.
- **Replay safety.** Redact secrets in an Activity, outside the workflow function, so clear text never enters workflow history.

### Restate

- **Virtual objects.** Model each run as one virtual-object instance keyed by `runId`.
- **Side effects.** Wrap external calls in `ctx.run()` so they are journaled.

### DBOS

- **Child workflows.** `subWorkflow` ([`execution.md`](../../spec/v2/core/execution.md) §`subWorkflow`) maps onto DBOS child workflows. Propagate trace context as [`interop.md`](../../spec/v2/core/interop.md) §"Trace context" describes.
- **Transactional steps.** OpenWOP does not define transactional semantics; they stay a host concern.

### Inngest

- **Step boundaries.** Each `step.run()` is a node-execution event boundary.
- **Ids.** The Inngest function id backs the OpenWOP `workflowId`; the Inngest run id backs `runId`.
- **Interrupts.** Use `step.waitForEvent()` with a receiver for the signed-token resolve.

---

## What you write, and what you skip

With a durable runtime you skip the scheduler and queue, per-node retry with backoff, crash recovery, and most of claim ownership.

You still write:

- the HTTP and SSE wire surface (discovery, runs, events, interrupts, errors);
- the capability advertisement;
- the interrupt surface (creation, signed-token verification, resume);
- the `Idempotency-Key` record;
- secret redaction;
- the audit-log surface, if you advertise it.

---

## See also

- [`spec/v2/core/persistence.md`](../../spec/v2/core/persistence.md): the event-log family and durable acceptance and recovery.
- [`spec/v2/core/events.md`](../../spec/v2/core/events.md) and [`spec/v2/core/replay.md`](../../spec/v2/core/replay.md): the event vocabulary and fork semantics you project onto.
- [`docs/IMPLEMENTER-PATH.md`](../IMPLEMENTER-PATH.md): the full implementer path.
- Temporal: [docs.temporal.io](https://docs.temporal.io/)
- Restate: [docs.restate.dev](https://docs.restate.dev/)
- DBOS: [docs.dbos.dev](https://docs.dbos.dev/)
- Inngest: [www.inngest.com/docs](https://www.inngest.com/docs)

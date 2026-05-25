# RFC 0060: Host heartbeat capability (`host.heartbeat`)

| Field | Value |
|---|---|
| **RFC** | 0060 |
| **Title** | A `host.heartbeat` capability — a system-managed, short-interval, runtime-bounded evaluation of an *idempotent predicate* that emits state-change events and conditionally enqueues a run, rather than blindly re-running an agent; the controlled, request-shaped exception to openwop's poll-free design |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `schemas/capabilities.schema.json` (`host.heartbeat` block) · `spec/v1/host-capabilities.md` (new §host.heartbeat) · `api/asyncapi.yaml` (`heartbeat.evaluated`, `heartbeat.stateChanged` events) · `spec/v1/positioning.md` (note the bounded exception) · `RFCS/0052` (composes with `host.scheduling`) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

A heartbeat is a lightweight, system-managed check that wakes on a short interval to inspect external state (an inbox, a queue, a sensor) and acts *only* when an idempotent predicate transitions — enqueuing a run or notifying a human — rather than re-running the agent blindly every tick. openwop is deliberately request-driven (`positioning.md`), but RFC 0052 already moved the line by accepting host-managed scheduling; this RFC adds the *predicate-gated, state-change-emitting* sibling. `host.heartbeat` is additive, composes on RFC 0052's tick machinery, and is constrained so it can never become an unbounded background agent: it MUST be idempotent, MUST be runtime-bounded, and MUST emit a state-change event rather than a blind side effect.

## Motivation

The autonomous-agent feature set asks for "an operator [who] wants heartbeats to check my inbox and only notify me if new, unhandled items exist — to avoid spam." Today the only openwop primitives close to this are *triggers* (`core.trigger.email-imap`, `core.trigger.rss`) that **initiate a full run every interval** — which is exactly the spam pattern the operator wants to avoid, because the run fires whether or not anything changed. There is no protocol surface for "evaluate a cheap predicate on a tick; do nothing if state is unchanged; emit a state-change event and maybe enqueue work if it changed."

The spec is the right place because "did the heartbeat fire once per tick, was it idempotent, did it stay within its runtime budget, and how is a state change signaled" are interop guarantees — an operator relying on a heartbeat for an SLA must get the same behavior across hosts. Leaving it host-private (as today) means no two hosts agree on what "heartbeat" means.

## Proposal

### §A — `capabilities.schema.json`: `host.heartbeat` block (additive)

```diff
   "host": {
     "properties": {
+      "heartbeat": {
+        "type": "object",
+        "description": "RFC 0060. System-managed predicate-gated polling. Composes with host.scheduling (RFC 0052) for the interval machinery.",
+        "required": ["supported"],
+        "additionalProperties": false,
+        "properties": {
+          "supported": { "type": "boolean" },
+          "minIntervalSec": { "type": "integer", "minimum": 1, "description": "Smallest interval the host honors; requests below it clamp up." },
+          "maxRuntimeMs": { "type": "integer", "minimum": 1, "description": "Per-tick predicate-evaluation budget; over-budget evaluation is terminated and reported as `heartbeat.evaluated { status: 'timeout' }`." }
+        }
+      }
     }
   }
```

### §B — heartbeat contract (normative, when `host.heartbeat.supported: true`)

A heartbeat binds a **predicate** (a node/workflow designated as the heartbeat handler) to an interval. On each tick the host MUST:

1. **Fire exactly once per tick** — no overlapping evaluations of the same heartbeat; if a prior tick's evaluation is still running, the host MUST skip (not queue) the new tick. (Composes with `idempotency.md` and RFC 0052's once-per-tick rule.)
2. **Bound the evaluation** to `maxRuntimeMs`; an over-budget predicate MUST be terminated and reported, never left running.
3. **Be idempotent** — the predicate receives the prior tick's emitted state (an opaque host-persisted token) and MUST be a pure function of observed external state + prior state. The host MUST NOT perform a side effect directly; the predicate's *output* drives action.
4. **Emit `heartbeat.evaluated`** every tick (observability: `{ heartbeatId, status: 'ok'|'timeout'|'error', changed: boolean }`).
5. **On a state transition only**, emit `heartbeat.stateChanged { heartbeatId, from, to }` and — if the predicate requests it — enqueue a run via the existing `POST /v1/runs` path. An unchanged tick MUST NOT enqueue a run or emit `stateChanged`.

This is what prevents notification spam: the action is gated on a *transition*, computed against persisted prior state, not on the tick itself.

**Positive example.** Inbox heartbeat, 15-minute interval, prior state `unread=0`. Tick observes `unread=0` → `heartbeat.evaluated { changed: false }`, no run, no notify.
**Negative example (correct behavior).** Next tick observes `unread=3` → `heartbeat.evaluated { changed: true }` + `heartbeat.stateChanged { from: {unread:0}, to: {unread:3} }` + one enqueued notify run. A subsequent tick still at `unread=3` → `changed: false`, **no second notification**.

### §C — relationship to RFC 0052

`host.scheduling` provides the durable, once-per-tick interval substrate. `host.heartbeat` is the *predicate-and-state* layer above it: scheduling answers "when," heartbeat answers "evaluate cheaply, and act only on change." A host MAY advertise `scheduling` without `heartbeat`. A host advertising `heartbeat` SHOULD also advertise `scheduling` (the tick source); if it does not, it MUST document its own interval substrate.

### §D — positioning note (non-normative spec edit)

`positioning.md` currently lists "scheduled/cron-driven execution" as a non-fit. RFC 0052 already qualified that; this RFC adds a one-line note that *bounded, predicate-gated, system-managed* heartbeats are an accepted capability, distinct from "the agent runs an unbounded background loop on its own clock" (which remains out of scope — that is the agent's concern, not the host's).

## Compatibility

**Additive.** New optional capability + two new events consumers MAY ignore. No change to existing triggers, scheduling, or run lifecycle. Hosts without `host.heartbeat.supported` are unaffected. No existing conformance pass invalidated.

## Conformance

- **`heartbeat-capability-shape.test.ts`** — block validates; `minIntervalSec`/`maxRuntimeMs` positive. (Always runs.)
- **`heartbeat-fires-once-per-tick.test.ts`** — a tick produces exactly one `heartbeat.evaluated`; an overlapping tick while evaluating is skipped. (Gated; uses the RFC 0052 `scheduling/tick` seam.)
- **`heartbeat-idempotent-no-spam.test.ts`** — two ticks at unchanged state produce zero enqueued runs and zero `stateChanged`; the transitioning tick produces exactly one. (Gated; backs the anti-spam guarantee.)
- **`heartbeat-runtime-bound.test.ts`** — a predicate exceeding `maxRuntimeMs` is terminated and reported `status: 'timeout'`. (Gated.)

## Alternatives considered

1. **Tell operators to use a short-interval `schedule` trigger (RFC 0052).** Rejected — that fires a full run every tick regardless of state, which is the spam the operator is trying to avoid; there is no transition gate.
2. **Make heartbeat a client-side poll (`GET …/events/poll`).** Rejected — that pulls run events on behalf of a *connected client*; it cannot wake when no client is connected, and it inspects run state, not external state.
3. **Let the agent run its own background loop.** Rejected — an agent-managed loop is non-deterministic, unbounded, and contradicts `positioning.md`. The host-managed, bounded, predicate-gated form is the controllable version and the one with an SLA.

## Unresolved questions

1. **Prior-state token shape.** Is the persisted prior-state an opaque host blob, or a typed `{ hash, summary }`? Proposed opaque-with-size-cap. Resolve before Active.
2. **Backpressure.** If enqueued runs from a heartbeat pile up, does the heartbeat self-pause? Proposed: advertise `maxPendingEnqueued`, pause emission past it. Decide before Active.
3. **Interaction with RFC 0061 agent loop.** Can a heartbeat *be* the trigger that advances an agent loop iteration, or are they strictly separate? Proposed separate (heartbeat enqueues a run; the run may be a loop). Confirm with 0061.

## Implementation notes (non-normative)

- `apps/workflow-engine`: build on the RFC 0052 tick seam; the predicate is an ordinary workflow whose output carries `{ changed, enqueue?, notify? }`. Persist prior-state per `heartbeatId`. No new SECURITY invariant at Draft.

## Acceptance criteria

- [ ] `spec/v1/host-capabilities.md` §host.heartbeat + the once-per-tick / idempotent / bounded / emit-on-change contract.
- [ ] `host.heartbeat` block + `heartbeat.evaluated` / `heartbeat.stateChanged` (AsyncAPI).
- [ ] `positioning.md` bounded-exception note.
- [ ] Conformance: shape always-on; behavior capability-gated (anti-spam scenario is the keystone).
- [ ] CHANGELOG entry under `[1.1.4 — unreleased]`.
- [ ] A host advertises `host.heartbeat` and passes idempotent-no-spam, or the RFC defers reference-host wiring.

## References

- [`RFCS/0052-scheduling-and-time-based-triggers.md`](./0052-scheduling-and-time-based-triggers.md) — the tick substrate this composes with.
- [`spec/v1/positioning.md`](../spec/v1/positioning.md) — the request-driven stance this bounds an exception to.
- [`spec/v1/idempotency.md`](../spec/v1/idempotency.md) — once-per-tick + idempotent-evaluation composition.
- `core.openwop.triggers` `email-imap` / `rss` triggers — the spam-prone alternative this improves on.

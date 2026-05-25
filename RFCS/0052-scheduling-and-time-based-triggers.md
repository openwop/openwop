# RFC 0052: Scheduling & time-based triggers (promote + extend RFC 0017)

| Field | Value |
|---|---|
| **RFC** | 0052 |
| **Title** | A `host.scheduling` capability (cron / delayed / calendar) wiring the `schedule` trigger to a portable, durable execution contract — promoting the still-Draft scheduling intent behind RFC 0017's `host.queueBus` into a conformance-tested surface |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-24 |
| **Affects** | `schemas/capabilities.schema.json` (additive `host.scheduling` block) · `spec/v1/host-capabilities.md` (new §host.scheduling) · the `schedule` trigger in `core.openwop.triggers` (execution contract) · `core.control.delay` (clarifies the in-DAG primitive) · RFC 0017 (composes with `host.queueBus`) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add a `host.scheduling` capability — `{ cron, delayed, calendar, maxFutureHorizon }` — that gives the existing `schedule` trigger a portable, durable execution contract: a cron expression / delay / calendar reference produces a durable scheduled run, conformance-tested for fire-once-per-tick, horizon enforcement, and missed-tick policy. This converts host-private schedulers into a certifiable surface. The in-DAG `core.control.delay` primitive (which already reads `config.delayMs`) stays as-is; this RFC governs *time-triggered run initiation*, not in-flight delays.

## Motivation

MyndHyve runs **scheduled routines / recurring agents** (cron) and time-delayed campaign steps. The natural protocol home is RFC 0017 (`host.queueBus`) — but while RFC 0017 itself is `Accepted`, the *scheduling* intent behind it is unwired: the `core.openwop.triggers` pack has a `schedule` trigger with no portable execution contract behind it, so what "a cron fired this run" *means* on the wire is undefined. MyndHyve's scheduler is therefore host-private, and a `schedule`-triggered workflow can't be moved to another host or certified.

The spec is the right place because a scheduled run's initiation semantics (when does it fire, what happens to a missed tick, how far in the future can it be scheduled) are interop guarantees a workflow author depends on — not implementation detail. Two hosts claiming "supports `schedule`" must agree on fire-once-per-tick and horizon behavior or the trigger isn't portable.

## Proposal

### §A — `capabilities.schema.json`: `host.scheduling` block (additive)

```diff
   "host": {
     "properties": {
+      "scheduling": {
+        "type": "object",
+        "description": "RFC 0052. Time-based run initiation behind the `schedule` trigger. Composes with `host.queueBus` (RFC 0017) where the host backs scheduling with a queue.",
+        "properties": {
+          "supported": { "type": "boolean" },
+          "cron": { "type": "boolean", "description": "Host honors cron-expression schedules." },
+          "delayed": { "type": "boolean", "description": "Host honors one-shot delayed execution." },
+          "calendar": { "type": "boolean", "description": "Host honors calendar-reference schedules." },
+          "maxFutureHorizon": { "type": "string", "description": "ISO-8601 duration; the farthest-future a run may be scheduled (e.g. `P90D`). Schedules beyond it are rejected with `schedule_horizon_exceeded`." }
+        },
+        "required": ["supported"],
+        "additionalProperties": false
+      }
     }
   }
```

### §B — `schedule` trigger contract (normative, when `host.scheduling.supported: true`)

A host advertising `host.scheduling.supported: true` MUST, for a `schedule` trigger configured with a cron expr / `delayMs` / calendar ref:

1. Produce a **durable** scheduled run (survives host restart) that fires at the scheduled time.
2. Fire **exactly once per tick** — a cron tick MUST NOT spawn duplicate concurrent runs (idempotent firing; composes with `spec/v1/idempotency.md`).
3. Reject a schedule beyond the advertised `maxFutureHorizon` with `schedule_horizon_exceeded`.
4. Apply a documented **missed-tick policy** — when the host was down across a tick, it MUST either fire-on-recovery once or skip-to-next per its advertised policy (advertised so consumers can reason about it); it MUST NOT silently fire N backlogged runs.

`core.control.delay` (the in-DAG delay that reads `config.delayMs`, per the conformance fixture rules) is **unchanged** and stays the in-DAG primitive — it delays a node mid-run; `host.scheduling` initiates a run at a time. The two are orthogonal; this RFC clarifies the boundary so they aren't conflated.

### §C — Relationship to RFC 0017

RFC 0017's `host.queueBus` is the durable transport a host MAY use to back scheduling; `host.scheduling` is the *time-semantics* layer above it. A host MAY advertise `scheduling` without `queueBus` (e.g. a cron daemon) or back `scheduling` with `queueBus`. This RFC does not modify RFC 0017's block.

## Compatibility

**Additive.** New optional capability block; no change to the `schedule` trigger's *shape*, only a pinned execution contract gated on advertisement; `core.control.delay` unchanged. Hosts without `host.scheduling.supported` are unaffected, and a `schedule`-trigger workflow refuses to register on them (peerDependency `scheduling: 'supported'`). No existing conformance pass is invalidated.

**Composes with RFC 0017** (`host.queueBus`). Independent of Tiers 1–2.

## Conformance

- **`scheduling-capability-shape.test.ts`** — the `host.scheduling` block validates; `maxFutureHorizon` is a valid ISO-8601 duration. (Always runs.)
- **`scheduling-cron-fires-once.test.ts`** — a cron tick produces exactly one run; no duplicate concurrent firing. (Gated on `cron`.)
- **`scheduling-delayed-horizon.test.ts`** — a delayed schedule within the horizon fires; one beyond it returns `schedule_horizon_exceeded`. (Gated on `delayed`.)
- **`scheduling-missed-tick.test.ts`** — host-down-across-a-tick applies the advertised missed-tick policy (fire-once-on-recovery or skip), never a backlog flood. (Gated on `cron`.)

New fixture: a deterministic clock seam (reuse the existing test-clock fixture if present) so cron ticks are reproducible.

## Alternatives considered

1. **Just promote RFC 0017 from Draft and call scheduling an implementation detail of `queueBus`.** Rejected — RFC 0017 is already `Accepted`, and queue transport ≠ time semantics. Fire-once-per-tick and horizon are scheduling guarantees a queue alone doesn't pin.
2. **Express scheduling purely as a node (`core.control.delay` writ large).** Rejected — `delay` is an in-DAG primitive that delays a node *within a run*; scheduling *initiates* runs and must be durable across restart, which is a host capability, not a node.
3. **Standardize a full cron dialect in the spec.** Rejected for v1 — pin the *behavioral* guarantees (once-per-tick, horizon, missed-tick) and let hosts declare their cron dialect; standardizing a dialect is a deeper effort to defer until interop friction shows up.

## Unresolved questions

1. **Cron dialect portability.** Quartz vs Unix cron differ (seconds field, `?`). Should the host advertise its dialect (`cronDialect: 'unix' | 'quartz'`)? Likely yes; add before Active if a second host's dialect differs.
2. **Timezone semantics.** Cron schedules need a timezone anchor (DST handling). Should the trigger config carry an IANA tz, with a normative DST rule? Resolve before Active.
3. **Calendar-reference shape.** `calendar: true` is advertised but the calendar-ref config shape isn't pinned here. Define it when an adopter (beyond cron/delay) needs calendar scheduling.

## Implementation notes (non-normative)

- Schema diff (§A) + the trigger contract land on `Active` promotion with the conformance scenarios.
- Reference-adopter target: MyndHyve maps its routine scheduler onto `host.scheduling` and re-expresses recurring campaigns as scheduled triggers.

## Acceptance criteria

- [x] Spec text merged (this file).
- [x] `scheduling` block (top-level, per the schema convention) in `capabilities.schema.json`.
- [x] `spec/v1/host-capabilities.md` §host.scheduling section + the `schedule` trigger execution contract + the `schedule_horizon_exceeded` error code (registered in `rest-endpoints.md`).
- [~] Conformance — 2 of 4 landed: `scheduling-capability-shape.test.ts` (shape, always runs) + `scheduling-cron-fires-once.test.ts` (once-per-tick + missed-tick, capability-gated, `scheduling/tick` seam soft-skips — registered in `host-sample-test-seams.md`). The delayed-execution horizon + calendar scenarios + a bundled deterministic-clock fixture are deferred until a scheduling host wires the seam.
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host advertises `host.scheduling` and passes cron-fires-once + missed-tick.

**Implementation note (2026-05-25):** Capability block (top-level `capabilities.scheduling`) + `§host.scheduling` contract + `schedule_horizon_exceeded` error code + the two scenarios + the `scheduling/tick` seam landed on `main`. Composes with RFC 0017 `queueBus`; orthogonal to `core.control.delay` (unchanged). No new SECURITY invariant. Status stays `Draft`.

## References

- [`RFCS/0017-host-queue-bus-capability.md`](./0017-host-queue-bus-capability.md) — the durable transport this composes with (`Accepted`).
- [`spec/v1/idempotency.md`](../spec/v1/idempotency.md) — the once-per-tick firing composes with the idempotency layer.
- `core.openwop.triggers` `schedule` trigger + `core.control.delay` (the surfaces this contract wires / delimits).
- Quartz, Unix cron, Temporal schedules (prior art).

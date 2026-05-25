# RFC 0053: Dead-letter routing & failure sinks

| Field | Value |
|---|---|
| **RFC** | 0053 |
| **Title** | A `host.deadLetter` capability + `run.dead_lettered` event — terminally-failed runs/nodes land in a durable, inspectable sink that stays fork-eligible, so a poisoned run can be examined and replayed rather than silently lost |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-25 (Draft → Active: MyndHyve non-steward implementation landed — advertise + behavioral seams shipped per `docs/openwop-adoption/0045-0054-cohort-summary.md` (MyndHyve, 2026-05-25). Active → Accepted is gated on the published `@openwop/openwop-conformance@1.6.0` conformance run against `api.myndhyve.ai/workflow-runtime` reporting pass, per `RFCS/0001` §"Promotion to Accepted".) |
| **Affects** | `schemas/capabilities.schema.json` (additive `host.deadLetter` block) · `schemas/run-event-payloads.schema.json` (additive `run.dead_lettered` event) · `spec/v1/host-capabilities.md` (new §host.deadLetter) · RFC 0009 (retry) + RFC 0011 (fork/replay) composition · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add a `host.deadLetter` capability — `{ supported, retentionDays }` — and a `run.dead_lettered { runId, nodeId, reason, attempts }` event so a run (or node) that exhausts its retries lands in a durable, inspectable sink instead of being logged and lost. A dead-lettered run remains **fork-eligible** (RFC 0011), so it can be inspected and replayed/retried. This composes with the existing retry (RFC 0009) and fork/replay (RFC 0011) machinery and is distinct from RFC 0017's `queueBus.deadLetterSupported` (which dead-letters *queue messages*, not *runs*).

## Motivation

When a MyndHyve workflow node exhausts its retries, the failure is logged but there is no portable **dead-letter sink** — no standard place a poisoned run lands for inspection and replay. openwop has retry policies (RFC 0009) and idempotency, and RFC 0017's `queueBus` can dead-letter *transport messages*, but there is no run-level DLQ surface: "this run died terminally, here's where it went, and you can fork it from there." Reliability at production scale (Bryce's campaigns) needs this, and without it any DLQ MyndHyve builds is host-private and uncertifiable — a federated peer can't discover that a dispatched sub-workflow dead-lettered.

The spec is the right place because dead-lettering is the terminal half of the retry/replay contract that already lives in the protocol (RFC 0009/0011): a terminally-failed run's disposition (where it lands, how long it's retained, that it stays fork-eligible) is an interop guarantee, not implementation detail.

## Proposal

### §A — `capabilities.schema.json`: `host.deadLetter` block (additive)

```diff
   "host": {
     "properties": {
+      "deadLetter": {
+        "type": "object",
+        "description": "RFC 0053. Run-level dead-letter sink for terminally-failed runs/nodes. Distinct from queueBus.deadLetterSupported (which dead-letters transport messages). Dead-lettered runs remain fork-eligible (RFC 0011).",
+        "properties": {
+          "supported": { "type": "boolean" },
+          "retentionDays": { "type": "integer", "minimum": 1, "description": "Days a dead-lettered run is retained for inspection/fork before purge." }
+        },
+        "required": ["supported"],
+        "additionalProperties": false
+      }
     }
   }
```

### §B — `run.dead_lettered` event (additive)

Add to `run-event-payloads.schema.json`:

```json
"run.dead_lettered": {
  "type": "object",
  "required": ["runId", "reason", "attempts"],
  "properties": {
    "runId": { "type": "string" },
    "nodeId": { "type": "string", "description": "The node whose retry exhaustion dead-lettered the run; absent for run-level failures." },
    "reason": { "type": "string", "description": "Redaction-safe terminal-failure reason." },
    "attempts": { "type": "integer", "minimum": 1, "description": "Total attempts made before dead-lettering." }
  }
}
```

### §C — Contract (normative, when `host.deadLetter.supported: true`)

A host advertising `host.deadLetter.supported: true` MUST:

1. On retry exhaustion (per the RFC 0009 retry policy), route the run/node to the dead-letter sink and emit `run.dead_lettered`. The run's terminal `RunSnapshot.status` reflects failure; the run is **not** purged before `retentionDays`.
2. Keep the dead-lettered run **fork-eligible** per RFC 0011 — it can be forked/replayed (e.g. after the underlying cause is fixed) for the retention window.
3. Purge the run after `retentionDays`; a fork attempt on a purged run returns the existing RFC 0011 not-found error.

`run.dead_lettered` carries no credential or payload material beyond a redaction-safe `reason` (composes with the RFC 0046 redaction invariant where credentials were in scope).

## Compatibility

**Additive.** New optional capability block; new event consumers can ignore; no required-field change. Hosts without `host.deadLetter.supported` are unaffected (they continue to fail runs as today, with no sink). No existing conformance pass is invalidated.

**Composes with RFC 0009** (retry exhaustion is the trigger) and **RFC 0011** (dead-lettered runs are fork-eligible). Independent of Tiers 1–2 and of RFC 0017's transport-level dead-lettering.

## Conformance

- **`deadletter-capability-shape.test.ts`** — `host.deadLetter` block validates; `retentionDays ≥ 1`. (Always runs.)
- **`deadletter-retry-exhaustion.test.ts`** — a node that exhausts its RFC 0009 retry policy emits `run.dead_lettered` with the correct `attempts`; the run is not purged. (Gated on `host.deadLetter.supported`.)
- **`deadletter-fork-replayable.test.ts`** — a dead-lettered run is forkable per RFC 0011 within the retention window. (Gated on `host.deadLetter.supported` ∧ fork support.)
- **`deadletter-retention.test.ts`** — after `retentionDays` the run is purged; a fork attempt returns not-found. (Gated; may use a clock seam.)

New fixture: a workflow node that deterministically exhausts a short retry policy, catalogued in `fixtures.md`.

## Alternatives considered

1. **Reuse RFC 0017's `queueBus.deadLetterSupported`.** Rejected — that dead-letters *transport messages* on a queue backend, not *runs* in the engine. A run-level DLQ has different semantics (fork-eligibility, run retention) and must exist on hosts with no queue bus at all.
2. **Make dead-lettering implicit (no event, just a terminal status).** Rejected — without an event, a federated peer or a dispatching parent can't discover that a sub-workflow dead-lettered, and conformance can't assert it happened. The event is the observable contract.
3. **Auto-retry dead-lettered runs on a schedule.** Rejected for v1 — automatic re-drive risks re-poisoning; keeping dead-lettered runs *fork-eligible* (operator-driven replay) is safer. Auto-redrive can be a later opt-in.

## Unresolved questions

1. **Sink scoping.** Should the dead-letter sink be scoped per RFC 0048 workspace (so a workspace only sees its own dead-lettered runs)? Likely yes; align with RFC 0048 owner-scoping before Active.
2. **Partial dead-lettering.** A run with one dead node but otherwise-complete branches — is the *run* dead-lettered or just the *node*? The `nodeId` field allows node-level, but the run-status semantics need pinning before Active.
3. **Max attempts surfacing.** Should `attempts` reconcile with the RFC 0009 retry-policy `maxAttempts` (always equal at dead-letter)? Confirm the relationship before Active.

## Implementation notes (non-normative)

- Schema diffs (§A, §B) land on `Active` promotion with the conformance scenarios.
- Reference-adopter target: MyndHyve adds a DLQ sink keyed by workspace and surfaces it in the Active Runs dashboard / workflow studio.

## Acceptance criteria

- [x] Spec text merged (this file).
- [x] `deadLetter` block (top-level, per the schema convention) in `capabilities.schema.json`.
- [x] `run.dead_lettered` event in `run-event-payloads.schema.json` (+ `RunEventType` enum).
- [x] `spec/v1/host-capabilities.md` §host.deadLetter section.
- [~] Conformance — 2 of 4 landed: `deadletter-capability-shape.test.ts` (shape, always runs) + `deadletter-retry-exhaustion.test.ts` (retry-exhaustion → `run.dead_lettered` + fork-eligibility, capability-gated, `deadletter/exhaust` seam soft-skips — registered in `host-sample-test-seams.md`). The retention-purge scenario (needs a clock seam) is deferred.
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host advertises `host.deadLetter` and passes retry-exhaustion + fork-replayable.

**Implementation note (2026-05-25):** Capability block (top-level `capabilities.deadLetter`) + `run.dead_lettered` event + `§host.deadLetter` contract + the two scenarios + the `deadletter/exhaust` seam landed on `main`. Composes with RFC 0009 retry + RFC 0011 fork; distinct from `queueBus.deadLetterSupported` (transport-level). No new SECURITY invariant. Status stays `Draft`. **Completes the MyndHyve protocol-extension batch (RFCs 0045–0054) on the openwop side.**

## References

- [`RFCS/0009-production-profile-conformance.md`](./0009-production-profile-conformance.md) — the retry policy whose exhaustion triggers dead-lettering.
- [`RFCS/0011-auth-scoped-discovery.md`](./0011-auth-scoped-discovery.md) — fork/replay eligibility (dead-lettered runs stay forkable).
- [`RFCS/0017-host-queue-bus-capability.md`](./0017-host-queue-bus-capability.md) — `queueBus.deadLetterSupported` (transport-level DLQ, distinct from this run-level sink).
- AWS SQS dead-letter queues, Temporal failed-workflow retention (prior art).

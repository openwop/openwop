# RFC 0194: a run's terminal event is emitted once and ends its forward execution

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0194                                                            |
| **Title**         | a run's terminal event is emitted once and ends its forward execution |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-21                                                      |
| **Updated**       | 2026-09-21 (filed `Draft`; **the public comment window runs in full, to 2026-09-28** — RFC 0147 §A.6: this RFC affects replay, so bootstrap waiver language MUST NOT shorten its window) · 2026-09-21 (later) — `Draft → Active`; **comment window waived** by the steward on 2026-09-21 — an explicit **steward override of RFC 0147 §A.6**, which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant, recorded there as an override, not as a routine waiver (this RFC affects replay). · 2026-09-22 — **`Active → Accepted`, provisional pending RFC 0156 §B retrospective review** (it went `Active` under a waived window; RFC 0147 requires such cohorts to be reviewed cross-organization or held provisional — the register row stays `not-reviewed`). Evidence tier: tier-1 — the v2 reference host (openwop-examples), a reference example and not a production host; single witness, on the published suite 2.35.0, build `commit:8477d75`, nothing relaxed, all profiles certified: both `openwop.requirement.0194.terminal-once` (4 runs: completed ×2, failed, cancelled) and `.duplicate-delivery` `executed-pass`. · 2026-09-22 (later) — **a second, production witness** (tier-2): MyndHyve on the published 2.35.0, build `commit:ace23a7e`, both rows `executed-pass`, including a staged duplicate delivery; the host also reports a read-only scan of 400 recent production runs in which no event other than `compensation.*` and `run.dead-lettered` follows a terminal event (host-reported). · 2026-09-22 (evening) — **a third witness, production:** openwop-app on the published 2.35.1, build `commit:b5066568d`, `0194.terminal-once` `executed-pass` — after the host moved the rule into its store, inside the per-run lock every append takes, because the cut caught a cancel on one Cloud Run instance racing the executor on another (`run.started run.cancelled node.started`). `.duplicate-delivery` is `inapplicable` there (no durability test hook in production). |
| **Affects**       | `spec/v2/core/events.md` (new §"The terminal event"), `spec/v2/core/runs.md` (by reference), `spec/v2/core/replay.md` (fork point), conformance (one new major-2 scenario) |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                               |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Nothing in the v2 corpus says a run has **one** terminal event, or that its forward execution stops there. Two independently written hosts, given the same accepted work twice, wrote logs that continued past `run.completed` — one of them with two `run.completed` events. This RFC states the rule the schema's own descriptions ("Emitted once…") and `replay.md` ("the source run's recorded terminal outcome") already assume, scoped to **forward execution** so that compensation, which the corpus requires to continue after a cancelled parent, stays legal. It adds one fork-point clause so a fork cannot inherit a terminal event and then run on.

## Motivation

openwop#1445, observed 2026-09-20 while building RFC 0158's `duplicate-delivery` row:

| host | log under duplicate delivery |
| --- | --- |
| openwop-app | `run.completed` at seq 8, then `node.failed` at seq 9; with an HTTP-effect node, `run.completed` twice |
| v2 reference host (before openwop-examples#64) | two `node.completed`, two `run.completed` |

Read — not grepped — for a clause in `spec/v2/core/events.md`, `runs.md`, `persistence.md` and `replay.md`: there is none. The only trace is descriptive: `schemas/v2/run-event-payloads.schema.json` says each terminal payload is "Emitted once", and `runCompleted` "Closes the SSE stream".

It matters in three places. **Replay/fork:** `[0, fromSeq)` byte-equivalence and "the source run's recorded terminal outcome" are ambiguous on a log with two terminal outcomes. **Consumers:** a stream consumer stops at the first terminal event and a poll consumer sees what follows — one run, two histories by transport. **Webhooks:** a subscriber to `run.completed` is delivered it twice.

**Why "forward execution" and not "nothing follows".** `spec/v1/compensation.md` §"Cancellation of the parent" requires, under `onParentCancel: continue`, that "the unwind runs to its terminal rollup while the run's forward `status` becomes `cancelled`" — `compensation.*` events legitimately follow `run.cancelled`. Operator recovery actions on a held plan (§"Operator recovery actions") and `run.dead-lettered` (`host-capabilities.md` §host.deadLetter) also record after the run ended. A blanket "nothing follows" would make every compensating host non-conformant.

## Proposal

### §A The terminal event

1. A run's log MUST contain exactly one terminal run event: `run.completed`, `run.failed` or `run.cancelled`.
2. After it, the log MUST NOT contain another terminal run event, `run.started`, `run.resumed`, `run.resume-started`, `run.paused`, `run.restored-from-snapshot`, any `node.*` event, or any `interrupt.*` event.
3. `compensation.*` events and `run.dead-lettered` MAY follow the terminal event. Vendor-prefixed types are not constrained by this section.

### §B Work that arrives for a terminal run

4. A host that receives work for a run whose terminal event is already recorded — a duplicate delivery, a late worker, a retried dispatch — MUST NOT append forward-execution events for it (§A.2) and SHOULD record the refusal in its own operational log. It MUST NOT surface the refusal as a run event.

### §C The fork point

5. A fork whose `fromSeq` is greater than the sequence of the source run's terminal run event MUST be refused `422 fork_point_invalid`. Such a fork would inherit a terminal event as fixed history and then execute. On a run whose terminal event is its last event this is already the case (`replay.md` §The surface: a sequence absent from the source log is `422`); the clause binds only where a compensation tail follows the terminal event.

This RFC changes no rule about when a stream closes.

**Positive example.** `run.started`, `node.started`, `node.completed`, `run.cancelled`, `compensation.requested`, `compensation.started`, `compensation.completed` — conformant (§A.3).

**Negative example.** `run.started`, `node.started`, `node.started`, `node.completed`, `run.completed`, `node.completed`, `run.completed` — violates §A.1 (two terminal events) and §A.2 (`node.completed` after one).

## Compatibility

**Additive.** No schema, event shape, endpoint or error changes. §A states what `run-event-payloads.schema.json` ("Emitted once when the run reaches…") and `replay.md` already assume; a host whose logs follow the schema's descriptions is unchanged. §C refuses only a fork point that could not produce a conformant log. No `MUST` is relaxed.

## Conformance

One new major-2 scenario, landing when this RFC is `Active` (a scenario may not cite a `Draft` RFC — `check-rfc-status-coherence.mjs` rule 7).

- **Ordinary runs** — a noop run to `completed`; `conformance-failure` to `failed` and `conformance-cancellable` cancelled through `POST /runs/{runId}/cancel` to `cancelled`, each gated on the fixture being advertised. After the run reports terminal, the log is re-read until two reads at least 2 s apart return the same length (bounded at 20 s), then checked against §A.1–§A.2. Growth after a terminal event is the violation's own evidence, not an inconclusive result.
- **Duplicate delivery** — only where the non-normative RFC 0158 test hook `POST /host/durability/kill` is mounted: stage `mode: duplicate-delivery` against an effect receiver the suite owns, wait for the effect's arrival and the run's terminal status, settle as above, and check the log. `inapplicable` where the hook answers `404` or `405`.
- A dedicated scenario rather than a check added to every scenario that reaches a terminal state: a host violating this RFC must fail this RFC's rows, not unrelated ones (openwop#1450 showed what misattribution costs).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 exactly one terminal run event | `openwop.requirement.0194.terminal-once` — the log of a run observed to terminal carries one `run.completed` / `run.failed` / `run.cancelled` | the suite, unaided (noop); fixture-gated for failed and cancelled | witnessable — gated on fixture advertisement for the failed and cancelled legs |
| §A.2 no forward execution after it | the same read: no listed type after the terminal event, after the log settles | the suite, unaided; under redelivery only through the RFC 0158 test hook (`openwop.requirement.0194.terminal-once.duplicate-delivery`) | witnessable — seam-gated for the redelivery case (a black-box suite cannot make a host's queue redeliver accepted work) |
| §B.4 the refusal is recorded in the operational log | nothing — a host's operational log is not on the wire | — | unwitnessable — host-internal by construction; the wire half is §A.2 |
| §C.5 a fork point after the terminal event is refused | `422 fork_point_invalid` for such a `fromSeq` | the suite, only on a host whose run has a compensation tail | witnessable — gated on the `compensation` family; no committed host bundle witnesses it |

## Alternatives considered

- **"Nothing follows the terminal event."** Simpler and wrong: it outlaws compensation after a cancelled parent, which `compensation.md` requires.
- **A second, non-run-scoped channel for late work.** Invents a surface no consumer asked for; §B.4's operational-log SHOULD records the same fact without a wire change.
- **Retrofit the check into every scenario that reaches a terminal state.** More coverage per run, but a single defect would fail unrelated rows.
- **Do nothing.** Leaves replay's "recorded terminal outcome" undefined on exactly the logs a duplicate delivery produces.

## Unresolved questions

1. Should `run.dead-lettered` be required to follow `run.failed` rather than merely permitted to? Left permissive: the dead-letter sink's timing is a host's queue behaviour.
2. Should a stream close on `run.failed` / `run.cancelled` as well as `run.completed`? Out of scope here; this RFC changes no closure rule.

## Implementation notes (non-normative)

The v2 reference host already conforms (openwop-examples#64 re-reads after a node's `await` and defers to what the other delivery recorded; measured 2026-09-21 on five ordinary runs and a staged duplicate delivery). openwop-app tracks the defect host-side. A shared helper in the suite (`terminalShapeViolation(types)`) lets a later scenario add a cheap leg under this RFC's ids.

## Acceptance criteria

- [x] `Active` — 2026-09-21, by steward override of RFC 0147 §A.6 (the window was waived, not run; see `Updated`).
- [x] Spec text merged: `events.md` §"The terminal event", `replay.md` fork point (2026-09-21, 2.35.0). `runs.md` needs no pointer: `events.md` is the normative home for log shape.
- [x] The scenario ships in a published suite (2.35.0, 2026-09-22).
- [x] A committed host bundle carries both `openwop.requirement.0194.terminal-once` and `.duplicate-delivery` at `executed-pass` (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, suite 2.35.0).
- [x] CHANGELOG entry.

## References

- openwop#1445; RFC 0158 (the duplicate-delivery test hook); RFC 0147 §A.6 (why the window runs in full).
- `spec/v1/compensation.md` §"Cancellation of the parent", §"Operator recovery actions"; `spec/v1/host-capabilities.md` §host.deadLetter; `spec/v2/core/replay.md`.

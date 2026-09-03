# OpenWOP Spec v1 — Agent Runtime: Standing Goals

> **Status: Stable · v1.x (RFC 0097, `Accepted`; graduated 2026-09-03 under RFC 0174 §D.1 — the banner's own predicate had fired).** Normative spec for the standing-goal primitive — a durable objective with judge-based completion and bounded continuation. Capability-gated on `capabilities.agents.goals`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend. This doc graduates `Draft → Stable` when RFC 0097 reaches `Accepted`.

## Why this exists

"Keep working until the release checklist is complete" is a different shape from everything else openwop models. RFC 0052/0058/0060 *fire* a run on a clock or predicate; RFC 0068 fires a run when an inferred commitment's condition is met. All are **arms that trigger work**. None models a **standing objective that judges its own completion and re-engages until satisfied**. The distinction is convergence, not triggering: a goal owns (1) a success predicate, (2) a judge that evaluates progress after each contributing run, and (3) a continuation decision.

openwop already has the parts — the **judge** (RFC 0090 verifier & convergence), the **continuation arm** (RFC 0052/0060/0068), and the **safety rails** (RFC 0058 execution bounds, RFC 0044 escalation, RFC 0084 budget). This section pins the **objective object** that ties a success criterion to a judge to a continuation loop, plus the hard invariant that continuation **MUST** terminate at a declared bound or an unmet escalation. The *judge model* and the *planning* stay host choices.

## The `Goal` object

A `Goal` (`schemas/goal.schema.json`) carries an `objective` (SR-1 redaction-safe), a `state` (`active | satisfied | escalated | abandoned | bound-exceeded`), a `completion` block (the judge — an RFC 0090 `verifier` verdict or an opaque `host` evaluator, with the recorded `lastVerdict`), a `continuation` block (`mode ∈ {schedule, commitment, heartbeat, manual}` + an `armRef`), an RFC 0058 `bounds` block, optional `progress`, and an `owner` (RFC 0048).

Hosts advertise the supported `judge`, the `continuation` modes, and `requiresBounds` under `capabilities.agents.goals`.

## Normative requirements

1. **Judge-only completion.** A goal's completion **MUST** be determined by the judge declared in `completion.check` (an RFC 0090 verifier verdict or the host evaluator). A client **MUST NOT** be able to set `state: satisfied` directly. (SECURITY invariant `goal-completion-judge-only`.)
2. **Bounded continuation.** Continuation **MUST** be bounded: when `requiresBounds` is advertised, an `active` goal without RFC 0058 `bounds` is invalid (`POST /goals` ⇒ `422`). The host **MUST** stop continuation and set `state: bound-exceeded` (emitting `goal.closed`) when any declared bound is crossed — iteration count, accumulated cost (RFC 0084), or wall-clock deadline. (SECURITY invariant `goal-continuation-bounded`.)
3. **Escalation halt.** If the agent cannot make progress and emits an RFC 0044 confidence-escalation interrupt against a goal, the host **MUST** set `state: escalated` and stop continuation until a human resolves it.
4. **Attribution + replay.** Each judge evaluation **MUST** be attributable to the `runId` it evaluated (`goal.evaluated.runId`); `progress.contributingRunIds` is RFC 0040 causation-compatible. The verdict (`satisfied`/`confidence`) is non-deterministic judge output and **MUST** be recorded in the `goal.evaluated` event and **MUST NOT** be recomputed on replay/fork (`replay.md`).
5. **Redaction.** `objective` and any verdict payload **MUST** be SR-1 redaction-safe.

## Endpoints + events

The host serves the goal surface as a host-extension under `/v1/host/sample/goals` (`GET` list/read, `POST` create, `PATCH` edit, `POST .../pause|resume|abandon` — see `host-sample-test-seams.md`), promotable to the normative `/v1/goals` at graduation. There is **no** `complete`/`satisfy` write — completion is the judge's verdict, never a client assertion. Two additive, content-free events are emitted (gated on the capability): `goal.evaluated` (after each judge check) and `goal.closed` (`run-event-payloads.schema.json`).

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 3 row(s) this table carried are now `openwop.gap.spec.agent-runtime.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

## References

- `schemas/goal.schema.json`
- `capabilities.md` §`agents.goals`
- `RFCS/0097-standing-goals-and-judge-based-continuation.md`
- `RFCS/0090-agent-verifier-and-convergence.md` (the judge)
- `RFCS/0058` execution bounds · `RFCS/0044` confidence escalation · `RFCS/0084` budget
- `conformance/src/scenarios/goal-standing-continuation.test.ts`

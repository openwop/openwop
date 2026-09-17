# RFC 0186: three payload seats the hosts measured and the corpus lacked

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0186                                                            |
| **Title**         | Three payload seats the hosts measured and the corpus lacked    |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-17                                                      |
| **Updated**       | 2026-09-17 (`Draft` → `Active`; **comment window waived** (additive, 7-day) by the steward under the bootstrap rule — every seat is a strict widening measured from two hosts' persisted payloads, and the witness ships in the same PR) |
| **Affects**       | `schemas/v2/run-event-payloads.schema.json` (`conversationExchanged`, `interruptResolved`, `nodeSuspended`), `schemas/v2/conversation-event.schema.json` (`ConversationExchangedPayload` becomes an alias), `schemas/v2/suspend-request.schema.json` (`ApprovalData.onTimeout`), `scripts/check-payload-closure-hatched.mjs` (a `MODELLED` disposition), `conformance/src/scenarios/v2-payload-seats-0186.test.ts` |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1) — three optional properties added, one closed def widened to the union of two existing shapes, one orphan turned into an alias; no required field, no retype, no MUST relaxed |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0185 gave hosts a hatch for facts the corpus does not model. Both production hosts then measured what they actually record, and three of those facts turned out to deserve a **named seat** rather than a vendor key: the conversation turn content, the cause of an unattended resolution, and the disposition of an approval gate that times out. This RFC seats them. Every one is a strict widening; every one came from a host's persisted payloads, not from a reading of the spec.

## Motivation

RFC 0185 §E declined to invent seats from the reporting side, on the principle that a seat's shape has to come from the host that fills it. This is the RFC that principle was waiting for. The three shapes below were each answered on the `/crosstalk v2` bus between 2026-09-16 and 2026-09-17, by the host that emits them, from emit sites and write-seam audits — not from samples.

## Proposal

### §A.1 `conversation.exchanged` — one def, not two

The corpus carried **two closed defs for one event**, and they contradicted each other:

```
run-event-payloads.conversationExchanged           { conversationId, turnIndex, outcome? }   codemap-bound
conversation-event.ConversationExchangedPayload    { conversationId, turnIndex, turn }       orphaned; turn REQUIRED
```

A payload with `turn` failed the bound def; one with `outcome` failed the orphan. `spec/v2/event-codemap.json` bound the first, while a fully specified `ConversationTurn` (`messageId`, `from`, `content`, `ts`, `role`, `turnIndex`) sat beside the second, `$ref`d by nothing outside its own file.

**Measured:** the tier-1 host emits `{conversationId, turnIndex, turn}` — never `outcome` — from `persistExchange.ts:52`, and had been failing the bound def for as long as both existed. The tier-2 host emits `{conversationId, turnIndex, outcome?}` — never `turn` — from `conversationGate.node.ts:214`, where `outcome` is the `ctx.suspend` resume value. Neither ever writes both.

**Decision:** the bound def becomes the union `{conversationId, turnIndex, turn?, outcome?}`, with `turn` a `$ref` to `ConversationTurn`. Both optional, so the result is a strict widening of *both* prior shapes and no host breaks. `outcome` survives because it is not a synonym for `turn` — it carries the resume value. `ConversationExchangedPayload` becomes an **alias** of the union so `conversation-event.schema.json`'s own `oneOf` and any consumer that reached that name keep resolving; `turn` is no longer required there.

**Rejected:** flipping the codemap to the orphan. That trades the tier-1 host's breakage for the tier-2 host's, and `turn`-required would have refused a shape one host has emitted for months.

**`oneOf` safety, checked rather than assumed:** `ConversationOpenedPayload` requires `initialTurn` and `ConversationClosedPayload` requires `finalTurn`; the union is `additionalProperties: false` and names neither, so a payload can match at most one branch. The scenario asserts it.

### §A.2 `reason` — a cause, on two defs

RFC 0183 established two axes on `interruptResolved`: `decision` (*what* was decided — governance) and `action` (*how* the resume applied). The tier-1 host then measured a third fact its gate timeout records: `reason: 'timeout'` — *what triggered the resolution without a human*. Quorum-rejected and nobody-answered are the same `decision: 'rejected'` with different provenance, and the second is the host acting on its own.

The tier-2 host drops the same fact on **350 rows** of `node.suspended`, which has no `reason` either.

**Decision:** optional `reason` (string, 1–64) on both `interruptResolved` and `nodeSuspended`. A **string with a documented domain**, not an enum, because the domain is host-grown: `timeout`, `condition`, `false-positive`, `over-threshold`, `quorum-reject`, `timer` are the values recorded today. The four vocabularies on one event are disjoint by construction — `kind` is the interrupt kind, `decision` the governance outcome, `action` the resume action, `reason` the cause — so none can collide.

**Not seated:** `interrupt.resolved.outcome`. Measured single-valued `'rejected'` on the emitting host — a duplicate of `decision`, and that host is deleting it.

### §A.3 `ApprovalData.onTimeout` — the one field that was genuinely missing

RFC 0185's closure gate waived `approvalRequested` pending host input. The tier-2 host answered with the full historical key set — `{title, message, timeout, onTimeout}`, 280 rows — and with the observation that these payloads were the **wrong model**, not extra keys on the right one: the right one already existed.

`suspend-request.schema.json` `$defs.ApprovalData` seats `title`, `artifactId`, `artifactType`, `actions`, `description`, `artifactData` and the quorum fields, and `suspend-request` itself carries `timeoutMs`. So:

| host key | seat | note |
| --- | --- | --- |
| `title` | `ApprovalData.title` | already seated |
| `message` | `ApprovalData.description` | same fact — the prose under the title on the approval card (`node.approvalMessage`) |
| `timeout` | `suspend-request.timeoutMs` | milliseconds; `0` means **no timer**, which `timeoutMs` MUST read the same way |
| `onTimeout` | **nothing** | unmodelled anywhere in `spec/v1`, `spec/v2` or any schema |

**Decision:** optional `onTimeout` on `ApprovalData`, enum `reject | approve | escalate` — taken from the host's own type (`onTimeout?: 'reject' | 'approve' | 'escalate'`) and its zod schema, not from a sample. Every gate with a timer needs a disposition; `escalate` pairs with a host-defined target. It goes on `ApprovalData` rather than `suspend-request` because it is approval-kind policy and `suspend-request` is kind-agnostic.

**The closure gate learns a third disposition.** `approvalRequested` moves from `PENDING` to a new `MODELLED` map in `check-payload-closure-hatched.mjs`: a deliberate open → closed narrowing whose remedy was a seat, cited. Hatching it would only invite hosts back to bare keys. Shrink-only like `PENDING`; a `MODELLED` def that turns out to be hatched fails the gate.

**`clarificationRequested` stays `PENDING`.** The tier-2 host has no emitter for it (no sample in 3000 runs — clarifications route through `SuspendManager` and surface as `node.suspended{kind:'clarification'}`); the tier-1 host has not answered. If neither emits it, the waiver becomes a deletion.

## Compatibility

`additive`, against COMPATIBILITY.md §2.2: no required field added, removed or retyped; no optional field retyped; the one event-type shape change is a superset of both prior shapes; no endpoint contract touched; no MUST relaxed; no error code's meaning changed. A `$ref` alias in place of a closed def is a widening for the one consumer that reached it (`turn` was required; now optional).

## Conformance

`conformance/src/scenarios/v2-payload-seats-0186.test.ts` (server-free, unconditional — schema validation needs no host). It asserts both host shapes validate against the union and a payload with neither optional still does; the union stays closed; the alias resolves; the `conversation-event` `oneOf` matches exactly one branch for an exchanged **and** a closed payload; `reason` validates on both defs, refuses empty, and neither def reopens; `onTimeout` admits the three values, refuses a fourth, and `ApprovalData` still refuses the legacy bare `message`.

Sabotage-proved: removing `turn` from the union, removing `reason` from `nodeSuspended`, and widening the `onTimeout` enum each red the scenario; restore green.

## Unresolved

- `clarificationRequested` — deletion or seat, pending the tier-1 host's emitter answer.
- Whether `reason`'s domain should close to an enum once both hosts' values stabilise. Not now: the values are host-grown and a fifth would otherwise need an RFC.
- `escalate` names a target the corpus does not model (`escalationTarget`, `escalationTimeout` on one host). Out of scope here; recorded so it is not rediscovered.

## Acceptance criteria

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Both hosts' `conversation.exchanged` shapes validate against one bound def | scenario §A.1; hosts' emit sites cited |
| 2 | The orphan is an alias, and the `oneOf` cannot double-match | scenario §A.1 |
| 3 | `reason` seats on `interruptResolved` and `nodeSuspended` without reopening either | scenario §A.2 |
| 4 | `onTimeout` is a closed enum from the host's type | scenario §A.3 |
| 5 | `approvalRequested` leaves `PENDING` for a cited `MODELLED` disposition | `check-payload-closure-hatched.mjs` |
| 6 | No seat was invented from the reporting side | every value domain above cites the host that recorded it |

# RFC 0185: v2 closed 53 run-event payload defs that v1 left open, with no hatch and no migration row

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0185                                                            |
| **Title**         | v2 closed 53 run-event payload defs that v1 left open, with no hatch and no migration row |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-16                                                      |
| **Updated**       | 2026-09-16                                                      |
| **Affects**       | `schemas/v2/run-event-payloads.schema.json` (53 defs), `spec/v2/core/events.md`, `spec/v2/event-codemap.json` (§D, proposed), `schemas/v2/conversation-event.schema.json` (§D, cited) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1) — a `patternProperties` hatch WIDENS a closed object; no property is added, removed or retyped, and no MUST is relaxed. §C adds one MUST NOT. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

> **Active 2026-09-16.** The §B hatch and the §C MUST NOT ship in this PR and
> are witnessed by `v2-payload-vendor-hatch.test.ts`, so the rule is in force and
> a shipped scenario may cite it (`check-rfc-status-coherence`). The 7-day
> comment window applies to the §D and §E questions, which this RFC deliberately
> leaves open and which nothing in the corpus depends on yet.

## Summary

`schemas/run-event-payloads.schema.json` (v1) declares **`additionalProperties: true`** on its payload defs. `schemas/v2/run-event-payloads.schema.json` declares **`additionalProperties: false`** on the same defs. **53 defs made that transition. None carries a vendor hatch. No migration row records it.**

So every extra key a host **legitimately** recorded under v1 — v1 explicitly invited them — became invalid at the v2 cut, with nowhere in the corpus to put it. This RFC adds the RFC 0177 §C.2 hatch to those 53 defs, and forbids silently dropping what lands in it.

## Motivation

### This was not hosts being sloppy

That framing was my first instinct and it is wrong. `additionalProperties: true` is not an oversight a schema author leaves lying around; it is an explicit statement that extra keys are allowed. Two production hosts took the corpus at its word for the life of v1.

**What it cost, measured independently by both:**

- One host's major-2 read drops **32 distinct keys** across 20 types — including `conversation.exchanged.turn` (**the conversation content**, read by two SPA modules), `replay.diverged.expected`/`.actual` (the divergence evidence, which is the entire point of the event), and `artifact.created.documentId`/`.versionId`.
- The other projects era-3 rows **on the write path**, so an undeclared key is gone **at rest**, not merely absent on the wire. It lost `variable.changed`'s value that way: the def seats `next`/`previous`, the host writes `value`, and every variable in an era-3 run would reconstruct as `undefined`. Not yet realised only because era 3 is currently its conformance lane.

Neither had a conforming place to put the data. Both had a validator that got **happier** the more they deleted.

### The thing that makes this urgent rather than tidy

A closed def plus a projection step is a **data-destroying combination**, and nothing in the corpus says so. `additionalProperties: false` means "this document is invalid". It does not mean "delete the offending key and carry on" — but that is the natural implementation, it passes every schema check afterwards, and on a write path it is irreversible.

## Proposal

### §A The finding

| | |
| --- | --- |
| v2 run-event payload object defs | 106 |
| **open in v1 → closed in v2** | **53** |
| of those, carrying a vendor hatch | **0** |
| migration rows recording the narrowing | **0** |

### §B The hatch (normative)

Each of the 53 defs gains the RFC 0177 §C.2 pattern already carried by every pack-authored document:

```json
"patternProperties": { "^(openwop-|x-|vendor\\.)": { … } }
```

A property matching it is carried **opaquely**: a host MUST NOT interpret it. The defs stay `additionalProperties: false` — an arbitrary key is still invalid, which is the property the closure was for. What changes is that a host recording a fact the corpus does not model now has a **conforming** place to put it instead of a choice between an invalid document and deleting user data.

This is deliberately the *same* pattern as RFC 0177 §C.2 rather than a new one. Two escape-hatch grammars in one corpus is how a reader ends up applying the wrong one.

### §C Silence is not a disposition (normative)

**A host MUST NOT silently drop a property when projecting a run-event payload.** It MUST either carry it (under §B, or because the def names it), or fail the projection.

Dropping is currently the cheapest implementation and the only one that leaves no trace. Both reporting hosts arrived at it independently, neither intended it, and one of them found it only because a *different* audit went looking for something else.

### §D `conversation.exchanged` has two closed defs, and they contradict each other

Found while checking whether the reported `turn` loss was really unmodelled:

```
schemas/v2/conversation-event.schema.json  ConversationExchangedPayload
    { conversationId, turn, turnIndex }                        closed
schemas/v2/run-event-payloads.schema.json  conversationExchanged
    { conversationId, outcome, turnIndex }                     closed
```

**Mutually unsatisfiable.** A payload carrying `turn` fails the second; one carrying `outcome` fails the first. `spec/v2/event-codemap.json` binds the event to the **second** — the one without `turn` — while `ConversationTurn` sits fully specified next door (`role`, `content`, `speakerId`, `messageId`, `ts`, …) and is `$ref`d by nothing outside its own file.

So the host reporting that the conversation content is unmodelled is **wrong, and so was I for accepting it**: it is modelled, richly, in an orphaned schema the canonical binding does not point at.

**This RFC does not flip the binding.** Pointing the codemap at the richer def changes validation for every host that emits `outcome`, and I do not know which hosts those are. The §B hatch unblocks the data loss today; the merge is a decision this RFC asks for and §E records as open.

### §E What this RFC deliberately does NOT decide

- **`interrupt.resolved.outcome` / `.reason`.** A host is blocked on these. I am not minting them: RFC 0183 established that `decision` (governance) and `action` (resume) are orthogonal axes, and a third and fourth field naming an outcome could collide with either. **What they carry has to come from the host, not from me.** Inventing a seat from the reporting side is exactly how RFC 0180 §A.4a got written and withdrawn.
- **Which of the two `conversation.exchanged` defs wins** (§D).
- **Graduation.** A fact demonstrated across hosts should eventually leave the hatch for a named property. No automatic rule is proposed; a hatch key that two independent hosts emit is an RFC's worth of evidence, not a trigger.

## Compatibility

`additive`, against COMPATIBILITY.md §2.2: no required field added; no optional field retyped; no event type shape changed; no endpoint contract changed; **no MUST relaxed** (§C adds one); no error code's meaning changed. A `patternProperties` addition strictly widens what validates — every document valid before this RFC is valid after.

## Conformance

`v2-payload-vendor-hatch.test.ts` (new, server-free): a payload carrying `vendor.example.thing` validates against a hatched def; one carrying a bare unmodelled key still **fails**; `refineFeedback` — closed by RFC 0183 and deliberately un-hatched — still rejects a vendor key, so the hatch is proven scoped rather than sprayed.

## Unresolved

Everything in §E, plus: whether the 53 defs are the whole set. The count is derived by comparing v1 and v2 `additionalProperties` per def; a def that was *absent* in v1 and closed in v2 is not counted and may deserve the same treatment.

## Acceptance criteria

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Every def that went open → closed carries the hatch | 53/53, asserted at def level |
| 2 | The hatch is the RFC 0177 §C.2 pattern, not a new one | `^(openwop-\|x-\|vendor\.)` |
| 3 | Defs closed deliberately in v2 are NOT hatched | `refineFeedback` (RFC 0183) |
| 4 | Dropping is forbidden, not merely discouraged | §C MUST NOT |
| 5 | The `conversation.exchanged` contradiction is recorded | §D |
| 6 | No seat is invented from the reporting side | §E |

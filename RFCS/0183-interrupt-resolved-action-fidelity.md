# RFC 0183: `interruptResolved` cannot record four of the five resume actions

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0183                                                            |
| **Title**         | `interruptResolved` cannot record four of the five resume actions |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-16                                                      |
| **Updated**       | 2026-09-16                                                      |
| **Affects**       | `schemas/v2/run-event-payloads.schema.json` (`interruptResolved`), `spec/v1/interrupt.md` §`ApprovalResume` (cited, unchanged), `conformance/src/scenarios/interrupt-approval.test.ts`, `conformance/fixtures/conformance-approval.json` |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1) — new OPTIONAL properties on a closed def; no required field added, no existing field retyped, no MUST relaxed |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`schemas/v2/run-event-payloads.schema.json` `$defs.interruptResolved` is `additionalProperties: false` and offers no seat for the resume action an approver took. v1's `approvalReceived` required an enum-constrained `action` over `accept | reject | refine | edit-accept | timeout` and carried `refineFeedback` and `editedArtifactData` beside it; v2 carries an optional `decision` whose documented vocabulary is a **different axis** and whose type is an unconstrained `string`. The result is that a conformant v2 host resolving an interrupt by `refine` has nowhere to record either the action or the feedback the action requires, and `decision: 'refine'` validates while matching no documented value. This RFC restores the carry as three optional properties and closes `decision`'s enum.

## Motivation

The gap was found by a host validating 3000 production runs against the v2 defs, and it is not theoretical: the host has a live approval gate whose "request changes" outcome maps — per `interrupt.md` §Backward-compat mapping — to `action: 'refine'` with `refineFeedback`, and it cannot express the result.

**The two vocabularies are different axes, and conflating them is the trap this RFC exists to avoid.**

| field | axis | values | origin |
| --- | --- | --- | --- |
| `decision` | **governance** — what the gate did | `granted \| rejected \| overridden` | RFC 0051 approval gate; `overridden` means quorum was bypassed |
| `action` | **resume** — what the approver did with the artifact | `accept \| reject \| refine \| edit-accept \| timeout` | `interrupt.md` §`ApprovalResume` |

An earlier reading of this gap proposed widening `decision` to admit `refine`. That is wrong: `overridden` is not a thing an approver does to an artifact, and `refine` is not a governance outcome. A single field spanning both would make `decision: 'overridden'` and `decision: 'refine'` look like alternatives when they are orthogonal facts about the same resolution.

**What v2 lost, precisely:**

```
v1  approvalReceived      required [nodeId, action]         additionalProperties: TRUE
      action              enum, 5 values                    REQUIRED
      refineFeedback      object, §RefineFeedback
      editedArtifactData  any
      decidedBy / decidedAt / comment / feedback

v2  interruptResolved     required [nodeId, interruptId]    additionalProperties: FALSE
      decision            type: string, NO enum             (governance axis, prose-only vocabulary)
      resumeValue         {}                                (no constraint of any kind)
      resolvedBy          $ref subject.schema.json
```

v2 is both **narrower** and **closed**, so a host cannot even carry the lost fields informally. And `decision`'s own description says it is *"carried from the v1 `approval.*` payloads"* — an assertion of completeness that is false.

`resumeValue: {}` is not the answer. It is unconstrained by design because it serves all eight interrupt kinds, so two hosts could put different shapes in it and both validate. **A seat that constrains nothing provides no interop guarantee.**

## Proposal

**§A.1 — `interruptResolved` gains `action`.** OPTIONAL, `type: string`, `enum: ["accept", "reject", "refine", "edit-accept", "timeout"]` — the `ApprovalResume` vocabulary verbatim. A host that resolves an approval-kind interrupt SHOULD record the action it applied. It is OPTIONAL rather than required because the def serves all eight `kind` values and only approval-kind resolutions have an action.

**§A.2 — `interruptResolved` gains `refineFeedback` and `editedArtifactData`.** OPTIONAL. `refineFeedback` is **modelled as a closed object** from `interrupt.md` §`RefineFeedback` — `required: [scope]`, `scope: whole | section | items`, with `sectionPath`, `itemIds`, `tags`, `text`, and `additionalProperties: false`. v1 left it an open `type: object` whose shape lived only in prose; v2's closed-object discipline (`check-v2-schemas`) forced the shape to be stated, which is the better outcome: the host that reported this gap described `refineFeedback` as having no v2 schema home, and now it has one rather than a mirror of an open object. `editedArtifactData` is unconstrained, as in v1. A host recording `action: 'refine'` MUST carry `refineFeedback`; a host recording `action: 'edit-accept'` MUST carry `editedArtifactData` — the two actions whose meaning is incomplete without the payload.

**§A.3 — `decision` gains its enum.** `enum: ["granted", "rejected", "overridden"]`, matching the vocabulary its description already states. This is the governance axis and is unchanged in meaning; the change is that it becomes enforceable. Today `decision: "refine"` validates, which is the defect that makes §A.1 necessary rather than merely convenient.

**§A.4 — what is deliberately NOT carried.** `decidedAt` is the envelope's `timestamp`; duplicating it invites the two to disagree. `comment` and the legacy free-text `feedback` are superseded by `refineFeedback`, whose own v1 description says *"New hosts SHOULD use `refineFeedback` for structured refine-action feedback."* Carrying them forward would re-import a deprecation.

## Compatibility

`additive` per `COMPATIBILITY.md` §2.1. Three new OPTIONAL properties on a def that is `additionalProperties: false`; no required field is added, no existing property is retyped, no `MUST` is relaxed, and no error code or status changes meaning.

§A.3 is the only tightening: `decision` goes from unconstrained `string` to a three-value enum. This is a **safety-fix shape** in isolation — a host emitting `decision: "approved"` would begin failing validation. No such host is known: the vocabulary has been documented since the field was introduced, the two production hosts emit no `decision` at all (one emits `outcome`, which the closed def already rejects), and an unconstrained enum field whose only documentation is a three-value list is not a surface anyone can have relied on deliberately. Recorded here rather than assumed.

## Conformance

### Falsifiability — one row per normative requirement

| Requirement | Witness | Runs unaided? |
| --- | --- | --- |
| §A.1 `action` is admitted and enum-constrained | `interrupt-approval.test.ts` — a refine resolution round-trips `action: 'refine'`; `action: 'maybe'` is refused | witnessable — needs a live host, no seam |
| §A.2 `refineFeedback` rides with `action: 'refine'` | same scenario — the resolved payload carries the structured feedback the resume supplied | witnessable — needs a live host, no seam |
| §A.2 `refineFeedback` is a CLOSED object requiring `scope` | server-free schema validation; `check-v2-schemas` enforces the closure | witnessable — unaided |
| §A.3 `decision` rejects an off-vocabulary value | server-free schema validation in `approval-gate-events.test.ts` | witnessable — unaided |

The existing `interrupt-approval.test.ts` already drives a live suspend → resume → terminal round-trip, but its fixture `conformance-approval` declares `actions: ["accept", "reject"]` and therefore **cannot exercise `refine` today**. The fixture gains `refine` and the scenario gains a third leg.

**This witness needs no `conformance.seamsProfile`** — it is an ordinary interrupt round-trip, so it runs on every host that advertises interrupts, including the two production hosts.

## Alternatives considered

**Widen `decision`.** Rejected: conflates the governance and resume axes (see Motivation). It was the author's first instinct and did not survive reading what `overridden` means.

**Constrain `resumeValue` per `kind`.** Rejected: `resumeValue` serves all eight kinds, and a `oneOf` over kind-specific shapes would make every future kind a breaking change to a shared field. The approval-specific seats belong beside it, not inside it.

**Leave it; let hosts use `resumeValue`.** Rejected: it provides no interop guarantee, which is the whole complaint. Two hosts already put different shapes in adjacent fields on this exact def.

## Unresolved questions

1. **`timeout` as an action.** v1 lists it in the `action` enum and `decidedBy`'s description exempts it (*"Hosts MUST populate this for non-timeout actions"*). Carried verbatim here. Whether a timeout is an *action* or a *disposition* is a real modelling question this RFC does not reopen.
2. **`reason`.** A host reported carrying `reason: 'timeout'` with real information and no seat in the closed def. Not addressed here; it is a separate question about whether resolution carries a cause distinct from its action.

## Implementation notes (non-normative)

The v1 `refineFeedback` `$def` lives in `schemas/run-event-payloads.schema.json` and was not carried into `schemas/v2/`. Its absence there is a symptom of this gap rather than an independent oversight.

## Acceptance criteria

- [ ] `interruptResolved` admits `action`, `refineFeedback`, `editedArtifactData`; all OPTIONAL; the def stays `additionalProperties: false`.
- [ ] `decision` carries `enum: ["granted", "rejected", "overridden"]`.
- [ ] A new `conformance-approval-refine` fixture declares `refine` among its `actions` — new rather than widening `conformance-approval`, whose `actions` every host already serves — and `interrupt-approval.test.ts` round-trips a refine resolution carrying `refineFeedback`.
- [ ] A resolution recording `action: 'refine'` without `refineFeedback` is refused.
- [ ] `openwop-check.sh` passes on the merged tree; the suite cut carries the schema change.

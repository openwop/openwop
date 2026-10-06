# RFC 0239: a council's roster has an input seat and its refusals have codes

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0239                                                            |
| **Title**         | a council's roster has an input seat and its refusals have codes |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-06                                                      |
| **Updated**       | 2026-10-06 — filed `Draft` after an `/architect` ruling (2026-10-06). The 7-day comment window opens with the pull request and closes 2026-10-13. |
| **Affects**       | `core.conversationGate` config (`participants`) · two error codes in `spec/v2/errors.json` (`conversation_speaker_not_participant`, `conversation_roster_exceeded`) · `spec/v2/core/conversation.md` §`multiPartyConversation` · two workflow fixtures (`conformance-multi-party-council`, `conformance-multi-party-council-oversize`) · a new v2 scenario |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.4): an optional config field, two new error codes on paths that already refuse, two optional fixtures. No existing shape changes. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`conversation.md` binds a host advertising `multiPartyConversation` to accept a roster, refuse a turn from outside it, and refuse an oversized roster. It never says where the roster comes from or what a refusal looks like, because v2 has no client route that opens a conversation. The rules are witnessed only by the v1 seam `POST /v1/host/sample/conversation/multi-party/{open,exchange}`. This RFC names the input (the `core.conversationGate` config) and registers the two refusal codes. A turn arrives as the resume value of a `conversation.exchange` interrupt, which is already a normative operation, so the suite can witness both rules with no seam.

## Motivation

**Three MUSTs with no input and no refusal shape.** `spec/v2/core/conversation.md` §`multiPartyConversation`:

- "MUST accept an optional `participants` array of agent references on conversation creation";
- "MUST refuse a turn from a principal absent from that roster";
- "MUST refuse, at creation, a roster that exceeds `multiPartyConversation.maxParticipants`".

"Conversation creation" is not an operation (§Why this exists: "No client route opens a conversation"), and "refuse" names no code or status. RFC 0101 left the status open ("status-tolerant 400/422", §E).

**The only witness is a v1 seam.** `multi-party-conversation-behavioral.test.ts` drives `/v1/host/sample/conversation/multi-party/{open,exchange}`. v1 reached end-of-support on 2026-10-04 and v2 mounts no such seam, so `conformance.md` §Witness class requires a normative path or demotion. The family is declared `witnessable-gated`, which nothing currently makes true.

**The input already exists in two halves.** A conversation is opened by a `core.conversationGate` node, and every turn is the resume value of a `conversation.exchange` interrupt (`interrupt.md` §Payload). Both are reachable from outside: a workflow fixture carries the config, and `resolveInterrupt` carries the turn.

## Proposal

### §A. The roster input

`core.conversationGate` config gains an optional member:

```json
"config": { "participants": [ { "agentId": "host:council-a" }, { "agentId": "host:council-b" } ] }
```

1. `participants` is an array of `AgentRef` (`schemas/v2/agent-ref.schema.json`), at least two entries, each `agentId` unique.
2. A host advertising `multiPartyConversation` MUST carry the configured roster, unchanged, on that conversation's `conversation.opened.participants`.
3. Absent `participants`, the conversation has no roster and §B does not apply.

### §B. A turn from outside the roster

1. The turn is the resume value of the conversation's `conversation.exchange` interrupt. A turn with `role: "agent"` names its speaker in `speakerId`.
2. When the conversation has a roster, a host MUST refuse a turn whose `speakerId` is not a roster `agentId` with `422 conversation_speaker_not_participant`, `details.speakerId` naming it.
3. A refused turn MUST NOT be consumed: the interrupt stays open, no `conversation.exchanged` is emitted, and a later valid resume still resolves it.

### §C. An oversized roster

1. A host advertising `multiPartyConversation.maxParticipants` MUST refuse a workflow whose `core.conversationGate` `participants` exceeds it with `422 conversation_roster_exceeded`, `details.maxParticipants` carrying the ceiling. It refuses at registration or at run creation, like `capability_required` (`runs.md` §`conversationPrimitive`).
2. It MUST NOT truncate the roster or open the conversation.

### §D. Error codes

Two rows in `spec/v2/errors.json`, both `422`, `retriable: false`:

| Code | Raised when | `details` |
| --- | --- | --- |
| `conversation_speaker_not_participant` | §B.2 | `{ speakerId }` |
| `conversation_roster_exceeded` | §C.1 | `{ maxParticipants }` |

### §E. Fixtures

1. `conformance-multi-party-council`: one `core.conversationGate` with `mockAutoResume: false` and a three-member roster `host:conformance-council-a`, `-b`, `-c`. A host advertises it in discovery `fixtures` when it can run it, its roster ids resolving as the host decides (RFC 0003).
2. `conformance-multi-party-council-oversize`: the same gate with a 64-member roster. It is meaningful only for a host advertising `maxParticipants` below 64.

### §F. Conformance

A new scenario, `v2-multi-party-council`, gated on `multiPartyConversation` and the advertised fixture:

1. **roster-carried** (`openwop.requirement.0239.council.roster-carried`): run the council; `conversation.opened.participants` equals the configured roster.
2. **speaker-refused** (`openwop.requirement.0239.council.speaker-refused`): resume the exchange with an agent turn whose `speakerId` is `host:conformance-intruder`. Expect `422 conversation_speaker_not_participant`, the interrupt still open, and no `conversation.exchanged`. Then a turn from `host:conformance-council-a` resolves it (the control).
3. **roster-exceeded** (`openwop.requirement.0239.council.roster-exceeded`): with `maxParticipants` below 64, creating a run of the oversize fixture is refused `422 conversation_roster_exceeded`, and no run opens a conversation.

Dispositions: no `multiPartyConversation` or fixture not advertised ⇒ `inapplicable`. Leg 3 is `inapplicable` when `maxParticipants` is absent or 64 or more, with the reason.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.2 the configured roster is carried on `conversation.opened` — `openwop.requirement.0239.council.roster-carried` | the event's `participants` | the suite, running the advertised fixture | witnessable — executed-pass required on a host bundle |
| §B.2–§B.3 a non-member turn is refused unconsumed — `openwop.requirement.0239.council.speaker-refused` | the `422` code, the open interrupt, no `conversation.exchanged`, then a member turn resolving it | the suite, unaided | witnessable — executed-pass required on a host bundle |
| §C an oversized roster is refused unopened — `openwop.requirement.0239.council.roster-exceeded` | the `422` code at run creation | the suite, running the oversize fixture, when `maxParticipants` is below 64 | witnessable — gated (a host bounding at 64 or more cannot be shown an oversize fixture without workflow registration) |

## Compatibility

`additive`.

- `participants` is optional, so a gate without it is unchanged.
- The two codes refine refusals the MUSTs already required; RFC 0101 had left the status open between `400` and `422`.
- A host that refused with `400 validation_error` now returns a registered `422` code. That is a suite-visible change under COMPATIBILITY.md §2.3, not a wire break.

## Alternatives considered

1. **Demote the three MUSTs.** Rejected: speaking rights are the point of a council.
2. **A conversation-open operation.** It would let the suite size the roster dynamically. Rejected: v2 opens conversations from workflows by design, and a new operation is a larger surface than a config field.
3. **Reuse `400 validation_error`.** Rejected: a resume value that validates against `resumeSchema` is not malformed, and a client should be able to tell "you are not a member" from "your turn is malformed".
4. **A per-host oversize fixture.** It would cover every host. Rejected: a fixture cannot depend on the host reading it, and v2 has no workflow registration through which the suite could build one.

## Decisions

An `/architect` review decided these on 2026-10-06.

1. **Roster in node config**, not run input: the roster is part of the workflow's design, replays with it, and needs no new run field.
2. **Refusal status `422`** with two registered codes (§D).
3. **A refused turn is not consumed** (§B.3), so a client can retry, and replay never sees a refused value.
4. **The oversize leg is gated on `maxParticipants` below 64** (§F; the fixture size openwop-5e proposed, which covers far more hosts than nine). No schema ceiling exists to guarantee the fixture exceeds it.
5. **Roster ids resolve as the host decides.** The host advertises the fixture only when it can run it (RFC 0003), so the suite never requires particular agents to exist.

## Acceptance criteria

- [ ] `Active`: the comment window closes (or is waived on the record) with §A–§D unchanged in substance.
- [ ] `participants` is in the gate's config schema; both codes are in `spec/v2/errors.json`; both fixtures are catalogued; `conversation.md` carries §A–§C; `CHANGELOG.md` records it.
- [ ] `v2-multi-party-council` ships, each leg failing on its sabotage: a roster dropped from `conversation.opened`, a non-member turn accepted, a refused turn consumed, an oversized roster truncated.
- [ ] `Accepted`: a host advertising `multiPartyConversation` and the fixture records the three `openwop.requirement.0239.*` ids `executed-pass`, or roster-exceeded `inapplicable` with its reason, on a certified bundle.

## References

- `spec/v2/core/conversation.md` §`multiPartyConversation`; `spec/v2/core/interrupt.md` §Payload; `spec/v2/core/runs.md` §`conversationPrimitive`; `spec/v2/core/conformance.md` §Witness class.
- RFC 0005 (conversation primitive), RFC 0101 (multi-party council), RFC 0003 (fixture advertisement), RFC 0234 (v1 end-of-support), RFC 0238 (the observation-path pattern).
- `conformance/src/scenarios/multi-party-conversation-behavioral.test.ts`; `schemas/v2/conversation-event.schema.json`.
- Registers: [`gaps`](./registers/0239-council-roster-input.gaps.md), [`risks`](./registers/0239-council-roster-input.risks.md).

# RFC 0101: Multi-party group conversation (shared transcript, speaker attribution)

| Field             | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| **RFC**           | 0101                                                                  |
| **Title**         | Multi-party group conversation (shared transcript, speaker attribution) |
| **Status**        | `Draft`                                                               |
| **Author(s)**     | David Tufts                                                           |
| **Created**       | 2026-06-14                                                            |
| **Updated**       | 2026-06-14 — parked until a host ships a multi-party council surface needing cross-host observability (openwop-app ADR 0040 Phase 6) |
| **Affects**       | `schemas/conversation-event.schema.json`, `schemas/conversation-turn.schema.json`, `schemas/capabilities.schema.json`, RFC 0005, RFC 0002 §A8, conformance conversation scenarios |
| **Compatibility** | `additive`                                                            |
| **Supersedes**    | —                                                                     |
| **Superseded by** | —                                                                     |

> **Stub — authored ahead of demand (Parked).** This RFC was opened by the
> openwop-app **ADR 0040 (Board of Advisors)** RFC gate as the *non-blocking*
> companion that upstreams a normative multi-party conversation shape. The host MVP
> ships **without** it (riding Accepted RFC 0005 + RFC 0002 §A8 as host-extension —
> see ADR 0040 § "RFC gate"). This RFC un-parks and goes to `Draft` (active) when a
> host needs **cross-host-observable** multi-party councils (ADR 0040 Phase 6).
> **Complete it via the `/prd` five-architect pass** (Spec / Schema / Security /
> Conformance / Compatibility) before promotion — the sections below are the seed.

## Summary

Today a run's conversation (RFC 0005) is shaped around one human + one driving agent:
`ConversationTurn.from` may be an agentId, but per-turn **speaker attribution is optional**,
`conversation.opened` declares no **participant roster**, and there is **no capability** by
which a host advertises multi-party support. This RFC adds three additive elements — a
participant roster on `conversation.opened`, a REQUIRED per-turn `speakerId` for agent
turns, and a `multiPartyConversation` capability — so that **N agents co-participating in
one shared transcript** is a normatively observable, enforceable wire fact (not vendor-opaque
host glue). It rides, rather than replaces, RFC 0002 §A8 `shared:<groupId>` (which already
scopes shared *memory*, but not turn-taking or a roster).

## Motivation

Multi-agent "advisory council / panel / round-table" surfaces (one user prompt fanned to a
named cohort of agents that see each other's turns and address each other) are emerging as a
product pattern. openwop-app ADR 0040 implements one. The host *can* express the transcript
on the existing wire, but a peer host, audit tool, or replay framework **cannot discover or
enforce** (a) which agents are participants, or (b) which agent spoke which turn — that
information lives only in host-private payload conventions. The spec is the right place
because the value is **cross-host observability + conformance**, not a single host's UI.

## Proposal (seed — to be finalized by `/prd`)

1. **Participant roster on `conversation.opened`.** Add `participants: AgentRef[]` to
   `ConversationOpenedPayload` (`schemas/conversation-event.schema.json`). Optional for
   back-compat; when present, an agent NOT in `participants` MUST NOT emit a turn in this
   conversation. Disambiguates the current singular `agentId` ("the owner").

   ```diff
      "ConversationOpenedPayload": {
        "type": "object",
        "properties": {
   +      "participants": {
   +        "type": "array",
   +        "items": { "$ref": "#/$defs/AgentRef" },
   +        "description": "Optional. The agent cohort permitted to speak in this conversation. When present, a turn whose speaker is not listed MUST be rejected."
   +      },
          "agentId": { "type": "string" }
        }
      }
   ```

2. **REQUIRED per-turn `speakerId` for agent turns.** In `ConversationTurn`
   (`schemas/conversation-turn.schema.json`), require a stable speaker identity when
   `role: 'agent'` (today the `agent` object is optional and carries a static `AgentRef`,
   not a guaranteed speaker). This makes "turn N was spoken by agent X" an observable fact
   that survives replay/fork and cross-host projection.

   ```diff
      "ConversationTurn": {
        "allOf": [
          { "if": { "properties": { "role": { "const": "agent" } } },
   +        "then": { "required": ["speakerId"] }
          }
        ],
   +    "properties": { "speakerId": { "type": "string", "description": "Agent instance id of this turn's speaker. REQUIRED when role='agent'." } }
      }
   ```

3. **`multiPartyConversation` capability.** Add to `schemas/capabilities.schema.json`:
   `{ "multiPartyConversation": { "supported": boolean, "maxParticipants": integer? } }`.
   Hosts gate participant-roster validation + speaker enforcement on this flag; advertising
   `supported:true` without honoring (1)+(2) is a dishonest claim
   (`OPENWOP_REQUIRE_BEHAVIOR=true` fails it).

4. **Prose (RFC 0005 amendment).** Define turn-taking expectations left to the host
   (synchronous vs. async rounds, broadcast vs. addressed via existing `to`), timeout/
   inactivity across N participants, and the relationship to RFC 0002 §A8 `shared:<groupId>`
   (memory scope) vs. this roster (speaking rights). Keep host product policy (round count,
   ordering) **non-normative**; make only roster + attribution + capability normative.

## Open questions

- Is `speakerId` the agent *instance* id (roster member) or the `AgentRef` class? (Council
  members are instances → instance id; confirm against RFC 0086 roster identity.)
- Does `participants` belong on `conversation.opened` only, or also as a mutable roster event
  (advisors joining/leaving mid-conversation)? MVP: open-time only.
- Conformance: positive (3-agent transcript, each turn attributed + roster-valid) + negative
  (a turn from a non-participant agent MUST be rejected; a `role:'agent'` turn missing
  `speakerId` MUST fail validation).
- Compatibility: all three additions are additive (optional roster, conditionally-required
  field gated on a new capability, new capability) → `additive`, no major bump.

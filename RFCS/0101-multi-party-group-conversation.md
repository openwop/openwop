# RFC 0101: Multi-party group conversation (shared transcript, speaker attribution)

| Field             | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| **RFC**           | 0101                                                                  |
| **Title**         | Multi-party group conversation (shared transcript, speaker attribution) |
| **Status**        | `Accepted`                                                            |
| **Author(s)**     | David Tufts                                                           |
| **Created**       | 2026-06-14                                                            |
| **Updated**       | 2026-06-22 — un-parked + completed via the `/prd` five-architect pass (Spec / Schema / Security / Conformance / Compatibility); Open Questions resolved (speakerId = roster INSTANCE id; participants on `conversation.opened` only for MVP; additive, no major bump); `Draft → Accepted`. 7-day additive comment window waived by single-maintainer authority (bootstrap-phase, `CONTRIBUTING.md` §"RFC comment-window waivers" / `GOVERNANCE.md` lazy consensus) — zero external reviewers. |
| **Affects**       | `schemas/conversation-event.schema.json`, `schemas/conversation-turn.schema.json`, `schemas/capabilities.schema.json`, RFC 0005, RFC 0002 §A8, conformance conversation scenarios |
| **Compatibility** | `additive`                                                            |
| **Supersedes**    | —                                                                     |
| **Superseded by** | —                                                                     |

> **Origin.** This RFC was opened by the openwop-app **ADR 0040 (Board of
> Advisors)** RFC gate as the *non-blocking* companion that upstreams a normative
> multi-party conversation shape. The host MVP shipped **without** it (riding
> Accepted RFC 0005 + RFC 0002 §A8 as host-extension). It un-parks and graduates
> now that a host needs **cross-host-observable** multi-party councils — completed
> via the `/prd` five-architect pass below.

## Summary

Today a run's conversation (RFC 0005) is shaped around one human + one driving agent:
`ConversationTurn.from` may be an agentId, but per-turn **speaker attribution is optional**,
`conversation.opened` declares no **participant roster**, and there is **no capability** by
which a host advertises multi-party support. This RFC adds three additive elements — a
participant roster on `conversation.opened`, a per-turn `speakerId` that is REQUIRED for agent
turns, and a `multiPartyConversation` capability — so that **N agents co-participating in
one shared transcript** is a normatively observable, enforceable wire fact (not vendor-opaque
host glue). It rides, rather than replaces, RFC 0002 §A8 `shared:<groupId>` (which already
scopes shared *memory*, but not turn-taking or a roster) and RFC 0005 (the single-agent
conversation primitive it extends).

## Motivation

Multi-agent "advisory council / panel / round-table" surfaces (one user prompt fanned to a
named cohort of agents that see each other's turns and address each other) are emerging as a
product pattern. openwop-app ADR 0040 implements one. The host *can* express the transcript
on the existing wire, but a peer host, audit tool, or replay framework **cannot discover or
enforce** (a) which agents are participants, or (b) which agent spoke which turn — that
information lives only in host-private payload conventions. The spec is the right place
because the value is **cross-host observability + conformance**, not a single host's UI.

## Proposal

### §Spec (normative)

This RFC makes **exactly three** surfaces normative, all gated on the new
`multiPartyConversation` capability. RFC 2119 keywords are used precisely; **only**
the roster, the agent-turn attribution, and the capability are normative. Host product
policy (round count, turn-taking order, synchronous vs. async rounds) is explicitly
**non-normative** (see §"Non-normative product policy" below).

A host advertising `capabilities.multiPartyConversation.supported: true`:

1. **Roster.** MUST accept an OPTIONAL `participants: AgentRef[]` array on the
   `conversation.opened` payload. Each `participants[i].agentId` is a **roster INSTANCE
   id** — the `host:<id>` AgentRef agentId of a standing roster member (RFC 0086
   `agent-roster-entry.schema.json`), NOT the manifest/class `AgentRef.agentId`. When
   `participants` is present, the host MUST treat it as the closed set of agents permitted
   to speak in this conversation.
2. **Attribution.** MUST require a `speakerId` (string) on every turn whose `role` is
   `'agent'` — on `conversation.opened.initialTurn`, every `conversation.exchanged.turn`,
   and `conversation.closed.finalTurn`. `speakerId` is the speaking agent's roster INSTANCE
   id and MUST equal the roster member that produced the turn. For `role: 'user'` and
   `role: 'system'` turns `speakerId` is OPTIONAL and carries no normative meaning.
3. **Membership.** When a `participants` roster is present, the host MUST reject a turn
   whose `speakerId` is not a member of that roster (a non-participant agent MUST NOT emit a
   turn) — rejection is `validation_error`, consistent with RFC 0005 §E turn-validation
   rejection.
4. **maxParticipants.** When the host advertises `multiPartyConversation.maxParticipants`,
   it MUST reject a `conversation.opened` whose `participants` array exceeds that count.

A host that does NOT advertise `multiPartyConversation.supported: true` MUST treat
`participants` and `speakerId` as opaque, unenforced fields (they remain schema-valid —
the schema closure is open per RFC 0094 for server-emitted shapes — but carry no host
obligation). Advertising `supported: true` without honoring (1)–(3) is a dishonest wire
claim that `OPENWOP_REQUIRE_BEHAVIOR=true` fails via the gated conformance leg.

**Relationship to RFC 0002 §A8 (`shared:<groupId>`) — normative boundary.** The
`shared:<groupId>` agent context scopes shared *memory* (what an agent can read/write). The
RFC 0101 `participants` roster scopes *speaking rights* (who may emit a turn). They are
orthogonal: an agent MAY be in the memory group without being a conversation participant,
and vice-versa. A host MUST NOT conflate them — `groupId` on a turn does not grant
participant status, and roster membership does not imply a shared memory scope. A council
that wants both sets the conversation's `groupId` (RFC 0005 §F) AND the `participants`
roster.

**Non-normative product policy.** Turn-taking order (who speaks next), round count,
synchronous vs. asynchronous rounds, broadcast (`to` absent) vs. addressed (`to` set per
RFC 0005 §C / `conversation-turn.schema.json`), and per-participant timeout/inactivity
across N participants are HOST product decisions. The spec defines only the observable wire
facts (roster + attribution + capability); it does NOT prescribe a turn-taking protocol.

### §Schema (the three diffs, as applied)

1. **Participant roster on `conversation.opened`** (`schemas/conversation-event.schema.json`).
   An OPTIONAL `participants: AgentRef[]` on `ConversationOpenedPayload`. The schema inlines
   a slim `AgentRef` `$def` (mirror of `agent-ref.schema.json`, same self-containment
   convention the file already uses for `ConversationTurn`):

   ```diff
      "ConversationOpenedPayload": {
        "type": "object",
        "properties": {
          "conversationId": { "type": "string", ... },
          "agentId": { "type": "string", ... },
   +      "participants": {
   +        "type": "array",
   +        "items": { "$ref": "#/$defs/AgentRef" },
   +        "description": "RFC 0101. OPTIONAL. The agent cohort permitted to speak ... a turn whose `speakerId` is not a member MUST be rejected ..."
   +      },
          "initialTurn": { "$ref": "#/$defs/ConversationTurn" }
        },
        "additionalProperties": false
      }
   ```

2. **REQUIRED-for-agent-turns `speakerId`** (`schemas/conversation-turn.schema.json`, mirrored
   into `conversation-event.schema.json`'s inlined `ConversationTurn`). A new optional
   `speakerId` property plus an `allOf`/`if`/`then` that makes it CONDITIONALLY required:

   ```diff
   +  "speakerId": { "type": "string", "minLength": 1, "maxLength": 256, "description": "RFC 0101. Roster INSTANCE id of this turn's speaker. REQUIRED when role='agent'." },
   +  "allOf": [
   +    { "if": { "properties": { "role": { "const": "agent" } }, "required": ["role"] },
   +      "then": { "required": ["speakerId"] } }
   +  ]
   ```

   The conditional (not an unconditional `required`) is what keeps this additive: `user` /
   `system` turns and pre-RFC-0101 producers on non-multi-party hosts are unaffected.

3. **`multiPartyConversation` capability** (`schemas/capabilities.schema.json`):

   ```diff
   +  "multiPartyConversation": {
   +    "type": "object",
   +    "required": ["supported"],
   +    "additionalProperties": false,
   +    "properties": {
   +      "supported": { "type": "boolean", ... },
   +      "maxParticipants": { "type": "integer", "minimum": 2, ... }
   +    }
   +  }
   ```

   Closed block (`additionalProperties: false`) per the client-/host-advertisement discipline.
   `maxParticipants` minimum is 2 (a council has ≥2 participants).

All three schemas remain valid JSON Schema 2020-12 with `additionalProperties` discipline
preserved (open on the two server-emitted conversation shapes per RFC 0094 §"Schema closure";
closed on the capability block). Positive examples are carried in `examples[]` on the two
conversation schemas; negatives (an agent turn missing `speakerId`; a non-AgentRef
participant; a `maxParticipants: 1`) are covered by the conformance scenario, since an
`examples[]` entry must itself be schema-valid.

### §Security

- **No new content surface, no new credential surface.** `participants` carries only
  AgentRef identity (`agentId` + optional `name`); `speakerId` is an opaque roster instance
  id. Neither carries prompt bodies, work-item content, or credential material — consistent
  with the SR-1 / `roster-attribution-no-content` posture (RFC 0086). `speakerId` MUST NOT
  encode secret material (same rule as `voiceId` in RFC 0105 §D and `memoryRef`).
- **Attribution is an integrity property, not a confidentiality one.** Requiring `speakerId`
  on agent turns makes "agent X spoke turn N" non-repudiable and replay-stable: a replay
  re-folds the recorded `speakerId` verbatim (RFC 0005 §G), so attribution cannot drift
  across replay/`:fork`. The host MUST record the attribution as fixed history and MUST NOT
  re-resolve a `speakerId` against a moved roster on replay (mirrors the RFC 0104 approver
  eligibility caveat — recorded decisions are history).
- **Membership enforcement is fail-closed where a roster is declared.** When `participants`
  is present, a turn from an agent not in the roster MUST be rejected — the host MUST NOT
  silently accept-and-drop, and MUST NOT fall back to single-agent behavior. This prevents a
  compromised or mis-wired node from injecting turns attributed to an agent that is not part
  of the council. No `participants` ⇒ no enforcement (back-compat); the host's threat model
  for single-agent conversations is unchanged.
- **No new SECURITY invariant minted.** The additions reuse existing protocol-tier guards:
  the content-free attribution posture (`roster-attribution-no-content`, RFC 0086) covers
  the identity-only payloads, and replay determinism (RFC 0005 §G / `replay.md`) covers the
  attribution-stability claim. There is no new untrusted-content boundary (no bytes cross
  back from a provider here, unlike RFC 0091/0105).

### §Conformance

One new always-on, server-free schema-shape scenario plus a capability-gated behavioral leg
that lands at the reference-host implementation (same staging as RFC 0086's roster
behavioral leg — the wire contract is asserted now; the live-host behavior is gated):

- **`multi-party-conversation-shape.test.ts`** (always-on, server-free) — asserts all three
  schema facts: (a) **positive** — a conforming 3-agent council `conversation.opened`
  (participant roster of instance ids + a user opening turn) validates, and each agent turn
  carrying a roster-instance `speakerId` validates; (b) **negative** — a `role: 'agent'` turn
  that OMITS `speakerId` MUST FAIL schema validation; a `participants[]` item that is not a
  valid AgentRef is rejected; the `multiPartyConversation` block rejects extras /
  `maxParticipants: 1` / a missing `supported`; (c) the **non-participant** membership
  predicate (a `speakerId` not in the declared roster MUST be rejected) is asserted over the
  same shapes — JSON Schema cannot express cross-field roster membership, so the wire shape
  that makes the host check possible is verified server-free.
- **Capability-gated behavioral leg** (`multiPartyConversation.supported`, via
  `isMultiPartyConversationSupported()` in `conformance/src/lib/multi-agent-capabilities.ts`)
  — a live host advertising the capability accepts a 3-agent shared transcript where each
  agent turn is roster-valid + attributed, and rejects a turn from a non-participant agent
  with `validation_error`. Soft-skips when unadvertised. This leg lands with the first
  reference host that advertises the capability (openwop-app ADR 0040 Phase 6).

Every normative MUST in §Spec has a corresponding assertion in the shape scenario (the
schema-expressible ones) or the gated behavioral leg (the cross-field/runtime ones). No new
workflow fixture is added — the scenario validates published schemas directly, so the
fixtures-catalog round-trip is unaffected.

### §Compatibility

**Additive** (`COMPATIBILITY.md` §2.1):

- `participants` is a NEW OPTIONAL field on a server-emitted payload (`conversation.opened`)
  → additive per §2.1 ("New optional fields MAY appear in … event payloads"). Roster-less
  conversations are unchanged.
- `speakerId` is a NEW field whose requirement is **CONDITIONAL** (`if role==='agent'`) AND
  **capability-gated** — it is NOT an unconditional new required field on an existing object
  (which §2.2 forbids). A pre-RFC-0101 producer that never emits agent turns, or a host that
  never advertises `multiPartyConversation`, sees no new obligation. The stricter validation
  (rejecting an agent turn without `speakerId`) only fires on hosts that opt in by
  advertising the capability — so it is not "stricter validation rejecting input that
  previously succeeded" against a non-advertising host (`COMPATIBILITY.md` §4).
- `multiPartyConversation` is a NEW OPTIONAL capability, off by default → additive per §2.1 /
  §4 ("New optional capability advertised, off by default — Yes, additive").

No existing required field is added unconditionally, removed, renamed, or type-narrowed; no
existing `MUST` is relaxed; no current v1 conformance pass is invalidated. **No major bump.**
The spec minor advances; the conformance suite minor advances with the new scenario.

## Resolved questions (resolved at `Accepted`)

The seed's four Open Questions are resolved as follows (each adopts the conservative floor and
leaves richer shapes to future-additive fields):

1. **Is `speakerId` the agent instance id or the AgentRef class? — RESOLVED: roster INSTANCE
   id.** Council members are standing roster instances (RFC 0086 `agent-roster-entry`), whose
   dispatchable identity is the `host:<id>` AgentRef agentId. `speakerId` carries that
   instance id so two instances of the same manifest are distinguishable in the transcript.
   Confirmed against RFC 0086 roster identity (`rosterId` IS a `host:<id>` AgentRef agentId).
2. **`participants` on `conversation.opened` only, or also a mutable roster event? —
   RESOLVED: open-time only (MVP).** Mid-conversation roster mutation (advisors joining /
   leaving) is out of scope for v1.x; if needed it is a future-additive roster-delta event,
   not a change to this shape.
3. **Conformance — RESOLVED:** positive (3-agent transcript, each turn attributed +
   roster-valid) + negatives (agent turn missing `speakerId` fails schema validation;
   non-participant turn MUST be rejected) — see §Conformance.
4. **Compatibility — RESOLVED: `additive`, no major bump** — see §Compatibility (the
   conditional + capability-gating is what keeps the conditionally-required field additive).

## Alternatives considered

1. **Reuse RFC 0002 §A8 `shared:<groupId>` for participants.** Rejected — `shared:<groupId>`
   scopes shared *memory*, not speaking rights or a discoverable roster. Overloading it would
   conflate two orthogonal concerns (see §Spec normative boundary).
2. **Make `speakerId` unconditionally required on every turn.** Rejected — breaks back-compat
   (it would make an existing field newly required, forbidden by `COMPATIBILITY.md` §2.2) and
   is meaningless for `user`/`system` turns. The conditional `if role==='agent'` is the
   additive form.
3. **A mutable roster event (join/leave).** Deferred to a future additive RFC (Resolved
   question #2). Open-time roster is the floor that the council pattern needs today.
4. **Host-extension fields under `x-host-*`.** Rejected for the standardized surface — the
   whole value is cross-host observability + conformance, which a vendor namespace defeats
   (the same argument RFC 0102 made for a core kind over a vendor namespace).

## Implementation notes (non-normative)

The reference consumer is openwop-app **ADR 0040 (Board of Advisors)** Phase 6, which runs a
named cohort of standing roster agents (RFC 0086) over a shared transcript. Its existing
host-extension council surface maps directly: the board's member set becomes
`conversation.opened.participants` (instance ids), and each agent's turn stamps its `rosterId`
as `speakerId`. The host enforces roster membership at turn-validation time (RFC 0005 §E) and
records attribution as fixed history (replayed verbatim). `Active`/`Accepted` graduation here
is on the wire-shape review + the always-on shape scenario; the gated behavioral leg proves
non-vacuously once that host advertises `multiPartyConversation.supported: true`.

## Acceptance criteria

- [x] `conversation-event.schema.json` — `participants: AgentRef[]` on `ConversationOpenedPayload` + inlined `AgentRef` `$def`.
- [x] `conversation-turn.schema.json` — `speakerId` + the `role==='agent'` conditional requirement (mirrored into the inlined `ConversationTurn`).
- [x] `capabilities.schema.json` — `multiPartyConversation { supported, maxParticipants? }` (closed block).
- [x] RFC 0005 prose amendment (cross-reference + turn-taking / §A8 relationship).
- [x] Conformance: `multi-party-conversation-shape.test.ts` (always-on) + `isMultiPartyConversationSupported()` gating helper.
- [x] All four Open Questions resolved in-RFC (recorded in `Updated:` + §"Resolved questions").
- [x] `CHANGELOG.md` `[Unreleased]` additive entry.
- [~] `Active → Accepted` behavioral evidence: the **host implementation has landed** — openwop-app ADR 0040 Phase 6 (openwop-app#666) advertises `multiPartyConversation { supported:true, maxParticipants:8 }`, emits the `participants` roster on `conversation.opened`, stamps `speakerId` on agent turns, and rejects non-participant turns (host-side enforcement tested). The wire shape is locked at `Accepted` per this RFC, and the always-on conformance shape leg passes. **Remaining:** the strict-verified live run — the gated leg passing NON-VACUOUSLY (`OPENWOP_REQUIRE_BEHAVIOR=true`) against the **deployed** host + a steward-curl of the live discovery doc — lands with the app's next deploy (tracked in INTEROP-MATRIX § "Multi-party group conversation").

## References

- [`RFCS/0005-conversation.md`](./0005-conversation.md) — the single-agent conversation primitive this extends (§F channel integration, §G replay, §I timeout).
- [`RFCS/0086-standing-agent-roster-and-workflow-portfolio.md`](./0086-standing-agent-roster-and-workflow-portfolio.md) — roster INSTANCE identity (`host:<id>` AgentRef); `speakerId` semantics.
- `schemas/conversation-event.schema.json` (`ConversationOpenedPayload.participants`, inlined `AgentRef`).
- `schemas/conversation-turn.schema.json` (`speakerId` + the `role==='agent'` conditional).
- `schemas/capabilities.schema.json` (`multiPartyConversation`).
- RFC 0002 §A8 (`shared:<groupId>` memory scope — the orthogonal surface).
- openwop-app `docs/adr/0040-board-of-advisors.md` — the reference consumer (Phase 6).

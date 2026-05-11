# RFC 0005: Multi-Turn Conversation

| Field | Value |
|---|---|
| **RFC** | 0005 |
| **Title** | Multi-Turn Conversation |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-01 |
| **Updated** | 2026-05-11 (Active → Accepted: integration-seams audit closed via `docs/MULTI-AGENT-INTEGRATION-GAPS.md` archive; conformance scenarios pass against SQLite reference host) |
| **Affects** | `schemas/conversation-event.schema.json`, `schemas/conversation-turn.schema.json`, `schemas/suspend-request.schema.json`, `schemas/run-event.schema.json`, `spec/v1/interrupt.md`, `spec/v1/capabilities.md` |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Generalize the v1 single-shot `interrupt(payload)` primitive into a multi-turn `conversation` so orchestrator-driven HITL flows can exchange many messages with a human (or A2A peer) without re-entering the workflow on each turn. The new `kind: 'conversation'` interrupt drives three operations — `start`, `exchange`, `close` — and emits three new run events: `conversation.opened`, `conversation.exchanged`, `conversation.closed`.

## Motivation

The v1 baseline `interrupt(payload)` short-circuits on a deterministic resume key: one suspend, one resume. This is the right primitive for approval, clarification, and external-event flows, where the host gathers a single resolved value and continues.

Real orchestrator-driven flows are different. A supervisor agent asks a question, the human responds, the supervisor follows up, the human responds again, and so on. Modeling this with one interrupt-per-turn:

- Re-enters the workflow on every turn, paying full suspend/resume cost.
- Creates `N` `approval.requested` / `clarification.requested` events instead of a coherent conversation history.
- Loses turn ordering (each interrupt is its own resume key, not a sequenced exchange).
- Confuses replay: re-folding `N` independent interrupts loses the conversation envelope.

A conversation primitive — one suspend that exchanges many turns before closing — addresses all four.

## Proposal

### §A `kind: 'conversation'` interrupt

Extend the `kind` enum in `suspend-request.schema.json`:

```diff
   "kind": {
     "type": "string",
-    "enum": ["approval", "clarification", "external-event", "custom"]
+    "enum": ["approval", "clarification", "external-event", "custom", "conversation"]
   }
```

Add a `ConversationData` variant to the `data` `oneOf`:

```json
{
  "ConversationData": {
    "type": "object",
    "required": ["operation"],
    "properties": {
      "operation": {
        "type": "string",
        "enum": ["start", "exchange", "close"]
      },
      "conversationId": { "type": "string", "minLength": 1, "maxLength": 256 },
      "agentId": { "type": "string", "minLength": 1, "maxLength": 256 },
      "initialTurn": { "$ref": "https://openwop.dev/spec/v1/conversation-turn.schema.json" },
      "schema": { "type": "object" },
      "capabilities": {
        "type": "array",
        "items": { "type": "string", "enum": ["multi-turn", "streaming"] }
      }
    }
  }
}
```

### §B Run events

Three new `RunEventType` values, already present in `run-event.schema.json`:

- `conversation.opened` — emitted when `operation: 'start'` is processed.
- `conversation.exchanged` — emitted on each `operation: 'exchange'` round-trip.
- `conversation.closed` — emitted on `operation: 'close'`; terminates the conversation.

Payload shapes are defined in `conversation-event.schema.json`. The `conversationId` is host-assigned, deterministic for replay (typically `${runId}:${nodeId}:${attempt}`), and persists across all turns.

**Causation rule.** The `conversation.opened` event's `causationId` MUST equal the `eventId` of the accompanying `node.suspended`. Subsequent `conversation.exchanged` events' `causationId` MAY reference the prior `conversation.exchanged` (or the `conversation.opened`); hosts SHOULD chain them.

### §C `ConversationTurn` shape

Already defined in `conversation-turn.schema.json`. Required fields:

- `messageId` — deterministic dedup key. Recommended encoding: `${conversationId}:${turnIndex}:${role}`.
- `from` — sender (agent ID or `'user'`).
- `content` — opaque JSON value.
- `ts` — caller's clock timestamp (ms epoch).
- `role` — `'user' | 'agent' | 'system'`.
- `turnIndex` — 0-based monotonic index within the conversation.

`turnIndex: 0` is the `initialTurn` carried on `conversation.opened`. The first `conversation.exchanged` is `turnIndex: 1`. The closing turn carries the highest index.

### §D Lifecycle

```
node.suspended ─┐
                ├─→ conversation.opened (turnIndex: 0)
                │     │
                │     ├─→ conversation.exchanged (turnIndex: 1)
                │     │
                │     ├─→ conversation.exchanged (turnIndex: 2)
                │     │
                │     ├─→ ... (many turns)
                │     │
                │     └─→ conversation.closed (final turnIndex)
                │
                └─→ node.resumed (carries final outcome)
```

Between `conversation.opened` and `conversation.closed`, the node is in the `suspended` state. Each `exchange` turn round-trips through the host's resume endpoint (`POST /v1/runs/{runId}:resolveInterrupt` with a `ConversationResolve` payload) but does *not* transition the node out of `suspended`. Only `operation: 'close'` resumes the node.

### §E Resume payload shape

The interrupt resume endpoint accepts a `ConversationResolve` payload during a conversation:

```json
{
  "operation": "exchange" | "close",
  "turn": "<ConversationTurn>",
  "outcome": "<host-defined, only on close>"
}
```

Hosts validate `turn` against the `schema` provided on `conversation.opened`. Servers SHOULD reject `exchange` operations after `close` with `validation_error`.

### §F Channel integration

Conversation turns fold through the existing `applyMessage` reducer (channel kind: `messages`). The conversation's group identity (`groupId` per `conversation-turn.schema.json`) maps to the `shared:<groupId>` agent context per RFC 0002 §A8 when set.

This means: a conversation between two agents and a user can write its full turn history into a shared `messages` channel that downstream nodes can read. Replay carries the channel content through unchanged.

### §G Replay determinism

Replays re-fold the conversation event stream verbatim. Hosts MUST NOT re-prompt the user during a replay; cached resume turns are returned from the event log. Replay divergence (e.g., user provided different input on replay) MUST emit `replay.diverged` and either abort the replay or continue per the host's configured divergence policy (`spec/v1/replay.md` §Divergence handling).

### §H Capability advertisement

```json
{
  "capabilities": {
    "conversationPrimitive": true,
    "interrupts": {
      "kinds": ["approval", "clarification", "external-event", "custom", "conversation"]
    }
  }
}
```

Hosts that do not advertise `capabilities.conversationPrimitive: true` MUST reject `kind: 'conversation'` interrupts at workflow registration with `validation_error`. RFC 0007's `core.dispatch` node consults this capability when routing `'ask-user'` orchestrator decisions (RFC 0007 §B).

### §I Timeout

Conversations MAY carry `timeoutMs` (per `InterruptPayload.timeoutMs`). The timeout applies to the *full* conversation, measured from `conversation.opened`. On timeout, the host MUST emit a `conversation.closed` with `outcome: null` and a `system`-role `finalTurn` indicating the timeout reason, then proceed with the node's normal timeout handling.

## Compatibility

**Additive.**

- The new `kind: 'conversation'` extends the kind enum; pre-RFC clients see it as unknown and SHOULD reject only if they don't advertise the capability.
- Three new event types extend the `RunEventType` enum; consumers MUST fold unknown types best-effort per the v1 envelope contract.
- The interrupt resume endpoint accepts an extended payload variant; the existing approval/clarification/external-event variants are unchanged.
- No changes to required fields on existing payloads.

## Conformance

Existing scenarios that exercise multi-turn behavior partially:

- `conformance/src/scenarios/interrupt-clarification.test.ts` — verifies single-turn clarification.
- `conformance/src/scenarios/interrupt-approval.test.ts` — verifies single-turn approval.

New scenarios required for `Accepted`:

- `conversation-lifecycle.test.ts` — start → 3 exchanges → close round-trip; turnIndex monotonicity verified.
- `conversation-timeout.test.ts` — timeout fires conversation.closed with system finalTurn.
- `conversation-replay.test.ts` — replay re-folds the conversation without re-prompting; resume turns come from cache.
- `conversation-schema-rejection.test.ts` — exchange with content violating the declared schema is rejected.

All gated on `capabilities.conversationPrimitive: true` advertisement.

## Alternatives considered

1. **Loop of single-shot interrupts.** Rejected as the motivation describes. Loses turn ordering, event volume, and replay coherence.
2. **Open-ended streaming SSE for conversation.** Considered. Rejected because conversation turns are persisted events (replay-relevant), not transient stream chunks. Conversations MAY *also* stream chunked content within a single turn via `output.chunk` events; that surface is unchanged.
3. **Reuse `clarification` with multiple questions.** Considered. Rejected because `clarification` is one-shot ("here are 5 questions, give me 5 answers, resume"); a conversation is bidirectional turn-taking.
4. **Treat conversation as A2A messaging.** Considered. Rejected because A2A is *between* runs across organizations; conversation is *within* a single run. RFC 0005's conversation can transport A2A turns by mapping `from` to an A2A `AgentCard` URN, but the protocol surface is one host's primitive.

## Unresolved questions

1. Should `outcome` on `conversation.closed` carry a structured shape, or remain opaque? Current: opaque, host-policy.
2. Should `agent` reference be required on `agent`-role turns? Current: optional; convention is to set it but pre-RFC-0002 agents may omit.
3. Should conversations support branching (one initial turn, multiple parallel exchange threads)? Rejected for v1.x; cleanly handled by multiple sibling conversations in a parent node.

## Implementation notes (non-normative)

- The TypeScript reference host implements conversation by extending the existing `SuspendIO` lease machinery to accept multiple resume payloads against the same suspend token; `operation` discriminates.
- Cache key for replay: `${conversationId}:${turnIndex}` resolves to the cached turn content. Turns are cached at first execution and replayed bit-identically.
- The `conversation` interrupt kind composes with `auth-required` interrupt profile (`interrupt-profiles.md`) — the resume call enforces the same auth scope as the initial suspend.

## Acceptance criteria

- [ ] Spec text merged.
- [x] `conversation-event.schema.json` published.
- [x] `conversation-turn.schema.json` published.
- [x] `run-event.schema.json` includes the three event types.
- [ ] `suspend-request.schema.json` adds `'conversation'` to kind enum + `ConversationData` variant.
- [ ] `capabilities.md` adds `capabilities.conversationPrimitive`.
- [ ] Four conformance scenarios.
- [ ] CHANGELOG entry.
- [ ] Reference host implements the lifecycle and passes the scenarios.

## References

- `schemas/conversation-event.schema.json`
- `schemas/conversation-turn.schema.json`
- `schemas/suspend-request.schema.json`
- `spec/v1/interrupt.md` (single-shot interrupt baseline)
- RFC 0002 §G (ConversationMessage shape — structural subset of ConversationTurn)
- RFC 0006 §C (orchestrator `ask-user` decision routes here when conversationPrimitive advertised)
- RFC 0007 §B (core.dispatch routes ask-user through conversation when capability is advertised)

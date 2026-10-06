# Conversation surfaces

> **Status: Stable.**
> **Normative home:** `multiPartyConversation`, `channelPresence`, `conversationTurnModelProvenance`.

## Why this exists

No client route opens a conversation. These are the obligations of a host advertising these families.

## `multiPartyConversation`

A host advertising `multiPartyConversation`:

- MUST accept optional `participants` (agent references) in `core.conversationGate` config and carry them on `conversation.opened`;
- MUST refuse a resumed turn whose `speakerId` is off that roster with `conversation_speaker_not_participant`, leaving the interrupt open;
- MUST refuse at run creation, never truncate, a roster over `multiPartyConversation.maxParticipants`, with `conversation_roster_exceeded`.

## `channelPresence`

A host advertising `channelPresence` MUST emit `channel.presence`; otherwise it omits it. The closed payload carries only opaque, non-PII references to roster members. A host MUST NOT include a non-member, deliver to one, or deliver across tenants.

A host MUST list it under `hostEvents` as ephemeral ([events.md](events.md) §Host events) and MUST NOT emit it as a run event.

## `conversationTurnModelProvenance`

A host that stamps model provenance on an agent turn MUST advertise `conversationTurnModelProvenance`. The stamp is non-secret and non-PII (provider and model identifiers only), and a host MUST NOT place prompt or completion content in it.

*Sources: RFCs 0101, 0109, 0110, 0236, 0239.*

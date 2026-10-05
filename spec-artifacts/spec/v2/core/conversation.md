# Conversation surfaces

> **Status: Stable.**
> **Normative home:** `multiPartyConversation`, `channelPresence`, `conversationTurnModelProvenance`.

## Why this exists

No client route opens a conversation. This document states the obligations a host takes on by advertising a multi-party conversation family.

## `multiPartyConversation`

A host advertising `multiPartyConversation`:

- MUST accept an optional `participants` array of agent references on conversation creation;
- MUST refuse a turn from a principal absent from that roster, rather than silently accepting it;
- MUST refuse, at creation, a roster that exceeds `multiPartyConversation.maxParticipants`, rather than truncating it.

## `channelPresence`

A host advertising `channelPresence` MUST emit `channel.presence`; otherwise it omits it. The closed payload carries only opaque, non-PII references to roster members. A host MUST NOT include a non-member, deliver to one, or deliver across tenants.

A host MUST list it under `hostEvents` as ephemeral ([events.md](events.md) §Host events) and MUST NOT emit it as a run event.

## `conversationTurnModelProvenance`

A host that stamps model provenance on an agent turn MUST advertise `conversationTurnModelProvenance`. The stamp is non-secret and non-PII (provider and model identifiers only), and a host MUST NOT place prompt or completion content in it.

*Sources: RFCs 0101, 0109, 0110, 0236.*

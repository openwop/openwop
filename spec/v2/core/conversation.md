# Conversation surfaces

> **Status: Stable · v2.0 · RFC 0101, 0109, 0110.** Normative contract for the multi-party conversation families.
> **Normative home:** `multiPartyConversation`, `channelPresence`, `conversationTurnModelProvenance`.

## Why this exists

RFC 0101 and RFC 0110 are `Accepted`, their wire shapes are frozen in `schemas/v2/`, and conformance covers them — but each deliberately mints no client route for opening a conversation, and so neither was ever given an operative home. The obligation an advertising host takes on is real regardless of who routes the call; it is stated here.

## `multiPartyConversation`

A host advertising `multiPartyConversation` MUST accept an optional `participants` array of agent references on conversation creation, and MUST refuse a turn from a principal absent from that roster rather than silently accepting it. It MUST refuse a roster that exceeds `multiPartyConversation.maxParticipants` at creation rather than truncating it.

## `channelPresence`

A host advertising `channelPresence` MUST report present members as a subset of the channel's roster, and MUST NOT include a subject that is not a member. The payload is closed: it carries opaque, non-PII subject references and nothing else.

## `conversationTurnModelProvenance`

A host that stamps model provenance on an agent turn MUST advertise `conversationTurnModelProvenance`. The stamp is non-secret and non-PII — provider and model identifiers only — and a host MUST NOT place prompt or completion content in it.

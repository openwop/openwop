# Host services

> **Status: Stable · v2.0 · RFC 0144.** Normative contract for the advertised `host.*` service surfaces a node pack invokes through `ctx`.
> **Normative home:** `aiEnvelope`, `promptLibrary`, `agentRuntime`.

## Why this exists

`spec/v1/host-capabilities.md` describes these three surfaces but states no RFC 2119 obligation; the contract a host takes on by advertising them is written here.

## `aiEnvelope`

A host advertising `aiEnvelope` MUST expose `ctx.aiEnvelope.generate` to pack code, and MUST refuse a node whose `typeId` requires the family when it does not advertise it. It MUST expose `ctx.aiEnvelope.await` when, and only when, it advertises `aiEnvelope.await`.

## `promptLibrary`

A host advertising `promptLibrary` MUST expose `ctx.promptLibrary.get`, MUST return a pinned version verbatim so that a replayed run resolves the same template, and MUST fail the calling node rather than substitute an unpinned one.

## `agentRuntime`

A host advertising `agentRuntime` MUST expose `spawn`, `delegate`, `consensus` and `messageSend`, and MUST satisfy `agents.manifestRuntime`, which advertising it implies.

# Host services

> **Status: Stable · v2.0 · RFC 0144.** Normative contract for the advertised `host.*` service surfaces a node pack invokes through `ctx`.
> **Normative home:** `aiEnvelope`, `promptLibrary`, `agentRuntime`.

## Why this exists

`spec/v1/host-capabilities.md` describes these three surfaces with a TypeScript sketch, a `**Required methods:**` label and a failure-mode list, and — unlike its sibling sections, which reach for `MUST` constantly — states no obligation. A lowercase section label is not an RFC 2119 keyword, so the contract a host takes on by advertising these families was never written down. v1 is frozen, so it is written here.

## `aiEnvelope`

A host advertising `aiEnvelope` MUST expose `ctx.aiEnvelope.generate` to pack code, and MUST refuse a node whose `typeId` requires the family when it does not advertise it. It MUST expose `ctx.aiEnvelope.await` when, and only when, it advertises `aiEnvelope.await`.

## `promptLibrary`

A host advertising `promptLibrary` MUST expose `ctx.promptLibrary.get`, MUST return a pinned version verbatim so that a replayed run resolves the same template, and MUST fail the calling node rather than substitute an unpinned one.

## `agentRuntime`

A host advertising `agentRuntime` MUST expose `spawn`, `delegate`, `consensus` and `messageSend`, and MUST satisfy `agents.manifestRuntime`, which advertising it implies.

# Host services

> **Status: Stable.**
> **Normative home:** `aiEnvelope`, `promptLibrary`, `agentRuntime`, `mcp`.

## Why this exists

A node pack invokes advertised `host.*` services through `ctx`. This document states the contract a host takes on by advertising them.

## `aiEnvelope`

A host advertising `aiEnvelope`:

- MUST expose `ctx.aiEnvelope.generate` to pack code;
- MUST refuse a node whose `typeId` requires the family when it does not advertise it;
- MUST expose `ctx.aiEnvelope.await` when, and only when, it advertises `aiEnvelope.await`.

## `promptLibrary`

A host advertising `promptLibrary`:

- MUST expose `ctx.promptLibrary.get`;
- MUST return a pinned version verbatim, so that a replayed run resolves the same template;
- MUST fail the calling node rather than substitute an unpinned one.

## `agentRuntime`

A host advertising `agentRuntime` MUST expose `spawn`, `delegate`, `consensus` and `messageSend`, and MUST satisfy `agents.manifestRuntime`, which advertising it implies.

## `mcp`

A host advertising `mcp.client` MUST expose to pack code `ctx.mcp.callTool`, `listTools`, `readResource` and `serverHealth`, each against a host-configured `serverId` at the revision `mcp` negotiates.

Each rejects only for an unknown `serverId` (`not_found`), an MCP error response (carried unaltered), or a transport failure.

- `callTool` MUST resolve to the server's `CallToolResult` unaltered (`content[]`, `structuredContent`, `isError`, `_meta`), including when `isError` is true. The host handles an `InputRequiredResult` itself and never returns one.
- `listTools` MUST resolve to one `ListToolsResult` page unaltered, `outputSchema`, `annotations`, `nextCursor`, `ttlMs` and `cacheScope` included, and MUST forward a pack's `cursor`.
- `readResource` resolves to the `ReadResourceResult` unaltered.
- `serverHealth` MUST report `reachable`, `unreachable` or `incompatible` from a `server/discover` probe no older than its `ttlMs`, with the `DiscoverResult` when one was received. It MUST NOT report a connection or session state, which MCP 2026-07-28 does not have.

*Sources: RFC 0144.*

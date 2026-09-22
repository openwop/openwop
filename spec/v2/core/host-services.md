# Host services

> **Status: Stable · v2.0 · RFC 0144.** Normative contract for the advertised `host.*` service surfaces a node pack invokes through `ctx`.
> **Normative home:** `aiEnvelope`, `promptLibrary`, `agentRuntime`, `mcp`.

## Why this exists

`spec/v1/host-capabilities.md` describes these three surfaces but states no RFC 2119 obligation; the contract a host takes on by advertising them is written here.

## `aiEnvelope`

A host advertising `aiEnvelope` MUST expose `ctx.aiEnvelope.generate` to pack code, and MUST refuse a node whose `typeId` requires the family when it does not advertise it. It MUST expose `ctx.aiEnvelope.await` when, and only when, it advertises `aiEnvelope.await`.

## `promptLibrary`

A host advertising `promptLibrary` MUST expose `ctx.promptLibrary.get`, MUST return a pinned version verbatim so that a replayed run resolves the same template, and MUST fail the calling node rather than substitute an unpinned one.

## `agentRuntime`

A host advertising `agentRuntime` MUST expose `spawn`, `delegate`, `consensus` and `messageSend`, and MUST satisfy `agents.manifestRuntime`, which advertising it implies.

## `mcp`

A host advertising `mcp.client` MUST expose to pack code `ctx.mcp.callTool`, `listTools`, `readResource` and `serverHealth`, each against a host-configured `serverId` at the revision `mcp` negotiates. Each rejects only for an unknown `serverId` (`not_found`), an MCP error response (carried unaltered), or a transport failure. `callTool` MUST resolve to the server's `CallToolResult` unaltered (`content[]`, `structuredContent`, `isError`, `_meta`), including when `isError` is true; the host handles an `InputRequiredResult` itself and never returns one. `listTools` MUST resolve to one `ListToolsResult` page unaltered, `outputSchema`, `annotations`, `nextCursor`, `ttlMs` and `cacheScope` included, and MUST forward a pack's `cursor`; `readResource` resolves to the `ReadResourceResult` unaltered. `serverHealth` MUST report `reachable`, `unreachable` or `incompatible` from a `server/discover` probe no older than its `ttlMs`, with the `DiscoverResult` when one was received; it MUST NOT report a connection or session state, which MCP 2026-07-28 does not have.

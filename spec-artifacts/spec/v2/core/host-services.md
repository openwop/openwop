# Host services

> **Status: Stable.**
> **Normative home:** `aiEnvelope`, `promptLibrary`, `agentRuntime`, `mcp`, `workspace`.

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

## `workspace`

A host advertising `workspace` keeps agent files (`schemas/v2/workspace-file.schema.json`) scoped to one `{tenant, workspace}`; no protocol path is defined for them. The host:

- MUST make each write atomic, bumping `version`, and emit `workspace.updated` on each write or delete; a versioned delete leaves a tombstone;
- MUST refuse a stale `If-Match` etag with `409 workspace_conflict` (`details.currentVersion`), and content over `maxFileBytes` with `workspace_too_large`;
- with `versioned`, MUST serve the latest and any retained version, retaining best-effort up to `maxVersions`; `maxFiles` caps the file count;
- MUST give a run, through `ctx.workspace`, an immutable snapshot taken at `run.started`, so a replay on any host sees the same files; its writes reach later runs only;
- MUST derive the scope from the authenticated identity and MUST NOT return or disclose another scope's file; `404` MAY stand for `403` (invariant `workspace-cross-tenant-isolation`);
- MUST persist `[REDACTED:<secretId>]` for any value the run's vault resolved at user, tenant or run scope (longest first, 8-character minimum).

A workflow calling `ctx.workspace` MUST NOT register on a host without the family. The memory-index manifest is the workspace file `MEMORY-INDEX.json`.

*Sources: RFCs 0059, 0144.*

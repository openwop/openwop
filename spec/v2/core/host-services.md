# Host services

> **Status: Stable.**
> **Normative home:** `aiEnvelope`, `promptLibrary`, `agentRuntime`, `mcp`, `workspace`, `secrets`, `modelCapabilities`, `scheduling`, `queueBus`, `toolHooks`, `httpClient`, `memory`.

## Why this exists

A node pack invokes advertised `host.*` services through `ctx`. This document states the contract a host takes on by advertising them, and how it schedules runs, matches models and audits tool calls.

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

## `secrets`

A host advertising `secrets` MUST resolve secrets to opaque references. Raw key material MUST NOT appear in any event, log, trace, prompt, error, export or screenshot, and the host MUST test this before exposing BYOK.

- `scopes` lists the storage scopes it implements; a client MUST tolerate any subset. `resolution` is `host-managed`.
- A host offering `resolveInPack` MUST expose `ctx.secrets.resolve({ ref, purpose })`, returning `plaintext` and optional `expiresAt` and `rotatedAt`.

For `resolveInPack`, the host:

- MUST keep the plaintext out of events, spans, logs, snapshots and replay state; a replay re-resolves it, and SHOULD record only `ref`, `purpose` and time;
- MUST resolve `ref` only to a credential the calling run may read, fail a `ref` from another workspace, and never substitute another credential.

A pack MUST pass a non-empty `purpose`, which the host audits. It MUST NOT log the plaintext, keep it past the consuming call, or pass it to any other `ctx` method, and MUST treat it as run input that may differ between runs.

## `modelCapabilities`

`advertised` lists the capability identifiers the active model offers; a host-private identifier MUST be prefixed `x-host-<host>-`.

A host advertising `modelCapabilities` that dispatches a node declaring `requiredModelCapabilities` MUST check, then optionally substitute, then emit, then dispatch or refuse:

- all met: dispatch;
- unmet, with a `fallbackModel` declared, `substitutionSupported` advertised, and the fallback's provider in `aiProviders.providers` with a resolvable credential: emit `model.capability-substituted` and dispatch the fallback;
- otherwise: emit `model.capability-insufficient` and fail the run `capability_not_provided`.

It MUST NOT substitute silently or dispatch an unsuitable model. It MUST check a fallback's full capability set, and refuse one that falls short with `fallbackAttempted: true` rather than chain another. Checking capabilities before resolving prompts is RECOMMENDED.

## `scheduling`

A host advertising `scheduling` starts runs from the `schedule` trigger in the forms it advertises (`cron`, `delayed`, `calendar`). It MAY do so without `queueBus`. For each schedule it MUST:

- persist it so it survives a restart and fires on time;
- fire once per tick, never duplicate concurrent runs;
- reject a fire time beyond `maxFutureHorizon` with `schedule_horizon_exceeded`, whose `details.maxFutureHorizon` SHOULD echo the cap;
- after missing a tick while down, either fire once on recovery or skip to the next tick, as it documents, never the whole backlog.

## `queueBus`

A host advertising `queueBus` MUST expose `ctx.queueBus.publish`, `consume`, `ack` and `nack`; `deadLetter` when it advertises `deadLetterSupported`; and `streamSubscribe` when it advertises `stream`, honoring `fromBeginning` only under `stream.fromBeginning`. It MAY use any of its advertised `backends`.

- A tenant's consumer MUST NOT receive another tenant's messages, even on the same topic.
- `ack` MUST remove a message, `nack` MUST return it for redelivery, and `deadLetter` MUST route it to the configured dead-letter queue. That queue holds messages; the `deadLetter` family holds runs ([runs.md](runs.md)).
- A workflow triggered by a queue consume MUST get one run per inbound message, with no batching or skipping.
- The wire shape MUST NOT vary by backend.

## `toolHooks`

A host advertising `toolHooks` extends `agent.toolCalled` and `agent.toolReturned` for every external tool call:

- **`prePostEvents`.** The host MUST set `argsHash`, `principal` and `transport` on the call, and `status` and `durationMs` on the return. `argsHash` is SHA-256 over the RFC 8785 canonical arguments with secrets already redacted. A non-agent egress uses the principal `core.system`. `durationMs` is re-emitted verbatim on replay or fork, never recomputed.
- **`perToolAuthorization`.** Before invoking, the host MUST check the principal's scopes against the tool's `requiredScopes`. If one is missing or cannot be evaluated, it MUST NOT invoke, MUST emit `agent.toolReturned` with `status: forbidden`, and MUST answer `403 forbidden` with `details.scope: "tool"`, `toolName` and `requiredScopes`.
- **`perToolRateLimit`.** The host MUST keep a token bucket per `(principal, toolName)`. When it is empty the host MUST NOT invoke, and emits `status: rate_limited` and answers `429 rate_limited` with `details.scope: "tool"`.

A host MAY refuse an allowlisted tool at loop start. That return has no call: the host MUST synthesize its `callId` (a stable derivation is RECOMMENDED), MAY omit `causationId`, and MUST NOT invent an `agent.toolCalled`. A consumer MUST tolerate an unpaired `forbidden` or `rate_limited` return.

## `httpClient`

A host advertising `httpClient` MUST advertise `ssrfGuard: true` and a positive `maxResponseBodyBytes`. Before connecting it MUST resolve the target, reject loopback, RFC 1918, link-local and cloud-metadata addresses, and pin the resolved address for the connection (invariant `http-client-ssrf-guard`). `methods` lists the HTTP methods it accepts.

A host MAY expose `ctx.http.safeFetch(url, init?)` to pack code under `safeFetch`. It then:

- MUST apply that guard, enforce `maxResponseBodyBytes` and any `requestTimeoutMs`, and refuse a connection upgrade;
- MUST emit the `agent.toolCalled` and `agent.toolReturned` pair (`transport: http`) for every call when it also advertises `toolHooks.prePostEvents`;
- SHOULD NOT forward an `Authorization` header the pack did not build from a host-issued credential.

A host advertising `egressPolicy`, which requires `safeFetch`, attaches a `CredentialProvenance` (never the secret) when it binds a host-issued credential to an egress, and:

- MUST emit a content-free `egress.decided`, whose `destination` is the authority alone and whose `reason` is from its closed set;
- MUST NOT attach the credential to a destination outside its `audiences` (exact host or `*.domain`): the egress is `denied` or, where policy permits, `downgraded`;
- MUST deny when provenance cannot be evaluated, and MUST NOT attach an expired credential.

An egress is `allowed` only when the address guard and the audience check both pass.

## `workspace`

A host advertising `workspace` keeps agent files (`schemas/v2/workspace-file.schema.json`) scoped to one `{tenant, workspace}`; no protocol path is defined for them. The host:

- MUST make each write atomic, bumping `version`, and emit `workspace.updated` on each write or delete; a versioned delete leaves a tombstone;
- MUST refuse a stale `If-Match` etag with `409 workspace_conflict` (`details.currentVersion`), and content over `maxFileBytes` with `workspace_too_large`;
- with `versioned`, MUST serve the latest and any retained version, retaining best-effort up to `maxVersions`; `maxFiles` caps the file count;
- MUST give a run, through `ctx.workspace`, an immutable snapshot taken at `run.started`, so a replay on any host sees the same files; its writes reach later runs only;
- MUST derive the scope from the authenticated identity and MUST NOT return or disclose another scope's file; `404` MAY stand for `403` (invariant `workspace-cross-tenant-isolation`);
- MUST persist `[REDACTED:<secretId>]` for any value the run's vault resolved at user, tenant or run scope (longest first, 8-character minimum).

A workflow calling `ctx.workspace` MUST NOT register on a host without the family. The memory-index manifest is the workspace file `MEMORY-INDEX.json`.

## `memory`

A host advertising `memory` serves agent memory (`schemas/v2/memory-entry.schema.json`) to pack code as `ctx.memory`; no protocol path exists. `list` returns `[]` for an unknown ref and `get` returns `null`; writes are host-internal, and a read-only host sets `writable: false`.

- **Refs.** `memoryRef` is opaque; a host MUST NOT assume another host's ref resolves. A node MUST guard `ctx.memory`, which may be undefined.
- **Tenant isolation.** A ref MUST resolve to one tenant's entries, whatever the caller's permissions. A malformed ref (traversal, embedded null, oversize) MUST return `[]` or `null`. An adapter sharing a store MUST gate on the ref's shape, not trust the store. An adapter error MUST NOT carry entry data.
- **Redaction.** A persisted entry MUST carry `[REDACTED:<secretId>]` in place of any value the run's vault resolved at user, tenant or run scope; platform scope is excluded.
- **Size and expiry.** A host SHOULD reject a `put` over `maxEntrySizeBytes` with `validation_error`. Under `ttlSupported` or `retention.ttl`, an entry past `expiresAt` MUST NOT surface, purged or not.
- **Long-term.** A host whose `agents.memoryBackends` includes `long-term` MUST honor isolation, redaction and expiry end to end. A validator MUST NOT look for `memoryBackends` under `memory`.
- **`search`** advertises query `modes` beyond `list`. **`retention.forget`** is a tenant-scoped delete-by-subject of live memory only; replay reads the recorded snapshot and the log is untouched.
- **`attribution`.** Under `emitsWriteEvents: true` the host MUST emit a content-free `memory.written` for every memory write a run makes; otherwise a consumer MUST tolerate its absence.
- **`injectionBudget`** makes `list` honor `tokenBudget`, in `tokenCounter` units; otherwise it is ignored. The host MUST return a prefix of the ranked list within budget, omitting, never truncating, an entry that alone exceeds it, and with `limit` MUST honor whichever yields fewer. `rank: relevance` MUST carry `query` and requires `search` mode `semantic`; otherwise a host MUST reject it or fall back, as documented, to `recency` (the default), never fabricate a ranking. Ranking MUST run over the redacted, single-tenant set.
- **`compaction`** (`trigger: host-managed`) emits `memory.compacted`. Derived content MUST pass the same redaction as a fresh `put`. A client MUST NOT infer compaction or distillation from entry counts.
- **`distillation`** is budgeted compaction ([runs.md](runs.md)); an absent budget MUST default to `maxTokenBudget`, counting input and output. A run MUST read the ref's snapshot, MUST NOT re-expose a redacted secret at any recursion level, and MUST write an immutable, addressable archive, byte-stable per source set and budget, kept for `archiveRetention`. Under `indexEmitted` it updates `MEMORY-INDEX.json` (a `.md` sibling MAY accompany it). It emits `memory.compacted` with `distillation` and `trigger: host-managed`. Tenant isolation covers archive and index.
- **Degraded agents.** When an agent's `memoryShape` needs a dimension the host lacks, its inventory entry MUST set `memoryDegraded` and `degradedMemoryDimensions`; the agent MAY still dispatch. A `role: skill` manifest MUST keep `memoryShape` scratchpad-only, enforced by schema.

*Sources: RFCs 0004, 0012, 0017, 0031, 0052, 0057, 0059, 0062, 0064, 0076, 0079, 0080, 0113, 0131, 0144.*

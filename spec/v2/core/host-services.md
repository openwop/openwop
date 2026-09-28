# Host services

> **Status: Stable.**
> **Normative home:** `aiEnvelope`, `promptLibrary`, `agentRuntime`, `mcp`, `secrets`, `modelCapabilities`, `scheduling`, `queueBus`, `toolHooks`, `httpClient`.

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

*Sources: RFCs 0017, 0031, 0052, 0064, 0076, 0079, 0144.*

# Host services

> **Status: Stable.**
> **Normative home:** `aiEnvelope`, `promptLibrary`, `prompts`, `aiProviders`, `agentRuntime`, `mcp`, `workspace`, `secrets`, `modelCapabilities`, `scheduling`, `queueBus`, `toolHooks`, `httpClient`, `memory`.

## Why this exists

A node pack invokes advertised `host.*` services through `ctx`. Each section below states the contract a host takes on by advertising that family.

## `aiEnvelope`

A host advertising `aiEnvelope` MUST expose `ctx.aiEnvelope.generate` to pack code, and MUST expose `ctx.aiEnvelope.await` when, and only when, it advertises `aiEnvelope.await`. A host MUST refuse a node whose `typeId` requires the family when it does not advertise it.

## `promptLibrary`

A host advertising `promptLibrary` MUST expose `ctx.promptLibrary.get` and MUST return a pinned version verbatim, so a replayed run resolves the same template. It MUST fail the calling node rather than substitute an unpinned version.

## `prompts`

A host advertising `prompts` resolves the PromptRefs in node `config` (`systemPromptRef`, `userPromptRef`, `fewShotPromptRefs`, `schemaHintPromptRef`); to any other host they are opaque strings.

- `templateKinds` and `variableSources` narrow what the host accepts; the `secret` source SHOULD appear only with `secrets`.
- `maxTemplateBytes` MUST NOT exceed 65536. `observability` is `off`, `hashed` (default) or `full`.
- `endpointsSupported` gates the `/prompts*` operations, `mutableLibrary` their writes and `packsSupported` pack installs. An operation whose gate is off answers `404 not_found`.
- `library` carries `id`, `renderEndpoint` and `maxRenderRequestBytes`.

### Resolution

For each `(nodeId, kind)`, the host MUST take the first non-null ref from these layers, and MUST emit `agent.prompt-resolved`, with one `chain[]` entry per layer tried, before `prompt.composed`:

1. node `config`, where a ref beats an inline body;
2. under `agentBindings`, the agent `config.agentId` names: for `system`, first its own prompt (tagged `agent-intrinsic`), then its `promptOverrides`, and last the host MAY use a `promptLibraryRef` default. An unknown agent MUST be logged as a warning and skipped;
3. the workflow's `defaults.promptRefs[kind]`;
4. `prompts.defaults[kind]`.

When every layer is null, the node fails only if its node type says so. A host honoring `ai.promptOverrides` applies it before any layer and MUST record a `run-configurable` entry.

### Composition

- `{{varName}}` substitution is literal. An unbound required variable MUST fail the node (`node_config_invalid`); an unbound optional or undeclared one renders empty, and install SHOULD warn on an undeclared one.
- `secret` values MUST appear only as `[REDACTED:<secretId>]` in observability output.
- Untrusted input MUST be wrapped verbatim in `<UNTRUSTED>…</UNTRUSTED>`, which makes `contentTrust` `untrusted`.
- Unless `observability` is `off`, the host MUST emit `prompt.composed` for each composition, carrying bodies only under `full`.
- On replay, `hash`, `variableHashes`, `refs`, the resolved ref and `chain[].applied` MUST match the recording, and a mismatch MUST emit `replay.diverged`. Bodies MAY be omitted. `chain[].source` SHOULD match, and a rotated `host-defaults` source MUST be tolerated.

### Library

- A ref without a version resolves to the latest. A string ref matching several templates MUST be refused with `validation_error`, `details.field: libraryId`.
- `renderPromptTemplate` dispatches nothing, and its `hash` MUST equal the dispatch-time `prompt.composed` hash.
- `getPromptTemplate` SHOULD send `ETag` and `max-age=60`, plus `immutable` when `version` is pinned.
- Writes MUST be authenticated and SHOULD be role-scoped. An update MUST carry a greater SemVer; built-in and pack templates are read-only.
- For a workspace-scoped read or write, the host MUST verify membership from the authenticated identity, never from a caller's `workspaceId`. The check fails closed (canonically `403 workspace_membership_required`) and runs in the application tier, even behind a privileged database client.
- A `kind: "prompt"` pack MUST NOT carry `nodes[]` or `chains[]`; its templates MUST carry `meta.packName` and `meta.packVersion`.

## `aiProviders`

A host advertising `aiProviders` MUST expose `ctx.callAI`. A `provider` that a `ctx` call names MUST be in `providers`; `byok` is in [runs.md](runs.md) §`ai` section.

- A part whose modality is absent from `input` MUST be rejected with `capability_not_provided`, never dropped. Non-text input is untrusted.
- A `media.*` envelope inlines base64 only up to `maxInlineMediaBytes` (default 256 KiB); above that the host MUST use a `url`.
- `imageGeneration`, `videoGeneration` and `speechSynthesis` add `ctx.callImageGenerator`, `callVideoGenerator` and `callSpeechSynthesizer`; `realtimeVoice` adds `callTranscriber` and streamed synthesis. Unadvertised synthesis or transcription MUST be rejected, never a no-op or whole-file fallback.
- A video caller MUST honor `ctx.signal`. Synthesis MUST return exactly one of `url` or `base64`, and a `url` is served through the SSRF guard. The transcriber MUST reject inline or `mediaRef` audio.
- `voiceId`, `streamRef` and `cachePrefixId` MUST NOT encode secrets. Transcripts are untrusted; an interim one MUST NOT be persisted or drive a side-effecting tool.

`selfHosted` (operator-configured OpenAI-compatible endpoints) MUST be advertised only while one is configured and reachable. A host MUST NOT disclose an endpoint's location on any wire surface or in a provider id. A client MUST NOT infer capabilities from the id; an unadvertised one fails `capability_not_provided`.

`authModes` (`apiKey`, `oauth-pkce`, `oauth-device`, `none`, `subscription`) is capability, not policy: a client MUST ignore an unknown mode and MUST NOT infer policy from one.

- OAuth and `subscription` credentials go by `ref`, never key material; an OAuth mode SHOULD come with `oauth`.
- A `subscription` credential MUST bind at user scope; a tenant or workspace binding MUST be rejected with `credential_scope_forbidden`.
- A host MUST NOT advertise `subscription` without a reachable acquisition mechanism.

`policies.modes` lists the enforced modes; a client MUST tolerate any subset, and absence means `optional` only. The host MUST document its `scopes` precedence.

- `disabled` always refuses (`provider_disabled`).
- `required` refuses without a `credentialRef` (`byok_required`) or a usable secret (`byok_required_but_unresolved`).
- `restricted` refuses a model matching no `allowedModels` glob (`model_not_allowed`). An empty `restricted` policy MUST fail closed.

A refusal's `error` MUST be `policies.errorCode` (default `provider_policy_denied`, else a vendor code); its `details.reason` SHOULD name the cause above, and it MUST NOT echo the policy. Each decision SHOULD be audited. A resolver outage SHOULD fail open.

A host advertising `promptPrefixCache` MAY honor `cachePrefixId` per routed provider, and otherwise MUST ignore it. It MUST key the cache by (authenticated tenant, `cachePrefixId`) and MUST NOT persist prompt or response substrings keyed by it. The envelope and `provider.usage` token counts MUST match on hit and miss, and on replay.

## `agentRuntime`

A host advertising `agentRuntime` MUST expose `spawn`, `delegate`, `consensus` and `messageSend`. Advertising it implies `agents.manifestRuntime`, which the host MUST satisfy.

## `mcp`

A host advertising `mcp.client` MUST expose to pack code `ctx.mcp.callTool`, `listTools`, `readResource` and `serverHealth`, each against a host-configured `serverId` at the revision `mcp` negotiates.

Each rejects only for an unknown `serverId` (`not_found`), an MCP error response (carried unaltered), or a transport failure (`upstream_unavailable`).

- `callTool` MUST resolve to the server's `CallToolResult` unaltered (`content[]`, `structuredContent`, `isError`, `_meta`), including when `isError` is true. The host handles an `InputRequiredResult` itself and never returns one.
- `listTools` MUST resolve to one `ListToolsResult` page unaltered, `outputSchema`, `annotations`, `nextCursor`, `ttlMs` and `cacheScope` included, and MUST forward a pack's `cursor`.
- `readResource` resolves to the `ReadResourceResult` unaltered.
- `serverHealth` MUST report `reachable`, `unreachable` or `incompatible` from a `server/discover` probe no older than its `ttlMs`, with the `DiscoverResult` when one was received. It MUST NOT report a connection or session state.

## `secrets`

A host advertising `secrets` MUST resolve secrets to opaque references. Raw key material MUST NOT appear in any event, log, trace, prompt, error, export or screenshot, and the host MUST test this before exposing BYOK.

`scopes` lists the storage scopes the host implements, and a client MUST tolerate any subset. `resolution` is `host-managed`.

A host offering `resolveInPack` MUST expose `ctx.secrets.resolve({ ref, purpose })`, returning `plaintext` and optional `expiresAt` and `rotatedAt`. It:

- MUST keep the plaintext out of events, spans, logs, snapshots and replay state. A replay re-resolves it, and the host SHOULD record only `ref`, `purpose` and time;
- MUST resolve `ref` only to a credential the calling run may read, fail a `ref` from another workspace, and never substitute another credential;
- MUST reject a missing, revoked or expired secret with `credential_not_found`, a denied one with `credential_forbidden`, and an exhausted quota with `rate_limited`.

A pack MUST pass a non-empty `purpose`, which the host audits. The pack MUST NOT log the plaintext, keep it past the consuming call, or pass it to any other `ctx` method, and MUST treat it as run input that may differ between runs.

### Run-supplied secrets

A host advertising `runSecrets: { maxEntries }` accepts `runSecrets` on `createRun` ([runs.md](runs.md) §Create): an array of `{ ref, value }`. It MUST also list `run` in `scopes`. A client MUST NOT send `runSecrets` to a host that does not advertise it.

- **Bounds.** `ref` MUST match `^run:[A-Za-z0-9_.-]{1,64}$`, and `value` is a string of 16 to 4096 characters. The array holds at most `maxEntries` entries, each `ref` once. A request that breaks any of these MUST be refused `400 validation_error`, naming the field and never the value.
- **Bound to the run.** A `run:` ref MUST resolve only to a value in the `runSecrets` of the run resolving it, never from another run, a user, tenant, workspace, the platform or the process environment. An unsupplied `run:` ref MUST fail `credential_not_found`. A ref without the `run:` prefix MUST NOT resolve to a `runSecrets` value.
- **Lifetime.** The host MUST NOT write a value to any store an operator or client can read in cleartext, and MUST discard it by the time the run is terminal. A fork does not inherit it, so a `run:` ref in the fork fails `credential_not_found`.
- **Redaction.** A value is a resolved run-scoped secret, and every redaction rule of this section and of §`memory` binds it. The host MUST NOT echo it on any response, the `createRun` answer and the snapshot included; a read MAY return the refs. It MUST NOT log the request's values.
- **No digest.** A value MUST NOT enter any hash, digest, fingerprint or cache key the host persists or derives from the request, including any replay, witness or audit digest. The idempotency request digest ([idempotency.md](idempotency.md)) is computed with `runSecrets` removed. A same-key retry that differs only there compares equal, is answered as any duplicate is, and its values are discarded unused.

A host advertising `runSecrets` MUST execute the node type `core.secret.witness` and MUST advertise the fixture `openwop-secrets-run-witness`. The node's configuration is `{ ref, expectedSha256 }`.

- A `ref` without the `run:` prefix MUST fail `credential_forbidden` without resolving anything.
- Otherwise the node resolves `ref` under the rules above and outputs `{ matched }`: whether the lowercase-hex SHA-256 of the value's UTF-8 bytes equals `expectedSha256`.
- It MUST NOT output, log or emit the value, its digest, its length, or any other function of it beyond `matched`.

## `modelCapabilities`

`modelCapabilities.advertised` lists the capability identifiers the active model offers; a host-private identifier MUST be prefixed `x-host-<host>-`.

When a host advertising `modelCapabilities` dispatches a node that declares `requiredModelCapabilities`, it MUST check them before dispatch and act on the result:

- all met: dispatch;
- unmet, with a `fallbackModel` declared, `substitutionSupported` advertised, and the fallback's provider in `aiProviders.providers` with a resolvable credential: emit `model.capability-substituted`, then dispatch the fallback;
- otherwise: emit `model.capability-insufficient` and fail the run with `capability_not_provided`.

The host MUST NOT substitute silently or dispatch an unsuitable model. It MUST check a fallback's full capability set, and refuse a fallback that falls short with `fallbackAttempted: true` rather than chain another. Checking capabilities before resolving prompts is RECOMMENDED.

## `scheduling`

A host advertising `scheduling` starts runs from the `schedule` trigger in the forms it advertises (`cron`, `delayed`, `calendar`). It MAY do so without `queueBus`. For each schedule it MUST:

- persist it so it survives a restart and fires on time;
- fire once per tick, never as duplicate concurrent runs;
- reject a fire time beyond `maxFutureHorizon` with `schedule_horizon_exceeded`, whose `details.maxFutureHorizon` SHOULD echo the cap;
- after missing a tick while down, either fire once on recovery or skip to the next tick, as it documents, never the whole backlog.

## `queueBus`

A host advertising `queueBus` MUST expose `ctx.queueBus.publish`, `consume`, `ack` and `nack`; `deadLetter` when it advertises `deadLetterSupported`; and `streamSubscribe` when it advertises `stream`, honoring `fromBeginning` only under `stream.fromBeginning`. It MAY use any of its advertised `backends`.

- A tenant's consumer MUST NOT receive another tenant's messages, even on the same topic.
- `ack` MUST remove a message, `nack` MUST return it for redelivery, and `deadLetter` MUST route it to the configured dead-letter queue, which holds messages, not runs ([runs.md](runs.md) §Dead letters).
- A workflow triggered by a queue consume MUST get one run per inbound message, with no batching or skipping.
- The wire shape MUST NOT vary by backend. An unknown topic or expired delivery token rejects `not_found`; an unreachable backend, `upstream_unavailable`.

## `toolHooks`

A host advertising `toolHooks` extends `agent.toolCalled` and `agent.toolReturned` for every external tool call:

- **`prePostEvents`.** The host MUST set `argsHash`, `principal` and `transport` on the call, and `status` and `durationMs` on the return. `argsHash` is SHA-256 over the RFC 8785 canonical arguments with secrets already redacted. A non-agent egress uses the principal `core.system`. `durationMs` is re-emitted verbatim on replay or fork, never recomputed.
- **`perToolAuthorization`.** Before invoking, the host MUST check the principal's scopes against the tool's `requiredScopes`. If one is missing or cannot be evaluated, it MUST NOT invoke, MUST emit `agent.toolReturned` with `status: forbidden`, and MUST answer `403 forbidden` with `details.scope: "tool"`, `toolName` and `requiredScopes`.
- **`perToolRateLimit`.** The host MUST keep a token bucket per `(principal, toolName)`. When the bucket is empty, the host MUST NOT invoke; it emits `status: rate_limited` and answers `429 rate_limited` with `details.scope: "tool"`.

A host MAY refuse an allowlisted tool at loop start. Such a return has no call: the host MUST synthesize its `callId` (a stable derivation is RECOMMENDED), MAY omit `causationId`, and MUST NOT invent an `agent.toolCalled`. A consumer MUST tolerate an unpaired `forbidden` or `rate_limited` return.

## `httpClient`

A host advertising `httpClient` MUST advertise `ssrfGuard: true` and a positive `maxResponseBodyBytes`. Before connecting it MUST resolve the target, reject loopback, RFC 1918, link-local and cloud-metadata addresses, and pin the resolved address for the connection (invariant `http-client-ssrf-guard`). A refused target is `egress_denied`, `reason: ssrf-blocked`; an unreachable one, `upstream_unavailable`. `methods` lists the HTTP methods it accepts.

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

A host advertising `workspace` keeps agent files (`schemas/v2/workspace-file.schema.json`) scoped to one `{tenant, workspace}`; no protocol path serves them. The host:

- MUST make each write atomic, bumping `version`, and emit `workspace.updated` on each write or delete; a versioned delete leaves a tombstone;
- MUST refuse a stale `If-Match` etag with `409 workspace_conflict` (`details.currentVersion`), and content over `maxFileBytes` with `workspace_too_large`;
- with `versioned`, MUST serve the latest and any retained version, retaining best-effort up to `maxVersions`; `maxFiles` caps the file count;
- MUST give a run, through `ctx.workspace`, an immutable snapshot taken at `run.started`, so a replay on any host sees the same files; its writes reach later runs only;
- MUST derive the scope from the authenticated identity and MUST NOT return or disclose another scope's file; `404` MAY stand for `403` (invariant `workspace-cross-tenant-isolation`);
- MUST persist `[REDACTED:<secretId>]` for any value the run's vault resolved at user, tenant or run scope (longest first, 8-character minimum).

A workflow calling `ctx.workspace` MUST NOT register on a host without the family. The memory-index manifest is the workspace file `MEMORY-INDEX.json`.

## `memory`

A host advertising `memory` serves agent memory (`schemas/v2/memory-entry.schema.json`) to pack code as `ctx.memory`; no protocol path serves it. `list` returns `[]` for an unknown ref and `get` returns `null`; writes are host-internal, and a read-only host sets `writable: false`.

- **Refs.** `memoryRef` is opaque; a host MUST NOT assume another host's ref resolves. A node MUST guard `ctx.memory`, which may be undefined.
- **Tenant isolation.** A ref MUST resolve to one tenant's entries, whatever the caller's permissions. A malformed ref (traversal, embedded null, oversize) MUST return `[]` or `null`. An adapter sharing a store MUST gate on the ref's shape, not trust the store. An adapter error MUST NOT carry entry data.
- **Redaction.** A persisted entry MUST carry `[REDACTED:<secretId>]` in place of any value the run's vault resolved at user, tenant or run scope; platform scope is excluded.
- **Size and expiry.** A host SHOULD reject a `put` over `maxEntrySizeBytes` with `validation_error`. Under `ttlSupported` or `retention.ttl`, an entry past `expiresAt` MUST NOT surface, purged or not.
- **Long-term.** A host whose `agents.memoryBackends` includes `long-term` MUST honor isolation, redaction and expiry end to end. A validator MUST NOT look for `memoryBackends` under `memory`.
- **`search`** advertises query `modes` beyond `list`. **`retention.forget`** is a tenant-scoped delete-by-subject of live memory only; replay reads the recorded snapshot and the log is untouched.
- **`attribution`.** Under `emitsWriteEvents: true` the host MUST emit a content-free `memory.written` for every memory write a run makes; otherwise a consumer MUST tolerate its absence.
- **`injectionBudget`** makes `list` honor `tokenBudget`, in `tokenCounter` units; without it the budget is ignored. The host MUST return a prefix of the ranked list within budget, omitting (never truncating) an entry that alone exceeds it. With `limit` as well, it MUST honor whichever yields fewer entries.
- **Ranking.** `rank: relevance` MUST carry `query` and requires `search` mode `semantic`; otherwise a host MUST reject it or fall back, as documented, to `recency` (the default), and never fabricate a ranking. Ranking MUST run over the redacted, single-tenant set.
- **`compaction`** (`trigger: host-managed`) emits `memory.compacted`. Derived content MUST pass the same redaction as a fresh `put`. A client MUST NOT infer compaction or distillation from entry counts.
- **`distillation`** is budgeted compaction ([runs.md](runs.md) §`distillation` section); an absent budget MUST default to `maxTokenBudget`, counting input and output. It emits `memory.compacted` with `distillation` and `trigger: host-managed`, and tenant isolation covers its archive and index.
- **Distillation runs.** A distillation run MUST read the ref's snapshot, MUST NOT re-expose a redacted secret at any recursion level, and MUST write an immutable, addressable archive, byte-stable per source set and budget, kept for `archiveRetention`. Under `indexEmitted` it updates `MEMORY-INDEX.json`, and a `.md` sibling MAY accompany it.
- **Degraded agents.** When an agent's `memoryShape` needs a dimension the host lacks, its inventory entry MUST set `memoryDegraded` and `degradedMemoryDimensions`; the agent MAY still dispatch. A `role: skill` manifest MUST keep `memoryShape` scratchpad-only, enforced by schema.

*Sources: RFCs 0004, 0012, 0017, 0027, 0028, 0029, 0031, 0048, 0052, 0055, 0057, 0059, 0062, 0064, 0067, 0076, 0079, 0080, 0091, 0105, 0106, 0108, 0113, 0116, 0121, 0131, 0144, 0228, 0229.*

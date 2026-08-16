# OpenWOP Spec v1 — Typed State Channels and Reducers

> **Status: Stable · v1.1 (2026-04-27).** Comprehensive coverage of channel declarations, six canonical reducers, the migration path from variable-prefix conventions, and the back-compat layer. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

A workflow run carries state beyond the inputs and outputs of individual nodes: approval votes, refine-loop feedback history, loopback counters, artifact mirrors, multi-turn Q&A exchanges. The reference implementation persists this state in an **untyped variables map** with **prefix conventions**:

| Prefix                           | Purpose                             | Reducer (implicit)     |
| -------------------------------- | ----------------------------------- | ---------------------- |
| `_approvalVotes:{nodeId}`        | Multi-approver vote tally           | append                 |
| `_askExchanges:{nodeId}`         | Q&A exchanges during approval       | append + cap           |
| `_clarificationAnswers:{nodeId}` | Clarification answers               | merge                  |
| `_feedbackHistory:{nodeId}`      | Refine-loop feedback log            | append                 |
| `_loopbackCount:{nodeId}`        | Loopback iteration counter          | counter                |
| `_loopbackIteration:{nodeId}`    | Current iteration index             | replace (counter-like) |
| `_previousArtifact:{nodeId}`     | Pre-refine artifact snapshot        | replace                |
| `wfArtifactData_{nodeId}`        | Artifact mirror surviving doc-strip | replace                |
| `_activeClarification`           | Active clarification descriptor     | replace                |

**Why this is a problem:**

1. **Prefix-as-namespace is fragile.** A typo in the prefix string silently writes to a different namespace; nothing surfaces the error.
2. **Implicit reducers.** Each callsite reimplements its own append/merge/counter logic. Drift between writer and reader is the most common bug class.
3. **No type safety.** `run.variables[`\_approvalVotes:${nodeId}`]` is `unknown`; every reader casts and hopes.
4. **No external visibility.** External tools can't introspect the namespace structure — they see one giant `Record<string, unknown>`.

openwop defines **typed channels with explicit reducers** as the replacement. Each channel is a first-class declaration with a typed value and a named reducer; the prefix conventions become a back-compat layer that the spec deprecates over time.

The channel/reducer idiom parallels [LangGraph's `Annotated[T, reducer]`](https://langchain-ai.github.io/langgraph/concepts/low_level/#state) — chosen for ecosystem familiarity.

---

## Channel declaration

An OpenWOP-compliant workflow definition MAY declare typed channels:

```typescript
interface WorkflowDefinition {
  // ... existing fields (id, nodes, edges, etc) ...

  /** Typed state channels for this workflow. Optional — workflows without
   *  declared channels fall back to the legacy untyped variables map. */
  channels?: Record<string, ChannelDeclaration>;
}

interface ChannelDeclaration {
  /** Reducer name. Servers MUST recognize all canonical reducers (see below);
   *  MAY accept implementation-defined custom reducer names. */
  reducer: 'replace' | 'append' | 'merge' | 'counter' | 'votes' | 'feedback' | string;

  /** Optional JSON Schema for the channel value. Servers SHOULD validate
   *  every write against this schema; servers MAY skip validation in
   *  production for performance. */
  schema?: JSONSchema;

  /** Integer version of the current `schema`. Defaults to 1. Increments
   *  whenever the channel author edits `schema`. Each `channel.written`
   *  event records the version that was live at write time. (closes C4) */
  schemaVersion?: number;

  /** Older schema versions whose persisted writes are forward-readable
   *  under the CURRENT schema. The engine validates each old write
   *  against the current schema during fold; pass = include, fail =
   *  `channel_schema_breaking_change` error. Empty/omitted means "no
   *  backward compatibility" — any older-version writes trip the
   *  breaking-change error. (closes C4) */
  compatibleWith?: number[];

  /** Optional default value when no events have written to this channel. */
  default?: unknown;

  /** Optional max size — for `append`/`votes`/`feedback` reducers, oldest
   *  entries are dropped when this is exceeded. For other reducers, writes
   *  beyond this size are rejected with `validation_error`. */
  maxSize?: number;

  /** Optional entry-age TTL in milliseconds (closes C3). Applies to
   *  `append` / `votes` / `feedback` reducers; ignored on others. Engine
   *  drops entries older than this age (lazy: on read or next write).
   *  Range 1..(365*24*60*60*1000). `0` means "no TTL" (same as omitting). */
  ttlMs?: number;

  /** Optional reducer-specific options. */
  options?: Record<string, unknown>;

  /** Optional access control (closes C1). Three forms:
   *    'public'  — explicit no-restriction (same as omitting access; default).
   *    'private' — shorthand: locks down. Equivalent to `{readers: [], writers: []}`.
   *                Authors fill in node lists incrementally to grant access.
   *    {readers?, writers?} — explicit allowlists. Each side is independently
   *                scoped: side omitted = open; side present = strict allowlist. */
  access?: 'public' | 'private' | {
    readers?: string[];
    writers?: string[];
  };
}
```

### Channel naming

Channel names are arbitrary strings, but spec-aware tooling expects:

- Workflow-level channels (one value per run): `<short-camelCase-name>` — e.g., `kernelArtifact`, `currentBranch`.
- Node-scoped channels (one value per (run, nodeId) pair): `<name>:{nodeId}` — e.g., `approvalVotes:{nodeId}`, `feedbackHistory:{nodeId}`. The `:{nodeId}` suffix is parsed by tooling to scope rendering.

Servers MUST accept any string as a channel name; the suffix convention is for tooling only.

### Channel access control (closes C1)

Channels default to **any-to-any** within a workflow. For workflows with sensitive data (PII in a `feedback` channel, ranking scores in a `votes` channel, etc.), the `access` field on `ChannelDeclaration` declares per-channel allowlists.

Three forms:

```yaml
# 1) Default — no access field (or 'public'): any node can read + write.
votes:
  reducer: votes

# 2) Lockdown shorthand — 'private' is equivalent to { readers: [], writers: [] }.
#    All access denied. Authors fill in lists to grant.
secret-feedback:
  reducer: feedback
  access: 'private'

# 3) Explicit allowlists — each side independently scoped. Side omitted = open;
#    side present = strict allowlist.
votes-2:
  reducer: votes
  access:
    writers: ['vote-collector']            # only this nodeId can write
    readers: ['vote-tally', 'vote-display'] # only these can read

#    Mixing instance-level (nodeId) and category-level (typeId wildcard):
ai-feedback:
  reducer: feedback
  access:
    writers: ['core.ai.*', 'feedback-curator']  # any AI node OR a specific curator
```

**Allowlist entries** are matched against the requesting node in two passes:

1. Exact match against the node's `nodeId` (workflow-instance-specific, e.g., `vote-collector-1`).
2. Wildcard match against the node's `typeId` (workflow-stable, e.g., `core.ai.callPrompt`). Wildcards use `*` suffix on a dotted prefix (`core.ai.*` matches `core.ai.callPrompt` and `core.ai.generateFromPrompt`; `*` alone matches all).

A node passes if EITHER pass matches.

**Engine enforcement.** When a node calls `ctx.channels.get('X')` or `ctx.channels.write('X', value)`:

- If `access` is omitted or `'public'`: allow.
- If `access === 'private'`: deny (return `400 channel_access_denied`).
- If `access` is the object form: check the relevant list (`readers` for read, `writers` for write). If the list is omitted, allow. If the list is present, deny unless the node matches an entry.

Error envelope:

<!-- normative-example: error-envelope.schema.json -->
```json
{
  "error": "channel_access_denied",
  "message": "Node 'vote-tally' may not write to channel 'votes'.",
  "details": {
    "channel": "votes",
    "requestedBy": { "nodeId": "vote-tally", "typeId": "vendor.acme.tally" },
    "allowed": "writers"
  }
}
```

**Forward-compat.** Workflows that don't use `access` are unchanged. Tooling SHOULD warn when a sensitive-looking channel name (e.g., contains "secret", "password", "private") has no access restriction — but the engine MUST NOT enforce on naming convention alone.

### Channel schema migration (closes C4)

When a channel's `schema` evolves, prior persisted writes don't auto-revalidate against the new shape. openwop's migration model is **versioned schemas + auto-detect compatibility + fail-loud on breaking**:

- `ChannelDeclaration.schemaVersion` — integer, defaults to 1. Authors increment when editing `schema`.
- `ChannelDeclaration.compatibleWith` — list of older versions whose persisted writes are forward-readable under the _current_ schema.
- Each `channel.written` event records its `schemaVersion` at write time (carried in the event payload — see `channel-written-payload.schema.json`).

**Engine fold semantics on read:**

| Event's `schemaVersion` | `compatibleWith` includes it? | Behavior                                                                                                              |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `=== current`           | n/a                           | Fold normally. Validate against current `schema` if declared.                                                         |
| `< current`             | Yes                           | Validate the old write against the _current_ schema. Pass → fold; fail → hard error `channel_schema_breaking_change`. |
| `< current`             | No                            | Hard error `channel_schema_breaking_change` with migration hint.                                                      |
| `> current`             | n/a                           | Forward-compat tolerant: fold permissively (`additionalProperties: true` semantics). Happens during deploy roll-back. |

**Why automatic detection works.** The engine doesn't need to _understand_ what changed between v1 and v2 — it just runs old data through the new schema. If it validates, the change is non-breaking. If not, it's breaking and the engine fails loud rather than silently corrupting state.

**Author workflow for non-breaking edits** (the common case — adding optional fields, widening enums):

```yaml
channels:
  feedback:
    reducer: feedback
    schema: { ... v2 shape with new optional field ... }
    schemaVersion: 2
    compatibleWith: [1]   # explicit declaration that v1 writes are OK
```

Old v1 writes auto-fold under v2 (the new optional field is absent — still valid). No migration code; no new channel name.

**Author workflow for breaking edits** (rare — removing a field, adding a required field, narrowing a type):

The engine refuses to fold v1 writes under a strict v2 schema. Authors MUST create a new channel name and copy via a one-shot node:

```yaml
channels:
  feedback:           # v1 — unchanged, kept for back-compat reads
    reducer: feedback
    schema: { ... }
    schemaVersion: 1
  feedbackV2:         # new channel with the breaking schema
    reducer: feedback
    schema: { ... v2 with new required field ... }
    schemaVersion: 1  # this is v2's first version
```

A copy node reads `feedback`, transforms each entry, writes to `feedbackV2`. Old runs see only `feedback`; new runs read from `feedbackV2`. Both can coexist.

**Replay determinism.** Every `channel.written` event carries its own `schemaVersion`. Replays fold identically to live reads — old runs replay against the schema that was live at the time of the original write, and breaking-change errors surface at the same sequence in both replay and original.

**Error envelope:**

<!-- normative-example: error-envelope.schema.json -->
```json
{
  "error": "channel_schema_breaking_change",
  "message": "Channel 'feedback' has a breaking schema change between v1 and v3.",
  "details": {
    "channel": "feedback",
    "currentSchemaVersion": 3,
    "incompatibleEventVersion": 1,
    "incompatibleEventId": "evt_abc...",
    "migrationHint": "Create a new channel name and copy via a one-shot node."
  }
}
```

**What this is NOT.** openwop does NOT spec author-supplied migration functions (`v1 → v2` transformer code). That sort of code is genuinely product-design territory and varies wildly across implementations — keep it out-of-spec, in vendor packs or workflow author tooling.

### Distributed reducers and cross-engine writes (closes C2)

Channel reducers run engine-host-locally. When a sub-workflow (a parent invokes a child) or cross-canvas invoke runs on a different engine instance than the parent, the spec specifies which writes are allowed across engine boundaries and how parents combine cross-engine inputs into authoritative state.

#### Cross-engine write rules

| Reducer    | Cross-engine write? | Why                                                                                                                                         |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `append`   | ✅ Allowed          | Commutative + associative — concurrent appends just produce more entries. Cross-engine order is engine-determined per §"Append ordering".   |
| `votes`    | ✅ Allowed          | Per-voter latest-wins de-dup makes concurrent writes safe.                                                                                  |
| `feedback` | ✅ Allowed          | Append-with-bound; same as `append`.                                                                                                        |
| `counter`  | ✅ Allowed          | Addition is commutative + associative.                                                                                                      |
| `replace`  | ❌ Forbidden        | Last-write-wins with concurrent cross-engine writes is a workflow-design bug, not a silent race.                                            |
| `merge`    | ❌ Forbidden        | Shallow-merge order matters for overlapping keys; concurrent cross-engine writes produce non-deterministic state.                           |
| `vendor.*` | Server's call       | Custom reducers declare their own cross-engine policy. Servers SHOULD reject cross-engine writes by default and require the pack to opt in. |

When a non-owner engine attempts a cross-engine write to a forbidden reducer, the server MUST return `400 channel_cross_engine_write_forbidden`:

<!-- normative-example: error-envelope.schema.json -->
```json
{
  "error": "channel_cross_engine_write_forbidden",
  "message": "Channel 'currentDecision' uses reducer 'replace' which forbids cross-engine writes. Use the channel-write trigger pattern to combine child contributions in the parent.",
  "details": {
    "channel": "currentDecision",
    "reducer": "replace",
    "sourceEngineId": "child-engine-7",
    "sourceRunId": "run_xyz"
  }
}
```

Each `channel.written` event from a non-owning engine carries `sourceEngineId` + `sourceRunId` (see `channel-written-payload.schema.json`). The fold side uses these to disambiguate origins.

#### Append ordering (normative)

For the `append` reducer (and its bounded variants `votes` / `feedback`), the engine MUST fold concurrent writes deterministically so replay reproduces the same projected channel state.

**Within a single engine** (intra-host):

1. Writes are ordered by the `sequence` field on their backing `channel.written` event (`run-event.schema.json` §sequence). Because `sequence` is monotonic per run and assigned atomically by `appendAtomic`, intra-engine concurrent writes have a total order.
2. The folded array MUST reflect that order: entry `i` in the projected array corresponds to the `i`-th `channel.written` event for that channel in event-log order.

**Across engines** (cross-host):

1. Each `channel.written` event carries `sourceEngineId` + `sourceRunId` + per-engine `sequence`. The owner engine receives these as inbound writes.
2. The owner engine MUST assign each inbound write a new per-run `sequence` value at the moment it is appended to the owning run's event log. That assigned sequence is the durable order.
3. Consumers MUST NOT rely on the original `sourceEngineId` `sequence` for ordering — only the owner-assigned sequence is replay-deterministic.

**Tie-breaking when sequences collide** (e.g., during recovery from a split-brain claim handoff): the owner engine MUST use `(sequence, eventId)` as the composite sort key. `eventId` is opaque but globally unique, so this is a total order.

**Replay determinism.** Re-folding the channel from the event log MUST produce the identical array contents AND identical array ordering as the original execution. Hosts MUST NOT reorder events during replay.

#### Reactive parent computation: `channel-write` trigger

For workflows that need authoritative state derived from many child contributions (a parent decision built from child votes; a tally built from child counters), the spec adds a `channel-write` trigger type. It fires a parent-engine node when a named channel receives a write — including cross-engine writes from children. The triggered node runs in the parent's context and can do `replace` / `merge` / `counter` on OTHER channels with single-writer guarantees.

```yaml
channels:
  childVotes:                   # children append-write here, cross-engine OK
    reducer: votes
  finalDecision:                 # parent owns; single-writer replace
    reducer: replace

triggers:
  - id: tally-when-child-votes
    type: channel-write
    config:
      channel: childVotes
      onlyFrom: child            # 'child' | 'parent' | 'any' (default 'any')
      debounceMs: 1000           # optional — coalesce a burst of child writes
    nodeId: tally-and-decide

nodes:
  - id: tally-and-decide
    typeId: core.aggregator.tally
    # reads childVotes via ctx.channels; writes finalDecision via ctx.channels.
```

Trigger config fields:

| Field        | Required | Notes                                                                                                                                                                                     |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channel`    | Required | Name of the channel to watch. MUST match a key declared under `WorkflowDefinition.channels`.                                                                                              |
| `onlyFrom`   | Optional | `'child'` (only cross-engine writes), `'parent'` (only own-engine writes), `'any'` (default — all writes). Use `'child'` for the typical aggregation pattern.                             |
| `debounceMs` | Optional | When children write in bursts, wait for a quiet period of this many ms before firing. Recommended for `votes` / `feedback` aggregation; omit for low-frequency channels. Range: 0..60000. |

#### Loop protection

A `channel-write` trigger MUST NOT fire on writes performed by the node it just dispatched (or that node's downstream lineage within a single trigger execution). Without this guard, "trigger fires → triggered node writes → trigger fires again" would loop forever.

The existing `WorkflowSettings.maxLoopbackIterations` cap covers anything the per-trigger guard misses (e.g., transitive writes that hop through multiple channels back to the original).

#### Replay determinism

The `channel.written` event log is the source of truth. During replay, the engine re-fires `channel-write` triggers in event order — same writes, same trigger sequence, same parent-side decisions. Replays produce identical fold output to the original run, modulo external API determinism (covered separately by `idempotency.md` Layer 2).

#### What this is NOT

- It's NOT a CRDT-everywhere model. `replace` / `merge` are still single-writer; the `channel-write` trigger is the _escape hatch_ to combine cross-engine inputs into a single-writer decision.
- It's NOT a generic pub/sub system. Triggers fire within a single workflow run; cross-run reactivity is out of scope (use webhooks per `rest-endpoints.md`).
- The spec does NOT define which engine-pair combinations are "child" vs "parent" — that's an implementation concern (sub-workflow ownership, cross-canvas-invoke topology, etc.). The `sourceEngineId` field is opaque to the spec.

---

## Canonical reducers

Every OpenWOP-compliant server MUST recognize the following reducer names. Servers MAY add implementation-defined names (e.g., `vendor.acme.dedupe`).

### `replace`

```typescript
function replace<T>(_current: T | undefined, next: T): T {
  return next;
}
```

Latest write wins. The default reducer when none is specified.

**Use cases**: artifact mirrors, current-branch markers, single-value snapshots.

**Maps from existing prefixes**: `_previousArtifact:`, `wfArtifactData_`, `_activeClarification`, `_loopbackIteration:`.

### `append`

```typescript
function append<T>(current: T[] = [], next: T): T[] {
  return [...current, next];
}
```

Each write appends to an array. With `maxSize` set, oldest entries drop.

**Use cases**: log-like channels where order matters and history is preserved.

**Maps from existing prefixes**: `_askExchanges:` (with `maxSize` cap).

### `merge`

```typescript
function merge<T extends object>(current: T = {} as T, next: Partial<T>): T {
  return { ...current, ...next };
}
```

Shallow object merge. Subsequent writes overwrite prior keys; unspecified keys preserve.

**Use cases**: structured state like clarification answers, key-keyed metadata.

**Maps from existing prefixes**: `_clarificationAnswers:`.

### `counter`

```typescript
function counter(current: number = 0, increment: number): number {
  return current + increment;
}
```

Each write adds to the running total. Negative increments allowed.

**Use cases**: loopback iteration counters, retry counters, per-run cost accumulators.

**Maps from existing prefixes**: `_loopbackCount:`.

### `votes`

```typescript
type Vote = { userId: string; action: string; timestamp: string; reason?: string };

function votes(current: Vote[] = [], next: Vote): Vote[] {
  // Replace by userId if exists (revote), else append.
  const without = current.filter(v => v.userId !== next.userId);
  return [...without, next];
}
```

Multi-approver vote tally. A user re-voting replaces their prior vote rather than appending.

**Use cases**: multi-approver gates with revote support.

**Maps from existing prefixes**: `_approvalVotes:`.

### `feedback`

```typescript
type FeedbackEntry = { feedback: string; timestamp: string; iteration: number };

function feedback(current: FeedbackEntry[] = [], next: FeedbackEntry): FeedbackEntry[] {
  return [...current, next];
}
```

Refine-loop feedback log. Append-only with iteration tracking.

**Use cases**: request-changes feedback history across loopback iterations.

**Maps from existing prefixes**: `_feedbackHistory:`.

### `message` (Multi-Agent Shift Phase 1)

```typescript
type ConversationMessage = {
  messageId: string;                              // idempotency key
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; [k: string]: unknown }>;
  agentId?: string;                               // AgentRef.agentId of the producer
  timestamp: string;
  toolName?: string;                              // when role === 'tool'
  toolCallId?: string;                            // pairs with agent.toolCalled
};

function message(
  current: ConversationMessage[] = [],
  next: ConversationMessage
): ConversationMessage[] {
  // Idempotent on messageId: a duplicate emission folds to a single entry.
  if (current.some(m => m.messageId === next.messageId)) return current;
  return [...current, next];
}
```

Append-only, **idempotent on `messageId`**, replay-deterministic. The canonical reducer for conversation logs across single-turn `clarification.requested`, multi-turn `conversation.exchange` (Phase 4), and orchestrator-driven worker handoffs (Phase 5). Replaces ad-hoc chat-log accumulation in pre-MAS workflows.

**Idempotency invariant.** A duplicate `messageId` lands in the log exactly once. Hosts MUST guarantee unique `messageId` per logical turn; consumers SHOULD treat re-emission as a non-event (covers retry / replay-fork scenarios without log corruption).

**Use cases**:

- Multi-agent conversation logs (Phase 1 + Phase 4)
- Tool-call trace alongside `agent.toolCalled` / `agent.toolReturned` events
- Orchestrator-supervisor context projection (`messageLog?` input to `core.orchestrator.supervisor`)

**Maps from existing prefixes**: none — this reducer ships with the Multi-Agent Shift; pre-MAS workflows that need conversation logs upgrade explicitly via channel declaration.

### Custom reducers

An OpenWOP-compliant server MAY accept reducer names outside the canonical set. Names MUST be vendor-prefixed (`vendor.<org>.<name>`). External clients consuming workflows with custom reducers MUST treat unknown names as `replace` semantically and warn the operator.

---

## Wire surface

### Channel write event

Channel writes are persisted as durable events. An OpenWOP-compliant engine MUST emit:

```typescript
{
  type: 'channel.written',
  payload: {
    channel: string;       // channel name
    value: unknown;        // the write payload (NOT the post-reduction value)
    reducer: string;       // the reducer name (for replay determinism if reducer changes)
    nodeId?: string;       // optional — node that wrote
    writtenAt: string;     // ISO 8601
  }
}
```

The payload carries the _write input_, not the post-reduction state. Replay reconstructs the post-reduction state by folding all `channel.written` events through the declared reducer.

### Channel read

NodeModules read channels via `ctx.channels`:

```typescript
interface NodeContext {
  channels: {
    /** Get the current reduced value of a channel. */
    get<T = unknown>(name: string): T | undefined;

    /** Write a value through the channel's reducer. */
    write<T = unknown>(name: string, value: T): Promise<void>;

    /** Subscribe to changes (for executors that need to react). */
    subscribe<T = unknown>(name: string, cb: (value: T) => void): () => void;
  };
}
```

Reads are synchronous (the engine maintains a folded cache). Writes are async because they emit a durable event.

---

## Migration from variable-prefix conventions

An OpenWOP-compliant server MAY continue accepting writes to the legacy `run.variables` map. The spec defines a back-compat layer:

### Legacy mode (default for v1)

`run.variables` reads/writes work as before. The reference app's recovery-internal-variable allowlist (historical cross-repo evidence: `openwop/openwop-app` repo, backend `WorkflowRunPersistenceService.ts`) continues to apply:

- `_activeClarification`
- Prefixes: `_approvalVotes:`, `_askExchanges:`, `_clarificationAnswers:`, `_feedbackHistory:`, `_loopbackCount:`, `_loopbackIteration:`, `_previousArtifact:`

Writes to the legacy map MUST emit `channel.written` events with the prefix-derived channel name and inferred reducer (per the mapping table at the top of this doc).

### Channel-aware mode (opt-in via `WorkflowDefinition.channels`)

When a workflow declares `channels`, the engine MUST:

1. Refuse writes to `run.variables[k]` if `k` matches a declared channel name. Surface as `validation_error`.
2. Surface `ctx.channels.{get,write,subscribe}` for declared channels.
3. Continue accepting writes to `run.variables[k]` for keys NOT in `channels` — back-compat for incremental adoption.

### Codemod path

Workflows migrating from prefix conventions to declared channels:

1. Audit `run.variables[<prefix>:*]` writes in NodeModules consumed by the workflow.
2. Add `channels` block to `WorkflowDefinition` declaring each prefix family with the appropriate reducer.
3. Switch NodeModule callsites from `ctx.setVariable(`\_approvalVotes:${nodeId}`, ...)` to `ctx.channels.write(`approvalVotes:${nodeId}`, ...)`.
4. Optionally, remove the prefix from the channel name (`approvalVotes:${nodeId}` instead of `_approvalVotes:${nodeId}`) — the underscore was a "framework-internal" marker no longer needed once channels are first-class.

An OpenWOP-compliant server SHOULD ship a codemod tool that does steps 2–3 mechanically.

---

## Replay determinism

When the reducer for an existing channel changes (e.g., upgrading `append` to `append` with `maxSize` enforcement), replay reconstruction uses the **reducer-at-write-time** stored on each `channel.written` event. This guarantees that a replay produces the same post-reduction state the original run had, even if the workflow definition's declared reducer has since changed.

If a workflow author needs to change reducer semantics retroactively (rare — usually requires a fork-and-rewrite anyway), `replay.md` `branch` mode is the supported escape hatch.

---

## Channel snapshot in `values` stream mode

The `values` stream mode (`stream-modes.md`) emits `state.snapshot` events after each step. The snapshot payload includes the **post-reduction** value of every declared channel:

```json
{
  "type": "state.snapshot",
  "payload": {
    "runId": "...",
    "atSeq": 42,
    "channels": {
      "approvalVotes:approval-1": [{ "userId": "u1", "action": "approve", "timestamp": "..." }],
      "feedbackHistory:approval-1": [],
      "kernelArtifact": { /* ... */ }
    },
    "variables": { /* legacy untyped variables */ }
  }
}
```

External tooling can render channels separately from raw variables — by name, with type schemas pulled from `ChannelDeclaration.schema`.

---

## Channel TTL: `ttlMs` (closes C3)

`maxSize` bounds a channel by entry count, but for long-running runs (multi-day workflows, perpetual orchestration) even bounded entry counts can hold stale data forever. `ttlMs` is an optional `ChannelDeclaration` field that drops entries older than the declared age:

```typescript
"feedback": {
  reducer: 'feedback',
  ttlMs: 86_400_000,  // 24h — older entries are dropped on next read
}
```

Semantics:

- Applies to reducers with monotonic-append semantics: `append`, `votes`, `feedback`. SHOULD be ignored for `replace` / `merge` / `counter` (those have no entry-age concept).
- **Entry shape (normative).** On a channel that declares `ttlMs`, each entry stored under the channel's state MUST be wrapped in `{ value: T, _ts: number }`, where `_ts` is the write-time wall-clock in milliseconds since the Unix epoch as observed by the engine at append time. Hosts MUST NOT strip `_ts` from the entry between write and read. The wrap applies to the channel state surface (`RunSnapshot.variables.<channelName>`, `RunSnapshot.channels.<channelName>`, `channel.written` event payloads); raw `T` values are reserved for channels that omit `ttlMs`.
- **Pruning timing (normative).** Pruning MUST happen at write time: before appending the new entry, the engine MUST remove every prior entry whose `_ts < (now - ttlMs)`. Engines MAY also prune opportunistically on read (e.g., to serve a fresher snapshot if wall-clock has advanced between writes), but write-time pruning is mandatory so any subsequent `RunSnapshot.variables` projection reflects the pruned state without depending on read-side fold timing. Servers MUST NOT surface entries with `_ts < (now - ttlMs)` on `GET /v1/runs/{runId}` once the next write has landed.
- Per-entry timestamps come from the `RunEventDoc.timestamp` field on the `channel.written` event AND from the embedded `_ts` on each entry; both MUST agree at fold time. The reducer compares `_ts` against `now()` at fold time. During replay, `now()` is defined as the original wall-clock timestamp of the event being folded (a deterministic input from the event log), never the current clock — preserving `replay.md`'s byte-equivalence requirement.
- Combines with `maxSize`: both apply. Whichever bound trips first wins; `ttlMs` is applied first (per the write-time pruning rule), then `maxSize` enforces the entry-count ceiling on the remainder.
- Replay-safe: TTL drop is deterministic given the event log + `now()` at replay time. Replays MUST use the original event timestamps (not replay-wall-clock) for the comparison so the resulting state matches the original run modulo TTL drift.
- An OpenWOP-compliant server MAY refuse `ttlMs` declarations on reducers that don't support it (`400 Bad Request` on workflow registration).

Range: `1 ≤ ttlMs ≤ 365 * 24 * 60 * 60 * 1000` (1 ms to 1 year). `0` means "no TTL" (same as omitting).

---

## Open spec gaps

| #   | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                           | Owner       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| C1  | Channel access control — done (2026-04-27: per-channel `access` field on `ChannelDeclaration`. Three forms: `'public'` / `'private'` shorthand / `{readers?, writers?}` explicit allowlists with nodeId + typeId-wildcard matching. Engine returns `400 channel_access_denied` on violation. See "Channel access control" §).                                                                                                                 | ✅          |
| C2  | Distributed reducers — done (2026-04-27: cross-engine writes allowed for monotonic-add reducers (`append`/`votes`/`feedback`/`counter`); forbidden for `replace`/`merge` with `400 channel_cross_engine_write_forbidden`. New `channel-write` trigger type lets parents reactively derive authoritative state from child contributions. Events carry `sourceEngineId` + `sourceRunId`. See "Distributed reducers and cross-engine writes" §). | ✅          |
| C3  | Channel TTL — done (2026-04-27: `ttlMs` field on `ChannelDeclaration`; lazy drop policy; replay-safe via original event timestamps. See "Channel TTL" §).                                                                                                                                                                                                                                                                                     | ✅          |
| C4  | Schema migration — done (2026-04-27: versioned schemas + auto-detect compatibility + fail-loud on breaking. `ChannelDeclaration.schemaVersion` + `compatibleWith`; `channel.written` events carry `schemaVersion` at write time. See "Channel schema migration" §).                                                                                                                                                                           | ✅          |
| C5  | Cross-host channel coherence — reads from a stale projection cache could return pre-reduction state during the gap between event append and cache write. Currently the engine guarantees write-through, but the spec should formalize.                                                                                                                                                                                                        | future v1.x |

## References

- `auth.md` — auth model + status legend
- `version-negotiation.md` — `eventLogSchemaVersion` bumps when channel event shape changes
- `stream-modes.md` — `state.snapshot` payload includes post-reduction channel values
- `replay.md` — reducer-at-write-time guarantees replay determinism
- `observability.md` — `openwop.channel.<name>` attribute on channel-write spans
- LangGraph state model: <https://langchain-ai.github.io/langgraph/concepts/low_level/#state>

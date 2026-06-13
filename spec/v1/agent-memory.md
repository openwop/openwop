# OpenWOP Spec v1 — Agent Memory

> **Status: Stable · v1.1 (2026-05-10).** Normative spec for cross-run agent memory — `memoryRef` resolution, `MemoryAdapter` host-interface contract, cross-tenant isolation invariant (CTI-1), and BYOK secret-redaction invariant (SR-1). Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

Multi-agent workflows persist context across runs. A pack-installed customer-support agent that resolved a refund last week should still know the customer's preference for email follow-up this week. Without cross-run memory, every run starts from zero — agents lose continuity, users repeat themselves, and orchestrators can't learn from past dispatches.

openwop v1 ships **agent memory** as a host-adapter interface. The spec normates the wire shape (`MemoryEntry`, `MemoryListOptions`), the contract (`MemoryAdapter.list/get`), and two cross-cutting invariants (CTI-1, SR-1). Hosts choose the backing store; the protocol pins the shape.

## `memoryRef` resolution

`AgentRef.memoryRef` (see `schemas/agent-ref.schema.json`) is an OPTIONAL opaque host-defined string identifying the agent's memory scope. Examples:

- `workspaces/tenant-A/agents/agent-1/memories` (Firestore path encoding)
- `mem://customer-support/agent-1` (URI-style)
- `agent-1` (host-internal opaque)

The protocol does NOT pin the encoding — it's host-defined. Cross-host portability of `memoryRef` values is **not normative** in v1.x; hosts MUST NOT assume a `memoryRef` minted by host A is resolvable by host B.

When a run dispatches a node whose `AgentRef.memoryRef` is set, the engine surfaces a `ctx.memory` accessor that nodes consume to resolve the ref. Hosts that don't implement memory leave the accessor undefined; nodes MUST guard `ctx.memory?.list(...)` accordingly.

## `MemoryAdapter` interface

```typescript
interface MemoryAdapter {
  /** Resolve a `memoryRef` to its entries. Returns `[]` for unknown refs. */
  list(memoryRef: string, options?: MemoryListOptions): Promise<readonly MemoryEntry[]>;

  /** Resolve a single entry within a `memoryRef`. Returns `null` if missing. */
  get(memoryRef: string, memoryId: string): Promise<MemoryEntry | null>;
}

interface MemoryEntry {
  readonly id: string;            // host-issued; unique within memoryRef
  readonly content: string;       // memory body
  readonly tags: readonly string[];
  readonly createdAt: Date;       // ISO 8601 on the wire
  readonly expiresAt?: Date;      // optional TTL; entries past expiresAt MUST NOT surface
}

interface MemoryListOptions {
  readonly limit?: number;        // host MAY further bound
  readonly tag?: string;          // filter to entries carrying this tag
}
```

Schemas: `schemas/memory-entry.schema.json` + `schemas/memory-list-options.schema.json`.

**The MemoryAdapter is read-only at the protocol surface.** Memory writes are host-internal — protocol-level nodes do NOT call `write()` / `delete()` through `ctx.memory`. Hosts persist memory entries via host-specific triggers (session-end auto-memory, feedback promotion, manual UI); the writes flow through host-internal redaction (SR-1) before persistence.

## CTI-1 — Cross-Tenant Isolation Invariant (normative)

> **CTI-1.** A `memoryRef` resolved by a `MemoryAdapter` MUST return entries scoped to a single tenant. If `memoryRef` is associated with tenant T, no `list` or `get` call against `memoryRef` MAY return entries belonging to tenant T' ≠ T, regardless of the calling principal's permissions on T'.

In practice:

1. Hosts validate `memoryRef` path shape at resolution time. Malformed refs (path traversal, embedded null, oversize) MUST return `[]` / `null` rather than fall through to a permissive lookup.
2. Cross-instance leak protection: when multiple `MemoryAdapter` instances share an in-process backing store, each instance MUST gate by inspecting the ref shape — not by trusting the store. Reference impls verify via cross-instance test: tenant-A adapter MUST return `[]` when given a tenant-B-shaped ref, even when the underlying store holds the entries.
3. Errors don't leak. When a MemoryAdapter throws (e.g., underlying Firestore failure), the error envelope MUST NOT contain entry data — error messages are host-internal concerns.

**Conformance:** `conformance/src/scenarios/agentMemoryCrossTenantIsolation.test.ts` exercises CTI-1 via the `conformance-agent-memory-cross-tenant` fixture (intentionally constructs a cross-tenant probe; passes when the probe returns empty / null).

## SR-1 — Secret-Redaction Invariant (normative)

> **SR-1.** When a memory write would persist content containing a value the run's BYOK vault resolved during the run, the persisted entry MUST carry `[REDACTED:<secretId>]` in place of the plaintext.

Scope: SR-1 binds to **BYOK-resolved non-platform plaintext** — values resolved at `user`, `tenant`, or `run` scope. Platform-scope (env-var fallback) and host-internal service-account credentials are explicitly excluded; those don't pass through the BYOK redaction registry.

Mechanism (reference impl pattern):

1. The host's BYOK resolver registers each freshly-resolved non-platform plaintext into a per-run `MemorySecretRegistry` (in-process map keyed by `runId`).
2. When a memory write reaches the host's chokepoint helper (`writeAgentMemoryRedacted`), the helper loads the per-run registry, runs substring substitution on the content, and persists the redacted form.
3. The persisted entry's `content` carries `[REDACTED:<secretId>]` markers; read-back via `MemoryAdapter.list/get` surfaces the redacted content.

Reference-impl notes (non-normative):

- Redaction is **substring** replacement, not regex — secret values containing regex metacharacters can't trigger ReDoS or partial behavior.
- Sort by descending value length — a longer secret containing a shorter one redacts whole.
- 8-character minimum-length floor — values shorter than 8 chars don't redact (gitleaks / TruffleHog convention).
- Per-run registries die with the run (process-memory only). Cross-pod resume re-registers via the new pod's BYOK resolver.

**Conformance:** `conformance/src/scenarios/agentMemoryRedactionContract.test.ts` exercises SR-1 via the `conformance-agent-memory-redaction` fixture (resolves a BYOK secret, writes a memory entry containing the plaintext, reads back, asserts `[REDACTED:<secretId>]`).

## TTL semantics

Entries carrying `expiresAt` (RFC 3339 / ISO 8601 UTC) MUST NOT surface in `MemoryAdapter.list/get` after `expiresAt` is past. Hosts MAY purge expired entries asynchronously; the read-side guarantee is that expired entries don't surface, regardless of whether the underlying store has GC'd them.

Granularity: millisecond floor (matches `Date` wire shape).

**Conformance:** `conformance/src/scenarios/agentMemoryTtlExpiry.test.ts` exercises the contract via the `conformance-agent-memory-ttl` fixture.

## Capability advertisement

Hosts that implement long-term memory advertise via `capabilities.agents.memoryBackends: ['long-term']` (see `capabilities.md` §`agents`).

The capability advertisement is a CLAIM. Hosts that advertise long-term memory MUST honor CTI-1 + SR-1 + TTL contracts end-to-end. Conformance scenarios skip cleanly when the advertisement is absent.

## Memory capability model (RFC 0080, `Active`)

**Why this exists.** Memory support is advertised across two unrelated capability blocks (`capabilities.memory.*` and `capabilities.agents.*`) plus this prose and `AgentManifest.memoryShape`. A client building a memory console — or pre-flighting an agent — cannot answer "does this host support _write_? _search_? _forget_?" from one place, and a host that can't satisfy an agent's declared `memoryShape` degrades dispatch with no observable signal. RFC 0080 reconciles the _advertisement_ into one coherent, **additive** model: it names eight dimensions, maps each to its existing advertised source, adds the two that had none, and requires the agent inventory to surface degraded memory. No existing flag is moved, renamed, or removed.

### §A — Eight memory dimensions

| Dimension                | Meaning                                                                                                    | Advertised by (existing / **NEW**)                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **read**                 | `MemoryAdapter.list`/`get` (RFC 0004)                                                                      | `capabilities.memory.supported`                                                                                                                                                             |
| **write**                | `MemoryAdapter.put`/`delete`                                                                               | `memory.supported` ⇒ the four-op contract (RFC 0004 §A) is read+write; a **read-only** host sets **NEW** `memory.writable: false`                                                           |
| **search**               | semantic / filtered query beyond `list`                                                                    | **NEW** optional `memory.search` (`{ supported, modes?: ["semantic","filter"] }`)                                                                                                           |
| **long-term-durability** | cross-run durable store                                                                                    | `capabilities.agents.memoryBackends` includes `"long-term"`                                                                                                                                 |
| **compaction**           | RFC 0012 budgeted compaction + RFC 0062 distillation                                                       | `memory.compaction` / `memory.distillation`                                                                                                                                                 |
| **attribution**          | RFC 0057 `memory.written` provenance                                                                       | `memory.attribution`                                                                                                                                                                        |
| **replay-snapshot**      | MAE-3 deterministic read-snapshot on replay (RFC 0039/0041); consolidation outside the envelope (RFC 0068) | derived: `agents.memoryBackends: ["long-term"]` + `multiAgent.executionModel.version >= 2`                                                                                                  |
| **retention**            | TTL expiry (§TTL) + explicit forget/delete                                                                 | **NEW** optional `memory.retention` (`{ ttl?: boolean, forget?: boolean }`) — `forget: true` advertises that the host supports a tenant-scoped delete-by-subject operation (composes CTI-1) |

The dimension name **`long-term-durability`** is deliberately distinct from the `agents.memoryBackends` _value_ `"long-term"` (a backend id) so a degraded-dimension list and a backend list never collide on the wire. The `read`/`write` dimensions are gated by **`memory.supported: true`** (the RFC 0004 four-op `MemoryAdapter` flag) — this is also the field the derived `openwop-memory` profile gates on (§"Memory capability model" → `profiles.md` §`openwop-memory`). The profile derives across **two** subtrees (`capabilities.memory.*` for read/write + `capabilities.agents.memoryBackends` for durability); a validator MUST NOT look for `memoryBackends` under `memory`.

`capabilities.agents.{memoryConsolidation,commitments}` (RFC 0068) stay where they are — they are agent-runtime behaviors, not adapter dimensions — and are cross-referenced here, not relocated.

**`forget` × erasure (cross-host correctness).** `forget: true` advertises erasure **from live memory** — a forgotten entry no longer surfaces to `MemoryAdapter.get`/`list`. It is replay-stable precisely because replay re-reads the **log-recorded snapshot** (the recorded-fact event log / observable-result cache, `replay.md` §"Recorded-fact events"), not live memory — so a post-run `forget` does not alter a replay. A consequence hosts MUST understand: `forget` is **not** a full GDPR-style erasure of run history — if the run log retains a content-carrying record (e.g. a vendor `memory.written` event that carries content), that record is unaffected by `forget`. Full erasure of the event log is a host-managed audit operation outside the replay envelope and outside v1.x scope; a host advertising `forget` advertises live-memory erasure only.

### §B — Canonical query endpoint: host-internal at v1.x

`memory.supported` advertises the **host-internal `MemoryAdapter`** (RFC 0004) + the SR-1-redacted read-side a run sees — **not** a portable client query path. RFC 0080 adds **no `GET /v1/memory` endpoint**: the `MemoryAdapter` is host-internal by design, a portable cross-tenant query is a much larger surface + attack surface, and the operator/console interop need is met by the existing read-side + the §C degraded projection. A host wanting a query API exposes it under a host-extension scope (`x-host-<vendor>-memory-query`). A normative `GET /v1/memory` MAY be revisited in a future RFC; v1.x keeps memory query host-internal.

### §C — `memoryShape` enforcement + degraded projection (normative)

When a host advertises a manifest agent (RFC 0072/0074 `GET /v1/agents`) whose `AgentManifest.memoryShape` declares a dimension the host's reconciled model (§A) does NOT satisfy:

1. The host MUST surface the gap on the inventory entry via the additive optional `memoryDegraded: true` + `degradedMemoryDimensions: string[]` (the §A dimension names it can't satisfy) on `agent-inventory-response.schema.json`. Absent ⇒ memory fully satisfied; an older host that omits the fields is treated by consumers as not-degraded/unknown (they MAY probe).
2. A degraded agent MAY still dispatch at the RFC 0070 floor (degradation is permitted), but the degradation MUST be **observable** — a silent satisfied-looking inventory entry for an agent whose `longTerm: true` can't be honored is non-conformant.
3. This reuses the RFC 0072 §C `degraded[]` per-dependency-visibility philosophy, applied to the memory dimensions. `forget` (§A retention) is a host-managed mutation **outside** the replay envelope: a replayed run re-reads the log-recorded snapshot, not live memory (`replay.md` §"Recorded-fact events").

## Scheduled distillation — "dreams" (RFC 0062, `Active`)

**Why this exists.** A "dream" is a periodic background run that distills recent transactional memory into long-term artifacts under an explicit token budget, then refreshes a retrieval index the next session loads at startup. openwop already has the halves — RFC 0012 defines host-managed _compaction_ (lossy distillation + the `memory.compacted` event) and RFC 0052 defines _scheduled_ run initiation — but nothing binds them, pins a token budget, or defines the index. Distillation composes them; it does **not** invent a parallel event.

**Capability flag:** `capabilities.memory.distillation.supported: true` (nested under `memory`; see `capabilities.md` §`memory`). A host advertising it MUST honor the following contract; hosts that omit the block keep plain on-demand compaction (RFC 0012) or no memory, and the distillation conformance scenarios skip cleanly.

**Distillation run contract (normative, when `memory.distillation.supported: true`).** A distillation run — scheduled (RFC 0052 `schedule` trigger targeting the distillation handler) or on-demand — MUST:

1. **Read** the source `memoryRef`'s entries via the RFC 0004 read snapshot (deterministic input).
2. **Apply a token budget.** A `tokenBudget` (≤ advertised `maxTokenBudget`) is supplied via the `run-options.md` reserved key `distillation.tokenBudget` and clamped to `maxTokenBudget`; absent ⇒ the host MUST default to `maxTokenBudget`. The budget caps _input + output_ token accounting against the advertised `tokenizerName` (best-effort-honest, ±10% conformance tolerance). If the source cannot be meaningfully distilled within the budget, the run MUST fail with `token_budget_exceeded` (see [`rest-endpoints.md`](./rest-endpoints.md)) and write **no partial archive** (atomic).
3. **Distill** via the RFC 0012 compaction mechanism, carrying SR-1 forward — a distilled archive MUST NOT re-expose a secret the sources had redacted.
4. **Write a stable archive.** The distilled output MUST be an immutable, addressable artifact, byte-stable for a given source set + budget (reproducible + auditable).
5. **Update the memory-index manifest** when `indexEmitted: true` — a retrievable `MEMORY-INDEX.json` the next session loads at startup, stored as a workspace file (RFC 0059); updating it emits `workspace.updated`, not a bespoke index event. An optional human-editable `.md` sibling MAY accompany it; the JSON is normative.
6. **Emit the existing `memory.compacted` event** (RFC 0012) extended with the additive optional `distillation { tokenBudget, tokensUsed, indexUpdated }` sub-object. The `trigger` field stays within RFC 0012's closed enum — a scheduled distillation is `host-managed` (the host owns the schedule); its distillation nature is evident from the `distillation` sub-object, not a new `trigger` value.

Recursive distillation (distilling prior archives) is allowed; each level MUST re-check SR-1. Archives persist for the advertised `archiveRetention` (ISO-8601 duration) before GC. CTI-1 tenant isolation holds for the archive and index exactly as for any memory write.

## Background consolidation (RFC 0068, `Active`)

**Why this exists.** Distillation (RFC 0062) is a _forward funnel_ — it collapses recent _transactional_ memory into long-term artifacts under a mandatory token budget. It does not address the _standing_ problem: a long-term corpus that, over months, accumulates near-duplicate facts, superseded preferences, and contradictions. **Consolidation** is a _reconciliation_ pass _within_ long-term memory — merge duplicates, supersede stale facts, strengthen corroborated ones — and is not budget-driven. The two are semantically distinct observable behaviors; consolidation emits its own content-free `agent.memory.consolidated` event rather than reusing `memory.compacted`, so an observer can tell "I distilled today's transcript" apart from "I reconciled the standing corpus."

**Capability flag:** `capabilities.agents.memoryConsolidation.supported: true` (see `capabilities.md` §`agents`). Requires `agents.memoryBackends` to include `long-term`. Hosts that omit the block do not consolidate; the consolidation conformance scenarios skip cleanly.

**Consolidation contract (normative, when `agents.memoryConsolidation.supported: true`).** A consolidation pass MUST:

1. Operate over a single `memoryRef`'s long-term entries — a pass MUST NOT read or write entries of another tenant (CTI-1).
2. Be **idempotent over a stable corpus** — running a pass twice over an unchanged corpus MUST NOT further reduce `outputCount` (a no-op second pass). This bounds runaway consolidation and is the testable surface.
3. Route every derived/merged entry's content through the same BYOK redaction harness applied to a fresh `put` (SR-1 carry-forward) — a merged summary can introduce secret-shaped substrings not present in any source, exactly as RFC 0012 §D / RFC 0062 establish for compaction.
4. Emit `agent.memory.consolidated` with `inputCount`/`outputCount`/`memoryRef` after the pass.

Consolidation is a read-modify-write of long-term memory; it is NOT a token-budgeted distillation of transactional memory (that is RFC 0062, which emits `memory.compacted`). A host MAY implement both; they are independent capabilities. Deterministic replay (`replay.md`, RFC 0041) holds through a consolidation pass by construction: consolidation is a host-managed background mutation **outside the replay envelope** (resolved in RFC 0068 §"Unresolved questions" #1, confirmed against RFC 0041 §C observable-output-sequence determinism). A run sees consolidated memory only via the deterministic read-snapshot the event log records; `agent.memory.consolidated` is an observability event re-read from the log on replay, never regenerated — a host MUST NOT re-run a consolidation pass at replay time, and a run MUST NOT trigger a pass that mutates its own read-snapshot mid-run.

## Inferred commitments (RFC 0068, `Active`)

**Why this exists.** A long-running agent forms _standing intentions_ ("follow up next Monday", "remind me when the invoice clears") that should fire later without a fresh user turn. Scheduling (RFC 0052) and heartbeat (RFC 0060) can _fire_ an arm on a clock or a predicate, but neither models a commitment _inferred from memory_ — with the memory provenance that makes it auditable and tenant-bound. An **inferred standing commitment** is a host-derived, durable intention with a fire condition (time or predicate) and a memory provenance; when it fires it MUST be observable but content-free.

**Capability flag:** `capabilities.agents.commitments.supported: true` (see `capabilities.md` §`agents`). Hosts that omit the block do not infer commitments; the conformance scenario skips cleanly.

**Commitment contract (normative, when `agents.commitments.supported: true`).** A host:

1. MUST bind each commitment to the `memoryRef` it was inferred from; the commitment, the fired event, and any enqueued run MUST share that memory's tenant (CTI-1).
2. MUST fire each commitment **at most once per satisfied condition** — a `time` commitment fires once per scheduled instant (reusing RFC 0052's once-per-tick guarantee); a `predicate` commitment fires once per state transition (reusing RFC 0060's anti-spam semantics). A host MUST NOT re-fire a commitment on replay.
3. MUST emit `commitment.fired` (content-free) when a commitment fires, and MUST NOT place the inferred intention text or any secret-bearing payload on the event (the read-side serves it SR-1-redacted).
4. MAY enqueue a run when a commitment fires; when it does, the run inherits the source memory's tenant and the `enqueuedRunId` is reported on the event.

Both events (`agent.memory.consolidated`, `commitment.fired`) are defined in `schemas/run-event-payloads.schema.json` and are additive RunEventTypes — consumers that don't recognize them fold best-effort per `observability.md §"Forward-compat"`.

## Open spec gaps

- **Cross-host `memoryRef` portability** — v1.x silent. A `memoryRef` minted by host A is NOT guaranteed resolvable by host B; future spec amendments MAY normate a portable encoding if implementer demand surfaces.
- **`MemoryEntry.id` tenant-prefix** — recommended non-normatively for hosts that share entry-id keyspaces across tenants (e.g., `tenant-A:mem-1` rather than `mem-1`). Not hard-constrained at v1.0.
- **Authorization granularity within tenant** — silence intentional. CTI-1 is the only normative isolation surface; per-user RBAC within a tenant is host-internal.
- **Content size cap / tags cardinality cap** — host-internal.
- **Bulk-ops API** (`MemoryAdapter.listAll`, `MemoryAdapter.deleteAll`) — deferred. v1.0 read surface is per-`memoryRef` `list/get` only.
- **Per-node write attribution** — _closed by [`RFCS/0057`](../../RFCS/0057-memory-write-attribution-event.md) (Active)._ The additive, content-free `memory.written` RunEvent (capability-gated on `capabilities.memory.attribution.emitsWriteEvents`) attributes each write to the node/agent that caused it, carrying identifiers only — never entry content — so provenance is observable on the wire without reopening the SR-1 surface or replay determinism (the event records a write that already happened and is re-read from the log on replay, never regenerated). Reads remain unattributed by design.

## Reviewable learning (RFC 0096)

> **Status: Active · v1.x (RFC 0096).** Capability-gated on `capabilities.agents.proposals`. Hosts that omit the block are unchanged.

An agent improves from experience without silently mutating its own production behavior: the host MAY synthesize a **reusable artifact** — an agent pack (RFC 0003), a workflow-chain pack (RFC 0013), a prompt template (RFC 0027), or a scheduled automation (RFC 0052) — from its own run/tool traces, persist it as an inert **`Proposal`** (`schemas/proposal.schema.json`), and surface it for human review. The *synthesis algorithm* is entirely a host choice; this section pins the object, its lifecycle, the activation gate, and the inertness invariant.

A `Proposal` carries a typed `artifact` (shaped by `kind`), a `provenance.sourceRunIds` pointer, an optional `duplicateOf` signal, an `owner` (RFC 0048), and a state machine: `draft → revised → applied | rejected | archived`. Hosts advertise the supported `artifactKinds`, whether `duplicationDetection` is on, and the `activation` mode (`approval-gate` | `direct-rbac`) under `capabilities.agents.proposals`.

Normative requirements:

1. **Inertness.** A `Proposal` in any state other than `applied` **MUST NOT** influence the resolution, planning, or execution of any run. (SECURITY invariant `proposal-inert-until-applied`.)
2. **Gated activation.** `apply` **MUST** be authorized: if `activation = approval-gate`, the host **MUST** drive an RFC 0051 gate and **MUST NOT** install the artifact unless the gate is `granted` (or `overridden`, which **MUST** be audited per RFC 0009/0010); if `activation = direct-rbac`, the caller **MUST** hold the RFC 0049 scope the host advertises for activation. Activation introduces **no new authorization path** — it reuses RFC 0051/0049.
3. **No re-synthesis.** On `apply`, the installed artifact **MUST** be the exact `artifact` payload last persisted on the proposal — no silent re-synthesis at activation. (SECURITY invariant `proposal-no-resynthesis`.)
4. **Redaction.** `provenance.sourceRunIds` and `rationale` **MUST** be SR-1 redaction-safe (no secrets/PII).

The host serves the proposal surface as a host-extension under `/v1/host/sample/proposals` (`GET` list/read, `PATCH` revise, `POST .../apply|reject`, `DELETE` archive — see `host-sample-test-seams.md`), promotable to the normative `/v1/proposals` at graduation. Two additive, content-free events are emitted (gated on the capability): `proposal.created` and `proposal.activated` (`run-event-payloads.schema.json`).

## References

- `schemas/memory-entry.schema.json`
- `schemas/proposal.schema.json`
- `schemas/memory-list-options.schema.json`
- `schemas/agent-ref.schema.json` §`memoryRef`
- `capabilities.md` §`agents.memoryBackends`
- `conformance/src/scenarios/agentMemoryRoundTrip.test.ts`
- `conformance/src/scenarios/agentMemoryCrossTenantIsolation.test.ts`
- `conformance/src/scenarios/agentMemoryRedactionContract.test.ts`
- `conformance/src/scenarios/agentMemoryTtlExpiry.test.ts`

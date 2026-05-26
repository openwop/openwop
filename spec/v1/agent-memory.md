# openwop Spec v1 — Agent Memory

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

## Scheduled distillation — "dreams" (RFC 0062, `Active`)

**Why this exists.** A "dream" is a periodic background run that distills recent transactional memory into long-term artifacts under an explicit token budget, then refreshes a retrieval index the next session loads at startup. openwop already has the halves — RFC 0012 defines host-managed *compaction* (lossy distillation + the `memory.compacted` event) and RFC 0052 defines *scheduled* run initiation — but nothing binds them, pins a token budget, or defines the index. Distillation composes them; it does **not** invent a parallel event.

**Capability flag:** `capabilities.memory.distillation.supported: true` (nested under `memory`; see `capabilities.md` §`memory`). A host advertising it MUST honor the following contract; hosts that omit the block keep plain on-demand compaction (RFC 0012) or no memory, and the distillation conformance scenarios skip cleanly.

**Distillation run contract (normative, when `memory.distillation.supported: true`).** A distillation run — scheduled (RFC 0052 `schedule` trigger targeting the distillation handler) or on-demand — MUST:

1. **Read** the source `memoryRef`'s entries via the RFC 0004 read snapshot (deterministic input).
2. **Apply a token budget.** A `tokenBudget` (≤ advertised `maxTokenBudget`) is supplied via the `run-options.md` reserved key `distillation.tokenBudget` and clamped to `maxTokenBudget`; absent ⇒ the host MUST default to `maxTokenBudget`. The budget caps *input + output* token accounting against the advertised `tokenizerName` (best-effort-honest, ±10% conformance tolerance). If the source cannot be meaningfully distilled within the budget, the run MUST fail with `token_budget_exceeded` (see [`rest-endpoints.md`](./rest-endpoints.md)) and write **no partial archive** (atomic).
3. **Distill** via the RFC 0012 compaction mechanism, carrying SR-1 forward — a distilled archive MUST NOT re-expose a secret the sources had redacted.
4. **Write a stable archive.** The distilled output MUST be an immutable, addressable artifact, byte-stable for a given source set + budget (reproducible + auditable).
5. **Update the memory-index manifest** when `indexEmitted: true` — a retrievable `MEMORY-INDEX.json` the next session loads at startup, stored as a workspace file (RFC 0059); updating it emits `workspace.updated`, not a bespoke index event. An optional human-editable `.md` sibling MAY accompany it; the JSON is normative.
6. **Emit the existing `memory.compacted` event** (RFC 0012) extended with the additive optional `distillation { tokenBudget, tokensUsed, indexUpdated }` sub-object. The `trigger` field stays within RFC 0012's closed enum — a scheduled distillation is `host-managed` (the host owns the schedule); its distillation nature is evident from the `distillation` sub-object, not a new `trigger` value.

Recursive distillation (distilling prior archives) is allowed; each level MUST re-check SR-1. Archives persist for the advertised `archiveRetention` (ISO-8601 duration) before GC. CTI-1 tenant isolation holds for the archive and index exactly as for any memory write.

## Open spec gaps

- **Cross-host `memoryRef` portability** — v1.x silent. A `memoryRef` minted by host A is NOT guaranteed resolvable by host B; future spec amendments MAY normate a portable encoding if implementer demand surfaces.
- **`MemoryEntry.id` tenant-prefix** — recommended non-normatively for hosts that share entry-id keyspaces across tenants (e.g., `tenant-A:mem-1` rather than `mem-1`). Not hard-constrained at v1.0.
- **Authorization granularity within tenant** — silence intentional. CTI-1 is the only normative isolation surface; per-user RBAC within a tenant is host-internal.
- **Content size cap / tags cardinality cap** — host-internal.
- **Bulk-ops API** (`MemoryAdapter.listAll`, `MemoryAdapter.deleteAll`) — deferred. v1.0 read surface is per-`memoryRef` `list/get` only.
- **Per-node write attribution** — *closed by [`RFCS/0057`](../../RFCS/0057-memory-write-attribution-event.md) (Active).* The additive, content-free `memory.written` RunEvent (capability-gated on `capabilities.memory.attribution.emitsWriteEvents`) attributes each write to the node/agent that caused it, carrying identifiers only — never entry content — so provenance is observable on the wire without reopening the SR-1 surface or replay determinism (the event records a write that already happened and is re-read from the log on replay, never regenerated). Reads remain unattributed by design.

## References

- `schemas/memory-entry.schema.json`
- `schemas/memory-list-options.schema.json`
- `schemas/agent-ref.schema.json` §`memoryRef`
- `capabilities.md` §`agents.memoryBackends`
- `conformance/src/scenarios/agentMemoryRoundTrip.test.ts`
- `conformance/src/scenarios/agentMemoryCrossTenantIsolation.test.ts`
- `conformance/src/scenarios/agentMemoryRedactionContract.test.ts`
- `conformance/src/scenarios/agentMemoryTtlExpiry.test.ts`

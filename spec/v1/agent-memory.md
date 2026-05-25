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

## Open spec gaps

- **Cross-host `memoryRef` portability** — v1.x silent. A `memoryRef` minted by host A is NOT guaranteed resolvable by host B; future spec amendments MAY normate a portable encoding if implementer demand surfaces.
- **`MemoryEntry.id` tenant-prefix** — recommended non-normatively for hosts that share entry-id keyspaces across tenants (e.g., `tenant-A:mem-1` rather than `mem-1`). Not hard-constrained at v1.0.
- **Authorization granularity within tenant** — silence intentional. CTI-1 is the only normative isolation surface; per-user RBAC within a tenant is host-internal.
- **Content size cap / tags cardinality cap** — host-internal.
- **Bulk-ops API** (`MemoryAdapter.listAll`, `MemoryAdapter.deleteAll`) — deferred. v1.0 read surface is per-`memoryRef` `list/get` only.
- **Per-node write attribution** — the event log carries no signal for *which node wrote which entry* (memory access is kept internal to nodes by design, for replay determinism). An additive, content-free `memory.written` RunEvent is proposed in [`RFCS/0057`](../../RFCS/0057-memory-write-attribution-event.md) (capability-gated `memory.attribution`), making provenance observable without exposing entry content.

## References

- `schemas/memory-entry.schema.json`
- `schemas/memory-list-options.schema.json`
- `schemas/agent-ref.schema.json` §`memoryRef`
- `capabilities.md` §`agents.memoryBackends`
- `conformance/src/scenarios/agentMemoryRoundTrip.test.ts`
- `conformance/src/scenarios/agentMemoryCrossTenantIsolation.test.ts`
- `conformance/src/scenarios/agentMemoryRedactionContract.test.ts`
- `conformance/src/scenarios/agentMemoryTtlExpiry.test.ts`

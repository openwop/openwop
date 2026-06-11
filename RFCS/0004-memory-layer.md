# RFC 0004: Memory Layer

| Field             | Value                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0004                                                                                                                                                                                      |
| **Title**         | Memory Layer                                                                                                                                                                              |
| **Status**        | `Accepted`                                                                                                                                                                                |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                            |
| **Created**       | 2026-05-01                                                                                                                                                                                |
| **Updated**       | 2026-05-11 (Active → Accepted: integration-seams audit closed via `docs/MULTI-AGENT-INTEGRATION-GAPS.md` archive; conformance scenarios pass against SQLite reference host)               |
| **Affects**       | `schemas/memory-entry.schema.json`, `schemas/memory-list-options.schema.json`, `schemas/agent-manifest.schema.json`, `spec/v1/capabilities.md`, `SECURITY/threat-model-secret-leakage.md` |
| **Compatibility** | `additive`                                                                                                                                                                                |
| **Supersedes**    | —                                                                                                                                                                                         |
| **Superseded by** | —                                                                                                                                                                                         |

## Summary

Define a host-side `MemoryAdapter` interface for cross-run agent memory persistence: `list`, `get`, `put`, `delete`. Memory entries carry redaction guarantees that compose with BYOK secret handling. The protocol contract is the wire shape (`MemoryEntry`, `MemoryListOptions`) and the determinism-preserving read-path semantics; the storage backend is a host choice.

## Motivation

RFC 0002 declares `AgentRef.memoryRef` as an opaque handle for cross-run memory but doesn't specify how the handle resolves. Three categories of host need a portable contract:

1. **Multi-agent debuggers** that want to read what an agent remembered between runs.
2. **A2A peers** that want to share long-term agent context across organizations.
3. **Replay machinery** that must read memory at the same logical point on every replay or replays diverge non-deterministically.

The right protocol contract is _narrow_: read-path semantics and a redaction invariant. Storage shape (Redis, Postgres, Firestore, in-memory) and write-path policy (write-through, write-back, batched) remain host choices. The protocol does not prescribe an embedding model, retrieval ranking, or vector index — those are application-layer concerns.

## Proposal

### §A `MemoryAdapter` interface

Hosts that advertise `capabilities.agents.memoryBackends` MUST expose a `MemoryAdapter` with four operations. The operations are described in spec terms; SDKs MAY name them differently.

#### `list(memoryRef, options): MemoryEntry[]`

Returns memory entries visible to the run, ordered newest-first by `createdAt`.

**Replay determinism rule (normative).** Within a single run, `list` MUST return the snapshot of entries visible _at run start_. Mid-run mutations to the underlying store (by other runs, by direct admin writes) MUST NOT be visible to the calling run. Hosts implement this by:

- Capturing a logical timestamp / snapshot id at run start.
- Filtering subsequent `list` results to entries whose `createdAt ≤ snapshot.t`.

This rule preserves replay: a replay re-issues `list` and gets the same set of entries it did on first execution.

Inputs:

- `memoryRef`: opaque string (from `AgentRef.memoryRef`). Hosts resolve to a logical memory scope (tenant + agent + namespace).
- `options`: `MemoryListOptions` (`limit`, `tag`).

Output: `MemoryEntry[]` (per `memory-entry.schema.json`).

#### `get(memoryRef, id): MemoryEntry | null`

Returns a single entry by id. Same snapshot rule as `list`. Returns `null` if the entry does not exist _or_ was created after the run's snapshot timestamp.

#### `put(memoryRef, entry): MemoryEntry`

Writes a new entry. Returns the persisted entry with host-assigned `id` and `createdAt`.

**Write-time redaction (normative, see §D).** Hosts MUST run the BYOK redaction harness over `entry.content` and `entry.tags` before persisting. If a redaction rule fires, the entry is either rewritten with secrets replaced by `<REDACTED:label>` markers or the write fails with `secret_leakage` error envelope. Host policy chooses; both options MUST be documented.

#### `delete(memoryRef, id): boolean`

Deletes an entry by id. Returns `true` if the entry existed and was deleted, `false` otherwise.

Deletes are visible to _future_ runs immediately; the calling run's snapshot is unchanged (deleting an entry mid-run does not retroactively remove it from `list` results within the same run).

### §B Capability advertisement

Hosts advertise memory support via `/.well-known/openwop`:

```json
{
  "capabilities": {
    "agents": {
      "memoryBackends": ["scratchpad", "conversation", "longTerm"]
    },
    "memory": {
      "supported": true,
      "maxEntrySizeBytes": 65536,
      "ttlSupported": true
    }
  }
}
```

Three normative backend names:

- `scratchpad` — per-task ephemeral notes, evicted on goal completion. Host-managed.
- `conversation` — per-run dialogue scope; lives within the run's conversation channel (RFC 0005).
- `longTerm` — cross-run persistence; the `MemoryAdapter` contract above applies.

Hosts MAY advertise additional backends under `vendor.<host>.<name>` per `host-extensions.md`.

### §C `memoryRef` opaque handle

`memoryRef` is a host-issued opaque string. The spec does not constrain its shape; common patterns:

- `mem_<tenantId>_<agentId>_<scope>` — namespaced and tenant-isolated.
- A URN: `urn:openwop:memory:<host>:<id>`.

Clients MUST treat `memoryRef` as opaque and MUST NOT parse it. Hosts MAY rotate the encoding without breaking clients.

`memoryRef` values from one host are not valid on another host; A2A composition relies on host-side resolution at each peer.

### §D Redaction invariant (SR-1)

The Secret Redaction invariant **SR-1** (named to align with `SECURITY/invariants.yaml`):

> **SR-1.** Content reaching `MemoryEntry.content` or `MemoryEntry.tags` MUST NOT contain plaintext secret values that flowed through the run's BYOK harness. Hosts MUST apply the redaction harness at `put` time. Reads MUST NOT post-process to leak — what was persisted is what is returned.

Hosts that cannot guarantee SR-1 (e.g., because they do not implement a BYOK redaction harness) MUST NOT advertise `capabilities.agents.memoryBackends: ["longTerm"]`. They MAY still advertise `scratchpad` and `conversation` if those backends are scoped to the run lifecycle and do not survive a run terminal.

### §E TTL semantics

Memory entries MAY carry `expiresAt`. After the host's wall clock passes `expiresAt`:

- `list` and `get` MUST NOT return the entry.
- Hosts MAY delete the entry from the underlying store; the protocol does not require GC.
- Pending writes with `expiresAt` in the past MUST be rejected with `validation_error`.

`expiresAt` is observable: clients that wrote an entry can determine when it will expire. Hosts MAY adjust their internal TTL for storage efficiency but MUST NOT extend the protocol-visible `expiresAt`.

### §F Authorization

Memory operations execute under the same tenant-isolation rules as the parent run (`auth.md` §"Tenant isolation"). A run with tenant `t1` MUST NOT read or write memory whose `memoryRef` resolves to tenant `t2`. Cross-tenant memory sharing is out of scope for v1.

### §G Tag conventions

Tags are free-form, but hosts SHOULD use a `source:` prefix to surface the entry's provenance (e.g., `source:session`, `source:document-upload`). Future minors MAY normate a small set of `openwop.*` reserved tag prefixes for cross-host catalog use.

Empty-string tags are tolerated by the schema (matches reference behavior) but hosts SHOULD filter them at write time.

## Compatibility

**Additive.**

- The `MemoryAdapter` interface is new. Hosts that don't advertise `capabilities.agents.memoryBackends` are not required to implement it.
- The `MemoryEntry` and `MemoryListOptions` schemas already ship in v1; this RFC binds them to a contract.
- The `memoryRef` field on `AgentRef` is optional (RFC 0002 §A).
- SR-1 is a new normative invariant but applies only at the boundary where memory is written; existing runs that don't write memory are unaffected.

Hosts that pre-RFC-0004 surfaced memory under vendor extensions SHOULD migrate to the `MemoryAdapter` contract; the vendor surface MAY remain as a synonym during a deprecation window.

## Conformance

Existing scenarios that touch the surface:

- `conformance/src/scenarios/redaction.test.ts` — verifies BYOK redaction at read paths.
- `conformance/src/scenarios/redactionAdversarial.test.ts` — verifies redaction holds against adversarial inputs.

New scenarios required for `Accepted`:

- `memory-list-snapshot.test.ts` — verify `list` returns the run-start snapshot; mid-run external writes are invisible.
- `memory-put-redaction.test.ts` — verify SR-1: writing a known secret value through `put` results in a redacted entry (or `secret_leakage` failure).
- `memory-ttl-expiry.test.ts` — verify entries past `expiresAt` are not returned.
- `memory-tenant-isolation.test.ts` — verify cross-tenant reads/writes fail with `forbidden`.

All gated on `capabilities.agents.memoryBackends: ["longTerm"]` advertisement.

## Alternatives considered

1. **Embed memory in the event log.** Rejected: event logs are append-only and per-run. Cross-run continuity needs a separate substrate.
2. **Mandate a vector index.** Rejected: every host has a different RAG stack. The protocol contract is the read/write semantics, not the retrieval algorithm.
3. **Require strict consistency on `list`.** Rejected: would require synchronous global ordering. The snapshot-at-run-start rule is cheaper and still replay-deterministic.
4. **Treat memory as a channel.** Considered for conversation/scratchpad. Adopted for `conversation` (RFC 0005) where memory is per-run; rejected for `longTerm` because cross-run memory outlives any single channel.

## Unresolved questions

1. Should `memoryRef` shape be normated for cross-host portability (e.g., URN form)? Current default: opaque. A2A composition may force a normative shape later.
2. Should `list` support cursor-based pagination beyond `limit`? Deferred to v1.2.
3. Should hosts be allowed to attach signed provenance to memory entries (so cross-tenant federation is auditable)? Deferred until cross-tenant sharing is in scope.

## Implementation notes (non-normative)

- Reference TypeScript host uses a Firestore-backed adapter; the snapshot rule is implemented via a `createdAt ≤ runStartTimestamp` query predicate.
- In-memory reference host uses an immutable snapshot map captured at run start; mutations rebuild the map for future runs.
- The redaction harness shares code with `debug-bundle` redaction (`spec/v1/debug-bundle.md` §Redaction).

## Acceptance criteria

- [ ] Spec text merged.
- [x] `memory-entry.schema.json` published.
- [x] `memory-list-options.schema.json` published.
- [ ] `capabilities.md` updated with `capabilities.memory.*` advertisement.
- [ ] Four conformance scenarios.
- [ ] CHANGELOG entry.
- [ ] Reference host (in-memory + SQLite) implements `MemoryAdapter` and passes the four scenarios.

## References

- `schemas/memory-entry.schema.json`
- `schemas/memory-list-options.schema.json`
- `schemas/agent-manifest.schema.json` (§memoryShape)
- `SECURITY/threat-model-secret-leakage.md`
- `SECURITY/invariants.yaml` (SR-1)
- RFC 0002 (Agent Identity — `AgentRef.memoryRef`), RFC 0003 (Agent Packs — pack-level capability advertisement)

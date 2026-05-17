# RFC 0015: host.kvStorage capability

| Field | Value |
|---|---|
| **RFC** | 0015 |
| **Title** | host.kvStorage key-value capability |
| **Status** | `Active` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-17 |
| **Updated** | 2026-05-17 |
| **Affects** | `spec/v1/host-capabilities.md` · `schemas/capabilities.schema.json` · `SECURITY/invariants.yaml` (cross-tenant) · new conformance scenarios |
| **Compatibility** | `additive` |

## Summary

Adds an optional `host.kvStorage` capability — a TTL-aware key-value store with atomic increment + compare-and-swap primitives. Required by `core.openwop.storage`'s kv-* nodes. The Make-Data-Store equivalent for openwop.

## Motivation

Workflows need cross-run state. Today every pack invents its own external store (Redis client, Postgres table, S3 prefix), each with a different cross-tenant isolation bug. A single capability with a single SECURITY invariant for cross-tenant isolation is the leverage point.

## Proposal

### §A Capability schema addition

```json
{
  "kvStorage": {
    "type": "object",
    "description": "Key-value store with TTL + atomic ops. Per-tenant isolation enforced by the host.",
    "properties": {
      "supported": { "type": "boolean" },
      "maxKeyBytes": { "type": "integer", "minimum": 0 },
      "maxValueBytes": { "type": "integer", "minimum": 0 },
      "maxTtlSeconds": { "type": "integer", "minimum": 0 },
      "atomicIncrement": { "type": "boolean" },
      "compareAndSwap": { "type": "boolean" }
    },
    "additionalProperties": false
  }
}
```

### §B Host-contract MUSTs

A host advertising `kvStorage.supported: true` MUST:

1. Partition values by tenant. A `get` for one tenant MUST NOT return values from another tenant, even with identical keys.
2. Enforce `maxKeyBytes` and `maxValueBytes` advertised values.
3. Honor TTL with at most a 1-second drift on expiry visibility.
4. If `atomicIncrement: true` is advertised, increments MUST be atomic across concurrent callers.
5. If `compareAndSwap: true` is advertised, CAS MUST be atomic (no read-modify-write races).

### §C SECURITY invariant

```yaml
- id: kv-cross-tenant-isolation
  tier: protocol
  summary: "host.kvStorage MUST partition values by tenant. Cross-tenant reads MUST return not-found."
  conformance_test: "kv-cross-tenant-isolation.test.ts"
```

Mirrors the existing `agentMemoryCrossTenantIsolation` invariant.

### §D Conformance

- `kv-cross-tenant-isolation.test.ts`: set under tenant A, get under tenant B → not found.
- `kv-atomic-increment.test.ts`: 1000 concurrent +1s → final value is 1000.
- `kv-cas.test.ts`: stale expect rejected.
- `kv-ttl-expiry.test.ts`: TTL honored within 1s drift.

## Compatibility

**Additive**. Optional capability; `core.openwop.storage` kv-* nodes refuse registration on hosts that don't advertise it.

## Implementation notes (non-normative)

- Schema diff in §A lands in `schemas/capabilities.schema.json` on Active promotion, not at Draft.
- SECURITY invariant `kv-cross-tenant-isolation` lands in `SECURITY/invariants.yaml` alongside the matching scenario; mirrors the existing `agent-memory-cti-1` pattern.
- Reference impl candidate: in-memory Map per tenant in `examples/hosts/in-memory/`.

## Acceptance criteria

- [ ] Capability block.
- [ ] `host-capabilities.md` §host.kvStorage section.
- [ ] Invariant + 4 scenarios.
- [ ] In-memory reference host implementation.
- [ ] CHANGELOG entry.

## References

- Make Data Store (prior art).
- `agentMemoryCrossTenantIsolation` (existing isolation pattern).
- `core.openwop.storage` pack.

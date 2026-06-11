# RFC 0016: host.tableStorage capability

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0016                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Title**         | host.tableStorage structured record store                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Author(s)**     | OpenWOP Working Group                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Created**       | 2026-05-17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Updated**       | 2026-05-18 (Active → Accepted: all 4 acceptance-criteria items satisfied. `capabilities.tableStorage` block in schema; `spec/v1/host-capabilities.md §host.tableStorage` landed at commit c5831fe; SECURITY invariant `table-cross-tenant-isolation` added at commit c5831fe; 3 scenarios (`table-cross-tenant-isolation`, `table-cursor-pagination`, `table-schema-enforcement`) all behavioral; reference impl advertised in `routes/discovery.ts` lines 185–192; CHANGELOG entry under `[Unreleased]`.) |
| **Affects**       | `spec/v1/host-capabilities.md` · `schemas/capabilities.schema.json` · `SECURITY/invariants.yaml`                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Summary

Adds an optional `host.tableStorage` capability — a structured-record store with user-defined schemas, query, and count. Sibling to `host.kvStorage` (RFC 0015) for cases where workflows want column-typed records (Make Data Store with a Data Structure).

## Motivation

`host.kvStorage` covers opaque-value cases. Many workflows need typed columns (e.g., logging conversation turns, persisting form submissions, cross-run dedupe by a primary key). Building this as a sibling capability keeps both surfaces simple and lets hosts back them with different stores (Redis for kv, Postgres/SQLite for table).

## Proposal

### §A Capability schema

```json
{
  "tableStorage": {
    "type": "object",
    "properties": {
      "supported": { "type": "boolean" },
      "maxRowsPerTable": { "type": "integer" },
      "maxColumnsPerRow": { "type": "integer" },
      "indexable": { "type": "boolean", "description": "Host supports declarative indexes on columns." },
      "fullTextSearch": { "type": "boolean" }
    },
    "additionalProperties": false
  }
}
```

### §B Host-contract MUSTs

1. Cross-tenant isolation (mirrors RFC 0015 invariant).
2. Schema declaration on first `insert` to a table; subsequent rows MUST conform.
3. `query` MUST support filter + cursor pagination.

### §C Conformance

- `table-cross-tenant-isolation.test.ts`.
- `table-cursor-pagination.test.ts`.
- `table-schema-enforcement.test.ts` (wrong-type insert rejected).

## Compatibility

**Additive**. Optional. `core.openwop.storage` table-\* nodes refuse registration without advertisement.

## Implementation notes (non-normative)

- Schema diff in §A lands in `schemas/capabilities.schema.json` on Active promotion, not at Draft.
- Cross-tenant invariant row lands in `SECURITY/invariants.yaml` alongside `table-cross-tenant-isolation.test.ts`.
- Reference impl candidate: sqlite-backed table store in `examples/hosts/sqlite/`.

## Acceptance criteria

- [x] Capability block.
- [x] Prose section. (Landed at commit c5831fe.)
- [x] 3 conformance scenarios.
- [x] CHANGELOG entry.

## References

- Make Data Store + Data Structure (prior art).
- RFC 0015 host.kvStorage (sibling).

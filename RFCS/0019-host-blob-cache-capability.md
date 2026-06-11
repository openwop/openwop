# RFC 0019: host.blobStorage + host.cache capabilities

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0019                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Title**         | Blob storage + TTL cache capabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Author(s)**     | OpenWOP Working Group                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Created**       | 2026-05-17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Updated**       | 2026-05-18 (Active → Accepted: all 5 acceptance-criteria items satisfied. 2 capability blocks (`blobStorage`, `cache`) in schema; 2 prose sections (§host.blobStorage / §host.cache) in `spec/v1/host-capabilities.md` landed at commit c5831fe; 2 SECURITY invariants (`blob-cross-tenant-isolation`, `cache-cross-tenant-isolation`) added at commit c5831fe; 5 scenarios (`blob-roundtrip`, `blob-presign-expiry`, `blob-cross-tenant-isolation`, `cache-ttl-expiry`, `cache-cross-tenant-isolation`) all behavioral; reference impls advertised in `routes/discovery.ts` lines 211–222; CHANGELOG entry under `[Unreleased]`.) |
| **Affects**       | `spec/v1/host-capabilities.md` · `schemas/capabilities.schema.json` · `SECURITY/invariants.yaml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Summary

Adds two sibling capabilities: `host.blobStorage` (binary artifact store with presigned URLs) and `host.cache` (TTL cache for HTTP / AI response memoization). Required by `core.openwop.storage`'s blob-_and cache-_ nodes.

## Motivation

Workflow editors universally surface object storage (S3 / GCS / Azure Blob) and HTTP response caching as discoverable primitives. The two are small enough and similar enough in shape to share an RFC. `host.cache` is what lets idempotency-key based replay deduplicate identical AI calls across runs without engaging the heavier Layer-2 invocation log.

## Proposal

### §A Capability schemas

```json
{
  "blobStorage": {
    "type": "object",
    "properties": {
      "supported": { "type": "boolean" },
      "buckets": { "type": "array" },
      "presignSupported": { "type": "boolean" },
      "maxObjectBytes": { "type": "integer" }
    },
    "additionalProperties": false
  },
  "cache": {
    "type": "object",
    "properties": {
      "supported": { "type": "boolean" },
      "maxValueBytes": { "type": "integer" },
      "maxTtlSeconds": { "type": "integer" }
    },
    "additionalProperties": false
  }
}
```

### §B Host-contract MUSTs

1. **Blob**: cross-tenant isolation per bucket. Presigned URLs MUST expire at the advertised TTL.
2. **Cache**: TTL drift ≤ 1s on expiry visibility; entries scoped per tenant.

### §C Conformance

- `blob-roundtrip.test.ts`.
- `blob-presign-expiry.test.ts`.
- `blob-cross-tenant-isolation.test.ts`.
- `cache-ttl-expiry.test.ts`.
- `cache-cross-tenant-isolation.test.ts`.

## Compatibility

**Additive**. Two optional blocks. Packs refuse registration without advertisement.

## Implementation notes (non-normative)

- Schema diffs in §A land in `schemas/capabilities.schema.json` on Active promotion, not at Draft.
- Cross-tenant invariants for `blob-cross-tenant-isolation` + `cache-cross-tenant-isolation` land in `SECURITY/invariants.yaml` alongside the matching scenarios.
- Reference impl candidate: per-tenant Map for cache; per-tenant Map<bucket, Map<key,buffer>> for blob — both under `examples/hosts/in-memory/`.

## Acceptance criteria

- [x] Two capability blocks.
- [x] Prose section per block. (Landed at commit c5831fe.)
- [x] 5 conformance scenarios.
- [x] In-memory reference (per-tenant Map for cache; per-tenant Map<bucket, Map<key,buffer>> for blob).
- [x] CHANGELOG entry.

## References

- AWS S3 / GCS / Azure Blob (prior art for blob).
- HTTP `Cache-Control` / `ETag` semantics (prior art for cache).
- `core.openwop.storage` pack.

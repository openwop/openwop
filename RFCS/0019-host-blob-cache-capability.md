# RFC 0019: host.blobStorage + host.cache capabilities

| Field | Value |
|---|---|
| **RFC** | 0019 |
| **Title** | Blob storage + TTL cache capabilities |
| **Status** | `Active` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-17 |
| **Updated** | 2026-05-17 |
| **Affects** | `spec/v1/host-capabilities.md` · `schemas/capabilities.schema.json` · `SECURITY/invariants.yaml` |
| **Compatibility** | `additive` |

## Summary

Adds two sibling capabilities: `host.blobStorage` (binary artifact store with presigned URLs) and `host.cache` (TTL cache for HTTP / AI response memoization). Required by `core.openwop.storage`'s blob-* and cache-* nodes.

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

- [ ] Two capability blocks.
- [ ] Prose section per block.
- [ ] 5 conformance scenarios.
- [ ] In-memory reference (per-tenant Map for cache; per-tenant Map<bucket, Map<key,buffer>> for blob).
- [ ] CHANGELOG entry.

## References

- AWS S3 / GCS / Azure Blob (prior art for blob).
- HTTP `Cache-Control` / `ETag` semantics (prior art for cache).
- `core.openwop.storage` pack.

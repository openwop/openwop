# RFC 0014: host.fs capability

| Field | Value |
|---|---|
| **RFC** | 0014 |
| **Title** | host.fs filesystem capability |
| **Status** | `Accepted` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-17 |
| **Updated** | 2026-05-18 (Active → Accepted: all 6 acceptance-criteria items satisfied. `capabilities.fs` block in `schemas/capabilities.schema.json`; `spec/v1/host-capabilities.md §host.fs` landed at commit c5831fe; SECURITY invariant `fs-path-traversal` in `SECURITY/invariants.yaml` line 878; `conformance/src/scenarios/fs-path-traversal.test.ts` (3 assertions, behavioral); reference impl in `apps/workflow-engine/backend/typescript/src/host/inMemorySurfaces.ts` advertised in `routes/discovery.ts` lines 162–174; CHANGELOG entry under `[Unreleased]`.) |
| **Affects** | `spec/v1/host-capabilities.md` · `schemas/capabilities.schema.json` · `SECURITY/invariants.yaml` · new conformance scenarios for path-traversal and sandbox-root |
| **Compatibility** | `additive` |

## Summary

Adds an optional `host.fs` capability so workflows can read, write, list, stat, and delete files via the host. Required by `core.openwop.files`. Hosts MUST enforce a configured sandbox root + path-traversal protection per a new SECURITY invariant (`fs-path-traversal`).

## Motivation

Make.com Data Store + n8n Read/Write Binary File are first-class primitives in every comparable workflow editor. openwop today provides no filesystem surface at all, forcing pack authors to roll their own — which means every pack has a different bug surface for `../` escapes, symlink races, and permission misconfiguration. Hoisting this to the host puts a single SECURITY invariant on it.

## Proposal

### §A `capabilities.schema.json` additions

```diff
   "properties": {
+    "fs": {
+      "type": "object",
+      "description": "Filesystem capability — read/write/list/stat/delete inside a sandbox root.",
+      "properties": {
+        "supported": { "type": "boolean", "description": "Host advertises ctx.fs.{read,write,delete,stat,list}." },
+        "sandboxRoot": { "type": "string", "description": "Absolute path; all operations resolved relative to this root." },
+        "maxFileSizeBytes": { "type": "integer", "minimum": 0 },
+        "image": { "type": "object", "properties": { "supported": { "type": "boolean" }, "formats": { "type": "array", "items": { "type": "string", "enum": ["jpeg","png","webp","avif","gif"] } } } },
+        "pdf": { "type": "object", "properties": { "supported": { "type": "boolean" } } },
+        "transport": { "type": "object", "properties": { "ftp": { "type": "boolean" }, "sftp": { "type": "boolean" }, "ssh": { "type": "boolean" } } }
+      },
+      "additionalProperties": false
+    }
   }
```

### §B Host-contract MUSTs (added to `host-capabilities.md`)

A host advertising `fs.supported: true` MUST:

1. Resolve every `path` input relative to `sandboxRoot`. Absolute paths outside the root MUST return `path_outside_sandbox` error.
2. Reject any path that, after normalization, contains a `..` segment that escapes the root. Symlinks that point outside MUST be rejected.
3. Enforce `maxFileSizeBytes` on write. Reads of larger files MAY return `file_too_large` rather than streaming.
4. Return a typed error envelope on permission denial (`fs_permission_denied`).

### §C SECURITY invariant

```yaml
- id: fs-path-traversal
  tier: protocol
  summary: "host.fs MUST reject path traversal (`../`) and symlink-escape attempts."
  conformance_test: "fs-path-traversal.test.ts"
```

### §D Conformance

New scenario `fs-path-traversal.test.ts` asserts:
- `read("../etc/passwd")` returns `path_outside_sandbox`.
- `read(symlink-to-outside)` returns `path_outside_sandbox`.
- `write(huge-file)` returns `file_too_large` when `maxFileSizeBytes` is advertised.

Gated on `capabilities.fs.supported`.

## Compatibility

**Additive**. New optional capability block. Existing hosts without `fs.supported` ignore the block; `core.openwop.files` refuses to register on them (peerDependency `fs: 'supported'`).

## Conformance

- New scenario: `fs-path-traversal.test.ts` (capability-gated).
- Existing `http-client-ssrf.test.ts` is the model.
- Reference host: `examples/hosts/in-memory/` adds an in-memory virtual filesystem so the scenario can run without touching the real disk.

## Alternatives considered

1. **Defer fs to vendor packs.** Rejected: every pack inventing its own sandboxing reproduces the same bugs. A single SECURITY invariant on `host.fs` is the leverage point.
2. **Bake fs into the engine baseline.** Rejected: many hosts (especially edge-deployed ones) deliberately have no fs surface. Capability-gating preserves that posture.

## Unresolved questions

1. Should `sandboxRoot` support multiple roots (per-tenant)? Defer to v1.2 if real demand surfaces.

## Implementation notes (non-normative)

- Schema diff in §A lands in `schemas/capabilities.schema.json` on Active promotion, not at Draft.
- SECURITY invariant row in §C lands in `SECURITY/invariants.yaml` alongside the matching `fs-path-traversal.test.ts`; `scripts/check-security-invariants.sh` would fail otherwise.
- Reference impl candidate: extend `examples/hosts/in-memory/` with a virtual-fs adapter so the scenarios run without touching the real disk.

## Acceptance criteria

- [x] Capability block in `capabilities.schema.json`.
- [x] `host-capabilities.md` §host.fs section. (Landed at commit c5831fe.)
- [x] SECURITY invariant `fs-path-traversal` in `SECURITY/invariants.yaml`.
- [x] `fs-path-traversal.test.ts` conformance scenario.
- [x] Reference host in-memory fs implementation.
- [x] CHANGELOG entry under `[Unreleased]`.

## References

- `core.openwop.files` pack (this RFC unblocks public publication).
- `http-client-ssrf.test.ts` (template for path-traversal scenario).
- Make Data Store, n8n Read/Write Files (prior art).

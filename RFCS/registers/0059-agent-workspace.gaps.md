# RFC 0059 — Gap Register

Companion to [`RFCS/0059-agent-workspace.md`](../0059-agent-workspace.md). Verdict from the reconciliation audit: **clean-composes** (distinct from fs/blob/kv/table/cache; correctly uses RFC 0048 identity + RFC 0057 attribution pattern).

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | §B `path` | Flat namespace with `/`-in-names vs. true nested directories with prefix `list`. Proposed flat-with-slashes for v1. | Spec Architect | Decision before Active. | Schema finalization |
| G2 | §A | Version retention when `versioned: true` — how many historical versions must persist? Proposed advertise `maxVersions`; latest mandatory, history best-effort. | Spec Architect | Decision before Active. | Active |
| G3 | §D / RFC 0062 | Memory-index manifest as a workspace file (`MEMORY-INDEX.json`) — confirm coupling + path naming with RFC 0062. | Spec Architect | Joint resolution with 0062 (both Draft). | Active |
| G4 | Impl | `apps/workflow-engine` `RunRecord` doesn't populate the RFC 0048 `owner.workspace` triple yet; workspace storage needs it. Sequence after the owner-triple is populated. | Implementer | Wire RFC 0048 owner triple first. | Accepted |
| G5 | §C | New `WorkspaceAdapter` host-interface contract belongs in `storage-adapters.md`; adapter authors must be notified. | Spec Architect | Add adapter doc at implementation. | Accepted |

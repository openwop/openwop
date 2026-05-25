# RFC 0059: Agent workspace (`host.workspace`)

| Field | Value |
|---|---|
| **RFC** | 0059 |
| **Title** | A `host.workspace` capability — a versioned, atomic, tenant·workspace-scoped file store for an agent's persistent *ground-truth* artifacts (identity / directives / memory-index), loaded as a read snapshot at run start, complementing the transactional `MemoryAdapter` (RFC 0004) with a durable file layer |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `schemas/capabilities.schema.json` (`host.workspace` block) · new `schemas/workspace-file.schema.json` · `api/openapi.yaml` (workspace file endpoints) · `api/asyncapi.yaml` (`workspace.updated` event) · new `spec/v1/agent-workspace.md` · `spec/v1/profiles.md` (predicate) · `RFCS/0048` (identity triple this scopes to) · new conformance scenarios · proposed SECURITY invariant `workspace-cross-tenant-isolation` (lands at implementation) |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Autonomous agents in the wider industry (Claude Code, OpenClaw) keep persistent *ground-truth* files — identity, standing directives, a memory index — that are loaded at the start of every session and treated as authoritative. openwop has no such surface: `MemoryAdapter` (RFC 0004) is a transactional entry store, not a named, versioned, editable file. This RFC adds an additive `host.workspace` capability: a tenant·workspace-scoped (RFC 0048) file store with atomic, optimistically-concurrent writes (`If-Match` ETag), a `workspace.updated` attribution event, and a read snapshot exposed to every run as `ctx.workspace`. It expands openwop's architecture by adding a *durable file layer* alongside the *transactional memory layer*, without coupling the two.

## Motivation

The proposed autonomous-agent feature set names `SOUL.md` / `IDENTITY.md` / `AGENTS.md` style "workspace files… mounted/loaded at session start; the agent uses them as ground truth." Today an openwop agent must smuggle this into either memory entries (wrong shape — entries are append-mostly, untyped, not addressable by path) or `configurable` (run-scoped, not persistent). Neither is versioned, neither is atomically editable by a human operator between runs, and neither is discoverable by sub-agents (RFC 0007 dispatch) the way a shared ground-truth file must be.

The spec is the right place because "what file does the agent treat as authoritative, and what version of it did this run see" is a cross-host portability and replay-determinism guarantee — a run replayed on another host must observe the same workspace snapshot — not an implementation detail.

## Proposal

### §A — `capabilities.schema.json`: `workspace` block (additive)

Per the corpus convention every host capability is a **flat `capabilities.<name>` sibling** (`feedback`, `deadLetter`, `oauth`, …) — there is no nested `capabilities.host` object — so the block is `capabilities.workspace` (the prose name "host.workspace" is the conceptual label, mirroring "host.feedback"/etc.):

```diff
   "properties": {
+    "workspace": {
+      "type": "object",
+      "description": "RFC 0059. Versioned, tenant·workspace-scoped ground-truth file store. Scopes to the RFC 0048 owner triple.",
+      "required": ["supported"],
+      "additionalProperties": false,
+      "properties": {
+        "supported": { "type": "boolean" },
+        "versioned": { "type": "boolean", "description": "Each write bumps a monotonic version; prior versions are retrievable." },
+        "maxFileBytes": { "type": "integer", "minimum": 1, "description": "Per-file byte ceiling; writes beyond it return `workspace_too_large`." },
+        "maxFiles": { "type": "integer", "minimum": 1, "description": "Per-workspace file-count ceiling." },
+        "maxVersions": { "type": "integer", "minimum": 1, "description": "When `versioned`, retained historical versions (latest always retained)." }
+      }
+    }
   }
```

### §B — `workspace-file.schema.json` (new)

```json
{
  "$id": "https://openwop.dev/spec/v1/workspace-file.schema.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["path", "content", "version", "updatedAt"],
  "properties": {
    "path": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$",
              "description": "Workspace-relative path. No `..`, no leading `/`." },
    "content": { "type": "string", "description": "UTF-8 file body." },
    "contentType": { "type": "string", "default": "text/markdown" },
    "version": { "type": "integer", "minimum": 1 },
    "etag": { "type": "string", "description": "Opaque version token for If-Match concurrency." },
    "updatedAt": { "type": "string", "format": "date-time" }
  }
}
```

### §C — endpoints (`openapi.yaml`, gated on `host.workspace.supported`)

| Method · path | Behavior |
|---|---|
| `GET /v1/host/workspace/files` | List file metadata (no bodies) for the caller's `{tenant, workspace}`. |
| `GET /v1/host/workspace/files/{path}` | Return one `WorkspaceFile`. `404 not_found` if absent. |
| `PUT /v1/host/workspace/files/{path}` | Atomic create/replace. MUST honor `If-Match: <etag>`; on mismatch return `409 workspace_conflict`. On success bump `version`, emit `workspace.updated`. |
| `DELETE /v1/host/workspace/files/{path}` | Remove the file (and, if `versioned`, tombstone). |

A write MUST be **atomic** — a concurrent reader observes either the prior or the new content, never a partial. When `versioned: true`, `GET …/files/{path}?version=N` MUST return the historical snapshot.

### §D — run-time exposure (normative)

When `host.workspace.supported`, the host MUST expose the workspace as a **read snapshot taken at `run.started`** under `ctx.workspace.get(path)` / `ctx.workspace.list()`. The snapshot is immutable for the run's duration (mirrors RFC 0004 memory's read-as-of-run-start rule) so replay is deterministic. Writes from within a run go through the same `PUT` contract and are visible to *subsequent* runs / loop iterations, not the current snapshot. Sub-agents dispatched via RFC 0007 inherit the parent's `{tenant, workspace}` and therefore the same workspace — this is how ground truth is shared.

### §E — invariants

- **WCT-1 (cross-tenant isolation).** A workspace file MUST be scoped to a single `{tenant, workspace}`. No `GET`/`list` against a workspace owned by `{T, W}` MAY return a file owned by `{T′, W′} ≠ {T, W}`, regardless of the calling principal's permissions elsewhere. Mirrors CTI-1 (`agent-memory.md`). Proposed protocol-tier SECURITY invariant `workspace-cross-tenant-isolation`, landing with its conformance test at implementation.
- **WSR-1 (secret redaction).** A workspace write whose content contains a value the run's BYOK vault resolved MUST persist `[REDACTED:<secretId>]` in place of the plaintext. Reuses the SR-1 mechanism (`agent-memory.md`).

**Positive example.** `PUT /v1/host/workspace/files/DIRECTIVES.md` with `If-Match: "v3"` when current is `v3` → `200`, version → `4`, `workspace.updated { path: 'DIRECTIVES.md', version: 4 }`.
**Negative example.** Same write with `If-Match: "v3"` when current is `v5` → `409 workspace_conflict { details: { currentVersion: 5 } }`.

## Compatibility

**Additive.** New optional capability, new endpoints gated on advertisement, new schema, new event consumers MAY ignore. Hosts without `host.workspace.supported` are unaffected; a workflow that calls `ctx.workspace.*` declares `host.workspace: 'supported'` as a peer requirement and refuses to register on a host that lacks it (same pattern as RFC 0052). No existing surface changes.

## Conformance

- **`workspace-capability-shape.test.ts`** — block validates; `maxFileBytes`/`maxFiles` positive. (Always runs.)
- **`workspace-crud-roundtrip.test.ts`** — PUT→GET→list→DELETE round-trips; `workspace.updated` emitted on write. (Gated on `host.workspace.supported`.)
- **`workspace-etag-conflict.test.ts`** — stale `If-Match` → `409 workspace_conflict`. (Gated.)
- **`workspace-cross-tenant-isolation.test.ts`** — a principal on `{T′}` cannot read `{T}`'s file (fail-closed). (Gated; backs WCT-1.)
- **`workspace-run-snapshot.test.ts`** — a write mid-run is invisible to the current run's `ctx.workspace` snapshot but visible to the next run. (Gated.)

## Alternatives considered

1. **Model ground-truth files as memory entries (RFC 0004).** Rejected — memory entries are unaddressable by path, untyped, and have no atomic-replace/ETag concurrency; operators need to *edit* `DIRECTIVES.md` between runs the way they edit a file.
2. **Put files in node packs (RFC 0003).** Rejected — packs are immutable, signed, registry-distributed artifacts; workspace files are mutable per-tenant runtime state.
3. **Standardize specific filenames (`SOUL.md`, `IDENTITY.md`).** Rejected for v1 — the *store* is the protocol surface; which files an agent keeps is application convention. Standardizing names couples the wire to one product's ontology.

## Unresolved questions

1. **Directory semantics.** Is `path` a flat namespace with `/`-in-names, or true nested directories with `list` prefix filters? Proposed flat-with-slashes for v1. Resolve before Active.
2. **Version retention.** When `versioned: true`, how many historical versions must a host retain? Proposed: advertise `maxVersions`, default "latest only is mandatory, history best-effort." Decide before Active.
3. **Workspace ↔ memory-index coupling.** RFC 0062's distillation writes a memory-index manifest — should that live as a workspace file (`MEMORY-INDEX.md`) or a distinct surface? Proposed: a workspace file, to keep one durable layer. Confirm with 0062.

## Phase-0 resolution (architect ruling, 2026-05-25)

Per `docs/autonomous-agent-runtime-plan.md` §8 — Unresolved questions resolved (wire shape pinned; Active-ready pending this RFC's schema + prose landing):

1. **Directory semantics** → flat namespace with `/`-in-names (matches the `path` pattern in `workspace-file.schema.json`); `list` takes an optional `?prefix=`. Not nested directories.
2. **Version retention** → latest version is the MUST; `versioned: true` hosts retain ≥ an advertised `maxVersions` (history best-effort).
3. **Memory-index coupling (with RFC 0062)** → the index is a workspace file `MEMORY-INDEX.json` (machine-loaded, normative); an optional human-editable `.md` sibling MAY accompany it.

## Status history

- **2026-05-25 — Draft → Active.** The wire surface landed atomically per the repo's Active bar: `capabilities.workspace` block + `workspace-file.schema.json` + `workspace-file-create.schema.json`, the `workspace.updated` RunEvent (`run-event-payloads.schema.json` + `run-event.schema.json` enum), the four `/v1/host/workspace/files[/{path}]` OpenAPI endpoints, the AsyncAPI `workspace.updated` message, the `spec/v1/agent-workspace.md` prose doc (§C/§D/§E), `workspace_conflict` + `workspace_too_large` error codes, all three reference SDKs, and the always-on `workspace-capability-shape.test.ts` conformance scenario. `Active → Accepted` awaits reference-host *enforcement* (CRUD/ETag/snapshot behavior + the `workspace-cross-tenant-isolation` SECURITY invariant and its conformance test, which land at the implementation milestone with the `WorkspaceAdapter` wiring).

## Implementation notes (non-normative)

- `apps/workflow-engine`: today memory is tenant-scoped only (`host/inMemorySurfaces.ts`) and `RunRecord` carries no `owner.workspace` (RFC 0048 optional, unpopulated). This RFC's reference wiring is the first surface to require workspace-scoped storage; sequence it after the app populates the RFC 0048 owner triple.
- Storage: add a `WorkspaceAdapter` alongside `MemoryAdapter` in `storage-adapters.md` (adapter authors notified via that doc).

## Acceptance criteria

- [x] `spec/v1/agent-workspace.md` merged with the endpoint + snapshot + invariant contract.
- [x] `host.workspace` block + `workspace-file.schema.json` + OpenAPI endpoints + `workspace.updated` (AsyncAPI).
- [x] `workspace_conflict` + `workspace_too_large` registered in `rest-endpoints.md`.
- [x] Conformance: shape always-on. (CRUD/ETag/isolation/snapshot capability-gated scenarios land at the implementation milestone.)
- [ ] `workspace-cross-tenant-isolation` invariant + public test land in `SECURITY/invariants.yaml` at implementation (not at Active).
- [x] CHANGELOG entry under `[1.1.4 — unreleased]`.

## References

- [`RFCS/0004-memory-layer.md`](./0004-memory-layer.md) — the transactional layer this complements.
- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — the owner triple this scopes to.
- [`RFCS/0057-memory-write-attribution-event.md`](./0057-memory-write-attribution-event.md) — content-free attribution-event pattern reused by `workspace.updated`.
- [`spec/v1/agent-memory.md`](../spec/v1/agent-memory.md) — CTI-1 / SR-1 mechanisms reused as WCT-1 / WSR-1.

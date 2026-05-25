# openwop Spec v1 — Agent Workspace (`host.workspace`)

> **Status: DRAFT v1.x (2026-05-25).** Normative spec for the RFC 0059 `host.workspace` capability — a versioned, atomic, tenant·workspace-scoped file store for an agent's persistent *ground-truth* artifacts (identity / directives / memory-index), loaded as a read snapshot at run start. Complements the transactional `MemoryAdapter` (RFC 0004) with a durable, path-addressable file layer. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

Autonomous agents keep persistent *ground-truth* files — `IDENTITY.md`, standing `DIRECTIVES.md`, a `MEMORY-INDEX.json` — that are loaded at the start of every session and treated as authoritative. openwop's `MemoryAdapter` (RFC 0004) is a transactional, append-mostly entry store: entries are unaddressable by path, untyped, and have no atomic-replace or optimistic-concurrency contract. An operator who needs to *edit* `DIRECTIVES.md` between runs the way they edit a file has no protocol surface for it; `configurable` is run-scoped, not durable.

`host.workspace` adds that surface as an additive, capability-gated file layer: a `{tenant, workspace}`-scoped (RFC 0048) store with atomic, optimistically-concurrent writes (`If-Match` ETag), a content-free `workspace.updated` attribution event (reusing the RFC 0057 pattern), and a **read snapshot** exposed to every run at `run.started`. It expands openwop's architecture by adding a *durable file layer* alongside the *transactional memory layer*, without coupling the two. "What file does the agent treat as authoritative, and what version of it did this run see" is a cross-host portability and replay-determinism guarantee — a run replayed on another host MUST observe the same workspace snapshot — not an implementation detail, which is why it belongs in the spec.

This document specifies the §C endpoints, the §D run-snapshot exposure, and the §E invariants. The capability advertisement is `capabilities.workspace` (`capabilities.schema.json`); the file shape is `workspace-file.schema.json`; the event is `workspace.updated` (`run-event-payloads.schema.json#$defs.workspaceUpdated`).

## Capability advertisement

A host that implements the workspace store advertises:

```jsonc
"workspace": {
  "supported": true,
  "versioned": true,        // each write bumps a monotonic version; prior versions retrievable
  "maxFileBytes": 1048576,  // per-file byte ceiling
  "maxFiles": 256,          // per-workspace file-count ceiling
  "maxVersions": 20         // historical versions retained when versioned
}
```

`supported` is the only REQUIRED field. The advertisement is a CLAIM: a host that advertises `supported: true` MUST honor the §C, §D, and §E contracts end-to-end. Hosts that do NOT advertise `capabilities.workspace.supported: true` MUST return `501 capability_not_provided` on every endpoint below. A workflow that calls `ctx.workspace.*` declares `host.workspace: 'supported'` as a peer requirement and MUST refuse to register on a host that lacks it (same pattern as RFC 0052).

## File model

A workspace file (`workspace-file.schema.json`) is `{ path, content, contentType?, version, etag?, updatedAt }`:

- **`path`** is a **flat namespace with `/`-in-names** — NOT nested directories. The pattern `^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$` forbids `..` and a leading `/`. `list` accepts an optional `?prefix=` to filter the flat namespace.
- **`version`** is monotonic, starting at 1 on first create; each successful `PUT` bumps it by one.
- **`etag`** is an opaque optimistic-concurrency token for `If-Match`.

## §C — Endpoints (normative)

All endpoints are gated on `capabilities.workspace.supported: true` and scoped to the caller's `{tenant, workspace}` (RFC 0048). Full request/response shapes live in `api/openapi.yaml`.

| Method · path | Behavior |
|---|---|
| `GET /v1/host/workspace/files` | List file metadata (no bodies) for the caller's `{tenant, workspace}`. Optional `?prefix=` filters the flat `path` namespace. |
| `GET /v1/host/workspace/files/{path}` | Return one `WorkspaceFile`. `404 not_found` when absent. When `versioned: true`, `?version=N` returns the historical snapshot. |
| `PUT /v1/host/workspace/files/{path}` | Atomic create/replace. MUST honor `If-Match: <etag>`; on mismatch the host MUST return `409 workspace_conflict` (with `details.currentVersion`). On success the host MUST bump `version`, recompute `etag`, and emit `workspace.updated`. `content` beyond `maxFileBytes` MUST return `workspace_too_large`. |
| `DELETE /v1/host/workspace/files/{path}` | Remove the file (and, when `versioned: true`, write a tombstone). Emits `workspace.updated` on success. |

A write MUST be **atomic** — a concurrent reader MUST observe either the prior or the new content, never a partial. When `versioned: true`, retaining the latest version is the MUST; historical versions are retained best-effort up to the advertised `maxVersions`, and `GET …/files/{path}?version=N` MUST return the historical snapshot for any version still retained.

**Positive example.** `PUT /v1/host/workspace/files/DIRECTIVES.md` with `If-Match: "v3"` when current is `v3` → `200`, `version` → `4`, emits `workspace.updated { path: "DIRECTIVES.md", version: 4 }`.
**Negative example.** The same write with `If-Match: "v3"` when current is `v5` → `409 workspace_conflict { details: { currentVersion: 5 } }`.

## §D — Run-time exposure (normative)

When `capabilities.workspace.supported: true`, the host MUST expose the workspace as a **read snapshot taken at `run.started`** under `ctx.workspace.get(path)` / `ctx.workspace.list()`. The snapshot MUST be immutable for the run's duration — mirroring RFC 0004 memory's read-as-of-run-start rule — so replay is deterministic: a run replayed on another host MUST observe the same workspace snapshot it observed originally.

Writes from within a run go through the same `PUT` contract and are visible to **subsequent** runs / loop iterations, NOT the current snapshot. Sub-agents dispatched via RFC 0007 inherit the parent's `{tenant, workspace}` and therefore the same workspace — this is how ground truth is shared across a dispatch tree.

## §E — Invariants (normative)

The following are normative MUST / MUST NOT prose. Their protocol-tier SECURITY invariant entries (`SECURITY/invariants.yaml`) and public conformance tests land at implementation (the behavior milestone), per RFC 0059's acceptance criteria — they are NOT yet registered in `invariants.yaml`.

### WCT-1 — Cross-Tenant Isolation (normative)

> **WCT-1.** A workspace file MUST be scoped to a single `{tenant, workspace}`. No `GET` or `list` against a workspace owned by `{T, W}` MAY return a file owned by `{T′, W′} ≠ {T, W}`, regardless of the calling principal's permissions elsewhere.

In practice (mirrors CTI-1 in `agent-memory.md`):

1. Hosts MUST validate the `{tenant, workspace}` binding at resolution time from the **authenticated identity** — caller-supplied scope hints MUST NOT be trusted as authorization (fail-closed).
2. Cross-instance leak protection: when multiple workspace adapters share a backing store, each MUST gate by the owner triple, not by trusting the store.
3. Errors MUST NOT leak file contents or the existence of another tenant's file (`404` over `403` is acceptable to avoid existence disclosure).

This is the proposed protocol-tier SECURITY invariant `workspace-cross-tenant-isolation`, landing with its conformance test at implementation.

### WSR-1 — Secret Redaction (normative)

> **WSR-1.** A workspace write whose `content` contains a value the run's BYOK vault resolved during the run MUST persist `[REDACTED:<secretId>]` in place of the plaintext. A subsequent `GET`/`list` MUST NOT surface the plaintext.

WSR-1 reuses the SR-1 mechanism (`agent-memory.md` §SR-1): it binds to BYOK-resolved non-platform plaintext (`user` / `tenant` / `run` scope); platform-scope env-var fallback and host-internal service-account credentials are excluded. Redaction is substring replacement, longest-first, with an 8-character minimum-length floor.

## Workspace ↔ memory-index coupling (RFC 0062)

Per the RFC 0059 Phase-0 ruling, the RFC 0062 distillation memory-index manifest is a workspace file `MEMORY-INDEX.json` (machine-loaded, normative); an optional human-editable `.md` sibling MAY accompany it. This keeps a single durable layer rather than introducing a parallel surface.

## Open spec gaps

| Gap | Status |
|---|---|
| **Cross-host `path` / `etag` portability** | v1.x silent. A workspace minted on host A is NOT guaranteed re-resolvable on host B; `etag` is opaque and host-defined. A portable encoding MAY be normated later if implementer demand surfaces. |
| **`WorkspaceAdapter` host-interface contract** | Deferred to `storage-adapters.md` at implementation (RFC 0059 §G5) — adapter authors are notified there once the reference wiring lands. |
| **Version retention beyond `maxVersions`** | Latest is the MUST; history is best-effort. Hosts MAY purge versions beyond `maxVersions` at any time; a `?version=N` for a purged version returns `404 not_found`. |
| **Per-file authorization within a workspace** | Silence intentional. WCT-1 is the only normative isolation surface; finer-grained RBAC within a `{tenant, workspace}` is host-internal (composes with RFC 0049 when present). |
| **Directory / move / rename semantics** | Out of scope for v1 — the namespace is flat. A "rename" is a `PUT` of the new path plus a `DELETE` of the old. |
| **SECURITY invariant + conformance behavior tests** | `workspace-cross-tenant-isolation` (WCT-1) + WSR-1 + CRUD/ETag/snapshot conformance land at the behavior milestone, not at this DRAFT. Shape-only conformance (`workspace-capability-shape.test.ts`) ships now. |

## References

- [`RFCS/0059-agent-workspace.md`](../../RFCS/0059-agent-workspace.md) — the originating RFC.
- [`RFCS/0004-memory-layer.md`](../../RFCS/0004-memory-layer.md) — the transactional layer this complements.
- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](../../RFCS/0048-tenant-workspace-principal-identity-model.md) — the owner triple this scopes to.
- [`RFCS/0057-memory-write-attribution-event.md`](../../RFCS/0057-memory-write-attribution-event.md) — content-free attribution-event pattern reused by `workspace.updated`.
- [`spec/v1/agent-memory.md`](./agent-memory.md) — CTI-1 / SR-1 mechanisms reused as WCT-1 / WSR-1.
- `schemas/capabilities.schema.json` §`workspace`
- `schemas/workspace-file.schema.json` + `schemas/workspace-file-create.schema.json`
- `api/openapi.yaml` §`/v1/host/workspace/files`
- `conformance/src/scenarios/workspace-capability-shape.test.ts`

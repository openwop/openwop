# RFC 0074: Tenant-Scoped Manifest-Agent Inventory (amends RFC 0072)

| Field | Value |
|---|---|
| **RFC** | 0074 |
| **Title** | Tenant-Scoped Manifest-Agent Inventory |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-27 |
| **Updated** | 2026-05-27 (graduated `Active → Accepted` — see below) |
| **Affects** | `schemas/capabilities.schema.json` (`agents.manifestRuntime` block), `schemas/agent-inventory-response.schema.json` (RFC 0072), `spec/v1/node-packs.md`, `spec/v1/host-capabilities.md`, `api/openapi.yaml` (`GET /v1/agents` auth/scope note), `conformance/src/scenarios/agent-manifest-runtime.test.ts`, `CHANGELOG.md`, `INTEROP-MATRIX.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

> **Graduated `Active → Accepted` 2026-05-27** on the multi-tenant non-steward host MyndHyve (`workflow-runtime-00398-vup`). Steward-corroborated live: `GET /.well-known/openwop` advertises `agents.manifestRuntime.installScope: 'tenant'` at the document root. Two-principal authed proof (same `agentId`): Principal A (workspace `ws-openwop-conformance`, pack approved) → `GET /v1/agents` `{ total: 1, agents: [private.myndhyve.conformance-agent.reviewer] }`; Principal B (`ws-openwop-conformance-b`, no approval) → `{ agents: [], total: 0 }` and `GET /v1/agents/{agentId}` → `404 not_found` — cross-tenant, no disclosure. That is the §A scoping contract end-to-end on a real multi-tenant host. (Proof used a complete private pack because all three published `core.openwop.agents.*` packs currently omit their `systemPromptRef` body from the tarball — an openwop publishing defect the resolver correctly fail-loud-rejects per RFC 0003 §C; tracked separately, not a 0074 concern.) See `INTEROP-MATRIX.md` §"RFC 0074".

## Summary

RFC 0072 §A promoted `GET /v1/agents` to a normative agent inventory, but specified it as a **flat, host-global** list. A multi-tenant host cannot serve that faithfully: such hosts gate pack — and therefore manifest-agent — availability **per tenant** (the same per-workspace approval model `node-packs.md` already defines for nodes), so a host-global inventory would either leak one tenant's installed agents to another or be unable to represent per-tenant approval at all. This RFC adds an additive **`capabilities.agents.manifestRuntime.installScope: 'host' | 'tenant'`** advertisement and clarifies that `GET /v1/agents` returns the agents available to **the authenticated principal's tenant·workspace** (the RFC 0048 owner triple) — host-global on a single-tenant host (today's behavior, the default), tenant-scoped on a multi-tenant host. Dispatch needs no change: RFC 0072 §B already routes dispatch through `POST /v1/runs`, which is owner-triple-scoped.

## Motivation

This is a second-implementation finding. The OpenWOP reference host (`examples/hosts/*`, the `workflow-engine` sample) is single-tenant, so RFC 0070/0072 modeled the agent registry and its inventory as host-global. A second, **multi-tenant** host (MyndHyve) adopting `agents.manifestRuntime` surfaced that the inventory surface, as written, is unimplementable for the multi-tenant case:

- Multi-tenant hosts scope pack availability **per workspace**, and the corpus already scopes packs that way: `node-packs.md` pins a workspace's packs via its `pack-lock.json`, gates conformance keys behind a "per-tenant role check", and tightens tenant-inheritance via `principalScope`; and runs / workspace files / memory are all owner-triple-scoped (RFC 0048; RFC 0059 `agent-workspace`). What `node-packs.md` does **not** define is a normative per-workspace pack-*approval* gate ("unapproved ⇒ refuse") — that is a host-side policy a multi-tenant host layers on top (MyndHyve gates `workspaces/{wsId}/approved_packs/`). Either way, manifest agents ride in those same per-workspace packs (RFC 0003 `agents[]`), so on a multi-tenant host their availability is per-workspace too — there is no "platform-wide auto-approve" tier.
- RFC 0072 §A's `GET /v1/agents` is specified as a single flat list with no principal scoping. A multi-tenant host has no honest way to answer it: returning every workspace's installed agents leaks cross-tenant inventory (a confidentiality break — *which* agents a tenant installed is tenant-private), and returning a global subset misrepresents what any given caller can actually run.
- The conformance scenario (RFC 0072) asserts the flat list. Post-RFC 0073 (which fixed the discovery-*layout* soft-skip — an orthogonal issue: root-vs-nested placement, not tenancy) that inventory leg now actually runs against a root-serving host, so a tenant-scoped host is pushed to either expose a non-conformant host-global list or fail the flat-list assertion. (RFC 0070 already graduated `Accepted` on manual verification plus the documented soft-skip caveat; this gap is about making the inventory leg *truthfully passable* black-box on a multi-tenant host, not about unblocking acceptance.)

The spec is the right place because "which agents can *this caller* run on *this host*" is a portability and confidentiality contract — a client pointed at any conformant host must get a truthful, appropriately-scoped answer — not an implementation detail. The fix is small and additive: name the scope, and tie the inventory to the owner triple the rest of the corpus already uses (RFC 0048; RFC 0059 `agent-workspace` is "tenant·workspace-scoped"; `node-packs.md` approval is per-workspace).

## Proposal

### §A — `GET /v1/agents` is principal-scoped

Amend RFC 0072 §A: a host advertising `capabilities.agents.manifestRuntime.supported: true` **MUST** serve, from `GET /v1/agents` and `GET /v1/agents/{agentId}`, **the manifest agents available to the authenticated principal's tenant·workspace** (the RFC 0048 owner triple resolved from the request's auth), not necessarily a host-global set.

- On a **single-tenant** host (`installScope: 'host'`, the default), "available to the principal" is the whole host — identical to RFC 0072's current behavior. No change.
- On a **multi-tenant** host (`installScope: 'tenant'`), "available to the principal" is the set the principal's workspace has installed/approved (per `node-packs.md` approval). An agent the principal's workspace has not approved **MUST** be absent from `GET /v1/agents` and **MUST** `404` (canonical error envelope) on `GET /v1/agents/{agentId}` — indistinguishable from "not installed on this host," so the surface never discloses another tenant's inventory.
- Unauthenticated / unscoped requests to `GET /v1/agents` on a `'tenant'`-scoped host **MUST** be rejected per the host's standard auth contract (the same `401`/`403` any owner-triple-scoped endpoint returns); they **MUST NOT** fall back to a host-global listing.

The `AgentInventoryEntry` shape (RFC 0072, `agent-inventory-response.schema.json`) is unchanged.

### §B — `installScope` advertisement (additive schema)

Add an optional `installScope` to the `agents.manifestRuntime` block so clients and conformance know how `GET /v1/agents` is scoped without probing:

```diff
 "manifestRuntime": {
   "type": "object",
   "additionalProperties": false,
   "required": ["supported"],
   "properties": {
     "supported": { "type": "boolean" },
     "handoffValidation": { "type": "boolean", "default": false },
+    "installScope": {
+      "type": "string",
+      "enum": ["host", "tenant"],
+      "default": "host",
+      "description": "RFC 0074. Scope at which manifest agents are installed/approved and therefore enumerated by GET /v1/agents. 'host' (default): a single host-global inventory; the endpoint returns the same set for every caller (RFC 0072's original behavior). 'tenant': agents are installed per tenant·workspace (RFC 0048 owner triple); GET /v1/agents returns ONLY the agents available to the authenticated principal's workspace, and an unapproved/unknown agent 404s — the surface never discloses another tenant's inventory."
+    }
   }
 }
```

- Absent `installScope` ⇒ `'host'` ⇒ RFC 0072 behavior verbatim. Existing hosts and clients are unaffected.
- A host advertising `installScope: 'tenant'` **MUST** scope `GET /v1/agents` per §A. A host **MUST NOT** advertise `'tenant'` while serving a host-global list (that would be a false advertisement under the corpus's truthful-advertisement rule, `capabilities.md`).
- `installScope` describes **only** the inventory/install surface; it does not change dispatch (§D) or any floor safety guarantee (RFC 0072 §D — `toolAllowlist`/`systemPromptRef`/SR-1 remain mandatory regardless of scope).

### §C — Conformance

The inventory leg of `agent-manifest-runtime.test.ts` (RFC 0072) **MUST** read `installScope` and exercise `GET /v1/agents` **within the conformance principal's scope**:

- `installScope: 'host'` (or absent): assert the flat list as today.
- `installScope: 'tenant'`: drive the request with the conformance principal/workspace context (the suite already threads an auth principal for the owner-triple scenarios — RFC 0048 / RFC 0059 isolation tests), and assert the returned set is exactly that principal's installed agents, and that an agent not approved for that principal `404`s. A tenant-scoped host **passes** instead of being forced into a global list or a soft-skip.

This lets the only non-steward (multi-tenant) host **pass** the inventory leg truthfully — instead of being forced into a host-global list — strengthening the conformance evidence behind the already-`Accepted` RFC 0070 and the in-flight RFC 0072.

### §D — Dispatch is unchanged

No change to dispatch. RFC 0072 §B already routes manifest-agent dispatch through `WorkflowNode.agent` + `POST /v1/runs`, and a run is created under the RFC 0048 owner triple — so dispatch is already tenant-scoped by construction. This RFC touches **only** the read/inventory surface (§A) and its advertisement (§B).

### §E — Positive / negative examples

Positive — a `'tenant'`-scoped host, two workspaces, principal authenticated to workspace `ws-A`:

```jsonc
// discovery
{ "agents": { "manifestRuntime": { "supported": true, "handoffValidation": true, "installScope": "tenant" } } }

// GET /v1/agents  (principal → ws-A; ws-A approved only the code-reviewer pack)
{ "agents": [ { "agentId": "core.openwop.agents.code-reviewer.default", "persona": "Code Reviewer",
  "modelClass": "coding", "packName": "core.openwop.agents.code-reviewer", "packVersion": "1.0.0",
  "toolAllowlist": ["openwop:fs.read"], "hasHandoffSchemas": true } ], "total": 1 }

// GET /v1/agents/core.openwop.agents.researcher.default  (approved by ws-B, NOT ws-A)
// → 404 { "error": "not_found", ... }   // ws-A's caller never learns ws-B installed it
```

Negative — advertising `'tenant'` but serving a host-global list (violates §B truthful advertisement):

```jsonc
// discovery says installScope: 'tenant', but GET /v1/agents returns ws-A's AND ws-B's agents
// to ws-A's caller → NON-CONFORMANT (cross-tenant inventory disclosure)
```

## Compatibility

**Additive.**

- `installScope` is a new optional string with `default: "host"`; `agents.manifestRuntime` is `additionalProperties: false` but gains one optional property — no existing field changes type, optionality, or default, and a host that omits it is treated exactly as RFC 0072 specified (host-global).
- `GET /v1/agents` keeps its RFC 0072 contract for `'host'` hosts byte-for-byte; the principal-scoping in §A is a *clarification of how the existing endpoint behaves under auth* for `'tenant'` hosts, not a new endpoint or a changed response shape.
- No event, error code, `MUST`, or dispatch contract changes. A client that doesn't read `installScope` sees a `'host'` host exactly as before; against a `'tenant'` host it gets that principal's agents (still a valid `agent-inventory-response`), which is the only correct answer for a scoped caller.
- Backward-compat clause: every host published before this RFC is `installScope: 'host'` by default and conforms unchanged; every pack is unaffected (this RFC touches no manifest field).

## Conformance

- **Retargeted (no new file):** `agent-manifest-runtime.test.ts` (RFC 0072) gains an `installScope` branch per §C — host-global assertion when `'host'`/absent, principal-scoped assertion (+ cross-tenant `404`) when `'tenant'`. Gated on `agents.manifestRuntime.supported`; soft-skips when unadvertised.
- Reuses the existing conformance principal/owner-triple threading already present for the RFC 0048 / RFC 0059 (`workspace-cross-tenant-isolation`) scenarios — no new auth harness.
- Suite bump rides RFC 0072's (`@openwop/openwop-conformance` 1.10.0) if co-released, else the next minor.

## Alternatives considered

1. **Leave `GET /v1/agents` host-global (do nothing).** Rejected: it makes the normative inventory unimplementable for multi-tenant hosts without either leaking cross-tenant inventory or lying, and leaves the inventory leg untruthful (or unrunnable) against the only non-steward multi-tenant host. "The portable agent protocol for any app" must include multi-tenant apps.
2. **A separate `GET /v1/tenants/{ws}/agents` endpoint.** Rejected: forks the inventory surface, duplicates RFC 0072 §A, and pushes tenant identity into the path rather than deriving it from auth (the owner triple) the way every other scoped surface in the corpus does (runs, workspace files, memory). Auth-derived scoping keeps one endpoint that means "the agents *you* can run here."
3. **A boolean `tenantScoped: true` instead of an enum.** Rejected: an enum (`'host' | 'tenant'`) leaves room for future scopes (e.g. `'project'`) without a second boolean, and reads self-documenting in discovery.
4. **Fold this into RFC 0072 directly (it's still `Draft`).** Viable — see Unresolved #1. Filed as a distinct RFC because the tenancy concern has a distinct source (a second, multi-tenant implementation) and a distinct compatibility story; the steward may prefer to merge it into 0072 before 0072 lands.

## Unresolved questions

1. **Fold into RFC 0072?** RFC 0072 is still `Draft`. Should `installScope` + the principal-scoping clause land as a revision to 0072 rather than a standalone 0074? (This RFC is written to be mergeable either way.)
2. **`installScope: 'project'`?** MyndHyve scopes some surfaces below the workspace (per-project). Is workspace-granularity (the RFC 0048 triple's `workspace`) the right universal floor, with finer scopes left host-internal, or should the enum anticipate `'project'`?
3. **Empty inventory vs. capability advertisement.** A `'tenant'` host advertises `manifestRuntime.supported: true` host-wide, yet a brand-new workspace that has approved no agent packs returns `{ "agents": [], "total": 0 }`. Confirm that an empty inventory under an advertised, supported floor is conformant (it is, by §A — the capability is present; the *principal's* set is empty).

## Implementation notes (non-normative)

- A multi-tenant host implements §A by resolving the request's owner triple, then listing the agents in packs that workspace has approved (the same approval reader the node-pack resolver already consults). The agent registry is keyed by `(workspace, agentId)` rather than a single host-global map — an implementation detail the wire never sees.
- The single-tenant reference host implements `installScope: 'host'` by omitting the field (default) and serving its global `AgentRegistry` (RFC 0072 impl notes) unchanged.
- MyndHyve is the motivating second implementation: it gates packs per workspace (`workspaces/{wsId}/approved_packs/`), dispatches via `WorkflowNode.agent` + owner-triple-scoped `POST /v1/runs` (already RFC 0072 §B-shaped), and is blocked from wiring its live agent-pack resolver until this scope question is settled — by design, this RFC is the gate.

## Acceptance criteria

- [x] Spec text merged (this file + the `node-packs.md` §"Inventory scope" normative clause + the `host-capabilities.md` cross-reference).
- [x] `installScope` added to `agents.manifestRuntime` in `capabilities.schema.json`.
- [x] `api/openapi.yaml` `GET /v1/agents` + `/{agentId}` note auth-derived scoping + the `'tenant'` `404` semantics.
- [x] `agent-manifest-runtime.test.ts` gains the `installScope` branch (host-global ≥1 vs tenant principal-scoped, empty-allowed per Q3); the ≥1 MUST is relaxed for tenant scope.
- [x] CHANGELOG entry under `[Unreleased]`.
- [x] **(Active → Accepted gate — MET 2026-05-27)** MyndHyve (`workflow-runtime-00398-vup`), via its workspace-scoped `MyndHyveAgentPackResolver`, serves principal-scoped `GET /v1/agents` with the two-principal cross-tenant `404` proof (A → 1 agent; B → empty + `404`). Strengthens the already-`Accepted` RFC 0070's conformance evidence on a multi-tenant host.

## References

- RFC 0072 (Agent Inventory + Dispatch — `Draft`; this amends §A), RFC 0070 (agent-manifest runtime — `Accepted`), RFC 0073 (capability document-root layout — merged; fixed discovery *layout*, orthogonal to this RFC's tenancy axis), RFC 0002 (`AgentRef` / `WorkflowNode.agent`), RFC 0003 (agent packs / `peerDependencies`), RFC 0048 (owner-triple identity scope), RFC 0059 (`agent-workspace` — tenant·workspace scoping precedent).
- `spec/v1/node-packs.md` (per-workspace pack approval, `pack-lock.json`, `principalScope`), `spec/v1/capabilities.md` (truthful advertisement), `spec/v1/host-capabilities.md`.

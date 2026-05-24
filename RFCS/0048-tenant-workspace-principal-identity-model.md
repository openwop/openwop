# RFC 0048: Tenant · Workspace · Principal identity model

| Field | Value |
|---|---|
| **RFC** | 0048 |
| **Title** | Promote the existing tenant dimension to an explicit identity triple — `{ tenant, workspace?, principal }` — threading through auth context, scoped discovery, run ownership, and events, so workspace sub-tenancy and the acting principal become portable wire-level concepts |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-24 |
| **Affects** | `schemas/run-snapshot.schema.json` (additive optional `owner` field) · `schemas/run-event-payloads.schema.json` (`run.created` echoes the owner) · `spec/v1/auth.md` (identity claims) · `spec/v1/run-options.md` (workspace/principal claims) · RFC 0011 (extends tenant-scoped discovery to workspace granularity) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Promote openwop's existing tenant dimension (RFC 0011's tenant-scoped discovery) to a small, explicit **identity triple — `{ tenant, workspace?, principal }`** — carried as optional claims in the auth context and echoed, redaction-safe, onto run ownership and `run.created`. `workspace` is a sub-tenant (a collaborative scope inside a tenant); `principal` is the acting user/agent identity. This gives A2A peers and the conformance suite something to reason about for workspace scoping and run ownership, and is the foundation RFC 0049 (RBAC), RFC 0050 (SAML/SCIM), and RFC 0051 (approval gates) bind to. Single-tenant hosts ignore the optional `workspace`/`principal` claims with no change.

## Motivation

MyndHyve is deeply multi-tenant: every collaborative entity lives at `workspaces/{wsId}/`, every user has a personal workspace, team workspaces carry RBAC, and `runs/{runId}` is keyed by `userId` + `workspaceId` with cross-tab `run_claims`. openwop already has a **tenant** dimension — RFC 0011 narrows the capability view per tenant — but no notion of a **workspace** sub-tenant or a **principal** as portable, wire-level concepts. So MyndHyve's workspace scoping, run ownership, and `run_claims` dedup are host-private conventions that A2A peers and conformance cannot reason about: a federated peer can't tell which workspace a run belongs to, and conformance can't assert cross-workspace isolation.

The protocol is the right place because the triple has to thread *across* the wire boundary — discovery (what does workspace W see?), run ownership (who owns run R?), and events (which principal triggered this?). Three downstream RFCs (0049/0050/0051) all need a stable identity vocabulary to bind to; defining it once here avoids each reinventing it.

## Proposal

### §A — Identity claims (normative)

Standardize three optional claims in the auth context (`spec/v1/auth.md`):

- `tenant` — the top-level isolation boundary (already implied by RFC 0011's tenant-scoped discovery; now named).
- `workspace` — an **optional** sub-tenant within a tenant. A collaborative scope; a tenant has ≥1 workspace.
- `principal` — the **acting identity** (a user or an agent) making the request.

These are claims the host derives from the caller's credential (API key, OIDC token, etc.); the protocol does not mandate *how* they are derived, only their names and that they are echoed redaction-safe where §C/§D require.

### §B — Workspace-scoped discovery (extends RFC 0011)

RFC 0011 narrows the capability view per tenant. This RFC extends that narrowing to **workspace** granularity: when a caller's auth context carries a `workspace` claim, the host's `/.well-known/openwop` response MAY present a workspace-scoped subset. The RFC 0011 authorization-oracle invariant is extended: a workspace-scoped response MUST NOT include any optional capability that a strictly-narrower workspace's response lacks.

### §C — Run ownership (additive)

Add an optional `owner` to `run-snapshot.schema.json`:

```diff
   "type": "object",
   "required": ["runId", "workflowId", "status"],
   "properties": {
+    "owner": {
+      "type": "object",
+      "description": "RFC 0048. The identity triple that owns this run. Redaction-safe — principal is an opaque identifier, never PII or credential material.",
+      "required": ["tenant"],
+      "properties": {
+        "tenant": { "type": "string", "minLength": 1 },
+        "workspace": { "type": "string", "minLength": 1 },
+        "principal": { "type": "string", "minLength": 1 }
+      },
+      "additionalProperties": false
+    }
   }
```

`run.created` echoes `owner` (redaction-safe). MyndHyve's `run_claims` dedup maps onto owner-scoped claims.

### §D — Cross-workspace isolation (normative)

A principal scoped to workspace A MUST NOT be able to read a run owned by workspace B (within or across tenants). A cross-workspace read MUST fail-closed with `run_forbidden`. This is the conformance-testable isolation guarantee that makes the workspace claim meaningful rather than advisory.

## Compatibility

**Additive.** All three claims are optional; the `owner` field is optional with no default. Existing single-tenant hosts that emit none of them are unaffected, and existing clients ignore an `owner` they don't understand. Appending `owner` to `run-snapshot.schema.json` does not invalidate any existing snapshot. No required-field change.

**Builds on RFC 0011** (tenant-scoped discovery). Foundation for RFC 0049/0050/0051.

## Conformance

- **`identity-claims-shape.test.ts`** — `owner` validates; claims are well-formed strings. (Always runs.)
- **`workspace-scoped-discovery.test.ts`** — a workspace-scoped key sees a subset; the RFC 0011 oracle invariant holds at workspace granularity. (Gated on a host advertising workspace-scoped discovery.)
- **`run-ownership-echo.test.ts`** — `run.created` and the run snapshot echo the owner triple. (Gated on `owner` presence.)
- **`cross-workspace-isolation.test.ts`** — a principal in workspace A reading a workspace-B run gets `run_forbidden`. (Gated; backs §D — the CTI-style isolation assertion.)

## Alternatives considered

1. **Reuse `tenant` alone and treat workspaces as sub-tenants by string convention (`tenant:workspace`).** Rejected — overloading one opaque string defeats conformance reasoning (you can't assert isolation on a substring convention) and breaks RFC 0011's existing tenant semantics.
2. **Model identity as a free-form `metadata` bag.** Rejected — RBAC (0049), SAML/SCIM mapping (0050), and approval binding (0051) all need *named*, stable fields; a metadata bag has no contract to bind to and can't be conformance-tested.
3. **Make the triple mandatory.** Rejected — most non-MyndHyve hosts are single-tenant; mandating `workspace`/`principal` would break them. Optionality preserves their posture (the same argument RFC 0014 made for capability-gating fs).

## Unresolved questions

1. **Principal *kind* (`user` vs `agent`).** Should `principal` carry a kind discriminator so an agent-initiated run is distinguishable from a user-initiated one? Likely yes for audit (RFC 0049), but deferred until the RBAC binding needs it.
2. **Workspace hierarchy depth.** Is one level of workspace-under-tenant enough, or do enterprises need nested workspaces? Start flat; revisit if an adopter pulls.
3. **Run *transfer* of ownership.** Can a run's `owner` change (e.g. re-assignment)? Out of scope; ownership is set at `run.created` for now.

## Implementation notes (non-normative)

- Schema diff (§C) lands on `Active` promotion with the conformance scenarios.
- Reference-adopter target: MyndHyve maps `ws-personal-{userId}` and team workspaces onto `workspace`, `activeWorkspaceId` onto the claim, and its `run_claims` dedup onto owner-scoped claims.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `owner` field in `run-snapshot.schema.json`; `run.created` echo in `run-event-payloads.schema.json`.
- [ ] Identity claims documented in `spec/v1/auth.md`; workspace-scoped discovery extension noted against RFC 0011.
- [ ] Four conformance scenarios (shape, workspace discovery, ownership echo, cross-workspace isolation).
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host advertises workspace-scoped discovery + run ownership and passes the isolation scenario.

## References

- [`RFCS/0011-auth-scoped-discovery.md`](./0011-auth-scoped-discovery.md) — the tenant-scoped discovery + authorization-oracle invariant this RFC extends to workspace granularity.
- [`spec/v1/auth.md`](../spec/v1/auth.md) — the auth context the claims are carried in.
- [`RFCS/0049-rbac-scopes-and-authorization-decisions.md`](./0049-rbac-scopes-and-authorization-decisions.md) · [`0050`](./0050-saml-scim-enterprise-identity-profiles.md) · [`0051`](./0051-approval-deployment-gate-primitive.md) — the downstream RFCs that bind to this triple.

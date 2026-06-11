# openwop Spec v1 — Agent Org-Chart

> **Status: Stable · v1.x — reached `Accepted` via [RFC 0087](../../RFCS/0087-agent-org-chart.md) (2026-05-31).** Additive v1.x extension — not part of the v1.0 conformance gate. Lands the descriptive org-chart record over RFC 0086 roster members, the derived responsibility roll-up, the `capabilities.agents.orgChart` advertisement, and — the normative heart — the protocol-tier `org-position-no-authority-escalation` SECURITY invariant. The `GET /v1/agents/org-chart` endpoint, the SDK helpers, the behavioral non-authority scenario, and the reference-host org store land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

[RFC 0086](./agent-roster.md) gives openwop the standing agent instance — the named "digital-twin employee" that owns a workflow portfolio. The natural next question on every agent platform is **organizational**: which department does an agent belong to, what is its role, who does it report to, and what is the team collectively responsible for? Today that is unmodeled — agents are a flat set — so an operator console cannot render an org chart, a responsibility audit cannot roll work up to a department, and a peer host cannot discover team structure.

This document adds a **descriptive** org-chart layer **additively**: an [`agent-org-chart.schema.json`](../../schemas/agent-org-chart.schema.json) with **departments**, **roles**, **members** (RFC 0086 `rosterId`s), and `reportsTo` **edges**, plus a derived **responsibility view** (the union of a department's members' portfolios), gated behind an `agents.orgChart` capability and tenant-scoped per RFC 0074. The **load-bearing constraint** — the reason this is a careful document and not a trivial grouping schema — is a new protocol-tier SECURITY invariant, **`org-position-no-authority-escalation`**: an org edge is *metadata only*. Position describes; it never authorizes.

## §A — The org-chart record

The [record](../../schemas/agent-org-chart.schema.json) is a tenant-scoped, **descriptive** structure: `departments[]` (each with a `departmentId`, `name`, optional `parentDepartmentId` for nesting, and `roles[]`), and `members[]` (each an RFC 0086 `rosterId` placed in a `departmentId` + `roleId`, with a `reportsTo` edge to another member's `rosterId` or `null`).

`members[].rosterId` **MUST** reference an RFC 0086 roster entry within the **same** `owner` triple (no cross-tenant membership — §C). The `reportsTo` edge set **MUST** be acyclic (a cycle is a `validation_error`). Departments form a tree via `parentDepartmentId`. **Every field is descriptive** — there is no `permissions`, `canDispatch`, `scopes`, or `authority` field anywhere in the schema, and every object is `additionalProperties:false`, by §B design.

## §B — The load-bearing invariant: org position confers NO authority

This is the normative heart. The protocol-tier SECURITY invariant **`org-position-no-authority-escalation`**:

> An agent's position in an org-chart — its department, its role, or any `reportsTo` edge into or out of it — **MUST NOT** grant, widen, or imply any authority. Specifically, for any agent A and any org position A holds:
> - A's effective `toolAllowlist` is exactly its manifest/dispatch allowlist ([RFC 0002 §A14](../../RFCS/0002-agent-identity-and-reasoning-events.md)); **being a "manager" of agent B MUST NOT add B's tools to A**, and **being a "report" MUST NOT inherit a manager's tools**.
> - A's authorization decisions are made **solely** by [RFC 0049](../../RFCS/0049-rbac-scopes-and-authorization-decisions.md) RBAC scopes (fail-closed); **org position MUST NOT be consulted as an authorization input** and MUST NOT cause an `authorization.decided{allowed:true}` that the principal's scopes alone would not.
> - An approval gate ([RFC 0051](../../RFCS/0051-approval-deployment-gate-primitive.md)) is satisfied **solely** by its configured `requiredRole`/`quorum`/`override`; **being "senior" MUST NOT auto-satisfy, bypass, or override a gate**.

The schema (§A) carries **no** authority-bearing field, so a conformant host **cannot** express position-as-authority through it; the invariant additionally forbids a host from *deriving* authority from position out-of-band. A host MAY use position for **non-authority** purposes (rendering, routing-preference, notification fan-out, responsibility reporting) — none of which changes who-can-do-what. This invariant has an always-on public test (§Conformance), per the protocol-tier rule that every MUST-NOT carries a matching test.

## §C — Tenant scoping

The org chart is tenant-scoped exactly as RFC 0074 scopes the agent inventory + RFC 0086 scopes the roster. On a `'tenant'`-install host, `GET /v1/agents/org-chart` returns **only** the chart for the authenticated principal's owner triple; a member, department, or edge outside it is never disclosed (the CTI-1 carry-forward). A chart **MUST NOT** contain a member whose RFC 0086 roster entry is in a different tenant (cross-tenant org membership is a `validation_error`).

## §D — Responsibility view (derived, read-only)

A derived read rolls a department's responsibilities up from its members' RFC 0086 portfolios — no new stored field:

```
GET /v1/agents/org-chart                       → the full chart: { departments[], members[] }
GET /v1/agents/org-chart/{departmentId}         → one department's subtree + roll-up:
   { department, members[], responsibilities: [...] }
```

`{departmentId}` resolves the subtree by path (an unknown/cross-tenant id 404s, §C). An optional `?recursive=false` query param **narrows** the roll-up to direct members without changing the response *shape*. `responsibilities` is the **union of the `workflows[]` portfolios** of the department's members (and, by default, recursively its sub-departments). It is purely a *view*; it grants nothing (§B) and stores nothing (it is computed from RFC 0086 entries). The endpoints land at `Active → Accepted`.

## §E — Capability advertisement (`agents.orgChart`)

```jsonc
"agents": { "orgChart": {
  "supported": true,
  "installScope": "tenant",          // 'host' | 'tenant' — SHOULD equal agents.roster.installScope
  "departmentNesting": true,         // host supports parentDepartmentId trees
  "responsibilityView": true         // host computes the §D roll-up
}}
```

`agents.orgChart` **REQUIRES** `agents.roster.supported: true` (the chart's members are RFC 0086 roster entries); advertising `orgChart` without `roster` is a `validation_error`. Truthful advertisement (RFC 0031): a host without department nesting advertises `departmentNesting:false` and rejects a non-null `parentDepartmentId`. A host that omits the block has no org-chart surface (today's default). **Crucially, the §B non-authority invariant holds for every host that advertises `orgChart`, at every `installScope` — it is not gated, weakened, or opt-out.**

## Open spec gaps

| Gap | Disposition |
|---|---|
| `GET /v1/agents/org-chart[/{departmentId}]` + org-chart-management endpoints | Deferred to `Active → Accepted` (OpenAPI/AsyncAPI + SDK helpers). The read + roll-up are the interop surface; management is host-private at v1.x. |
| Behavioral non-authority + scoping conformance | Deferred to `Active → Accepted` (gated on `agents.orgChart.supported`); the always-on `agent-org-chart-shape.test.ts` structural assertions (schema rejects an authority field; descriptive-only key set) assert the §B invariant now. |
| Reference-host org store | Demonstrated as a host-extension at `/v1/host/sample/org-chart` (the reference app, `openwop/openwop-app` repo; originally PR #371); the normative `GET /v1/agents/org-chart` reference wiring lands at `Active → Accepted`. |
| Multi-department membership; matrixed `reportsTo` across departments | A member belongs to one department + role per chart at v1.x; `reportsTo` MAY cross departments (only cycles + cross-tenant edges are forbidden). A future minor MAY add `memberships[]`. |
| Delegated authority (a principal granting a scope to another) | Out of scope — that is delegation-by-RBAC (RFC 0049) with its own threat model, NOT authority-by-position. §B forbids the latter. |

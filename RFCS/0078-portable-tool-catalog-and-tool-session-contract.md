# RFC 0078: Portable Tool Catalog + Tool Session Contract

| Field | Value |
|---|---|
| **RFC** | 0078 |
| **Title** | An optional, capability-gated `GET /v1/tools` + `GET /v1/tools/{toolId}` projection returning a normative `ToolDescriptor` (stable `toolId`, source, I/O schemas, auth/egress/approval requirements, replay policy, safety tier) across every tool surface (node-pack / workflow / MCP / connector / host-extension), plus an optional tool-session lifecycle — so an agent or builder can discover what tools exist, what they require, and how they are audited, portably |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-29 |
| **Updated** | 2026-05-30 (`Draft → Active` — steward acceptance, comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus after MyndHyve (non-steward) wire-shape review; wire shapes now locked. All 4 Unresolved questions resolved as proposed: UQ1 the `<scope>:` prefix disambiguates `toolId` per source + host MUST guarantee catalog uniqueness; UQ2 RECOMMEND (not MUST) the RFC 0030 Tier-1 subset for LLM-tool-call `inputSchema`; UQ3 keep §D `sessionLifecycle` in the Active surface as an optional sub-flag + defer the reference emission; UQ4 four `safetyTier` values for v1.x, extend additively if demanded. NEW `spec/v1/tool-catalog.md` + `schemas/tool-descriptor.schema.json` + `capabilities.toolCatalog` + the two content-free `tool.session.{opened,closed}` events + `tool-descriptor-shape.test.ts` landed. The `GET /v1/tools` OpenAPI surface, SDK helpers, behavioral projection/session scenarios, and reference-host catalog deferred to `Active → Accepted`.) |
| **Affects** | `schemas/tool-descriptor.schema.json` (NEW) · `schemas/capabilities.schema.json` (additive optional `toolCatalog` block) · `api/openapi.yaml` (`GET /v1/tools` + `GET /v1/tools/{toolId}`) · `schemas/run-event-payloads.schema.json` (optional `tool.session.*` events for the session lifecycle) · `spec/v1/tool-catalog.md` (NEW) · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop tools live behind five unrelated surfaces — node-pack typeIds (RFC 0003), workflow-as-tool (`core.subWorkflow` / RFC 0013 chains), MCP servers (`host.mcp`), connectors (RFC 0045), and host-extension scopes (`x-host-<vendor>-*` / RFC 0069) — each discoverable, if at all, only through its own mechanism. An agent (RFC 0077) is handed a `toolAllowlist` of opaque `<scope>:<tool-id>` strings with no portable way to learn what each tool *is*, what it *requires* (credentials, scopes, approval), how it *behaves on the wire* (egress, replay determinism), or how *dangerous* it is. This RFC adds an **optional, capability-gated read-only projection** — `GET /v1/tools` + `GET /v1/tools/{toolId}` — returning a normative **`ToolDescriptor`** that unifies those five surfaces behind one stable shape: `toolId`, `source`, input/output schemas, auth/egress/approval requirements, a replay policy, cost/latency hints, and a **safety tier** (composing the RFC 0069 exec carve-out). It also adds an **optional tool-session lifecycle** (opened → call-requested → auth/approval-required → result-returned → closed) for multi-step interactions, reusing RFC 0064 tool hooks for the authorization + per-call events rather than inventing parallel ones. Everything is advertisement-gated and additive; hosts that omit `capabilities.toolCatalog` are unchanged.

## Motivation

`docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0078" frames it: *tool use is spread across node packs, MCP, host surfaces, workflow-as-tool bindings, and provider-specific tool calling; agents need a portable way to know which tools exist, what they require, and how they are audited.* Concretely, three gaps:

1. **No unified discovery.** A client building an agent (or a Tool Catalog UI) must query `GET /v1/packs` for node-pack tools, the MCP server list for MCP tools, the connector manifest for connector actions, and read host-extension prose for `x-host-*` tools — four mechanisms, four shapes, no `toolId` keyspace that spans them. RFC 0077's `toolAllowlist` references tools by `<scope>:<tool-id>` but nothing resolves those strings to a description.
2. **No portable requirements/audit surface.** Whether a tool needs a credential (RFC 0046), a scope (RFC 0049), an approval gate (RFC 0051), makes network egress (RFC 0076), or is replay-deterministic (`replay.md`) is knowable only out-of-band per surface. A builder adding a tool to an agent edits a raw allowlist string blind.
3. **No safety-posture signal.** RFC 0069 carved arbitrary-command (`exec`-class) execution out of the protocol tier into host-extension scopes, but a catalog consumer has no field that says "this tool is exec-class / write-capable / read-only / pure." The danger of a tool is invisible until it runs.

The spec is the right place because *discovery shape*, *requirement vocabulary*, and *safety-tier taxonomy* are cross-host interop concerns a client depends on to render a tool picker, pre-flight missing credentials, and warn on dangerous tools. The per-surface *implementation* (how the host enumerates its MCP servers, resolves connector actions, etc.) stays a host choice; this RFC pins the projection shape, the capability gate, and the descriptor contract.

## Proposal

### §A — `capabilities.schema.json`: additive optional `toolCatalog`

```diff
   "capabilities": {
     "properties": {
+      "toolCatalog": {
+        "type": "object",
+        "description": "RFC 0078. The host exposes a read-only projection of its tool surfaces (node-pack / workflow / MCP / connector / host-extension) at GET /v1/tools + GET /v1/tools/{toolId}, returning ToolDescriptor records. Optional; hosts that omit it expose no catalog (today's behavior) and the conformance scenarios skip cleanly. Read-only — the catalog never mutates tools; tool invocation stays on the existing surfaces (agent dispatch, core.dispatch, MCP).",
+        "additionalProperties": false,
+        "required": ["supported"],
+        "properties": {
+          "supported": { "type": "boolean", "description": "REQUIRED when present. true ⇒ GET /v1/tools + GET /v1/tools/{toolId} are served per §B." },
+          "sources": {
+            "type": "array", "uniqueItems": true,
+            "items": { "type": "string", "enum": ["node-pack", "workflow", "mcp", "connector", "host-extension"] },
+            "description": "Which tool sources the catalog projects. A host advertises only the sources it actually surfaces; a consumer MUST tolerate any subset. Absent ⇒ all sources the host implements."
+          },
+          "sessionLifecycle": { "type": "boolean", "description": "true ⇒ the host emits the §D tool-session lifecycle events (tool.session.*) for multi-step tool interactions. Absent ⇒ false (single-shot tool calls only; the existing RFC 0064 agentToolCalled/agentToolReturned events still apply)." }
+        }
+      }
     }
   }
```

### §B — `GET /v1/tools` + `GET /v1/tools/{toolId}` (read-only, capability-gated)

When `capabilities.toolCatalog.supported: true`:

- **`GET /v1/tools`** — returns `{ tools: ToolDescriptor[] }`, the catalog the **authenticated principal** may see. The list MUST be scoped to the caller's authorization (RFC 0049) and tenant (a tool the principal cannot invoke MUST NOT appear), exactly as RFC 0074 scoped `GET /v1/agents`. Supports optional `?source=<source>` filtering. Read-only (`GET`); never mutates.
- **`GET /v1/tools/{toolId}`** — returns one `ToolDescriptor`; `404` for an unknown or unauthorized `toolId` (the surface never discloses a tool the principal can't see, per the RFC 0074 non-disclosure pattern).

Both are **additive optional endpoints**; a host that omits `toolCatalog` returns `404`/`501` and stays v1-compliant. The catalog is a *projection* — it does not define a new invocation path. A tool is invoked exactly as today (agent dispatch with `toolAllowlist`, `core.dispatch`, MCP call); the catalog only *describes* it.

### §C — `ToolDescriptor` (NEW `schemas/tool-descriptor.schema.json`)

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["toolId", "source", "safetyTier"],
  "properties": {
    "toolId":       { "type": "string", "minLength": 1, "description": "Stable, host-unique tool identifier in the `<scope>:<tool-id>` form RFC 0077 `toolAllowlist` references (`openwop:` core, `mcp:` MCP-namespaced, `<vendor>.<host>` host-extension). The keyspace SPANS sources so a single allowlist entry resolves to exactly one descriptor." },
    "source":       { "type": "string", "enum": ["node-pack", "workflow", "mcp", "connector", "host-extension"], "description": "Which surface backs the tool. `node-pack`: a pack typeId (RFC 0003); `workflow`: a workflow-as-tool (`core.subWorkflow`/RFC 0013); `mcp`: an MCP server tool (`host.mcp`); `connector`: an RFC 0045 connector action; `host-extension`: an `x-host-<vendor>-*` scope (RFC 0069)." },
    "title":        { "type": "string", "description": "MAY — human-readable name for UI." },
    "description":  { "type": "string", "description": "MAY — one-line summary for a tool picker." },
    "inputSchema":  { "type": "object", "description": "MAY — JSON Schema (2020-12) for the tool's arguments. Absent ⇒ opaque/host-interpreted args." },
    "outputSchema": { "type": "object", "description": "MAY — JSON Schema for the tool's result." },
    "auth": {
      "type": "object", "additionalProperties": false,
      "description": "MAY — what the caller must supply/hold to invoke. Composes RFC 0049 (scopes) + RFC 0046 (credentials).",
      "properties": {
        "scopes":        { "type": "array", "items": { "type": "string" }, "description": "RFC 0049 scopes the principal MUST hold; per-tool authorization fails closed (RFC 0064 §C)." },
        "credentialRef": { "type": "boolean", "description": "true ⇒ the tool needs a host-stored credential reference (RFC 0046); the catalog NEVER carries credential material (SR-1)." }
      }
    },
    "egress": { "type": "string", "enum": ["none", "safe-fetch", "host-mediated", "host-owned"], "description": "MAY — outbound-network posture. `none`: no egress; `safe-fetch`: via the host's RFC 0076 §B `ctx.http.safeFetch` (SSRF-guarded); `host-mediated`: host-proxied non-safeFetch; `host-owned`: the host owns the egress story (e.g. a host-extension)." },
    "approval": { "type": "string", "enum": ["never", "conditional", "always"], "description": "MAY — whether invocation requires an RFC 0051 approval interrupt. `conditional` ⇒ host-policy (e.g. over a cost/scope threshold)." },
    "replayPolicy": { "type": "string", "enum": ["deterministic", "idempotent", "non-deterministic"], "description": "MAY — replay posture (`replay.md`). `deterministic`: pure/replay-safe; `idempotent`: safe under the Layer-2 idempotency key (`idempotency.md`); `non-deterministic`: the host MUST cache the observable result (RFC 0041 §C) so replay reproduces the sequence." },
    "safetyTier": { "type": "string", "enum": ["pure", "read", "write", "exec"], "description": "REQUIRED. `pure`: no external side effects; `read`: reads external state; `write`: mutates external state; `exec`: arbitrary-command/`exec`-class — per RFC 0069 this MUST have `source: \"host-extension\"` (exec is never protocol-tier). A consumer uses this to gate/warn." },
    "costHint":    { "type": "string", "enum": ["low", "medium", "high"], "description": "MAY — advisory cost magnitude for planning UX. Non-normative." },
    "latencyHint": { "type": "string", "enum": ["low", "medium", "high"], "description": "MAY — advisory latency magnitude. Non-normative." }
  }
}
```

**Cross-field MUSTs (normative):** (1) `safetyTier: "exec"` MUST carry `source: "host-extension"` (the RFC 0069 invariant — exec is host-extension-only). (2) The descriptor is **content-free of secrets** — `auth.credentialRef: true` declares a credential is needed but the catalog MUST NOT include credential material (SR-1). (3) A tool's `toolId` MUST be stable across catalog reads for a given host version so an agent's `toolAllowlist` keeps resolving.

### §D — Tool-session lifecycle (optional, when `toolCatalog.sessionLifecycle: true`)

Most tools are single-shot (one call → one result, already covered by RFC 0064's `agentToolCalled`/`agentToolReturned`). A *tool session* models a multi-step interaction (e.g. an MCP server that opens a stateful connection, or a connector OAuth dance mid-call). The lifecycle is content-free observability over the existing call events:

```
tool.session.opened   → (RFC 0064 agentToolCalled → [auth/approval interrupt?] → agentToolReturned)+ → tool.session.closed
```

The host MAY emit `tool.session.opened { sessionId, toolId }` and `tool.session.closed { sessionId, toolId, outcome }` (content-free) bracketing one or more RFC 0064 call events. Auth/approval mid-session reuses the RFC 0051 `approval` interrupt and RFC 0049 fail-closed authorization — no new interrupt kind. A host that does not advertise `sessionLifecycle` simply treats every call as single-shot; consumers MUST tolerate the absence.

### §E — Composition (reuse, not reinvention)

- **RFC 0064 tool hooks** — the per-call authorization + `agentToolCalled`/`agentToolReturned` events are unchanged; the catalog is the *static* projection, RFC 0064 is the *runtime* signal. `auth.scopes` declares what RFC 0064 §C enforces.
- **RFC 0077 live runtime** — `toolAllowlist` entries resolve to `ToolDescriptor`s by `toolId`; a Tool Catalog UI lets a builder pick tools by descriptor instead of editing raw allowlist strings.
- **RFC 0049 / 0046 / 0051** — `auth.scopes` / `auth.credentialRef` / `approval` surface the existing RBAC / credential / approval requirements; this RFC adds no new auth primitive.
- **RFC 0076 §B** — `egress: "safe-fetch"` advertises a tool routes through the host's SSRF-guarded fetch.
- **RFC 0069** — `safetyTier: "exec"` is the catalog's honest surfacing of the exec carve-out (host-extension-only).
- **`host.mcp` / RFC 0045 / RFC 0013 / node-packs** — the `source` taxonomy; the host maps each surface's native tool list into descriptors.

### §F — Safety (normative)

1. The catalog is **read-only** — `GET` only; it MUST NOT be a tool-invocation or tool-mutation path.
2. **Authorization-scoped + non-disclosing** — `GET /v1/tools` returns only the principal's authorized/tenant-visible tools; `GET /v1/tools/{toolId}` `404`s an unauthorized id (RFC 0074 pattern; no cross-tenant disclosure).
3. **Secret-free** — descriptors carry requirement *flags* (`auth.credentialRef`), never credential material (SR-1).
4. **Exec honesty** — `safetyTier: "exec"` ⇒ `source: "host-extension"` (RFC 0069); the catalog MUST NOT present an exec-class tool as a protocol-tier (`node-pack`/`workflow`) source.

### Examples

**Positive.** An MCP filesystem-read tool: `{ "toolId": "mcp:fs.read", "source": "mcp", "title": "Read file", "inputSchema": {...}, "auth": { "scopes": ["tools:fs:read"] }, "egress": "none", "approval": "never", "replayPolicy": "idempotent", "safetyTier": "read", "costHint": "low", "latencyHint": "low" }`. A host-extension shell tool: `{ "toolId": "x-host-acme-shell", "source": "host-extension", "safetyTier": "exec", "approval": "always", "egress": "host-owned" }`.

**Negative.** `{ "toolId": "openwop:run-shell", "source": "node-pack", "safetyTier": "exec" }` — **non-conformant** by §C-1/§F-4: an `exec`-tier tool MUST be `source: "host-extension"`, never a protocol-tier `node-pack` (RFC 0069). `{ "toolId": "x", "source": "mcp" }` missing `safetyTier` fails validation (`safetyTier` required).

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). New optional `capabilities.toolCatalog` block; two new read-only endpoints behind it (a host that omits the capability `404`/`501`s them, staying v1-compliant); a new `tool-descriptor.schema.json`; optional `tool.session.*` events (additive RunEventTypes, folded best-effort). No existing field, endpoint, event, or invocation path changes — the catalog *describes* existing tools, it does not redefine how they run. No conformance pass is invalidated.

## Conformance

- **New scenarios:**
  - **`tool-descriptor-shape.test.ts`** (always-on, server-free): `tool-descriptor.schema.json` compiles; a conforming descriptor validates; the §C-1 cross-field MUST (`exec` ⇒ `host-extension`) and the `safetyTier`-required negative are enforced; `capabilities.toolCatalog` is declared.
  - **`tool-catalog-projection.test.ts`** (gated on `capabilities.toolCatalog.supported`): `GET /v1/tools` returns a `ToolDescriptor[]`, each valid; `GET /v1/tools/{toolId}` returns one + `404`s an unknown id; the list is authorization-scoped (a second principal sees a different/empty set — the §F-2 non-disclosure check). Soft-skips when unadvertised.
  - **`tool-session-lifecycle.test.ts`** (gated on `toolCatalog.sessionLifecycle`): a multi-step interaction emits `tool.session.opened` before and `tool.session.closed` after the RFC 0064 call events; content-free. Soft-skips when unadvertised.
- **Capability gating** per `conformance/coverage.md`; shape always-on, projection + session behavioral gated.
- **Reference host.** Deferred (this RFC files at `Draft`). The shape ships; the projection + session scenarios soft-skip until a reference host implements `GET /v1/tools`.

## Alternatives considered

1. **Per-source discovery only (no unified catalog).** Rejected — it leaves every client re-implementing five discovery mechanisms and offers no place for the cross-cutting requirement/safety fields. The whole value is one `toolId` keyspace + one descriptor shape.
2. **Fold tool discovery into `GET /v1/agents` (RFC 0072).** Rejected — agents and tools are distinct surfaces (an agent *uses* tools; a tool isn't an agent). Overloading the agent inventory would conflate the two and break the clean `toolAllowlist` → `ToolDescriptor` resolution.
3. **A writable tool-registration endpoint.** Rejected for this RFC — tools are registered through their existing surfaces (pack install, MCP mount, connector manifest). The catalog is a read-only projection; a write path is a much larger, separate proposal (and a bigger attack surface).
4. **Do nothing.** Rejected — the gap analysis explicitly targets a Tool Catalog UI, descriptor-based agent building, and a unified chat Tools panel, all of which need the portable descriptor. Without it, every host's tool surface stays bespoke and 0077's `toolAllowlist` strings stay opaque.

## Unresolved questions

**All four resolved at `Draft → Active` (2026-05-30) as proposed below — recorded in `Updated:`.** Retained for the rationale trail:

1. **`toolId` keyspace collisions across sources.** Two sources could mint the same `<scope>:<tool-id>` (e.g. an MCP tool and a connector action both named `mcp:fs.read`)? Proposed: the `<scope>` prefix disambiguates by construction (`mcp:` vs `connector:`), and the host MUST guarantee uniqueness within its catalog; confirm the prefix-per-source convention before `Active`.
2. **`inputSchema`/`outputSchema` Tier-1 subset.** Should descriptor schemas be constrained to the RFC 0030 Tier-1 universal subset (so a model can consume them as tool-call schemas), or stay arbitrary 2020-12? Proposed: RECOMMEND Tier-1 for `mcp`/`node-pack` tools that feed an LLM tool-call, but don't MUST it. Confirm.
3. **Session vs single-shot boundary.** Is the tool-session lifecycle worth shipping at all in v1.x, or is single-shot (RFC 0064 events) sufficient until an implementer needs multi-step sessions? Proposed: ship the `sessionLifecycle` sub-flag optional + defer the events' reference implementation; confirm whether to keep §D in the Active surface or split it to a follow-on RFC.
4. **`safetyTier` granularity.** Is the 4-value tier (`pure`/`read`/`write`/`exec`) enough, or is a `network` / `delete` distinction needed? Proposed: 4 values for v1.x; extend additively if demanded. Confirm.

## Implementation notes (non-normative)

- **Sequencing.** Composes RFC 0064 (tool hooks) + RFC 0077 (the agent consumer) + RFC 0049/0046/0051 (auth/credential/approval requirement surfacing) + RFC 0076 §B (egress) + RFC 0069 (exec safety tier) + the existing `host.mcp` / RFC 0045 / RFC 0013 / node-pack tool surfaces (the `source` taxonomy). It's a read-only projection layer; no existing surface changes.
- **Reference host.** The reference workflow-engine already exposes node-pack typeIds + (optionally) MCP peers; a first `GET /v1/tools` implementation projects those two sources, with connector/host-extension/workflow sources added as the host wires them.
- **Demo impact** (out of scope): a Tool Catalog page (every tool + missing capability + required credential + safety posture); descriptor-based agent building; a unified chat Tools panel.
- **Expected effort:** M for the schema + prose + shape conformance (this lands the surface at `Draft → Active`); L for a behavioral reference implementation (the projection endpoint over ≥2 sources + the session lifecycle).

## Acceptance criteria

Checklist for `Active → Accepted` (this RFC files at `Draft`):

- [ ] `spec/v1/tool-catalog.md` documents §B endpoints + §C descriptor + §D session lifecycle + §E composition + §F safety.
- [ ] `schemas/tool-descriptor.schema.json` (NEW) + `capabilities.schema.json` `toolCatalog` block + `api/openapi.yaml` `GET /v1/tools` + `GET /v1/tools/{toolId}` + (if §D kept) `run-event-payloads.schema.json` `tool.session.*`.
- [ ] Conformance: `tool-descriptor-shape.test.ts` (always-on) + the two gated behavioral scenarios.
- [ ] CHANGELOG entry + INTEROP-MATRIX row.
- [ ] All four Unresolved questions resolved (recorded in `Updated:`).
- [ ] Reference host implements `GET /v1/tools` over ≥1 source + passes the projection scenario, OR the RFC explicitly defers reference-host implementation.

## References

- `docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0078" — the source recommendation.
- [`RFCS/0064-tool-invocation-hooks-and-authorization.md`](./0064-tool-invocation-hooks-and-authorization.md) — per-call authorization + `agentToolCalled`/`agentToolReturned` events the catalog's `auth` + session lifecycle compose.
- [`RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md`](./0077-agent-run-lifecycle-and-live-manifest-dispatch.md) — the agent `toolAllowlist` consumer that resolves `toolId`s to descriptors.
- [`RFCS/0049-rbac-scopes-and-authorization-decisions.md`](./0049-rbac-scopes-and-authorization-decisions.md) — `auth.scopes`.
- [`RFCS/0051-approval-deployment-gate-primitive.md`](./0051-approval-deployment-gate-primitive.md) — `approval` requirement.
- [`RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md`](./0076-pack-runtime-requirements-and-host-safe-fetch.md) — `egress: "safe-fetch"`.
- [`RFCS/0069-exec-class-tool-host-extension-safety-contract.md`](./0069-exec-class-tool-host-extension-safety-contract.md) — `safetyTier: "exec"` ⇒ host-extension-only.
- [`RFCS/0045-connector-pack-manifest-action-model.md`](./0045-connector-pack-manifest-action-model.md) — the `connector` source.
- [`RFCS/0074-tenant-scoped-agent-inventory.md`](./0074-tenant-scoped-agent-inventory.md) — the authorization-scoped, non-disclosing inventory pattern §B reuses.
- [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) §`host.mcp` — the `mcp` source.
- [`spec/v1/replay.md`](../spec/v1/replay.md) — `replayPolicy` vocabulary.

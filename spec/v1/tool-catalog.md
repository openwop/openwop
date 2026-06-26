# OpenWOP Spec v1 — Portable Tool Catalog

> **Status: Stable · v1.x — reached `Accepted` via [RFC 0078](../../RFCS/0078-portable-tool-catalog-and-tool-session-contract.md) (2026-06-01).** Additive v1.x extension — not part of the v1.0 conformance gate. Lands the read-only `GET /v1/tools` + `GET /v1/tools/{toolId}` projection, the normative `ToolDescriptor` shape, the `capabilities.toolCatalog` advertisement, and the optional content-free `tool.session.*` lifecycle. The behavioral projection + session scenarios, the `GET /v1/tools` OpenAPI surface, the SDK helpers, and the reference-host catalog land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

openwop tools live behind five unrelated surfaces — node-pack typeIds (RFC 0003), workflow-as-tool (`core.subWorkflow` / RFC 0013 chains), MCP servers (`host.mcp`), connectors (RFC 0045), and host-extension scopes (`x-host-<vendor>-*` / RFC 0069) — each discoverable, if at all, only through its own mechanism. An agent (RFC 0077) is handed a `toolAllowlist` of opaque `<scope>:<tool-id>` strings with no portable way to learn what each tool _is_, what it _requires_ (credentials, scopes, approval), how it _behaves on the wire_ (egress, replay determinism), or how _dangerous_ it is. A builder adding a tool to an agent edits a raw allowlist string blind; a client building a tool picker re-implements four discovery mechanisms.

This document adds, **additively**, a read-only projection that unifies those five surfaces behind one stable [`ToolDescriptor`](../../schemas/tool-descriptor.schema.json): a `toolId` keyspace that spans sources, the input/output schemas, the auth/egress/approval requirements, a replay policy, cost/latency hints, and a **safety tier** that honestly surfaces the RFC 0069 exec carve-out. It **describes** existing tools — it does not define a new invocation path. Everything is gated on `capabilities.toolCatalog`; a host that omits it is unchanged.

## §A — Capability advertisement

A host advertises the catalog via the additive optional `capabilities.toolCatalog` block ([`capabilities.schema.json`](../../schemas/capabilities.schema.json)): `supported` (REQUIRED when present), `sources[]` (which of `node-pack`/`workflow`/`mcp`/`connector`/`host-extension` it projects; a consumer MUST tolerate any subset), and `sessionLifecycle` (whether it emits the §D events). Hosts that omit the block expose no catalog and the conformance scenarios skip cleanly.

## §B — `GET /v1/tools` + `GET /v1/tools/{toolId}` (read-only, capability-gated)

When `capabilities.toolCatalog.supported: true`:

- **`GET /v1/tools`** MUST return `{ tools: ToolDescriptor[] }`, the catalog the **authenticated principal** may see. The list MUST be scoped to the caller's authorization (RFC 0049) and tenant (a tool the principal cannot invoke MUST NOT appear), exactly as RFC 0074 scoped `GET /v1/agents`. It SHOULD support optional `?source=<source>` filtering. It MUST be read-only (`GET`); it MUST NOT mutate.
- **`GET /v1/tools/{toolId}`** MUST return one `ToolDescriptor`, or `404` for an unknown **or unauthorized** `toolId` (the surface MUST NOT disclose a tool the principal can't see — the RFC 0074 non-disclosure pattern).

Both are additive optional endpoints; a host that omits `toolCatalog` returns `404`/`501` and stays v1-compliant. The catalog is a _projection_ — a tool is invoked exactly as today (agent dispatch with `toolAllowlist`, `core.dispatch`, MCP call); the catalog only _describes_ it.

## §C — The `ToolDescriptor`

[`tool-descriptor.schema.json`](../../schemas/tool-descriptor.schema.json) is `additionalProperties: false` with REQUIRED `toolId`, `source`, `safetyTier` and OPTIONAL `title`/`description`/`inputSchema`/`outputSchema`/`auth`/`egress`/`approval`/`replayPolicy`/`costHint`/`latencyHint`. The closed vocabularies: `source ∈ {node-pack, workflow, mcp, connector, host-extension}`; `egress ∈ {none, safe-fetch, host-mediated, host-owned}`; `approval ∈ {never, conditional, always}`; `replayPolicy ∈ {deterministic, idempotent, non-deterministic}`; `safetyTier ∈ {pure, read, write, exec}`.

**Cross-field MUSTs (normative):**

1. `safetyTier: "exec"` MUST carry `source: "host-extension"` — the RFC 0069 invariant: exec-class (arbitrary-command) execution is never protocol-tier. The schema enforces this with an `if/then` clause; a `node-pack`/`workflow` descriptor claiming `exec` is non-conformant.
2. The descriptor MUST be **content-free of secrets** — `auth.credentialRef: true` declares a credential is _needed_, but the catalog MUST NOT include credential material (SR-1).
3. A tool's `toolId` MUST be **stable** across catalog reads for a given host version so an agent's `toolAllowlist` keeps resolving. The `<scope>` prefix (`openwop:`/`mcp:`/`connector:`/`<vendor>.<host>`) disambiguates sources by construction, and the host MUST guarantee uniqueness within its catalog.

`inputSchema`/`outputSchema` MAY be any JSON Schema 2020-12; for tools that feed an LLM tool-call, the host SHOULD (not MUST) constrain `inputSchema` to the RFC 0030 Tier-1 universal subset.

**`safetyTier` is a host-assigned effect classification, not a derived projection.** `safetyTier` (`pure`/`read`/`write`/`exec`) describes a tool's _data effect_; it is **orthogonal** to any permission / approval / risk tier a host already has (those are an _authorization_ axis — a read-only tool can be approval-restricted while being `safetyTier: "read"`). The host MUST assign `safetyTier` explicitly as per-tool metadata; mechanically mapping an existing risk/approval tier onto `safetyTier` mis-advertises the catalog. (`source` and `safetyTier` are likewise independent — `source` is the tool's _origin_, `safetyTier` its _effect_.)

The catalog capability and the §D session-event capability are **separate honesty gates**: a host advertising `capabilities.toolCatalog.supported` WITHOUT `sessionLifecycle` is NOT expected to emit `tool.session.*` — it serves descriptors with single-shot (RFC 0064) call events only.

## §compact — Compact projection (RFC 0112)

A host MAY advertise the additive optional flag `capabilities.toolCatalog.compactView: true` (`capabilities.schema.json`). When it does, it **MUST** honor an optional `view` query parameter on both catalog endpoints:

- **`GET /v1/tools?view=compact`** **MUST** return the envelope `{ tools: CompactToolDescriptor[] }` — NOT a bare array — exactly as §B's standard list returns `{ tools: ToolDescriptor[] }`.
- **`GET /v1/tools/{toolId}?view=compact`** **MUST** return one [`CompactToolDescriptor`](../../schemas/compact-tool-descriptor.schema.json), or `404` for an unknown/unauthorized id (the §F-2 non-disclosure pattern, unchanged).
- `view` defaults to `standard`; omitting it (or any value other than `compact`) **MUST** yield today's exact standard response. A host that does NOT advertise `compactView` **MUST** treat `view=compact` as any unknown query parameter — ignore it and return the standard view. Clients detect support via the `toolCatalog.compactView` capability flag, not by probing.

[`compact-tool-descriptor.schema.json`](../../schemas/compact-tool-descriptor.schema.json) (`additionalProperties: false`) is a **lossy projection** of `ToolDescriptor` restricted to the model-relevant fields: REQUIRED `toolId`/`source`/`safetyTier` and OPTIONAL `title`/`description`/`inputSchema`. `source` is retained so the `safetyTier: "exec" ⇒ source: "host-extension"` cross-field MUST (RFC 0069, §C-1) stays expressible — the compact schema mirrors that `if/then`. The heavy fields (`outputSchema`/`auth`/`egress`/`approval`/`replayPolicy`/`costHint`/`latencyHint`) are **omitted**. Like the full descriptor, a `CompactToolDescriptor` **MUST** be content-free of secrets (§C MUST 2).

**The compact structural subset (normative, self-contained).** When an `inputSchema` is present in a compact descriptor it **MUST**:

- have top-level `type: "object"` with an explicit `properties` map; and
- **MUST NOT** use `$ref`, `oneOf`, `allOf`, `anyOf`, `not`, `patternProperties`, or `dependentSchemas` **at any nesting depth** — including inside nested property schemas, since nested combinators are exactly the verbosity the compact view exists to drop.

This subset is the stable structural core of the RFC 0030 Tier-1 universal subset (cited as rationale), but it is **pinned in `compact-tool-descriptor.schema.json`** — not a normative dereference of the informative, drift-prone `structured-output-subset.md` table — so conformance is machine-checkable. The published schema enforces the **top-level floor**; the conformance suite enforces the **total any-depth** constraint via a schema-aware recursive walk (pure JSON Schema cannot express the recursive bound cleanly). The **standard view's** Tier-1 recommendation (§C, "the host SHOULD … constrain `inputSchema`") stays a **SHOULD**; this RFC adds a **MUST** only on the new opt-in compact surface.

**Projection completeness + authorization-scoping (normative).** The compact `tools[]` **MUST** carry the **same `toolId` set** as the standard view for the same principal — a compact catalog that drops a tool the standard view shows is non-conformant. The compact view **MUST** stay authorization-scoped and non-disclosing per the RFC 0074 pattern (§F-2): it exposes exactly the tools the principal could already see in the standard view, never more. The compact projection is a pure read transform over the existing descriptor store — no new persistence, no new invocation path.

## §D — Tool-session lifecycle (optional, when `toolCatalog.sessionLifecycle: true`)

Most tools are single-shot (one call → one result, already covered by RFC 0064's `agent.toolCalled`/`agent.toolReturned`). A _tool session_ models a multi-step interaction (an MCP server holding a stateful connection; a connector OAuth dance mid-call). The lifecycle is **content-free observability** over the existing call events:

```text
tool.session.opened  → (agent.toolCalled → [auth/approval interrupt?] → agent.toolReturned)+ → tool.session.closed
```

The host MAY emit `tool.session.opened { sessionId, toolId }` and `tool.session.closed { sessionId, toolId, outcome }` (both content-free; `outcome ∈ {completed, failed, cancelled}`) bracketing one or more RFC 0064 call events. Auth/approval mid-session reuses the RFC 0051 `approval` interrupt and RFC 0049 fail-closed authorization — **no new interrupt kind**. A host that does not advertise `sessionLifecycle` treats every call as single-shot; consumers MUST tolerate the absence.

## §E — Composition (reuse, not reinvention)

- **RFC 0064 tool hooks** — the per-call authorization + `agent.toolCalled`/`agent.toolReturned` events are unchanged; the catalog is the _static_ projection, RFC 0064 the _runtime_ signal. `auth.scopes` declares what RFC 0064 §C enforces.
- **RFC 0077 live runtime** — `toolAllowlist` entries resolve to `ToolDescriptor`s by `toolId`.
- **RFC 0049 / 0046 / 0051** — `auth.scopes` / `auth.credentialRef` / `approval` surface the existing RBAC / credential / approval requirements; no new auth primitive.
- **RFC 0076 §B** — `egress: "safe-fetch"` advertises a tool routes through the host's SSRF-guarded fetch.
- **RFC 0069** — `safetyTier: "exec"` is the catalog's honest surfacing of the exec carve-out (host-extension-only).
- **`host.mcp` / RFC 0045 / RFC 0013 / node-packs** — the `source` taxonomy; the host maps each surface's native tool list into descriptors.

## §F — Safety (normative)

1. The catalog is **read-only** — `GET` only; it MUST NOT be a tool-invocation or tool-mutation path.
2. **Authorization-scoped + non-disclosing** — `GET /v1/tools` returns only the principal's authorized/tenant-visible tools; `GET /v1/tools/{toolId}` `404`s an unauthorized id (RFC 0074 pattern; no cross-tenant disclosure).
3. **Secret-free** — descriptors carry requirement _flags_ (`auth.credentialRef`), never credential material (SR-1).
4. **Exec honesty** — `safetyTier: "exec"` ⇒ `source: "host-extension"` (RFC 0069); the catalog MUST NOT present an exec-class tool as a protocol-tier (`node-pack`/`workflow`) source.

## Open spec gaps

- The behavioral `GET /v1/tools` projection (over ≥1 source), the authorization-scoping check, and the `tool.session.*` reference emission land at `Active → Accepted` with a reference host; the always-on `tool-descriptor-shape.test.ts` ships now.
- A writable tool-registration endpoint is explicitly out of scope (tools register through their existing surfaces); revisitable in a future RFC if implementer demand surfaces.

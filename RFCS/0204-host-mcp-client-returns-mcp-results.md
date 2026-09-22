# RFC 0204: the v2 host MCP client returns MCP results

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0204                                                            |
| **Title**         | the v2 host MCP client returns MCP results unaltered, reports reachability instead of a session, and the tool catalog projects onto MCP `ToolAnnotations` by an explicit mapping; `toolCatalog` gets its v2 home |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 (filed `Draft`) · 2026-09-22 — `Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the RFC changes the *shape* a pack receives from an MCP call and the metadata a catalog publishes; it adds no outbound call, changes no idempotency or replay rule (a `callTool` is an outbound effect path governed by `replay.md`'s effect-seam rules exactly as before), and touches no identity, tenancy or certification surface. The one new safety rule (§D.3, an unclassified MCP tool is `write`) narrows what a host may claim; it grants nothing. |
| **Affects**       | `spec/v2/core/host-services.md` (new §`mcp`) · NEW `spec/v2/core/tool-catalog.md` (the `toolCatalog` v2 home) · `spec/v2/facets/mcp.schema.json` (optional `client`) · `spec/v2/declaration.json` (`mcp`, `toolCatalog`) · `schemas/v2/tool-descriptor.schema.json` (optional `annotations`) · `schemas/v2/capabilities.schema.json` (regenerated) · `spec/v1/host-capabilities.md` §host.mcp (optional `raw`), §host.dataIntegration (note) · `spec/v2/ext/dataIntegration/README.md` (note) · `docs/normative-home-baseline.json` · `SECURITY/invariants.yaml` (+1) · conformance (two new major-2 scenarios, one major-1 leg) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (§2.1; §4 "new normative requirement on a previously-undefined behavior") |
| **Supersedes**    | — (amends RFC 0078 §C by addition — `annotations` and the unclassified-MCP default — and the v1 `host.mcp` sketch by one optional field; no MUST in either changes) |
| **Superseded by** | —                                                               |

## Summary

v2 has no contract for a pack calling an MCP server: `spec/v2/core/host-services.md` covers `aiEnvelope`, `promptLibrary` and `agentRuntime`, and `ctx.mcp` appears nowhere under `spec/v2/`. v1's sketch returns `{ result: unknown, isError? }`, drops `structuredContent`, `outputSchema`, `annotations` and pagination, and reports a `connected` state that MCP 2026-07-28 no longer has. This RFC defines the v2 surface — `ctx.mcp.callTool` returning MCP's `CallToolResult` unaltered, `listTools` returning one `ListToolsResult` page with its cursor, and `serverHealth` reporting reachability from `server/discover` — adds an optional `raw` `CallToolResult` to v1's `invokeTool`, and notes that `fetchMCP` is superseded. It also gives `toolCatalog` its v2 home, adding an optional `ToolDescriptor.annotations` computed from host-assigned fields by an explicit table, never from MCP's defaults or an MCP server's untrusted hints, and a stable-order SHOULD.

## Motivation

- **The pack sees less than the wire carries.** MCP 2026-07-28 `schema.ts`: `CallToolResult extends Result { content: ContentBlock[]; structuredContent?: unknown; isError?: boolean }`, with `Result { _meta?; resultType }`. v1 `host-capabilities.md` §host.mcp: `invokeTool → { result: unknown, isError? }`. A node cannot tell server-validated structured output from display text, and loses `_meta` (review A-F3; `review/verify-AB.md` A-F3 — deltas (a), (c), (d), (e) CONFIRMED; delta (b) WRONG, because MRTR is host-mediated and a pack never needs `input_required`).
- **`listTools` truncates.** `ListToolsResult extends PaginatedResult, CacheableResult` (`nextCursor`, `ttlMs`, `cacheScope`); v1 returns `{ tools: [{ name, description?, inputSchema }] }` with no cursor, so a paginated server is silently cut.
- **`connected` describes a thing that no longer exists.** MCP 2026-07-28 changelog, major changes 1–2: "Remove protocol-level sessions and the `Mcp-Session-Id` header"; "Make MCP stateless: remove the `initialize`/`notifications/initialized` handshake". `server/discover` is now what a client probes (major change 3).
- **v2 has nothing to break.** `review/arch-P3.md` P3-H4 and `review/arch-P4.md` §6.1 reclassify this out of Phase 4: v2 defines no `ctx.mcp`, so defining it is additive, and v1's side is frozen apart from optional additions.
- **The catalog has no MCP projection, and MCP's defaults are the dangerous ones.** `schemas/v2/tool-descriptor.schema.json` is closed and has no `annotations`. MCP `ToolAnnotations` defaults are `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: true` (`schema.ts:1912-1954`), and "clients MUST consider tool annotations to be untrusted unless they come from trusted servers" (`server/tools.mdx`). `spec/v1/tool-catalog.md` §C already says the host "MUST assign `safetyTier` explicitly" and that a mechanical mapping "mis-advertises the catalog" (review A-F1, `verify-AB.md` A-F1: core CONFIRMED).
- **Order.** MCP: "Servers SHOULD return tools in a deterministic order … improves LLM prompt cache hit rates" (`server/tools.mdx`; changelog minor change 3). OpenWOP already raises this to a MUST for its own MCP mount (`spec/v1/mcp-integration.md` §D: "Ordering MUST be deterministic … sort by `name`"), and RFC 0116's `cachePrefixId` names "the RFC 0112 compact tool surface" as a cacheable prefix (`ai-envelope.md`), yet `GET /tools` has no ordering rule. The link to 0116 is indirect (the prefix is composed host-side; `verify-AB.md` A-F1 narrowing 2), so this is a SHOULD.
- **`toolCatalog` has no v2 home.** Its `normativeText` is `spec/v1/tool-catalog.md`; MyndHyve advertises `toolCatalog` (`sources` ⊇ `mcp`, `compactView`, `sessionLifecycle`) in its committed v2 bundle, so v2 depends on a v1 document for a family a production v2 host claims.

## Proposal

### §A The v2 `ctx.mcp` contract

1. A host advertising the new optional facet `mcp.client` MUST expose to pack code `ctx.mcp.callTool`, `ctx.mcp.listTools`, `ctx.mcp.readResource` and `ctx.mcp.serverHealth`, each addressed to a host-configured `serverId` and spoken at the revision the `mcp` family negotiates (`interop.md` §"Negotiation is a protocol").
2. Each rejects only for an unknown `serverId` (`not_found`), an MCP error response (the MCP `Error { code, message, data? }` carried unaltered), or a transport failure.
3. `callTool({ serverId, name, arguments?, idempotencyKey })` MUST resolve to the server's `CallToolResult` unaltered — `content[]`, `structuredContent`, `isError`, `_meta` — including when `isError` is `true` (a tool error is a result, not a rejection: MCP "Any errors that originate from the tool SHOULD be reported inside the result object"). The host handles an `InputRequiredResult` itself (the `mcp.mrtr` "InputRequiredResult (host as client)" row of `spec/v2/interop-map.json`, RFC 0208; `interop.md` §"The MCP round ceiling") and never returns one. `idempotencyKey` and replay are governed by the existing effect-seam rules; this RFC adds none.
4. `listTools({ serverId, cursor? })` MUST resolve to one `ListToolsResult` page unaltered — each `Tool` with `inputSchema`, `outputSchema`, `annotations`, `title`, `icons`, `_meta`; the page's `nextCursor`, `ttlMs`, `cacheScope` — and MUST forward a pack-supplied `cursor`. It does not merge pages. Because `ListToolsResult` is a superset of v1's `{ tools: [{ name, description?, inputSchema }] }`, v1-style reads keep working.
5. `readResource({ serverId, uri })` resolves to the `ReadResourceResult` unaltered (a superset of v1's `{ contents[] }`).
6. `serverHealth({ serverId })` MUST report `state ∈ { reachable, unreachable, incompatible }` — `reachable` when `server/discover` succeeded and its `supportedVersions` meets a revision the host would negotiate, `incompatible` when it succeeded without one, `unreachable` otherwise — from a probe no older than the `DiscoverResult`'s `ttlMs`, with the `DiscoverResult` when one was received. It MUST NOT report a connection or session state.
7. **Why `callTool` and not `invokeTool`.** `ctx.mcp.invokeTool` is v1's name for a different return shape, and SDKs type one `ctx` for pack authors across majors. Returning a different shape under the same name is the one change an SDK minor cannot absorb (`review/arch-P4.md` finding 12: "a new method name … beside the old one is the only 2.x-safe form"). v2 therefore names the method after MCP's own `tools/call` and defines neither `invokeTool` nor `serverStatus`; a host MAY keep them for packs ported from v1, with v1 semantics.

### §B The v1 `raw` field

8. v1 `ctx.mcp.invokeTool` MAY return an OPTIONAL `raw: CallToolResult`. When present it MUST be the server's result for the negotiated revision, unaltered, and `isError` MUST equal `raw.isError === true`. `result` is unchanged.

### §C `fetchMCP` is superseded

9. `ctx.dataIntegration.fetchMCP` (v1 `host-capabilities.md` §host.dataIntegration) is a second MCP client with a third result convention. In v2, `dataIntegration` is an organization-defined `extensions.<org>.dataIntegration` record with no portable operations (`spec/v2/ext/dataIntegration/README.md`), so there is nothing protocol-level to remove. Both documents gain an informative note that `ctx.mcp` supersedes it for MCP access; retiring it is its organization's decision.

### §D `toolCatalog` in v2, and the MCP annotation mapping

10. `spec/v2/core/tool-catalog.md` becomes the family's v2 home, restating every v1 MUST of `spec/v1/tool-catalog.md` (§A–§F, §compact) in v2 paths.
11. **Host-assigned, never copied.** The host MUST assign `safetyTier`, `replayPolicy` and `egress` itself and MUST NOT copy them from an MCP server's `annotations`. A `source: "mcp"` tool the host has not classified MUST be `safetyTier: "write"` — the most permissive tier an MCP tool can hold (`exec` requires `source: "host-extension"`), which is also what MCP's own defaults imply for an unannotated tool (`readOnlyHint: false`, `destructiveHint: true`).
12. **The mapping.** `ToolDescriptor.annotations`, when present, MUST carry all four hints, derived from the host-assigned fields and not from MCP defaults:

    | MCP hint | `true` iff | MCP default |
    | --- | --- | --- |
    | `readOnlyHint` | `safetyTier` ∈ {`pure`, `read`} | `false` |
    | `destructiveHint` | `safetyTier` ∈ {`write`, `exec`} | `true` |
    | `idempotentHint` | `replayPolicy` ∈ {`deterministic`, `idempotent`} | `false` |
    | `openWorldHint` | `egress` is absent or not `none` | `true` |

    All four are REQUIRED when `annotations` is present so a consumer never falls through to a default. `destructiveHint` is `true` for every `write` tool because `safetyTier` does not distinguish additive from destructive writes; `destructiveHint` and `idempotentHint` are meaningful upstream only when `readOnlyHint` is `false`, and are emitted anyway for determinism. `annotations.title` is not emitted (`ToolDescriptor.title` is the display name; MCP precedence is `title`, `annotations.title`, `name`).
13. **Order.** A host SHOULD return `tools[]` sorted by `toolId`, so an unchanged catalog reads identically.

### Normative text (v2)

`spec/v2/core/host-services.md` — the marker becomes `> **Normative home:** \`aiEnvelope\`, \`promptLibrary\`, \`agentRuntime\`, \`mcp\`.` and a section is appended:

> ## `mcp`
>
> A host advertising `mcp.client` MUST expose to pack code `ctx.mcp.callTool`, `listTools`, `readResource` and `serverHealth`, each against a host-configured `serverId` at the revision `mcp` negotiates. Each rejects only for an unknown `serverId` (`not_found`), an MCP error response (carried unaltered), or a transport failure. `callTool` MUST resolve to the server's `CallToolResult` unaltered (`content[]`, `structuredContent`, `isError`, `_meta`), including when `isError` is true; the host handles an `InputRequiredResult` itself and never returns one. `listTools` MUST resolve to one `ListToolsResult` page unaltered, `outputSchema`, `annotations`, `nextCursor`, `ttlMs` and `cacheScope` included, and MUST forward a pack's `cursor`; `readResource` resolves to the `ReadResourceResult` unaltered. `serverHealth` MUST report `reachable`, `unreachable` or `incompatible` from a `server/discover` probe no older than its `ttlMs`, with the `DiscoverResult` when one was received; it MUST NOT report a connection or session state, which MCP 2026-07-28 does not have.

NEW `spec/v2/core/tool-catalog.md`:

> # Tool catalog
>
> > **Status: Stable · RFC 0204, RFC 0078, RFC 0112.**
> > **Normative home:** `toolCatalog`.
>
> ## Why this exists
>
> v2 carried the catalog only by pointing at `spec/v1/tool-catalog.md`. This is its v2 contract, plus a projection onto MCP `ToolAnnotations`. The shapes are `schemas/v2/tool-descriptor.schema.json` and `schemas/v2/compact-tool-descriptor.schema.json`.
>
> ## The catalog
>
> A host advertising `toolCatalog` MUST serve `GET /tools` (`{ tools: ToolDescriptor[] }`) and `GET /tools/{toolId}`, both read-only. The list MUST hold only tools the caller may invoke in its tenant, and an unknown or unauthorized `toolId` MUST return `404`. `toolCatalog.sources` names the sources projected; a consumer MUST tolerate any subset. A host SHOULD return `tools[]` sorted by `toolId`, so an unchanged catalog reads identically.
>
> ## The descriptor
>
> `toolId` MUST be unique in the catalog and stable for a host version. `safetyTier: "exec"` MUST carry `source: "host-extension"`. A descriptor MUST NOT carry credential material. The host MUST assign `safetyTier`, `replayPolicy` and `egress` itself and MUST NOT copy them from an MCP server's `annotations`, which are untrusted; a `source: "mcp"` tool it has not classified MUST be `safetyTier: "write"`.
>
> `annotations`, when present, MUST carry all four MCP hints, derived from those fields and not from MCP defaults (`destructiveHint` and `openWorldHint` default to `true` upstream): `readOnlyHint` is true iff `safetyTier` is `pure` or `read`, `destructiveHint` iff it is `write` or `exec`, `idempotentHint` iff `replayPolicy` is `deterministic` or `idempotent`, and `openWorldHint` unless `egress` is `none`.
>
> ## Views and sessions
>
> A host advertising `toolCatalog.compactView` MUST answer `?view=compact` on both endpoints with `CompactToolDescriptor`s (the list as `{ tools: [...] }`) carrying the standard view's `toolId` set; a compact `inputSchema` MUST NOT use `$ref`, `oneOf`, `allOf`, `anyOf`, `not`, `patternProperties` or `dependentSchemas` at any depth. Any other `view`, or a host not advertising it, yields the standard view. A host advertising `toolCatalog.sessionLifecycle` MAY bracket calls with content-free `tool.session.opened` and `tool.session.closed`; a consumer MUST tolerate their absence.

Word count (`check-core-budget.mjs`'s whitespace split): `host-services.md` +136 (section) +1 (marker); `tool-catalog.md` 308. **445 added − 200 for `toolCatalog` homed = net +245.** `mcp` is already homed (`interop.md`); adding `host-services.md` to its `normativeText` grants nothing.

**Restatement check (no v1 MUST dropped).** v1 `tool-catalog.md` MUSTs → v2 sentence: §A consumer tolerates any `sources` subset → "a consumer MUST tolerate any subset"; §B scoped list, invisible-if-uninvocable, read-only, `404` for unknown/unauthorized → "The catalog"; §C.1 exec ⇒ host-extension, §C.2 secret-free, §C.3 stable + unique `toolId`, host-assigned `safetyTier` → "The descriptor"; §compact envelope, `404`, default view, ignore-when-unadvertised, content-free (the compact descriptor is a lossy projection of a secret-free descriptor), structural subset, same `toolId` set, authorization-scoped (same set as the scoped standard view) → "Views and sessions"; §D consumers tolerate absence → same; §F.1–§F.4 restate §B/§C. The v1 SHOULDs (`?source=` filter; Tier-1 `inputSchema` subset) are not restated: v2 core carries MUSTs, and both stay in the v2 schema descriptions.

### Wire shape

```diff
 // schemas/v2/tool-descriptor.schema.json — properties
+    "annotations": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"],
+      "description": "RFC 0204. Projection onto MCP ToolAnnotations (2026-07-28), computed from this descriptor's host-assigned safetyTier / replayPolicy / egress by the table in tool-catalog.md — never copied from an MCP server's annotations (untrusted upstream) and never left to MCP defaults. All four REQUIRED when present.",
+      "properties": {
+        "readOnlyHint": { "type": "boolean" },
+        "destructiveHint": { "type": "boolean" },
+        "idempotentHint": { "type": "boolean" },
+        "openWorldHint": { "type": "boolean" }
+      }
+    },
```

The table is also expressible in the schema, and is: an `allOf` of four `if/then` pairs (e.g. `if safetyTier ∈ {pure, read} then annotations.readOnlyHint const true, else const false`), so a mis-derived descriptor fails validation, not only the scenario.

```diff
 // spec/v2/facets/mcp.schema.json — properties
+    "client": {
+      "const": true,
+      "description": "RFC 0204. Present ⇒ the host exposes ctx.mcp.callTool / listTools / readResource / serverHealth to pack code (host-services.md §mcp). Omit when not offered (RFC 0192)."
+    },
```

`spec/v2/declaration.json`: `mcp.facets` += `"client"`; `mcp.normativeText` += `"spec/v2/core/host-services.md"`; `toolCatalog.normativeText` → `["spec/v2/core/tool-catalog.md"]`. `schemas/v2/capabilities.schema.json` regenerated. No endpoint added; `GET /tools` already exists in `spec/v2/path-manifest.json`.

v1 `spec/v1/host-capabilities.md` §host.mcp:

```diff
 ctx.mcp.invokeTool({
   serverId: string,
   toolName: string,
   args?: Record<string, unknown>,
   idempotencyKey: string,
-}) → Promise<{ result: unknown, isError?: boolean }>
+}) → Promise<{ result: unknown, isError?: boolean, raw?: CallToolResult }>
```

plus, after the block: "**`raw` (RFC 0204).** A host MAY include `raw`, the server's MCP `CallToolResult` for the negotiated revision. When present it MUST be that result unaltered, and `isError` MUST equal `raw.isError === true`." And under §host.dataIntegration, an informative note: "`fetchMCP` is superseded for MCP access by `ctx.mcp` (v1 `raw`; v2 `host-services.md` §`mcp`)." The same note, in the ext's own words, goes in `spec/v2/ext/dataIntegration/README.md` (ext prose; not counted, since no core family cites it).

**Positive example (v2).** A fake server's `structured-echo` tool returns `{ "resultType": "complete", "content": [{ "type": "text", "text": "ok" }], "structuredContent": { "n": 7 }, "_meta": { "dev.openwop.conformance/nonce": "c0ffee" } }`; `await ctx.mcp.callTool({ serverId: "conformance", name: "structured-echo", idempotencyKey: k })` resolves to exactly that object.

**Negative examples.** Resolving `{ result: { n: 7 } }` (re-wrapped; §A.3). Rejecting when the server returns `isError: true` (§A.3). Returning all three tools of a two-page server with no `nextCursor` (§A.4). `serverHealth` → `{ status: "connected" }` (§A.6). A catalog descriptor `{ safetyTier: "write", annotations: { readOnlyHint: true, … } }` (§D.12). An MCP tool the server annotates `readOnlyHint: true` that the host has never classified, listed as `safetyTier: "read"` (§D.11).

## Compatibility

**Additive.** v2: `ctx.mcp` and the `toolCatalog` home define contracts where v2 had none (`arch-P4.md` §4 row, §6.1: "a definition, not a change"); `mcp.client` and `annotations` are optional properties on closed v2 objects (RFC 0183/0186/0188 precedent). §D.11's default and §D.12's mapping bind a previously-undefined behaviour (§4's last row); a host emitting no `annotations` is untouched by §D.12, and MyndHyve's committed v2 bundle carries no row these rules invalidate (no v2 scenario reads `annotations` today). The homing restates every v1 `tool-catalog.md` MUST (the restatement check above), so no obligation MyndHyve meets under the v1 pointer is relaxed. v1: `raw` is an optional addition to a return value; existing packs ignore it; a host that omits it is unchanged. `fetchMCP` is not removed.

## Conformance

- NEW `conformance/src/scenarios/v2-mcp-client-results.test.ts` (major 2), gated on `mcp.client` and the new fixture `conformance-mcp-client` (node `core.conformance.mcp-client`, conformance-RESERVED: the host maps it to a node whose output is the resolved `ctx.mcp.*` value verbatim, and whose config selects `method`, `serverId`, `name`, `arguments`, `cursor`). The run's output is the normative observation path (`GET /runs/{runId}`), so the rows are `witnessable-gated`, not seam-gated. The suite's fake MCP server (`OPENWOP_MCP_FAKE_SERVER=true`) is extended with `structured-echo`, `always-error`, a three-tool list paged 2 + 1 with `outputSchema` and `annotations`, and a second host-configured id `conformance-down` bound to a closed port.
- NEW `conformance/src/scenarios/v2-tool-catalog-annotations.test.ts` (major 2), gated on `toolCatalog`; the unclassified-MCP leg additionally on `toolCatalog.sources ∋ mcp` with the fake server configured as a catalog source.
- Major-1 leg in `mcp-tool-roundtrip.test.ts` for `raw`.
- The existing `tool-catalog-projection`, `tool-catalog-compact-projection` and `tool-descriptor-shape` scenarios are registered for both majors (G3), with a stable-order advisory leg in `tool-catalog-projection`.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.3 `callTool` unaltered | `openwop.requirement.0204.call-tool-verbatim` — run output deep-equals the fake server's `CallToolResult`, `_meta` nonce included | the suite, with the fixture and the fake server configured | witnessable-gated |
| §A.3 tool error resolves | `openwop.requirement.0204.call-tool-iserror-resolves` — `always-error` → run `completed`, output `isError: true` and the server's `content[]` | same | witnessable-gated |
| §A.4 one page, cursor forwarded | `openwop.requirement.0204.list-tools-page` — run 1: 2 tools with `outputSchema`/`annotations` verbatim, `nextCursor`, `ttlMs`, `cacheScope`; run 2 with that cursor: 1 tool, no `nextCursor` | same | witnessable-gated |
| §A.6 reachability, no session | `openwop.requirement.0204.server-health` — `conformance` → `reachable` + `DiscoverResult`; `conformance-down` → `unreachable`; no `connected`/`disconnected` anywhere in either | same | witnessable-gated |
| §A.2 rejection classes | `openwop.requirement.0204.reject-unknown-server` — `serverId: "no-such"` → node fails with `not_found` | same | witnessable-gated |
| §B.8 v1 `raw` | `openwop.requirement.0204.v1-raw-verbatim` — when the v1 fixture output carries `raw`: equals the fake server's result, and `isError` agrees | the suite, v1 fixture `conformance-mcp-tool-roundtrip` | witnessable-gated; `inapplicable` when `raw` is absent (it is a MAY) |
| §D.11 unclassified MCP tool | `openwop.requirement.0204.mcp-unclassified-write` — the fake server's `conformance_readonly_claim` (annotated `readOnlyHint: true`) appears in `GET /tools` as `safetyTier: "write"` | the suite, with the fake server configured as a catalog source | witnessable-gated |
| §D.12 mapping | `openwop.requirement.0204.annotations-derived` — every descriptor carrying `annotations` has all four hints, each equal to the table's function of its own fields; a catalog with no `annotations` records `inapplicable`, not `pass` | the suite, unaided | witnessable-gated |
| §D.10 restated MUSTs | existing `tool-catalog-*` / `tool-descriptor-shape` rows at major 2 | the suite | witnessable-gated (G3) |
| §D.13 order (SHOULD) | `openwop.requirement.0204.catalog-order` — two reads, same order, sorted by `toolId` | the suite, unaided | advisory; not a certification row |

**How each row can fail (sabotage):** re-wrap as `{ result }` or drop `_meta` (call-tool-verbatim); throw on `isError` (iserror-resolves); merge pages or drop `annotations` (list-tools-page); return `connected`, or always `reachable` (server-health); resolve `undefined` for an unknown id (reject-unknown-server); rebuild `raw` from `result` (v1-raw-verbatim); copy `readOnlyHint` into `safetyTier` (mcp-unclassified-write); emit `readOnlyHint: true` on a `write` tool, or omit `openWorldHint` (annotations-derived). The fake server's `always-error` and paging tools are built so that a host that ignores them cannot pass: the expected output is fixed by the suite, not read from the host.

### Invariant

`tool-annotations-untrusted` — protocol tier, severity high, threat model `SECURITY/threat-model-prompt-injection.md`, tests `v2-tool-catalog-annotations.test.ts`, witness `witnessable-gated`: "A host MUST NOT derive a tool's `safetyTier`, `replayPolicy` or `egress` from an MCP server's `annotations`; an unclassified MCP tool is `write`." Registered with the scenario (the threat — a server lying about read-only — is exercised on the wire by `conformance_readonly_claim`).

## Alternatives considered

- **v2 `invokeTool` returning `CallToolResult`.** The name pack authors know. Rejected per §A.7: same name, different shape, is the change an SDK minor cannot make safely (`arch-P4.md` finding 12).
- **Keep v1's shape in v2 and add `raw` there too.** Smallest diff. Rejected: v2 has no contract to stay compatible with, and a v2 contract whose primary field is `result: unknown` enshrines the lossiness this RFC exists to fix.
- **Map MCP annotations *into* `safetyTier`.** What a naive bridge does. Rejected: annotations are untrusted upstream (MUST), `tool-catalog.md` §C forbids mechanical mapping, and a server claiming `readOnlyHint: true` would then lower its own tier.
- **Leave MCP defaults to fill missing hints.** Rejected: the defaults (`destructiveHint: true`, `openWorldHint: true`) would make every partial projection claim the opposite of what a `pure` tool is.
- **Ordering MUST.** Matches the mount's own MUST. Rejected for the catalog: MyndHyve advertises `toolCatalog` in v2 and no scenario has measured its order; a SHOULD records the intent without a certification risk.
- **Do nothing.** v2 keeps no MCP client contract, and every host invents one.

## Unresolved questions

1. Should `CompactToolDescriptor` carry `annotations` too (RFC 0112's model-facing view)? Not proposed: models rarely receive annotations; the compact schema would grow a field most consumers drop.
2. Should `ToolDescriptor` gain `icons` (MCP `Icons`)? Out of scope; `review/arch-P3.md` P3-M3 names it beside `annotations`.
3. Should `serverHealth` probe on demand, or may it answer from a cached `DiscoverResult` within `ttlMs` only? This RFC says the latter bounds staleness; a host MAY always probe.
4. Should a v2 host that offers `invokeTool` for ported packs be required to also offer `raw` there? Left to the host (§A.7 MAY).
5. Should `fetchMCP` get a `spec/v1/deprecations.json` row? Not proposed: it is a host-extension-grade surface and its organization's decision (`arch-P4.md` §4).

## Implementation notes (non-normative)

- v2-reference advertises `mcp` seam-gated with no MCP client wired into packs; MyndHyve advertises `toolCatalog` (with `mcp` source) but not `mcp` in v2. The `ctx.mcp` rows need a host that runs the `conformance-mcp-client` fixture; the catalog rows can be witnessed on MyndHyve.
- An SDK shim can present v1's `{ result, isError }` over a v2 `CallToolResult` for ported packs (`result := structuredContent ?? content`), which is why §A.7 lets a host keep `invokeTool`.

## Acceptance criteria

- [x] `Active` — 2026-09-22 (window waived; routine, not an §A.6 override).
- [ ] Spec text merged: `host-services.md` §`mcp`; `tool-catalog.md`; facet, descriptor schema and declaration; v1 `raw`; the two `fetchMCP` notes; normative-home baseline lowered (`toolCatalog` out of `v1Carried`, `v1Dependent` −1).
- [ ] Both scenarios and the v1 leg ship in a published suite, every row sabotage-proven.
- [ ] A committed v2 host bundle carries the §A rows at `executed-pass`; a committed v2 host bundle (MyndHyve preferred) carries `.annotations-derived` and `.mcp-unclassified-write` at `executed-pass` — `annotations-derived` must be non-vacuous (at least one descriptor carries `annotations`).
- [ ] `tool-annotations-untrusted` registered.
- [ ] CHANGELOG entry; `MAINTAINERS.md` waiver row.

## References

- MCP 2026-07-28 (`modelcontextprotocol/modelcontextprotocol@main`, fetched 2026-09-22): `schema/2026-07-28/schema.ts` — `Result` (`resultType` MUST, `_meta`), `PaginatedResult.nextCursor`, `CacheableResult {ttlMs, cacheScope}`, `ListToolsResult`, `CallToolResult`, `Tool` (`inputSchema`, `outputSchema`, `annotations`, `_meta`), `ToolAnnotations` (defaults), `DiscoverResult`, `ReadResourceResult`; `docs/specification/2026-07-28/server/tools.mdx` (deterministic-order SHOULD; list MAY vary by authorization; "clients MUST consider tool annotations to be untrusted"); `changelog.mdx` major 1–3, 8, minor 3, 5; `server/discover.mdx` (`serverInfo` in `_meta`, "SHOULD NOT use it to change their behavior"). https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts
- RFC 0078 (tool catalog), RFC 0112 (compact view), RFC 0116 (prefix cache), RFC 0144 (host services), RFC 0153 (MCP 2026-07-28 profile), RFC 0175 (interop), RFC 0189/0190/0191 (normative home), RFC 0192 (facet presence).
- `spec/v1/host-capabilities.md` §host.mcp, §host.dataIntegration; `spec/v1/tool-catalog.md`; `spec/v1/mcp-integration.md` §C.1, §D; `spec/v2/core/host-services.md`, `interop.md`; `spec/v2/ext/dataIntegration/README.md`.
- Review inputs: `review/verify-AB.md` A-F1, A-F3; `review/arch-P3.md` P3-H4, P3-M3; `review/arch-P4.md` finding 12, §4, §6.1.

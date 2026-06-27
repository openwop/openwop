# RFC 0112: Compact Tool Projection

| Field             | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| **RFC**           | 0112                                                                        |
| **Title**         | Compact Tool Projection                                                     |
| **Status**        | `Accepted`                                                                    |
| **Author(s)**     | David Tufts (@davidscotttufts)                                              |
| **Created**       | 2026-06-26                                                                  |
| **Updated**       | 2026-06-27 (Active → Accepted — dual-witness vs conformance suite 1.43.0: openwop-app reference host rev `00332-gm2` + MyndHyve tier-2 witness rev `00511-len`, both passing the compact-tool-projection scenario non-vacuously (toolId set-equal to standard view, op-keyword-free structural subset, invalid-view → 400), steward-curl-verified). 2026-06-26                                                                  |
| **Affects**       | `spec/v1/tool-catalog.md`, `api/openapi.yaml`, `schemas/compact-tool-descriptor.schema.json` (NEW), `schemas/capabilities.schema.json`, conformance |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                           |
| **Supersedes**    | —                                                                           |
| **Superseded by** | —                                                                           |

## Summary

`GET /v1/tools` (RFC 0078) returns `ToolDescriptor` objects that MAY inline a full JSON Schema for each tool's `inputSchema`; `tool-catalog.md` line 34 only **SHOULD**s (not MUSTs) the RFC 0030 Tier-1 universal subset for model-facing tools. A host with a large catalog therefore burns thousands of tokens of schema verbosity every time the catalog is fed to a model. This RFC adds an opt-in `?view=compact` projection to the tool-catalog endpoints that returns a defined `CompactToolDescriptor` whose heavy descriptive fields are dropped and whose `inputSchema`, when present, **MUST** satisfy a small **self-contained structural subset** pinned in a new schema (the stable core of RFC 0030 Tier-1, cited as rationale — not a normative dereference of that informative, drift-prone table). The standard (default) view is unchanged.

## Motivation

The model-facing tool surface is the largest static per-turn cost in an agent loop (red-team estimate ~5 k tokens/turn for a 20-tool catalog, ~50 k naïve). The existing catalog gives a host no *portable* way to publish a lean, model-ready view: the Tier-1 recommendation is a SHOULD, so a client integrating against an arbitrary host cannot assume a compact descriptor exists. A declarable compact projection makes "give me the cheap, model-ready catalog" a first-class, conformance-testable request — without touching the rich standard view that tooling and humans rely on.

## Proposal

### Endpoint change

`GET /v1/tools` and `GET /v1/tools/{toolId}` gain an optional `view` query parameter:

```diff
  parameters:
+   - name: view
+     in: query
+     required: false
+     schema: { type: string, enum: [standard, compact], default: standard }
+     description: >
+       RFC 0112. `compact` returns the `{ tools: CompactToolDescriptor[] }`
+       projection: heavy fields omitted and `inputSchema` bounded to a stable
+       structural subset (see CompactToolDescriptor).
```

`operationId` (`listTools`, `getTool`), tag (`tools`), and the default response are unchanged. Like `GET /v1/tools` itself (tool-catalog.md §B), the compact response is the envelope `{ tools: CompactToolDescriptor[] }` (and `GET /v1/tools/{toolId}?view=compact` returns one `CompactToolDescriptor`), and the listing **MUST** stay authorization-scoped and non-disclosing per the RFC 0074 pattern — the compact view exposes exactly the tools the principal could already see in the standard view, never more.

### CompactToolDescriptor

A new schema `schemas/compact-tool-descriptor.schema.json` (`additionalProperties: false`), a lossy projection of `ToolDescriptor` restricted to model-relevant fields:

| Field         | Required | Notes                                                                          |
| ------------- | -------- | ------------------------------------------------------------------------------ |
| `toolId`      | yes      | unchanged; stable per host version (tool-catalog.md §C MUST 3)                  |
| `source`      | yes      | retained so the `safetyTier:"exec" ⇒ source:"host-extension"` cross-field MUST (RFC 0069) stays expressible |
| `safetyTier`  | yes      | `pure`/`read`/`write`/`exec`                                                    |
| `title`       | no       | short label                                                                    |
| `description` | no       | host SHOULD truncate to a model-facing summary                                  |
| `inputSchema` | no       | when present, **MUST** satisfy the compact structural subset (below)            |

All other `ToolDescriptor` fields (`outputSchema`, `auth`, `egress`, `approval`, `replayPolicy`, `costHint`, `latencyHint`) are omitted from the compact view. Like the full descriptor, a `CompactToolDescriptor` **MUST** be content-free of secrets (tool-catalog.md §C MUST 2).

### The compact structural subset (normative, self-contained)

The token win is two levers: dropping the heavy fields above, and bounding `inputSchema` to a **stable, enumerated structural subset defined here** — *not* a dereference of the informative, drift-prone RFC 0030 Tier-1 table. When present in a compact descriptor, `inputSchema` **MUST**:

- have top-level `type: "object"` with an explicit `properties` map;
- **MUST NOT** use `$ref`, `oneOf`, `allOf`, `anyOf`, `not`, `patternProperties`, or `dependentSchemas` **at any nesting depth** (including nested property schemas — nested combinators are the verbosity this view exists to drop).

This subset is the structural core of RFC 0030 Tier-1 (cited as rationale), but is pinned in `compact-tool-descriptor.schema.json` so conformance is machine-checkable and immune to Tier-1 table drift. The published schema enforces the **top-level floor**; the conformance suite enforces the **total any-depth** constraint via a schema-aware recursive walk (pure JSON Schema can't express the recursive bound cleanly).

### Normative requirements

- A host advertising `toolCatalog.compactView: true` **MUST** honor `?view=compact` on both catalog endpoints and **MUST** return the `{ tools: CompactToolDescriptor[] }` projection.
- The compact `tools[]` **MUST** carry the same `toolId` set as the standard view for the same principal (projection completeness — a compact catalog that drops a tool the standard view shows is non-conformant).
- Any `inputSchema` present in a compact descriptor **MUST** satisfy the compact structural subset above. The **standard view's** RFC 0030 Tier-1 recommendation (tool-catalog.md §C) stays a **SHOULD** — this RFC adds a MUST only on the new opt-in compact surface.
- A host that does not advertise `toolCatalog.compactView` **MUST** treat `view=compact` as any unknown query param (ignore it; return the standard view) — clients detect support via the capability flag, not by probing.

### Capability

```diff
   "toolCatalog": {
     "type": "object",
     "properties": {
       "supported": { "type": "boolean" },
+      "compactView": { "type": "boolean",
+        "description": "RFC 0112. Host honors GET /v1/tools?view=compact returning the { tools: CompactToolDescriptor[] } projection (heavy fields dropped; inputSchema bounded to the compact structural subset)." }
     }
   }
```

### Examples

**Positive** — `GET /v1/tools?view=compact` →
`{ "tools": [{ "toolId": "mcp:search.web", "source": "mcp", "safetyTier": "read", "title": "Web search", "inputSchema": { "type": "object", "properties": { "q": { "type": "string" } }, "required": ["q"] } }] }`

**Negative** — a compact descriptor whose `inputSchema` uses `oneOf`/`$ref`/`patternProperties` → fails the compact structural subset and the compact-view conformance scenario.

## Compatibility

**Additive.** `view` is a new optional query param defaulting to `standard`; omitting it yields today's exact response. `CompactToolDescriptor` is a *narrower* shape in a new schema — no new required fields on the standard surface. Hosts that don't advertise `compactView` are unaffected. The compact structural-subset MUST and the field projection apply only inside the opt-in compact view, so no existing standard-view response becomes invalid, and the standard-view Tier-1 SHOULD (tool-catalog.md §C) is untouched.

## Conformance

- **Existing:** `tool-catalog-*` scenarios cover the standard `{ tools: ToolDescriptor[] }` shape and the Tier-1 *recommendation*; `envelope-tier-one-subset-static.test.ts` shows the static-subset-check pattern.
- **New:** `tool-catalog-compact-projection.test.ts`, gated on `capabilityFamily(d,'toolCatalog')?.compactView === true`. Asserts (all machine-checkable, no dereference of the informative Tier-1 table): compact descriptors validate against `compact-tool-descriptor.schema.json` (closed field set; heavy fields absent); every present `inputSchema` satisfies the compact structural subset (top-level object; banned combinators/$ref absent **at any nesting depth**, via a schema-aware recursive walk); and the compact `tools[]` carries the **same `toolId` set** as the standard view for the same principal (projection completeness + authorization-scoping preserved).

## Alternatives considered

1. **Make compact `inputSchema` MUST-conform to RFC 0030 Tier-1.** Rejected (architect review 2026-06-26): `structured-output-subset.md` is *informative*, self-attested, schema-less, and self-describes as advisory after 12 months — a normative MUST cannot dereference it without making conformance depend on a drifting non-normative table. The compact structural subset pins the stable core in `compact-tool-descriptor.schema.json` instead.
2. **Promote line-34 SHOULD → MUST on the standard view.** Rejected: stricter validation on an existing surface is a `COMPATIBILITY.md` §4 break (rejects catalogs that previously passed). The compact projection isolates the MUST to opt-in territory.
3. **A separate `GET /v1/tools/compact` endpoint.** Rejected: a query-param projection reuses `operationId`/auth/paging and matches the existing `?source=` filter pattern; `view` generalizes to future projections.
4. **Do nothing (hosts self-trim).** Rejected: without a declarable flag, no client can portably request the lean view, so the optimization is unobservable across hosts — same failure mode as RFC 0111 Alternative 2.

## Unresolved questions

1. Should `description` be hard-capped (e.g., ≤ 256 chars) in the compact view, or left to host discretion with a SHOULD-truncate?
2. Should `view=compact` compose with the existing `?source=` filter, or is it orthogonal? (Lean: orthogonal — they compose.)
3. ~~Is a Tier-1 validator shipped with the suite?~~ **Resolved (architect review 2026-06-26):** the constraint is a self-contained structural subset pinned in `compact-tool-descriptor.schema.json`; the scenario validates against that schema, not the informative table.

## Implementation notes (non-normative)

- The compact projection is a pure read transform over the existing descriptor store — no new persistence.
- **Reconcile with openwop-app ADR 0148 A3 (tool-surface diet):** the `CompactToolDescriptor` SHOULD be the canonical shape the host's A3 host-internal tool-surface diet already produces for the model, so the Tier-A internal compact catalog and this Tier-B wire projection are one model, not two parallel paths.
- Pairs naturally with RFC 0116 (`cachePrefixId`): a compact catalog that is byte-stable across turns is the ideal cacheable prefix.

## Acceptance criteria

- [x] Spec text merged (`tool-catalog.md` §compact projection).
- [x] `openapi.yaml` `view` param + `CompactToolDescriptor` schema/component.
- [x] `tool-catalog-compact-projection.test.ts` in the suite.
- [x] CHANGELOG entry.
- [x] A reference host advertises `toolCatalog.compactView` and passes the scenario, or reference-host impl is explicitly deferred.

## References

- `spec/v1/tool-catalog.md` (RFC 0078) line 34 (Tier-1 SHOULD); `spec/v1/structured-output-subset.md` (RFC 0030 Tier-1).
- `api/openapi.yaml` `listTools`/`getTool` (lines ~1369–1418).
- Prior art: MCP `tools/list`; OpenAI function-calling compact schemas.
- Sibling RFCs: 0111, 0113, 0114, 0115, 0116.

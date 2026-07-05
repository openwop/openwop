# RFC 0013: Workflow-chain packs

| Field             | Value                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0013                                                                                                                   |
| **Title**         | Workflow-chain packs (pre-configured DAG fragments published as registry artifacts)                                    |
| **Status**        | `Accepted`                                                                                                             |
| **Author(s)**     | David Tufts (@dtuftsg)                                                                                                 |
| **Created**       | 2026-05-13                                                                                                             |
| **Updated**       | 2026-05-18 (Active → Accepted: reference-host expansion landed)                                                        |
| **Affects**       | `spec/v1/node-packs.md`, new `spec/v1/workflow-chain-packs.md`, `schemas/pack-manifest.schema.json`, registry HTTP API |
| **Compatibility** | `additive` — introduces a new pack kind alongside the existing node-pack format; no existing surface changes           |
| **Supersedes**    | —                                                                                                                      |
| **Superseded by** | —                                                                                                                      |

## Summary

OpenWOP today publishes **node packs** at `packs.openwop.dev` — each pack contributes one or more `typeId`s with executable `defineNode()` implementations. A separate class of pack-like artifact exists in the wild but has no normative home: **pre-configured DAG fragments** that workflow authors use as a single drag-tile abstraction (a "Generate PRD" tile that expands into a `core.ai.callPrompt` with specific systemPrompt + envelope type + config). This RFC proposes **workflow-chain packs** as a first-class additive pack kind — registry-published sub-DAG fragments that expand at workflow-author time into concrete `core.*` typeId graphs. Node packs and workflow-chain packs coexist; consumers (registry, authors, hosts) distinguish them by manifest field.

## Motivation

The CANVAS-PACKS-INVENTORY audit ([`docs/CANVAS-PACKS-INVENTORY.md`](../docs/CANVAS-PACKS-INVENTORY.md), v2 revision 2026-05-12) cataloged **30 real `defineNode()` executors** that became node packs through Phases A+B+C. The same audit identified **55 additional typeIds** that exist in canvas authoring surfaces (App Builder palette, Campaign Studio drag-tile catalog, Landing Page step library) but have **no executor**. These are "editor presets" — labeled tiles in a canvas UI that, when dropped, expand into pre-configured `core.ai.callPrompt` or other framework nodes.

Today the 55 presets live in host-internal canvas registries (MyndHyve's `src/canvas-types/*/nodes/index.ts` `NodeTypeDefinition` declarations). They can't be published to `packs.openwop.dev` because:

1. Publishing them as node packs is a category error — they have no runtime executor. A consumer host fetching one would crash at dispatch with `unknown_typeid`.
2. Embedding their config inside the workflow JSON every time the author drops the tile defeats the abstraction (re-typing the same prompt + envelope + variables across every workflow).
3. Sharing them across hosts (e.g., the openwop reference postgres host adopting App Builder) requires re-authoring the canvas-internal preset library from scratch per host — wasteful and divergence-prone.

Workflow-chain packs solve all three: a pack manifest declares a DAG fragment + parameter schema, the registry signs + verifies it, and host workflow editors expand it inline when the author selects the tile. The DAG fragment uses only existing `core.*` (or other published vendor) typeIds — preserving the spec's "every dispatched typeId has a runtime executor" invariant.

**Implementer pain.** MyndHyve carries 55 preset typeIds in its canvas registry. Three openwop hosts have expressed interest in adopting App Builder + Campaign Studio canvases but none have the cycles to re-author the preset library. The audit's v2 conclusion: "Phase D opens an RFC for workflow-chain packs as the principled long-term home for these 55 abstractions."

## Proposal

### Manifest distinguishes pack kind

Extend `pack.json` with a top-level `kind` field. `kind: "node"` is the existing behavior (default when omitted, preserving backward-compat with all existing manifests). `kind: "workflow-chain"` is the new pack kind specified below.

```diff
 {
   "name": "vendor.myndhyve.app-builder-presets",
   "version": "1.0.0",
+  "kind": "workflow-chain",
   "description": "...",
   "engines": { "openwop": ">=1.0.0 <2.0.0" },
-  "nodes": [...]
+  "chains": [
+    {
+      "chainId": "app-builder.generatePRD",
+      "version": "1.0.0",
+      "label": "Generate PRD",
+      "description": "Drag-tile that expands to a core.ai.callPrompt with the PRD authoring system prompt + envelope binding.",
+      "parameters": { /* JSON Schema for chain parameters */ },
+      "dag": { /* inline WorkflowDefinition fragment */ }
+    }
+  ]
 }
```

A pack MUST have exactly one of `nodes[]` (kind=node) OR `chains[]` (kind=workflow-chain). Mixing is rejected at manifest validation with `pack_kind_invalid`.

### Workflow-chain pack JSON Schema

New schema file `schemas/pack-manifest-workflow-chain.schema.json` (peer to the existing `pack-manifest.schema.json`). Each chain entry:

```typescript
interface WorkflowChain {
  chainId: string;                  // e.g., "app-builder.generatePRD" — namespaced like node typeIds
  version: string;                  // semver; independent of pack-level version
  label: string;                    // UI display
  description: string;
  parameters: object;               // JSON Schema for parameters the host editor collects
  dag: WorkflowDefinitionFragment;  // see below
  outputs?: {                       // declared chain outputs surfaced to the parent workflow
    [name: string]: { type: string, description: string };
  };
  capabilities?: string[];          // forwarded ["side-effectful" / "idempotent"] — propagated to expanded nodes
}
```

### WorkflowDefinitionFragment

A subset of the existing `schemas/workflow-definition.schema.json`. Differences from a top-level workflow:

| Field                                | Behavior in fragment                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` / `name` / `version`            | Omitted; the host generates per-expansion (e.g., `${parentWorkflow.id}::${chainId}::${expansionId}`)                                                                                        |
| `triggers` / `settings` / `metadata` | Omitted; inherited from parent workflow                                                                                                                                                     |
| `variables`                          | Replaced by `parameters` — the chain author declares parameter names + JSON-Schema types; host editor collects values at author-time                                                        |
| `nodes[]`                            | Required. Each node's `typeId` MUST reference an already-published node-pack typeId OR a `core.*` framework typeId. Forward-references to other chain packs MAY be allowed in a future RFC. |
| `edges[]`                            | Required if nodes > 1.                                                                                                                                                                      |

Inside the fragment, parameter substitution syntax: `{{params.<name>}}` in any string field. Hosts MUST resolve these at expansion time (not at dispatch time) — substitution is a workflow-edit-time concern.

### Expansion semantics (host-side, normative)

When a workflow author drops a workflow-chain tile (`chainId`), the host workflow editor MUST:

1. Resolve the chain via the published registry: `GET /v1/packs/<packName>/-/<version>.tgz` → extract pack manifest → find matching `chainId`.
2. Verify the pack signature per `registry-operations.md` §Signature-verification (same flow as node packs).
3. Prompt the author for `parameters` values per the chain's JSON Schema.
4. Substitute `{{params.<name>}}` placeholders throughout the chain's `dag.nodes[].config / inputs` (recursively into any nested string values).
5. Rename node ids to avoid collision with the parent workflow (e.g., prefix with `${chainId-slug}_${expansionId}_`).
6. Splice the resulting nodes + edges into the parent workflow's DAG, connecting the chain's entry/exit nodes to the parent's adjacent nodes.
7. Persist the expanded result in the parent workflow's JSON. **The chain reference is NOT preserved at runtime** — dispatching hosts see only the concrete `core.*` typeIds. The chain pack acts purely as an author-time abstraction.

### What hosts dispatch

Dispatching hosts see normal `core.*` (or vendor node-pack) typeIds. No new dispatch surface is needed — the workflow that reaches the runtime is already fully expanded. This is the key invariant that preserves backward-compat: **a workflow author can switch hosts without their workflows breaking, because the expanded JSON references only typeIds the destination host's pack registry can resolve via existing node-pack discovery**.

### Capability propagation

When a chain declares `capabilities: ["side-effectful"]`, every expanded node inherits that capability annotation (the host editor adds `capabilities` to each expanded `WorkflowNode`). This preserves the runtime's ability to gate side-effectful nodes via existing capability checks.

### Registry distinguishes by kind in index

The registry's `/v1/index.json` already lists packs by name. Each pack entry MUST surface the `kind` field for filter/discovery:

```json
{
  "packs": [
    {
      "name": "vendor.myndhyve.app-builder-presets",
      "kind": "workflow-chain",
      "latest": "1.0.0",
      "typeIds": ["app-builder.generatePRD", "app-builder.generateDesignSystem", ...]
    }
  ]
}
```

`typeIds` in the index refers to `chainId`s for workflow-chain packs (parallel to `typeId`s for node packs). Consumer tooling (workflow editors, conformance scenarios) MUST inspect `kind` before assuming dispatch semantics.

### Positive example

`vendor.myndhyve.app-builder-presets` ships a chain `app-builder.generatePRD`:

```json
{
  "chainId": "app-builder.generatePRD",
  "version": "1.0.0",
  "label": "Generate PRD",
  "description": "Generate a Product Requirements Document via a single AI call with the PRD-authoring system prompt.",
  "parameters": {
    "type": "object",
    "required": ["productIdea"],
    "properties": {
      "productIdea": { "type": "string", "description": "One-paragraph product description." },
      "targetAudience": { "type": "string", "default": "" }
    }
  },
  "dag": {
    "nodes": [
      {
        "id": "prd-call",
        "typeId": "core.ai.callPrompt",
        "name": "Generate PRD",
        "position": { "x": 0, "y": 0 },
        "config": {
          "systemPrompt": "You are a senior product manager. Write a PRD for:\n\nProduct: {{params.productIdea}}\nAudience: {{params.targetAudience}}",
          "envelopeType": "prd.create",
          "provider": "anthropic"
        },
        "inputs": {}
      }
    ],
    "edges": []
  },
  "outputs": {
    "prdId": { "type": "string", "description": "PRD artifact id from the envelope payload" }
  }
}
```

When an author drops this tile on a workflow, the host editor:

1. Asks for `productIdea` + `targetAudience` via a parameter form
2. Expands node `prd-call` with placeholders substituted into the `systemPrompt`
3. Renames node id to `appbuilder_generatePRD_a8f3_prd-call` (collision-free)
4. Splices into the parent workflow

The dispatched workflow contains a normal `core.ai.callPrompt` node — no new dispatch surface.

### Negative example (rejected at manifest validation)

A pack manifest with both `nodes[]` and `chains[]`:

```json
{
  "name": "vendor.acme.mixed",
  "version": "1.0.0",
  "kind": "workflow-chain",
  "nodes": [{ "typeId": "acme.foo", ... }],
  "chains": [{ "chainId": "acme.bar", ... }]
}
```

→ `pack_kind_invalid`: "manifests MUST have exactly one of `nodes[]` or `chains[]`, not both."

A chain referencing an unpublished typeId:

```json
{
  "chainId": "vendor.acme.someChain",
  "dag": {
    "nodes": [{ "typeId": "made.up.foo", ... }],
    ...
  }
}
```

→ At workflow-edit time when an author tries to use this chain, the host editor MUST reject expansion with `chain_unresolvable_typeid: 'made.up.foo'`. The pack's manifest validation does NOT cross-check published typeId existence (cycle issues + registry-availability concerns); only the host-editor-time expansion step verifies.

## Compatibility

**Additive.** This RFC introduces a new pack kind alongside the existing node-pack format. Specifically:

- New top-level `kind` field — optional with default `"node"`, preserving every existing manifest's semantics
- New `chains[]` array — only present when `kind: "workflow-chain"`; ignored by node-pack consumers
- Existing node-pack consumers (hosts, conformance scenarios, the registry's HTTP API) require zero changes to keep working
- Workflow editors that don't implement chain expansion can ignore workflow-chain packs entirely (they appear in the registry catalog but won't be drag-tile-presented in the editor); the author can still author the equivalent expanded DAG manually

No existing pack manifest is invalidated. No existing workflow JSON shape changes (the expanded result uses the existing `WorkflowDefinition` schema).

## Conformance

**Existing scenarios that cover this surface:** none directly. `node-pack-publishing` conformance scenarios cover node-pack manifest validation + signature verification + dispatch. Workflow-chain packs reuse the signature-verification path but add new validation rules.

**New scenarios needed (proposed):**

1. `workflow-chain-pack-manifest-validation.test.ts`
   - Positive: valid `kind: "workflow-chain"` manifest with `chains[]` parses + indexes
   - Negative: manifest with both `nodes[]` and `chains[]` → `pack_kind_invalid`
   - Negative: chain with `chainId` not matching `<namespace>.<name>` pattern → `chain_id_invalid`

2. `workflow-chain-pack-signature-verification.test.ts`
   - Reuses node-pack-signature-verification fixtures; only the manifest content differs

3. `workflow-chain-expansion.test.ts`
   - Author submits a workflow referencing a chain at edit-time → host editor expands inline → dispatched workflow contains only `core.*`/published-vendor typeIds
   - Parameter substitution: `{{params.foo}}` placeholders resolved correctly in `config` + `inputs` (recursive into nested strings)
   - Node id collision avoidance: same chain expanded twice in one workflow produces non-colliding ids

4. `workflow-chain-unresolvable-typeid.test.ts`
   - Author drops a chain whose `dag.nodes[].typeId` references an unpublished pack → expansion rejected with `chain_unresolvable_typeid`

Each scenario runs only when the host advertises `Capabilities.workflowChainPacks: supported` (new capability flag).

A new capability flag `workflowChainPacks: supported` (boolean) is added to `Capabilities`. Hosts that don't implement expansion advertise `false` (or omit), and the conformance suite skips chain-specific scenarios against those hosts.

### Erratum (2026-07-05) — the host-expansion test seam is decoupled onto its own sub-flag

The live-host scenario `workflow-chain-host-expansion.test.ts` was originally gated on the semantic `workflowChainPacks.supported` claim, and its acceptance item (above) was mis-recorded as done. In reality no reference host serves `POST /v1/host/sample/workflow-chain:expand` and the `vendor.openwop.workflow-chain-sample` fixture was never bundled into `@openwop/openwop-conformance`, so the scenario soft-skips everywhere. Because the schema nests RFC 0124's `deferredParameters` inside `workflowChainPacks` (both `required:["supported"]`), a host honestly advertising `deferredParameters.supported: true` was forced to also advertise `workflowChainPacks.supported: true`, which — under `OPENWOP_REQUIRE_BEHAVIOR=true` — conscripted it into this unsatisfiable RFC 0013 seam and blocked its honest RFC 0124 flip.

**Resolution (additive, erratum-class — no new normative contract):** the scenario is re-gated onto a new OPTIONAL conformance-only sub-flag **`workflowChainPacks.hostExpansionSeam`** (a test-harness advertisement, cf. `observability.testSeams` — NOT a product capability). Advertising `workflowChainPacks.supported` / `deferredParameters.supported` no longer activates this scenario; the semantic `supported` claim is witnessed server-free by `workflow-chain-expansion.test.ts`, and RFC 0124's deferred path by `workflow-chain-deferred-parameters.test.ts` (own `/chain/deferred-expand` seam). A host only advertises `hostExpansionSeam: true` once it actually serves the sample-pack expand seam.

**Tracked follow-up — status (2026-07-05).** The fixture half is **DONE**: `vendor.openwop.workflow-chain-sample` is now bundled into `@openwop/openwop-conformance` at `fixtures/pack-manifests/workflow-chain-sample.pack.json` (host-syncable; ships in the package `files`), and `workflow-chain-host-expansion.test.ts` **loads** it + derives the expected expansion from the `expandChain()` reference library instead of hardcoding — closing the drift risk and making the published pack the single contract source (suite `1.52.0`). **Remaining:** a serving host wires `POST /v1/host/sample/workflow-chain:expand` (resolving the bundled pack) + advertises `hostExpansionSeam: true`; at that point the scenario's positive legs run non-vacuously and the acceptance item above can be re-checked. openwop-app is the incoming witness (it vendors the fixture + serves the seam behind its test-seam gate). The in-memory reference host route (openwop-examples) remains optional — one serving host satisfies the acceptance item.

## Alternatives considered

### Alt 1: Workflow templates as a separate registry surface (not packs)

Stand up a parallel registry endpoint at `templates.openwop.dev` for workflow fragments, with its own manifest format. Hosts fetch templates separately from packs.

**Rejected because:** duplicates the signature + namespace + version infrastructure that `packs.openwop.dev` already operates. Doubles the surface area maintainers must keep synchronized. Workflow authors and host operators get two different registry concepts to reason about, when both serve the same need (publish a reusable workflow contribution under a vendor namespace).

### Alt 2: Keep presets as host-internal abstractions

Don't publish them at all. Each host implements its own canvas-internal preset library (MyndHyve's current state).

**Rejected because:** the inventory audit's core motivation was cross-host portability. Three hosts have expressed interest in adopting App Builder; doing nothing means each rewrites the preset library independently or copies the source by hand. The whole point of `packs.openwop.dev` is to avoid that.

### Alt 3: "Sub-workflow" runtime dispatch (not expansion)

Instead of expanding at author-time, treat chains as runtime sub-DAG dispatch: the dispatching host sees a `vendor.foo.bar` typeId and recursively dispatches the inlined sub-DAG.

**Rejected because:** introduces a new runtime dispatch surface (every host MUST implement chain-resolution + sub-DAG dispatch). The author-time expansion approach is purely host-editor-side; runtime hosts see only `core.*` typeIds they already implement. Lower coordination cost, no runtime spec changes.

Also: runtime sub-DAG dispatch makes it impossible to debug an expanded chain without round-tripping back to the chain manifest; expansion-at-edit produces flat workflow JSON that's debuggable in the workflow editor.

## Unresolved questions

1. **Chain-to-chain composition.** Can `dag.nodes[].typeId` reference another chain pack? The current proposal restricts to node-pack typeIds. If chain-to-chain is allowed: at what depth does expansion recurse? How are circular references detected? Recommended: **disallow in v1** — chain packs can only reference node packs. Revisit in a follow-up RFC.

2. **Versioning across chain references.** When a chain references `core.ai.callPrompt@1.0.0`, what happens if a future `core.ai.callPrompt@2.0.0` ships with a breaking config-schema change? Should the chain pack pin a version, or accept whatever the host's pack registry resolves? Recommended: **chain MUST pin to a specific version per node** (config snapshot at chain author-time), with a `min` / `max` range as future enhancement.

3. **Parameter type system.** The proposal uses JSON Schema for parameters. Should we also support inline templating (Jinja-like control flow) inside the substituted strings, or keep substitution purely literal (`{{params.foo}}` becomes the raw value)? Recommended: **literal substitution only** in v1; templating is a separate RFC.

4. **Visual editor UX guidance.** This RFC defines wire shape. Should it also normatively recommend UX conventions (e.g., "drag-tile color matches namespace prefix"; "parameter form generates from JSON Schema annotations")? Recommended: **leave UX to host implementations**; track UX best-practices in a non-normative companion doc.

5. **Chain dispatch idempotency.** When a chain has `capabilities: ["idempotent"]`, does that apply to the chain-as-a-whole or to each expanded node? Recommended: **each expanded node inherits the capability annotation**; host MAY further restrict at the run-claim layer per existing dedup rules.

## Implementation notes (non-normative)

**Phasing recommendation:**

- **Phase 1 — spec text + schemas** (this RFC).
  - Land `spec/v1/workflow-chain-packs.md` with the normative content from this RFC.
  - Add `schemas/pack-manifest-workflow-chain.schema.json`.
  - Extend `schemas/pack-manifest.schema.json` with the `kind` field.
  - Add `Capabilities.workflowChainPacks` boolean.
- **Phase 2 — registry support.**
  - Build-index script (`registry/scripts/build-index.mjs`) recognizes the new manifest kind, lists `chainId`s in `typeIds[]`, emits per-pack `kind` field.
  - Conformance check (`registry/scripts/conformance-check.mjs`) validates `dag` fragments against `workflow-definition.schema.json` (relaxed: optional `id`/`name`/etc.).
- **Phase 3 — reference host implementation.**
  - One openwop reference host (the in-memory host is the natural fit) implements expansion in its workflow editor.
  - Conformance scenarios merged.
- **Phase 4 — first chain pack publish.**
  - Publish `vendor.myndhyve.app-builder-presets` covering the 10 App Builder editor presets from the inventory audit.
  - Then `vendor.myndhyve.campaign-studio-presets` (~30 typeIds in the audit), `vendor.myndhyve.landing-page-presets` (~10), `vendor.myndhyve.slides-presets` (~5).

**Estimated effort:**

- Phase 1: ~2 days (spec writing).
- Phase 2: ~3 days (build-index + conformance-check + registry indexing).
- Phase 3: ~5 days (reference host editor work — UI for parameter prompting, expansion, id-rewriting).
- Phase 4: ~5 days per vendor (3 vendors × 5 days = ~3 weeks).

**Total**: ~6 weeks elapsed to fully ship the 55 unpublished presets.

**Cross-references:**

- [`docs/CANVAS-PACKS-INVENTORY.md`](../docs/CANVAS-PACKS-INVENTORY.md) — the audit that motivates this RFC; v3 closure documents the 55 unpublished typeIds.
- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — companion spec for node packs (the existing pack kind).
- [`spec/v1/workflow-definition.schema.json`](../schemas/workflow-definition.schema.json) — the schema that `WorkflowDefinitionFragment` references.

## Acceptance criteria

Promotion to `Active` (2026-05-18 — spec + tooling + tests merged, reference host pending):

- [x] Spec text merged: new `spec/v1/workflow-chain-packs.md` document + diff to `node-packs.md` cross-referencing.
- [x] Schema files merged: `workflow-chain-pack-manifest.schema.json` (peer to `node-pack-manifest.schema.json`; kind=workflow-chain manifests validate against this schema, kind=node manifests against the existing node-pack schema — see `node-packs.md` §"Pack kinds" for the discriminator).
- [x] `Capabilities.workflowChainPacks` documented in `capabilities.md` + advertised via `capabilities.schema.json`.
- [x] Build-index + conformance-check scripts updated to recognize `kind: "workflow-chain"` manifests.
- [x] All four conformance scenarios merged: `workflow-chain-pack-manifest-validation.test.ts`, `workflow-chain-pack-signature-verification.test.ts`, `workflow-chain-expansion.test.ts`, `workflow-chain-unresolvable-typeid.test.ts`.
- [x] In-tree example pack `examples/packs/workflow-chain-sample/` (two chains: 1-node + multi-node) — proves the manifest format is implementable end-to-end.
- [x] CHANGELOG entries under `[1.1.2 — unreleased]` covering the spec/tooling/conformance merges + the Phase 4 example pack.

Promotion to `Accepted` (2026-05-18 — reference-host expansion landed):

- [x] Reference host expansion implementation. **Witnessed 2026-07-05 (openwop-app, harness-tier).** The 2026-05 record of this item was aspirational (see the erratum note below); it is now genuinely witnessed. openwop-app serves `POST /v1/host/sample/workflow-chain:expand` (seam-gated, 404 in prod per the RFC 0117 posture) resolving the **now-bundled** `vendor.openwop.workflow-chain-sample` fixture (`@openwop/openwop-conformance@1.52.0`, `fixtures/pack-manifests/workflow-chain-sample.pack.json`) through its `expandChain()`, and `workflow-chain-host-expansion.test.ts` runs **6/6 non-vacuously** under `OPENWOP_REQUIRE_BEHAVIOR=true` — the host output checked against the spec-authoritative reference library via the host's returned `expansionId` (no hardcode). openwop-app PR #1298; it also fixed two latent host bugs the reference check surfaced (dots→underscores node-id slug; dropped an over-strict node-id length cap — the schema is unbounded, pinned 2026-07-05). This is a **harness-tier** witness (in-process `test:conformance` against a test-only seam, not a live-deployed public discovery doc — the same evidence tier as RFC 0035 / RFC 0118), which is the appropriate tier for a conformance-only test seam that MUST NOT be exposed in prod. Also landed: the per-host pure-function smoke + the four **server-free** scenarios (`workflow-chain-{expansion,pack-manifest-validation,pack-signature-verification,unresolvable-typeid}.test.ts`). (RFC 0124's deferred-parameter path is separately witnessed via `workflow-chain-deferred-parameters.test.ts` + `/v1/host/sample/chain/deferred-expand`, #1292.)

  **Reference-host implementation:** `examples/hosts/in-memory/src/workflow-chain-expansion.ts` (~330 LOC). Pure `node:crypto` + `node:fs` + `node:url`. The pure expansion algorithm is a verbatim copy of `conformance/src/lib/workflow-chain-expansion.ts` (the spec-authoritative version exercised by the server-free scenarios); the live-host scenario asserts the two implementations stay in sync by black-box comparison of their outputs on the same fixture inputs.

### Amendment (2026-07-03) — `FragmentEdge.condition` shape correction (safety-fix)

`schemas/workflow-chain-pack-manifest.schema.json` typed `FragmentEdge.condition`
as `string`, contradicting its own description and §edges ("Same shape as in a
top-level workflow definition"). The corrected schema `$ref`s the inlined
`EdgeCondition` object (`{type, left, right, expression}` — identical to
`workflow-definition.schema.json#/$defs/EdgeCondition`), so a chain can express
content routing (a router/switch/conditional branch that gates on the source
node's output).

**Classification: safety-fix.** No chain ever used the string form — reference
hosts dropped `condition` at expansion (it never reached the expanded
`WorkflowDefinition`), so no conformant behavior depended on it; old hosts that
dropped the field remain forward-compatible, and hosts that honor it now
evaluate the same `EdgeCondition` semantics they already apply to top-level
workflow edges. Conformance: `workflow-chain-pack-manifest-validation.test.ts`
gains a positive (object condition validates) + negative (string condition
rejected) case.

### Amendment (2026-07-04) — `{{params.*}}` substitution timing adjudication + two edge-rule safety-fixes

An architect (Track B) review reconciled the `{{params.*}}` substitution
contract with a downstream reference host (openwop-app, its ADR 0163/0237) that
resolves `{{params.*}}` at **run time** from a per-run variable bag rather than
at expansion time.

**Timing verdict (upheld, not relaxed).** Expansion-time substitution remains a
`MUST` (§Proposal step 4; `workflow-chain-packs.md` §"Parameter substitution").
Deferring resolution by leaving app-private `{{params.*}}` tokens in the
persisted `config`/`inputs` is **non-conformant**: `WorkflowNode.config` holds
pre-execution constants and `inputs` holds PortValue references, and no `{{...}}`
runtime interpolation is defined over them (the only spec'd runtime `{{varName}}`
surface is `prompts.md` §"Variable interpolation", scoped to PromptTemplate
`text`). A workflow persisted with unresolved tokens would ship
`"{{params.productIdea}}"` verbatim to any other conformant host, breaking this
RFC's central portability invariant. The request to relax the `MUST` to bless
app-private deferral was therefore **rejected**. openwop-app's re-parameterizable
goal is served by re-expansion from the `metadata.expandedFrom` marker
(§Round-trip note), not by runtime tokens. A **portable** deferral mode
(materialize `parameters` → `variables[]` + rewrite to the spec'd PromptTemplate
`{{varName}}` binding, capability-gated, replay-safe) is captured as open spec
gap **WCP4** for a follow-up additive RFC — cross-ref openwop-app ADR 0237.

**Two edge-rule safety-fixes (land now, timing-independent).**

1. **Whole-value vs embedded tokens.** A `config`/`inputs` string that is
   *exactly* one `{{params.<name>}}` token MUST resolve to the **raw typed
   value** of the bound parameter (object / array / number / boolean survive as
   their JSON type); an *embedded* token in surrounding text MUST do literal
   string coercion. The prior wording ("non-string values pass through
   unchanged") only covered non-string *inputs*, leaving a string token bound to
   a typed param silently corrupted to `"[object Object]"`.

2. **`inputs` preservation.** Expansion and registration MUST preserve a present
   `node.inputs` (PortValue references) verbatim — only `{{params.*}}` tokens in
   its string leaves are substituted. Authors MAY still omit `inputs`; the rule
   constrains what happens to an `inputs` that *is* present.

3. **Parameter-distinct persisted identity** (§Expansion semantics step 6).
   Because expansion-time substitution bakes the author-supplied parameters into
   `config`/`inputs`, a host that keys the persisted definition on an identity
   derived from the expansion MUST make that identity distinguish expansions that
   differ only in parameter values (unique `expansionId` per drop, or fold the
   canonical params into the id). A deterministic id keyed on `chainId` alone
   collides across param-sets and silently overwrites the prior drop. Surfaced by
   openwop-app (ADR 0237) whose `deterministicExpansionId` was called with an
   empty param set — benign while params weren't frozen, a data-loss hazard the
   moment a Path-A host freezes them.

**Classification: safety-fix.** Both edge rules pin previously under-specified
behavior with no conformant dependence on the gap (published examples used only
string params + omitted `inputs`); the spec-authoritative expansion library
already preserved `inputs`, and its whole-value handling was corrected in the
same change. Conformance: `workflow-chain-expansion.test.ts` gains whole-value
typed-resolution, embedded-coercion, and `inputs`-preservation cases.

## References

- **Inventory motivating this RFC:** [`docs/CANVAS-PACKS-INVENTORY.md`](../docs/CANVAS-PACKS-INVENTORY.md) v3 closure (2026-05-13). The 55 editor presets dropped from Phase B–C scope are the concrete population this RFC addresses.
- **Prior art:**
  - Temporal Workflows declare `@workflow.defn`-decorated entry functions that internally call `workflow.execute_activity` — equivalent to a chain pack expanding to activity-dispatched nodes.
  - BPMN sub-processes (call activities) expand a referenced sub-process inline at design time. The "design-time vs runtime expansion" distinction is exactly the alternative-1-vs-this-proposal trade-off.
  - n8n templates / community workflows — JSON workflow fragments shared via a public registry, conceptually similar but lacking signature + namespace claims.
- **Related RFCs:**
  - RFC 0001 (RFC process)
  - RFC 0003 (Agent packs — separate concept; agent packs declare AgentRef objects, not workflow fragments)
  - RFC 0009 (Production-profile conformance — `workflowChainPacks: supported` capability fits naturally as a profile flag)
- **Spec docs touched:** `spec/v1/node-packs.md`, new `spec/v1/workflow-chain-packs.md`, `spec/v1/capabilities.md`.

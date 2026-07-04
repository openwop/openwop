# OpenWOP Spec v1 — Workflow-Chain Packs

> **Status: Draft (2026-05-17).** Closes Phase 1 of [RFC 0013 — Workflow-chain packs](../../RFCS/0013-workflow-chain-packs.md). Specifies a new pack kind that publishes pre-configured DAG fragments — registry-distributed sub-workflows that hosts expand inline at workflow-author time. Promotes to FINAL when (a) the reference host implements expansion and (b) at least the manifest-validation + expansion conformance scenarios both pass. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

---

## Why this exists

Node packs (`node-packs.md`) distribute **executable typeIds** — each pack contributes one or more `defineNode()` implementations the engine dispatches at run time. A parallel class of pack-like artifact exists in real-world canvas editors: **pre-configured DAG fragments** authors drag onto the canvas as a single tile that expands into a small graph of `core.*` nodes with specific config, system prompts, and envelope bindings.

Today these "editor presets" live in host-internal canvas registries with no normative home. Publishing them as node packs is a category error (they have no runtime executor — a consumer host fetching one would crash at dispatch with `unknown_typeid`). Embedding their config inline in every workflow defeats the abstraction (re-typing the same system prompt + envelope + variables). Sharing them across hosts requires re-authoring per host.

**Workflow-chain packs** solve all three: a pack manifest declares a DAG fragment + parameter schema, the registry signs + verifies it, and host workflow editors expand it inline when the author selects the tile. The expanded DAG uses only existing `core.*` (or other published vendor) typeIds — **preserving the spec's "every dispatched typeId has a runtime executor" invariant**. Dispatching hosts see no new typeIds; the chain pack is a workflow-edit-time abstraction only.

---

## Pack kind discriminator

The `pack.json` manifest is shared between node packs and workflow-chain packs. A top-level `kind` field distinguishes them:

| Value                 | Behavior                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"node"` (or omitted) | Node pack per `node-packs.md`. Manifest validates against `schemas/node-pack-manifest.schema.json`. Contributes `nodes[]` (and optionally `agents[]`). |
| `"workflow-chain"`    | Workflow-chain pack per this document. Manifest validates against `schemas/workflow-chain-pack-manifest.schema.json`. Contributes `chains[]`.          |

Manifests MUST have **exactly one** of `nodes[]` (kind=node) OR `chains[]` (kind=workflow-chain). Manifests containing both MUST be rejected at manifest validation with error code `pack_kind_invalid`. Manifests declaring `kind: "workflow-chain"` without a `chains[]` array MUST be rejected with `invalid_manifest`.

**Backward-compatibility.** Every existing pack manifest (no `kind` field) is treated as `kind: "node"`. No existing manifest is invalidated. Node-pack consumers (hosts, conformance scenarios, registry HTTP API) require zero changes to keep working.

---

## Pack identity

Naming follows the same reverse-DNS convention as node packs (`node-packs.md` §Naming). Reserved scopes (`core.*`, `vendor.<org>.*`, `community.<author>.*`, `private.<host>.*`, `local.*`) apply identically. The public registry at `packs.openwop.dev` MUST refuse `private.*` and `local.*` workflow-chain-pack uploads with `400 invalid_pack_scope`.

Versioning follows Semantic Versioning 2.0.0 per `node-packs.md` §Versioning. Range syntax and lockfile semantics (`schemas/pack-lockfile.schema.json`) apply unchanged.

---

## Manifest format

A workflow-chain pack manifest is JSON at the pack root (`pack.json`). Schema: `schemas/workflow-chain-pack-manifest.schema.json`.

```json
{
  "name": "vendor.acme.editor-presets",
  "version": "1.0.0",
  "kind": "workflow-chain",
  "description": "Author-time editor presets for the Acme product line.",
  "engines": { "openwop": ">=1.0.0 <2.0.0" },
  "chains": [
    {
      "chainId": "vendor.acme.generatePRD",
      "version": "1.0.0",
      "label": "Generate PRD",
      "description": "Drag-tile that expands to a core.ai.callPrompt with the PRD authoring system prompt + envelope binding.",
      "parameters": {
        "type": "object",
        "required": ["productIdea"],
        "properties": {
          "productIdea":    { "type": "string" },
          "targetAudience": { "type": "string", "default": "" }
        }
      },
      "dag": {
        "nodes": [
          {
            "id": "prd-call",
            "typeId": "core.ai.callPrompt",
            "config": {
              "systemPrompt": "You are a senior PM. Write a PRD for: {{params.productIdea}}\nAudience: {{params.targetAudience}}",
              "envelopeType": "prd.create",
              "provider": "anthropic"
            }
          }
        ],
        "edges": []
      },
      "outputs": {
        "prdId": { "type": "string", "description": "PRD artifact id from the envelope payload" }
      }
    }
  ]
}
```

### Required top-level fields

| Field             | Description                                                                  |
| ----------------- | ---------------------------------------------------------------------------- |
| `name`            | Pack name per §Pack identity.                                                |
| `version`         | Pack-level semver.                                                           |
| `kind`            | MUST be `"workflow-chain"`.                                                  |
| `engines.openwop` | Semver range — which openwop protocol versions this pack works against.      |
| `chains[]`        | One or more chain entries (§Chain entry shape). At least one chain required. |

Optional top-level fields: `description`, `author`, `license`, `homepage`, `repository`, `keywords[]`, `dependencies` (other node packs whose typeIds this pack's chains reference), `signing` (per `node-packs.md` §signing).

Workflow-chain packs MUST NOT include `nodes[]`, `agents[]`, or `runtime` — those fields are reserved for node packs. Manifests carrying them are rejected at validation with `pack_kind_invalid`.

### Chain entry shape

Each entry in `chains[]`:

| Field          | Type                       | Required | Notes                                                                                                                                                                                                                                                                                                                                |
| -------------- | -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chainId`      | string                     | yes      | Namespaced like a node typeId (reverse-DNS pattern). MUST match `^[a-z][a-zA-Z0-9._-]*$`. Each `chainId` MUST be unique within the pack.                                                                                                                                                                                             |
| `version`      | string                     | yes      | Per-chain semver. MAY differ from the pack-level `version` so a single pack can ship multiple chains that evolve independently.                                                                                                                                                                                                      |
| `label`        | string                     | yes      | Human-readable display label for the host editor's drag-tile catalog.                                                                                                                                                                                                                                                                |
| `description`  | string                     | yes      | One-paragraph description of what the chain produces.                                                                                                                                                                                                                                                                                |
| `parameters`   | JSON Schema 2020-12 object | yes      | Schema for the parameter values the host editor MUST collect from the author at drop time. Hosts MUST validate author-supplied parameters against this schema and reject invalid input with `chain_parameter_invalid` before expansion.                                                                                              |
| `dag`          | WorkflowDefinitionFragment | yes      | The fragment to splice (§WorkflowDefinitionFragment below).                                                                                                                                                                                                                                                                          |
| `outputs`      | map                        | no       | Declared outputs the chain surfaces to the parent workflow. Keys are output names; values declare `{ type: string, description: string }`.                                                                                                                                                                                           |
| `capabilities` | string array               | no       | Capability traits to propagate to every expanded node. Values from the existing `nodes[].capabilities` enum (`streamable` / `cacheable` / `side-effectful` / `mcp-exportable`). Hosts MUST copy these into each expanded `WorkflowNode.capabilities` so existing capability checks (e.g., side-effect gating) cover expanded chains. |

---

## WorkflowDefinitionFragment

A subset of `schemas/workflow-definition.schema.json`. Differences from a top-level workflow:

| Field                                | Behavior in fragment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` / `name` / `version`            | MUST be omitted. Host generates per-expansion (`${parentWorkflow.id}::${chainId}::${expansionId}`).                                                                                                                                                                                                                                                                                                                                                                                                   |
| `triggers` / `settings` / `metadata` | MUST be omitted. Inherited from parent.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `variables`                          | Replaced by top-level `parameters`. Host editor collects values at author-time.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `nodes[]`                            | Required. Each node's `typeId` MUST reference a published node-pack typeId OR a reserved `core.*` typeId. Each fragment node mirrors the shape of a top-level `WorkflowNode` (per `schemas/workflow-definition.schema.json#/$defs/WorkflowNode`) with relaxed `required[]` — chain authors MAY omit `name`/`position`/`config`/`inputs` for trivial pass-through nodes. The `FragmentNode` definition in `workflow-chain-pack-manifest.schema.json` SHOULD be kept in sync as `WorkflowNode` evolves. |
| `edges[]`                            | Required when `nodes.length > 1`. Same shape as in a top-level workflow definition — including an optional `condition` (the `EdgeCondition` object `{type, left, right}`), so a chain MAY express content routing (a branch that fires only when the condition holds against the source node's output). Hosts that honor edge conditions on top-level workflows MUST honor them on expanded chain edges identically.                                                                                     |

### Parameter substitution

String fields in the chain's `dag` MAY contain `{{params.<name>}}` placeholders. Hosts MUST resolve these at **expansion time** — when the author drops the tile — by substituting the author-supplied parameter values literally. Substitution MUST recurse into nested string values within `config` and `inputs`; non-string values pass through unchanged.

**Whole-value vs embedded tokens.** A string field whose value is **exactly** one `{{params.<name>}}` token — with no surrounding text — MUST resolve to the **raw typed value** of the bound parameter: an `object` / `array` / `number` / `boolean` parameter reaches the expanded node as its JSON type, not a string coercion. A token that appears **embedded** in surrounding text (e.g., `"docs for {{params.name}}"`, or two adjacent tokens) MUST be resolved by literal string substitution (each bound value coerced to its string form). This makes typed chain parameters (`parameters.properties.<name>.type` other than `string`) usable as whole-value node-config or input values without silent `"[object Object]"` corruption. An undeclared parameter (no matching key in the author-supplied values) resolves to the empty string in both cases.

**`inputs` preservation.** When a fragment node carries a populated `inputs` object (PortValue references per `schemas/workflow-definition.schema.json#/$defs/WorkflowNode`), expansion and registration MUST preserve it verbatim — only `{{params.*}}` tokens within its string leaves are substituted. Hosts MUST NOT drop a present `inputs` map during expansion or when persisting the spliced workflow. (Authors MAY still omit `inputs` for trivial pass-through nodes per §WorkflowDefinitionFragment; this rule constrains what happens to a `inputs` that *is* present.)

Substitution is a workflow-edit-time concern; the dispatching runtime sees concrete string values with no placeholders remaining. Hosts MUST NOT defer substitution to dispatch time. Re-parameterization of an already-dropped tile is a **re-expansion** concern — a host offers it by re-running expansion from the `metadata.expandedFrom` marker (§Round-trip note) with fresh parameter values, not by leaving `{{params.*}}` tokens in the persisted definition for a runtime to resolve. `{{params.*}}` is not a runtime-interpolation construct: `WorkflowNode.config` holds pre-execution constants and `inputs` holds PortValue references, and no `{{...}}` interpolation is defined over them (the only spec'd runtime `{{varName}}` surface is `prompts.md` §"Variable interpolation", scoped to PromptTemplate `text`). A workflow persisted with unresolved `{{params.*}}` in `config`/`inputs` is therefore non-portable — a destination host treats the placeholder as a literal constant. See §Open spec gaps WCP4 for a proposed portable deferral mode.

Templating beyond literal substitution (conditional rendering, loops, expression evaluation) is out of scope for v1. Future RFCs MAY add richer expression syntax under a distinct prefix (e.g., `{{expr:...}}`) without altering literal-`{{params.<name>}}` semantics.

### Typed-output references

A chain's `outputs[name]` MAY reference output port values from any node in the chain's `dag` via the existing `WorkflowDefinition` output-mapping mechanics. The host MUST surface these as named outputs on the chain-as-a-whole when callers of the expanded chain reference `chainOutputs.<name>`. The substitution is performed at expansion time as a one-shot rewrite into the parent workflow's edges.

---

## Expansion semantics (normative)

When a workflow author drops a workflow-chain tile (`chainId`) onto a canvas, the host workflow editor MUST:

1. **Resolve the chain.** Fetch the pack from the registry (`GET /v1/packs/<packName>/-/<version>.tgz`), extract the manifest, find the matching `chainId`. Hosts MAY cache resolution results; the integrity hash and Ed25519 signature MUST still be verified per `node-packs.md` §Signing every time a new pack version is encountered.
2. **Verify signature.** Per `node-packs.md` §Signing — identical verification flow as node packs. Failed verification MUST abort expansion with `pack_signature_invalid`.
3. **Validate referenced typeIds.** Every `dag.nodes[].typeId` MUST resolve to either a reserved `core.*` typeId OR a typeId published by a known node pack registered with the host. Hosts MUST reject expansion with `chain_unresolvable_typeid: '<typeId>'` if any referenced typeId is unknown.
4. **Prompt for parameters.** The host editor MUST collect values for the chain's `parameters` schema from the author. Author input MUST be validated against the schema; invalid input MUST be rejected with `chain_parameter_invalid` BEFORE expansion proceeds.
5. **Substitute placeholders.** Replace every `{{params.<name>}}` placeholder in `dag` (recursively through string fields in `config` / `inputs`) with the corresponding author-supplied value, honoring the whole-value-vs-embedded token rule and the `inputs`-preservation rule in §Parameter substitution.
6. **Rewrite node ids for collision avoidance.** Generate a per-expansion id prefix (e.g., `${chainIdSlug}_${expansionId}_`) and apply it to every `dag.nodes[].id` plus every reference to those ids in `dag.edges[]`. Hosts SHOULD make `expansionId` unique within the parent workflow (random 4-hex suffix is sufficient).
7. **Splice into the parent workflow.** Append the expanded nodes + edges to the parent's `nodes[]` / `edges[]`. Connect the chain's entry/exit nodes to the parent's adjacent nodes (the host editor's UI controls which adjacency).
8. **Propagate capabilities.** When the chain declares top-level `capabilities[]`, copy that array into every expanded `WorkflowNode.capabilities` so existing capability gates (e.g., `side-effectful` gating) apply to the expanded nodes.
9. **Persist the expansion.** Save the resulting expanded workflow JSON to the host's workflow store. **The chain reference is NOT preserved at runtime** — dispatching hosts see only the concrete `core.*` (or published-vendor) typeIds the expansion produced.

### What hosts dispatch

The runtime engine sees a normal `WorkflowDefinition` with no workflow-chain-pack-specific surface. No new dispatch semantics are required; **a workflow author can switch hosts without their workflows breaking, because the expanded JSON references only typeIds the destination host's pack registry can resolve via existing node-pack discovery**. This is the key invariant that lets this RFC be additive.

### Round-trip note

Hosts MAY optionally annotate expanded nodes with a `metadata.expandedFrom: { chainId, chainVersion, expansionId }` marker for editor "undo" / "re-expand" workflows. The runtime engine MUST ignore unknown metadata fields per `COMPATIBILITY.md` §2.1. The marker is purely a host-editor concern; it carries no normative meaning at dispatch time.

---

## Capability gating

Hosts that implement workflow-chain pack expansion advertise this via `Capabilities.workflowChainPacks.supported: true` (see `capabilities.md`). The conformance suite uses this flag to scope chain-specific scenarios — hosts that don't implement expansion MUST be skipped from those tests, not failed.

Workflow-chain-pack consumers (registries, conformance scenarios, host editors) MUST inspect `kind` BEFORE assuming dispatch semantics. A registry that returns a pack entry with `kind: "workflow-chain"` is signaling that the pack is NOT directly dispatchable.

---

## Registry integration

The registry's `/v1/index.json` MUST surface a per-pack `kind` field:

```json
{
  "packs": [
    {
      "name": "vendor.acme.editor-presets",
      "kind": "workflow-chain",
      "latest": "1.0.0",
      "typeIds": ["vendor.acme.generatePRD", "vendor.acme.generateDesignSystem"]
    },
    {
      "name": "core.openwop.flow",
      "kind": "node",
      "latest": "1.0.0",
      "typeIds": ["core.openwop.flow.if", "core.openwop.flow.switch", "..."]
    }
  ]
}
```

For workflow-chain packs, `typeIds[]` in the index refers to `chainId`s (parallel to `typeId`s for node packs). Consumers wanting strict types-vs-chains discrimination MUST inspect `kind`.

The registry's `PUT /v1/packs/{name}/-/{version}.tgz` handler MUST extract the manifest and validate it against the appropriate schema per the `kind` discriminator. Validation errors return `400 invalid_manifest` carrying the failing JSON-pointer path; `kind`/`nodes`/`chains` mixing rejected with `400 pack_kind_invalid`.

---

## Examples

### Positive: 1-node chain

`vendor.acme.editor-presets` ships a chain `vendor.acme.generatePRD` that expands to a single `core.ai.callPrompt` with the PRD-authoring system prompt:

```json
{
  "chainId": "vendor.acme.generatePRD",
  "version": "1.0.0",
  "label": "Generate PRD",
  "description": "Generate a Product Requirements Document via a single AI call.",
  "parameters": {
    "type": "object",
    "required": ["productIdea"],
    "properties": {
      "productIdea":    { "type": "string", "description": "One-paragraph product description." },
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

When an author drops this tile on a workflow `workflow-abc`, the host editor:

1. Collects `productIdea` + `targetAudience` via a parameter form generated from the chain's `parameters` schema.
2. Substitutes the values into the `systemPrompt` placeholder.
3. Renames the node id to `vendor_acme_generatePRD_a8f3_prd-call` (collision-free within the parent workflow).
4. Splices the resulting node into `workflow-abc.nodes[]` and wires its edges.

The persisted workflow contains a normal `core.ai.callPrompt` node — **no new dispatch surface**, no preserved chain reference.

### Negative: kind/contents mismatch

A manifest with both `nodes[]` and `chains[]`:

```json
{
  "name": "vendor.acme.mixed",
  "version": "1.0.0",
  "kind": "workflow-chain",
  "engines": { "openwop": ">=1.0.0" },
  "nodes": [{ "typeId": "vendor.acme.foo", "version": "1.0.0", "category": "data", "role": "pure" }],
  "chains": [{ "chainId": "vendor.acme.bar", "version": "1.0.0", "label": "B", "description": "x", "parameters": {}, "dag": { "nodes": [], "edges": [] } }]
}
```

→ Registry MUST reject with `400 pack_kind_invalid: "manifests MUST have exactly one of nodes[] or chains[], not both."`

### Negative: chain references unpublished typeId

A chain declares a `dag.nodes[].typeId` the destination host cannot resolve:

```json
{
  "chainId": "vendor.acme.someChain",
  "version": "1.0.0",
  "label": "Some Chain",
  "description": "x",
  "parameters": {},
  "dag": {
    "nodes": [{ "id": "n1", "typeId": "made.up.foo", "config": {} }],
    "edges": []
  }
}
```

→ At workflow-edit time, the host editor MUST reject expansion with `chain_unresolvable_typeid: 'made.up.foo'`. The pack's manifest validation does NOT cross-check published typeId existence (cycle issues + registry-availability concerns); only the host-editor-time expansion step verifies — by which point the destination host's pack registry has authoritative knowledge of which typeIds it can resolve.

---

## Error codes

Hosts and registries operating on workflow-chain packs MUST use these error codes:

| Code                        | Surface                           | Trigger                                                                                                                 |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pack_kind_invalid`         | Registry validation + host editor | Manifest mixes `nodes[]`/`agents[]` and `chains[]`, OR `kind: "workflow-chain"` with no `chains[]`.                     |
| `invalid_manifest`          | Registry validation               | `pack.json` fails schema validation. Includes failing JSON-pointer path in `details`.                                   |
| `chain_unresolvable_typeid` | Host editor expansion             | Chain's `dag` references a typeId not registered with the host. `details.typeId` carries the offending value.           |
| `chain_parameter_invalid`   | Host editor expansion             | Author-supplied parameter values fail the chain's `parameters` schema. `details.path` carries the failing JSON-pointer. |
| `pack_signature_invalid`    | Host editor expansion             | Pack signature verification failed (same surface as node packs; reused unchanged from `node-packs.md`).                 |

---

## Conformance

**Landed scenarios (all server-free against the reference expansion library at [`conformance/src/lib/workflow-chain-expansion.ts`](../../conformance/src/lib/workflow-chain-expansion.ts)):**

1. `workflow-chain-pack-manifest-validation.test.ts` — Positive: a valid `kind: "workflow-chain"` manifest parses + indexes via the registry build path; the in-repo [`examples/packs/workflow-chain-sample/`](https://github.com/openwop/openwop-examples/tree/main/examples/packs/workflow-chain-sample) pack validates from disk. Negatives: manifest with both `nodes[]` and `chains[]` returns `pack_kind_invalid`; chain entry with `chainId` not matching the reverse-DNS pattern returns `invalid_manifest`; manifest with missing `kind` field is rejected.

2. `workflow-chain-pack-signature-verification.test.ts` — Ed25519 verification recipe reused unchanged from `node-packs.md §Signing`: valid (manifest + signature) pairs verify; tampered manifests fail with byte-level tamper detection; wrong-key signatures fail; chain-pack `signing` block carries the same `publicKeyRef` / `signatureRef` / `method` shape as node packs.

3. `workflow-chain-expansion.test.ts` — Exercises the 9-step expansion algorithm: parameter substitution (literal + recursive into nested objects + same-name multi-position); node id collision avoidance (same chain expanded twice produces non-colliding ids; chainId dots slugged to underscores; `idMap` surfaced for caller-side parent-workflow edge wiring); edge rewriting (fragment-internal refs rewritten; port-name suffix preserved; out-of-fragment refs untouched); capability propagation (chain-level `capabilities[]` copied uniformly to every expanded node); runtime-invariance contract (expanded fragment carries ONLY concrete typeIds — no chain reference survives).

4. `workflow-chain-unresolvable-typeid.test.ts` — Rejection throws `ChainUnresolvableTypeIdError` with `code` + `typeId` + `chainId` for diagnostic; rejection happens BEFORE any output is produced (no partial expansion); fail-fast on the FIRST unknown typeId encountered.

**Still missing for FINAL promotion:** a fifth scenario class exercising end-to-end expansion against a real reference host (loading a workflow that references a chain, having the host's workflow editor invoke `expandChain`, persisting the result, dispatching the run, observing only concrete typeIds reach the runtime). This belongs to the reference-host implementation work tracked in RFC 0013's "Acceptance criteria" item 7. When a reference host implements it, the new scenario gates on `capabilities.workflowChainPacks.supported: true` (per §"Capability gating") and the conformance suite skips cleanly against hosts that don't advertise the capability.

**Gating rule.** Host-conformance scenarios MUST gate on `capabilities.workflowChainPacks.supported: true`; hosts that don't advertise the capability MUST be skipped, not failed. **Server-free scenarios** (all four above) validate the spec corpus itself and run unconditionally — the schema and reference library are the spec regardless of which hosts implement them.

---

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1.

- New optional `kind` field on `pack.json` (default `"node"`) — every existing manifest preserves its semantics.
- New peer schema `schemas/workflow-chain-pack-manifest.schema.json` — disjoint from `node-pack-manifest.schema.json`; no node-pack consumer changes required.
- New `Capabilities.workflowChainPacks` block — optional; hosts that omit it are signaling "I do not expand workflow-chain packs," and conformance scenarios skip cleanly.
- No existing workflow JSON shape changes (the expanded result uses the existing `WorkflowDefinition` schema).
- No existing dispatch surface changes (the runtime sees concrete `core.*`/vendor typeIds it already resolves).

---

## Open spec gaps

| #    | Gap                                | Notes                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WCP1 | Chain-to-chain composition         | Can `dag.nodes[].typeId` reference another chain pack? Currently restricted to node-pack typeIds. If chain-to-chain is allowed: at what depth does expansion recurse? How are circular references detected? **Recommended: disallow in v1**; revisit in a follow-up RFC.                                                  |
| WCP2 | Versioning across chain references | When a chain references `core.ai.callPrompt@1.0.0`, what happens if a future `core.ai.callPrompt@2.0.0` ships with a breaking config-schema change? **Recommended: chain MUST pin to a specific version per referenced typeId** (config snapshot at chain author-time), with a `min` / `max` range as future enhancement. |
| WCP3 | Reference-host implementation      | Phase 3 of RFC 0013 — one openwop reference host (the in-memory host is the natural fit) implements expansion in its workflow editor. Tracked separately; this spec defines the contract whether or not a reference exists yet.                                                                                           |
| WCP4 | Portable per-run parameter deferral | Some hosts (e.g., openwop-app, ADR 0237) want chain parameters to stay overridable per-run rather than frozen at drop time. Expansion-time substitution (this spec) forbids leaving `{{params.*}}` tokens in the persisted definition because they are not a spec'd runtime construct and break cross-host portability. A **portable** deferral mode would have expansion materialize the chain's `parameters` into top-level workflow `variables[]` and rewrite `{{params.x}}` into a spec'd runtime binding (for prompt-bearing config, the PromptTemplate `{{varName}}` with `source: "variable"` per `prompts.md` §"Variable interpolation"), gated behind a new capability with replay/event-log determinism for the run-scoped variable bag. **Recommended: a follow-up additive RFC**, not a relaxation of the expansion-time MUST. |

---

## References

- [`RFCS/0013-workflow-chain-packs.md`](../../RFCS/0013-workflow-chain-packs.md) — the source RFC this document normalizes.
- [`node-packs.md`](./node-packs.md) — sibling pack format; reuses naming, versioning, signing, lockfile, and trust-model rules.
- [`schemas/workflow-chain-pack-manifest.schema.json`](../../schemas/workflow-chain-pack-manifest.schema.json) — canonical manifest JSON Schema.
- [`schemas/workflow-definition.schema.json`](../../schemas/workflow-definition.schema.json) — the schema that `WorkflowDefinitionFragment` references.
- [`capabilities.md`](./capabilities.md) §`workflowChainPacks` — capability advertisement.
- [`registry-operations.md`](./registry-operations.md) — operator-side registry surfaces (deprecation, yank, signing-key rotation) that workflow-chain packs reuse unchanged from node packs.

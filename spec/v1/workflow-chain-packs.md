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

<!-- normative-example: workflow-chain-pack-manifest.schema.json -->
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
| `internal`     | boolean                    | no       | RFC 0135 — marks a composition-only fragment. See §"Chain visibility (RFC 0135)" below. Absent ⇒ `false`.                                                                                                                                                                                                                            |
| `compensation` | CompensationPolicy         | no       | RFC 0157 — the chain-level compensation POLICY (a mirror of `compensation-policy.schema.json`, RFC 0151 §B). Survives expansion as the registered definition's `settings.compensation` — copied when the parent has none, accepted when deep-equal, otherwise `chain_compensation_policy_conflict`. See §"Compensation (RFC 0157)". |

### Chain visibility (RFC 0135)

Sub-chain composition (RFC 0133) creates chains that exist **only to be composed** —
a child fragment a sibling parent dispatches — which are otherwise indistinguishable
from directly-runnable templates. The OPTIONAL boolean `internal` marks them:

- A host that presents loaded chains as **instantiable templates** (a builder
  gallery, a run picker, a template-catalog listing) **MUST omit** chains with
  `internal: true` from that default listing. A host **MAY** offer an explicit
  opt-in view that includes them (an author/admin/debug surface).
- `internal` **MUST NOT** change any non-presentational behavior: the chain still
  loads and validates; resolve-by-id, expansion, `from-chain` instantiation, and
  RFC 0133 sub-chain composition treat an internal chain exactly like any other.
- `internal` is **advisory-presentational**, **NOT an authorization boundary** — a
  host **MUST NOT** treat it as access control. A caller naming an internal chain's
  id directly is served whatever the existing authorization would serve.
- Absent ⇒ `false`. A non-boolean value fails manifest validation like any other
  type violation.

---

## WorkflowDefinitionFragment

A subset of `schemas/workflow-definition.schema.json`. Differences from a top-level workflow:

| Field                                | Behavior in fragment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` / `name` / `version`            | MUST be omitted. Host generates per-expansion (`${parentWorkflow.id}::${chainId}::${expansionId}`).                                                                                                                                                                                                                                                                                                                                                                                                   |
| `triggers` / `settings` / `metadata` | MUST be omitted. Inherited from parent.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `variables`                          | Replaced by top-level `parameters`. Host editor collects values at author-time.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `nodes[]`                            | Required. Each node's `typeId` MUST reference a published node-pack typeId OR a reserved `core.*` typeId. Each fragment node mirrors the shape of a top-level `WorkflowNode` (per `schemas/workflow-definition.schema.json#/$defs/WorkflowNode`) with relaxed `required[]` — chain authors MAY omit `name`/`position`/`config`/`inputs` for trivial pass-through nodes. The `FragmentNode` definition in `workflow-chain-pack-manifest.schema.json` SHOULD be kept in sync as `WorkflowNode` evolves. |
| `nodes[].compensation`               | RFC 0157 — OPTIONAL per-node inverse-action declaration, a mirror of `WorkflowNode.compensation` (RFC 0151 §B): `{ nodeTypeId, inputMapping?, retry?, requiresApproval? }`. `nodeTypeId` MUST resolve at expansion exactly as `typeId` does; `inputMapping` strings MAY carry `{{params.<name>}}`; node-id references inside `inputMapping` are rewritten with the expansion prefix. Survives expansion verbatim. |
| `edges[]`                            | Required when `nodes.length > 1`. Same shape as in a top-level workflow definition — including an optional `condition` (the `EdgeCondition` object `{type, left, right}`) for content routing, and an optional `triggerRule` (RFC 0125) — the same enum as `WorkflowEdge.triggerRule` (`all_success` \| `any_success` \| `all_complete` \| `none_failed` \| `any_failed`, default `all_success`) — for fan-in / error-routing / best-effort completion. Hosts that honor edge `condition`/`triggerRule` on top-level workflows MUST honor them on expanded chain edges identically. Both fields MUST survive expansion (see §Expansion semantics step 6). `condition` (does this edge participate?) and `triggerRule` (how does the target aggregate its incoming edges?) are orthogonal and compose on the same edge. |

#### Edge-condition operators (RFC 0134)

An `EdgeCondition.type` is one of `expression`, `equals`, `notEquals`, `contains`,
`regex`, **`truthy`**, or **`falsy`**. `equals`/`notEquals`/`contains`/`regex` compare
the value resolved at `left` against `right`; `expression` evaluates `expression`.

**`truthy` / `falsy` (RFC 0134)** take a `left` path and **NO `right`** operand: a
`truthy` edge contributes to its target iff the value at `left` is truthy (not one of
`false`, `null`, `undefined`, `0`, `NaN`, `""`, or absent); `falsy` is its exact
complement (contributes iff `left` resolves to one of those, or is absent). A host that
evaluates edge conditions **MUST** honor `truthy`/`falsy` with these semantics, **MUST**
ignore a `right` if present on them (meaningless, not an error), and **MUST** reject a
`truthy`/`falsy` condition whose `left` is missing/empty (`chain_edge_condition_invalid`
at expansion — never a silently dead edge). `left` is **required** for every operator
except `expression`. These operators are the natural predicate for a boolean gate output
(e.g. an approval gate's `approved`): `truthy`→proceed, `falsy`→reject — and, unlike
`equals true`/`notEquals true`, they evaluate a *skipped* upstream (output absent) as
falsy, which is what reject-safe fan-in wiring depends on.

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
3. **Validate referenced typeIds.** Every `dag.nodes[].typeId` — **and, per RFC 0157, every `dag.nodes[].compensation.nodeTypeId`** — MUST resolve to either a reserved `core.*` typeId OR a typeId published by a known node pack registered with the host. Hosts MUST reject expansion with `chain_unresolvable_typeid: '<typeId>'` if any referenced typeId is unknown.
4. **Prompt for parameters.** The host editor MUST collect values for the chain's `parameters` schema from the author. Author input MUST be validated against the schema; invalid input MUST be rejected with `chain_parameter_invalid` BEFORE expansion proceeds.
5. **Substitute placeholders.** Replace every `{{params.<name>}}` placeholder in `dag` (recursively through string fields in `config` / `inputs` — **and, per RFC 0157, `compensation.inputMapping`**) with the corresponding author-supplied value, honoring the whole-value-vs-embedded token rule and the `inputs`-preservation rule in §Parameter substitution.
6. **Rewrite node ids for collision avoidance** — including, per RFC 0157, fragment node-id references inside `compensation.inputMapping` (`${nodes.<id>.…}` / `nodes.<id>.…`), rewritten exactly as edge refs are; references to non-fragment ids pass through. Generate a per-expansion id prefix (e.g., `${chainIdSlug}_${expansionId}_`, where `chainIdSlug` is the `chainId` with dots replaced by underscores and hyphens preserved) and apply it to every `dag.nodes[].id` plus every reference to those ids in `dag.edges[]`. Hosts SHOULD make `expansionId` unique within the parent workflow (random 4-hex suffix is sufficient). **Expanded ids are unbounded.** Because `chainIdSlug` derives from a reverse-DNS `chainId` with no length bound, an expanded node/edge id can exceed any short cap — and `WorkflowNode.id` in [`workflow-definition.schema.json`](../../schemas/workflow-definition.schema.json) intentionally has **no `maxLength`** (only `minLength: 1`). A host therefore MUST NOT reject or truncate an expanded id by length, and MUST NOT impose an internal `id` length cap stricter than the schema; doing so rejects wire-valid workflows (the schema is the contract). **Edge-field preservation.** Rewriting an edge MUST preserve its non-id fields onto the resulting `WorkflowEdge` — a present `condition` (RFC 0013 amendment 2026-07-03) and a present `triggerRule` (RFC 0125) MUST be carried through verbatim. Dropping them at expansion silently discards content-routing / fan-in semantics the chain author declared (the scheduler reads `triggerRule` from the target's incoming edge; if expansion drops it, the field is never honored). Omitting `triggerRule` on the fragment edge yields an expanded edge with no `triggerRule` — identical to the `all_success` default. **Carry vs honor.** This preservation rule constrains only *carrying* the field through expansion; *evaluating* the fan-in rule is governed by the existing `WorkflowEdge.triggerRule` semantics in `workflow-definition.schema.json`, unchanged by RFC 0125 — so a minimal host that implements only `all_success` fan-in is not *newly* non-conformant for not evaluating `all_complete`; it MUST simply not DROP the field at expansion. **Parameter-distinct identity.** Because expansion-time substitution bakes the author-supplied parameter values into `config`/`inputs` (step 5), a host that persists the expanded definition under an identity *derived from* the expansion (a deterministic `expansionId`, workflow key, or content hash) MUST ensure that identity distinguishes expansions differing only in parameter values — either by making `expansionId` genuinely unique per drop, or by folding the canonical parameter values into the id derivation. A deterministic identity keyed on `chainId` alone MUST NOT be used to key the persisted definition: two drops of the same chain with different parameters would map to the same key and the second would silently overwrite the first.
7. **Splice into the parent workflow.** Append the expanded nodes + edges to the parent's `nodes[]` / `edges[]`. Connect the chain's entry/exit nodes to the parent's adjacent nodes (the host editor's UI controls which adjacency).
8. **Propagate capabilities.** When the chain declares top-level `capabilities[]`, copy that array into every expanded `WorkflowNode.capabilities` so existing capability gates (e.g., `side-effectful` gating) apply to the expanded nodes.
9. **Persist the expansion.** Save the resulting expanded workflow JSON to the host's workflow store. **Per RFC 0157, carry the chain-level policy first:** if the chain declares `compensation` and the parent has no `settings.compensation`, copy it; if the parent has one that is deep-equal, keep it; otherwise abort with `chain_compensation_policy_conflict` — never merge. **In the RFC 0013 inline mode the chain reference is NOT preserved at runtime** — dispatching hosts see only the concrete `core.*` (or published-vendor) typeIds the expansion produced. **Exception — RFC 0133 sub-chain composition.** A chain that declares `subChains[]` and references them via `config.subChainRef` is the opt-in exception: the referenced child chain is co-registered as its own workflow and its reference IS preserved at runtime (the parent dispatches the child as a child run). See §"Sub-chain composition (RFC 0133)". This mode is capability-gated (`capabilities.workflowChainPacks.subChains`) — a host that does not advertise it MUST refuse a `subChains`-bearing chain with `sub_chain_unsupported`, never flatten it.

### What hosts dispatch

In the RFC 0013 inline mode the runtime engine sees a normal `WorkflowDefinition` with no workflow-chain-pack-specific surface. No new dispatch semantics are required; **a workflow author can switch hosts without their workflows breaking, because the expanded JSON references only typeIds the destination host's pack registry can resolve via existing node-pack discovery**. This is the key invariant that lets this RFC be additive. **RFC 0133 sub-chain composition preserves that property with one refinement:** the parent's expanded JSON references a co-registered child workflow through the *existing* `core.subWorkflow` / `core.dispatch` (child-run) framework nodes — still a normal `WorkflowDefinition`, still no NEW dispatch primitive — so a destination host that also implements runtime child dispatch (`capabilities.workflowChainPacks.subChains.supported: true`) runs it unchanged, and one that does not refuses at instantiate time (`sub_chain_unsupported`, 422) rather than mis-dispatching.

### Round-trip note

Hosts MAY optionally annotate expanded nodes with a `metadata.expandedFrom: { chainId, chainVersion, expansionId }` marker for editor "undo" / "re-expand" workflows. The runtime engine MUST ignore unknown metadata fields per `COMPATIBILITY.md` §2.1. The marker is purely a host-editor concern; it carries no normative meaning at dispatch time.

---

## Deferred-parameter expansion (RFC 0124)

Expansion-time substitution (above) is the default and the floor. A host MAY additionally offer an OPTIONAL, capability-gated **deferred-parameter mode** — advertised via `capabilities.workflowChainPacks.deferredParameters.supported: true` (`capabilities.md`) — that keeps chain parameters overridable **per run** without breaking portability. RFC 0124 is the normative source; this section is the spec-doc summary. **No host may advertise `deferredParameters.supported: true` until RFC 0124 is `Accepted`.**

In deferred mode, in place of step 5 (literal substitution) the host MUST:

1. **Materialize parameters as variables.** For each property in the chain's `parameters`, add a top-level `WorkflowVariable` to the parent workflow: `name` = a collision-free name (`${chainIdSlug}_${expansionId}_${p}`), `type` copied from the parameter's JSON-Schema `type`, `defaultValue` = the author-supplied value, `required` mirroring `parameters.required`, and — when the parameter declares a JSON-Schema `format` and its `type` is `"string"` — `format` copied verbatim (RFC 0136). The `format` copy is a MUST **in this mode only**: it is a property of variable materialization, and expansion-time substitution (the floor) mints no `WorkflowVariable` to carry it. Copying is verbatim and unvalidated — a `format` the host does not recognise is still copied, since the destination host may recognise it (`workflow-definition.schema.json` §WorkflowVariable, RFC 0136 requirement 2).
2. **Rewrite tokens to spec'd bindings.** Replace every `{{params.x}}` with a portable runtime binding: for prompt bodies, a PromptTemplate `{{varName}}` slot with a matching `PromptVariable` `source: "variable"` (`prompts.md` §"Variable interpolation"); for a whole-value `config`/`inputs` token, a **variable-sourced PortValue**. An inline `config.systemPrompt` (or `userPrompt`) body MUST be lifted to defer it: the host mints a **host-resident PromptTemplate** whose `text` carries the `{{varName}}` slot, and replaces the inline body with the corresponding `*PromptRef` (`config.systemPromptRef` / `userPromptRef`) — a `PromptRef` pointing at that template, per `prompts.md` / RFC 0027. There is NO "inline template object on the node" construct in v1 (a node carries an inline body string OR a `*PromptRef`), so the ref-based lift is the only portable target; a host that will not mint the template MUST resolve the token at expansion time instead. An embedded token in arbitrary non-prompt `config` has no portable runtime home and MUST be resolved at expansion time.
3. **Keep the persisted definition token-free.** The result MUST contain NO `{{params.*}}` tokens under any mode — a destination host resolves only concrete typeIds, PromptTemplate variable slots, and PortValue refs.

**Override key.** The normative per-run override key is the **bare parameter name** (`productIdea`); the prefixed internal name is not author-facing. Deferred expansion MUST extend the parent workflow's `configurableSchema` — which is a **JSON Schema 2020-12 document** (`workflow-definition.schema.json`), NOT an alias map — so it accepts each bare parameter name as a `configurable` key. The bare → materialized-variable alias is a separate concern: the host applies it when seeding the run's variable bag at `POST /v1/runs` and `:fork` (the `configurable` override MUST win over any node input default) and MAY record it as a host annotation (e.g. `metadata.deferredParameterAliases`). A `:fork` MUST inherit the source run's `configurable` bindings so it replays the bound value byte-identically; replay determinism follows from `replay.md`'s `RunSnapshot.variables` byte-equivalence guarantee, with overrides carried in the event log (no machine-local bag).

**Security.** A per-run value interpolated into a prompt is untrusted content and MUST compose with `bindingTrust: "untrusted"` → `contentTrust: "untrusted"` + `<UNTRUSTED>` fencing, unconditionally (no default-vs-override provenance branch), per `SECURITY/threat-model-prompt-injection.md`. Untrusted and secret markers are orthogonal and compose on the same binding.

**Secret-class parameters (`x-openwop-sensitive: true`) — `source:"secret"`, prompt-body-only, fail-closed (amended 2026-07-04).** A parameter declared `x-openwop-sensitive: true` (a recognized manifest extension key) is secret-class. A recognizing host MUST NOT expansion-time-freeze it — freezing bakes the secret into persisted `config` in plaintext (secret-at-rest leak, SR-1). It also MUST NOT materialize it as a plaintext `source:"variable"` binding: a `source:"variable"` value lands in the run-scoped variable bag and therefore in `RunSnapshot.variables` (`GET /v1/runs/{id}`) and the host's at-rest persistence — the same SR-1 leak, one layer down. Instead:

- **Deferrable ONLY in a prompt-body position.** A sensitive parameter MUST resolve to a prompt body (`config.systemPrompt` / `userPrompt` → lifted to a host-resident PromptTemplate, or an existing `*PromptRef`), where it MUST be materialized as a **`source:"secret"` `PromptVariable`** (a BYOK secret reference resolved from the host secret store via `capabilities.secrets` at compose time, redacted to `[REDACTED:<secretId>]` in `prompt.composed`/debug per SR-1, never appearing in the dispatched body's observability or the run bag). Requires `capabilities.secrets.supported: true`.
- **Fail-closed everywhere else.** In ANY other position — a whole-value `node.inputs` entry, an embedded non-prompt `config` token, or a host lacking deferred / `secrets` support — the host MUST refuse the expansion with `sensitive_param_not_deferrable` (422). There is no plaintext-bag path for a sensitive value, by construction. (Node-level secrets have the dedicated connection-pack / `credentialRef` channel per RFC 0095; a sensitive *value* in a node input belongs there, not in a chain parameter. A `{type:"secret"}` node-input PortValue is out of scope for this RFC — a possible future RFC.)
- **Per-run supply is a secret reference, not plaintext.** The per-run value of a sensitive parameter supplied via `configurable` MUST be a **secret reference**, NOT a plaintext value — a plaintext `configurable` for a sensitive parameter is itself a `validation_error` (plaintext in the request + event log defeats the guarantee). **Wire shape (pinned).** `configurable[<bareParamName>]` for a sensitive parameter MUST be a **JSON string** carrying a `credentialRef` — a host secret id resolvable via `capabilities.secrets` (the same `credentialRef` string form RFC 0095 / `run-options.md` `ai.credentialRef` uses), e.g. `{"configurable": {"apiKey": "cred-9f3a"}}`. It MUST NOT be an object literal, an inline value, or a `{{...}}` token; a value that does not resolve to a known secret id via `capabilities.secrets` is a `validation_error`. (A non-sensitive parameter's `configurable[<bareParamName>]` remains its plain typed value, unchanged.) The never-plaintext guarantee thus holds across the definition, the run-scoped bag, `RunSnapshot.variables`, at-rest persistence, AND the override request.

---

## Sub-chain composition (RFC 0133)

Expansion-time inline splicing (above) flattens a chain into the parent at author time. A chain MAY instead declare **child chains it composes at run time** — realizing "workflows can hold workflows." This section is normative; RFC 0133 is the source.

**Manifest.** A `WorkflowChain` MAY carry an optional `subChains[]`. Each entry's `ref` is EITHER a string naming a **sibling** `chainId` in the same pack's `chains[]`, OR an object `{ packName, chainId, version }` naming an externally published chain (resolved + signature-verified like any pack dependency, per `node-packs.md` §Signing). A node dispatches a declared sub-chain using the existing runtime composition nodes with a new `config.subChainRef` in place of a hard-coded `config.workflowId`:

```jsonc
{ "id": "build-0", "typeId": "core.subWorkflow",
  "config": { "subChainRef": "lesson-batch" },
  "inputs": { /* mapped to the child's parameters/inputs */ } }
```

- `config.subChainRef` MUST match a `subChains[].ref` (a sibling `chainId`, or the `chainId` of an external ref). A concrete `config.workflowId` inside a fragment remains INVALID — a chain MUST NOT pin a host-specific workflow id (the manifest schema enforces this with a `not` guard).
- The same applies to `core.dispatch` with `workerDispatchModel: "child-run"`: its worker target is a `subChainRef` (or a list thereof), giving the **parallel child fan-out** shape (RFC 0118's fan-out expressed at the chain layer).

**Co-expansion + co-registration (host-side, normative).** When a host instantiates a parent chain (`POST …/workflows/from-chain`), it MUST:

1. Expand the parent fragment into a `WorkflowDefinition` as in §"Expansion semantics".
2. For each distinct `subChainRef` reachable from the parent's nodes: resolve the referenced chain (sibling or external — a ref that resolves to nothing is `sub_chain_unresolved`), **recursively expand and register it as its own workflow** (with `recordOwnership` for the **same tenant** as the parent — a co-registered child MUST NOT be owned by, or reachable from, any other tenant), minting a **deterministic** id from **`(tenantId, childChainId, version)`**. The id MUST be **tenant-scoped**: `registerWorkflow` is a global by-id registry, so a tenant-less id would let two tenants instantiating the same parent→child collide on one global workflow — a cross-tenant isolation break (SECURITY `sub-chain-child-tenant-scoped`). Keying on `tenantId` also makes the dedup correct **across parents within a tenant** (a child chain composed by two different parents registers exactly once; a repeat instantiation converges), and `version` distinguishes `chain@1` from `chain@2`.
3. Rewrite each referencing node's `config.subChainRef` to the minted child workflow id under the field the runtime already reads (`config.workflowId` for `core.subWorkflow`; the worker target for `core.dispatch`). The child reference IS preserved at runtime — the parent dispatches the child as a child run.
4. Register the parent workflow. Parent and every co-registered child are owned + builder-editable.

**`from-chain` response (RFC 0133).** When a host instantiates a `subChains`-bearing chain, the `POST …/workflows/from-chain` response MUST carry the parent `workflowId`, the list of co-registered child workflow ids `subChainWorkflowIds` (the minted, tenant-scoped child ids — deduplicated), and `nodeCount` (the parent's expanded node count):

```jsonc
{ "workflowId": "wf-parent-…",
  "subChainWorkflowIds": ["wfc_tenant-a__lesson-batch__1_0_0"],
  "nodeCount": 3 }
```

`subChainWorkflowIds` is empty for a chain with no `subChains`. A caller uses it to open/edit the co-registered children (they are owned workflows, not opaque inline nodes).

**Bounded recursion (MUST).** A chain that transitively composes itself MUST be rejected with `sub_chain_cycle`. Recursion depth MUST additionally be bounded by a host `maxSubChainDepth` (advertised as `capabilities.workflowChainPacks.subChains.maxDepth`, RECOMMENDED default **8**); a nesting that exceeds it fails closed with the **distinct** code `sub_chain_max_depth_exceeded` (so an operator sees which backstop fired — a depth breach is not a cycle). Together the cycle check and the depth bound guarantee co-expansion terminates on adversarial input (SECURITY invariant `sub-chain-expansion-bounded`).

**External-ref version pinning (SHOULD).** When a `subChainRef` resolves to an *external* published chain, co-registration SHOULD pin the resolved concrete version into the parent's ownership record, so a later re-instantiation (or a `:fork`) reproduces the same child (RFC 0133 §Unresolved #1, resolved: pin).

**Capability gating (MUST).** Runtime sub-chain composition is advertised via `capabilities.workflowChainPacks.subChains.supported: true` (see `capabilities.md`). A host that does not advertise it MUST refuse a `subChains`-bearing chain at author/instantiate time with `sub_chain_unsupported` (HTTP `422`) — it MUST NOT silently flatten a runtime child into the parent (flattening erases the child as an editable unit and changes run semantics).

---

## Produced (run-scoped) variables (RFC 0133)

RFC 0013 replaced a fragment's `variables` with author-time `parameters`. A chain MAY additionally declare a **separate, run-scoped** channel for values produced *during* the run.

**Prefer edges (MUST).** Where a node exposes a value on a **typed output port**, chains MUST pass it via an explicit `edge` (`sourceOutput` → `targetInput`) — the chain-native dataflow. `producedVariables` is ONLY for values a node writes to the **run variable bag** with no typed output port (as some framework/feature nodes do).

**Manifest.** A `WorkflowChain` MAY declare `producedVariables[]`, each `{ name, producedBy, type, description? }`:

```jsonc
{ "name": "plan", "producedBy": "generate", "type": "object",
  "description": "the generated plan the decompose node consumes" }
```

- `name` is the bag key; `producedBy` MUST be a `nodes[].id` in the same fragment (a `producedBy` naming a non-existent node is a `produced_var_producer_unknown` manifest error — the value would be written by nothing); `type` is a JSON-Schema type token. `producedVariables` are **run-scoped** — they carry NO author-time value (that is what `parameters` are for); the manifest distinguishes the two. A `producedVariables[].name` MUST NOT collide with a `parameters` property name — the author-time and run-scoped channels MUST be **disjoint** (a shared name is ambiguous at read time); a collision is a `variable_undeclared` manifest error.
- Any node input binding `{ type:"variable", variableName:"plan" }` MUST reference a declared `producedVariables[].name` OR a materialized parameter name. An undeclared variable read is a `variable_undeclared` manifest error (closed-world validation — closing the "reads a value nothing produces" hole).

**Expansion (MUST).** On expansion the host MUST emit the declared `producedVariables` into the resulting `WorkflowDefinition.variables[]` as run-scoped entries (name + type, no value), so the executor's **existing** variable bag carries them exactly as in a hand-authored workflow. No new runtime surface is introduced — this only lets the pack format declare run variables. `producedVariables` requires no capability flag beyond the base `workflowChainPacks.supported`: it is inert variable emission, not runtime child dispatch.

---

## Compensation (RFC 0157)

> **Status: additive (2026-08-16, [RFC 0157](../../RFCS/0157-chain-fragments-carry-compensation.md), an RFC 0013 revision composing RFC 0151 §B).**

Before RFC 0157 a chain fragment could not declare an inverse action and a chain could not carry a compensation policy: `FragmentNode` mirrored `WorkflowNode` minus `compensation`, so on a host where every workflow is a chain, RFC 0151 §B was reachable only through a hand-authored `POST /v1/workflows`. RFC 0157 mirrors both surfaces into the chain manifest and defines how they survive expansion.

- **`dag.nodes[].compensation`** — the RFC 0151 §B node declaration, byte-mirrored from `workflow-definition.schema.json#/$defs/WorkflowNode/properties/compensation` (a conformance leg asserts the mirror). It is descriptive: it says what the inverse action is. Any host MUST carry it through expansion verbatim, whether or not it advertises `capabilities.compensation`.
- **`dag.nodes[].irreversibleEffect`** — RFC 0151 UQ4 (2026-08-16), the author's statement that a fragment node's committed effect **has no inverse** (`compensation.md` §B "Irreversible effects"). Mutually exclusive with `dag.nodes[].compensation` — the manifest schema rejects both (`if irreversibleEffect === true then not required compensation`) and expansion refuses it fail-closed with **`chain_irreversible_with_compensation`** before any node is emitted (rule **6c**). Copied onto the expanded `WorkflowNode` unchanged, so the registered definition carries the same statement.
- **`chains[].compensation`** — the RFC 0151 §B **policy**, byte-mirrored from `compensation-policy.schema.json`. It requests an unwind. On expansion it becomes the registered definition's **`settings.compensation`**: copied when the parent has none, accepted when deep-equal (key order insensitive), otherwise **`chain_compensation_policy_conflict`** — fail closed, never merge. A host that does **not** advertise `capabilities.compensation` MUST refuse a chain carrying a policy with `capability_required` (`compensation.md` §"Workflow policy"), exactly as it refuses a hand-authored `settings.compensation`; the node declaration alone remains acceptable anywhere.
- **Expansion rules** (numbered against §"Expansion semantics"): **3b** every `compensation.nodeTypeId` resolves like `typeId` (`chain_unresolvable_typeid`) — an unwind MUST NOT fail on a typo first discovered during a failure; **5b** `{{params.*}}` inside `inputMapping` are substituted (author-time literals; RFC 0151 §B's recorded-facts rule is unaffected); **6b** fragment node-id references inside `inputMapping` are rewritten with the expansion prefix exactly as edge refs are; **9b** the policy is carried as above.
- **Mirrors, not `$ref`s — deliberately.** The chain manifest schema stays self-contained (only `#/…` refs). A new cross-file `$ref` in a schema is a suite-minor change every downstream fixed-list validator must absorb (`fixtures-valid.test.ts` learned this from `compensation-policy.schema.json`); two conformance legs assert the mirrors stay byte-equal to their sources so drift cannot be silent.
- **Spec-authoritative expansion:** `conformance/src/lib/workflow-chain-expansion.ts` `carryCompensation` / `expandChainWithCompensation`, composed **after** the byte-mirrored core (`expandChain`) rather than inside it, so a host's mirror of the core stays valid until it adopts RFC 0157. Witness: `chain-compensation-expansion.test.ts`.
- **Host-path witness (2026-08-16):** the bundled `vendor.openwop.workflow-chain-sample` fixture (pack 1.1.0) carries two RFC 0157 chains — `reserve-and-notify` (node `compensation` + `irreversibleEffect`, no policy: acceptable on any host) and `reserve-and-notify-with-policy` (adds the chain policy: refused `capability_required` on a host that does not advertise `compensation`, expanded on one that does). `workflow-chain-host-expansion.test.ts` expands both through the host's `POST /v1/host/sample/workflow-chain:expand` seam and compares with `expandChainWithCompensation`; a host whose seam echoes `settings` on the response has its rule-9b carry asserted too, one that does not gets a `blocked` note for that half. A host bundling an OLDER fixture (its conformance pin predates 1.133.0) records `blocked` for these legs, not a failure.

## Capability gating

Hosts that implement workflow-chain pack expansion advertise this via `Capabilities.workflowChainPacks.supported: true` (see `capabilities.md`). The conformance suite uses this flag to scope chain-specific scenarios — hosts that don't implement expansion MUST be skipped from those tests, not failed. **Runtime sub-chain composition (RFC 0133)** is a separate opt-in sub-flag `Capabilities.workflowChainPacks.subChains.supported: true`; a host MAY implement inline expansion without runtime child dispatch, in which case it refuses a `subChains`-bearing chain with `sub_chain_unsupported`.

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
| `sensitive_param_not_deferrable` | Host editor expansion (RFC 0124) | HTTP `422`. A recognizing host cannot securely defer an `x-openwop-sensitive` parameter — it resolves to a non-prompt position (whole-value `node.inputs`, embedded `config`), or a frozen position, or the host lacks deferred / `capabilities.secrets` support. A sensitive parameter is deferrable ONLY in a prompt-body position (→ `source:"secret"`); the host MUST refuse the expansion rather than freeze the secret or bag it as plaintext. |
| `sub_chain_unresolved`      | Registry validation + host co-expansion (RFC 0133) | HTTP `400`. A `config.subChainRef` (or a `subChains[].ref`) names a sibling `chainId` not present in the pack's `chains[]`, OR an external ref that fails resolution / signature verification. `details.ref` carries the offending value. |
| `sub_chain_cycle`           | Registry validation + host co-expansion (RFC 0133) | HTTP `400`. A chain transitively composes itself. `details.chainId` carries the offending chain. (SECURITY `sub-chain-expansion-bounded`.) |
| `sub_chain_max_depth_exceeded` | Host co-expansion (RFC 0133) | HTTP `400`. Co-expansion nesting exceeds the host's `maxSubChainDepth` — the DoS depth backstop, DISTINCT from `sub_chain_cycle` so an operator sees which bound fired. `details.chainId` + `details.maxDepth`. (SECURITY `sub-chain-expansion-bounded`.) |
| `sub_chain_unsupported`     | Host editor / `from-chain` instantiation (RFC 0133) | HTTP `422`. A host that does NOT advertise `capabilities.workflowChainPacks.subChains.supported` was asked to instantiate a `subChains`-bearing chain. The host MUST refuse rather than silently flatten the runtime child. |
| `variable_undeclared`       | Registry validation + host expansion (RFC 0133) | HTTP `400`. A node input binding `{ type:"variable", variableName }` reads a name that is neither a declared `producedVariables[].name` nor a materialized parameter (closed-world validation), OR a `producedVariables[].name` collides with a `parameters` property name (the two channels MUST be disjoint). `details.variableName` carries the offending name. |
| `produced_var_producer_unknown` | Registry validation + host load (RFC 0133) | HTTP `400`. A `producedVariables[].producedBy` names a node id that does not exist in the fragment (a malformed producer — the value would be written by nothing). Distinct from `variable_undeclared` (a bad reader). `details.variableName` + `details.producedBy`. |
| `chain_compensation_policy_conflict` | Host editor expansion (RFC 0157) | HTTP `409`. The chain declares a chain-level `compensation` policy and the parent workflow already carries a `settings.compensation` that is not deep-equal. Expansion MUST NOT merge policies (a merged policy nobody wrote is the guess-at-a-contract failure the policy exists to prevent); the author reconciles and re-expands. `details.chainId` carries the chain. |
| `chain_irreversible_with_compensation` | Host editor expansion (RFC 0157 × RFC 0151 UQ4) | HTTP `400`. A fragment node declares both `irreversibleEffect: true` and a `compensation` — an effect cannot both have and lack an inverse. Refused before any node is emitted; the manifest schema rejects the shape as well. `details.nodeId`, `details.chainId`. Non-retriable. |
| `chain_fragment_pins_workflow_id` | Host load / expansion (RFC 0133) | HTTP `400`. A chain fragment node pins a concrete host-specific `config.workflowId` (forbidden — a chain MUST reference a composed child via `config.subChainRef`, never a pinned id). The manifest schema also rejects this at validation time via a `not` guard on `config`; a host performing runtime (rather than schema) validation emits this code at load. |

---

## Conformance

- **RFC 0157:** `chain-compensation-expansion.test.ts` (server-free) — the two schema mirrors, manifest validity/closure, and expansion carrying (declaration verbatim, params substituted, id refs rewritten, unresolvable compensator refused, policy copied/accepted/conflicted).

**Landed scenarios (all server-free against the reference expansion library at [`conformance/src/lib/workflow-chain-expansion.ts`](../../conformance/src/lib/workflow-chain-expansion.ts)):**

1. `workflow-chain-pack-manifest-validation.test.ts` — Positive: a valid `kind: "workflow-chain"` manifest parses + indexes via the registry build path; the in-repo [`examples/packs/workflow-chain-sample/`](https://github.com/openwop/openwop-examples/tree/main/examples/packs/workflow-chain-sample) pack validates from disk. Negatives: manifest with both `nodes[]` and `chains[]` returns `pack_kind_invalid`; chain entry with `chainId` not matching the reverse-DNS pattern returns `invalid_manifest`; manifest with missing `kind` field is rejected.

2. `workflow-chain-pack-signature-verification.test.ts` — Ed25519 verification recipe reused unchanged from `node-packs.md §Signing`: valid (manifest + signature) pairs verify; tampered manifests fail with byte-level tamper detection; wrong-key signatures fail; chain-pack `signing` block carries the same `publicKeyRef` / `signatureRef` / `method` shape as node packs.

3. `workflow-chain-expansion.test.ts` — Exercises the 9-step expansion algorithm: parameter substitution (literal + recursive into nested objects + same-name multi-position); node id collision avoidance (same chain expanded twice produces non-colliding ids; chainId dots slugged to underscores; `idMap` surfaced for caller-side parent-workflow edge wiring); edge rewriting (fragment-internal refs rewritten; port-name suffix preserved; out-of-fragment refs untouched); capability propagation (chain-level `capabilities[]` copied uniformly to every expanded node); runtime-invariance contract (expanded fragment carries ONLY concrete typeIds — no chain reference survives).

4. `workflow-chain-unresolvable-typeid.test.ts` — Rejection throws `ChainUnresolvableTypeIdError` with `code` + `typeId` + `chainId` for diagnostic; rejection happens BEFORE any output is produced (no partial expansion); fail-fast on the FIRST unknown typeId encountered.

**Still missing for FINAL promotion:** a fifth scenario class exercising end-to-end expansion against a real reference host (loading a workflow that references a chain, having the host's workflow editor invoke `expandChain`, persisting the result, dispatching the run, observing only concrete typeIds reach the runtime). This belongs to the reference-host implementation work tracked in RFC 0013's "Acceptance criteria" item 7. When a reference host implements it, the new scenario gates on `capabilities.workflowChainPacks.supported: true` (per §"Capability gating") and the conformance suite skips cleanly against hosts that don't advertise the capability.

**Gating rule.** Host-conformance scenarios MUST gate on `capabilities.workflowChainPacks.supported: true`; hosts that don't advertise the capability MUST be skipped, not failed. **Server-free scenarios** (all four above) validate the spec corpus itself and run unconditionally — the schema and reference library are the spec regardless of which hosts implement them.

**RFC 0133 — composition scenarios.** Five scenarios cover sub-chain composition + produced variables (reference library extended at [`conformance/src/lib/workflow-chain-expansion.ts`](../../conformance/src/lib/workflow-chain-expansion.ts) — `expandChainTree` / `emitProducedVariables` / `validateVariableReads`):

6. `chain-subchain-sibling.test.ts` (server-free) — a pack with a parent chain + a sibling child chain; `expandChainTree` co-registers both, mints a deterministic child id, rewrites the parent's `config.subChainRef` → the child's `config.workflowId`; a child referenced twice registers once.
7. `chain-subchain-cycle-rejected.test.ts` (server-free) — a self-referential chain fails with `sub_chain_cycle`; a nesting past `maxDepth` fails with the same code (the `sub-chain-expansion-bounded` bounded-recursion public test).
8. `chain-produced-var-roundtrip.test.ts` (server-free) — a chain declaring `producedVariables` emits them into `variables[]` (name + type, no value); an undeclared `{ type:"variable" }` read fails with `variable_undeclared`.
9. `chain-subchain-fanout.test.ts` (capability-gated on `workflowChainPacks.subChains.supported`) — a `core.dispatch` child-run over a `subChainRef` worker; N child runs collected. Soft-skips until a reference host wires runtime child dispatch.
10. `chain-subchain-unsupported-refused.test.ts` (capability-gated) — a host WITHOUT `subChains.supported` refuses a `subChains`-bearing chain with `sub_chain_unsupported` (422), never flattening.

---

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1.

- New optional `kind` field on `pack.json` (default `"node"`) — every existing manifest preserves its semantics.
- New peer schema `schemas/workflow-chain-pack-manifest.schema.json` — disjoint from `node-pack-manifest.schema.json`; no node-pack consumer changes required.
- New `Capabilities.workflowChainPacks` block — optional; hosts that omit it are signaling "I do not expand workflow-chain packs," and conformance scenarios skip cleanly.
- No existing workflow JSON shape changes (the expanded result uses the existing `WorkflowDefinition` schema).
- No existing dispatch surface changes (the runtime sees concrete `core.*`/vendor typeIds it already resolves).
- **RFC 0133 additive extensions.** `subChains`, `producedVariables`, and `config.subChainRef` are all OPTIONAL; a chain declaring none expands byte-identically to RFC 0013. Sub-chain composition dispatches through the *existing* `core.subWorkflow` / `core.dispatch` framework nodes (no new dispatch primitive), and child ids are minted at `from-chain` instantiate time (baked into the persisted parent before any run) so the run event log gains no new non-determinism and `:fork` replays byte-identically. A host without runtime child dispatch refuses at instantiate time (`sub_chain_unsupported`) rather than mis-dispatching. RFC 0133 amends this doc's §"Expansion semantics" step 9 + §"What hosts dispatch" to name the opt-in runtime-child mode; the RFC 0013 inline mode is unchanged.

---

## Open spec gaps

| #    | Gap                                | Notes                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WCP1 | Chain-to-chain composition         | ~~Can `dag.nodes[].typeId` reference another chain pack?~~ **Resolved by RFC 0133** (`Active`): a chain composes child chains via `subChains[]` + `config.subChainRef` (RUNTIME child dispatch, not inline typeId reference); recursion is bounded by a cycle check (`sub_chain_cycle`) + `maxSubChainDepth` (default 8). See §"Sub-chain composition (RFC 0133)".                                                  |
| WCP5 | Co-registered child ownership lifecycle (RFC 0133) | When a parent chain is deleted, are co-registered children deleted too, or reference-counted (a child shared by two parents)? **Recommended (RFC 0133 §Unresolved #2, carried forward):** reference-count by deterministic child id — delete a child when its last parent is deleted. Host-side lifecycle, not a wire-shape concern; tracked in [`docs/KNOWN-LIMITS.md`](../../docs/KNOWN-LIMITS.md).                                                  |
| WCP2 | Versioning across chain references | When a chain references `core.ai.callPrompt@1.0.0`, what happens if a future `core.ai.callPrompt@2.0.0` ships with a breaking config-schema change? **Recommended: chain MUST pin to a specific version per referenced typeId** (config snapshot at chain author-time), with a `min` / `max` range as future enhancement. |
| WCP3 | Reference-host implementation      | Phase 3 of RFC 0013 — one openwop reference host (the in-memory host is the natural fit) implements expansion in its workflow editor. Tracked separately; this spec defines the contract whether or not a reference exists yet.                                                                                           |
| WCP6 | Compensation in chains (RFC 0157) | ✅ Landed 2026-08-16 — `nodes[].compensation` + `chains[].compensation` mirrors, expansion rules 3b/5b/6b/9b, `chain_compensation_policy_conflict`. Open: host adoption (the in-memory reference host's mirrored core does not yet run `carryCompensation`); RFC 0124 deferred mode does not yet defer `inputMapping` tokens (they are frozen at drop time like the RFC 0013 default). |
| WCP4 | Portable per-run parameter deferral | Some hosts (e.g., openwop-app, ADR 0237) want chain parameters to stay overridable per-run rather than frozen at drop time. Expansion-time substitution (this spec) forbids leaving `{{params.*}}` tokens in the persisted definition because they are not a spec'd runtime construct and break cross-host portability. A **portable** deferral mode would have expansion materialize the chain's `parameters` into top-level workflow `variables[]` and rewrite `{{params.x}}` into a spec'd runtime binding (for prompt-bearing config, the PromptTemplate `{{varName}}` with `source: "variable"` per `prompts.md` §"Variable interpolation"), gated behind a new capability with replay/event-log determinism for the run-scoped variable bag. **Recommended: a follow-up additive RFC**, not a relaxation of the expansion-time MUST. |

---

## References

- [`RFCS/0013-workflow-chain-packs.md`](../../RFCS/0013-workflow-chain-packs.md) — the source RFC this document normalizes.
- [`node-packs.md`](./node-packs.md) — sibling pack format; reuses naming, versioning, signing, lockfile, and trust-model rules.
- [`schemas/workflow-chain-pack-manifest.schema.json`](../../schemas/workflow-chain-pack-manifest.schema.json) — canonical manifest JSON Schema.
- [`schemas/workflow-definition.schema.json`](../../schemas/workflow-definition.schema.json) — the schema that `WorkflowDefinitionFragment` references.
- [`capabilities.md`](./capabilities.md) §`workflowChainPacks` — capability advertisement.
- [`registry-operations.md`](./registry-operations.md) — operator-side registry surfaces (deprecation, yank, signing-key rotation) that workflow-chain packs reuse unchanged from node packs.

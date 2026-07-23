# RFC 0133: Workflow-chain composition — sub-chains and produced variables

| Field             | Value                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0133                                                                                                                                                                  |
| **Title**         | Workflow-chain composition — sub-chains and produced variables                                                                                                        |
| **Status**        | `Draft`                                                                                                                                                                |
| **Author(s)**     | openwop-app maintainers                                                                                                                                                |
| **Created**       | 2026-07-22                                                                                                                                                              |
| **Updated**       | 2026-07-22                                                                                                                                                              |
| **Affects**       | `spec/v1/workflow-chain-packs.md`, `schemas/workflow-chain-pack-manifest.schema.json`, `schemas/workflow-definition.schema.json` (no change; referenced), registry index, conformance scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                                                                                                      |
| **Supersedes**    | —                                                                                                                                                                      |
| **Superseded by** | —                                                                                                                                                                      |

## Summary

RFC 0013 established **workflow-chain packs**: registry-published DAG fragments a
host expands into a concrete workflow. As adopted, a chain expands into exactly one
flat `WorkflowDefinition` whose data flows only along **edges** and from author-time
`{{params.*}}`. Two shapes real workflows use are therefore inexpressible as chains:

1. **Composition** — one workflow invoking another **child** workflow at run time
   (`core.subWorkflow` / a `core.dispatch` child-run fan-out). RFC 0013 §"WorkflowDefinitionFragment"
   anticipated this: *"Forward-references to other chain packs MAY be allowed in a
   future RFC."* This RFC is that future RFC.
2. **Produced (run-scoped) variables** — a node **writes** a value during the run
   that a downstream node reads by name (the run variable bag), where the value is
   not an author-time parameter and not carried on a typed output port.

This RFC adds both, **additively**: a chain fragment MAY reference sub-chains (which
the host co-expands and co-registers so the parent holds a runtime child), and MAY
declare **produced variables** that pass through to the expanded workflow's variable
bag. No existing chain pack changes shape or behavior; both features are opt-in via
new optional manifest fields.

## Motivation

The reference host (`openwop-app`) has adopted a hard architectural rule: **workflows
are never hard-coded** — a workflow is a **chain** (RFC 0013 pack) or a **stack**
(kanban work-intake). An audit of its ~72 in-tree "builtin" workflows found that all
but a handful convert to chains today; **5 cannot**, blocked on exactly the two gaps
above:

| Workflow | Blocker |
| --- | --- |
| Challenge Factory (`kicktodo.challenge-factory`) | both — invokes a `lesson-batch` **child workflow** (4× per checkpoint) AND threads produced vars (`plan`, `batch0..3`, `evidenceSummary`) |
| `kicktodo.lesson-batch` | the factory's child leg |
| `kicktodo.plan-generation` | produced var (`generate` writes `plan`, `decompose` reads it) |
| `campaign-studio.campaign-orchestration` | **child fan-out** — 5× `core.subWorkflow` (seq) / `core.dispatch` child-run (parallel) over channel chains |
| `kicktodo.enrollment` | produced var (`enroll` writes `enrollmentId`) |

These are not exotic. Composition ("a workflow that runs sub-workflows") and a
run-variable bag are core executor capabilities already used by hand-authored
workflows and the `core.subWorkflow` / `core.dispatch` framework nodes. The chain
**pack format** simply never exposed them. Rather than let these workflows stay
hard-coded, this RFC teaches the pack format to express what the executor already
runs — realizing the model statement **"workflows can hold workflows."**

## Proposal

Two independent, additive extensions to the `kind:"workflow-chain"` manifest. Either
MAY be used alone.

### 1. Sub-chain composition (runtime child chains)

A chain fragment MAY declare **child chains** it composes, and reference them from a
runtime dispatch node. Unlike RFC 0013's author-time inline expansion, a referenced
sub-chain is **co-instantiated as its own registered workflow** and invoked by the
parent at run time — so the parent genuinely *holds* the child (both are owned,
editable workflows after instantiation).

#### 1.1 Manifest: `subChains`

A `WorkflowChain` MAY carry an optional `subChains[]`. Each entry names a chain the
parent composes:

```jsonc
{
  "chainId": "kicktodo.challenge-factory",
  "parameters": { /* … */ },
  "dag": { /* … */ },
  "subChains": [
    { "ref": "lesson-batch" }                          // a sibling chain in THIS pack (by chainId)
    // or an external published chain:
    // { "ref": { "packName": "vendor.acme.presets", "chainId": "acme.enrich", "version": "^1" } }
  ]
}
```

- `ref` is EITHER a string naming a **sibling** `chainId` in the same pack's
  `chains[]`, OR an object `{ packName, chainId, version }` naming an externally
  published chain (resolved + signature-verified like any pack dependency).
- A sibling `ref` that does not match a `chainId` in the same pack, or an external
  `ref` that fails resolution/verification, is a manifest/expansion error
  (`sub_chain_unresolved`). Cycles (a chain that transitively composes itself) are
  rejected (`sub_chain_cycle`).

#### 1.2 Referencing a sub-chain from the DAG

A fragment node invokes a declared sub-chain using the existing runtime composition
nodes, with a new `config.subChainRef` in place of a hard-coded `config.workflowId`:

```jsonc
{ "id": "build-0", "typeId": "core.subWorkflow",
  "config": { "subChainRef": "lesson-batch" },
  "inputs": { /* mapped to the child's parameters/inputs */ } }
```

- `config.subChainRef` MUST match a `subChains[].ref` sibling `chainId` (or the
  `chainId` of an external ref). Using `config.workflowId` (a concrete id) inside a
  chain fragment remains INVALID (a chain must not pin a host-specific workflow id).
- The same applies to `core.dispatch` with `workerDispatchModel:"child-run"`: its
  worker target is a `subChainRef` (or a list thereof), giving the **parallel
  child-fan-out** shape (this is RFC 0118's fan-out expressed at the chain layer).

#### 1.3 Expansion + co-registration (host-side, normative)

When a host instantiates a parent chain (`from-chain`), it MUST:

1. Expand the parent fragment into a `WorkflowDefinition` as in RFC 0013.
2. For each distinct `subChainRef` reachable from the parent's nodes: resolve the
   referenced chain (sibling or external), **recursively expand and register it as
   its own workflow** (with `recordOwnership` for the same tenant), minting a
   **deterministic** id from `(parentExpansionId, childChainId)` so a repeat
   instantiation converges and a shared child is registered once.
3. Rewrite each referencing node's `config.subChainRef` to the minted child
   workflow id under the field the runtime already reads (`config.workflowId` for
   `core.subWorkflow`; the worker target for `core.dispatch`). The child reference
   IS preserved at runtime (unlike an author-time inline chain) — the parent
   dispatches the child as a child run.
4. Register the parent workflow. Parent and every co-registered child are owned +
   builder-editable; the parent surfaces its children as sub-workflow nodes.

Recursion is bounded by the cycle check (§1.1) and a host `maxSubChainDepth`
(RECOMMENDED default 8). A host MAY offer sub-chain instantiation only where it
supports runtime child dispatch; a host that does not MUST refuse with
`sub_chain_unsupported` rather than silently flatten.

### 2. Produced (run-scoped) variables

RFC 0013 replaced a fragment's `variables` with author-time `parameters`. This RFC
restores a **separate, run-scoped** channel for values produced *during* the run.

#### 2.1 Prefer edges

Where a node exposes a value on a **typed output port**, chains MUST pass it via an
explicit `edge` (`sourceOutput` → `targetInput`) — the chain-native dataflow. This
section is ONLY for values a node writes to the **run variable bag** (no typed output
port), which some framework/feature nodes do.

#### 2.2 Manifest: `producedVariables`

A `WorkflowChain` MAY declare `producedVariables[]`, each a value written by one node
and read by others via the executor's `{ "type": "variable", "variableName": "…" }`
input binding:

```jsonc
{
  "chainId": "kicktodo.plan-generation",
  "dag": { /* … */ },
  "producedVariables": [
    { "name": "plan", "producedBy": "generate", "type": "object",
      "description": "the generated plan the decompose node consumes" }
  ]
}
```

- `name` is the bag key. `producedBy` MUST be a `nodes[].id` in the same fragment.
- `type` is a JSON-Schema type for validation/inspection. `producedVariables` are
  **run-scoped**: they carry NO author-time value (that is what `parameters` are for)
  — the manifest DISTINGUISHES the two.
- Any node input binding `{ type:"variable", variableName:"plan" }` MUST reference a
  declared `producedVariables[].name` (or an existing `{{params.*}}`-materialized
  parameter). An undeclared variable read is a manifest error
  (`variable_undeclared`) — closing the "reads a value nothing produces" hole.

#### 2.3 Expansion

On expansion the host MUST emit the declared `producedVariables` into the resulting
`WorkflowDefinition.variables[]` as run-scoped entries (name + type, no value), so
the executor's existing variable bag carries them exactly as in a hand-authored
workflow. No new runtime surface is needed — the executor already supports run
variables; this only lets the **pack format declare them**.

### 3. Schema deltas (`schemas/workflow-chain-pack-manifest.schema.json`)

Additive, all optional:

- `WorkflowChain.subChains?: SubChainRef[]` where
  `SubChainRef = { ref: string | { packName: string, chainId: string, version: string } }`.
- `WorkflowChain.producedVariables?: ProducedVariable[]` where
  `ProducedVariable = { name: string, producedBy: string, type: string, description?: string }`.
- `FragmentNode.config` MAY carry `subChainRef: string` (validated against
  `subChains`). `config.workflowId` inside a fragment remains disallowed (add an
  explicit `not` guard).

No change to `workflow-definition.schema.json` — the expanded output uses its
existing `variables[]` and `core.subWorkflow`/`core.dispatch` shapes.

## Compatibility

**Additive.** Per `COMPATIBILITY.md` §2.2:

- Every new field (`subChains`, `producedVariables`, `config.subChainRef`) is
  OPTIONAL. Existing `kind:"workflow-chain"` manifests validate and expand
  byte-identically — a chain with none of these behaves exactly as under RFC 0013.
- No run-event, dispatch, or wire shape changes. The expanded artifact a host
  dispatches is a normal `WorkflowDefinition` (with `variables[]` +
  `core.subWorkflow`/`core.dispatch` nodes the executor already runs). A host that
  does not implement sub-chain instantiation refuses at author/instantiate time
  (`sub_chain_unsupported`) — it never mis-dispatches.
- Registry index unchanged (chains still list by `chainId`).

## Conformance

New capability-gated scenarios under `conformance/` (chain-composition profile):

1. **`chain.subchain.sibling`** — a pack with a parent chain + a sibling child chain;
   `from-chain` co-registers both, mints a deterministic child id, rewrites the
   parent's `subChainRef` → child id; the parent run dispatches the child.
2. **`chain.subchain.fanout`** — a `core.dispatch` child-run over a `subChainRef`
   worker; N child runs, results collected.
3. **`chain.subchain.cycle-rejected`** — a self-referential chain fails manifest
   validation (`sub_chain_cycle`).
4. **`chain.subchain.unsupported-refused`** — a host without runtime child dispatch
   refuses (`sub_chain_unsupported`), never flattens.
5. **`chain.produced-var.roundtrip`** — a chain declaring `producedVariables`
   expands to a workflow whose `variables[]` carries them; producer writes, consumer
   reads; an undeclared variable read fails (`variable_undeclared`).

## Alternatives considered

- **Author-time inline splicing of sub-chains (RFC 0013's model, extended).** Flatten
  the child into the parent at expansion. Rejected: it cannot express **dynamic**
  invocation (the Factory invokes `lesson-batch` per checkpoint with different
  inputs; a fan-out invokes N children) and it erases the child as an editable unit —
  the opposite of "workflows can hold workflows."
- **Edges-only; forbid produced variables.** Require every hand-off to ride a typed
  output→input edge. Rejected as the *sole* mechanism: some framework/feature nodes
  write to the run bag and expose no typed port, so an edges-only rule would force
  node rewrites purely to satisfy the pack format. Edges remain PREFERRED (§2.1);
  produced variables are the declared escape hatch, validated closed-world.
- **Keep composed/variable workflows hard-coded.** Rejected by the host's doctrine —
  a hard-coded workflow is invisible to the builder + author surfaces and not
  editable; the whole point is to retire the in-tree seam.

## Unresolved questions

1. **External sub-chain versioning + trust.** An external `subChainRef` pulls another
   pack into the trust + version-pin surface. Should co-registration pin the resolved
   version into the parent's ownership record for reproducibility? (Leaning yes.)
2. **Child ownership lifecycle.** When a parent is deleted, are co-registered
   children deleted too, or reference-counted (a child shared by two parents)?
   Proposed: reference-count by deterministic id; delete when the last parent goes.
3. **`maxSubChainDepth` default** — 8 proposed; confirm against real nesting depth.

## Implementation notes (non-normative)

Reference host (`openwop-app`): `expandChain` (`host/workflowChainPackLoader.ts`)
gains recursion over `subChains`; `POST …/workflows/from-chain` co-registers each
child (deterministic id, `recordOwnership`) and rewrites `subChainRef` → minted id
before `registerWorkflow`. `producedVariables` map straight into the emitted
`WorkflowDefinition.variables[]`. This unblocks the 5 audited workflows (Challenge
Factory + `lesson-batch`, `plan-generation`, `campaign-orchestration`, `enrollment`)
to become chains, per `docs/builtin-workflow-migration-audit.md`.

## Acceptance criteria

- [ ] `schemas/workflow-chain-pack-manifest.schema.json` gains the optional
  `subChains`, `producedVariables`, and `config.subChainRef` fields; existing chain
  manifests still validate unchanged.
- [ ] `spec/v1/workflow-chain-packs.md` documents §1 + §2 with the normative
  expansion + co-registration + closed-world variable rules.
- [ ] The 5 conformance scenarios pass against a reference implementation; a
  no-runtime-child-dispatch host passes `chain.subchain.unsupported-refused`.
- [ ] A worked example (the Challenge Factory + `lesson-batch` as a two-chain pack)
  is added under `examples/workflow-chain-packs/`.

## References

- RFC 0013 — Workflow-chain packs (the base this extends; its "future RFC" note on
  forward-references).
- RFC 0118 — parallel dispatch / fan-out (the `core.dispatch` child-run model §1.2
  mirrors at the chain layer).
- `openwop-app` `docs/builtin-workflow-migration-audit.md` — the 5 workflows this
  unblocks; `ARCHITECTURE.md` / `CLAUDE.md` "Workflows — never hard-code" doctrine.
- ADR 0072 (openwop-app) — the deprecated in-tree `builtinWorkflows` seam this
  retires.

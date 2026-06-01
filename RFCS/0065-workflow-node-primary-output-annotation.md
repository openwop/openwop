# RFC 0065: Workflow node primary-output annotation

| Field | Value |
|---|---|
| **RFC** | 0065 |
| **Title** | Workflow node primary-output annotation |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidtufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-06-01 (`Active → Accepted`) — graduated on the **non-steward host** MyndHyve's **genuine consumption** of the annotation (deployed to Firebase Hosting `myndhyve-prod.web.app`, commit `33b498747`; reported via the `billy` crosstalk bus 2026-06-01). MyndHyve shipped `selectPrimaryOutputNode(workflow)` honoring the hint exactly as the v1 convention prescribes: an explicit single `outputRole:"primary"` wins; else the unique terminal node; else null (surface-all, the documented default); `secondary` is never auto-selected (6 unit tests + the always-on server-free `workflow-primary-output-annotation` scenario green on `main`) — the reference-app consumption the path-to-Accepted called for. **Verification basis (honest):** `outputRole` is an advisory authoring-time hint with **no engine-observable effect and no discovery advertisement** by design, so the graduation rests on the adoption-judgment model — the verifiable server-free conformance floor (green on `main`) + a credible non-steward genuine-consumption report — not a steward curl (there is no wire surface to curl). David greenlit building real app-side adoption, not advertise-only. · 2026-05-29 (`Draft → Active`: the wire surface landed atomically — the additive optional `outputRole: "primary" \| "secondary"` field on `WorkflowNode` in `schemas/workflow-definition.schema.json` (`additionalProperties: false` preserved) + the always-on server-free conformance scenario `workflow-primary-output-annotation.test.ts` (6 assertions: primary/secondary validates, `invalid-value` rejects with an `enum` error, field-absent legacy shape still validates — the additive promise). The field is an advisory authoring-time hint with **no engine-observable effect**, so no reference-host execution test is required. Comment window waived (steward acceptance, additive per `COMPATIBILITY.md` §2.1). `Active → Accepted` awaits the reference-app `WorkflowCompletionCard` consuming the annotation — a non-blocking follow-up, architecturally clear from the v1 convention.) |
| **Affects** | `schemas/workflow-definition.schema.json`, `spec/v1/positioning.md`, `conformance/src/scenarios/workflow-primary-output-annotation.test.ts`, FE chat-surface `WorkflowCompletionCard` consumption |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Adds an optional `outputRole: "primary" | "secondary"` field to the `WorkflowNode` shape in `workflow-definition.schema.json`. The field is an **advisory authoring-time hint** that lets a workflow author mark exactly one terminal node as the canonical-deliverable artifact, disambiguating the run's "primary output" when the graph has multiple terminal nodes. Hosts MUST execute the workflow identically regardless of the field's value; tooling that surfaces "the result" of a run (chat-surface completion cards, run-detail page headers, INTEROP-MATRIX artifact pickers) MAY use it to pick one of N terminal-node outputs without resorting to lexicographic / first-found heuristics.

## Motivation

Today the workflow-definition schema has no way for an author to say "of my N terminal nodes, THIS one's output is what the user came for." Tooling that wants to render a "primary artifact" view ends up with one of three bad choices:

1. **Show all N View links** — honest but noisy. A 3-publish workflow surfaces 3 buttons; the user has to know which is which. (This is what `apps/workflow-engine/frontend/react/src/chat/WorkflowCompletionCard.tsx` does today, per the architect review §3 v1 convention.)
2. **Pick by heuristic** (lexicographic node id, first completed, etc.) — deterministic but arbitrary; users can't predict which output will surface.
3. **Hardcode per-workflow** in the consuming tool — non-portable; every host that wants a primary-artifact view has to maintain its own list.

The proposal: let the author declare the canonical-artifact terminal node once in the workflow definition. Tooling consumes the annotation; the engine ignores it.

This came up in the architect-review pass on the chat-thread "WorkflowCompletionCard" feature (see [architect review §3 — "Pick the terminal node by convention" is under-specified for DAGs with multiple terminals](https://github.com/openwop/openwop/pull/159)). The v1 convention there is "N View links for N terminals"; this RFC is the v2 "primary-tagged" path.

## Proposal

### Schema change (additive)

`schemas/workflow-definition.schema.json` — `WorkflowNode` `$def` gains an optional `outputRole` field:

```diff
 "WorkflowNode": {
   "type": "object",
   "required": ["id", "typeId", "name", "position", "config", "inputs"],
   "properties": {
     ...
     "credentialsRef": { "type": "string" },
     "settings": { "type": "object" },
+    "outputRole": {
+      "type": "string",
+      "enum": ["primary", "secondary"],
+      "description": "RFC 0065 — author hint that this terminal node's output is the workflow's primary deliverable (`primary`) or an auxiliary output (`secondary`). Advisory: hosts MUST execute the workflow identically regardless of value. Tooling MAY use the hint to pick which of N terminal nodes' outputs to surface as the run's canonical artifact. Unknown values + absent values fall back to default behavior (show all terminal outputs)."
+    },
     ...
   },
   "additionalProperties": false
 }
```

The field is on `WorkflowNode` (not in `config`) so it composes with the existing first-class typed-field convention (`artifactType`, `cardType`, `outputSensitivity`) and isn't subject to the per-`typeId` `config` shape variation.

### Normative requirements

Hosts MUST:

- Accept a workflow definition where one or more nodes declare `outputRole`. The engine MUST NOT change execution behavior based on the value.
- Accept the field on any node, including non-terminal nodes. (Tooling MAY ignore the annotation on non-terminal nodes since "primary deliverable" only makes sense at terminal nodes; the schema doesn't enforce this because workflow authoring tools may set the field eagerly during graph editing before all edges are wired.)
- Round-trip the value through `GET /v1/workflows/{workflowId}` and `POST /v1/runs` — i.e., the value persists in storage and surfaces back on read.

Hosts SHOULD NOT:

- Reject a workflow that declares `outputRole` on multiple terminal nodes. The schema permits N primaries; tooling picks one deterministically (see "Tooling guidance" below).

Tooling that wants a "primary artifact" view SHOULD:

- Walk the workflow definition's terminal nodes (those with no outgoing edge).
- Pick the one with `outputRole === "primary"`. If none, show all terminals (the v1 fallback).
- If MULTIPLE terminals declare `outputRole === "primary"` (a authoring error tooling may want to tolerate), pick the lexicographically-first node id — deterministic, reproducible across implementations.

### Wire compatibility

- v1.0 / v1.1 hosts reading a workflow with `outputRole` ignore the field (per `WorkflowNode.additionalProperties: false`, the SDK schema-validator must be updated; old SDKs validating against pre-0065 schemas will REJECT the definition with a schema error). This is the existing behavior for every new optional field — SDK consumers MUST bump the workflow-definition.schema.json copy they validate against to v1.1.x to accept the field.
- v1.x hosts that don't recognize the field: schema-validate fails → workflow rejected. Mitigation: hosts MAY upgrade their schema copy without code changes; the field is structurally compatible (string enum).
- Older `WorkflowDefinition` documents (no `outputRole`) continue to validate.

### Out of scope

- "Primary input" annotation — symmetric for input-routing tooling. Could be a follow-up RFC; not in this scope to keep the change minimal.
- Multiple-primaries semantic — left as "tooling decides" rather than schema-enforced. A future RFC could add `"unique-primary-required": true` as a workflow-level setting.
- Engine-side behavior change — explicitly NOT proposed. The annotation is advisory.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1. The new field is optional + has a typed enum + lives on a `$def` whose `additionalProperties: false` setting flips the requirement onto schema-consumers to pull a fresh copy. No existing v1.0 workflow becomes invalid; no engine behavior changes; no event-log shape changes; no replay surface affected.

The schema-copy-bump requirement (SDKs validating against an old copy reject the new field) is an existing v1.x pattern — every additive field carries this constraint. Documented at `COMPATIBILITY.md §2.1` already; this RFC inherits it.

## Conformance

New scenario at `conformance/src/scenarios/workflow-primary-output-annotation.test.ts`:

- **Always-on** (no capability gate — the schema-level shape is uniform across hosts).
- Asserts: a `WorkflowDefinition` document declaring `outputRole: "primary"` on one node + `outputRole: "secondary"` on another validates against `workflow-definition.schema.json` via Ajv2020.
- Asserts: a definition declaring `outputRole: "invalid-value"` rejects with a schema error.
- Asserts: a definition with the field absent (legacy shape) still validates (preserves the additive promise).

No reference-host execution test required — the field has no engine-observable effect by design.

## Alternatives considered

**Reuse `config.outputRole`.** Reject. `config` is per-`typeId` (the node-pack declares its shape); a workflow-level annotation needs a stable typed surface. Adding it to `config` would force every consuming tool to walk an untyped bag.

**Annotate at the workflow level (`WorkflowDefinition.primaryOutputNodeId`).** Reject for two reasons: (1) it duplicates a node identity into the workflow header (drift potential when nodes are renamed/deleted); (2) it can't express "primary + secondary" together for a future "two artifacts: report + dataset" pattern.

**`isPrimaryOutput: boolean`.** Reject. Symmetric annotation needs symmetric values; an enum scales to future roles (`tertiary`, `debug-artifact`) without a boolean explosion.

**RFC the engine to treat `primary` as a checkpoint marker.** Out of scope. Engine behavior is explicitly off the table for v1 — this RFC is purely an annotation. A future RFC could elevate the annotation to checkpoint / replay semantics if a use case lands.

## Unresolved questions

1. Should the schema's `enum` be open-ended (string with description) instead of closed (`["primary", "secondary"]`) to allow vendor extensions like `vendor.foo.review`? Initial position: closed. A vendor that wants more granularity can add a sibling `config.outputRole.vendor` bag without colliding.
2. Should tooling treat `outputRole` on a non-terminal node as a validation warning? Initial position: no — silent ignore. Workflow editors may legitimately set the field during graph editing before all edges are connected. A future linter RFC could surface this as a guidance check.

## Acceptance criteria

- [x] RFC drafted from `RFCS/0000-template.md`
- [ ] Schema change merged with `additionalProperties: false` preserved on `WorkflowNode`
- [ ] Conformance scenario added + passes
- [ ] CHANGELOG entry under `[Unreleased]`
- [ ] README RFC count synced
- [ ] `docs/PROTOCOL-STATUS.md` regenerated
- [ ] Public-comment window: **7 days** (additive per `RFCS/README.md §"Comment windows"`)
- [ ] Reference-app (`apps/workflow-engine/frontend/react/src/chat/WorkflowCompletionCard.tsx`) consumes the annotation in a follow-up PR (architecturally clear from the v1 convention; not blocking ratification)

## References

- Architect review pass on `WorkflowCompletionCard` (PR #159) §3 — "Pick the terminal node by convention" is under-specified
- `COMPATIBILITY.md §2.1` — additive optional-field convention
- `RFCS/0001-rfc-process.md` — proposal process
- `spec/v1/positioning.md` — terminal-node semantics in the openwop graph model

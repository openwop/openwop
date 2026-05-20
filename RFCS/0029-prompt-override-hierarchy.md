# RFC 0029: Prompt Override Hierarchy + `agent.promptResolved` event

| Field | Value |
|---|---|
| **RFC** | 0029 |
| **Title** | Prompt resolution chain across node / agent / workflow / host layers; `agent.promptResolved` observability event; `AgentManifest.promptOverrides` + `promptLibraryRef` extension |
| **Status** | `Draft` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-19 |
| **Updated** | 2026-05-19 |
| **Affects** | `spec/v1/prompts.md` (adds §"Resolution chain (normative)") · `schemas/agent-manifest.schema.json` (adds `promptLibraryRef`, `promptOverrides`) · `schemas/workflow-definition.schema.json` (adds optional `defaults.promptRefs`) · `schemas/capabilities.schema.json` (extends `prompts` block with `defaults`, `agentBindings`) · `schemas/run-event.schema.json` (new `agent.promptResolved` enum entry) · `schemas/run-event-payloads.schema.json` (new `agentPromptResolved` `$def`) · `spec/v1/host-capabilities.md` (notes resolution-chain implementation point) · 3 new conformance scenarios · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |

## Summary

Closes the prompt-resolution semantics gap left by RFC 0027 (which defined the wire shape for templates and refs) and RFC 0028 (which added the discovery + distribution surface): there is currently no normative rule for **which** `PromptRef` wins when multiple are reachable for a given node + kind. This RFC normates a four-layer resolution chain — `WorkflowNode.config` → `AgentManifest` → `WorkflowDefinition.defaults` → host built-in — and emits a new optional `agent.promptResolved` `RunEventType` carrying the resolved chain so cross-host multi-agent debugging surfaces can render "which ref applied at this node, and why" without proprietary host knowledge. Extends `AgentManifest` with two optional additive fields (`promptLibraryRef`, `promptOverrides`) and `WorkflowDefinition` with one optional additive field (`defaults.promptRefs`). The existing `AgentManifest.systemPrompt | systemPromptRef` `oneOf` constraint from RFC 0003 is preserved; the new fields are parallel and do not relax any existing requirement.

## Motivation

After RFC 0027 + RFC 0028 land, a multi-agent workflow can carry prompt references at three independent layers — a node's `config.systemPromptRef`, an agent's intrinsic `systemPrompt`/`systemPromptRef` (RFC 0003), and a host's built-in fallback. There's no normative rule for what happens when more than one is reachable. Three concrete consequences:

1. **Authoring ambiguity.** A workflow author binding a node to an agent (`config.agentId`) cannot predict whether the node's own `systemPromptRef` overrides the agent's intrinsic prompt, or vice versa. Hosts pick differently, workflows break on migration.
2. **Cross-host workflow portability.** A workflow that runs correctly on `myndhyve` (which silently uses node-config-first) breaks on `openwop-reference` (which might use agent-first if not specified). RFC 0027's deliberate restraint — "this RFC stays at the node level only" (RFC 0027 §"Alternatives" #2) — left this gap explicit.
3. **Multi-agent debuggability.** Even with `prompt.composed` (RFC 0027 §E) emitting the composed body, a debugger can't tell *which ref* was the source of truth: was the writer agent's `promptOverrides.system` template used, or did the node-level override win? The `chain[]` trace in this RFC's new event answers that.

The motivating scenario: a `writer` → `critic` → `editor` chain where each node binds to a different agent. The writer's agent has `promptOverrides.system: "prompt:editorial-house-style@1.0.0"`. The workflow author adds a one-off `config.systemPromptRef: "prompt:experimental-writer@2.0.0"` to the writer node only. The host MUST consistently use the experimental override for the writer (per layer 1 precedence) while still applying the house-style template to critic + editor (per layer 2 precedence at their nodes). Without normative resolution rules, this graph silently behaves differently across hosts.

This RFC is the smallest possible closure: define the chain, emit the trace, leave Phase D enhancements (template inheritance, dynamic ref expressions) for future work.

## Proposal

### §A — Resolution chain (normative)

For each `(nodeId, promptKind)` pair where `promptKind ∈ {"system", "user", "few-shot", "schema-hint"}` per RFC 0027 §A, the host MUST resolve a `PromptRef` (or `null`) by walking the following ordered layers and selecting the first non-`null` result. The traversal order is the same for all kinds; per-kind branches are noted inline.

**Layer 1 — Node config (highest precedence).**
- `kind = "system"`: `WorkflowNode.config.systemPromptRef`
- `kind = "user"`: `WorkflowNode.config.userPromptRef`
- `kind = "few-shot"`: `WorkflowNode.config.fewShotPromptRefs[]` (first non-empty entry; further entries surface as `additionalPromptRefs` for composition)
- `kind = "schema-hint"`: `WorkflowNode.config.schemaHintPromptRef`

When the node carries an *inline* string body in the corresponding sibling field (e.g., `config.systemPrompt`) AND a `PromptRef`, the ref wins and the warn-log rule from RFC 0027 §C applies.

**Layer 2 — Agent binding.**

Resolution depends on whether `WorkflowNode.config.agentId` is set and references a known `AgentManifest`:

- For `kind = "system"`:
  - If `AgentManifest.systemPrompt | systemPromptRef` is set (the RFC 0003 intrinsic surface), the resolved ref is **the agent's intrinsic prompt** — a synthetic `PromptRef` projected from the manifest's tarball-relative path or inline body. Host MUST tag this as `source: "agent-intrinsic"` in the chain trace.
  - Else if `AgentManifest.promptOverrides.system` is set (new field, §B below), that ref applies.
  - Else fall through to layer 3.
- For other kinds (`user`, `few-shot`, `schema-hint`):
  - If `AgentManifest.promptOverrides[kind]` is set, that ref applies.
  - Else fall through to layer 3.

If `config.agentId` is unset (or references an unknown agent — host MUST surface this as a `log.appended` warning with `code: "agent_binding_unresolvable"`), layer 2 is **skipped** entirely; resolution proceeds to layer 3.

**Layer 3 — Workflow defaults.**

If `WorkflowDefinition.defaults.promptRefs[kind]` is set, that ref applies. The `defaults` block is new in this RFC (§B below) and is workflow-author-controlled.

**Layer 4 — Host built-ins (lowest precedence).**

If the host's `capabilities.prompts.defaults[kind]` advertises a `PromptRef`, that ref applies. Hosts MAY ship per-kind defaults; the spec ships none.

If all four layers yield `null`, the resolved ref for that `(nodeId, kind)` is `null`. The node MAY still execute — for example, a `core.ai.callPrompt` node with `userPrompt` provided as a direct inline string in `config` doesn't need a `user`-kind ref. Whether a `null` resolution is fatal is per-node-type semantics, not protocol policy.

### §B — Schema diffs

#### `schemas/agent-manifest.schema.json`

Two new optional properties:

```diff
   "properties": {
     "agentId": { ... },
     "persona": { ... },
     "modelClass": { ... },
     "systemPrompt": { ... },
     "systemPromptRef": { ... },
+    "promptLibraryRef": {
+      "type": "string",
+      "pattern": "^[a-z0-9][a-z0-9._-]{0,127}$",
+      "description": "Optional library identifier (per RFC 0028 §C) the agent draws fallback prompts from. When set AND `promptOverrides[kind]` is unset for a given kind, the host MAY look up a same-kind default template from this library at resolution time. Not a replacement for `systemPrompt|systemPromptRef` — those remain the agent's intrinsic system-prompt declaration."
+    },
+    "promptOverrides": {
+      "type": "object",
+      "additionalProperties": false,
+      "properties": {
+        "system":       { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+        "user":         { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+        "few-shot":     { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+        "schema-hint":  { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" }
+      },
+      "description": "Per-kind preferred PromptRefs that apply at resolution layer 2 (see RFC 0029 §A). For `system`, applies only when the manifest has no intrinsic `systemPrompt|systemPromptRef`."
+    },
     "toolAllowlist": { ... },
     ...
   }
```

The existing `oneOf [systemPrompt, systemPromptRef]` constraint is **unchanged**. The two new fields are independent — a manifest MAY have any combination of (`systemPrompt` OR `systemPromptRef`) + `promptLibraryRef` + `promptOverrides`. A manifest MAY also omit all of them when a future host policy supplies the system prompt entirely from elsewhere, BUT today's `oneOf` mandates one of the two intrinsic fields — that constraint stays.

#### `schemas/workflow-definition.schema.json`

One new optional top-level field:

```diff
 {
   "properties": {
     "id": { ... },
     "nodes": [ ... ],
     "edges": [ ... ],
     "triggers": [ ... ],
     "variables": [ ... ],
+    "defaults": {
+      "type": "object",
+      "additionalProperties": false,
+      "properties": {
+        "promptRefs": {
+          "type": "object",
+          "additionalProperties": false,
+          "properties": {
+            "system":      { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+            "user":        { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+            "few-shot":    { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+            "schema-hint": { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" }
+          },
+          "description": "Workflow-author-controlled per-kind fallback PromptRefs that apply at resolution layer 3 (see RFC 0029 §A). Applied when neither the node nor its bound agent specifies a ref for the kind."
+        }
+      }
+    }
   }
 }
```

`defaults.promptRefs` is the only key under `defaults` at this RFC. Future RFCs MAY add sibling defaults (e.g., `defaults.temperature`, `defaults.modelClass`) without colliding.

#### `schemas/capabilities.schema.json`

The `prompts` block (introduced in RFC 0027 §D, extended in RFC 0028 §C) gains two more optional fields:

```diff
   "prompts": {
     "properties": {
       "supported": { ... },
       "templateKinds": { ... },
       "variableSources": { ... },
       "maxTemplateBytes": { ... },
       "observability": { ... },
       "packsSupported": { ... },
       "mutableLibrary": { ... },
       "library": { ... },
+      "defaults": {
+        "type": "object",
+        "additionalProperties": false,
+        "properties": {
+          "system":      { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+          "user":        { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+          "few-shot":    { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" },
+          "schema-hint": { "$ref": "https://openwop.dev/spec/v1/prompt-ref.schema.json" }
+        },
+        "description": "Per-kind host-default PromptRefs that apply at resolution layer 4. Advertised so clients can preview the chain at edit time without dispatching a node."
+      },
+      "agentBindings": {
+        "type": "boolean",
+        "description": "Host honors AgentManifest.promptOverrides[kind] and AgentManifest.promptLibraryRef at resolution layer 2. When false or absent, layer 2 is skipped — the host applies only layers 1, 3, 4. Conformance scenarios for agent-binding resolution are gated on this flag."
+      }
+    }
   }
```

#### `schemas/run-event.schema.json` + `schemas/run-event-payloads.schema.json`

Add the new event type to the enum and define the payload:

```diff
         "agent.reasoned":            { "$ref": "#/$defs/agentReasoned" },
         "agent.reasoning.delta":     { "$ref": "#/$defs/agentReasoningDelta" },
+        "agent.promptResolved":      { "$ref": "#/$defs/agentPromptResolved" },
         "prompt.composed":           { "$ref": "#/$defs/promptComposed" },
```

```json
"agentPromptResolved": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "kind", "chain", "resolved"],
  "description": "Emitted once per (nodeId, kind) pair before the corresponding `prompt.composed` event (when emitted). Surfaces the four-layer resolution chain per RFC 0029 §A so debuggers and multi-agent visualizers can render why a particular PromptRef won. Gated on `capabilities.prompts.supported: true`; payload is durable in the event log and participates in replay.",
  "properties": {
    "nodeId": { "type": "string", "description": "Lifted to top-level RunEventDoc.nodeId; mirrored here for self-contained payload validation." },
    "kind": { "$ref": "https://openwop.dev/spec/v1/prompt-kind.schema.json" },
    "agentId": {
      "type": "string",
      "description": "AgentManifest.agentId when the node has `config.agentId` set; omitted otherwise."
    },
    "chain": {
      "type": "array",
      "description": "Ordered traversal of the four resolution layers. Hosts MUST emit one entry per layer attempted (skipped layers produce an entry with `applied: false` and `reason: \"...\"`).",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["layer", "applied"],
        "properties": {
          "layer": {
            "type": "string",
            "enum": ["run-configurable", "node", "agent-intrinsic", "agent-overrides", "agent-library-default", "workflow-defaults", "host-defaults"],
            "description": "Identifies which precedence layer this chain entry represents. The four normative layers in §A are `node`, `agent-*`, `workflow-defaults`, `host-defaults`. `run-configurable` is reserved for the optional `RunOptions.configurable.promptOverrides` extension described in §\"Alternatives considered\" #5; hosts that honor that extension MUST emit a chain entry with this layer value above the `node` entry."
          },
          "source": {
            "type": "string",
            "description": "The PromptRef stringy form that this layer would have applied (e.g., `prompt:writer@1.0.0`). Present only when this layer had a candidate."
          },
          "applied": {
            "type": "boolean",
            "description": "True for exactly one entry in the chain — the layer whose ref was selected. False for layers that yielded null OR were skipped after a higher-precedence layer already applied."
          },
          "reason": {
            "type": "string",
            "description": "Non-normative human-readable explanation (e.g., `\"agentId unresolved\"`, `\"no candidate at this layer\"`, `\"superseded by node-config layer\"`). Hosts MAY omit; clients MUST tolerate absence."
          }
        }
      }
    },
    "resolved": {
      "type": ["string", "null"],
      "description": "The winning PromptRef in stringy form (`prompt:templateId@version`), or null if no layer yielded a candidate. Mirrors `chain[applied=true].source` when present."
    }
  }
}
```

### §C — Replay + observability

`agent.promptResolved` events are durable and participate in replay. Replay invariants:

- `resolved` MUST replay identically. Divergence MUST emit `replay.diverged` with `divergencePoint: "agent.promptResolved"`.
- `chain[].source` SHOULD replay identically; if a host has rotated host-built-in defaults between original and replay, the `host-defaults` entry's `source` MAY differ — replay tooling MUST tolerate this and surface the rotation explicitly rather than treating it as an integrity failure.
- `chain[].applied` MUST replay identically when `resolved` matches.

Capability gating: emission is conditional on `capabilities.prompts.supported: true`. Hosts that advertise `prompts.observability: "off"` MUST still emit `agent.promptResolved` (the event carries refs, not bodies — no secret-leakage concern) unless they also advertise a new fine-grained flag (see §"Unresolved questions" #2).

### §D — Authoring + tooling integration

The React example app (per the accompanying analysis, Part 5) consumes the `agent.promptResolved` chain via the SSE event stream to render an inline disclosure beneath each node in `WorkflowRunBubble.tsx`:

```
▸ node:writer
   kind: system
   resolved: prompt:experimental-writer@2.0.0
   chain:
     ✓ node-config (prompt:experimental-writer@2.0.0)
     ✗ agent-overrides (prompt:editorial-house-style@1.0.0) — superseded
     ✗ workflow-defaults (none)
     ✗ host-defaults (none)
```

This rendering is non-normative — hosts and tools MAY surface the chain differently. The event payload is the protocol surface.

For workflow editors, the `chain[].source` field enables a "Why this prompt?" tooltip at edit time without dispatching the workflow: the editor can call `POST /v1/prompts:render` (RFC 0028 §A) to preview the composed body and compute the resolution chain client-side by walking the same layers.

### §E — Security carry-forward

- `agent.promptResolved` payloads carry PromptRefs (identifiers), not composed bodies. The redaction invariants from RFC 0027 §G apply only to the downstream `prompt.composed` event, not to this one.
- Trust-boundary propagation (`meta.contentTrust`) is not surfaced on `agent.promptResolved` because resolution happens before content is bound to variables. The trust marker first appears on `prompt.composed` per RFC 0027 §E.
- `AgentManifest.promptLibraryRef` resolves against the same library namespace as `PromptRef.libraryId` per RFC 0028 §B "Conflict resolution". When the agent manifest references a library that isn't installed on the host, the host MUST emit `log.appended` at `level: "warn"` with `code: "agent_library_unresolvable"` and continue with layer-2 skip.

## Compatibility

**Additive per `COMPATIBILITY.md §2.1`.** All claims:

- Existing `AgentManifest` fields: unchanged. The `oneOf [systemPrompt, systemPromptRef]` constraint from RFC 0003 is preserved verbatim. Two new optional siblings.
- Existing `WorkflowDefinition` fields: unchanged. One new optional top-level `defaults` field; absent in every existing workflow.
- Existing `capabilities.prompts` block: unchanged. Two new optional fields.
- Existing event types: unchanged. `agent.promptResolved` is a new enum entry; consumers MUST tolerate unknown event types per `run-event.schema.json` line 64.
- Existing endpoints: unchanged. No new REST surface in this RFC.
- Existing MUST requirements: not relaxed. The resolution chain in §A is normative for hosts advertising `capabilities.prompts.supported: true`; hosts that don't advertise see no behavioral change.
- Existing error codes: unchanged. Two new optional `log.appended` codes (`agent_binding_unresolvable`, `agent_library_unresolvable`) only surface when the capability is advertised.

A workflow that doesn't reference any agent, doesn't carry `defaults.promptRefs`, and runs against a host without prompt support sees zero behavioral change.

A workflow that DOES reference agents and runs against a host advertising `capabilities.prompts.agentBindings: false` sees layer 2 skipped — the same behavior the host had before adopting RFC 0027.

## Conformance

Three new scenarios under `conformance/src/scenarios/`. All gated on `capabilities.prompts.supported: true`.

- `prompt-resolution-chain-node-wins.test.ts` — Construct a workflow with a node carrying `config.systemPromptRef`, bound to an agent with both intrinsic `systemPromptRef` and `promptOverrides.system`. Assert the emitted `agent.promptResolved` event shows `chain[0].applied: true` (`layer: "node"`) and `resolved` matches the node's ref. Asserts subsequent `prompt.composed` event's `hash` matches a `:render` preview using the node-config ref.

- `prompt-resolution-chain-agent-intrinsic.test.ts` — Same workflow shape but with the node's `config.systemPromptRef` removed. Assert `chain[1].applied: true` (`layer: "agent-intrinsic"`) and `resolved` projects from the agent's `systemPromptRef`. Gated additionally on `capabilities.prompts.agentBindings: true`.

- `prompt-resolution-chain-fallback-cascade.test.ts` — Workflow with no node-level or agent-level refs but `WorkflowDefinition.defaults.promptRefs.system: "prompt:fallback@1.0.0"` set. Host advertises `capabilities.prompts.defaults.system: "prompt:host-default@1.0.0"`. Assert `chain[2].applied: true` (`layer: "workflow-defaults"`) and `resolved` matches `prompt:fallback@1.0.0` — NOT the host default. Then drop the workflow's `defaults` block and assert `chain[3].applied: true` (`layer: "host-defaults"`).

A fourth scenario `prompt-resolution-replay-determinism.test.ts` SHOULD be added to verify the `resolved` replay invariant from §C, but only if the host advertises any replay capability (`capabilities.replay.supported: true`); otherwise the scenario skips.

The `behaviorGate` helper gains a `requirePromptAgentBindings()` predicate.

## Alternatives considered

1. **Defer layer 4 (host defaults).** Ship only three layers; remove `capabilities.prompts.defaults`. Rejected — the host-default layer is structurally necessary to handle the "node carries no ref, no agent, no workflow default" case without throwing a hard error. Hosts that ship no defaults simply leave the block absent; layer 4 then yields `null` and the kind resolves to `null` cleanly.

2. **Reverse precedence (agent wins over node).** Some authoring tools (notably canvas-editor patterns where the agent is the "primary unit of authorship") expect the agent's prompt to be authoritative. Rejected — node-level precedence is the principle-of-least-surprise for workflow-graph editors, matches RFC 0013's chain-pack expansion semantics (node config is the editable surface), and gives authors a clean "override one node without forking the agent" affordance. The reverse direction is achievable via `AgentManifest.promptLibraryRef` + agent intrinsic prompt; the override-at-node case is the harder one to express otherwise.

3. **Inline-resolution-chain semantics on `prompt.composed` instead of a separate event.** Save one event per node-execution by lifting `chain[]` into the existing `prompt.composed` payload. Rejected — `agent.promptResolved` emits even when `prompt.composed` is suppressed (e.g., `observability: "off"`), and the resolution step is conceptually separate from composition (resolution is *which ref applied*; composition is *what the body became*). Replay diagnostics benefit from the separation.

4. **Single `promptOverride` field on AgentManifest holding a kind→PromptRef map plus a `system` override that races with `systemPromptRef`.** Rejected as XOR-modeling complexity. Keeping the RFC 0003 `oneOf` intact and adding `promptOverrides` as a sibling (with `system` resolution falling through to it only when no intrinsic is set) preserves install-time validation and keeps the migration story clean: existing manifests don't break.

5. **Use `RunOptions.configurable` for per-run prompt overrides instead of layer 3.** RFC 0027 §"Implementation notes" hinted at this; `RunOptions.configurable` is the canonical opaque overlay. Rejected as the *exclusive* mechanism — opaque-overlay overrides are still useful for one-off per-run tweaks, but a workflow-author surface (the workflow JSON itself carrying defaults) is structurally different from a runner surface. Both can coexist: `configurable.promptOverrides` MAY be honored by hosts as the **highest-precedence layer** (i.e., applied *before* layer 1 in the traversal, taking precedence over the node's `config.*PromptRef`) as a non-normative extension. This RFC doesn't normate that path (deferred to a future RFC); hosts that implement it MUST surface the choice in the `agent.promptResolved.chain[]` trace with `layer: "run-configurable"` so cross-host debuggers can render the additional step.

## Unresolved questions

1. **`few-shot` collection ordering.** Layer 1 introduces `config.fewShotPromptRefs[]` as an array. When agent-overrides also yield few-shot refs (`promptOverrides["few-shot"]`), does the agent's ref *prepend*, *append*, or *replace* the node's array? Recommendation: **replace** (consistent with single-ref layers); future RFC can introduce explicit `merge: "prepend" | "append"` semantics if author demand emerges. Provisionally documented as "replace" in §A; flagged here for explicit reviewer attention.

2. **Should `agent.promptResolved` honor an `observability: "off"` setting?** RFC 0027 §D ties `prompt.composed` emission to the `observability` enum. `agent.promptResolved` carries only refs (no bodies, no variable bindings) and so is arguably always safe to emit. Recommendation: **always emit** when `capabilities.prompts.supported: true`, regardless of `observability`. Documented this way in §C; reviewers may push back.

3. **Layer-2 `agent-library-default` semantics.** When `AgentManifest.promptLibraryRef` is set but `promptOverrides[kind]` is absent, the spec hints that the host MAY look up a same-kind default template from the library (per §B description). The lookup convention — e.g., does `prompt:<libraryId>.default-<kind>` resolve? — isn't specified. Recommendation: **leave as host policy** in this RFC; document the convention in a non-normative companion note if/when a host implements it.

4. **Capability for replay-determinism of `agent.promptResolved`.** Should the `replay.diverged` invariant in §C be a hard MUST (matching `prompt.composed.hash`) or a SHOULD (acknowledging host-default rotation)? Recommendation: **SHOULD**, with hosts that rotate defaults required to emit a separate `version.pinned` event capturing the rotation. Flagged for governance review.

5. **JSON Schema cross-reference of `promptKind` enum.** Resolved by RFC 0027 §A, which lands `schemas/prompt-kind.schema.json` as the shared `$def`. All references in this RFC's schema diffs — `agent-manifest.schema.json` (`promptOverrides` keys), `workflow-definition.schema.json` (`defaults.promptRefs` keys), `capabilities.schema.json` (`prompts.defaults` keys), `run-event-payloads.schema.json` (`agentPromptResolved.kind`) — `$ref` the shared file rather than inlining the enum. Listed here as previously-tracked; the resolution is in RFC 0027.

## Implementation notes (non-normative)

- Reference host `apps/workflow-engine/backend/typescript` MUST implement the resolution chain inline in the `core.ai.callPrompt` execution path. The cleanest placement is a `resolvePromptRef(node, kind, agentManifest, workflowDefn, hostDefaults): { ref, chain }` helper invoked at the top of node execution, with the returned `chain[]` immediately emitted as `agent.promptResolved` before any composition. The MyndHyve reference impl's `WorkflowPromptService.resolveForExecution()` at `src/core/workflow/services/WorkflowPromptService.ts` is the closest existing prior-art (single-host) — porting the four-layer semantics into the openwop reference takes ~1 day.
- The `agentBindings: false` posture is a useful shipping mode for hosts that adopt RFC 0027/0028 without yet implementing agent-aware resolution. Document this in `host-capabilities.md` as a valid mid-migration state.
- React example app integration (per Part 5 of the accompanying analysis): subscribe to `agent.promptResolved` events in `src/client/streamsClient.ts` and render the chain disclosure in `WorkflowRunBubble.tsx`. The chain trace is the highest-value UX surface this RFC enables.
- Estimated effort: schemas + spec text ~1 day; reference-host resolution helper + event emission ~1.5 days; three conformance scenarios ~1.5 days; CHANGELOG ~30 min. Total ~4–5 days plus the standard Active window (or bootstrap waiver).
- RFC 0029 is structurally the final piece of the prompt-library track: RFC 0027 = wire shape, RFC 0028 = surface, RFC 0029 = semantics. Subsequent prompt-related work (template inheritance, dynamic ref expressions, prompt-pack dependency closure) would build on this foundation but is not blocked by it.

## Acceptance criteria

Promotion from `Active` → `Accepted`:

- [ ] `spec/v1/prompts.md` extended with §"Resolution chain (normative)" describing the four-layer semantics from §A.
- [ ] `schemas/agent-manifest.schema.json` extended with `promptLibraryRef` and `promptOverrides`.
- [ ] `schemas/workflow-definition.schema.json` extended with optional top-level `defaults.promptRefs`.
- [ ] `schemas/capabilities.schema.json` `prompts` block extended with `defaults` and `agentBindings`.
- [ ] `schemas/run-event.schema.json` adds `"agent.promptResolved"` to the `RunEventType` enum.
- [ ] `schemas/run-event-payloads.schema.json` adds `agentPromptResolved` `$def` and `_typeIndex` entry.
- [ ] Three new conformance scenarios per §"Conformance" land in `@openwop/openwop-conformance`; suite minor-version bumps.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] `INTEROP-MATRIX.md` extended with a `capabilities.prompts.agentBindings` row alongside the RFC 0027/0028 prompts rows.
- [ ] Reference host (`apps/workflow-engine/backend/typescript`) advertises `capabilities.prompts.agentBindings: true`, implements the four-layer resolution helper, emits `agent.promptResolved` per node execution, passes all three new conformance scenarios.
- [ ] First non-steward host advertises `capabilities.prompts.agentBindings: true` (third-party validation gate per RFC 0001). MAY be waived under bootstrap-phase waiver.

## References

- `RFCS/0027-prompt-templates.md` — Phase A: PromptTemplate + PromptRef wire shape, `prompt.composed` event, capabilities.prompts block. This RFC layers semantics on top.
- `RFCS/0028-prompt-library-endpoints.md` — Phase B: `/v1/prompts/*` endpoints, prompt-pack kind. This RFC consumes the library identifier surface introduced there for `promptLibraryRef`.
- `RFCS/0003-agent-packs.md` — AgentManifest baseline this RFC extends; the `systemPrompt | systemPromptRef` `oneOf` constraint preserved verbatim.
- `RFCS/0002-agent-identity-and-reasoning-events.md` — AgentRef + `agent.*` event family precedent for `agent.promptResolved`.
- `RFCS/0024-agent-reasoning-streaming.md` — `agent.reasoned` + `agent.reasoning.delta` model for adding new optional `agent.*` events as additive surface.
- `RFCS/0026-provider-usage-event.md` — durable per-invocation event precedent; replay-determinism posture.
- `spec/v1/replay.md` — replay invariants this RFC extends with one new `divergencePoint`.
- `spec/v1/workflow-definition.md` — schema this RFC extends with `defaults`.
- External: MyndHyve `WorkflowPromptService.resolveForExecution()` reference impl at `src/core/workflow/services/WorkflowPromptService.ts` — closest single-host prior-art for four-layer resolution; this RFC ports its semantics into protocol-level normative text.

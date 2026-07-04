# RFC 0124: Portable per-run parameter deferral for workflow-chain packs

| Field             | Value                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0124                                                                                                                        |
| **Title**         | Portable per-run parameter deferral for workflow-chain packs (WCP4)                                                         |
| **Status**        | `Draft`                                                                                                                     |
| **Author(s)**     | David Tufts (@dtuftsg)                                                                                                       |
| **Created**       | 2026-07-04                                                                                                                  |
| **Updated**       | 2026-07-04                                                                                                                  |
| **Affects**       | `spec/v1/workflow-chain-packs.md`, `spec/v1/capabilities.md`, `schemas/capabilities.schema.json`, `schemas/workflow-chain-pack-manifest.schema.json` (non-normative note), `conformance/src/scenarios/workflow-chain-*.test.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` — a new OPTIONAL capability-gated expansion mode; expansion-time substitution remains the default and floor |
| **Supersedes**    | —                                                                                                                          |
| **Superseded by** | —                                                                                                                          |

## Summary

RFC 0013 requires workflow-chain-pack `{{params.<name>}}` placeholders to be substituted at **expansion time** and forbids deferring them to dispatch, because there is no runtime `{{...}}` interpolation construct over `WorkflowNode.config`/`inputs` — a persisted placeholder would ship verbatim to a downstream host and break cross-host portability. This RFC adds an OPTIONAL, capability-gated **deferred-parameter expansion mode** that keeps chain parameters overridable per run *without* breaking portability: at drop time the host materializes the chain's `parameters` into top-level workflow `variables[]` and rewrites each `{{params.x}}` into an already-spec'd runtime binding (a PromptTemplate `{{varName}}` slot with `source: "variable"`, or a variable-sourced PortValue). The persisted workflow contains **no** `{{params.*}}` tokens, so every conformant host resolves it identically. This does **not** relax RFC 0013's expansion-time `MUST`; both modes coexist.

## Motivation

Workflow-chain packs (RFC 0013 / `workflow-chain-packs.md`) are author-time drag-tile abstractions that expand into concrete `core.*` DAG fragments. RFC 0013 §"Parameter substitution" mandates that `{{params.<name>}}` placeholders are resolved at expansion time — the dropped tile freezes the author-supplied parameter values into the persisted workflow, and the dispatching runtime never sees a placeholder.

Downstream reference hosts want a different authoring ergonomic. **openwop-app (ADR 0163 / ADR 0237)** treats a dropped chain tile as a *reusable, re-parameterizable* workflow: the parameter values should stay overridable on each run rather than being frozen at drop time. openwop-app's shipped implementation achieves this by leaving `{{params.*}}` tokens in the persisted `config`/`inputs` and resolving them at run time from a per-run variable bag.

That implementation is **non-conformant** (the WCP4 open spec gap in `workflow-chain-packs.md`, and the 2026-07-04 RFC 0013 amendment): `WorkflowNode.config` holds pre-execution constants and `inputs` holds PortValue references, and no `{{...}}` runtime interpolation is defined over them. The only spec'd runtime `{{varName}}` interpolation surface is `prompts.md` §"Variable interpolation" (RFC 0027), scoped to `PromptTemplate.text`. A workflow persisted with a live `{{params.productIdea}}` in `config.systemPrompt` therefore ships the literal string `"{{params.productIdea}}"` to the model on any host that does not share openwop-app's private bag — silently corrupting the run and violating RFC 0013's central portability invariant ("a workflow author can switch hosts without their workflows breaking, because the expanded JSON references only typeIds the destination host can resolve").

The re-parameterizable goal is legitimate and worth serving — but portably. The spec already has every primitive needed to do it on the wire: run-scoped `variables[]` (`workflow-definition.schema.json#/$defs/WorkflowVariable`), the PromptTemplate `{{varName}}` interpolation with `source: "variable"` (resolved via `ctx.variables.get()`), variable-sourced PortValues, per-run `configurable` overrides (`run-options.md`), and deterministic variable replay (`replay.md` §"Determinism" — `RunSnapshot.variables` MUST be byte-equivalent across original and replay). This RFC composes those primitives into a portable deferral mode so no host needs a private token convention.

## Proposal

### Capability gate

Add an OPTIONAL sibling flag to the existing `workflowChainPacks` capability block (`capabilities.md` §`workflowChainPacks`, `schemas/capabilities.schema.json`):

```jsonc
"workflowChainPacks": {
  "supported": true,
  "deferredParameters": {           // NEW — optional
    "supported": true
  }
}
```

- A host advertising `workflowChainPacks.deferredParameters.supported: true` MAY offer the deferred-parameter expansion mode described below **in addition to** expansion-time substitution.
- Expansion-time substitution (RFC 0013) remains the **default and the floor**: a host advertising `workflowChainPacks.supported: true` MUST implement expansion-time substitution regardless of the deferred flag. `deferredParameters` is purely additive; a host that omits it is fully v1-compliant and behaves exactly as today.
- Deferred mode SHOULD only be offered when the host also advertises `capabilities.prompts.supported: true` with `variable` present in `prompts.variableSources`, since the prompt-bearing rewrite target depends on PromptTemplate variable interpolation. A host that advertises `deferredParameters.supported: true` without prompt-variable support MUST fall back to expansion-time substitution for any prompt-bearing token it cannot portably rewrite (see §"Rewrite targets").

### Deferred-parameter expansion (normative)

When a host operating in deferred mode expands a chain tile, in place of RFC 0013 §"Expansion semantics" step 5 (literal substitution) it MUST:

1. **Materialize parameters as variables.** For each property `p` in the chain's `parameters` JSON Schema, the host MUST add a top-level `WorkflowVariable` to the parent workflow's `variables[]`:
   - `name` — a collision-free variable name derived from `p` and the per-expansion prefix (e.g. `${chainIdSlug}_${expansionId}_${p}`), so two expansions of the same chain do not clash.
   - `type` — copied from the parameter's declared JSON-Schema `type` (`string` / `number` / `boolean` / `object` / `array`).
   - `defaultValue` — the author-supplied value collected at drop time (RFC 0013 step 4). This preserves the drop-time value as the default while leaving it overridable per run.
   - `required` — mirrors the chain `parameters.required` membership.
   - `sensitive` — the host MUST set `sensitive: true` when the parameter is known to carry secret-class material; see §Security.
2. **Rewrite tokens to spec'd bindings.** The host MUST replace every `{{params.x}}` occurrence with a portable runtime binding per §"Rewrite targets" below. The persisted `config`/`inputs` MUST NOT retain any `{{params.*}}` token.
3. **Preserve the portability invariant.** After rewrite, the expanded fragment MUST contain only (a) concrete typeIds, (b) PromptTemplate `{{varName}}` slots backed by declared `variables[]`, and (c) PortValue references — all of which any conformant host resolves. A host MUST NOT persist a workflow whose `config`/`inputs` contain `{{params.*}}` tokens under any mode.

Steps 3, 6, 7, 8, 9 of RFC 0013 §"Expansion semantics" (typeId validation, id rewrite, splice, capability propagation, persist) apply unchanged.

### Rewrite targets

For each `{{params.x}}` token, the host MUST choose the portable target by position:

| Token position | Portable rewrite target |
| --- | --- |
| Inside a prompt body the host composes as a PromptTemplate (`config.systemPromptRef` / `userPromptRef` / `additionalPromptRefs` → `PromptTemplate.text`, per `prompts.md`) | Rewrite `{{params.x}}` → the PromptTemplate placeholder `{{v}}` where `v` is the materialized variable name, and declare a matching `PromptVariable` with `source: "variable"` so it resolves via `ctx.variables.get(v)` at node-execution time. |
| A **whole-value** `config`/`inputs` token (the string is exactly `{{params.x}}`) | Bind the input/config key to a **variable-sourced PortValue** (a PortValue referencing the materialized variable), NOT a raw string token. The typed variable value flows through unchanged, composing with the WCP2 whole-value-typed rule (RFC 0013 amendment 2026-07-04). |
| An **embedded** token in a non-prompt plain `config` string (surrounding text) | The host MUST resolve it at expansion time (RFC 0013 literal substitution) — there is no portable runtime string-interpolation surface for arbitrary `config` strings in v1. Deferred mode does NOT invent one. |

The third row is the deliberate boundary of v1 deferral: only prompt bodies (which have a spec'd `{{varName}}` interpolation) and whole-value bindings (which have PortValue variable refs) can be deferred portably. Embedded tokens in arbitrary non-prompt config remain expansion-time. A general runtime string-interpolation construct over `WorkflowNode.config` is explicitly out of scope (Unresolved Q3).

### Per-run override

Because materialized parameters are ordinary `variables[]`, they are overridable per run through the existing surfaces with no new endpoint:

- `POST /v1/runs` `configurable` (when the workflow declares a `configurableSchema` mapping the variable), and
- `POST /v1/runs/{runId}:fork` `configurable` overrides (`replay.md` §"Replay vs branch-from-past").

The drop-time `defaultValue` applies when no override is supplied. This is exactly the "reusable, re-parameterizable tile" ergonomic openwop-app wants, expressed in spec'd wire shape.

### Positive example

Chain `vendor.acme.generatePRD` with `parameters.productIdea: {type: string}`, dropped in deferred mode on `workflow-abc` with `productIdea = "AI toaster"`:

```jsonc
// parent workflow AFTER deferred expansion — NO {{params.*}} tokens remain
{
  "variables": [
    { "name": "vendor_acme_generatePRD_a8f3_productIdea",
      "type": "string", "required": true, "defaultValue": "AI toaster" }
  ],
  "nodes": [
    { "id": "vendor_acme_generatePRD_a8f3_prd-call",
      "typeId": "core.ai.callPrompt",
      "config": {
        "systemPromptRef": { "templateId": "…", "version": "…" }
        // PromptTemplate.text: "…Write a PRD for: {{vendor_acme_generatePRD_a8f3_productIdea}}"
        // with PromptVariable { name: "vendor_acme_generatePRD_a8f3_productIdea", source: "variable" }
      }
    }
  ]
}
```

A run overrides it with `POST /v1/runs {"configurable": {"productIdea": "AI kettle"}}`; a fork re-parameterizes historically with the same `configurable` key. Any conformant host with `prompts.supported: true` resolves the template identically.

### Negative example

A host in deferred mode persisting `config.systemPrompt = "Write a PRD for: {{params.productIdea}}"` (a raw `{{params.*}}` token still present) → **rejected**: violates step 3. The token MUST have been rewritten to a PromptTemplate `{{varName}}` slot or resolved at expansion time. There is no conformant persisted state containing `{{params.*}}`.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1. Per-clause guarantees:

- **Capability:** `workflowChainPacks.deferredParameters` is a new OPTIONAL object on an OPTIONAL block. Hosts that omit it stay v1-compliant; existing `workflowChainPacks.supported` consumers ignore the unknown sibling per `COMPATIBILITY.md` §2.1 ignore-unknown rule. `additionalProperties: false` on `workflowChainPacks` is extended by adding the property to the schema (additive optional field).
- **Wire shape:** no existing field changes type or requiredness. Every rewrite target (`variables[]`, PromptTemplate `{{varName}}`, variable-sourced PortValue) is an existing v1 construct — nothing new appears on the `WorkflowDefinition` wire.
- **RFC 0013 `MUST` unrelaxed:** expansion-time substitution remains mandatory and the floor. This RFC adds an alternate gated mode; it does not weaken any RFC 0013 requirement. The persisted-token prohibition is *strengthened* uniformly (no mode may persist `{{params.*}}`), which matches — not relaxes — RFC 0013's existing "no placeholders remaining" guarantee.
- **Replay/fork:** materialized parameters are ordinary `variables[]`; `replay.md` §"Determinism" already requires `RunSnapshot.variables` byte-equivalence across replay, so deferred-mode runs fork deterministically with no new event type. Per-run overrides travel as `configurable` (already event-logged), not a machine-local bag.

No migration is required. openwop-app migrates from its non-conformant private-token model to this mode as its own follow-up (it is the natural first implementer + a dual-witness path to `Accepted`).

## Conformance

**Existing coverage.** `workflow-chain-expansion.test.ts` (server-free, spec-authoritative lib) + `workflow-chain-pack-manifest-validation.test.ts` + `workflow-chain-host-expansion.test.ts` (live-host, gated on `workflowChainPacks.supported`).

**New scenarios (land with `Accepted`):**

1. `workflow-chain-deferred-parameters.test.ts` (server-free) — deferred expansion of a chain materializes `variables[]` with `defaultValue` = author input + `type` copied from the parameter schema; every `{{params.*}}` token is rewritten (prompt token → `{{varName}}` + `source:"variable"`; whole-value token → variable-sourced PortValue); the persisted fragment contains **zero** `{{params.*}}` tokens; a typed (object/number) whole-value param composes with the WCP2 raw-typed rule. Gated logically on the deferred mode; runs unconditionally as spec-corpus logic.
2. Host-side leg in `workflow-chain-host-expansion.test.ts` gated on `capabilities.workflowChainPacks.deferredParameters.supported: true` — a deferred expansion round-trips, a `POST /v1/runs` `configurable` override changes the resolved value, and a `:fork` replays the same bound value (determinism). Hosts without the flag are skipped, not failed.

**Capability gating.** New host legs gate on `workflowChainPacks.deferredParameters.supported` per `conformance/coverage.md` §"Capability-gated scenarios".

**INTEROP-MATRIX.** Add a `workflowChainPacks.deferredParameters` advertisement column; the three reference hosts advertise honest-off until one implements.

## Alternatives considered

1. **Relax RFC 0013's expansion-time `MUST` to permit app-private `{{params.*}}` runtime tokens (do the minimal erratum openwop-app asked for).** Rejected: this reintroduces exactly the cross-host portability break RFC 0013 was designed to prevent (and that its Alt-3 "runtime sub-DAG dispatch" was rejected to avoid). A persisted `{{params.*}}` token is unresolvable by any host that doesn't share the private bag.
2. **Define a brand-new runtime `{{}}` interpolation construct over all `WorkflowNode.config`/`inputs`.** Rejected for v1: it is a far larger surface (every host must implement a config-templating engine + its escaping/injection semantics), duplicates the PromptTemplate interpolation that already exists, and expands the prompt-injection surface to arbitrary config. This RFC deliberately reuses the *existing* `{{varName}}` surface and confines deferral to prompt bodies + whole-value bindings. A general config-templating RFC can build on this later (Unresolved Q3).
3. **Do nothing (keep WCP4 an open gap).** Rejected: openwop-app already ships a non-conformant model in production; leaving the gap open means a shipped reference host stays divergent and the portability invariant stays quietly violated. An additive, gated, portable mode lets that host become conformant without freezing its UX.

## Unresolved questions

1. **Variable-name collision policy.** The `${chainIdSlug}_${expansionId}_${p}` scheme mirrors RFC 0013 step 6 node-id rewriting, but `configurable` override keys are author-facing — should the RFC define a friendlier alias (e.g. a `configurableSchema` mapping from the bare param name to the prefixed variable) so run-time callers pass `productIdea`, not the prefixed form? Leaning yes; deferred to `Active`.
2. **`sensitive` inference.** How does the host know a chain parameter carries secret-class material to set `sensitive: true`? Options: a new OPTIONAL `parameters.properties.<p>.x-openwop-sensitive` manifest hint, or leave it host-judgment with a `SHOULD`. Needs a decision before the redaction invariant can be tightened from `SHOULD` to `MUST`.
3. **Embedded tokens in non-prompt config.** v1 deferral resolves these at expansion time (no portable target). Is a general runtime string-interpolation construct over `config` worth a future RFC, or should chains be guided to model such values as whole-value bindings? Deferred to a follow-up.
4. **`configurableSchema` authoring.** Should deferred expansion auto-generate/extend the parent workflow's `configurableSchema` so the materialized variables are override-validated, or is that the author's responsibility? Interacts with Q1.

## Implementation notes (non-normative)

- **Sequencing:** `Draft` (this RFC, comment window) → `Active` (capability + spec prose + schema, Q1/Q2 resolved) → `Accepted` (conformance scenarios + one reference host implements + dual-witness). No cross-cut (`CC-N`) needed — additive and gated; it can merge independently of other tracks.
- **Reference implementer:** openwop-app (ADR 0237) is the natural first host — it already has the run-scoped variable bag; the work is to move the rewrite from private tokens to materialized `variables[]` + PromptTemplate `{{varName}}`. A second witness (in-memory reference host or a tier-2 sibling) closes `Accepted`.
- **Estimated effort:** capability + schema + spec prose ~1–2 days; conformance scenarios ~1 day; reference-host rewrite ~2–3 days.

## Acceptance criteria

- [ ] Spec text merged: `workflow-chain-packs.md` §"Deferred-parameter expansion (normative)" + WCP4 gap row updated to point at this RFC.
- [ ] Schema updated: `workflowChainPacks.deferredParameters` in `capabilities.schema.json` + `capabilities.md` documentation.
- [ ] At least one server-free conformance scenario (`workflow-chain-deferred-parameters.test.ts`) + one capability-gated host leg.
- [ ] CHANGELOG entry under the appropriate `[Unreleased]` / version.
- [ ] One reference host implements deferred mode and passes the gated scenario, OR the RFC explicitly defers reference-host implementation to a named follow-up.
- [ ] Unresolved Q1 (name/alias) + Q2 (`sensitive` inference) resolved before `Active`.

## References

- **Motivating open gap:** `spec/v1/workflow-chain-packs.md` §"Open spec gaps" WCP4 + the RFC 0013 amendment (2026-07-04) adjudicating `{{params.*}}` timing.
- **Motivating downstream host:** openwop-app ADR 0163 / ADR 0237 (per-run parameter overridability; the private-token model this RFC makes portable).
- **Reused primitives:** `spec/v1/prompts.md` §"Variable interpolation" (RFC 0027 — PromptTemplate `{{varName}}`, `PromptVariable.source: "variable"`); `schemas/workflow-definition.schema.json#/$defs/WorkflowVariable`; `spec/v1/run-options.md` (`configurable`); `spec/v1/replay.md` §"Determinism" (`RunSnapshot.variables` byte-equivalence).
- **Related RFCs:** RFC 0013 (workflow-chain packs — the base this extends); RFC 0027 (prompt templates); RFC 0029 (prompt override hierarchy / resolution chain).
- **Security:** `SECURITY/threat-model-prompt-injection.md` (run-time param as untrusted content); `SECURITY/threat-model-secret-leakage.md` §SR-1 (`sensitive` redaction in `prompt.composed`).
- **Prior art:** BPMN call-activity input mappings (design-time vs run-time data binding); Temporal workflow arguments (per-execution inputs vs pinned config); LangGraph `configurable` + `update_state` (the fork-override idiom `replay.md` already parallels).

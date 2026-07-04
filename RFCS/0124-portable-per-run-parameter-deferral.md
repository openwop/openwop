# RFC 0124: Portable per-run parameter deferral for workflow-chain packs

| Field             | Value                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0124                                                                                                                        |
| **Title**         | Portable per-run parameter deferral for workflow-chain packs (WCP4)                                                         |
| **Status**        | `Active`                                                                                                                    |
| **Author(s)**     | David Tufts (@dtuftsg)                                                                                                       |
| **Created**       | 2026-07-04                                                                                                                  |
| **Updated**       | 2026-07-04 (Draft → Active — bootstrap steward waiver, 7-day comment window waived)                                          |
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
4. **Fence deferred variables as untrusted.** A deferred-materialized variable interpolated into a PromptTemplate MUST compose with `bindingTrust: "untrusted"`, yielding aggregate `contentTrust: "untrusted"` and `<UNTRUSTED>…</UNTRUSTED>` fencing per `SECURITY/threat-model-prompt-injection.md`. This obligation is **unconditional**: a host MUST NOT attempt to distinguish the author-supplied `defaultValue` (author-trusted) from a per-run `configurable` override (untrusted) at compose time — threading binding provenance is error-prone, and the fence is cheap. Every deferred-variable prompt binding is treated as untrusted. (This differs from expansion-time substitution, where the value is baked in at author time and carries author trust.)

Steps 3, 6, 7, 8, 9 of RFC 0013 §"Expansion semantics" (typeId validation, id rewrite, splice, capability propagation, persist) apply unchanged.

### Override key + variable naming

The materialized variable's internal name uses the `${chainIdSlug}_${expansionId}_${p}` prefix for collision-safety (mirroring RFC 0013 step 6). But the **normative per-run override key is the bare parameter name** (`productIdea`), NOT the prefixed internal name — otherwise a portable workflow's `configurable` overrides would silently no-op across hosts that prefix differently (risk R6). To bind the two, deferred expansion MUST auto-generate (or extend) the parent workflow's `configurableSchema` with a mapping from each bare parameter name to its materialized variable, so callers pass `{"configurable": {"productIdea": "…"}}` and the host resolves it to the prefixed variable. The author is not required to hand-author this mapping.

### Rewrite targets

For each `{{params.x}}` token, the host MUST choose the portable target by position:

| Token position | Portable rewrite target |
| --- | --- |
| Inside a prompt body the host composes as a PromptTemplate (`config.systemPromptRef` / `userPromptRef` / `additionalPromptRefs` → `PromptTemplate.text`, per `prompts.md`) | Rewrite `{{params.x}}` → the PromptTemplate placeholder `{{v}}` where `v` is the materialized variable name, and declare a matching `PromptVariable` with `source: "variable"` (and `bindingTrust: "untrusted"`, step 4) so it resolves via `ctx.variables.get(v)` at node-execution time. |
| An **inline** prompt body (`config.systemPrompt` string, not a `*PromptRef`) | An inline body has no `{{varName}}` interpolation surface. To defer it, the host MUST lift the inline body into a host-resident PromptTemplate (moving it under a `*PromptRef`) and then apply the prompt-body rewrite above. A host that will not lift the body MUST resolve the token at expansion time instead. |
| A **whole-value** `config`/`inputs` token (the string is exactly `{{params.x}}`) | Bind the input/config key to a **variable-sourced PortValue** (a PortValue referencing the materialized variable), NOT a raw string token. The typed variable value flows through unchanged, composing with the WCP2 whole-value-typed rule (RFC 0013 amendment 2026-07-04). |
| An **embedded** token in a non-prompt plain `config` string (surrounding text) | The host MUST resolve it at expansion time (RFC 0013 literal substitution) — there is no portable runtime string-interpolation surface for arbitrary `config` strings in v1. Deferred mode does NOT invent one. |

The last row is the deliberate boundary of v1 deferral: only prompt bodies (which have a spec'd `{{varName}}` interpolation) and whole-value bindings (which have PortValue variable refs) can be deferred portably. **Embedded non-prompt tokens are expansion-time-only by construction, not by omission** — no conformant host has a general config-string interpolation engine (only prompt composition does `{{varName}}`), so such a token has no portable runtime home. A general runtime string-interpolation construct over `WorkflowNode.config` is a separate future RFC (Unresolved Q3); chains SHOULD model per-run-overridable values as whole-value bindings rather than embedding them in mixed config text. A consequence worth stating plainly: **deferral is inherently partial** — a chain that mixes prompt/whole-value params (deferrable) with embedded non-prompt config params (frozen at expansion) will have some parameters overridable per run and others not.

### Per-run override

Because materialized parameters are ordinary `variables[]`, they are overridable per run through the existing surfaces with no new endpoint:

- `POST /v1/runs` `configurable` (when the workflow declares a `configurableSchema` mapping the variable), and
- `POST /v1/runs/{runId}:fork` `configurable` overrides (`replay.md` §"Replay vs branch-from-past").

The drop-time `defaultValue` applies when no override is supplied. This is exactly the "reusable, re-parameterizable tile" ergonomic openwop-app wants, expressed in spec'd wire shape.

**Required-parameter ergonomics.** This also closes a concrete UX gap the expansion-time model leaves open: under Path A (RFC 0013), a required chain parameter dropped without a value must be frozen (e.g. to empty) at expansion — there is no "copy the tile now, supply the value per run" path. Deferred mode makes a required parameter a `required` workflow variable with no `defaultValue`, so the value is supplied per run (via `configurable`) and the host can enforce presence at run-start rather than forcing a value at drop time. (Reported by openwop-app as the motivating gap behind their Path-A `from-chain` required-param deferral.)

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

## Security

A deferred-materialized variable can carry two **orthogonal** risk markers. Where both apply to the same materialized variable, a host MUST honor both — they are not either/or.

### Untrusted content (prompt-injection)

Every deferred-variable binding interpolated into a prompt MUST compose with `bindingTrust: "untrusted"` → aggregate `contentTrust: "untrusted"` + `<UNTRUSTED>…</UNTRUSTED>` fencing, **unconditionally** — a host MUST NOT branch on author-`defaultValue`-vs-per-run-override provenance (step 4). Per `SECURITY/threat-model-prompt-injection.md`. This is the injection-surface delta versus expansion-time substitution, whose author-supplied value carries author trust.

### Secret-class values (secret-leakage, SR-1)

A chain parameter MAY be declared secret-class via `parameters.properties.<p>.x-openwop-sensitive: true`. This is a JSON-Schema extension key and is **already valid** against `workflow-chain-pack-manifest.schema.json` (the `parameters` object is an open JSON-Schema document); it is documented here as a known extension key and lands explicitly in the schema on the path to `Accepted`. For a parameter so marked:

- **Deferred-only (at-rest) — MUST.** A host that recognizes `x-openwop-sensitive` MUST NOT resolve the parameter by expansion-time substitution. Expansion-time substitution bakes the value into the persisted `config`/`inputs` in **plaintext** — a secret-at-rest leak in the stored `WorkflowDefinition` (the storage-layer SR-1 failure, distinct from the observability-layer redaction below). The parameter MUST instead be deferred: materialized as a variable with `sensitive: true`, supplied per run via `configurable`, and never persisted with a value. A host that recognizes the hint but does **not** support deferred mode MUST **refuse to expand** the chain (fail closed) rather than freeze the secret.
- **Redaction (observability) — MUST when declared.** The materialized `sensitive` variable's value MUST be redacted to `[REDACTED:<id>]` in `prompt.composed` events and debug bundles per `SECURITY/threat-model-secret-leakage.md` §SR-1. When `x-openwop-sensitive` is **absent**, a host MAY infer sensitivity and SHOULD default non-sensitive; redaction is a `SHOULD` in the inferred case.

The `x-openwop-sensitive` hint is therefore **load-bearing**: it drives BOTH the expansion-mode gate (fail-closed / deferred-only, storage layer) AND redaction marking (observability layer).

### Composition

A per-run `sensitive` value that is also interpolated into a prompt is BOTH untrusted (fenced, above) AND secret (redacted, above). Both markers apply to the same materialized variable and a host MUST apply both.

### Residual risk

The at-rest protection is enforced only by hosts that **recognize** `x-openwop-sensitive`; a host predating this RFC ignores the unknown key and would expansion-time-freeze the value. Chain authors publishing sensitive-bearing chains SHOULD therefore treat deferred-capable recognition as a distribution precondition, and a future revision MAY tie `x-openwop-sensitive` acceptance to a manifest-declared minimum capability so a non-recognizing host rejects rather than silently freezes. (Tightens risk-register R2.)

### Error codes + host annotations

- **`sensitive_param_not_deferrable`** (HTTP `422`) — the fail-closed error a recognizing host MUST return when a chain would resolve an `x-openwop-sensitive` parameter in a frozen (expansion-time) position — i.e. any position that is not portably deferrable (arbitrary `config`, an embedded token, or a host operating without deferred support). The host MUST refuse the expansion rather than freeze the secret. A `sensitive` parameter that resolves only to a deferrable position (a whole-value variable-sourced PortValue, or a lifted PromptTemplate variable) expands normally.
- **`metadata.expansionMode`** — hosts MAY annotate an expanded workflow with the mode used (`"expansion-time"` | `"deferred"`), parallel to `metadata.expandedFrom` (§Round-trip note). The runtime MUST ignore unknown metadata per `COMPATIBILITY.md` §2.1; the marker is a host-editor concern with no dispatch-time meaning.

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
2. Host-side leg in `workflow-chain-host-expansion.test.ts` gated on `capabilities.workflowChainPacks.deferredParameters.supported: true` — a deferred expansion round-trips; a `POST /v1/runs` `configurable` override **keyed on the bare parameter name** changes the resolved value; a `:fork` replays the same bound value (determinism); and a deferred variable interpolated into a prompt composes with `contentTrust: "untrusted"` (step 4 unconditional fence). Hosts without the flag are skipped, not failed.

**Capability gating.** New host legs gate on `workflowChainPacks.deferredParameters.supported` per `conformance/coverage.md` §"Capability-gated scenarios".

**INTEROP-MATRIX.** Add a `workflowChainPacks.deferredParameters` advertisement column; the three reference hosts advertise honest-off until one implements.

## Alternatives considered

1. **Relax RFC 0013's expansion-time `MUST` to permit app-private `{{params.*}}` runtime tokens (do the minimal erratum openwop-app asked for).** Rejected: this reintroduces exactly the cross-host portability break RFC 0013 was designed to prevent (and that its Alt-3 "runtime sub-DAG dispatch" was rejected to avoid). A persisted `{{params.*}}` token is unresolvable by any host that doesn't share the private bag.
2. **Define a brand-new runtime `{{}}` interpolation construct over all `WorkflowNode.config`/`inputs`.** Rejected for v1: it is a far larger surface (every host must implement a config-templating engine + its escaping/injection semantics), duplicates the PromptTemplate interpolation that already exists, and expands the prompt-injection surface to arbitrary config. This RFC deliberately reuses the *existing* `{{varName}}` surface and confines deferral to prompt bodies + whole-value bindings. A general config-templating RFC can build on this later (Unresolved Q3).
3. **Do nothing (keep WCP4 an open gap).** Rejected: openwop-app already ships a non-conformant model in production; leaving the gap open means a shipped reference host stays divergent and the portability invariant stays quietly violated. An additive, gated, portable mode lets that host become conformant without freezing its UX.

## Unresolved questions

*(All Draft-phase questions resolved; none remained open at the Active promotion.)*

**Resolved at Active promotion (2026-07-04):**

- ~~`sensitive` inference~~ → **resolved (declarative manifest hint)**: a workflow-chain manifest MAY carry an OPTIONAL `parameters.properties.<p>.x-openwop-sensitive: true` hint. When present, deferred expansion MUST set `sensitive: true` on the materialized variable, and the value MUST be redacted to `[REDACTED:<id>]` in `prompt.composed` and debug bundles per `SECURITY/threat-model-secret-leakage.md` §SR-1. When the hint is absent, the host MAY infer sensitivity and SHOULD default to non-sensitive; redaction is a `SHOULD` in the inferred case. This keeps secret-class marking declarative + portable (the chain author declares it, every host honors it) rather than host-guesswork. The `x-openwop-sensitive` property lands in `workflow-chain-pack-manifest.schema.json` as part of the normative surface on the path to `Accepted`. **The hint is load-bearing beyond redaction** — it also forces deferred-only / fail-closed handling to prevent a secret-at-rest leak; see §Security (endorsed by the openwop-app security review, 2026-07-04).

**Resolved in review (openwop-app-1 Track-A host review, 2026-07-04):**

- ~~Variable-name / override-key policy~~ → **resolved**: the normative override key is the **bare parameter name**; the `${slug}_${expansionId}_` prefix stays internal; deferred expansion MUST auto-generate the `configurableSchema` bare→prefixed mapping (§"Override key + variable naming"). This also resolves the former `configurableSchema`-authoring question (auto-generate, not author-authored).
- ~~Inline vs `*PromptRef` prompt bodies~~ → **resolved**: deferred mode MUST lift an inline `config.systemPrompt` body into a host-resident PromptTemplate to defer it, else resolve at expansion time (§"Rewrite targets"). Confirmed against a reference host whose `{{varName}}` interpolation runs only through `*PromptRef` composition.
- ~~Embedded tokens in non-prompt config~~ → **resolved as a boundary, not a gap**: expansion-time-only by construction; a general config-templating engine is a separate future RFC; chains SHOULD use whole-value bindings for per-run values (§"Rewrite targets").

## Implementation notes (non-normative)

- **Sequencing:** `Draft` (this RFC, comment window) → `Active` (capability + spec prose + schema, Q1/Q2 resolved) → `Accepted` (conformance scenarios + one reference host implements + dual-witness). No cross-cut (`CC-N`) needed — additive and gated; it can merge independently of other tracks.
- **Reference implementer:** openwop-app (ADR 0237) is the natural first host — it already has the run-scoped variable bag; the work is to move the rewrite from private tokens to materialized `variables[]` + PromptTemplate `{{varName}}`. A second witness (in-memory reference host or a tier-2 sibling) closes `Accepted`.
- **Estimated effort:** capability + schema + spec prose ~1–2 days; conformance scenarios ~1 day; reference-host rewrite ~2–3 days.

### Promotion to Active (2026-07-04 — bootstrap steward waiver, 7-day comment window waived)

Promoted `Draft → Active` under the bootstrap steward waiver (per `GOVERNANCE.md`; same mechanism as RFC 0121/0122). The design is accepted; all Draft-phase questions are resolved (override-key, inline-lift, embedded-boundary in the 2026-07-04 openwop-app Track-A review; `sensitive` inference at this promotion). Compatibility classification is firm (**additive**). This is a **status/design promotion** — the normative surface (capability schema + spec prose + conformance scenarios) and the reference-host implementation remain the path to `Accepted`. **No host may advertise `workflowChainPacks.deferredParameters.supported: true` until RFC 0124 is `Accepted`** (truthful-advertisement; `OPENWOP_REQUIRE_BEHAVIOR`).

### Acceptance criteria (path to `Accepted`)

- [ ] Spec text merged: `workflow-chain-packs.md` §"Deferred-parameter expansion (normative)" + WCP4 gap row updated to point at this RFC.
- [ ] Schema updated: `workflowChainPacks.deferredParameters` in `capabilities.schema.json` + `capabilities.md` documentation; `x-openwop-sensitive` hint in `workflow-chain-pack-manifest.schema.json`.
- [ ] At least one server-free conformance scenario (`workflow-chain-deferred-parameters.test.ts`) + one capability-gated host leg.
- [ ] CHANGELOG entry under the appropriate `[Unreleased]` / version.
- [ ] One reference host implements deferred mode and passes the gated scenario (openwop-app = reference implementer #1), plus a second witness with a PromptTemplate compose path.
- [x] All Draft-phase Unresolved questions resolved (override-key, inline-lift, embedded-boundary, `sensitive` inference).
- [ ] Conformance asserts a deferred-variable prompt binding composes with `contentTrust: "untrusted"` (unconditional fence, step 4).

## References

- **Motivating open gap:** `spec/v1/workflow-chain-packs.md` §"Open spec gaps" WCP4 + the RFC 0013 amendment (2026-07-04) adjudicating `{{params.*}}` timing.
- **Motivating downstream host:** openwop-app ADR 0163 / ADR 0237 (per-run parameter overridability; the private-token model this RFC makes portable).
- **Reused primitives:** `spec/v1/prompts.md` §"Variable interpolation" (RFC 0027 — PromptTemplate `{{varName}}`, `PromptVariable.source: "variable"`); `schemas/workflow-definition.schema.json#/$defs/WorkflowVariable`; `spec/v1/run-options.md` (`configurable`); `spec/v1/replay.md` §"Determinism" (`RunSnapshot.variables` byte-equivalence).
- **Related RFCs:** RFC 0013 (workflow-chain packs — the base this extends); RFC 0027 (prompt templates); RFC 0029 (prompt override hierarchy / resolution chain).
- **Security:** `SECURITY/threat-model-prompt-injection.md` (run-time param as untrusted content); `SECURITY/threat-model-secret-leakage.md` §SR-1 (`sensitive` redaction in `prompt.composed`).
- **Prior art:** BPMN call-activity input mappings (design-time vs run-time data binding); Temporal workflow arguments (per-execution inputs vs pinned config); LangGraph `configurable` + `update_state` (the fork-override idiom `replay.md` already parallels).

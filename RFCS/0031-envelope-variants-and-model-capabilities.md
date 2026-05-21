# RFC 0031: Envelope variant discrimination + model-capability declarations

| Field | Value |
|---|---|
| **RFC** | 0031 |
| **Title** | Discriminated-union pattern for envelope variant payloads (normative); `NodeModule.requiredModelCapabilities` + `NodeModule.fallbackModel`; `model.capability.substituted` + `model.capability.insufficient` events |
| **Status** | `Active` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-20 |
| **Updated** | 2026-05-20 (Draft → Active — see [Status history](#status-history) below). |
| **Affects** | `spec/v1/ai-envelope.md` (adds §"Variant payload discrimination (normative)") · `spec/v1/host-capabilities.md` (adds §"Model-capability declarations") · `spec/v1/node-packs.md` (notes `NodeModule.requiredModelCapabilities` + `NodeModule.fallbackModel`) · `schemas/node-pack-manifest.schema.json` (adds `requiredModelCapabilities` + `fallbackModel` to the NodeModule shape) · `schemas/capabilities.schema.json` (adds optional `modelCapabilities` block) · `schemas/run-event.schema.json` (adds `model.capability.substituted` + `model.capability.insufficient` enum entries) · `schemas/run-event-payloads.schema.json` (adds `modelCapabilitySubstituted` + `modelCapabilityInsufficient` `$defs`) · `SECURITY/invariants.yaml` (adds `model-capability-substituted-no-credential-disclosure`) · 4 new conformance scenarios · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |

## Summary

Two complementary additive changes that together close the "envelope dispatch routing is opaque" gap. First, codifies the de-facto discriminated-union pattern (`anyOf` + single-string-enum discriminator per branch) as normative for any envelope payload schema that accepts variant shapes — preventing future authors from accidentally using `oneOf` (cross-vendor incompatible per RFC 0030 §B). Second, adds two optional fields to the `NodeModule` shape — `requiredModelCapabilities: string[]` and `fallbackModel: { provider, model }` — so envelope-emitting NodeModules can declare which model capabilities they need (e.g., `structured-output`, `discriminator-enum`, `long-context`, `reasoning`, `function-calling`) and which model the host MAY substitute when the active model can't satisfy them. Hosts emit two new `RunEventType` entries (`model.capability.substituted`, `model.capability.insufficient`) so conformance suites and observability tools can assert capability-gated dispatch behavior. The two `model.capability.*` events are **cross-kind operational** events about model dispatch — they do NOT extend the per-envelope-kind event surface that `ai-envelope.md` line 448 forbids; see the same-scope analysis in RFC 0032 §A.

## Motivation

### 2.1 Variant envelopes silently break on Gemini and Anthropic when authored with `oneOf`

The de-facto pattern in existing universal-kind and vendor-namespaced envelope payloads is `anyOf` with a single-string-enum discriminator (`kind: "design" | "planning" | "action"`, etc.). But the spec's §"Schema discipline" doesn't normate this — a future canvas-type author writing a new variant envelope can pick `oneOf` and produce a schema that:

- OpenAI strict mode rejects with a 400.
- Anthropic strict tool use rejects with a 400.
- Gemini `responseSchema` *silently drops* the `oneOf` keyword (per `docs.cloud.google.com/vertex-ai/...` — "Vertex AI can still handle your request but ignores the field"), producing a schema looser than the author intended.

The fix is structural: spec text that says "variant envelopes SHALL use `anyOf` with a single-string-enum discriminator per branch." This is a forward-looking normative requirement; existing universal-kind schemas already comply because they don't have variants. The vendor-namespaced kinds the reference MyndHyve host ships (`vendor.myndhyve.prd.create`, `vendor.myndhyve.theme.create`, `vendor.myndhyve.tasks.create`) already use this pattern; codifying it prevents drift.

### 2.2 Envelope-emitting nodes have implicit model dependencies the protocol can't see

A NodeModule like `core.ai.callPrompt` (or any vendor-namespaced envelope-emitting node) has implicit dependencies on model capabilities:

- It needs `structured-output` support (Anthropic strict tool use, OpenAI strict mode, Gemini `responseSchema`) to emit a payload matching the envelope's JSON Schema.
- It needs `discriminator-enum` support (the single-string `enum: ["literal"]` pattern per §A) if the envelope has variants.
- It might need `long-context` (≥ 200k tokens) for envelope types that consume large prior context.
- It might need `reasoning` (Anthropic extended thinking, Gemini `thinkingBudget`, OpenAI o-series) for envelope types where chain-of-thought materially improves output quality (per RFC 0030 §A).
- It might need `function-calling` for tool-using envelope flows.

Today, hosts each invent their own dispatch-routing for this. Pack-distributed NodeModules (RFC 0003 node packs, RFC 0013 workflow-chain packs) can't declare requirements portably — a pack authored against an `anthropic/claude-opus-4-7` deployment may silently misbehave when run against a `gemini/flash` deployment that lacks the same structured-output guarantees. The protocol's existing `NodeModule.requires: string[]` (per `schemas/capabilities.schema.json` lines 211, `runtime.*` namespace) covers **host** capabilities (e.g., `secrets.byok`, `chat.sendPrompt`, `canvas.write`) — it does not cover **model** capabilities (which model the host's dispatcher routes to).

This RFC adds a parallel `requiredModelCapabilities` field and a `fallbackModel` substitution mechanism so envelope-emitting nodes can declare their model dependencies portably. Hosts honor the declaration: substitute to the fallback when the active model is unsuitable, or refuse to dispatch with an explicit `capability_not_provided` (per `capabilities.md` §"Unsupported capability — refusal contract").

### 2.3 Substitution and insufficient-capability dispatches need protocol-visible telemetry

When a host substitutes to a fallback model or refuses to dispatch, downstream observability tools and conformance suites need a stable event surface to assert behavior. The existing `capability_not_provided` error code surfaces *host*-capability refusals on `RunSnapshot.error`; *model*-capability events need their own observable signal. Two new RunEvent types (one for substitution, one for refusal) parallel the precedent set by RFC 0026 (`provider.usage`) and RFC 0027 (`prompt.composed`).

## Proposal

### §A — Discriminated-union pattern for variant envelopes (normative)

Add a new §"Variant payload discrimination (normative)" to `spec/v1/ai-envelope.md` between §"Schema discipline" and §"Envelope Contract":

> When an envelope payload schema accepts variant shapes (a sum type), the schema SHALL express the variants as an `anyOf` composition where every branch:
>
> 1. Includes a discriminator property of type `string` with `enum` containing exactly one value (the discriminator literal for that branch).
> 2. Includes the discriminator property in `required`.
> 3. Independently satisfies the Tier-1 Compatibility Subset (per `spec/v1/structured-output-subset.md` / RFC 0030 §B).
>
> Hosts MUST be able to identify the active variant by single-field equality check on the discriminator. Hosts MUST NOT depend on field-presence inference or value-shape heuristics for variant discrimination.
>
> Discriminator field names are conventionally `kind`, `variant`, or `type`. Specs MAY use other names but MUST document the chosen name in each envelope-type definition.
>
> Schema authors MUST NOT use `oneOf` for variant payloads — it is unsupported across all three Tier-1 strict-output vendors (OpenAI strict, Anthropic strict, Gemini `responseSchema`). Schema authors MUST NOT use field-presence-based discrimination — Gemini silently drops the discriminating keyword, and hosts targeting it would route to the wrong handler.

Example (illustrative, for a hypothetical `vendor.acme.tasks.create` envelope):

```jsonschema
{
  "type": "object",
  "additionalProperties": false,
  "required": ["steps"],
  "properties": {
    "reasoning": { "type": ["string", "null"] },
    "steps": {
      "type": "array",
      "items": {
        "anyOf": [
          { "$ref": "#/$defs/DesignTask" },
          { "$ref": "#/$defs/PlanningTask" },
          { "$ref": "#/$defs/ActionTask" }
        ]
      }
    }
  },
  "$defs": {
    "DesignTask": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "title"],
      "properties": {
        "kind": { "type": "string", "enum": ["design"] },
        "title": { "type": "string" }
      }
    },
    "PlanningTask": { "...": "..." },
    "ActionTask":   { "...": "..." }
  }
}
```

#### Backward compatibility for existing envelopes

The four universal-kind payload schemas (`clarification.request`, `schema.request`, `schema.response`, `error`) do not have variants today and remain conformant. Vendor-namespaced kinds that already use `anyOf` + single-string-enum discriminators (the MyndHyve `vendor.myndhyve.*` family) remain conformant. Vendor-namespaced kinds (if any exist) that use `oneOf` or field-presence-based discrimination remain conformant for v1.x — this RFC normates the pattern forward-looking only. A future RFC MAY tighten the requirement to existing schemas.

### §B — `NodeModule.requiredModelCapabilities` + `NodeModule.fallbackModel`

Add two optional fields to the NodeModule shape in `schemas/node-pack-manifest.schema.json`:

```diff
   "properties": {
     "typeId": { ... },
     "schemaVersion": { ... },
     "title": { ... },
     "description": { ... },
     "configSchema": { ... },
     "inputSchema": { ... },
     "outputSchema": { ... },
     "requires": { ... },
+    "requiredModelCapabilities": {
+      "type": "array",
+      "items": {
+        "type": "string",
+        "pattern": "^([a-z][a-z0-9-]*|x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*)$",
+        "description": "Capability identifier per RFC 0031 §C. Spec-defined identifiers are reserved (`structured-output`, `discriminator-enum`, `long-context`, `reasoning`, `function-calling`); host-private extensions MUST prefix with `x-host-<host>-`."
+      },
+      "uniqueItems": true,
+      "maxItems": 32,
+      "description": "Model capabilities this NodeModule requires the active model to advertise. The host MUST check the active model's advertised capabilities against this list before dispatching. Distinct from `requires`, which gates on host capabilities (per `capabilities.runtime`). Empty array (or absent field) means no model-capability requirements."
+    },
+    "fallbackModel": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["provider", "model"],
+      "properties": {
+        "provider": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$", "description": "Provider id per `capabilities.aiProviders.supported` (e.g., `anthropic`, `openai`, `gemini`)." },
+        "model": { "type": "string", "minLength": 1, "description": "Provider-stamped model id (e.g., `claude-opus-4-7`, `gpt-5`, `gemini-2.5-pro`)." }
+      },
+      "description": "Substitute model coordinates the host MAY use if the active model lacks the declared `requiredModelCapabilities`. When the host substitutes, it MUST emit `model.capability.substituted` (§D). Absent means no substitution permitted; the host MUST refuse to dispatch with `capability_not_provided` when capabilities are unmet."
+    },
     "...": "..."
   }
```

#### Dispatch flow (normative)

When dispatching a NodeModule that declares `requiredModelCapabilities`, a host SHALL:

1. Check the active model's advertised capabilities against `requiredModelCapabilities`.
2. If all required capabilities are met: dispatch normally.
3. If unmet AND `fallbackModel` is declared AND the host can authenticate to the fallback provider (i.e., the fallback's `provider` is in `capabilities.aiProviders.supported` AND a credential is resolvable): substitute and emit `model.capability.substituted` (§D); dispatch with the fallback model.
4. If unmet AND (no `fallbackModel` declared, OR the host cannot authenticate to the fallback): emit `model.capability.insufficient` (§D) and refuse to dispatch the node with `error.code = "capability_not_provided"` per `capabilities.md` §"Unsupported capability — refusal contract". The run transitions to `failed` unless the run's retry policy intervenes.

The order MUST be: capability check → optional substitution → emit telemetry → dispatch or refuse. Hosts MUST NOT substitute silently (no event emission); hosts MUST NOT dispatch with an unsuitable model and hope for the best (the model's runtime failure is a worse signal than refusing up-front).

### §C — Capability identifier registry

Defined initial capability identifiers (extensible by host registration):

| Identifier | Meaning |
|---|---|
| `structured-output` | Vendor strict-mode JSON Schema support (Anthropic strict tool use `strict: true`, OpenAI strict mode `response_format.json_schema.strict: true`, Gemini `responseSchema` on `generateContent`). Per `spec/v1/structured-output-subset.md` (RFC 0030 §B). |
| `discriminator-enum` | Single-string `enum: ["literal"]` discriminator support in `anyOf` branches per §A. All three Tier-1 vendors support this when their respective strict modes are engaged. |
| `long-context` | Context window ≥ 200k tokens. |
| `reasoning` | Native reasoning / thinking tokens (Anthropic extended thinking, Gemini `thinkingBudget`, OpenAI o-series reasoning). Sibling concept to RFC 0030's envelope-payload `reasoning` field — `reasoning` here means *model-native* thinking-tokens, NOT envelope-payload chain-of-thought. |
| `function-calling` | Multi-turn function-calling / tool-use loop support. |

**Reservation policy.** Identifiers in the table above are spec-reserved. Hosts MAY add private extensions via the `x-host-<host>-<key>` prefix per `host-extensions.md` §"Canonical-prefix table." A future RFC MAY add new spec-reserved identifiers as new model capabilities materialize.

**Host advertisement.** A host's advertised model-capability set lives at `capabilities.modelCapabilities.advertised` per §E. The host's dispatcher is the authoritative source of truth for which active model satisfies which identifier; the protocol does not normate how the host derives the mapping (vendor-API probes, static lookup tables, configuration files — all valid).

**Truthful advertisement (normative; amendment 2026-05-21 from RFC adoption feedback).** `capabilities.modelCapabilities.advertised[]` MUST reflect only the capability identifiers the host actually gates on at dispatch (i.e., identifiers some `NodeModule.requiredModelCapabilities[]` in the host's registered pack set references AND that the host's dispatcher evaluates). Pasting the full spec-reserved set as boilerplate is dishonest per `capabilities.md` §"Truthful advertisement" and is non-conformant. Hosts whose pack registry only references a subset of the spec-reserved identifiers MUST advertise only that subset; adding identifiers later (when new NodeModules declare them) is an additive bump.

### §D — Two new RunEventType entries

`schemas/run-event.schema.json` `RunEventType` enum gains two new entries:

```diff
   "agent.reasoned",
   "agent.reasoning.delta",
+  "model.capability.substituted",
+  "model.capability.insufficient",
   "prompt.composed",
   "provider.usage",
```

`schemas/run-event-payloads.schema.json` gains two new `$defs`:

```json
"modelCapabilitySubstituted": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "originalProvider", "originalModel", "fallbackProvider", "fallbackModel", "missingCapabilities"],
  "description": "Emitted when a host substitutes the active model with a NodeModule's declared `fallbackModel` because the active model lacks one or more of the `requiredModelCapabilities`. MUST event per RFC 0031 §B step 3.",
  "properties": {
    "nodeId":            { "type": "string", "description": "The node whose dispatch triggered the substitution." },
    "originalProvider":  { "type": "string", "description": "Provider id of the active model the host was about to use." },
    "originalModel":     { "type": "string", "description": "Model id of the active model." },
    "fallbackProvider":  { "type": "string", "description": "Provider id of the substitute model from `NodeModule.fallbackModel.provider`." },
    "fallbackModel":     { "type": "string", "description": "Model id of the substitute model from `NodeModule.fallbackModel.model`." },
    "missingCapabilities": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Subset of `NodeModule.requiredModelCapabilities` that the active model did not satisfy."
    }
  }
},
"modelCapabilityInsufficient": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "provider", "model", "missingCapabilities"],
  "description": "Emitted when a host refuses to dispatch a NodeModule because the active model lacks declared `requiredModelCapabilities` AND no viable fallback is available (no `fallbackModel` declared, OR the host cannot authenticate to the fallback provider). MUST event per RFC 0031 §B step 4. Pairs with `RunSnapshot.error.code = \"capability_not_provided\"`.",
  "properties": {
    "nodeId":              { "type": "string", "description": "The node whose dispatch was refused." },
    "provider":            { "type": "string", "description": "Provider id of the active model the host attempted to use." },
    "model":               { "type": "string", "description": "Model id of the active model." },
    "missingCapabilities": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Subset of `NodeModule.requiredModelCapabilities` that the active model did not satisfy."
    },
    "fallbackAttempted": {
      "type": "boolean",
      "default": false,
      "description": "True if the host attempted to authenticate to a declared fallback and failed. False if no `fallbackModel` was declared (or the fallback provider was outside `capabilities.aiProviders.supported`)."
    }
  }
}
```

And a discriminator entry in `_typeIndex`:

```diff
+  "model.capability.substituted": { "$ref": "#/$defs/modelCapabilitySubstituted" },
+  "model.capability.insufficient": { "$ref": "#/$defs/modelCapabilityInsufficient" },
```

**Scope clarification re: `ai-envelope.md` line 448.** The line-448 MUST NOT prohibits hosts from extending `RunEventType` to add *envelope-kind-specific* events (one event per envelope kind, e.g., a `clarification.requested` mirroring `clarification.request` payload). The two events introduced here — `model.capability.substituted` and `model.capability.insufficient` — are **cross-kind operational** events: they fire during model dispatch, before any envelope is emitted, and apply uniformly regardless of which envelope kind the node ends up emitting. Same posture as RFC 0026's `provider.usage` and RFC 0027's `prompt.composed`; both extended `RunEventType` without conflict. The formal carve-out for cross-kind operational envelope-track events is normated by RFC 0032 §A; RFC 0031 cites that carve-out by reference but does not depend on it (these events fire before envelope emission, not as part of envelope handling).

### §E — Capability advertisement

`schemas/capabilities.schema.json` gains one new optional top-level block:

```diff
+    "modelCapabilities": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["supported"],
+      "properties": {
+        "supported": {
+          "type": "boolean",
+          "description": "Host honors `NodeModule.requiredModelCapabilities` and emits `model.capability.{substituted,insufficient}` per RFC 0031. When false or absent, the fields are treated as opaque metadata and dispatch proceeds without capability checks."
+        },
+        "advertised": {
+          "type": "array",
+          "items": { "type": "string", "pattern": "^([a-z][a-z0-9-]*|x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*)$" },
+          "uniqueItems": true,
+          "description": "Capability identifiers the host's active model advertises. Clients MAY introspect this at install time to determine whether their NodeModules' `requiredModelCapabilities` are satisfiable without fallback."
+        },
+        "substitutionSupported": {
+          "type": "boolean",
+          "description": "Host honors `NodeModule.fallbackModel` substitution per RFC 0031 §B step 3. **Scope (normative; clarified by amendment 2026-05-21):** substitution is per-NodeModule, NOT host-wide. When `true`, the host evaluates `requiredModelCapabilities` + `fallbackModel` per dispatch of an envelope-emitting NodeModule (the unit at which the NodeModule schema declares the fields). Hosts that do not implement a per-call provider-swap facility (i.e., they cannot rewrite `ctx.callAI({provider: ...})` mid-dispatch to use the fallback model) MUST advertise `false` — emitting `model.capability.substituted` without actually substituting is wire-contract-dishonest. When false or absent, hosts MUST refuse to dispatch (step 4) on any unmet capability even when `NodeModule.fallbackModel` is declared."
+        }
+      },
+      "description": "Advertisement that the host implements RFC 0031 model-capability gating + substitution. Absent block = no capability gating; NodeModules' `requiredModelCapabilities` are ignored."
+    }
```

### §F — Security carry-forward

`model.capability.substituted` reveals which alternate provider/model the host has credentials for. Some hosts treat this as private (a workspace might not want to disclose its multi-vendor posture). A new SECURITY invariant lands:

```yaml
- id: model-capability-substituted-no-credential-disclosure
  tier: protocol
  severity: medium
  threat_model: SECURITY/threat-model-secret-leakage.md
  tests:
    - conformance/src/scenarios/model-capability-substituted.test.ts
  note: |
    RFC 0031 §F: hosts emitting `model.capability.substituted` MAY redact the
    `fallbackProvider` and `fallbackModel` fields when workspace policy treats
    multi-vendor posture as confidential. Redaction MUST be all-or-nothing for
    the pair (both fields redacted as `"[REDACTED]"`) so consumers can detect
    redaction without ambiguity. `nodeId`, `originalProvider`, `originalModel`,
    and `missingCapabilities` MUST NOT be redacted — they carry no provider-
    possession information beyond what the run-creation request already
    disclosed via `RunOptions.configurable.ai.provider`.
```

The invariant is `medium` (not `high`) because: (a) the `originalProvider` is already public via `RunOptions.configurable`; (b) the fact that a host has *some* fallback configured is conventionally public via `capabilities.modelCapabilities.substitutionSupported: true`. The hidden bit is which specific fallback fired for a given dispatch — workspace-internal info that some operators prefer to keep private.

Hosts that don't redact (the default) are conformant; hosts that redact MUST do so per the all-or-nothing rule above to keep the event shape predictable.

### §G — Trust boundary (carry-forward)

Substitution and insufficient-capability events fire **before** envelope emission, so `meta.contentTrust` propagation per `ai-envelope.md` §"Trust boundary" doesn't apply directly. The two events carry no payload content from upstream sources; trust marking is unnecessary.

## Compatibility

**Additive per `COMPATIBILITY.md §2.1`.** All claims:

- Existing required fields: unchanged. The two new `NodeModule` fields are optional; existing node packs validate unchanged.
- Existing optional fields: unchanged.
- Existing event types: unchanged (`model.capability.*` are NEW enum entries; consumers MUST tolerate unknown event types per existing forward-compat).
- Existing endpoints: unchanged.
- Existing MUST requirements: not relaxed. The §A normative rule applies to *new* variant payload schemas; existing schemas with variants remain conformant for v1.x.
- Existing error codes: unchanged. `capability_not_provided` is reused for the §B step 4 refusal.

Hosts that don't advertise `capabilities.modelCapabilities` see no behavioral change; `requiredModelCapabilities` is opaque metadata and dispatch proceeds without checks. NodeModules without `requiredModelCapabilities` see no behavioral change on any host.

## Conformance

Four new scenarios under `conformance/src/scenarios/`. All gated as noted.

- `envelope-variant-discriminator-static.test.ts` — always runs. For every kind in the host's `supportedEnvelopes` advertisement, statically asserts: (1) if the payload schema contains an `anyOf`, every branch declares a single-string-enum discriminator per §A; (2) the payload schema MUST NOT contain `oneOf` at any nesting depth. No LLM in the loop.

- `model-capability-substituted.test.ts` — gated on `capabilities.modelCapabilities.supported: true` AND `substitutionSupported: true` AND the test seam `POST /v1/host/sample/test/synthesize-model-capability-event`. Drives a synthetic dispatch where the active model is configured to lack `structured-output`; the NodeModule declares `fallbackModel`. Asserts exactly one `model.capability.substituted` event fires with `missingCapabilities: ["structured-output"]` and the expected fallback coordinates (or `[REDACTED]` when the host opts to redact per §F).

- `model-capability-insufficient.test.ts` — gated on `capabilities.modelCapabilities.supported: true` AND the test seam. Drives a synthetic dispatch where the active model lacks a required capability AND the NodeModule declares no `fallbackModel`. Asserts: (1) exactly one `model.capability.insufficient` event fires with `fallbackAttempted: false`; (2) the run terminates with `RunSnapshot.error.code = "capability_not_provided"`; (3) no envelope emission occurs.

- `node-module-required-capabilities-shape.test.ts` — gated on `capabilities.modelCapabilities.supported: true`. Statically validates that every NodeModule in the host's pack registry whose `typeId` is in the `core.ai.*` namespace declares `requiredModelCapabilities` (host-policy assertion) — OR skips with a clear failure message if the host advertises capabilities but the spec doesn't yet have a host-policy gate. Treat as a SHOULD-tier scenario; conformance runs flag SHOULD-tier soft-fails separately from MUST-tier hard-fails.

The `behaviorGate` helper gains predicates: `requireModelCapabilities()` and `requireModelCapabilitySubstitution()`.

## Alternatives considered

1. **Reuse the existing `NodeModule.requires: string[]` field with a `model.*` namespace (e.g., `model.structured-output`).** Rejected — `requires` is keyed off `capabilities.runtime.*` per `capabilities.md` §"Runtime capabilities" and refuses on `capability_not_provided` without any substitution semantics. Overloading it with model capabilities would mean: (a) the refusal contract has to grow a substitution path on the runtime-capability surface, which the existing spec rules out; (b) the namespace becomes muddier — operators reading a manifest see `requires: ["secrets.byok", "model.structured-output"]` and have to know which strings gate on which capability surface. A dedicated `requiredModelCapabilities` field with its own dispatch flow is structurally cleaner.

2. **Drop the substitution mechanism; refuse on every missing capability.** Rejected — the substitution path is the load-bearing value of the RFC. Without it, pack authors have to gate their packs on `capabilities.aiProviders.supported.includes("anthropic")` and force operators to provision specific providers. The `fallbackModel` pattern lets a pack declare "I need `structured-output`; if your active model doesn't have it, here's a model that does." This is the cross-host portability story.

3. **Make `fallbackModel` a per-run override instead of a per-NodeModule declaration.** Rejected — per-NodeModule is correct because the capability requirement is intrinsic to the NodeModule's semantics. A node that emits a discriminated-union envelope needs `discriminator-enum`-capable model dispatch; that requirement doesn't change run-by-run. Per-run overrides would put the responsibility on every workflow author to know each node's intrinsic requirements — exactly the gap this RFC closes.

4. **Use an existing event type (e.g., `log.appended` with `code: "model.capability.substituted"`) instead of new `RunEventType` entries.** Considered as an Option A fallback for the same MUST-NOT concern RFC 0032 addresses. Rejected here because: (a) the two events are cross-kind operational (not envelope-kind-specific) — they don't trigger the line-448 MUST NOT; (b) the precedent of RFC 0026 (`provider.usage`) and RFC 0027 (`prompt.composed`) already establishes that operational events extend `RunEventType` cleanly; (c) conformance assertions on dedicated event types are more precise than string-match on a `log.appended.code`.

5. **Defer the `discriminated-union` codification to a future RFC; ship only the model-capability surface.** Rejected — both halves are forward-looking schema/dispatch discipline that the protocol should ratify in the same release. Slicing them creates ceremony without spec-text benefit. The two halves do connect via the `discriminator-enum` capability identifier (§C), which references the §A pattern.

## Unresolved questions

1. **Capability identifier vocabulary growth.** §C defines five initial identifiers. As new model capabilities materialize (e.g., `vision-input`, `audio-output`, `code-execution`), should they go through a full RFC process or via a lightweight registry-update mechanism? Recommendation: full RFC for now (single-steward bootstrap); revisit when the maintainer set grows.

2. **Per-vendor capability mapping.** A host's mapping from "active model = `gpt-5`" → "advertised capabilities = [structured-output, discriminator-enum, function-calling, reasoning]" is host-internal. Should the spec recommend a canonical mapping (e.g., "all OpenAI o-series advertise `reasoning`")? Recommendation: no — vendor model rosters change too fast; canonical mappings would be stale-by-design. Hosts MAY publish their mapping as documentation; the protocol surface is the advertised result.

3. **Substitution recursion.** A host substitutes from active model A to fallback model B because A lacks `structured-output`. What if B also lacks one of the *other* required capabilities (e.g., `reasoning`)? Recommendation: NO recursive substitution — the host MUST evaluate the fallback model's full capability set before substituting; if the fallback also fails, the host MUST emit `model.capability.insufficient` with `fallbackAttempted: true` and refuse. Spec text in §B will need explicit clarification.

4. **`fallbackModel` cost-attribution.** When substitution fires, the `provider.usage` event (RFC 0026) attributes the cost to the fallback provider, not the original. Is this transparent enough for billing reconciliation? Recommendation: yes — `provider.usage.provider` already carries the actual provider that was charged. The `model.capability.substituted` event fires *before* `provider.usage`, providing the causal chain.

5. **Interaction with RFC 0027/0028/0029 prompt-resolution chain.** A `core.ai.callPrompt` node with both `requiredModelCapabilities` (this RFC) and `systemPromptRef` (RFC 0027) needs both checked. Resolution order: capability check FIRST, then prompt resolution. Rationale: substitution may swap models with different prompt-tuning expectations; resolving prompt against the *original* model when the dispatch ends up using the *fallback* is incorrect. Document this ordering as non-normative implementation guidance.

## Implementation notes (non-normative)

- Reference host `apps/workflow-engine/backend/typescript`: extend `executor/executor.ts` `dispatchNode(...)` to (1) read `NodeModule.requiredModelCapabilities`, (2) cross-check against the active provider's `capabilities.modelCapabilities.advertised`, (3) substitute to `NodeModule.fallbackModel` when unmet, (4) emit the appropriate `model.capability.*` event via `eventLog.append(...)`. The dispatch helper lives in a new `executor/modelCapabilityGate.ts` module to keep `executor.ts` from sprawling.
- The capability-advertisement source of truth: `routes/discovery.ts`'s `capabilities.modelCapabilities.advertised` is populated by a new `aiProviders/capabilityProbe.ts` that statically maps the configured `aiProviders.supported[]` rows to a per-provider capability set. The probe is configured by a static table; future iterations could probe at startup.
- Conformance fixture engineering: ~0.5 day per scenario × 4 = ~2 days. The static-discriminator scenario reuses the existing schema-walker from RFC 0030's Tier-1-subset scenario.
- Estimated total effort: schemas + spec text ~1 day; reference-host dispatch wiring ~1.5 days; four conformance scenarios ~2 days; CHANGELOG + INTEROP-MATRIX ~30 min. Total ~5 days plus the standard Active window unless the bootstrap-phase waiver applies.

## Acceptance criteria

Promotion from `Active` → `Accepted`:

- [ ] `spec/v1/ai-envelope.md` extended with §"Variant payload discrimination (normative)" per §A.
- [ ] `spec/v1/host-capabilities.md` extended with §"Model-capability declarations" describing the dispatch flow from §B.
- [ ] `spec/v1/node-packs.md` extended with §"Model-capability declarations on NodeModules" referencing the schema additions in §B.
- [ ] `schemas/node-pack-manifest.schema.json` gains `requiredModelCapabilities` + `fallbackModel` per §B.
- [ ] `schemas/capabilities.schema.json` gains the `modelCapabilities` block per §E.
- [ ] `schemas/run-event.schema.json` adds `model.capability.substituted` + `model.capability.insufficient` to the `RunEventType` enum.
- [ ] `schemas/run-event-payloads.schema.json` adds `modelCapabilitySubstituted` + `modelCapabilityInsufficient` `$defs` and `_typeIndex` entries per §D.
- [ ] `SECURITY/invariants.yaml` gains the `model-capability-substituted-no-credential-disclosure` entry per §F (gate timing: lands alongside reference-host implementation, matching RFC 0027 §G precedent).
- [ ] Four new conformance scenarios per §"Conformance" land in `@openwop/openwop-conformance`; suite minor-version bumps.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] `INTEROP-MATRIX.md` extended with rows for `capabilities.modelCapabilities.supported`, `substitutionSupported`, and `advertised[]`.
- [ ] Reference host (`apps/workflow-engine/backend/typescript`) advertises `capabilities.modelCapabilities.supported: true`, implements the dispatch gate, emits both new events, passes all four new conformance scenarios.
- [ ] First non-steward host advertises `capabilities.modelCapabilities.supported: true` (third-party validation gate per RFC 0001). MAY be waived under bootstrap-phase waiver.

## References

- `RFCS/0021-ai-envelope-primitive.md` — schema-discipline section this RFC tightens; vendor-namespaced-kind precedent for §A.
- `RFCS/0030-envelope-reasoning-and-tier-one-subset.md` — Tier-1 Compatibility Subset that §A's `anyOf` + discriminator pattern is a subset member of.
- `RFCS/0032-envelope-reliability-events.md` (forthcoming) — formally normates the line-448 MUST-NOT carve-out for cross-kind operational events; cited by reference from §D scope clarification.
- `RFCS/0033-envelope-completion-contract.md` (forthcoming) — depends on this RFC's `model.capability.*` events as part of the dispatch-time observability surface.
- `RFCS/0026-provider-usage-event.md` — precedent for adding cross-kind operational events to `RunEventType` without conflicting with line 448.
- `RFCS/0027-prompt-templates.md` — `prompt.composed` precedent for additive event-payload `$defs`.
- `RFCS/0029-prompt-override-hierarchy.md` §F — orthogonality note describing how this RFC's `requiredModelCapabilities` interacts with that RFC's prompt-resolution chain.
- `spec/v1/capabilities.md` §"Runtime capabilities" — the existing `NodeModule.requires` surface this RFC complements with a parallel `requiredModelCapabilities`.
- `spec/v1/capabilities.md` §`aiProviders` — provider/credential advertisement that `fallbackModel.provider` must match.
- `SECURITY/threat-model-secret-leakage.md` SR-1 — redaction harness referenced by §F.
- OpenAI Structured Outputs — https://developers.openai.com/api/docs/guides/structured-outputs
- Anthropic Strict Tool Use — https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
- Google Gemini Structured Output — https://ai.google.dev/gemini-api/docs/structured-output
- Instructor (discriminated-union retry pattern) — https://github.com/jxnl/instructor
- Pydantic AI output taxonomy — https://pydantic.dev/docs/ai/core-concepts/output/

## Status history

### Active amendment (2026-05-21) — MyndHyve adoption feedback

Additive normative-text clarification per the filled adoption feedback at `docs/handoffs/MYNDHYVE-RFC-0030-0033-ADOPTION-FEEDBACK-2026-05-20.md` §A.2. **No wire-shape change; no schema change.**

- §C — New normative paragraph on truthful advertisement: `capabilities.modelCapabilities.advertised[]` MUST reflect only the capability identifiers the host actually gates on (referenced by some registered `NodeModule.requiredModelCapabilities[]`). Boilerplate-paste of the full spec-reserved set is now explicitly non-conformant per `capabilities.md` §"Truthful advertisement." Surfaced by MyndHyve advertising only the 2 of 5 identifiers their pack registry references.
- §E — Clarified `substitutionSupported` scope: substitution is **per-NodeModule, not host-wide.** Evaluated per dispatch of an envelope-emitting NodeModule (the unit at which the schema declares `requiredModelCapabilities` + `fallbackModel`). Hosts without a per-call provider-swap facility MUST advertise `false` — emitting `model.capability.substituted` without actually substituting is wire-contract-dishonest. Surfaced by MyndHyve's substitution emission being node-config-scoped rather than host-dispatch-scoped.

Compatibility: **additive** per `COMPATIBILITY.md §2.1`. Hosts already advertising honestly (only the capabilities they gate on; only `substitutionSupported: true` when they actually substitute) remain compliant. The two clarifications make those existing best practices normative.

### Draft → Active (2026-05-20)

Promoted under the bootstrap-phase steward waiver per the RFC 0021–0030 precedent. Spec text + wire-shape locked; conformance scenarios + SECURITY invariant + reference-host emission remain as the path to `Accepted`.

Evidence at promotion:

- **Spec text:**
  - `spec/v1/ai-envelope.md` extended with §"Variant payload discrimination (normative)" between §"Schema discipline" and §"Envelope Contract". Normative SHALL: variant envelope payloads use `anyOf` + single-string-`enum` discriminator per branch; `oneOf` forbidden (cross-vendor incompatible — Gemini silently drops). Backward-compatibility paragraph preserves existing v1.x schemas that already use the pattern or that use `oneOf`/field-presence (no retroactive failure; forward-looking only).
  - `spec/v1/host-capabilities.md` extended with §"Model-capability declarations" between §host.aiEnvelope and §host.promptLibrary. Documents the 4-step dispatch flow (capability check → optional substitution → emit telemetry → dispatch or refuse), the 5-identifier spec-reserved capability registry (`structured-output`, `discriminator-enum`, `long-context`, `reasoning`, `function-calling`) + `x-host-<host>-<key>` extension prefix, and the orthogonality note with RFC 0029 prompt-resolution chain (capability check first, then prompt resolution — substitution can swap models with different prompt-tuning expectations).
  - `spec/v1/node-packs.md` extended with §"Model-capability declarations on NodeModules" between §"Per-node `requiresSecrets[]`" and §"Runtime formats." Author-side surface paralleling `requiresSecrets[]`. Cross-references the dispatch contract in `host-capabilities.md`.
- **Schemas additive (no MUST relaxed):**
  - `schemas/node-pack-manifest.schema.json` — NodeModule shape gains optional `requiredModelCapabilities: string[]` (pattern restricts to spec-reserved or `x-host-*` identifiers, ≤32 entries, uniqueItems) + optional `fallbackModel: { provider, model }` with provider lowercase-ASCII pattern + model min-length-1.
  - `schemas/capabilities.schema.json` — new optional top-level `modelCapabilities` block with `supported: boolean` (required), `advertised: string[]`, `substitutionSupported: boolean`. Sibling to the existing `runtimeCapabilities` array (host capabilities) — semantic distinction documented in both descriptions.
  - `schemas/run-event.schema.json` — `RunEventType` enum gains `"model.capability.substituted"` and `"model.capability.insufficient"` after `agent.promptResolved` (cross-kind operational cluster).
  - `schemas/run-event-payloads.schema.json` — `_typeIndex` gets two new entries; two new `$defs` (`modelCapabilitySubstituted` + `modelCapabilityInsufficient`) carry the payload contracts. Substitution event documents the all-or-nothing `"[REDACTED]"` redaction option for `fallbackProvider`/`fallbackModel` per SECURITY invariant `model-capability-substituted-no-credential-disclosure`. Insufficient event documents the no-recursive-fallback constraint (`fallbackAttempted: true` when the declared fallback itself failed, no chaining).

Path to `Active → Accepted`: requires the reference workflow-engine to (a) advertise `capabilities.modelCapabilities.supported: true` + `advertised[]` populated by a capability-probe over `aiProviders.supported[]`, (b) implement the dispatch gate in `executor/executor.ts` (or `executor/modelCapabilityGate.ts` sibling) that consults the active model's advertised capabilities + emits `model.capability.{substituted,insufficient}`, (c) ship the four conformance scenarios from §"Conformance" (including the discriminator-static and substitution/insufficient/declaration shape assertions), and (d) ship the `model-capability-substituted-no-credential-disclosure` SECURITY invariant alongside the matching conformance scenario. Alternatively, a non-steward host advertising the capability closes the third-party validation gate per the RFC 0021 / RFC 0026 precedent.

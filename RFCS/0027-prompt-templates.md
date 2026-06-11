# RFC 0027: Prompt Templates

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0027                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Title**         | Prompt Templates — wire shape for portable, versioned, variable-bound prompts; `capabilities.prompts` block; `prompt.composed` run event                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Author(s)**     | OpenWOP Working Group                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Created**       | 2026-05-19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Updated**       | 2026-05-23 (Active → Accepted: first non-steward host advertisement validated live. MyndHyve workflow-runtime advertises `capabilities.prompts.{supported: true, observability: 'full'}` on `https://api.myndhyve.ai/.well-known/openwop` (verified 2026-05-23). MyndHyve commit `5385548c` lands the prompt-compose seam end-to-end with SR-1 redaction (BYOK secret-source variables → `[REDACTED:<credentialRef>]` markers in `prompt.composed` payloads, never plaintext) + RFC 0020 §D `<UNTRUSTED>...</UNTRUSTED>` wrapping (untrusted bindings propagate `contentTrust: "untrusted"` to the composed envelope). `observability` bumped `'hashed' → 'full'` and is now backed by real emission per `c4342b5b` adoption-pass evidence. Conformance scenarios `prompt-template-shape.test.ts` + `prompt-composed-secret-redaction.test.ts` + `prompt-composed-trust-marker.test.ts` shipped in `@openwop/openwop-conformance@1.4.0`; MyndHyve reports 71/71 green on the targeted suites. 2026-05-20 prior: Draft → Active. See [Status history](#status-history) below for full lineage.) |
| **Affects**       | `spec/v1/prompts.md` (NEW) · `schemas/prompt-template.schema.json` (NEW) · `schemas/prompt-ref.schema.json` (NEW) · `schemas/prompt-kind.schema.json` (NEW — shared enum $def) · `schemas/capabilities.schema.json` (additive `prompts` block) · `schemas/run-event.schema.json` (new `prompt.composed` enum entry) · `schemas/run-event-payloads.schema.json` (new `promptComposed` `$def`+ additive`divergencePoint`field on the existing`replayDiverged` `$def`per §F — the shared field is consumed by RFCs 0029 and 0032 as well) ·`spec/v1/workflow-definition.md`(note`WorkflowNode.config.promptRef`convention) ·`SECURITY/invariants.yaml`(new`prompt-composed-secret-redaction`,`prompt-composed-trust-marker`) · 3 new conformance scenarios · CHANGELOG                                                                                                                                                                                                                                                                                                                            |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Summary

Defines `PromptTemplate` as a first-class wire-shape and `PromptRef` as the reference type that workflow nodes and agent manifests use to point at one. Adds an optional `capabilities.prompts` advertisement block and a new optional `prompt.composed` `RunEventType` that emits the resolved prompt body each time a node assembles one for an LLM call. Lands the wire-shape contract only — registry endpoints (`/v1/prompts/*`) and the prompt-pack distribution kind defer to RFC 0028; the agent-scoped override hierarchy defers to RFC 0029. Cross-host portability for prompts has been an implicit gap since v1.0: hosts have shipped prompt libraries in proprietary stores while the `systemPrompt` field on `core.ai.callPrompt` and `AgentManifest.systemPrompt|systemPromptRef` can only carry one inline body per node, with no shared addressing, versioning, variable schema, or observability.

## Motivation

Two surfaces in v1 already accept a prompt body, but neither establishes prompt-as-a-resource:

- `spec/v1/workflow-chain-packs.md` line 71 demonstrates `core.ai.callPrompt` config carrying `"systemPrompt": "You are a senior PM. Write a PRD for: {{params.productIdea}}\nAudience: {{params.targetAudience}}"`. The `{{params.X}}` substitution is convention-only — no spec'd variable schema, no enumeration of allowed sources, no observability of the composed result.
- `schemas/agent-manifest.schema.json` lines 34–41 + 104–105 lock `systemPrompt XOR systemPromptRef`. Both are tarball-resident; neither can be referenced across packs or replaced at run time.

Authors who want the canvas-editor patterns of (a) maintain a named, versioned prompt library, (b) reuse the same prompt across multiple nodes or workflows, (c) preview the composed body before dispatch, or (d) audit what every agent actually saw in a multi-agent run currently have no protocol-level surface for any of these. Host-internal libraries exist (the reference `myndhyve` impl persists `PromptEntry`/`PromptLibrary` documents in Firestore at `workspaces/{workspaceId}/prompt-libraries/{canvasTypeId}` with built-in/override/version semantics), but the values they hold cross the wire as opaque interpolated strings — losing the ID, the version, the variable schema, and the resolution chain.

This RFC closes the wire-shape gap. Phase A only — the **shape**, the **capability flag**, and the **observability event**. The registry surface (Phase B / RFC 0028) and the agent-scoped override resolution chain (Phase C / RFC 0029) build on this RFC's foundation and ship separately.

The motivating use case is **multi-agent debuggability**: in a workflow where three `core.ai.callPrompt` nodes act as `writer`, `critic`, `editor` with different system prompts, today there is no protocol-visible way to inspect "what prompt did the critic actually see at sequence 47?" — only the upstream `agent.reasoned` output and the downstream node payload. The `prompt.composed` event introduced here lifts the composed prompt into the durable event log, gated by capability, with mandated secret redaction and trust-marker propagation.

## Proposal

### §A — Top-level `PromptTemplate` schema

`schemas/prompt-template.schema.json` (NEW). JSON Schema 2020-12, `$id: https://openwop.dev/spec/v1/prompt-template.schema.json`, `additionalProperties: false` at the top level. Required: `templateId`, `version`, `kind`, `text`. Optional: `name`, `description`, `variables`, `modelHints`, `tags`, `meta`.

A companion `schemas/prompt-kind.schema.json` (NEW) holds the `kind` enum as a shared `$def` so the same enum doesn't drift across the five schemas that reference it (`prompt-template.schema.json`, `agent-manifest.schema.json` via RFC 0029, `workflow-definition.schema.json` via RFC 0029, `capabilities.schema.json` §D, `run-event-payloads.schema.json` §E). Hosts and SDKs cross-validate `kind` values against this single enum:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/prompt-kind.schema.json",
  "title": "PromptKind",
  "description": "Role a PromptTemplate plays when composed into an LLM call. Shared $def referenced by every schema that names a prompt kind. Adding a kind here is the single edit needed to introduce one across the corpus.",
  "type": "string",
  "enum": ["system", "user", "few-shot", "schema-hint"]
}
```

Every reference uses `{ "$ref": "https://openwop.dev/spec/v1/prompt-kind.schema.json" }` instead of inlining the enum.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/prompt-template.schema.json",
  "title": "PromptTemplate",
  "type": "object",
  "additionalProperties": false,
  "required": ["templateId", "version", "kind", "text"],
  "properties": {
    "templateId": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9._-]{0,127}$",
      "description": "Stable identifier. Convention: vendor-prefixed for portable templates (`vendor.acme.writer.v2`) or unprefixed for host-resident (`writer`). Per host-extensions.md §\"Canonical-prefix table.\""
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "SemVer 2.0.0. Bumping major implies a breaking variable-schema or text change; consumers MUST pin if they care about exact bodies."
    },
    "kind": {
      "$ref": "https://openwop.dev/spec/v1/prompt-kind.schema.json",
      "description": "Role this template plays when composed into an LLM call. A node MAY reference one of each kind. References the shared enum so adding a kind is a single-file edit."
    },
    "text": {
      "type": "string",
      "maxLength": 65536,
      "description": "Template body. Variable interpolation uses `{{varName}}` (Mustache-compatible, no logic). Untrusted-content markers `<UNTRUSTED>...</UNTRUSTED>` MUST be preserved verbatim per SECURITY/threat-model-prompt-injection.md."
    },
    "name": {
      "type": "string",
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "maxLength": 2000
    },
    "variables": {
      "type": "array",
      "items": { "$ref": "#/$defs/PromptVariable" },
      "description": "Typed interpolation slots. Hosts MUST validate bindings against this schema before composing. Unresolved required variables MUST cause the node to fail with `prompt_variable_unresolved`. Unresolved optional variables render as empty string."
    },
    "modelHints": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "modelClass": { "type": "string", "description": "Per AgentRef.modelClass enum + vendor extensions." },
        "temperature": { "type": "number", "minimum": 0, "maximum": 2 },
        "maxTokens": { "type": "integer", "minimum": 1 },
        "envelopeType": { "type": "string", "description": "Suggested AI Envelope kind to use with this template, per RFC 0021." }
      },
      "description": "Non-normative authoring hints. A host MAY surface these in editor UI; they do NOT override per-node config."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1, "maxLength": 64 },
      "maxItems": 32
    },
    "meta": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "author": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" },
        "updatedAt": { "type": "string", "format": "date-time" },
        "source": { "type": "string", "enum": ["host", "pack", "user"], "description": "Provenance. `host`: built-in. `pack`: installed via RFC 0028 prompt pack. `user`: created at run time." }
      }
    }
  },
  "$defs": {
    "PromptVariable": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "type", "required"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-zA-Z_][a-zA-Z0-9_]{0,63}$"
        },
        "type": {
          "type": "string",
          "enum": ["string", "number", "boolean", "array", "object"]
        },
        "required": { "type": "boolean" },
        "source": {
          "type": "string",
          "enum": ["input", "variable", "secret", "context"],
          "description": "Where the binding comes from. `input`: node input port. `variable`: run-scoped variable (`ctx.variables.get`). `secret`: BYOK secret reference (MUST be redacted in observability events per §E). `context`: host-provided implicit context (e.g., current user identifier, run id). Default when omitted: `input`."
        },
        "extractPath": {
          "type": "string",
          "description": "JSONPath into the source. When omitted, the entire source value binds to `name`."
        },
        "defaultValue": {
          "description": "Used when `required: false` and the source resolves to undefined."
        },
        "description": { "type": "string", "maxLength": 500 }
      }
    }
  }
}
```

### §B — `PromptRef` schema (the reference type nodes carry)

`schemas/prompt-ref.schema.json` (NEW). `$id: https://openwop.dev/spec/v1/prompt-ref.schema.json`. Accepts two compact forms — a stringy URI form and a structured form — so authors can write either `"prompt:writer-v2@1.3.0"` inline in node config or a `{ templateId, version, libraryId? }` object.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/prompt-ref.schema.json",
  "title": "PromptRef",
  "description": "Reference to a PromptTemplate. The stringy form `prompt:<templateId>[@<version>]` is canonical for inline use in WorkflowNode.config; the object form is canonical when libraryId disambiguation is needed (i.e., once RFC 0028 lands).",
  "oneOf": [
    {
      "type": "string",
      "pattern": "^prompt:[a-z0-9][a-z0-9._-]{0,127}(@\\d+\\.\\d+\\.\\d+)?$"
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": ["templateId"],
      "properties": {
        "libraryId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9._-]{0,127}$" },
        "templateId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9._-]{0,127}$" },
        "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
        "variableOverrides": {
          "type": "object",
          "description": "Variable bindings supplied at reference time. Take precedence over node input bindings; checked against PromptTemplate.variables before composition."
        }
      }
    }
  ]
}
```

### §C — Node-config convention

This RFC normates one new optional convention on `WorkflowNode.config`: the keys `systemPromptRef`, `userPromptRef`, and `additionalPromptRefs` MAY hold `PromptRef` values. `spec/v1/workflow-definition.md` gains a non-required §"Prompt references on nodes" subsection documenting the convention; `schemas/workflow-definition.schema.json` is **not** modified — `WorkflowNode.config` already accepts arbitrary JSON, so this is documentation, not a schema diff.

```jsonc
// Example WorkflowNode.config carrying refs:
{
  "systemPromptRef": "prompt:writer-system@1.0.0",
  "userPromptRef": { "templateId": "writer-user", "version": "2.1.0", "variableOverrides": { "tone": "formal" } },
  "additionalPromptRefs": ["prompt:house-style-suffix@1.0.0"],
  "envelopeType": "writer.draft",
  "temperature": 0.2
}
```

Hosts that advertise `capabilities.prompts.supported: true` MUST resolve `systemPromptRef` and `userPromptRef` if present; hosts that don't advertise the capability MAY treat the keys as opaque (forward-compat).

When both an inline body (`systemPrompt`) and a ref (`systemPromptRef`) are present on the same node, the ref MUST win and the host MUST emit one `log.appended` event at `level: "warn"` per node-execution with `code: "prompt_ref_supersedes_inline"`. This is the same shadowing posture RFC 0013 uses for chain-pack param defaults.

### §D — `capabilities.prompts` advertisement (additive)

`schemas/capabilities.schema.json` gains one optional top-level property:

```diff
   "properties": {
     "protocolVersion": { ... },
     "supportedEnvelopes": { ... },
     ...
+    "prompts": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["supported"],
+      "properties": {
+        "supported": {
+          "type": "boolean",
+          "description": "Host resolves PromptRef values in WorkflowNode.config and AgentManifest extension fields per RFC 0027."
+        },
+        "templateKinds": {
+          "type": "array",
+          "items": { "type": "string", "enum": ["system", "user", "few-shot", "schema-hint"] },
+          "description": "Subset of kinds the host accepts. Defaults to all four when omitted."
+        },
+        "variableSources": {
+          "type": "array",
+          "items": { "type": "string", "enum": ["input", "variable", "secret", "context"] },
+          "description": "Subset of variable sources the host supports. `secret` SHOULD only appear when capabilities.secrets.supported is also true."
+        },
+        "maxTemplateBytes": {
+          "type": "integer",
+          "minimum": 1,
+          "description": "Host limit on PromptTemplate.text length. MUST NOT exceed the schema cap (65536)."
+        },
+        "observability": {
+          "type": "string",
+          "enum": ["off", "hashed", "full"],
+          "description": "How `prompt.composed` events expose resolved bodies. `off`: event not emitted. `hashed`: payload carries only sha256 + variable-binding hashes (no plaintext). `full`: payload carries the composed body with secret-sourced values redacted per §E. Default when omitted: `hashed`."
+        }
+      },
+      "description": "Advertisement that the host implements RFC 0027 prompt-template resolution. Absent block = no support; consumers that pass PromptRef values to such a host MUST tolerate them being treated as opaque strings."
+    },
     "limits": { ... }
   }
```

Capability gating MUST follow the existing pattern in `conformance/src/lib/behavior-gate.ts`: scenarios that exercise prompt resolution skip cleanly when `capabilities.prompts.supported !== true`.

### §E — `prompt.composed` run event

`schemas/run-event.schema.json` adds `"prompt.composed"` to the `RunEventType` enum. `schemas/run-event-payloads.schema.json` adds a new `$def` `promptComposed` and an entry in `_typeIndex`:

```diff
         "agent.reasoned":            { "$ref": "#/$defs/agentReasoned" },
+        "prompt.composed":           { "$ref": "#/$defs/promptComposed" },
         "provider.usage":            { "$ref": "#/$defs/providerUsage" },
```

```json
"promptComposed": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "refs", "hash", "kind"],
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "Lifted to top-level RunEventDoc.nodeId; mirrored here for self-contained payload validation."
    },
    "refs": {
      "type": "array",
      "items": { "type": "string", "pattern": "^prompt:[a-z0-9][a-z0-9._-]{0,127}(@\\d+\\.\\d+\\.\\d+)?$" },
      "description": "Ordered list of PromptRef values that contributed to this composition (system, then user, then additional). Object-form refs are projected to their stringy equivalent."
    },
    "kind": {
      "type": "string",
      "enum": ["system+user", "system-only", "user-only", "agent-reasoning"],
      "description": "Composition shape — what the host actually assembled."
    },
    "hash": {
      "type": "string",
      "pattern": "^sha256:[0-9a-f]{64}$",
      "description": "SHA-256 of the composed body (post-substitution, post-redaction). Stable across replay. Always present even under observability=hashed."
    },
    "systemPrompt": {
      "type": "string",
      "description": "Composed system prompt body. Present only when capabilities.prompts.observability is `full`. Secret-sourced variable values MUST be replaced with `[REDACTED:<secretId>]` markers (per SECURITY/threat-model-secret-leakage.md SR-1). Untrusted-content `<UNTRUSTED>...</UNTRUSTED>` markers MUST be preserved verbatim."
    },
    "userPrompt": {
      "type": "string",
      "description": "Composed user prompt body. Same presence + redaction rules as systemPrompt."
    },
    "variableBindings": {
      "type": "object",
      "description": "Variable-name → bound-value map. Secret-source bindings MUST be replaced with `[REDACTED:<secretId>]`. Only present when observability is `full`.",
      "additionalProperties": true
    },
    "variableHashes": {
      "type": "object",
      "additionalProperties": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
      "description": "Variable-name → sha256(value) map. Always present (under both `hashed` and `full`). Enables replay-determinism checks without exposing values."
    },
    "contentTrust": {
      "type": "string",
      "enum": ["trusted", "untrusted"],
      "description": "Aggregate trust marker. `untrusted` if ANY contributing input was tagged untrusted per RFC 0020 §D / `meta.contentTrust` propagation."
    }
  }
}
```

Trust-boundary propagation mirrors RFC 0021 §E: when any contributing input arrived flagged `untrusted`, the composed prompt body MUST contain `<UNTRUSTED>...</UNTRUSTED>` markers around the untrusted segments AND the event payload's `contentTrust` MUST be `"untrusted"`.

### §F — Replay determinism

`prompt.composed` events are durable and participate in replay. Replay invariants:

- `hash` MUST replay identically.
- `variableHashes[name]` MUST replay identically.
- `systemPrompt` / `userPrompt` / `variableBindings` MAY be omitted on replay even when present in the original run, because the host's `capabilities.prompts.observability` setting MAY have changed between original execution and replay. Replay-consumers MUST tolerate the omission.
- `refs` MUST replay identically.

Divergence of `hash` MUST emit a `replay.diverged` event per existing replay.md semantics with `divergencePoint: "prompt.composed"`.

#### `replayDiverged` schema extension (additive, shared across RFCs 0027 / 0029 / 0032)

The existing `replayDiverged` `$def` in `schemas/run-event-payloads.schema.json` (line ~548) carries `divergenceKind: "output" | "missing" | "extra" | "type-mismatch"` describing the _shape_ of the divergence. This RFC adds an optional `divergencePoint: string` field describing _which event type_ the divergence was detected on. The two fields are complementary:

```diff
   "replayDiverged": {
     "type": "object",
     "description": "Emitted by `:fork` when a replay re-execution produces a different output than the original at a given sequence. See replay.md §divergence detection.",
     "required": ["sourceRunId", "atSequence"],
     "properties": {
       "sourceRunId":     { "type": "string", "minLength": 1 },
       "atSequence":      { "type": "integer", "minimum": 0 },
       "originalEventId": { "type": "string" },
-      "divergenceKind":  { "type": "string", "enum": ["output", "missing", "extra", "type-mismatch"] }
+      "divergenceKind":  { "type": "string", "enum": ["output", "missing", "extra", "type-mismatch"] },
+      "divergencePoint": {
+        "type": "string",
+        "description": "Verbatim `RunEventType` enum string identifying which event-emission the replay diverged at (e.g., `\"prompt.composed\"`, `\"agent.promptResolved\"`, `\"envelope.retry.exhausted\"`, `\"envelope.recovery.applied\"`). Set when divergence is detected on a specific cross-kind operational event's payload. When divergence is purely structural (output/missing/extra at the event-array level rather than within a typed payload), `divergenceKind` carries the shape and `divergencePoint` MAY be omitted. The two fields are complementary, not mutually exclusive: a single `replay.diverged` event MAY carry both (e.g., `{ divergenceKind: \"output\", divergencePoint: \"prompt.composed\" }` reads as \"the `prompt.composed` event at sequence N had a different output on replay than the original\")."
+      }
     },
     "additionalProperties": true
   }
```

The schema diff lands once in this RFC; RFCs 0029 §C and 0032 §D reference this section rather than redefining the field. Compatibility: additive — existing replay consumers that read `divergenceKind` alone continue to work; consumers that want to filter by event type can opt into reading `divergencePoint`. The existing `additionalProperties: true` on `replayDiverged` already accepts arbitrary fields, so emitters MAY have been carrying `divergencePoint`-shaped data without breakage — this RFC normates the field name and value convention.

### §G — Security invariants

Two new entries in `SECURITY/invariants.yaml`. **Gate timing:** these entries land alongside the reference-host implementation, not at Draft merge. The `check-security-invariants.sh` step in `npm run openwop:check` enforces that every protocol-tier MUST-NOT has a matching public test; the MUST-NOT statements proposed in §E only acquire that obligation once `prompt.composed` is actually emitted by a host. This matches the staging used by RFC 0021 (envelope-shape invariants landed with reference-host emission, not at RFC merge). Reviewers MUST NOT block Draft acceptance on the absence of these invariants.yaml rows.

```yaml
  - id: prompt-composed-secret-redaction
    description: |
      `prompt.composed` event payloads MUST NOT contain plaintext values of any variable whose source is `secret`.
      Such values MUST appear as `[REDACTED:<secretId>]` markers in `systemPrompt`, `userPrompt`, `variableBindings`.
    threat_model: SECURITY/threat-model-secret-leakage.md
    severity: high
    conformance_scenarios:
      - prompt-composed-secret-redaction.test.ts

  - id: prompt-composed-trust-marker
    description: |
      When ANY input contributing to a composed prompt is tagged `meta.contentTrust: untrusted`,
      the `prompt.composed` payload MUST set `contentTrust: untrusted` AND the composed bodies
      MUST wrap the untrusted segments in `<UNTRUSTED>...</UNTRUSTED>` markers.
    threat_model: SECURITY/threat-model-prompt-injection.md
    severity: high
    conformance_scenarios:
      - prompt-composed-trust-marker.test.ts
```

## Compatibility

**Additive per `COMPATIBILITY.md §2.1`.** All claims:

- Existing required fields: unchanged.
- Existing optional fields: unchanged. `AgentManifest.systemPrompt|systemPromptRef` shapes are not modified by this RFC (cross-manifest prompt-library binding defers to RFC 0029).
- `WorkflowDefinition` / `WorkflowNode` schemas: unchanged. The §C node-config convention is documentation against the existing `WorkflowNode.config` permissive shape.
- Existing event types: unchanged. `prompt.composed` is a new enum entry; per `run-event.schema.json` line 64, consumers MUST tolerate unknown event types (forward-compat: fold best-effort).
- Existing endpoints: unchanged. No REST surface added by this RFC (deferred to RFC 0028).
- Existing MUST requirements: not relaxed. The §C "ref supersedes inline" rule applies only when a host advertises `capabilities.prompts.supported: true`; the warn-log requirement is conditional on the same gate.
- Existing error codes: unchanged. Two new optional error codes (`prompt_variable_unresolved`, `prompt_ref_supersedes_inline`) only surface when the capability is advertised.

Hosts that don't advertise `capabilities.prompts` see no behavioral change. Workflows that don't carry `*PromptRef` keys in node config see no behavioral change on any host.

## Conformance

Three new scenarios under `conformance/src/scenarios/`:

- `prompt-template-shape.test.ts` — Ajv2020 compileability of `prompt-template.schema.json` and `prompt-ref.schema.json`, plus positive/negative fixture round-trips (missing required field, invalid `templateId` pattern, variable type ↔ binding mismatch). Always runs.
- `prompt-composed-secret-redaction.test.ts` — Gated on `capabilities.prompts.supported: true` AND `capabilities.prompts.observability: "full"`. Dispatches a workflow with one `core.ai.callPrompt` node whose template includes a variable bound from a `secret` source; asserts the emitted `prompt.composed` event contains `[REDACTED:<secretId>]` and never the plaintext secret value.
- `prompt-composed-trust-marker.test.ts` — Gated on `capabilities.prompts.supported: true` AND `capabilities.prompts.observability: "full"`. Sends an input flagged `meta.contentTrust: untrusted` into a prompt-templated node; asserts the emitted event's `contentTrust === "untrusted"` and that `<UNTRUSTED>...</UNTRUSTED>` markers wrap the relevant segment.

Hosts that advertise `observability: "hashed"` skip the latter two scenarios' body assertions but still run the `hash` and `variableHashes` assertions extracted into a fourth helper test (`prompt-composed-hashed-presence.test.ts`).

The `behaviorGate` helper in `conformance/src/lib/behavior-gate.ts` gains a `requirePromptsSupport()` predicate; precedent: `requireAgentsSupport()` from RFC 0023.

## Alternatives considered

1. **Ship endpoints (`/v1/prompts/*`) in this RFC.** Rejected — entangling the wire-shape contract with a REST surface bundles two distinct conformance signals into one Active-window vote. RFC 0021 (AI Envelope) established the precedent of "shape first, surface later"; the AI Envelope schema landed in v1.1 without requiring `/v1/envelopes/*` endpoints. Endpoints belong in RFC 0028 alongside the prompt-pack distribution kind that gives them content.

2. **Extend `AgentManifest.systemPromptRef` to accept a `PromptRef` value.** Rejected for Phase A — `AgentManifest.systemPromptRef` is normatively a tarball-relative URI per RFC 0003. Overloading it with the new `PromptRef` shape mid-flight risks ambiguous resolution at install time (is `prompt:writer@1.0.0` a tarball path or a registry ref?). RFC 0029 adds a parallel `promptLibraryRef` field with cleaner semantics; this RFC stays at the node level only.

3. **Make `prompt.composed` always carry the full body.** Rejected — replay determinism, secret-leakage risk, and event-log size pressure all push in the opposite direction. The default `observability: "hashed"` minimizes the durable surface area; `"full"` is opt-in for development/debugging hosts.

4. **Treat the `{{var}}` substitution as host-internal and skip the typed-variable schema.** Rejected — RFC 0013's `{{params.X}}` chain-pack substitution is already convention-based without a typed schema, and the result is that consuming hosts can't validate variable bindings at install time. Typed `PromptVariable` is the cheapest path to install-time validation and editor-side authoring help.

5. **Do nothing.** Rejected — the `myndhyve` reference impl's `PromptEntry`/`PromptLibrary` model is already in use against the v1 surface, and the lack of a wire-level prompt shape means every prompt body crosses the wire as an opaque interpolated string. Multi-agent observability suffers: a debugger can see `agent.reasoned` and `node.completed` events but cannot reconstruct what each agent's prompt actually was. Deferring means more hosts ship prompt models that drift before the schema lands — exactly the situation RFC 0021 was rushed to avoid for envelopes.

## Unresolved questions

1. **Should `PromptTemplate.text` allow nested refs (`{{include:prompt:other-template@1.0.0}}`)?** The myndhyve impl has a single-level `additionalPrompt` field but no nested-include syntax. Including it now risks complicating the substitution semantics (recursion depth, cycle detection, version pinning across includes); excluding it forces the additive `additionalPromptRefs` array workaround. Recommendation: defer to a future minor RFC if demand emerges.

2. **Should `modelHints.envelopeType` cross-reference RFC 0021's envelope catalog?** Right now it's an opaque string; an Ajv-compileable cross-schema reference would catch typos at install time but adds tooling burden. Leave opaque in v1.1; tighten if/when registry-side cross-validation lands. The parallel RFC 0030 (envelope `reasoning` field + Tier-1 subset) provides additional authoring guidance for envelope payload schemas — `modelHints.envelopeType` consumers MAY check the referenced envelope against the Tier-1 subset for portability.

3. **Variable-source `context`: enumerate the allowed context keys, or leave open?** The myndhyve impl uses `context` for things like `currentUserId`, `runId`, `workflowName`. Standardizing the names would help portability but constrains future host additions. Leave open in v1.1; document the canonical names in `spec/v1/prompts.md` as non-normative recommendations.

4. **Should the `replay.diverged` divergence-point for hash mismatch be a new `divergencePoint` enum value or piggyback on existing event-payload divergence?** Existing replay.md doesn't enumerate divergence points strictly; this RFC adds the value `"prompt.composed"` non-controversially but a separate RFC may consolidate the divergence taxonomy.

## Implementation notes (non-normative)

- Reference host `apps/workflow-engine/backend/typescript` MUST emit `prompt.composed` for every `core.ai.callPrompt` node execution once the capability is advertised. The composition pipeline mirrors the 10-step assembly described in the `myndhyve` `callPrompt.node.ts:235–722` reference: substitute → status emit → scope-preservation fragment → schema injection → capability gate → clarification incorporation → conversation history → temperature adjustment → AI call → envelope retry. Steps 1–8 are observable; step 9 ties into existing `provider.usage` emission per RFC 0026; step 10 ties into RFC 0021 envelope retry.
- The React example app at `apps/workflow-engine/frontend/react` MUST gain a new `kind: "prompt-picker"` `ConfigField` per `src/builder/inspector/Inspector.tsx:86–142` and a new `/prompts` route. Detailed plan in the analysis document accompanying this RFC; component changes are not normative.
- Estimated effort: schemas + spec text ~1 day; reference-host emission wiring ~1 day; three conformance scenarios ~1 day; CHANGELOG ~30min. Total ~3 days plus the standard 7-day Active window unless the bootstrap-phase waiver applies.
- The MyndHyve reference impl uses Mustache-compatible `{{var}}` syntax with `onUnresolved: 'empty'` for optional variables. This RFC's §A "Unresolved required variables MUST fail" + "Unresolved optional variables render as empty string" mirrors that semantics exactly.
- **Relation to the envelope-track RFCs 0030–0033 (filed in parallel 2026-05-20).** `prompt.composed.systemPrompt|userPrompt` here records the **host's** composed prompt body before dispatch. The envelope-track RFC 0030 introduces an optional `reasoning` field inside **LLM-emitted** envelope payloads (chain-of-thought inside the structured output). RFC 0024's `agent.reasoning.delta` is the third sibling — the **model's** thinking-tokens stream. The three surfaces are complementary: one captures what the host sent, one captures what the model emitted as part of structured output, and one captures the model's interleaved reasoning trace. None replaces the others; multi-agent observability tools render all three for a full picture.

## Acceptance criteria

Checklist the maintainers will use to flip `Status` from `Active` to `Accepted`:

- [x] `spec/v1/prompts.md` merged at status DRAFT v1.x (promotes to FINAL v1.x with this RFC's acceptance — minor-version assignment per `GOVERNANCE.md` release cadence, not pre-committed by this RFC).
- [x] `schemas/prompt-template.schema.json` ships.
- [x] `schemas/prompt-ref.schema.json` ships.
- [x] `schemas/prompt-kind.schema.json` ships and is `$ref`-ed (not inlined) from every site that names a prompt kind.
- [x] `schemas/capabilities.schema.json` gains the `prompts` block per §D.
- [x] `schemas/run-event.schema.json` adds `"prompt.composed"` to the `RunEventType` enum.
- [x] `schemas/run-event-payloads.schema.json` adds the `promptComposed` `$def` and `_typeIndex` entry.
- [x] `WorkflowNode.config.promptRef` convention documented. (Original criterion named `spec/v1/workflow-definition.md` but that file doesn't exist in this repo — the canonical location for schema-shape contracts is the JSON Schema itself. `schemas/workflow-definition.schema.json` §`config.promptRefs` documents the convention normatively: cites `spec/v1/prompts.md` §"PromptRef" + RFC 0027 §C, specifies the inline-vs-ref merge rule with the `prompt_ref_supersedes_inline` `log.appended` warning, and the optional-resolution semantics for hosts without `capabilities.prompts.supported`.)
- [x] `SECURITY/invariants.yaml` gains the two new entries per §G (`prompt-composed-secret-redaction`, `prompt-composed-trust-marker`).
- [x] Three new conformance scenarios per §"Conformance" land in `@openwop/openwop-conformance` — `prompt-template-shape.test.ts`, `prompt-composed-secret-redaction.test.ts`, `prompt-composed-trust-marker.test.ts`. Conformance suite minor bumped to `@openwop/openwop-conformance@1.4.0` (2026-05-22).
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] `INTEROP-MATRIX.md` updated to enumerate host advertisements of `capabilities.prompts.supported` + `observability`. The matrix shape mirrors the existing `capabilities.agents.*` row family. (Will land alongside the first non-steward advertisement.)
- [x] Reference host (`apps/workflow-engine/backend/typescript`) advertises `capabilities.prompts.supported: true` with `observability: "full"` and passes all three new conformance scenarios.
- [x] First non-steward host advertises `capabilities.prompts.supported: true` (third-party validation gate per RFC 0001 §"Promotion to Accepted") — MyndHyve workflow-runtime advertises `capabilities.prompts.{supported: true, observability: 'full'}` live at `https://api.myndhyve.ai/.well-known/openwop` (verified 2026-05-23). MyndHyve commit `5385548c` lands the prompt-compose seam end-to-end with SR-1 redaction + RFC 0020 §D `<UNTRUSTED>` wrapping; `observability` bumped `'hashed' → 'full'` and now backed by real emission. Closes RFC 0027 path-to-Accepted.

## References

- `spec/v1/workflow-chain-packs.md` lines 56–71, 209–250 — existing inline-`systemPrompt` precedent + `{{params.X}}` substitution convention this RFC formalizes.
- `schemas/agent-manifest.schema.json` lines 34–41, 104–105 — existing `systemPrompt XOR systemPromptRef` shape this RFC complements (not modifies).
- `RFCS/0021-ai-envelope-primitive.md` — wire-shape-first precedent (schema ships before endpoints).
- `RFCS/0024-agent-reasoning-streaming.md` — observability-event precedent (`agent.reasoned`, `agent.reasoning.delta`).
- `RFCS/0026-provider-usage-event.md` — durable per-LLM-call event precedent; redaction posture (`SECURITY/threat-model-secret-leakage.md §SR-1`) mirrored here.
- `RFCS/0020-host-mcp-server-composition.md` §D — `meta.contentTrust` trust-boundary propagation surfaced by `prompt.composed.contentTrust`.
- `SECURITY/threat-model-prompt-injection.md` — `<UNTRUSTED>...</UNTRUSTED>` marker discipline.
- `SECURITY/threat-model-secret-leakage.md` SR-1 — `[REDACTED:<id>]` marker discipline.
- `RFCS/0028-prompt-library-endpoints.md` (forthcoming) — `/v1/prompts/*` REST surface + `kind: "prompt"` registry pack.
- `RFCS/0029-prompt-override-hierarchy.md` (forthcoming) — agent-scoped resolution chain + `agent.promptResolved` event.
- `RFCS/0030-envelope-reasoning-and-tier-one-subset.md` (forthcoming, parallel track) — envelope-payload `reasoning` field (LLM-emitted CoT inside structured output) — sibling to `prompt.composed.systemPrompt` (host-composed prompt) and `agent.reasoning.delta` (model thinking-tokens). The three are complementary, not redundant.
- External: MyndHyve `PromptEntry`/`PromptLibrary` reference impl (`src/core/canvas/types/index.ts`, `src/core/canvas/stores/promptLibraryStore.ts`, `src/core/workflow/services/WorkflowPromptService.ts`).

## Status history

### Draft → Active (2026-05-20)

Promoted under the bootstrap-phase steward waiver per `CONTRIBUTING.md` §"Bootstrap-phase notes" + `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". Same posture RFCs 0021–0026 and 0030 used in this release. The 7-day comment window would only serve as a delay against zero external reviewers; the waiver is recorded here for the running list in `MAINTAINERS.md`.

Evidence at promotion (spec text + wire shape locked; reference-host emission + conformance suite operational; remaining acceptance criterion — first non-steward host advertisement — defined as the path to `Accepted`):

- **RFC text:** follows `RFCS/0000-template.md` — header table, Summary, Motivation, Proposal (§A wire shape, §B PromptRef + variable schema, §C config conventions, §D capabilities block, §E composition algorithm, §F replay determinism + `divergencePoint` field, §G SECURITY invariants), Compatibility (additive justification), Conformance (3 describe blocks), Alternatives, Unresolved questions, Acceptance criteria, References.
- **Spec text:** `spec/v1/prompts.md` shipped at status DRAFT v1.x carrying §"Why this exists", §"PromptKind", §"PromptTemplate", §"PromptRef", §"Capability advertisement", §"Composition + observability", §"Resolution chain (normative)" (RFC 0029 contribution), §"Discovery & distribution" (RFC 0028 contribution). `spec/v1/workflow-definition.md` gained the §"Prompt references on nodes" subsection.
- **Schemas additive (no MUST relaxed):** `prompt-template.schema.json`, `prompt-ref.schema.json`, `prompt-kind.schema.json` (shared enum `$def`), `capabilities.schema.json` (`prompts` block), `run-event.schema.json` (`prompt.composed` enum entry), `run-event-payloads.schema.json` (`promptComposed` `$def` + `divergencePoint` on `replayDiverged`).
- **Reference host (`apps/workflow-engine/backend/typescript`):** advertises `capabilities.prompts.supported: true` with `observability: "full"`. `bootstrap/nodes.ts` `sampleMockAiNode` walks the resolution chain via `resolvePromptRef()`, emits `agent.promptResolved`, composes via `composePromptTemplate()`, emits `prompt.composed` — pipeline exercised during real workflow dispatch (commit [`f2bd5b6`](https://github.com/openwop/openwop/commit/f2bd5b6)). Composition pipeline enforces SR-1 carry-forward + untrusted-content marker per `SECURITY/threat-model-secret-leakage.md §SR-1` + `threat-model-prompt-injection.md`.
- **SECURITY invariants:** `prompt-composed-secret-redaction` + `prompt-composed-trust-marker` in `SECURITY/invariants.yaml` with public-test pointers at `prompt-composed-secret-redaction.test.ts` + `prompt-composed-trust-marker.test.ts`. Pass `scripts/check-security-invariants.sh` (56/56 protocol-tier rows).
- **Conformance:** `prompt-template-shape.test.ts` (always-on schema validation), `prompt-composed-secret-redaction.test.ts`, `prompt-composed-trust-marker.test.ts`, `prompt-end-to-end-events.test.ts` (real-dispatch regression pin). All capability-gated scenarios wired through `behaviorGate('prompts-observability-full', ...)` / `behaviorGate('prompts-supported', ...)` per the strict-mode runner contract.
- **INTEROP-MATRIX.md:** `capabilities.prompts.*` rows enumerated alongside the existing `capabilities.agents.*` row family.
- **CHANGELOG.md:** `[1.1.2 — unreleased]` entries cover spec text, schemas, reference host, conformance scenarios, SECURITY invariants, INTEROP-MATRIX update.

Path to `Active → Accepted`: first non-steward host advertises `capabilities.prompts.supported: true` (third-party validation gate per RFC 0001 §"Promotion to Accepted") — MAY be waived under the bootstrap-phase waiver if the steward provides a public conformance run pointing at the advertised endpoint. All other acceptance-criteria boxes ticked.

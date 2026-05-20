# RFC 0032: Envelope-reliability run-event vocabulary

| Field | Value |
|---|---|
| **RFC** | 0032 |
| **Title** | Six envelope-reliability `RunEventType` entries; scope clarification of `ai-envelope.md` §"Run event log integration" line 448 MUST NOT |
| **Status** | `Active` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-20 |
| **Updated** | 2026-05-20 (Draft → Active — see [Status history](#status-history) below). |
| **Affects** | `spec/v1/ai-envelope.md` (clarifies §"Run event log integration" line 448; adds §"Envelope-reliability events") · `schemas/run-event.schema.json` (adds 6 new enum entries) · `schemas/run-event-payloads.schema.json` (adds 6 new `$defs` + `_typeIndex` entries) · `schemas/capabilities.schema.json` (adds optional `envelopes.reliability` block) · `spec/v1/observability.md` (adds §"Envelope-reliability events") · `api/asyncapi.yaml` (adds 6 channels) · `SECURITY/invariants.yaml` (adds `envelope-refusal-no-prompt-leak` + `envelope-recovery-no-content-leak`) · 6 new conformance scenarios · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |

## Summary

Adds six new `RunEventType` entries to standardize the protocol vocabulary for envelope-emission reliability behavior — retry attempts, retry exhaustion, refusals, truncations, NL-to-Format fallback engagement, and lenient-parsing recovery. Two events are MUSTs (`envelope.retry.exhausted`, `envelope.refusal`); the other four are SHOULD or MAY. Codifies the events so conformance suites can assert correct host behavior on adverse paths (today there is no stable vocabulary, and each host emits bespoke telemetry). The RFC also formally clarifies the scope of `ai-envelope.md` line 448's MUST NOT ("Hosts MUST NOT extend the `RunEventType` enum to add envelope-specific events") — the prohibition was scoped to *per-envelope-kind* events (one event mirroring each envelope kind, which would create a parallel routing surface), NOT to *cross-kind operational* events. The six events introduced here are cross-kind operational events about envelope emission, not per-kind routing events; they sit alongside the existing `provider.usage` (RFC 0026) and `prompt.composed` (RFC 0027) precedents.

## Motivation

### 2.1 Telemetry vocabulary fragmentation

Every host that implements envelope emission needs to handle the same failure modes — schema violation, truncation, refusal, retry, recovery — but each host emits bespoke telemetry that conformance suites cannot assert against. The reference MyndHyve host emits a private `metricKind` namespace (`ai.envelope.outputMode`, `ai.envelope.typeDrift`, `ai.envelope.invalid`, `ai.capability.substitution`, etc.). The OpenWOP reference workflow-engine emits its own bespoke shape. A second non-steward host adopting RFC 0021 will invent a third vocabulary. None of these are visible from outside the host's source tree, so:

- Conformance suites cannot assert "the host retried after a schema-violation."
- Observability tools cannot dashboard "envelope refusal rate" portably across hosts.
- Workflow authors cannot debug "why did this LLM call fail" without host-internal log access.

Standardizing six event types gives conformance suites a stable vocabulary to verify reliability behavior, and gives observability tooling a stable contract to dashboard against.

### 2.2 Conformance can't gate retry/refusal/truncation behavior today

`RFCS/0021-ai-envelope-primitive.md` §C lands the validation pipeline (shape → kind → payload → contract → limits → redaction → dedup → handler), but it doesn't enumerate the *adverse-path* event vocabulary. The host can perfectly implement the validation pipeline and silently mishandle truncation (e.g., retrying with a corrective schema fragment when it should retry with a doubled output budget) — and no conformance assertion catches it. RFC 0033 (envelope-completion contract) normates the retry-routing semantics; this RFC ships the events RFC 0033 asserts against.

### 2.3 The line-448 MUST NOT is being read more broadly than the original intent

The current FINAL-v1.1 prose at `spec/v1/ai-envelope.md:448` reads:

> "For vendor-namespaced kinds (e.g., `vendor.myndhyve.prd.create`), the host's handler chooses the appropriate `RunEventDoc.type` from the existing 48-variant enum. Hosts MUST NOT extend the `RunEventType` enum to add envelope-specific events; the envelope's identity rides on `causationId`, not on a parallel event-type surface."

A literal reading of "envelope-specific events" forbids any new `envelope.*` `RunEventType` entry. But the prose's *intent* — read with the surrounding context — is narrower: it prohibits hosts from creating a *parallel routing surface* where each envelope kind gets its own event type (e.g., `clarification.requested`, `prd.created`, `theme.created`, etc.), which would force consumers to learn the cross-product of envelope kinds × handler events. The envelope's identity rides on `causationId` precisely so that per-kind routing isn't needed.

This RFC clarifies the scope: line 448's MUST NOT applies to **per-envelope-kind events** (one new `RunEventType` entry per envelope kind), not to **cross-kind operational events** (one event type that fires across many envelope kinds for a shared operational concern like retry or refusal). The six events introduced here are cross-kind operational events; they don't create a per-kind routing surface, and they don't conflict with `causationId`-based handler routing.

Both RFC 0026 (`provider.usage`) and RFC 0027 (`prompt.composed`) extended `RunEventType` with operational events that fire across many envelope kinds (or independent of envelopes entirely). Both shipped without conflicting with line 448. This RFC formally codifies that precedent as a scope clarification, not a relaxation of the prohibition.

## Proposal

### §A — Scope clarification of `ai-envelope.md` §"Run event log integration"

Replace the second sentence of line 448 with the following clarified prose:

> **Current text (line 448, FINAL v1.1):**
>
> > For vendor-namespaced kinds (e.g., `vendor.myndhyve.prd.create`), the host's handler chooses the appropriate `RunEventDoc.type` from the existing 48-variant enum. Hosts MUST NOT extend the `RunEventType` enum to add envelope-specific events; the envelope's identity rides on `causationId`, not on a parallel event-type surface.
>
> **Clarified text (RFC 0032):**
>
> > For vendor-namespaced kinds (e.g., `vendor.myndhyve.prd.create`), the host's handler chooses the appropriate `RunEventDoc.type` from the existing `RunEventType` enum. Hosts MUST NOT extend the `RunEventType` enum to add **per-envelope-kind routing events** — i.e., one event mirroring each envelope kind, which would create a parallel routing surface (the envelope's identity rides on `causationId`, not on a parallel event-type surface, so per-kind events are unnecessary). Hosts MAY emit **cross-kind operational events** that fire across many envelope kinds for shared operational concerns (retry, refusal, truncation, capability substitution, prompt composition, provider usage); these MAY extend `RunEventType` via the RFC process. Events introduced under this clarification: RFC 0026 (`provider.usage`), RFC 0027 (`prompt.composed`), RFC 0031 (`model.capability.{substituted,insufficient}`), RFC 0032 (six envelope-reliability events), RFC 0029 (`agent.promptResolved`).

**Why this is a clarification, not a relaxation.** The original MUST NOT's *intent* is preserved: per-kind events remain forbidden. The clarification narrows the *literal* reading of "envelope-specific events" to match the original intent. Per `COMPATIBILITY.md §2.2`, existing MUSTs MUST NOT be relaxed in v1.x — this RFC does not relax the per-kind prohibition. The cross-kind operational allowance was always implicit in the surrounding text and existing precedent (RFCs 0026, 0027 shipped under the same interpretation); this RFC makes that interpretation explicit. Classified as `additive` per `COMPATIBILITY.md §4` row "New normative requirement on a previously-undefined behavior" (specifically, the *scope* of the existing MUST NOT was undefined; this RFC defines it).

### §B — Six envelope-reliability event definitions

`schemas/run-event.schema.json` `RunEventType` enum gains six new entries (alphabetized adjacent to existing entries):

```diff
   "envelope.accepted",
+  "envelope.nlToFormat.engaged",
+  "envelope.recovery.applied",
+  "envelope.refusal",
+  "envelope.retry.attempted",
+  "envelope.retry.exhausted",
+  "envelope.truncated",
```

`schemas/run-event-payloads.schema.json` gains six new `$defs` and `_typeIndex` entries.

#### §B.1 `envelope.retry.attempted` (SHOULD)

Emitted when a host retries an envelope emission after a parse or validation failure on a prior attempt.

```json
"envelopeRetryAttempted": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "attempt", "reason"],
  "properties": {
    "nodeId":  { "type": "string", "description": "The node whose envelope emission is being retried." },
    "attempt": { "type": "integer", "minimum": 1, "maximum": 16, "description": "1-indexed attempt counter. The first attempt does NOT emit this event; the second attempt emits with `attempt: 2`, etc." },
    "reason": {
      "type": "string",
      "anyOf": [
        { "enum": ["schema-violation", "truncation", "type-drift", "type-mismatch", "refusal", "parse-error", "unknown"] },
        { "pattern": "^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$" }
      ],
      "description": "Why the prior attempt failed. Spec-reserved values: `schema-violation` (model emitted wrong-shape JSON; corrective fragment + retry), `truncation` (stop_reason: max_tokens; budget-double + retry per RFC 0033), `type-drift` (the envelope's `type` discriminator drifted from what was advertised mid-run), `type-mismatch` (a typed payload field was emitted with the wrong runtime type — e.g., string where number was declared), `refusal` (provider safety-stop; NO retry — see §B.3), `parse-error` (response was not extractable as JSON even after lenient parsing), `unknown` (host could not classify). Host-private extensions MUST prefix with `x-host-<host>-` per `host-extensions.md` §\"Canonical-prefix table\"; conformance assertions ignore host-prefixed values when evaluating the closed-enum subset. The extension regex matches the precedent set by RFC 0031 §B for `requiredModelCapabilities` identifiers."
    },
    "previousError": {
      "type": ["string", "null"],
      "description": "Diagnostic text from the failing attempt. MUST NOT contain prompt or response substring excerpts; host SHOULD limit to validator output (e.g., \"required field 'steps' missing\")."
    }
  }
}
```

SHOULD because not every host implements retry; hosts that retry on validation failure SHOULD emit this event per attempt past the first.

#### §B.2 `envelope.retry.exhausted` (MUST)

Emitted when a host has exhausted its retry budget and is about to surface a terminal envelope failure to the node.

```json
"envelopeRetryExhausted": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "totalAttempts", "finalReason"],
  "properties": {
    "nodeId":        { "type": "string" },
    "totalAttempts": { "type": "integer", "minimum": 1 },
    "finalReason": {
      "type": "string",
      "anyOf": [
        { "enum": ["schema-violation", "truncation", "type-drift", "type-mismatch", "refusal", "parse-error", "unknown"] },
        { "pattern": "^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$" }
      ],
      "description": "Same value set as `envelope.retry.attempted.reason` (§B.1). Spec-reserved closed enum plus `x-host-<host>-` extensions."
    },
    "finalError": {
      "type": ["string", "null"],
      "description": "Diagnostic text from the final attempt. Same redaction discipline as `envelope.retry.attempted.previousError`."
    }
  }
}
```

MUST because the alternative — silent terminal failure with no event surface — leaves conformance suites unable to assert "the host correctly gave up after N attempts." Hosts that don't retry MUST still emit this event when an envelope attempt terminally fails (with `totalAttempts: 1`).

#### §B.3 `envelope.refusal` (MUST)

Emitted when the underlying LLM provider returns an explicit refusal (e.g., OpenAI `message.refusal`, Anthropic safety-stop, Gemini safety-block).

```json
"envelopeRefusal": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "provider", "model"],
  "properties": {
    "nodeId":   { "type": "string" },
    "provider": { "type": "string" },
    "model":    { "type": "string" },
    "refusalText": {
      "type": ["string", "null"],
      "description": "Provider-returned refusal message, if any. MUST be passed through the host's BYOK redaction harness before emission (per SECURITY invariant `envelope-refusal-no-prompt-leak`, §G)."
    },
    "safetyCategory": {
      "type": ["string", "null"],
      "description": "Provider-specific safety category if available (e.g., Anthropic `harmful-content`, Gemini `SAFETY_BLOCK_HARASSMENT`, OpenAI `policy_violation`). Verbatim from provider; no normalization."
    }
  }
}
```

MUST because refusal is a structurally distinct outcome from schema-violation, and conformance suites need to assert hosts do NOT retry on refusal (retrying refusal with prompt mutation creates a circumvention concern; see §"Unresolved questions" #2 and the SECURITY discussion in §G).

#### §B.4 `envelope.truncated` (SHOULD)

Emitted when the LLM emission was cut off before the envelope was complete (typically `stop_reason: "max_tokens"`).

```json
"envelopeTruncated": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "provider", "model", "stopReason"],
  "properties": {
    "nodeId":   { "type": "string" },
    "provider": { "type": "string" },
    "model":    { "type": "string" },
    "stopReason": {
      "type": "string",
      "enum": ["max_tokens", "length", "stop_sequence", "unknown"],
      "description": "Provider-normalized stop reason. `max_tokens` covers OpenAI `length` + Anthropic `max_tokens`; `length` is preserved as a separate value for hosts that distinguish provider-side `length` (model self-determined length cap) from `max_tokens` (host-side budget cap)."
    },
    "partialPayloadAvailable": {
      "type": "boolean",
      "default": false,
      "description": "True if the host recovered a partial envelope before truncation. Hosts MAY use this signal to route to a recovery path (e.g., re-emit with budget-doubled retry per RFC 0033)."
    },
    "outputTokenCount": {
      "type": ["integer", "null"],
      "minimum": 0,
      "description": "Tokens emitted before truncation. Sourced from provider response's usage block."
    }
  }
}
```

SHOULD because not every host distinguishes truncation from generic schema-violation; hosts that DO (RFC 0033's `distinguishesTruncation: true` capability) MUST emit this event when truncation occurs.

#### §B.5 `envelope.nlToFormat.engaged` (MAY)

Emitted when the host has escalated to a two-call NL-to-Format fallback after retry exhaustion (per Tam et al., arXiv 2408.02442 mitigation strategy: free-form reasoning in first call → schema coercion in second call).

```json
"envelopeNlToFormatEngaged": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "originalEnvelopeType"],
  "properties": {
    "nodeId":              { "type": "string" },
    "originalEnvelopeType": { "type": "string", "description": "The envelope kind the original attempt was trying to emit." },
    "fallbackCalls": {
      "type": "integer",
      "minimum": 1,
      "default": 1,
      "description": "Number of secondary LLM calls used to reformat free-form output into the envelope's schema."
    }
  }
}
```

MAY because NL-to-Format is one of many possible recovery strategies; hosts that don't implement it don't need to advertise the event.

#### §B.6 `envelope.recovery.applied` (MAY)

Emitted when lenient parsing recovered a malformed envelope (e.g., JSON repair via `jsonrepair`, markdown fence stripping, last-balanced-object extraction).

```json
"envelopeRecoveryApplied": {
  "type": "object",
  "additionalProperties": false,
  "required": ["nodeId", "path"],
  "properties": {
    "nodeId": { "type": "string" },
    "path": {
      "type": "string",
      "enum": ["direct", "jsonrepair", "markdown-fence", "brace-walker", "custom"],
      "description": "Which recovery path succeeded. `direct` is reserved for the no-recovery-needed path and is informational; hosts MAY omit emission when `path: \"direct\"`."
    },
    "byteOffset": {
      "type": ["integer", "null"],
      "minimum": 0,
      "description": "Byte position where recovery succeeded. Useful for debugging which fraction of the model's output was salvageable."
    }
  }
}
```

MAY because lenient parsing is a host-discretion recovery path; some hosts deliberately refuse to apply recovery (preferring to retry with stricter system-prompt guidance). The event surfaces *which* recovery path was applied without normating *whether* recovery is allowed.

### §C — Capability advertisement

`schemas/capabilities.schema.json` extends the `envelopes` block introduced in RFC 0030 §C with an optional `reliability` sub-block:

```diff
   "envelopes": {
     "properties": {
       "reasoning": { ... },
       "tierOneSubsetCompliance": { ... },
+      "reliability": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": ["supported"],
+        "properties": {
+          "supported": {
+            "type": "boolean",
+            "description": "Host emits the RFC 0032 envelope-reliability event family on the documented adverse paths."
+          },
+          "events": {
+            "type": "array",
+            "items": {
+              "type": "string",
+              "enum": [
+                "envelope.retry.attempted",
+                "envelope.retry.exhausted",
+                "envelope.refusal",
+                "envelope.truncated",
+                "envelope.nlToFormat.engaged",
+                "envelope.recovery.applied"
+              ]
+            },
+            "uniqueItems": true,
+            "description": "Subset of the six reliability events the host actually emits. Hosts that advertise `supported: true` MUST include `envelope.retry.exhausted` and `envelope.refusal` (the two MUST events per §B). Conformance scenarios soft-skip for events absent from this list (assertions that the host emits the event are skipped; assertions about other host behavior remain in force)."
+          },
+          "maxRetryAttempts": {
+            "type": "integer",
+            "minimum": 1,
+            "maximum": 16,
+            "description": "Host's retry budget per envelope emission. Conformance scenarios use this to construct fixtures that exercise the retry-exhausted path."
+          }
+        }
+      }
     }
   }
```

### §D — Trust boundary + replay

#### Trust boundary

The six events fire during envelope emission, after the host has already validated trust posture per `ai-envelope.md` §"Trust boundary." Event payloads carry diagnostic strings (`previousError`, `refusalText`, etc.) that MUST be passed through the same SR-1 redaction harness applied to envelope payloads — the model can hallucinate secret-shaped substrings even into error messages.

The `envelope.refusal.refusalText` field is particularly load-bearing: provider safety-refusal messages can echo back the offending prompt content. Hosts MUST redact `refusalText` against the BYOK secret set + apply prompt-content redaction if the host's policy is to not leak the offending prompt material. The SECURITY invariant in §G enforces this.

#### Replay

All six events are durable and participate in replay per `spec/v1/replay.md` semantics. Replay invariants:

- `envelope.retry.exhausted.totalAttempts` MUST replay identically — the original retry count is part of the durable trace.
- `envelope.refusal.refusalText` MAY replay differently if the host's redaction policy changed between runs (host MAY redact more aggressively on replay than on original emission). Replay consumers MUST tolerate `refusalText: null` even when the original was non-null.
- `envelope.truncated.outputTokenCount` MUST replay identically.
- `envelope.recovery.applied.path` MUST replay identically (same input → same recovery outcome under deterministic parsing).

Divergence of `totalAttempts` or `path` MUST emit `replay.diverged` with `divergencePoint` set to the verbatim `RunEventType` string of the diverging event (e.g., `"envelope.retry.exhausted"` or `"envelope.recovery.applied"`). The `divergencePoint` field is the new optional string added to the `replayDiverged` `$def` by RFC 0027 §F; this RFC consumes the field rather than redefining it. The schema diff lands once in RFC 0027 (and is cited by RFCs 0029 and 0032).

### §E — OTel projection (RECOMMENDED)

Hosts that emit the reliability events SHOULD also project them into the existing OTel attribute group on the corresponding span (same posture as RFC 0026 §C):

| Event | OTel attribute group |
|---|---|
| `envelope.retry.attempted` | `openwop.envelope.retry.{attempt, reason}` |
| `envelope.retry.exhausted` | `openwop.envelope.retry.{total_attempts, final_reason}` |
| `envelope.refusal` | `openwop.envelope.refusal.{safety_category}` (refusalText omitted from OTel — see §G SECURITY) |
| `envelope.truncated` | `openwop.envelope.truncated.{stop_reason, output_token_count}` |
| `envelope.nlToFormat.engaged` | `openwop.envelope.nl_to_format.{fallback_calls}` |
| `envelope.recovery.applied` | `openwop.envelope.recovery.{path, byte_offset}` |

The event log is the load-bearing surface (for replay determinism + subscribers); OTel is supplementary.

### §F — Interaction with RFC 0021's Production flow

`ai-envelope.md` §"Production flow" describes the validation pipeline. The reliability events emit at specific points in that flow:

```
Parser → extract envelope document
  │
  ├── parse failure
  │     ├── recovery path attempted → envelope.recovery.applied (success) OR envelope.retry.attempted (fail+retry)
  │     └── unrecoverable → envelope.retry.exhausted (with finalReason: 'parse-error')
  │
  ▼
Shape validation
  ├── fail → envelope.retry.attempted (if retry budget remains) OR envelope.retry.exhausted (otherwise)
  └── ok
  ▼
Kind / payload / contract / limits / redaction / trust / dedup → handler
  │
  └── provider-level refusal at any point → envelope.refusal (terminal, NO retry)
  │
  └── stop_reason: max_tokens → envelope.truncated → optional retry with budget doubling per RFC 0033
  │
  └── retry-exhaustion fallback → envelope.nlToFormat.engaged (if host advertises NL-to-Format)
```

The Production flow pseudocode in `ai-envelope.md` SHOULD be amended (non-normatively) to surface these emission points in a follow-up doc-prose pass; spec-prose for the points-of-emission lives in `spec/v1/observability.md` §"Envelope-reliability events" (NEW).

### §G — SECURITY invariants

Two new entries in `SECURITY/invariants.yaml`. Gate timing matches RFC 0027 §G precedent: invariants land alongside reference-host implementation, not at Draft merge.

```yaml
- id: envelope-refusal-no-prompt-leak
  tier: protocol
  severity: high
  threat_model: SECURITY/threat-model-prompt-injection.md
  tests:
    - conformance/src/scenarios/envelope-refusal-shape.test.ts
  note: |
    RFC 0032 §B.3 + §D: `envelope.refusal.refusalText` MUST be passed through
    the host's BYOK redaction harness AND the prompt-content redaction pipeline
    before emission. Provider safety-refusal messages can echo offending prompt
    substrings; emitting them verbatim would create a side channel for
    prompt-injection-attack telemetry exfiltration AND for SR-1 secret-leak.

- id: envelope-recovery-no-content-leak
  tier: protocol
  severity: high
  threat_model: SECURITY/threat-model-secret-leakage.md
  tests:
    - conformance/src/scenarios/envelope-recovery-shape.test.ts
  note: |
    RFC 0032 §B.6 + §D: `envelope.recovery.applied` MUST NOT carry the
    recovered envelope content or any substring from the model's pre-recovery
    output. Only the recovery path identifier (`direct`, `jsonrepair`,
    `markdown-fence`, `brace-walker`, `custom`) and the optional `byteOffset`
    are emitted. The recovered content rides on the subsequent envelope
    acceptance + downstream RunEventDoc, NOT on the recovery event itself.
```

## Compatibility

**Additive per `COMPATIBILITY.md §2.1 + §4`.** All claims:

- Existing required fields: unchanged.
- Existing optional fields: unchanged.
- Existing event types: shape unchanged (`envelope.*` are NEW enum entries; existing types' schemas are untouched).
- Existing endpoints: contract unchanged.
- Existing MUST requirements: **clarified, not relaxed.** §A clarifies the scope of the FINAL-v1.1 `ai-envelope.md` line-448 MUST NOT. Per `COMPATIBILITY.md §4` row "New normative requirement on a previously-undefined behavior" — the *scope* of "envelope-specific events" was previously undefined; this RFC defines it without relaxing the per-kind prohibition. Per-kind events remain forbidden after this RFC; the new vocabulary is exclusively cross-kind operational.
- Existing error codes: unchanged.

Hosts that don't advertise `capabilities.envelopes.reliability.supported: true` see no behavioral change; the new event types appear in the enum but the host doesn't emit them. Consumers iterating events by type-string handle unknown types gracefully (existing forward-compat per `run-event.schema.json` line 64).

The two MUST events (`envelope.retry.exhausted`, `envelope.refusal`) tighten conformance for hosts that DO advertise the capability. A v1.1 host that wants to remain on the old surface keeps `capabilities.envelopes.reliability` absent; a v1.1 host that wants the new conformance gates advertises the capability and adds the two MUST emissions. Soak window: one release cycle, matching the RFC 0026 / RFC 0027 precedent for MUST events introduced under additive capability flags.

## Conformance

Six new scenarios under `conformance/src/scenarios/`. All gated as noted.

- `envelope-retry-attempted.test.ts` — gated on `capabilities.envelopes.reliability.supported: true` AND `events[]` includes `envelope.retry.attempted` AND the test seam `POST /v1/host/sample/test/simulate-envelope-retry`. Drives a synthetic scenario where the mock LLM emits an invalid envelope on attempt 1 + valid on attempt 2. Asserts: (a) exactly one `envelope.retry.attempted` event fires before the second attempt; (b) `attempt: 2`, `reason: "schema-violation"`; (c) eventual success is recorded normally.

- `envelope-retry-exhausted.test.ts` — gated on `capabilities.envelopes.reliability.supported: true`. Drives a synthetic scenario where the mock LLM emits invalid envelopes for `maxRetryAttempts + 1` attempts. Asserts: (a) exactly one `envelope.retry.exhausted` event fires with `totalAttempts` matching the host's advertised cap; (b) `finalReason` is correctly set; (c) `RunSnapshot.error.code` is appropriate. MUST event scenario — non-skippable when the capability is advertised.

- `envelope-refusal-shape.test.ts` — gated on `capabilities.envelopes.reliability.supported: true`. Drives a synthetic scenario where the mock LLM emits a provider refusal (mock provider's `mockRefusal` config). Asserts: (a) exactly one `envelope.refusal` event fires; (b) the host does NOT retry (no `envelope.retry.attempted` event after the refusal); (c) `refusalText` does NOT contain the offending prompt's secret-flagged substring (SECURITY invariant `envelope-refusal-no-prompt-leak`). MUST event scenario.

- `envelope-truncated.test.ts` — gated on `capabilities.envelopes.reliability.supported: true` AND `events[]` includes `envelope.truncated`. Drives a synthetic scenario where the mock LLM stops at `max_tokens` mid-envelope. Asserts: (a) exactly one `envelope.truncated` event fires with `stopReason: "max_tokens"`; (b) the host retries with doubled budget (NOT corrective fragment) per RFC 0033's coupling; (c) `outputTokenCount` is populated.

- `envelope-nl-to-format-engaged.test.ts` — gated on `capabilities.envelopes.reliability.supported: true` AND `events[]` includes `envelope.nlToFormat.engaged`. Optional scenario; skips cleanly on hosts that don't implement NL-to-Format. Drives a scenario where retry exhaustion triggers the fallback. Asserts the event fires with `originalEnvelopeType` set.

- `envelope-recovery-applied.test.ts` — gated on `capabilities.envelopes.reliability.supported: true` AND `events[]` includes `envelope.recovery.applied`. Drives a scenario where the mock LLM emits an envelope wrapped in a markdown fence. Asserts: (a) the event fires with `path: "markdown-fence"`; (b) the event payload contains NO substring of the model's pre-recovery output (SECURITY invariant `envelope-recovery-no-content-leak`); (c) the recovered envelope is subsequently accepted and the downstream RunEventDoc carries the recovered content.

The `behaviorGate` helper gains predicates: `requireEnvelopeReliability()`, `requireEnvelopeReliabilityEvent(eventName)`.

## Alternatives considered

1. **Encode the six events as `log.appended { code: "envelope.retry.attempted", payload: {...} }` etc.** (Option A from the analysis.) Rejected — `log.appended` is debug-stream-only per `observability.md §"Structured-log metric records"` and not durably persisted for replay. Conformance assertions become brittle string-match on `code`. The precedent of RFC 0026 (`provider.usage`) and RFC 0027 (`prompt.composed`) extending `RunEventType` directly is structurally correct and analogous; this RFC follows the same path.

2. **New first-class document with a parallel `EnvelopeReliabilityEvent` enum independent of `RunEventType`.** (Option C from the analysis.) Rejected — doubles the consumer surface (SDKs, webhook subscribers, stream-modes all have to learn a second event family). Inconsistent with `provider.usage` and `prompt.composed`, both of which extended `RunEventType` without trouble. The line-448 scope clarification (§A) lets us follow the same path without introducing a second event family.

3. **Drop the SHOULD/MAY events; ship only the two MUSTs (`envelope.retry.exhausted`, `envelope.refusal`).** Rejected — the SHOULD/MAY events are the load-bearing observability surface for adverse paths. Without `envelope.retry.attempted`, conformance can't gate "did the host retry correctly between attempts"; without `envelope.truncated`, RFC 0033's truncation-vs-schema-violation distinction has no event surface. The capability-flag pattern (advertise which events you actually emit) lets hosts opt in selectively without spec-text bloat.

4. **Make all six events MUST.** Rejected — `envelope.nlToFormat.engaged` and `envelope.recovery.applied` are tied to specific recovery strategies (Tam-et-al fallback, lenient parsing) that not every host chooses to implement. Forcing them to MUST means hosts that prefer strict-only would have to emit "I never fall back" events on every attempt, which is pure noise.

5. **Drop the §A line-448 scope clarification and rely on implicit precedent (RFCs 0026/0027 shipped under the same interpretation).** Rejected — implicit precedent is fragile. A future reviewer reading line 448 literally could refuse to land RFC 0032's events. Explicit §A makes the precedent permanent and removes the ambiguity for future RFCs that need to extend `RunEventType` (RFC 0031, RFC 0033, future RFCs).

## Unresolved questions

1. **Refusal handling — terminal vs recoverable.** §B.3 doesn't mandate post-refusal behavior beyond "no retry by the host." Should the spec mandate `MUST treat refusal as terminal`, or `MAY retry with adjusted prompt`? Recommendation: **MUST terminal** for safety reasons — safety refusals retried with prompt mutation create a circumvention concern (the host is automatically searching for a prompt the model will accept, which evades the safety filter's intent). Documented as a MUST in §B.3 normative text; reviewers may push back.

2. **Truncation retry multiplier.** RFC 0033 will normate "MAY retry with increased output budget"; should this RFC's `envelope.truncated.partialPayloadAvailable` semantics include a recommended retry multiplier (2×, 4×)? Recommendation: leave to host; document the 2× heuristic in an informative note in RFC 0033, not here. RFC 0032 ships the event; RFC 0033 ships the retry semantics.

3. **Replay determinism of `refusalText`.** §D allows `refusalText: null` on replay even when the original was non-null. Should the spec instead require that hosts cache the original `refusalText` (post-redaction) so replay reproduces the original event verbatim? Recommendation: SHOULD-tolerate the variability — host redaction policies legitimately tighten over time, and forcing replay determinism on a free-text field that may carry sensitive content is the wrong trade-off. Spec gap acknowledgment for review.

4. **Conformance fixture replay across spec versions.** The six new events are gated on `capabilities.envelopes.reliability.supported`. Should conformance fixtures be tagged with the minimum spec version they exercise (`v1.2.0+`) so v1.1 hosts can selectively run compatible fixtures? Recommendation: yes — aligns with how the spec versions itself and matches the proposal's §10.5 recommendation. Tag fixtures via filename suffix (`*.v1.2+.test.ts`) or via a `behaviorGate` predicate `requireSpecMinVersion("1.2")`.

5. **OTel projection of `envelope.refusal.refusalText`.** §E says `refusalText` is omitted from OTel — but some operators want refusal text in their dashboards for incident response. Should the spec offer a `capabilities.envelopes.reliability.otelIncludesRefusalText: boolean` opt-in? Recommendation: no — operators who want refusal text in OTel can hook the event-log emission into their own telemetry pipeline, where they own the redaction policy. The spec defaults to private; opt-in plumbing is operator-config, not protocol surface.

## Implementation notes (non-normative)

- Reference host `apps/workflow-engine/backend/typescript`:
  - Extend `executor/executor.ts` (or a new `executor/envelopeReliability.ts` helper) to detect adverse-path conditions and call `eventLog.append("envelope.<event>", payload)` at the appropriate emission points described in §F.
  - The host's existing envelope-validation pipeline already distinguishes parse-failure / shape-violation / payload-invalid / refused-by-provider; this RFC's events ride that existing distinction.
  - For `envelope.truncated`, hook into the provider response's `stop_reason` inspection in `aiProviders/aiProvidersHost.ts` (the same surface RFC 0026's `provider.usage` already reads).
  - For `envelope.recovery.applied`, the existing JSON-extraction helper in `executor/envelopeExtract.ts` gains a return-value indicating which recovery path fired.
- The mock provider in `apps/workflow-engine/backend/typescript/src/aiProviders/mock/` gains four new mock modes: `mockRetry`, `mockExhausted`, `mockRefusal`, `mockTruncated`. Reuses the existing mock-provider config shape (`schemas/core-conformance-mock-agent-config.schema.json`).
- Conformance fixture engineering: ~0.5 day per scenario × 6 = ~3 days. Higher than RFC 0030/0031 because each fixture requires a mock-LLM scenario with specific adverse-path behavior.
- Estimated total effort: schemas + spec-text amendments ~1.5 days; reference-host emission wiring ~2 days; mock-provider modes ~0.5 day; six conformance scenarios ~3 days; CHANGELOG + INTEROP-MATRIX + observability.md prose ~1 day. Total ~8 days plus the standard Active window unless the bootstrap-phase waiver applies.

## Acceptance criteria

Promotion from `Active` → `Accepted`:

- [ ] `spec/v1/ai-envelope.md` line 448 prose clarified per §A; the clarified text quotes the original verbatim and explains why the change is scope-clarification, not MUST-relaxation.
- [ ] `spec/v1/ai-envelope.md` extended with §"Envelope-reliability events" cross-referencing this RFC.
- [ ] `spec/v1/observability.md` extended with §"Envelope-reliability events" describing the six events + OTel projection per §E.
- [ ] `schemas/run-event.schema.json` adds the six entries to `RunEventType`.
- [ ] `schemas/run-event-payloads.schema.json` adds the six `$defs` and `_typeIndex` entries per §B.
- [ ] `schemas/capabilities.schema.json` `envelopes` block extended with `reliability` per §C.
- [ ] `api/asyncapi.yaml` adds six channels (one per event) bound to the new payload schemas.
- [ ] `SECURITY/invariants.yaml` gains `envelope-refusal-no-prompt-leak` and `envelope-recovery-no-content-leak` per §G (gate timing: lands alongside reference-host implementation, per RFC 0027 §G precedent).
- [ ] Six new conformance scenarios per §"Conformance" land in `@openwop/openwop-conformance`; suite minor-version bumps.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] `INTEROP-MATRIX.md` extended with a row family for `capabilities.envelopes.reliability.{supported, events[], maxRetryAttempts}`.
- [ ] Reference host (`apps/workflow-engine/backend/typescript`) advertises `capabilities.envelopes.reliability.supported: true` with at least the two MUST events in `events[]`, implements emission, passes all six conformance scenarios (the four non-MUST scenarios may soft-skip on hosts that omit those events from `events[]`).
- [ ] First non-steward host advertises `capabilities.envelopes.reliability.supported: true` (third-party validation gate per RFC 0001). MAY be waived under bootstrap-phase waiver.

## References

- `spec/v1/ai-envelope.md` (RFC 0021) — line 448 prose that §A clarifies.
- `RFCS/0021-ai-envelope-primitive.md` — envelope wire shape + Production flow this RFC layers reliability events onto.
- `RFCS/0026-provider-usage-event.md` — precedent for adding cross-kind operational events to `RunEventType`. Same additive pattern; same SR-1 redaction posture for event payloads.
- `RFCS/0027-prompt-templates.md` — second precedent for cross-kind operational `RunEventType` extension (`prompt.composed`).
- `RFCS/0030-envelope-reasoning-and-tier-one-subset.md` — envelope `reasoning` field; consumes output tokens that can drive `envelope.truncated` rates.
- `RFCS/0031-envelope-variants-and-model-capabilities.md` — `model.capability.{substituted,insufficient}` events; same line-448-scope reasoning, formalized here.
- `RFCS/0033-envelope-completion-contract.md` (forthcoming) — depends on this RFC's `envelope.truncated` event for the truncation-vs-schema-violation distinction.
- `spec/v1/replay.md` — replay semantics this RFC extends with new divergence points.
- `spec/v1/observability.md` — OTel attribute group conventions this RFC extends.
- `SECURITY/threat-model-prompt-injection.md` — informs `envelope.refusal.refusalText` redaction discipline.
- `SECURITY/threat-model-secret-leakage.md` SR-1 — redaction harness this RFC's invariants plug into.
- Tam et al., "Let Me Speak Freely?" — https://arxiv.org/pdf/2408.02442 (mitigation strategy for `envelope.nlToFormat.engaged`).
- Instructor (retry-on-validation-error loop pattern) — https://github.com/jxnl/instructor
- Pydantic AI retry semantics — https://pydantic.dev/docs/ai/core-concepts/output/
- jsonrepair (JavaScript) — https://github.com/josdejong/jsonrepair (`envelope.recovery.applied.path: "jsonrepair"`)

## Status history

### Draft → Active (2026-05-20)

Promoted under the bootstrap-phase steward waiver per the RFC 0021–0031 precedent. Spec text + wire-shape locked, INCLUDING the central §A line-448 scope clarification ("envelope-specific" = per-envelope-kind, not cross-kind operational; per-kind events remain forbidden after the clarification). Conformance scenarios + SECURITY invariants + reference-host emission remain as the path to `Accepted`.

Evidence at promotion:

- **Spec text:**
  - `spec/v1/ai-envelope.md` line-448 prose CLARIFIED per §A. The original FINAL-v1.1 text was: *"Hosts MUST NOT extend the `RunEventType` enum to add envelope-specific events; the envelope's identity rides on `causationId`, not on a parallel event-type surface."* The clarified text scopes "envelope-specific events" to **per-envelope-kind routing events** (one event mirroring each envelope kind, creating a parallel routing surface) — those remain FORBIDDEN. **Cross-kind operational events** (retry, refusal, truncation, capability substitution, prompt composition, provider usage) are PERMITTED via RFC. Lists the consuming RFCs (0026, 0027, 0029, 0031, 0032) so the precedent is permanent and future RFCs that extend `RunEventType` for operational concerns don't get blocked. Classified as `additive` per `COMPATIBILITY.md §4` row "New normative requirement on a previously-undefined behavior" (the *scope* of "envelope-specific" was previously undefined; this RFC defines it). NOT a MUST relaxation — per-kind events remain forbidden.
  - `spec/v1/ai-envelope.md` extended with §"Envelope-reliability events" between §"Run event log integration" and §"Wire serialization". Documents the six events + tier (MUST/SHOULD/MAY) per §B; capability-handshake example; `reason` enum extensibility (closed enum + `x-host-*` pattern); trust-boundary + redaction discipline; replay determinism (which fields replay identically, which MAY differ); OTel projection summary cross-referencing `observability.md`.
  - `spec/v1/observability.md` extended with §"Envelope-reliability events (RFC 0032)" between §"Provider usage events (RFC 0026)" and §"Open spec gaps". Documents the OTel attribute mapping per event; the `envelope.refusal.refusalText` exclusion from OTel by default (private side channel — operators plumb through their own pipeline); the two SECURITY invariants (`envelope-refusal-no-prompt-leak`, `envelope-recovery-no-content-leak`) with their gate timing. Bonus: extended with §"Envelope-completion retry routing (RFC 0033)" recording RFC 0033's truncation-vs-schema-violation distinction for cross-reference.
- **Schemas additive (no MUST relaxed; line-448 prose clarified, not relaxed):**
  - `schemas/run-event.schema.json` — `RunEventType` enum gains six entries (`envelope.retry.attempted`, `envelope.retry.exhausted`, `envelope.refusal`, `envelope.truncated`, `envelope.nlToFormat.engaged`, `envelope.recovery.applied`) clustered with the existing cross-kind operational events (after `model.capability.insufficient` per RFC 0031, before `agent.toolCalled`).
  - `schemas/run-event-payloads.schema.json` — `_typeIndex` gets six new entries; six new `$defs` ship with full payload contracts. The `reason` enum on `envelopeRetryAttempted` and `finalReason` on `envelopeRetryExhausted` use `anyOf [closed enum, x-host-* pattern]` for the closed-enum + extension surface per RFC 0032 §B.1 + the MyndHyve `type-mismatch` distinction. `envelopeRefusal.refusalText` documents SR-1 + prompt-content double-redaction with `null`-on-replay-tolerance. `envelopeRecoveryApplied` documents the no-content-leak invariant (only path + byteOffset; never pre-recovery substrings). The schema description's variant count bumped 55 → 61 (53 baseline + 2 RFC 0031 + 6 RFC 0032).
  - `schemas/capabilities.schema.json` — `envelopes.reliability` sub-block lands inside the RFC-0030 `envelopes` container. Required `supported: boolean`; optional `events: string[]` (closed enum of the six event names — hosts list only what they actually emit); `maxRetryAttempts: 1..16`; `completion: { distinguishesTruncation, truncationBudgetMultiplier? }` (the RFC 0033 sub-block lands here as part of the same envelope-track structure since 0033 depends on 0032's event vocabulary).

**`api/asyncapi.yaml` deferred.** The original RFC §"Affects" line listed `api/asyncapi.yaml (adds 6 channels)`. Skipped in the Phase-1 batch to match the RFC 0026 / RFC 0027 / RFC 0029 precedent — those Active RFCs ship `RunEventType` extensions without per-event AsyncAPI message definitions, relying on the catch-all `AnyRunEvent` message for the debug-stream surface. The named-message asyncapi entries are decorative for canonical lifecycle events (`RunStarted`, `NodeDispatched`, etc.); event-log subscribers receive the new event types through the existing channels regardless. If a future RFC tightens AsyncAPI to require per-event messages for every `RunEventType` enum entry, this RFC's events join the family in the same batch.

Path to `Active → Accepted`: requires the reference workflow-engine to (a) advertise `capabilities.envelopes.reliability.supported: true` with at least the two MUST-tier events in `events[]`, (b) implement emission via `executor/envelopeReliability.ts` (or equivalent) hooked into the existing envelope-validation pipeline at the documented emission points (parse failure / shape validation / payload validation / provider refusal / stop-reason inspection / recovery path identification), (c) ship the six conformance scenarios from §"Conformance" — the four non-MUST scenarios may soft-skip on hosts that omit those events from `events[]`, and (d) ship the two SECURITY invariants (`envelope-refusal-no-prompt-leak`, `envelope-recovery-no-content-leak`) alongside the matching conformance assertions. Alternatively, a non-steward host advertising the capability closes the third-party validation gate per the RFC 0021 / RFC 0026 precedent.

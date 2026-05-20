# RFC 0030: Envelope `reasoning` field + Tier 1 Structured-Output Subset (informative)

| Field | Value |
|---|---|
| **RFC** | 0030 |
| **Title** | Optional `reasoning` field on envelope payload schemas; informative Tier-1 cross-vendor structured-output compatibility subset |
| **Status** | `Active` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-20 |
| **Updated** | 2026-05-20 (Draft → Active — see [Status history](#status-history) below). |
| **Affects** | `spec/v1/ai-envelope.md` (adds §"Reasoning field (normative)" + §"Tier 1 Structured-Output Compatibility Subset (informative)") · `spec/v1/structured-output-subset.md` (NEW, informative) · `schemas/capabilities.schema.json` (adds optional `envelopes.reasoning` and `envelopes.tierOneSubsetCompliance` fields) · `SECURITY/invariants.yaml` (adds `envelope-reasoning-secret-redaction`) · 3 new conformance scenarios · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |

## Summary

Adds two complementary, additive surfaces to the AI Envelope spec (RFC 0021). First, every envelope payload schema defined by the spec — and any vendor-namespaced kind that requires multi-step reasoning to populate — SHALL support an OPTIONAL `reasoning` field of type `string`. The field is informational, never used for routing, and gives the model a place to put chain-of-thought *inside* the structured output so strict-JSON output mode doesn't collapse reasoning quality (per Tam et al., arXiv 2408.02442). Second, an informative companion document `spec/v1/structured-output-subset.md` documents the intersection of JSON-Schema features supported by OpenAI strict mode, Anthropic strict tool use, and Google Gemini `responseSchema`, so canvas-type authors writing new envelope payload schemas have a single reference for "what schema features are safe for cross-vendor portability."

## Motivation

Two empirical gaps in the current envelope surface:

### 2.1 Strict-JSON output without an in-payload reasoning slot degrades reasoning quality

Tam et al. (*"Let Me Speak Freely? A Study on the Impact of Format Restrictions on the Performance of Large Language Models"* — arXiv 2408.02442) found that forcing models into strict-JSON output without a free reasoning field can materially degrade reasoning quality (GPT-3.5-Turbo on Last Letter task: 56.7% → 1.78%; GSM8K: 75.99% → 49.25%). JSONSchemaBench (arXiv 2501.10868) found constrained decoding *helps* quality — but only when the schema permits a free reasoning slot. The two findings reconcile: schema constraints help *format*, hurt *reasoning* unless reasoning is given an in-schema escape valve.

The current envelope spec mandates strict payload-schema validation (`ai-envelope.md` §"Schema discipline") with no normative reasoning slot. Hosts adopting strict-output mode (Anthropic strict tool use, OpenAI structured outputs, Gemini `responseSchema`) are systematically degrading the model's reasoning quality on multi-step-reasoning envelope kinds (PRD generation, plan generation, design-system synthesis, persona research, etc.). This is a protocol-level concern, not a host-implementation choice.

### 2.2 Cross-vendor strict-mode subset is poorly understood

Each LLM vendor enforces a different JSON-Schema subset for native structured output:

| Feature | OpenAI strict | Anthropic strict | Gemini responseSchema |
|---|---|---|---|
| `additionalProperties: false` required on every object | YES | YES | Accepted (Nov 2025+) |
| `oneOf` | NO | NO | NO (silently dropped) |
| `anyOf` inside properties | YES | YES | YES (Nov 2025+) |
| `minLength`/`maxLength`/`pattern`/`format` | NO | NO | YES (Gemini 2.5+) |
| `minimum`/`maximum`/`multipleOf` | NO | NO | YES (Gemini 2.5+) |
| `prefixItems` | NO | NO | YES |
| Recursive `$ref` | YES (`$defs`) | NO | YES (Nov 2025+) |
| `propertyNames` | Unsupported | Unsupported | Silently dropped |
| Max nesting depth (OpenAI strict) | 5 levels | — | — |

The intersection of all three is what an envelope payload schema MUST satisfy to be Tier-1-portable across hosts. Vendor docs don't enumerate this intersection; every host re-discovers it through production 400 responses. Worse, Gemini's "unsupported keywords are silently dropped" posture (per `docs.cloud.google.com/vertex-ai/...`) means host-side schemas can be stricter than what Gemini actually enforced — a silent correctness bug.

This RFC documents the intersection in an informative appendix so canvas-type authors have a single reference. The appendix is *informative*, not normative — the protocol cannot mandate vendor behavior, only document it as of the spec ratification date.

## Proposal

### §A — `reasoning` field on envelope payload schemas (normative)

Add a new §"Reasoning field (normative)" to `spec/v1/ai-envelope.md` between §"Universal kinds (normative)" and §"Vendor-namespaced kinds":

> Every envelope payload schema defined by this specification SHALL support an OPTIONAL `reasoning` field of type `string`. The field SHOULD appear as the first property in `propertyOrdering` when the underlying schema dialect supports ordering hints (e.g., Gemini's `responseSchema`).
>
> When emitting an envelope whose payload schema permits `reasoning`, a host SHOULD include a model instruction directing the model to populate `reasoning` with its analytical process before emitting the structured fields. Hosts MUST NOT reject envelopes where `reasoning` is absent — the field is OPTIONAL.
>
> Hosts MAY surface `reasoning` contents to end users via debug panels, audit logs, or run telemetry; hosts MAY persist `reasoning` alongside the canonical envelope payload. Hosts SHALL NOT route on `reasoning` contents — the field is informational, not control-flow-bearing.
>
> Hosts that opt in to advertise the convention via `capabilities.envelopes.reasoning.supported: true` (see §C) signal to clients that envelope schemas served by the host follow this convention; clients MAY skip the schema-check for the field's presence on such hosts.

#### Universal-kind schemas

The four universal-kind payload schemas published under `schemas/envelopes/` gain `reasoning` as an OPTIONAL property:

| Schema | `reasoning` posture |
|---|---|
| `clarification.request.schema.json` | OPTIONAL — useful when the model wants to explain *why* it's asking |
| `schema.request.schema.json` | OPTIONAL — useful when the model is asking the host to verify a kind it's uncertain about |
| `schema.response.schema.json` | OMITTED — side-channel ack; no reasoning needed |
| `error.schema.json` | OPTIONAL — useful when the model is explaining *why* it could not produce the requested envelope |

Per-schema diff (illustrative for `clarification.request.schema.json`):

```diff
   "type": "object",
   "additionalProperties": false,
   "required": ["questions"],
   "properties": {
+    "reasoning": {
+      "type": "string",
+      "description": "OPTIONAL chain-of-thought field per RFC 0030 §A. Hosts SHOULD prompt the model to populate this with its analytical process before emitting the structured fields. Not used for routing; not surfaced to end users unless the host opts in via debug/audit surfaces."
+    },
     "questions": { ... }
   }
```

#### Vendor-namespaced kinds

For vendor-namespaced kinds (`vendor.<host>.<kind>`), the RFC's normative SHALL applies: a vendor-kind payload schema that requires multi-step reasoning to populate SHOULD include `reasoning` as an OPTIONAL first property. Examples where reasoning materially improves output quality:

- PRD generation (multi-feature dependency analysis)
- Plan generation (task-ordering reasoning)
- Design-system synthesis (color-contrast + typography-hierarchy rationale)
- App architecture (screen-flow + navigation reasoning)
- Persona derivation (research synthesis)
- Brand competitive analysis
- Component-library composition (atomic-design rationale)
- Feature-dependency-graph breakdown

Vendor kinds that are low-reasoning signal/data envelopes (`screen.emit`, `status.progress`, `ask.clarify`, `chunk.emit`) MAY omit `reasoning`.

### §B — Tier 1 Structured-Output Compatibility Subset (informative)

New sibling document `spec/v1/structured-output-subset.md` carries the informative appendix:

> **Status: INFORMATIVE.** This document records the intersection of JSON-Schema features supported by the three vendor structured-output modes that OpenWOP-conformant hosts route to as of the RFC 0030 ratification date:
>
> - OpenAI strict mode (`response_format: { type: 'json_schema', json_schema: { strict: true } }` and strict tool calling) — last verified 2026-05
> - Anthropic strict tool use (`strict: true` on `input_schema`) and `output_config.format` — last verified 2026-05
> - Google Gemini `responseSchema` on `generateContent` — last verified 2026-05
>
> Envelope payload schemas defined by this specification SHOULD restrict themselves to features in the intersection. Canvas-type authors authoring custom vendor-namespaced envelope types SHOULD reference this document when designing payload shapes.
>
> The intersection is informative because vendor behavior evolves. This document carries a "last verified" annotation per vendor; readers MUST cross-check against current vendor docs before treating any row as authoritative.

The document body contains the intersection table from §2.2 above plus the strict-mode optional-field emulation pattern from §D below, plus per-vendor citation links. (Full doc text in `spec/v1/structured-output-subset.md`; the table is the load-bearing element.)

### §C — Capability advertisement (additive)

`schemas/capabilities.schema.json` gains one new optional top-level block:

```diff
   "properties": {
     "protocolVersion": { ... },
     "supportedEnvelopes": { ... },
     "schemaVersions": { ... },
     "limits": { ... },
+    "envelopes": {
+      "type": "object",
+      "additionalProperties": true,
+      "description": "Container for envelope-related capability advertisements introduced by RFC 0030+ (the envelope LLM-contract-hardening track). Hosts MAY extend with `x-host-<host>-<key>` per `host-extensions.md`.",
+      "properties": {
+        "reasoning": {
+          "type": "object",
+          "additionalProperties": false,
+          "required": ["supported"],
+          "properties": {
+            "supported": { "type": "boolean", "description": "Host's envelope payload schemas follow the RFC 0030 §A convention: `reasoning` is OPTIONAL where reasoning materially improves output quality; hosts prompt the model to populate it." },
+            "promptDirective": { "type": "string", "enum": ["mandatory", "advisory", "off"], "description": "Whether the host's system-prompt injection forces the model to populate `reasoning` (`mandatory`), only suggests it (`advisory`), or omits the directive (`off`). Defaults to `advisory` when absent." }
+          }
+        },
+        "tierOneSubsetCompliance": {
+          "type": "string",
+          "enum": ["strict", "warn", "off"],
+          "description": "Host's self-attested compliance posture for the Tier-1 cross-vendor structured-output subset per RFC 0030 §B. `strict`: every host-served envelope schema passes the static subset-compliance check; `warn`: host logs non-compliant schemas but serves them anyway; `off` (default): no self-attestation. The conformance suite's static subset-compliance scenario gates on this flag."
+        }
+      }
+    }
   }
```

### §D — Strict-mode optional-field emulation

The Tier-1 subset disallows literally-optional properties (OpenAI strict requires every property in `required`). When a payload property is genuinely optional, the spec recommends the strict-mode-compatible pattern:

```jsonschema
{
  "properties": {
    "notes": { "type": ["string", "null"] }
  },
  "required": ["notes"]
}
```

The field is in `required` (satisfying OpenAI strict) but the type union permits `null` (semantic optionality). Hosts that read back envelope payloads MUST treat `null` and absence equivalently — the wire shape forces `null` to be emitted, but the application semantics MAY be "absent."

This pattern is documented in `spec/v1/structured-output-subset.md` §"Strict-mode optional-field emulation" alongside the intersection table.

The `reasoning` field per §A is a special case: while it's OPTIONAL in spirit (hosts MUST NOT reject envelopes where `reasoning` is absent), envelope payload schemas SHOULD list it in `required` and type it as `["string", "null"]` so OpenAI strict mode accepts the schema. The host's read-side MUST tolerate `null` exactly as it tolerates absence.

### §E — Security carry-forward (SR-1 + trust boundary)

A `reasoning` field expands the surface where secrets can leak from the model's context into the durable event log:

- The model can hallucinate secret-shaped substrings from in-context examples, tool results, or prior turns. If `reasoning` is persisted to `RunEventDoc.payload` or OTel attributes without scrubbing, BYOK keys can leak.
- The trust-boundary propagation in `ai-envelope.md` §"Trust boundary" applies: if any contributing input was tagged `meta.contentTrust: untrusted`, the `reasoning` field MUST inherit the same trust marker. Hosts that surface `reasoning` to user UI MUST treat untrusted `reasoning` per the prompt-injection-mitigation rules in `SECURITY/threat-model-prompt-injection.md`.

A new SECURITY invariant lands alongside reference-host implementation (gate timing matches RFC 0027 §G precedent):

```yaml
- id: envelope-reasoning-secret-redaction
  tier: protocol
  severity: high
  threat_model: SECURITY/threat-model-secret-leakage.md
  tests:
    - conformance/src/scenarios/envelope-reasoning-secret-redaction.test.ts
  note: |
    RFC 0030 §A: an envelope's `reasoning` field MUST be routed through the same
    BYOK redaction harness applied to other envelope payload fields per
    `ai-envelope.md` §"Redaction". Known `secret:`-prefixed substrings in input
    MUST NOT appear verbatim in the emitted envelope's `reasoning` field, in
    any RunEventDoc derived from the envelope, in OTel span attributes, or in
    the debug-bundle export.
```

## Compatibility

**Additive per `COMPATIBILITY.md §2.1`.** All claims:

- Existing required fields: unchanged. `reasoning` is OPTIONAL on every payload schema; the `required` placement per §D is a host implementation choice (the OpenAI-strict workaround). Hosts that don't adopt OpenAI strict mode MAY leave `reasoning` outside `required` entirely.
- Existing optional fields: unchanged.
- Existing event types: unchanged. RFC 0030 does NOT add a `RunEventType` entry; `reasoning` rides on the envelope payload itself, which is already persisted via `RunEventDoc.causationId` per RFC 0021.
- Existing endpoints: unchanged.
- Existing MUST requirements: not relaxed. The §A "Hosts SHALL NOT route on `reasoning`" is a NEW MUST on a previously-undefined behavior (the field didn't exist before this RFC), which qualifies as additive per `COMPATIBILITY.md §4`.
- Existing error codes: unchanged.

Hosts that don't add `reasoning` to their schemas remain conformant. Clients that don't read `reasoning` from envelope payloads remain conformant. The Tier-1 subset document is informative and adds no normative requirements.

## Conformance

Three new scenarios under `conformance/src/scenarios/`. All gated as noted.

- `envelope-reasoning-shape.test.ts` — always runs. Asserts: (1) each of the four universal-kind payload schemas accepts a payload with `reasoning` populated (positive); (2) each accepts a payload with `reasoning` absent (positive); (3) `schema.response` does not declare `reasoning` (the side-channel-ack kind omits it per §A). Static schema-validation; no LLM in the loop.
- `envelope-reasoning-secret-redaction.test.ts` — gated on `capabilities.envelopes.reasoning.supported: true` AND the test seam `POST /v1/host/sample/test/emit-envelope`. Drives a synthetic envelope emission whose payload's `reasoning` field contains a known `secret:`-prefixed substring. Asserts the emitted `RunEventDoc` payload, OTel attribute set, and debug-bundle export all contain the SR-1 marker (`[REDACTED:<id>]`) and never the plaintext secret. Verifies invariant `envelope-reasoning-secret-redaction` (§E).
- `envelope-tier-one-subset-static.test.ts` — gated on `capabilities.envelopes.tierOneSubsetCompliance: "strict"`. For every kind in the host's advertised `supportedEnvelopes`, statically asserts the kind's payload schema satisfies the Tier-1 subset rules from `spec/v1/structured-output-subset.md`: `additionalProperties: false` on every object, every property in `required`, no `oneOf`/`allOf`/`not`/`prefixItems`/`propertyNames`, no string `minLength`/`maxLength`/`pattern`/`format`, no number `minimum`/`maximum`/`multipleOf`, no array `minItems`/`maxItems`/`uniqueItems`, max nesting depth 5, max property count 100. No LLM in the loop.

The `behaviorGate` helper from RFC 0023 / RFC 0027 gains two predicates: `requireEnvelopeReasoning()` and `requireTierOneSubsetStrict()`.

## Alternatives considered

1. **Make `reasoning` REQUIRED on every multi-reasoning envelope payload.** Rejected — REQUIRED would break backward compatibility with v1.1 hosts that already emit envelopes without `reasoning`. OPTIONAL with a SHOULD on host-side prompting captures the intent without breaking v1.1 conformance.

2. **Put `reasoning` in `meta.reasoning` instead of as a payload property.** Rejected — `meta` is closed (`additionalProperties: false` per `ai-envelope.md`) and reserved for protocol metadata (source, trust, timestamps, traceparent, label). Reasoning is an LLM-emitted content surface, semantically distinct from protocol metadata. The proposal author's parallel research (§10 of the originating handoff) explicitly considered this and concluded payload-property is structurally cleaner; this RFC follows that recommendation but documents the alternative for completeness.

3. **Skip the Tier-1 subset document; let each host's wiki carry vendor-portability guidance.** Rejected — the empirical motivation (every host re-discovering the subset through production 400s) is exactly what an informative spec appendix solves. The "informative" status means the spec doesn't claim authority over vendor behavior, only documents the intersection as of ratification.

4. **Make Tier-1 subset compliance MANDATORY for all spec-defined envelope schemas.** Rejected — the four universal-kind schemas already happen to satisfy the subset (their payloads are simple objects with required-string fields), but a future spec-defined kind might need a feature outside the subset (e.g., a `pattern` for an email field). A SHOULD ("schemas SHOULD restrict themselves to features in the intersection") preserves authoring flexibility. Vendor-kind authors who care about Tier-1 portability self-attest via `capabilities.envelopes.tierOneSubsetCompliance: "strict"`.

5. **Bundle this RFC with the discriminated-union pattern (RFC 0031 §A).** Rejected — the discriminated-union pattern is forward-looking (applies to future variant envelopes), while `reasoning` is a near-term schema addition with immediate quality impact. Slicing them apart lets RFC 0030 land first as the lowest-risk additive entry point.

## Unresolved questions

1. **`reasoning` token-budget accounting.** Populating `reasoning` consumes output tokens that count against the model's `max_tokens` budget. Should the spec mandate per-envelope token-budget accounting that reserves a `reasoningBudget` separate from the payload budget? Recommendation: leave to host discretion. Document the trade-off in a non-normative note: hosts setting `max_tokens` aggressively while requiring `reasoning` will see more `envelope.truncated` events (per RFC 0032). Hosts MAY surface a per-node `reasoningBudget` config field outside this RFC.

2. **`reasoning` field maximum length.** Should the spec cap `reasoning` at a max length (e.g., 8 KB)? Recommendation: no hard cap in the schema; let hosts enforce via their own `maxTemplateBytes`-style limits. Vendor-strict-mode subsets disallow `maxLength` anyway (see §B).

3. **`promptDirective: "mandatory"` enforcement.** When the host advertises `capabilities.envelopes.reasoning.promptDirective: "mandatory"`, MUST the host refuse to dispatch envelopes where the model fails to populate `reasoning`? Recommendation: no — the spec mandates `Hosts MUST NOT reject envelopes where reasoning is absent` (§A) regardless of `promptDirective`. The `mandatory` value is a system-prompt-injection posture (the host instructs the model very firmly), not a wire-level refusal contract.

4. **Tier-1 subset versioning.** As vendor behavior evolves (Gemini Nov 2025 added `anyOf` + `$ref` + min/max), the intersection table will drift. Should `spec/v1/structured-output-subset.md` carry a per-row "last verified" date, or should the document as a whole carry one ratification date that bumps on every verification pass? Recommendation: per-row dates — vendor surfaces drift independently. Maintainers MAY refresh individual rows without a full RFC; substantive subset changes (a row flipping from `UNSUPPORTED` to `SUPPORTED` in the intersection) DO require a follow-up RFC.

5. **Interaction with RFC 0024's `agent.reasoning.delta`.** When a host advertises BOTH `capabilities.agents.reasoning.streaming: true` (RFC 0024) AND `capabilities.envelopes.reasoning.supported: true` (this RFC), should the model's `agent.reasoning.delta` stream and the envelope's `reasoning` field carry the same content, or different content (delta = real-time thinking, envelope.reasoning = post-hoc analysis)? Recommendation: leave to host policy. The two surfaces are independent; hosts that emit both SHOULD document their relationship in their advertised configuration. Spec gap acknowledgment for future review.

## Implementation notes (non-normative)

- Reference host `apps/workflow-engine/backend/typescript` adds `reasoning` to its four universal-kind payload schemas via `additionalProperties: false`-preserving edits in `schemas/envelopes/{clarification.request,schema.request,error}.schema.json` (omitted for `schema.response` per §A). Wires `capabilities.envelopes.reasoning.supported: true` + `promptDirective: "advisory"` at `routes/discovery.ts`. System-prompt-injection helper `prompts/envelopeDirective.ts` (NEW) generates the advisory instruction the host injects when dispatching envelope-emitting nodes.
- `spec/v1/structured-output-subset.md` is a single new file (~150 lines) consisting of: short status banner, the intersection table from §2.2, the strict-mode optional-field emulation pattern from §D, per-vendor "last verified" annotations, and links to the primary-source vendor docs. The file is informative; redocly / asyncapi tooling treats it as a sibling of `spec/v1/observability.md` (no schema impact).
- Conformance fixture engineering for the three new scenarios: ~0.5 day each, total ~1.5 days. The `envelope-reasoning-secret-redaction` scenario reuses the existing BYOK test seam from RFC 0026's `provider.usage` work.
- Estimated total effort: schemas + spec text + sibling doc ~1 day; reference-host wiring ~0.5 day; three conformance scenarios ~1.5 days; CHANGELOG + INTEROP-MATRIX ~30 min. Total ~3 days plus the standard Active window unless the bootstrap-phase waiver applies.

## Acceptance criteria

Promotion from `Active` → `Accepted`:

- [ ] `spec/v1/ai-envelope.md` extended with §"Reasoning field (normative)" per §A.
- [ ] `spec/v1/structured-output-subset.md` ships as a new informative sibling document per §B.
- [ ] Universal-kind payload schemas under `schemas/envelopes/{clarification.request,schema.request,error}.schema.json` extended with the `reasoning` property per §A; `schema.response.schema.json` left unmodified.
- [ ] `schemas/capabilities.schema.json` gains the `envelopes.reasoning` and `envelopes.tierOneSubsetCompliance` fields per §C.
- [ ] `SECURITY/invariants.yaml` gains the `envelope-reasoning-secret-redaction` entry per §E (gate timing: lands alongside reference-host implementation, not at Draft merge — same posture as RFC 0027 §G).
- [ ] Three new conformance scenarios per §"Conformance" land in `@openwop/openwop-conformance`; suite minor-version bumps.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] `INTEROP-MATRIX.md` extended with rows for `capabilities.envelopes.reasoning.supported` and `capabilities.envelopes.tierOneSubsetCompliance`.
- [ ] Reference host (`apps/workflow-engine/backend/typescript`) advertises `capabilities.envelopes.reasoning.supported: true` and `tierOneSubsetCompliance: "strict"` (or `"warn"`), passes all three new conformance scenarios.
- [ ] First non-steward host advertises `capabilities.envelopes.reasoning.supported: true` (third-party validation gate per RFC 0001 §"Promotion to Accepted"). MAY be waived under bootstrap-phase waiver.

## References

- `spec/v1/ai-envelope.md` (RFC 0021) — envelope wire shape this RFC extends with `reasoning`.
- `RFCS/0021-ai-envelope-primitive.md` — schema-discipline section this RFC layers `reasoning` onto.
- `RFCS/0024-agent-reasoning-streaming.md` — `agent.reasoning.delta` / `agent.reasoned` events (model thinking-tokens) — sibling surface to envelope `reasoning`, see §"Unresolved questions" #5.
- `RFCS/0027-prompt-templates.md` — `prompt.composed.systemPrompt|userPrompt` (host-composed prompt body) — sibling surface to envelope `reasoning`, see RFC 0027 §"Implementation notes" cross-reference.
- `SECURITY/threat-model-secret-leakage.md` §SR-1 — redaction harness this RFC plugs into.
- `SECURITY/threat-model-prompt-injection.md` — `<UNTRUSTED>...</UNTRUSTED>` marker discipline for untrusted `reasoning` content.
- Tam et al., "Let Me Speak Freely?" — https://arxiv.org/pdf/2408.02442 (reasoning-collapse finding).
- JSONSchemaBench — https://arxiv.org/abs/2501.10868 (constrained-decoding quality lift finding).
- Anthropic Strict Tool Use — https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
- OpenAI Structured Outputs — https://developers.openai.com/api/docs/guides/structured-outputs
- Azure mirror — https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs
- Google Gemini Structured Output — https://ai.google.dev/gemini-api/docs/structured-output
- Gemini Nov 2025 update — https://blog.google/technology/developers/gemini-api-structured-outputs/
- `RFCS/0031-envelope-variants-and-model-capabilities.md` (forthcoming) — sibling RFC in the envelope LLM-contract-hardening track; codifies the `anyOf` + discriminator pattern that complements the Tier-1 subset in this RFC.
- `RFCS/0032-envelope-reliability-events.md` (forthcoming) — sibling RFC adding envelope-reliability `RunEventType` entries; references this RFC's `reasoning` field as a contributing factor to truncation budget calculations.
- `RFCS/0033-envelope-completion-contract.md` (forthcoming) — sibling RFC normating retry routing; depends on this RFC's `reasoning` field design for the truncation-budget recommendation note.

## Status history

### Draft → Active (2026-05-20)

Promoted under the bootstrap-phase steward waiver per `CONTRIBUTING.md` §"Bootstrap-phase notes" + `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". Same path RFCs 0021–0029 used in this release. The 7-day comment window would only serve as a delay against zero external reviewers; the waiver is recorded here for the running list in `MAINTAINERS.md`.

Evidence at promotion (spec-text + wire-shape locked; remaining acceptance criteria — conformance scenarios, SECURITY invariant, INTEROP-MATRIX rows, reference-host emission, first non-steward advertisement — defined as the path to `Accepted`):

- **RFC text:** follows `RFCS/0000-template.md` — header table, Summary (≤5 sentences), Motivation (2.1 reasoning-collapse + 2.2 vendor-fragmentation), Proposal (§A normative SHALL + §B informative subset + §C capability block + §D strict-mode emulation + §E SR-1 carry-forward), Compatibility (additive justification), Conformance (3 describe blocks), 5 Alternatives, 5 Unresolved questions, Acceptance criteria, References.
- **Spec text:**
  - `spec/v1/ai-envelope.md` extended with §"Reasoning field (normative)" between §"Universal kinds (normative)" and §"Vendor-namespaced kinds". Carries: normative SHALL on the OPTIONAL `reasoning` field, SHOULD on host prompt-injection, MUST NOT on routing on contents, SR-1 redaction discipline reference, universal-kind per-schema posture table, vendor-namespaced recommendation, strict-mode optional-field emulation pattern (informative cross-reference to the sibling doc), capability-handshake example, and the three-surface reasoning-relationship paragraph (envelope `reasoning` vs `prompt.composed.systemPrompt|userPrompt` vs `agent.reasoning.delta`).
  - `spec/v1/structured-output-subset.md` (NEW, informative) — Tier-1 cross-vendor JSON-Schema intersection table with per-row "last verified: 2026-05" annotations, strict-mode optional-field emulation pattern, per-vendor primary-source citations, maintenance posture (routine date refresh is non-RFC; substantive subset changes require follow-up RFC).
- **Schemas additive (no MUST relaxed):**
  - `schemas/envelopes/clarification.request.schema.json` — `reasoning` property added as OPTIONAL (not in `required`); preserves v1.1 backward compat. `additionalProperties: false` unchanged.
  - `schemas/envelopes/schema.request.schema.json` — same.
  - `schemas/envelopes/error.schema.json` — same.
  - `schemas/envelopes/schema.response.schema.json` — INTENTIONALLY UNMODIFIED (side-channel ack; no reasoning needed per RFC §A).
  - `schemas/capabilities.schema.json` — new optional top-level `envelopes` block with `reasoning.{supported, promptDirective}` + `tierOneSubsetCompliance` enum. `additionalProperties: true` on `envelopes` reserved for future RFC 0031/0032/0033 extensions (`modelCapabilities` is a sibling top-level block; `reliability` extends `envelopes` in RFC 0032).

Path to `Active → Accepted`: requires the reference workflow-engine to (a) advertise `capabilities.envelopes.reasoning.supported: true` + `capabilities.envelopes.tierOneSubsetCompliance: "strict"` (or `"warn"`) at `/.well-known/openwop`, (b) implement the system-prompt-injection helper (`prompts/envelopeDirective.ts` or equivalent) that instructs the model to populate `reasoning` when appropriate, (c) ship the three conformance scenarios from §"Conformance", and (d) ship the `envelope-reasoning-secret-redaction` invariant in `SECURITY/invariants.yaml` paired with the matching conformance scenario. Alternatively, path (b) closes when a non-steward host advertises the capability — same posture as RFC 0021 / RFC 0026.

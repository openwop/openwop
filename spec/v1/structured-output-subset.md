# OpenWOP Spec v1 — Tier 1 Structured-Output Compatibility Subset (informative)

> **Status: Stable · v1.1.1 (informative — non-normative companion to `ai-envelope.md`, not a contract).** Introduced by [RFC 0030](../../RFCS/0030-envelope-reasoning-and-tier-one-subset.md) (`Active` 2026-05-20). Companion to `spec/v1/ai-envelope.md` §"Reasoning field (normative)" and §"Schema discipline." This document is **informative**, not normative — the OpenWOP protocol cannot mandate vendor behavior, only document the intersection of vendor capabilities as of this document's last-verified date. See `auth.md` for the status legend; the `FINAL` tag denotes that the document's structure is stable, not that its contents are normative.

## Why this exists

Each LLM vendor enforces a different JSON-Schema subset for native structured output. The intersection of all vendor-strict modes is what an envelope payload schema MUST satisfy to be portable across hosts. Vendor docs don't enumerate this intersection; every host re-discovers it through production 400 responses. Worse, some vendors silently drop unsupported keywords rather than rejecting them, producing schemas that are looser at the vendor than the author intended (a silent correctness bug).

This document records the intersection of the three Tier-1 vendor strict-output modes used by OpenWOP-conformant hosts as of the RFC 0030 ratification date:

- **OpenAI strict mode** — `response_format: { type: 'json_schema', json_schema: { strict: true } }` and strict tool calling. **Last verified: 2026-05.**
- **Anthropic strict tool use** — `strict: true` on `input_schema` and `output_config.format`. **Last verified: 2026-05.**
- **Google Gemini `responseSchema`** on `generateContent` (Vertex AI). **Last verified: 2026-05** (post Nov 2025 Gemini structured-output expansion).

Envelope payload schemas defined by this specification SHOULD restrict themselves to features in the intersection. Canvas-type authors authoring custom vendor-namespaced envelope types SHOULD reference this document when designing payload shapes. Hosts MAY self-attest compliance via `capabilities.envelopes.tierOneSubsetCompliance` per RFC 0030 §C.

This document is expected to drift as vendor behavior evolves. Per-row "last verified" annotations track the freshness of individual rows. Substantive subset changes (a row flipping from `UNSUPPORTED` to `SUPPORTED` in the intersection) require a follow-up RFC.

---

## The intersection table

| Feature                                                     | Status in intersection | Notes                                                                                                                                                                                                                                              | Last verified |
| ----------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `type: object` at root                                      | REQUIRED               | All three reject root unions or arrays                                                                                                                                                                                                             | 2026-05       |
| `additionalProperties: false` on every object               | REQUIRED               | OpenAI + Anthropic mandate; Gemini accepts                                                                                                                                                                                                         | 2026-05       |
| Every property listed in `required`                         | REQUIRED               | OpenAI mandate; treat optionality as `["type", "null"]` union with field kept in `required` (see §"Strict-mode optional-field emulation" below)                                                                                                    | 2026-05       |
| `propertyOrdering`                                          | RECOMMENDED            | Required by Gemini 2.0; advisory on Gemini 2.5+; no-op on OpenAI/Anthropic — safe to include everywhere                                                                                                                                            | 2026-05       |
| `anyOf` inside properties (with discriminated branches)     | SUPPORTED              | OpenAI strict allows; Anthropic strict allows; Gemini accepted post-Nov 2025. **See `ai-envelope.md` §"Variant payload discrimination (normative)" (RFC 0031 §A) for the discriminator rules.**                                                    | 2026-05       |
| `enum` of `string`/`number`/`boolean`/`null`                | SUPPORTED              | Universal                                                                                                                                                                                                                                          | 2026-05       |
| Recursive `$ref` (to `#/$defs/...` only)                    | PARTIAL                | OpenAI: YES via `$defs`. Gemini: YES post-Nov 2025. Anthropic: NO. **Use sparingly; prefer flat shapes.**                                                                                                                                          | 2026-05       |
| `oneOf`                                                     | UNSUPPORTED            | OpenAI strict rejects; Anthropic strict rejects; Gemini **silently drops** the keyword (producing a looser schema than the author declared — silent correctness bug). Use `anyOf` with a single-string-enum discriminator instead per RFC 0031 §A. | 2026-05       |
| `allOf` / `not` / `if`/`then`/`else` / `dependencies`       | UNSUPPORTED            | Not accepted by any of the three strict modes                                                                                                                                                                                                      | 2026-05       |
| `prefixItems` (tuple arrays)                                | UNSUPPORTED            | OpenAI rejects; Anthropic rejects; Gemini accepts. Use homogeneous array `items` instead.                                                                                                                                                          | 2026-05       |
| `minLength` / `maxLength` / `pattern` / `format` on strings | UNSUPPORTED            | OpenAI strict rejects; Anthropic strict rejects; Gemini 2.5+ accepts. Not in intersection — DO NOT use for portable schemas.                                                                                                                       | 2026-05       |
| `minimum` / `maximum` / `multipleOf` on numbers             | UNSUPPORTED            | OpenAI strict rejects; Gemini 2.5+ accepts. Not in intersection.                                                                                                                                                                                   | 2026-05       |
| `minItems` / `maxItems` / `uniqueItems` on arrays           | UNSUPPORTED            | OpenAI strict rejects. Not in intersection.                                                                                                                                                                                                        | 2026-05       |
| `propertyNames`                                             | UNSUPPORTED            | Gemini silently drops; OpenAI strict rejects                                                                                                                                                                                                       | 2026-05       |
| Max nesting depth                                           | 5 levels               | OpenAI strict limit (deepest among the three); use as ceiling                                                                                                                                                                                      | 2026-05       |
| Max total property count across schema                      | 100                    | OpenAI strict limit                                                                                                                                                                                                                                | 2026-05       |

---

## Strict-mode optional-field emulation

The intersection's "every property listed in `required`" row creates a tension: how does an envelope payload express a property that's genuinely optional?

The portable pattern is to declare the property in `required` and union its type with `null`:

```jsonschema
{
  "properties": {
    "notes": { "type": ["string", "null"] }
  },
  "required": ["notes"]
}
```

The field is in `required` (satisfying OpenAI strict). The type union permits `null` (semantic optionality — the model can emit `null` when the field doesn't apply). Hosts MUST treat `null` and absence equivalently when reading payloads.

This pattern applies to vendor-namespaced kind authoring. The universal-kind payload schemas in `schemas/envelopes/` deliberately do NOT use this pattern for the optional `reasoning` field (RFC 0030 §A) — they take the simpler "OPTIONAL property, omit from `required`" approach because the universal-kind schemas are not held to OpenAI-strict-mode portability (they validate envelopes the host receives FROM LLMs, not the schemas the host sends TO providers).

For vendor-namespaced kinds that DO want OpenAI strict mode portability for the schemas they send to providers, the strict-mode emulation pattern is RECOMMENDED.

---

## What this document does NOT do

- **It does not mandate vendor behavior.** Vendors are free to add or drop features at any release. Per-row "last verified" annotations help readers gauge freshness.
- **It does not gate conformance.** Hosts that self-attest `capabilities.envelopes.tierOneSubsetCompliance: "strict"` are checked by the conformance suite's static-subset scenario; hosts that omit or set `"warn"` / `"off"` are not gated.
- **It does not block authors from using features outside the subset.** A vendor-namespaced kind whose author is willing to route to a specific vendor MAY use vendor-specific features. The trade-off is portability — such schemas will fail at other vendors. The subset is the safe path; deviations are at the author's risk.

---

## Maintenance

This document's intersection table is expected to drift as vendor behavior evolves. The maintenance posture:

- **Routine refresh of "last verified" dates** — non-normative; maintainers MAY refresh individual rows without an RFC after re-verifying against current vendor docs.
- **Substantive subset changes** (a row flipping support status in the intersection) — REQUIRES a follow-up RFC. The change is meaningful enough that schema authors will want to know it happened and when.

When a row's "last verified" date is more than 12 months old, readers SHOULD treat the row as advisory only and cross-check against current vendor documentation. The conformance-suite static-subset scenario operates against this document's table verbatim; CI will surface drift if a vendor changes behavior and the table hasn't been updated.

---

## Primary sources

For independent verification of any row in the intersection table:

- **OpenAI Structured Outputs guide** — <https://developers.openai.com/api/docs/guides/structured-outputs>
- **OpenAI Function Calling (strict + tool_choice)** — <https://developers.openai.com/api/docs/guides/function-calling>
- **Anthropic Structured Outputs (GA, 2026)** — <https://platform.claude.com/docs/en/build-with-claude/structured-outputs>
- **Anthropic Strict Tool Use** — <https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use>
- **Azure mirror (verbatim schema-restriction table)** — <https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs>
- **Google Gemini Structured Output** — <https://ai.google.dev/gemini-api/docs/structured-output>
- **Gemini Nov 2025 update (anyOf, $ref, min/max additions)** — <https://blog.google/technology/developers/gemini-api-structured-outputs/>
- **Vertex Schema Reference (`propertyOrdering`)** — <https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/Schema>

## Related research

- **Tam et al., "Let Me Speak Freely? A Study on the Impact of Format Restrictions on the Performance of Large Language Models"** — <https://arxiv.org/pdf/2408.02442> (motivates RFC 0030 §A `reasoning` field).
- **JSONSchemaBench** — <https://arxiv.org/abs/2501.10868> (constrained-decoding quality lift, when schemas permit a reasoning slot).

---

## References

- `spec/v1/ai-envelope.md` §"Reasoning field (normative)" — RFC 0030 §A's normative SHALL on the OPTIONAL `reasoning` field; this document is its informative companion.
- `spec/v1/ai-envelope.md` §"Schema discipline" — base discipline this document refines for cross-vendor portability.
- `RFCS/0030-envelope-reasoning-and-tier-one-subset.md` — RFC that introduced this document.
- `RFCS/0031-envelope-variants-and-model-capabilities.md` — codifies the `anyOf` + single-string-enum discriminator pattern that complements the Tier-1 subset.
- `schemas/capabilities.schema.json` §`envelopes.tierOneSubsetCompliance` — the self-attestation flag this document supports.

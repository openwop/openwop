# openwop Spec v1 — AI Chat Card Packs

> **Status: DRAFT (2026-05-26).** Phase 2 of [RFC 0071 — Artifact-Type Packs and AI Chat Card Packs](../../RFCS/0071-artifact-type-and-chat-card-packs.md). Specifies a pack kind that distributes **AI chat cards** — a prompt template bound to a typed output artifact. Depends on Phase 1 (artifact-type packs) for the `outputArtifactType` linkage. Phase 2 stays `Draft` within the RFC pending the R2 prompt-injection trust-boundary conformance proof and G9 (confirming the portable input-field subset). Promotes when (a) a host implements `host.chat.cardPacks` and (b) the manifest-validation + execution conformance scenarios pass. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

---

## Why this exists

A recurring host pattern is the **AI step card**: a user (or an agent) fills a small form, the host composes a prompt from those inputs, calls an LLM, validates the structured result, and stores it as a typed artifact. MyndHyve built this as `CardTemplateDefinition`; the openwop demo app built a parallel `cardType → component` registry. Neither is portable — the prompt, the input contract, and the output-artifact binding live in host-private code, so a card authored for one host can't run on another.

openwop already carries the *runtime* half of this: `host-capabilities.md` §host.chat defines `ctx.chat.emitCard` / `updateCard` (gated on `host.chat.cards: supported`), and `WorkflowNode.cardType` is a first-class field. What's missing is a **distributable card definition** — the prompt + input contract + output-artifact binding — so a card is publishable, signed, and runnable across hosts.

A **chat card pack** is that distribution unit. A card is, precisely: `(typed inputs + prompt template) → ctx.aiEnvelope.generate → a typed artifact of a registered artifact type`. It composes three existing primitives — the AI envelope (`ai-envelope.md`), the artifact type (`artifact-type-packs.md`, Phase 1), and the chat-card runtime (§host.chat) — rather than introducing new machinery.

This doc stops at the wire contract. It does **not** specify input-field *widgets*, card *rendering*, or the chat-sidebar UI — those are host-product concerns per `positioning.md`. It specifies the prompt, the input *types* (a closed portable subset), and the output-artifact binding.

A chat card pack is distinct from a **prompt pack** (`prompts.md`): a prompt pack distributes reusable prompt *fragments* surfaced via `GET /v1/prompts`; a card is a higher-order composite (inputs + prompt + output-artifact binding) consumed via `WorkflowNode.cardType` / `ctx.chat.emitCard`. A card MAY *reference* a prompt-pack template rather than inlining its prompt (composition over duplication).

---

## Pack kind

Chat card packs are the fifth pack `kind`, peer to `node`, `workflow-chain`, `prompt`, and `artifact-type`. A manifest with `kind: "card"` validates against [`chat-card-pack-manifest.schema.json`](../../schemas/chat-card-pack-manifest.schema.json), MUST declare a non-empty `cards[]`, and MUST NOT declare `nodes[]` / `chains[]` / `prompts[]` / `artifactTypes[]`; mixing is rejected at registry `PUT` with `pack_kind_invalid`.

## Manifest format

```json
{
  "kind": "card",
  "name": "vendor.acme.cad-cards",
  "version": "1.0.0",
  "engines": { "openwop": ">=1.1 <2.0.0" },
  "peerDependencies": { "host.aiEnvelope": "supported", "host.chat.cards": "supported" },
  "cards": [
    {
      "cardTypeId": "vendor.acme.cad.model.create",
      "schemaVersion": 1,
      "prompt": {
        "template": "Design a parametric model for: {{spec}}",
        "systemPrompt": "You are a mechanical CAD assistant.",
        "placeholderMapping": { "spec": "inputs.spec" },
        "temperature": 0.2,
        "maxTokens": 4096
      },
      "inputs": [
        { "id": "spec", "type": "text", "label": "Part spec", "required": true }
      ],
      "outputArtifactType": "vendor.acme.cad.model",
      "outputSchemaRef": "schemas/cad-model.schema.json",
      "requiredModelCapabilities": ["function-calling"]
    }
  ]
}
```

### Required fields

| Field | Description |
|---|---|
| `kind` | MUST be the literal `"card"`. |
| `name`, `version`, `engines.openwop` | As for every pack kind (`node-packs.md` §Naming / §Versioning). |
| `cards[]` | One or more card definitions; each `cardTypeId` MUST be unique within the pack. |

### The `Card` definition

| Field | Req. | Description |
|---|---|---|
| `cardTypeId` | MUST | Reverse-DNS identifier, same pattern + reserved scopes as a pack `name`. This is the value `WorkflowNode.cardType` (and the `ctx.chat.emitCard` `cardType` argument) MAY reference. Third parties MUST NOT publish under `core.*`. |
| `prompt.template` | MUST | The prompt body, with `{{placeholder}}` slots. The host MUST substitute mapped input values (below) into the template before dispatch. |
| `prompt.placeholderMapping` | MUST | Map of `{{placeholder}}` name → input path (e.g. `"spec": "inputs.spec"`). |
| `prompt.systemPrompt` | MAY | Optional system prompt. |
| `prompt.temperature`, `prompt.maxTokens` | MAY | Optional LLM-call hints. |
| `inputs[]` | SHOULD | The card's typed input fields (below). |
| `outputArtifactType` | MAY | A registered `artifactTypeId` (Phase 1). When present, the host MUST validate the card's LLM output against that artifact type's schema and emit `artifact.created` for the result. |
| `outputSchemaRef` | MAY | Path inside the tarball to the JSON Schema the LLM output MUST conform to. SHOULD be consistent with the referenced artifact type's schema. |
| `requiredModelCapabilities` | MAY | Model capabilities the card needs, drawn from the registry in `host-capabilities.md` §"Capability identifier registry" (reuses the `requiredModelCapabilities` idiom). |
| `schemaVersion` | SHOULD | Integer card-schema version (the envelope/artifact integer-version axis). |

### Input fields — a closed portable subset

`inputs[].type` is a **closed enum**: `text`, `longtext`, `number`, `boolean`, `select`, `artifact-ref`. These are the host-agnostic field kinds. Host-specific widget kinds — MyndHyve's `canvas-reference` / `collection-reference`, i18n key references, validation widgets — are **out of scope** (host-UI concerns per `positioning.md`). A host MAY extend `inputs[].type` with a `vendor.<org>.<kind>`- or `x-<kind>`-prefixed value that other hosts MUST ignore (degrade to a plain text input).

```jsonc
{ "id": "spec", "type": "text", "label": "Part spec", "required": true }
{ "id": "tier", "type": "select", "label": "Tier", "options": ["draft", "final"] }
{ "id": "base", "type": "artifact-ref", "label": "Base model" }   // references an existing artifact
```

> **G9 (open):** the closed enum above is a best-guess minimal portable subset of MyndHyve's field types; it is confirmed against the adopter before the Phase-2 schema freezes.

## Card execution (normative)

When a host advertises `host.chat.cardPacks: supported` and a registered card is invoked (via `WorkflowNode.cardType` or `ctx.chat.emitCard`):

1. The host MUST substitute the mapped `inputs` into `prompt.template` (and `systemPrompt`) per `placeholderMapping`.
2. The host MUST route the call through `ctx.aiEnvelope.generate(...)` (`host-capabilities.md` §host.aiEnvelope).
3. If `outputArtifactType` is present, the host MUST validate the LLM output against that registered artifact type's schema before emitting `artifact.created` (the Phase-1 binding; `registered: true` when validated).

### Trust boundary (normative — R2)

Card inputs frequently derive from workflow run input or prior LLM output, which is **untrusted**. A host MUST treat any `prompt.template` / `systemPrompt` segment interpolated from a card input as `untrusted` content: the composed envelope MUST carry `meta.contentTrust: "untrusted"` (propagated per `ai-envelope.md` §"Trust boundary") unless the host can assert the input is host-trusted. This prevents a card input from smuggling instructions that exfiltrate or coerce the structured output. The injection threat and this mitigation are documented in `SECURITY/threat-model-prompt-injection.md`; the conformance proof (`chat-card-pack-execution.test.ts` asserts trust-tag propagation) is the Phase-2 `Active` gate.

## Binding `WorkflowNode.cardType` and `ctx.chat.emitCard`

A `WorkflowNode.cardType` value (and the `cardType` argument to `ctx.chat.emitCard`) SHOULD reference a registered `cardTypeId` when `host.chat.cardPacks: supported` is advertised. Existing free-form `cardType` strings (`'progress'`, `'approval'`, `'clarification'`, …) remain valid — `host.chat.cards` behavior is unchanged. `host.chat.cardPacks` is an additive sub-flag under §host.chat that signals the host resolves registered card definitions and executes them per §"Card execution".

## Examples

**Positive.** The manifest above with a resolvable `outputSchemaRef` and `outputArtifactType` referencing an installed artifact-type pack validates and installs.

**Negative — `pack_kind_invalid`.** A manifest declaring both `cards[]` and `artifactTypes[]`. **Negative — schema.** An `inputs[].type` of `canvas-reference` (not in the closed enum and not `vendor.*`/`x-` prefixed); a `cardTypeId` with an uppercase scope; a card missing `prompt.template`.

## Open spec gaps

| Gap | Tracking |
|---|---|
| Confirm the closed `inputs[].type` subset against MyndHyve's field types before schema freeze. | RFC 0071 G9 |
| The `chat-card-pack-execution.test.ts` trust-tag-propagation conformance proof (R2) — the Phase-2 `Active` gate. | RFC 0071 R2 / `SECURITY/threat-model-prompt-injection.md` |
| Whether a card may be a thin reference to a `prompt`-pack template vs. always inlining `prompt.template`. | RFC 0071 (composition) |

## References

- [RFC 0071](../../RFCS/0071-artifact-type-and-chat-card-packs.md) — Phase 2.
- [`artifact-type-packs.md`](./artifact-type-packs.md) — the `outputArtifactType` binding (Phase 1).
- [`ai-envelope.md`](./ai-envelope.md) — `ctx.aiEnvelope.generate`, the trust boundary, the rendering vocabulary.
- [`host-capabilities.md`](./host-capabilities.md) — §host.chat (cards + cardPacks), §host.aiEnvelope, the capability-identifier registry.
- [`prompts.md`](./prompts.md) — prompt packs (the composable prompt-fragment kind a card MAY reference).
- `schemas/chat-card-pack-manifest.schema.json`.
- Prior art: MyndHyve `CardTemplateDefinition`; openwop demo app `chat/registry/CardHost.tsx`. See `docs/OPENWOP-CANVAS-TYPE-PACKS-RESEARCH.md`.

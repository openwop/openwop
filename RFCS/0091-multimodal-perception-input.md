# RFC 0091: Multimodal perception input on `ctx.callAI` (typed content parts)

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0091                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Title**         | Let `ctx.callAI` messages carry typed multimodal content parts (text / image / audio / document) so an agent can _perceive_ non-text input, gated behind an additive `capabilities.aiProviders.input.modalities[]` advertisement — closing the one agent-architecture layer (perception) openwop does not model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Created**       | 2026-06-07                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Updated**       | 2026-06-08 (`Active → Accepted` — non-steward host **MyndHyve** `workflow-runtime` (revision `00265-4p7`) advertises `aiProviders.input.modalities: ["text","image"]` at the document root on live `https://workflow-runtime-gjw5bcse7a-uc.a.run.app/.well-known/openwop`, and the published `@openwop/openwop-conformance@1.21.0` `callai-multimodal.test.ts` passes non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`. **Steward-curl-confirmed** (openwop-app-1): `POST /v1/host/sample/ai/call` with an advertised `image` part → `200` accepted; an unadvertised `audio` part → `400 {"error":"unsupported_modality"}` (§A — never silently dropped). MyndHyve PR #156. 2026-06-07 (`Draft → Active` — comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus during the bootstrap phase, after a steward wire-shape review. The additive surface (the `callAI` message `content` widening to `string \| ContentPart[]`and the`capabilities.aiProviders.input.modalities[]`advertisement) is landed and validates:`spec-corpus-validity`green and the always-on`aiproviders-input-shape.test.ts`passes; a`string` content stays valid (back-compat). **Wire shapes are now locked.**))      |
| **Affects**       | `spec/v1/host-capabilities.md` (§host.aiProviders — `callAI` message `content` widened to `string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ContentPart[]`; untrusted-media safety note) ·`schemas/capabilities.schema.json`(additive optional`aiProviders.input`block) ·`SECURITY/threat-model-prompt-injection.md`(media inherits the UNTRUSTED boundary) · conformance scenarios · SDKs ·`CHANGELOG.md`·`INTEROP-MATRIX.md` |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Summary

openwop models every agent-architecture layer except **perception**: `ctx.callAI` accepts `messages: Array<{ role, content: string }>` — text only. The spec has image _generation_ (`ctx.callImageGenerator`) and media _emission_ envelopes (`ai-envelope.md`), but an agent cannot feed an image, audio clip, or document _into_ the model as input. This RFC widens a `callAI` message's `content` to accept either a `string` (unchanged) OR an array of typed content parts (`text | image | audio | document`), each referencing media by URL / `mediaRef` / inline base64 + `mimeType`, gated behind an additive optional `capabilities.aiProviders.input.modalities[]`. Hosts that don't advertise it are unchanged; a `string` content stays valid forever.

## Motivation

The state-of-the-art agent reference architecture treats perception — converting images, audio, documents, and screenshots into model context — as a first-class layer (PaLM-E, Gemini, vision-language models; screenshot-grounded computer-use). openwop today cannot express it on the wire:

- A research agent cannot pass a chart image or a scanned PDF to the model; it must pre-transcribe out-of-band, losing fidelity and the model's native vision.
- A computer-use / browser agent cannot send a screenshot for grounding.
- The omission is _silent_ — `callAI`'s `content: string` simply has no place for non-text input, so a consumer can't even tell whether a host could accept it.

The spec is the right place because the **input shape** is a cross-host interop contract: a pack written against host A's multimodal `callAI` must run on host B, and a client must discover whether a host accepts image/audio/document input before sending it. The per-host _model routing_ (which vision model) stays a host choice; this RFC standardizes the input wire shape + its discovery, additively.

## Proposal

### §A — Widen `callAI` message `content` (prose, `host-capabilities.md` §host.aiProviders)

A message's `content` becomes `string | ContentPart[]`:

```typescript
type ContentPart =
  | { type: 'text';     text: string }
  | { type: 'image';    mimeType: string; url?: string; mediaRef?: string; data?: string }   // data = base64
  | { type: 'audio';    mimeType: string; url?: string; mediaRef?: string; data?: string }
  | { type: 'document'; mimeType: string; url?: string; mediaRef?: string; data?: string };

messages: Array<{ role: 'user' | 'assistant' | 'system', content: string | ContentPart[] }>
```

- A plain `string` content is exactly today's behavior (equivalent to `[{ type: 'text', text }]`) — **unchanged, forever valid**.
- Each non-text part references its bytes one of three ways (exactly one MUST be present): `url` (host-fetchable, SSRF-guarded per RFC 0076), `mediaRef` (an opaque host blob handle, RFC 0019), or inline `data` (base64). `mimeType` is REQUIRED on non-text parts.
- A host MUST reject a content part whose `type` is not in its advertised `aiProviders.input.modalities` with `unsupported_modality` rather than silently dropping it (silent drop would make the model answer about input it never saw).

### §B — Capability advertisement (`capabilities.aiProviders.input`, additive)

```diff
   "aiProviders": {
     "properties": {
       "supported": { ... },
       "byok": { ... },
+      "input": {
+        "type": "object",
+        "additionalProperties": false,
+        "description": "RFC 0091. Multimodal PERCEPTION input on ctx.callAI. Absent ⇒ text-only (today's behavior).",
+        "properties": {
+          "modalities": {
+            "type": "array", "uniqueItems": true,
+            "items": { "type": "string", "enum": ["text", "image", "audio", "document"] },
+            "description": "Input modalities the host's callAI accepts as ContentParts. `text` is implicit even if omitted. A part whose type is absent here MUST be rejected with `unsupported_modality`."
+          },
+          "maxBytesPerPart": { "type": "integer", "minimum": 1, "description": "Optional host cap on a single inline/`mediaRef` part." }
+        }
+      }
     }
   }
```

### §C — Safety (normative)

Non-text input is **untrusted content** — an image or document can carry injected instructions (text in an image, a malicious PDF). A host MUST treat multimodal parts under the same trust boundary as untrusted text (`threat-model-prompt-injection.md`): content reaching the model from an external/untrusted boundary inherits `contentTrust: 'untrusted'` and the existing UNTRUSTED-marker discipline; a `url`-referenced part MUST be fetched through the host's SSRF-guarded fetch (RFC 0076). BYOK/SR-1 is unaffected (media bytes are not credentials, but a `mediaRef`/`url` MUST NOT encode secret material).

### Examples

**Positive.** `messages: [{ role: 'user', content: [{ type: 'text', text: 'What trend does this chart show?' }, { type: 'image', mimeType: 'image/png', mediaRef: 'blob:run-7/chart' }] }]` on a host advertising `aiProviders.input.modalities: ["text","image"]`.

**Negative (capability).** The same image part on a host advertising `modalities: ["text"]` → `unsupported_modality`.

**Negative (shape).** `{ type: 'image', mimeType: 'image/png' }` with no `url`/`mediaRef`/`data` → invalid (exactly one source required). A plain `string` content → always valid.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). `content` widens from `string` to `string | ContentPart[]` — a union that **keeps every existing `string` value valid**; no existing pack/host that sends string content is affected. The `aiProviders.input` block is new + optional (absent ⇒ text-only). No existing field is removed/renamed/type-narrowed; no `MUST` relaxed; no conformance pass invalidated. The §A reject-on-unadvertised-modality MUST only fires for the new part types, which only a multimodal-aware client sends.

## Conformance

- **`aiproviders-input-shape.test.ts`** (always-on, server-free): the `aiProviders.input` advertisement validates; the `modalities` enum is closed; `string` content still validates.
- **`callai-multimodal.test.ts`** (gated on `aiProviders.input.modalities` ⊇ `["image"]`): a host accepts an image ContentPart and rejects an unadvertised modality with `unsupported_modality`. Soft-skips when unadvertised.

## Alternatives considered

1. **A separate `ctx.callAIMultimodal` method.** Rejected — forks the call surface and the tool/structured-output/embedding sub-capabilities; widening `content` is one surface, additively.
2. **Reuse the `ai-envelope.md` media envelopes.** Rejected — those are model _emission_ (output) types; perception is _input_. Opposite direction, different lifecycle.
3. **Defer perception as permanently out of scope.** Rejected — it is the one agent-architecture layer openwop omits, and the omission is silent (no advertisement says "text-only"); even the out-of-scope choice deserves an explicit advertisement, which §B provides as the floor (`input` absent ⇒ text-only is now a _stated_ posture).

## Unresolved questions

1. **`mediaRef` cross-host portability.** Like `memoryRef` (RFC 0080), a `mediaRef` minted by host A need not resolve on host B. Proposed: non-normative in v1.x; `url`/`data` are the portable forms. Confirm.
2. **Per-modality model routing advertisement.** Should the host advertise _which model_ handles each modality? Proposed: no — routing stays host-internal (consistent with `modelClass`); only acceptance is advertised. Confirm.
3. **Document parsing depth.** Does `document` imply host-side OCR/extraction, or pass-through to a doc-capable model? Proposed: pass-through; extraction is a host/tool concern. Confirm before `Active`.

## Acceptance criteria

- [ ] `host-capabilities.md` §host.aiProviders widened `content` + §C safety note.
- [ ] `capabilities.schema.json` `aiProviders.input` block.
- [ ] `threat-model-prompt-injection.md` media-untrusted note.
- [ ] Conformance: `aiproviders-input-shape.test.ts` (always-on) + `callai-multimodal.test.ts` (gated).
- [ ] SDK `callAI` types widen `content`; CHANGELOG + INTEROP-MATRIX rows.
- [ ] All three Unresolved questions resolved (record in `Updated:`).
- [ ] `Active → Accepted`: a host advertises `aiProviders.input` + passes the gated scenario.

## References

- [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) §host.aiProviders — the `callAI` surface this widens.
- [`spec/v1/ai-envelope.md`](../spec/v1/ai-envelope.md) — the media _emission_ envelopes (the output contrast, Alt 2).
- [`SECURITY/threat-model-prompt-injection.md`](../SECURITY/threat-model-prompt-injection.md) — the untrusted-content boundary §C extends to media.
- [`RFCS/0019-host-blob-cache-capability.md`](./0019-host-blob-cache-capability.md) — `mediaRef` blob handles.

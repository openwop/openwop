# RFC 0105: Speech synthesis adapter (`ctx.callSpeechSynthesizer`) — text-to-speech as a first-class AI provider sub-capability

| Field             | Value                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0105                                                                                                                                                                                                                                                                            |
| **Title**         | Add an optional AI-provider sub-capability `aiProviders.speechSynthesis: supported` exposing `ctx.callSpeechSynthesizer({ text, voiceId, … })` → a binary audio asset, paralleling `ctx.callImageGenerator` — the one generation modality openwop's wire cannot express today |
| **Status**        | `Active`                                                                                                                                                                                                                                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                |
| **Created**       | 2026-06-20                                                                                                                                                                                                                                                                    |
| **Updated**       | 2026-06-20 (`Draft → Active` — single-maintainer waiver of the 7-day comment window per `GOVERNANCE.md` lazy consensus; all four Unresolved questions resolved in-RFC because `Active` locks the wire shape)                                                                  |
| **Affects**       | `spec/v1/host-capabilities.md` (§host.aiProviders — new optional `ctx.callSpeechSynthesizer` method block + `speech_synthesis_failed` / `speech_synthesis_unsupported` failure modes) · `schemas/capabilities.schema.json` (additive optional `aiProviders.speechSynthesis` flag) · `SECURITY/threat-model-prompt-injection.md` (synthesized audio inherits the untrusted-media boundary) · conformance scenarios · SDKs · `CHANGELOG.md` · `INTEROP-MATRIX.md` |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                    |
| **Supersedes**    | —                                                                                                                                                                                                                                                                            |
| **Superseded by** | —                                                                                                                                                                                                                                                                            |

## Summary

openwop's wire can generate images (`ctx.callImageGenerator`, advertised via `aiProviders.imageGeneration: supported`) and video (`ctx.callVideoGenerator`), and as of RFC 0091 it can _perceive_ audio as model **input** (`aiProviders.input.modalities` ⊇ `["audio"]`). It cannot **generate** audio: there is no text-to-speech adapter an agent can call mid-run. This RFC closes that gap with an additive optional sub-capability `capabilities.aiProviders.speechSynthesis: supported`; when advertised the host exposes `ctx.callSpeechSynthesizer({ text, voiceId, mimeType?, format?, languageCode? })` → `Promise<{ audio: { url? | base64?, mimeType, … } }>`, mirroring the `ctx.callImageGenerator` shape exactly. Hosts that don't advertise it are unchanged; a host MUST reject the call when unadvertised.

## Motivation

Speech synthesis (TTS) is the missing half of openwop's media-generation surface. The asymmetry is concrete:

| Modality | Input (perception)                           | Output (generation)                  |
| -------- | -------------------------------------------- | ------------------------------------ |
| Image    | RFC 0091 `input.modalities: ["image"]`       | `ctx.callImageGenerator` ✅          |
| Video    | —                                            | `ctx.callVideoGenerator` ✅          |
| Audio    | RFC 0091 `input.modalities: ["audio"]` ✅    | **none — this RFC**                  |

Who hits this today:

- A **podcast / audio-digest** agent (the open-notebook flagship feature being ported onto a conformant host) needs text→speech to turn a generated transcript into narrated audio. There is no wire surface to call.
- Any **accessibility / read-aloud** workflow (turn a document or summary into a spoken track) must drop to a raw provider HTTP call inside a node — bypassing BYOK (RFC 0046), per-provider policy gating (`aiProviders.policies`), and the host's media-trust boundary, and producing a pack that is **not portable** to another host.
- The omission is **silent**: nothing on the discovery doc says "no TTS." A client cannot discover whether a host can synthesize speech before trying, exactly as RFC 0091 found for perception input.

The spec is the right place because the **call shape + its discovery** is a cross-host interop contract: a pack written against host A's `callSpeechSynthesizer` must run on host B, and a client must discover support before sending. Per-host model/voice routing (which TTS model, what `voiceId` resolves to) stays a host choice — this RFC standardizes only the call shape and the advertisement, additively, exactly as `imageGeneration` does for images.

## Proposal

### §A — New method `ctx.callSpeechSynthesizer` (prose, `host-capabilities.md` §host.aiProviders)

Available only when the host advertises `aiProviders.speechSynthesis: supported`. The shape parallels `ctx.callImageGenerator` (binary asset returned as host-served `url` **or** inline `base64` + `mimeType`):

```typescript
// Available when host advertises `aiProviders.speechSynthesis: supported`.
ctx.callSpeechSynthesizer({
  provider?: string,        // elevenlabs | openai | gemini | azure | ... (host routes; must be in aiProviders.supported[])
  model?: string,           // 'eleven_multilingual_v2' | 'gpt-4o-mini-tts' | ...
  text: string,             // the utterance to synthesize (one speaker's turn)
  voiceId: string,          // OPAQUE host-resolved voice handle — the spec does NOT enumerate voices
  mimeType?: string,        // requested output type: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' (host MAY substitute; echoes actual)
  format?: string,          // optional codec/bitrate hint forwarded to providers that accept it (e.g. 'mp3_44100_128')
  languageCode?: string,    // BCP-47 hint (e.g. 'en-US', 'pt-BR') for multilingual voices
  speed?: number,           // optional rate multiplier (host MAY clamp; default 1.0)
  seed?: number,            // optional determinism hint where the provider supports it
}) → Promise<{
  audio: {
    url?: string,           // host-served URL (preferred for large assets)
    base64?: string,        // inline base64 (smaller assets; host's choice) — exactly one of url|base64 present
    mimeType: string,       // actual output type ('audio/mpeg' | ...)
    durationSeconds?: number,
    voiceId: string,        // the voiceId actually used (echoes input)
    seed?: number,
    metadata?: { model?: string, provider?: string, generationTimeMs?: number },
  },
  totalTimeMs?: number,
  usage?: { totalCost?: number, characters?: number },
}>
```

- `text` and `voiceId` are REQUIRED. `voiceId` is an **opaque, host-resolved string**; the spec does NOT enumerate or schema-validate voices (a host maps it to a provider voice internally, exactly as `model` ids are host-routed for `callImageGenerator`).
- Exactly one of `audio.url` / `audio.base64` MUST be present (mirrors `images[].url` / `images[].base64`).
- This RFC standardizes **one call per speaker**. A multi-speaker dialogue is produced by calling `callSpeechSynthesizer` once per turn (each turn carries its own `voiceId`); the host/pack mixes the resulting clips (see Unresolved §2). Per-host model/voice routing stays a host choice.

### §B — Capability advertisement (`capabilities.aiProviders.speechSynthesis`, additive)

A new optional boolean-shaped flag alongside `imageGeneration` / `videoGeneration` in the §host.aiProviders sub-capability table, and in the schema:

```diff
       "byok": {
         "type": "array",
         "items": { "type": "string", "minLength": 1 },
         "uniqueItems": true,
         "description": "Subset of `supported` for which BYOK is permitted. ..."
       },
+      "speechSynthesis": {
+        "const": "supported",
+        "description": "RFC 0105. When present, the host exposes `ctx.callSpeechSynthesizer({ text, voiceId, mimeType?, format?, languageCode?, ... })` returning a binary audio asset (host-served `url` OR inline `base64` + `mimeType`), paralleling `aiProviders.imageGeneration`. Absent ⇒ no TTS; a call MUST be rejected with `speech_synthesis_unsupported`. Voices are referenced by an opaque host-resolved `voiceId`; the spec does NOT enumerate voices. Per-host model/voice routing is a host choice."
+      },
       "input": { ... }
```

And the §host.aiProviders sub-capability table gains a row:

```diff
 | `aiProviders.imageGeneration: supported` | `ctx.callImageGenerator(...)` — generates binary image asset (URL or base64) | `vendor.myndhyve.ads-image-generate` |
+| `aiProviders.speechSynthesis: supported` | `ctx.callSpeechSynthesizer(...)` — synthesizes speech (text + opaque `voiceId`) → binary audio asset (URL or base64); one call per speaker | `feature.podcasts.nodes` (openwop-app ADR 0086) |
 | `aiProviders.videoGeneration: supported` | `ctx.callVideoGenerator(...)` — generates binary video asset (URL) | `vendor.myndhyve.ads-video-generate` |
```

### §C — Failure modes (normative, added to §host.aiProviders "Failure modes")

- `speech_synthesis_unsupported` — `ctx.callSpeechSynthesizer` invoked on a host that does **not** advertise `aiProviders.speechSynthesis: supported`. A host MUST reject (never no-op), paralleling RFC 0091's `unsupported_modality`. Register-time refusal via `peerDependencies: { aiProviders: "supported" }` + a `requiredHostCapabilities` declaration is the correct primary path; the runtime check is defense-in-depth.
- `speech_synthesis_failed` — sub-capability-specific provider/synthesis failure (parallel to `image_generation_failed`). Carries the provider-reported reason when available.
- The shared `aiProviders` failure codes already apply transitively: `provider_unavailable`, `provider_quota_exhausted`, `provider_not_supported` (a `provider` not in `aiProviders.supported[]`), `model_not_supported`, `content_too_long` (text exceeds the provider's per-call limit; see Unresolved §4).

### §D — Safety (normative)

Synthesized audio bytes are **generated media** and inherit the same media-trust treatment as generated images (RFC 0091 §C / `threat-model-prompt-injection.md`): bytes crossing back into the run from the provider are treated as untrusted content under the existing UNTRUSTED-marker discipline, and a `url`-referenced asset MUST be served/fetched through the host's SSRF-guarded path (RFC 0076). The `text` argument is itself model- or user-derived and MAY carry injected instructions if later transcribed/re-perceived — it MUST NOT be treated as trusted on a round-trip. BYOK/SR-1 is unaffected: audio bytes are not credentials, and `voiceId` MUST NOT encode secret material.

### Examples

**Positive.** `ctx.callSpeechSynthesizer({ text: 'Welcome to the weekly digest.', voiceId: 'host:narrator-ana', mimeType: 'audio/mpeg', languageCode: 'pt-BR' })` on a host advertising `aiProviders.speechSynthesis: supported` → `{ audio: { url: 'https://host/assets/…mp3', mimeType: 'audio/mpeg', durationSeconds: 2.1, voiceId: 'host:narrator-ana' } }`.

**Negative (capability).** The same call on a host that does NOT advertise `speechSynthesis` → `speech_synthesis_unsupported`.

**Negative (shape).** A response with neither `audio.url` nor `audio.base64` is invalid (exactly one source required), mirroring `callImageGenerator`.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). The `aiProviders.speechSynthesis` flag is new + optional (absent ⇒ no TTS, today's stated posture); the `ctx.callSpeechSynthesizer` method is new and only present when the flag is advertised. No existing field is removed, renamed, or type-narrowed; no existing `MUST` is relaxed; no current v1 conformance pass is invalidated. The §C `speech_synthesis_unsupported` reject only fires for the new method, which only a TTS-aware pack calls — and such a pack SHOULD declare the dependency so the refusal happens at register time. Backward-compat clauses: existing hosts that never advertise the flag emit nothing new and reject the new method; existing packs that never call the new method see no change.

## Conformance

Two new scenarios in `@openwop/openwop-conformance`, both **gated on `aiProviders.speechSynthesis: supported`** (soft-skip when unadvertised, per `coverage.md` / `profiles.md`):

- **`speech-synthesis-roundtrip.test.ts`** (gated): a host advertising `speechSynthesis` accepts `callSpeechSynthesizer({ text, voiceId })` → `200` returning an audio asset with exactly one of `url`/`base64` and a non-empty `mimeType`. Non-vacuous under `OPENWOP_REQUIRE_BEHAVIOR=true`.
- **`speech-synthesis-unadvertised.test.ts`** (gated by ABSENCE): a host that does NOT advertise `speechSynthesis` MUST reject `callSpeechSynthesizer` with `speech_synthesis_unsupported` (parallel to RFC 0091's `callai-multimodal` unadvertised-modality leg).

An always-on, server-free `aiproviders-speechsynth-shape.test.ts` asserts the schema flag validates as the `const: "supported"` shape and that its absence is the default. They ship in the same `@openwop/openwop-conformance` release as the spec text.

## Alternatives considered

1. **Reuse the media-emission envelopes only (RFC 0031 / 0055).** Rejected — those envelopes describe **rendering hints** for media an agent has already produced/referenced; they are not a generation adapter an agent can **call** mid-run to turn text into audio bytes. Opposite lifecycle (emit/render vs generate), exactly the contrast RFC 0091 §Alt-2 drew between perception input and the emission envelopes.
2. **A generic `ctx.callMediaGenerator(kind)` umbrella** that subsumes image/video/speech. Rejected — image generation already shipped as its own dedicated `ctx.callImageGenerator` method (and video as `ctx.callVideoGenerator`); a dedicated `ctx.callSpeechSynthesizer` is **consistent** with that precedent and **clearer to gate** (one flag → one method). Retrofitting an umbrella would be a breaking re-shape of two already-shipped methods.
3. **Do nothing.** Rejected — there is no way to express TTS on the wire, the omission is **silent** (nothing advertises "no TTS"), and the only workaround is a raw provider HTTP call inside a node that bypasses BYOK, policy gating, and the media-trust boundary, and is non-portable. The asymmetry with image/video generation and with RFC 0091 audio _input_ is itself the argument that the floor should be a stated, discoverable capability.

## Resolved questions (resolved at `Active`)

Because `Active` locks the wire shape, all four opens are resolved in-RFC at the `Draft → Active` waiver. Each resolution adopts the floor and leaves the richer shape to a **future additive** field/sub-flag, so none narrows or pre-commits the locked surface:

1. **Streaming vs whole-file audio — RESOLVED: whole-file.** The Promise resolves with the finished asset (like `callImageGenerator`). A streaming/chunked variant, if ever needed, is advertised separately as an additive follow-on; it does not change this method's shape.
2. **Multi-voice in one call vs one-call-per-speaker — RESOLVED: one call per speaker.** Each `callSpeechSynthesizer` synthesizes one turn with one `voiceId`; the host/pack mixes the resulting clips. A single-call multi-speaker shape, if ever added, is a future additive field — it does not alter the locked single-speaker request.
3. **SSML support — RESOLVED: plain text in v1.** `text` is plain text; SSML is a future additive follow-on, gated behind an additive `speechSynthesis.ssml` sub-flag so plain-text callers are unaffected.
4. **Max text length — RESOLVED: `content_too_long` on overflow, no advertised cap in v1.** Overflow returns the existing shared `content_too_long` code (`host-capabilities.md` §host.aiProviders "Failure modes"); an advertised per-call character cap is a future additive follow-on.

## Implementation notes (non-normative)

This graduates the way RFC 0091 and RFC 0078 did: spec text + schema flag + capability advertisement + gated conformance scenarios + a reference host that advertises and passes. The reference host is **openwop-app** (ADR 0086 "multi-speaker podcasts"), whose `feature.podcasts.nodes` `synthesize` node is the first caller; that ADR is explicitly **blocked on this RFC reaching `Accepted`** before its Phase 3 (node pack) can ship. openwop-app already has a deterministic TTS **stub** (`backend/typescript/src/routes/mediaAssets.ts` → `POST …/media/synthesize`, returning a silent WAV when no live provider is wired) that demonstrates the call shape pre-adapter; wiring `ctx.callSpeechSynthesizer` over a real provider (ElevenLabs / OpenAI / Gemini TTS) through the BYOK/policy layer is the host work this RFC unblocks. `Draft → Active` waits on a steward wire-shape review (single-maintainer lazy consensus per `GOVERNANCE.md`); `Active → Accepted` waits on a host advertising the flag and passing the gated scenario non-vacuously.

## Acceptance criteria

- [ ] `host-capabilities.md` §host.aiProviders: `ctx.callSpeechSynthesizer` method block + sub-capability table row + §C failure codes (`speech_synthesis_unsupported`, `speech_synthesis_failed`).
- [ ] `capabilities.schema.json` `aiProviders.speechSynthesis` additive optional flag.
- [ ] `threat-model-prompt-injection.md` synthesized-audio-untrusted note (extends RFC 0091 §C).
- [ ] Conformance: `aiproviders-speechsynth-shape.test.ts` (always-on) + `speech-synthesis-roundtrip.test.ts` + `speech-synthesis-unadvertised.test.ts` (both gated).
- [ ] SDK `ctx` types add `callSpeechSynthesizer`; `CHANGELOG.md` + `INTEROP-MATRIX.md` rows.
- [x] All four Unresolved questions resolved in-RFC at the `Draft → Active` waiver (recorded in `Updated:` + §"Resolved questions").
- [ ] `Active → Accepted`: a reference host advertises `aiProviders.speechSynthesis` + passes the gated scenarios (openwop-app ADR 0086).

## References

- [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) §host.aiProviders — the `ctx.callImageGenerator` / `ctx.callVideoGenerator` blocks this parallels.
- [`RFCS/0091-multimodal-perception-input.md`](./0091-multimodal-perception-input.md) — audio _input_ (perception); this RFC is the output (generation) counterpart, and reuses its untrusted-media boundary + unadvertised-rejection pattern.
- [`SECURITY/threat-model-prompt-injection.md`](../SECURITY/threat-model-prompt-injection.md) — the untrusted-media boundary §D extends to synthesized audio.
- [`schemas/capabilities.schema.json`](../schemas/capabilities.schema.json) `aiProviders` — the additive flag site.
- openwop-app `docs/adr/0086-multi-speaker-podcasts.md` — the first reference consumer (blocked on this RFC).

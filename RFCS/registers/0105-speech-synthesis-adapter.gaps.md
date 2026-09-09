# RFC 0105 — Gap Register

Working document (not normative). Per `RFCS/README.md` § "Companion gap & risk registers", a
status flip to `Accepted` requires a **register sweep**: every open row must be closed,
transferred to a tracked surface, or carried forward as a named open gap in the RFC's
"Resolved questions" / "Open spec gaps" section.

Because this RFC lands at `Active` with the comment window **waived**, every gap that affects a
**wire shape** was resolved *in the RFC* before the flip (G1–G4 below, now Closed; see
§"Resolved questions"). The remaining open rows are deliberately non-wire-shape — they gate
`Accepted`, not `Active`.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|----|---------|--------------------------|-------|-----------------|--------|
| G1 | §A / Q1 | Streaming vs whole-file audio: does the method resolve with a finished asset, or expose a chunked/streaming variant? | Spec Architect | **CLOSED in §"Resolved questions" #1:** whole-file floor (Promise resolves with the finished asset, like `callImageGenerator`). A streaming variant is a separate future-additive advertisement; it does not change this method's shape. | was `Active` (shape lock) |
| G2 | §A / Q2 | Multi-voice in one call vs one call per speaker. | Spec Architect | **CLOSED in §"Resolved questions" #2:** one call per speaker — each call synthesizes one turn with one `voiceId`; host/pack mixes the clips. A single-call multi-speaker shape is a future additive field. | was `Active` (shape lock) |
| G3 | §A / Q3 | SSML in `text`, gated by a sub-flag? | Spec Architect | **CLOSED in §"Resolved questions" #3:** plain text in v1; SSML is a future additive follow-on behind an additive `speechSynthesis.ssml` sub-flag (plain-text callers unaffected). | was `Active` (shape lock) |
| G4 | §C / Q4 | Per-call max-text-length cap: advertised, or error-on-overflow? | Spec Architect | **CLOSED in §"Resolved questions" #4:** reuse the existing shared `content_too_long` on overflow; an advertised cap is a future additive follow-on. | was `Active` (shape lock) |
| G5 | §B | **Schema honesty:** `aiProviders` carries `additionalProperties:false` (`capabilities.schema.json:807`), yet `imageGeneration`/`videoGeneration` are **not** declared schema properties today — they live only in `host-capabilities.md` prose (`:76-77`). RFC 0105 would be the *first* generation-flag actually in the schema, so the §B "alongside imageGeneration/videoGeneration in the schema" framing is aspirational. A host advertising `imageGeneration:"supported"` is currently not strictly schema-valid. | Schema Architect | `carried:openwop.gap.0105.5` Adding `speechSynthesis: const "supported"` is correct + additive. **Carried forward (separate gap):** declare `imageGeneration`/`videoGeneration` in `capabilities.schema.json` for schema honesty — a separate additive fix, NOT scoped to 0105. Note in `ROADMAP.md` when 0105 flips `Accepted`. | none for 0105 (tracked-forward) |
| G6 | §A/§B/§C/§D | Spec text (`host-capabilities.md` method block + §C failure codes), the `capabilities.schema.json` flag, and `threat-model-prompt-injection.md` §D note are authored in the RFC but not yet landed in the corpus. | Spec Architect | `carried:openwop.gap.0105.6` **Sequenced to `Accepted`** (mirrors RFC 0103, which landed its spec doc + schemas + conformance at the Accepted flip #721, not at Active). The verbatim shapes are locked here; authoring + conformance bundle land with the Accepted graduation + a `@openwop/openwop-conformance` minor bump. | `Accepted` |
| G7 | Conformance | The three gated scenarios (`aiproviders-speechsynth-shape.test.ts` always-on, `speech-synthesis-roundtrip.test.ts` + `speech-synthesis-unadvertised.test.ts` gated) are specified but not yet in `@openwop/openwop-conformance`. | Conformance Architect | `carried:openwop.gap.0105.7` Author + publish in the same suite release as the §G6 spec text; gate on `aiProviders.speechSynthesis: supported` (soft-skip otherwise) per `coverage.md`. | `Accepted` |
| G8 | Reference host | No host advertises `aiProviders.speechSynthesis` + passes the gated round-trip non-vacuously yet. openwop-app (ADR 0086 multi-speaker podcasts) is the first intended consumer; its `feature.podcasts.nodes` `synthesize` node is blocked on this RFC reaching `Accepted`. | Reference-impl | `carried:openwop.gap.0105.8` Host-side prerequisite: openwop-app wires `ctx.callSpeechSynthesizer` over a real provider through the BYOK/policy layer and passes the gated scenario under `OPENWOP_REQUIRE_BEHAVIOR=true`; a second non-steward witness (e.g. MyndHyve) satisfies the dual-witness bar. | `Accepted` (reference-host checkbox) |
| G9 | SDK / docs | `ctx` types lack `callSpeechSynthesizer`; `CHANGELOG.md` + `INTEROP-MATRIX.md` rows pending. | SDK | `carried:openwop.gap.0105.9` Add the `ctx` method type (parallel to `callImageGenerator`) + the doc rows in the Accepted bundle. | `Accepted` |

**Register sweep — `Active` (2026-06-20).** G1–G4 are Closed in-RFC (wire-shape locks). G5–G9 are
non-wire-shape and gate `Accepted`, not `Active`. No open row blocks the `Draft → Active` waiver.

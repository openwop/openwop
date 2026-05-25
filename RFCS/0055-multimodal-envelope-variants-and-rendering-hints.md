# RFC 0055: Multimodal envelope variants & rendering hints (extend RFC 0031)

| Field | Value |
|---|---|
| **RFC** | 0055 |
| **Title** | Promote RFC 0031's reserved `vision-input` / `audio` model-capability identifiers into a formal vocabulary, and add an optional `meta.rendering` hint + `media.*` URL-reference convention to the AI envelope, so an LLM node can emit images / audio / files / structured cards that any consumer renders portably |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `spec/v1/ai-envelope.md` (new §"Rendering hints" + §"Media reference payloads") · `spec/v1/structured-output-subset.md` (informative cross-ref) · `schemas/ai-envelope.schema.json` (additive optional `meta.rendering`) · `schemas/capabilities.schema.json` (`aiProviders.modelCapabilities` identifier vocabulary, extending RFC 0031 §C) · RFC 0031 (extends its capability-identifier list) · `spec/v1/host-capabilities.md` (cross-ref to existing `ctx.callImageGenerator` / `ctx.callVideoGenerator` URL convention) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0031 §C reserved `vision-input`, `audio-output`, and `code-execution` as future model-capability identifiers but never defined them, and the AI envelope (`ai-envelope.md`) has no portable way to say "this payload is an image / an audio clip / a renderable card" — so every host and consumer invents its own convention and the reference app's chat surface can only render text and reasoning. This RFC (1) promotes a small, fixed set of model-capability identifiers into a formal vocabulary so packs can gate on them and consumers can know what the active model can consume/emit, and (2) adds an **optional** `meta.rendering` hint plus a `media.*` URL-reference payload convention to the envelope so emitted rich content renders consistently across any consumer. It deliberately does **not** add a real-time audio/video/screen/cursor *transport* — that is media plumbing OpenWOP composes with rather than owns (see Alternatives §4). Everything here is advertisement- or `meta`-level and ignorable by existing clients.

## Motivation

Two concrete pains, both visible in the corpus today:

1. **Capability vocabulary is half-defined.** RFC 0031 §C's open question #1 named `vision-input` / `audio-output` / `code-execution` as "identifiers that will materialize" and punted on whether they go through a full RFC. They have now materialized: every major provider ships vision input and several ship audio I/O, and `core.openwop.ai` pack authors have no portable string to gate on (`peerDependencies.aiProviders.modelCapabilities`). Without a fixed vocabulary, a pack that needs vision has to hard-code provider names, which is exactly the anti-pattern RFC 0031 §"Alternatives" rejected.

2. **The envelope can't describe how to render its payload.** `ai-envelope.md` defines `type` / `payload` / `meta` / `partial`, and `structured-output-subset.md` covers JSON-schema portability — but nothing tells a consumer "render this `payload.url` as an inline image" vs. "render this object as a card" vs. "this is base64 audio." The reference app's `MessageRenderer` / `EnvelopeInspector` (`apps/workflow-engine/frontend/react/src/chat/`) therefore special-cases text + reasoning and drops everything else to a raw JSON dump. Any other consumer (a debugger, a mobile client, a third-party host's UI) faces the same wall. A rendering hint is an **interop** concern — two consumers reading the same envelope should render it the same way — which is why it belongs in the spec, not in each app.

The host *generation* side already exists and already chose the right shape: `host-capabilities.md` §host.aiProviders defines `ctx.callImageGenerator` / `ctx.callVideoGenerator` returning a **host-served URL** ("videos are too large for inline base64", `host-capabilities.md:119`). This RFC carries that same URL-reference discipline into the *envelope* so an LLM-emitted image rides the same rails as a host-generated one.

## Proposal

### §A — `aiProviders.modelCapabilities` identifier vocabulary (extends RFC 0031 §C)

Promote the following identifiers from "reserved/illustrative" to the formal vocabulary a host advertises and a pack may gate on. This is a **closed enum** at v1.x; growth still requires an RFC (single-steward bootstrap rule, per RFC 0031 §C answer to OQ#1).

```diff
   "modelCapabilities": {
     "type": "array",
     "items": {
       "type": "string",
       "enum": [
         "structured-output",
         "tool-calling",
         "parallel-tool-calls",
         "json-mode",
-        "long-context"
+        "long-context",
+        "vision-input",
+        "audio-input",
+        "audio-output",
+        "image-output"
       ]
     }
   }
```

Semantics (normative, when advertised):

- `vision-input` — the active model accepts image content in the prompt. A pack declaring `peerDependencies.aiProviders.modelCapabilities: ["vision-input"]` MUST refuse to register on a host that does not advertise it, with the existing `host_capability_missing` discipline.
- `audio-input` / `audio-output` — the model accepts / emits audio content.
- `image-output` — the model emits images directly in its completion (distinct from the host-side `aiProviders.imageGeneration` generation surface, which is a separate tool call).

`code-execution` from RFC 0031 §C is **intentionally left out** of this enum — it is a sandbox/runtime concern that belongs with RFC 0035, not the model-capability vocabulary.

### §B — `meta.rendering` hint on the AI envelope (additive, optional)

Add an optional `rendering` object under the envelope's existing open `meta` field. It is a **hint**, not a contract: it never changes `payload` validation, and a consumer that doesn't recognize it MUST fall back to its default rendering (today: text / raw-JSON).

```diff
   "meta": {
     "type": "object",
+    "properties": {
+      "rendering": {
+        "type": "object",
+        "description": "RFC 0055. Optional hint for how a consumer SHOULD render this envelope's payload. Non-normative w.r.t. payload validation; unknown values fall back to default rendering.",
+        "properties": {
+          "display": {
+            "type": "string",
+            "enum": ["markdown", "code", "card", "image", "audio", "file"],
+            "description": "The renderer family the producer suggests."
+          },
+          "mimeType": { "type": "string", "description": "IANA media type when `display` is image/audio/file (e.g. `image/png`, `audio/mpeg`)." },
+          "lang": { "type": "string", "description": "Language tag when `display: code` (e.g. `python`)." },
+          "alt": { "type": "string", "description": "Text alternative for accessibility when `display` is image/audio/file. SHOULD be present for a11y." },
+          "title": { "type": "string", "description": "Optional short label a consumer MAY show as a caption / card header." }
+        },
+        "additionalProperties": false
+      }
+    },
     "additionalProperties": true
   }
```

Behavior:

- A producer (LLM node / host) MAY set `meta.rendering`. It MUST NOT be required for any payload to validate.
- A consumer SHOULD honor `display` when it recognizes the value and MUST degrade gracefully otherwise. `alt` SHOULD be rendered for assistive technologies whenever `display` is `image`/`audio`/`file`.
- `meta.rendering` carries **no secret material** and is subject to the same SR-1 redaction discipline as the rest of `meta`.

### §C — `media.*` URL-reference payload convention (normative when `display` is image/audio/file)

When `meta.rendering.display` is `image`, `audio`, or `file`, the payload SHOULD reference the asset by a host-served URL rather than inlining large binaries — mirroring the existing `ctx.callVideoGenerator` contract (`host-capabilities.md`):

```json
{
  "type": "media.image",
  "schemaVersion": "1.0",
  "envelopeId": "env_abc",
  "correlationId": "run_123:node_render",
  "payload": { "url": "https://host.example/v1/runs/run_123/assets/img_9.png", "bytes": 184320 },
  "meta": { "rendering": { "display": "image", "mimeType": "image/png", "alt": "Q3 revenue bar chart" } }
}
```

Normative rules:

1. A host that serves asset URLs MUST scope them to the run's tenant and MUST NOT make them globally guessable (capability-token or signed-URL discipline; reuse the interrupt signed-token recipe).
2. Inline base64 is permitted only below a host-advertised cap (`aiProviders.maxInlineMediaBytes`, default 256 KiB); above it the host MUST use a URL reference. This bounds event-log bloat and keeps replay payloads portable.
3. Asset URLs are part of a run's debug-bundle manifest (`debug-bundle.md`) by reference, never by inlining the binary.

`media.image` / `media.audio` / `media.file` are added as universal envelope `type` values alongside the existing universal kinds in `ai-envelope.md`; vendor-namespaced kinds remain available for anything richer.

## Compatibility

**Additive.** Three independent additive moves, each backward-safe:

- §A grows a **closed enum** by four values. Existing hosts advertise the subset they support; existing packs that don't gate on the new identifiers are unaffected. Adding enum members is additive per `COMPATIBILITY.md` §2.1 (a consumer that doesn't know a value simply never matches it).
- §B adds an **optional** field under an already-`additionalProperties: true` object. Existing producers don't emit it; existing consumers ignore it (the schema already tolerates unknown `meta` keys, so this is purely a *documentation + validation tightening of a known key*, not a wire break).
- §C adds **new universal `type` values** (additive event/envelope kinds — consumers that don't recognize them fall back to raw rendering) plus an **optional** `aiProviders.maxInlineMediaBytes` advertisement with a documented default.

No existing v1.x conformance pass is invalidated: a host that advertises none of the new identifiers, never sets `meta.rendering`, and never emits a `media.*` kind behaves exactly as before.

## Conformance

- **`envelope-rendering-hint-shape.test.ts`** — `meta.rendering` validates against the schema; an envelope with no `meta.rendering` still validates (proves optionality). (Always runs.)
- **`envelope-rendering-hint-ignored.test.ts`** — a consumer fixture given a `display` value it doesn't recognize falls back to default rendering without error. (Always runs.)
- **`model-capability-vision-gate.test.ts`** — a pack declaring `modelCapabilities: ["vision-input"]` registers on a host advertising it and refuses with `host_capability_missing` on one that doesn't. (Gated on `aiProviders.supported`.)
- **`media-url-inline-cap.test.ts`** — an emitted asset above `maxInlineMediaBytes` is served by URL, not inlined; the URL is tenant-scoped and not present in a cross-tenant view. (Gated on a host that advertises media emission.)
- **`media-url-debug-bundle-reference.test.ts`** — a run that emitted a `media.image` lists the asset by reference (not inline binary) in its debug bundle. (Gated on `debugBundle.supported`.)

New fixture: a `conformance.media.emit` fixture node that emits one `media.image` URL envelope + one inline-under-cap `media.audio` envelope, so the rendering/cap assertions have a deterministic producer.

## Alternatives considered

1. **Define each rendering family as its own envelope schema rather than a `meta` hint.** Rejected — payload shapes vary per provider and per pack; forcing a fixed schema per display family would either be too narrow (breaks the next provider) or balloon into a parallel type system. A hint over an open `meta` keeps the payload free and the rendering portable. The hint is advisory by design.
2. **Leave rendering entirely to each consumer (do nothing).** Rejected — that is the status quo, and it means the reference app, a debugger, and a mobile client each guess differently at the same envelope. Cross-consumer rendering consistency is an interop property; interop properties are why the spec exists.
3. **Open the `modelCapabilities` enum (free strings).** Rejected — free strings defeat gating (a pack can't reliably match `"vision"` vs `"vision-input"` vs `"image-understanding"`). RFC 0031 already chose a closed vocabulary; this RFC extends it under the same rule.
4. **Add a real-time audio/video/screen-capture/cursor streaming transport.** Rejected as **out of charter.** OpenWOP streams *events* (SSE / `RunEvent`), not media frames; live media transport is the kind of plumbing OpenWOP composes with (WebRTC, host media servers) rather than standardizes, consistent with the README "What OpenWOP is not" boundary and the A2A/MCP delegation pattern. This RFC covers *emitted multimodal artifacts*, which are envelope content, not a new transport.

## Unresolved questions

1. **Default `maxInlineMediaBytes`.** 256 KiB is a starting point chosen to keep event logs replay-friendly. Should it be lower (replay payload size) or higher (fewer round-trips for small images)? Resolve before Active with one adopter's real asset-size distribution.
2. **Asset retention / GC.** Host-served asset URLs need a retention policy that aligns with `replay.md` retention. Should an asset outlive its run's event-log retention so a forked run can still render it? Likely yes; pin the rule before Active.
3. **`audio-input` ingestion shape.** This RFC defines the *advertisement* for `audio-input` but not the inbound audio payload shape (how a workflow input carries audio). Defer the input shape to a follow-up unless an adopter needs audio *ingestion* (vs. emission) immediately.

## Implementation notes (non-normative)

- Schema diffs (§A, §B) + the new universal kinds land on `Active` promotion with the conformance scenarios.
- Reference-app payoff (drives the companion app work in `plans/app-ux-enhancements.md`): `MessageRenderer` switches on `meta.rendering.display` to render images / audio players / code blocks / cards inline; `EnvelopeInspector` shows the hint; the BYOK/model picker surfaces `modelCapabilities` so users see whether the chosen model supports vision before they attach an image.
- Reference-host target: `examples/hosts/postgres` advertises `maxInlineMediaBytes` + serves tenant-scoped asset URLs; the in-memory demo host can advertise inline-only (cap = 0 forces URL, or a small cap) to exercise both paths.

## Acceptance criteria

- [ ] Spec text merged (this file + `ai-envelope.md` §"Rendering hints" + §"Media reference payloads").
- [ ] `meta.rendering` in `ai-envelope.schema.json`; four new `modelCapabilities` enum values + optional `maxInlineMediaBytes` in `capabilities.schema.json`.
- [ ] `media.image` / `media.audio` / `media.file` documented as universal envelope kinds.
- [ ] Five conformance scenarios + `conformance.media.emit` fixture node.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] A host advertises a `modelCapabilities` superset including `vision-input` and serves a tenant-scoped media URL passing `media-url-inline-cap` + `media-url-debug-bundle-reference`.

## References

- [`RFCS/0031-envelope-variants-and-model-capabilities.md`](./0031-envelope-variants-and-model-capabilities.md) — the capability-identifier vocabulary this extends (§C, OQ#1).
- [`spec/v1/ai-envelope.md`](../spec/v1/ai-envelope.md) — the envelope this annotates.
- [`spec/v1/structured-output-subset.md`](../spec/v1/structured-output-subset.md) — companion JSON-schema portability reference.
- [`spec/v1/host-capabilities.md`](../spec/v1/host-capabilities.md) §host.aiProviders — the existing `ctx.callImageGenerator` / `ctx.callVideoGenerator` URL-reference convention this mirrors.
- [`spec/v1/debug-bundle.md`](../spec/v1/debug-bundle.md) — asset-by-reference export.
- [`plans/app-ux-enhancements.md`](../plans/app-ux-enhancements.md) — the reference-app UX work this unblocks.

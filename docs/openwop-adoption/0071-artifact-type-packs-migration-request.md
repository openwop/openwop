# MyndHyve migration request — RFC 0071 artifact-type packs (Phase 1)

**Status: 📤 Requested (2026-05-26) — awaiting MyndHyve advertisement + conformance run.**

This is the openwop-side request record for MyndHyve to adopt **RFC 0071 Phase 1 (artifact-type packs)**. It doubles as a fileable ask (open as an issue on the MyndHyve repo, or work it directly). The canonical acceptance evidence, once it lands, goes in [`../../INTEROP-MATRIX.md`](../../INTEROP-MATRIX.md); this file is the index + the migration map.

> **Why this matters.** `Active → Accepted` is gated on **at least one non-steward host advertising the capability + passing the conformance scenarios** (`RFCS/0001-rfc-process.md` §"Promotion to Accepted"). MyndHyve is the only non-steward host running, and it already built this exact concept downstream as its **Canvas Type** system — so this is a *map-what-you-have-onto-the-wire* migration, not new product work. RFC 0071 generalizes MyndHyve's `ArtifactTypeDefinition` + `CanvasManifest.artifactTypes[]` into the protocol; adopting it is what lets the whole industry consume MyndHyve-shaped artifacts portably.

> **Comment window:** waived by the maintainer. Phase-1 design is locked (architect pass resolved all six open questions). The wire surface is `Active` and stable — see [`../../RFCS/0071-artifact-type-and-chat-card-packs.md`](../../RFCS/0071-artifact-type-and-chat-card-packs.md) and [`../../spec/v1/artifact-type-packs.md`](../../spec/v1/artifact-type-packs.md).

---

## What we're asking MyndHyve to do

1. **Publish one artifact-type pack per Canvas Type** (`kind: "artifact-type"`), declaring the artifact types that canvas already produces — see the mapping in §"Migration map" below. Same signed-tarball + Ed25519 + SRI pipeline you already use for your node packs (`vendor.myndhyve.*`).
2. **Advertise `host.artifactTypes`** on `https://api.myndhyve.ai/.well-known/openwop` (curl-verifiable):
   ```jsonc
   "host.artifactTypes": {
     "supported": true,
     "store":  true,                       // you already persist canvas artifacts (Firestore)
     "render": true,                       // you have the React viewers
     "export": ["pdf", "pptx", "docx", "md", "png", "svg"]   // whatever your exporters actually produce
   }
   ```
   …plus the integer artifact-schema versions under the existing `capabilities.schemaVersions{}` map (e.g. `"vendor.myndhyve.prd": 1`).
3. **Bind your nodes:** a node that produces a canvas artifact sets `WorkflowNode.artifactType` (or pack-manifest `nodes[].artifact.typeId`) to the **registered** `artifactTypeId`. On completion, **schema-validate the artifact against the pack's schema before emitting `artifact.created`**, and stamp `registered: true`. Artifacts whose type isn't a registered pack stay valid but emit `registered: false` (your in-development types).
4. **Honor the two normative guarantees:**
   - **Store-without-render** (`artifact-type-packs.md` §host.artifactTypes): never fail a run solely because a host can store but not render a given type. (You render everything, so this is free for you — but advertise it honestly per context.)
   - **Bounded schema compilation** (R1 / `artifact-schema-compile-bounded`): bound size / `$ref`-depth / keyword-count + timeout when compiling a third-party artifact schema at install; reject over-bounds packs at registry `PUT` with `pack_validation_failed`. Reuse the same bounding you apply to node-pack manifests.

## Migration map — your `ArtifactTypeDefinition` → openwop `ArtifactType`

Your downstream type (`src/core/types/index.ts` `ArtifactTypeDefinition`) maps field-for-field, with the UI-coupled bits deliberately staying host-side per `positioning.md`:

| MyndHyve `ArtifactTypeDefinition` | openwop artifact-type-pack `ArtifactType` | Note |
|---|---|---|
| `typeId` (`artifact.prd`) | `artifactTypeId` — **reverse-DNS** (`vendor.myndhyve.prd`) | Rename to the scoped form; this is the value `WorkflowNode.artifactType` / `artifact.created.artifactType` carry. |
| `schema` (inline object) | `schemaRef` → a Draft-2020-12 file in the tarball | MUST set top-level `additionalProperties: false` + `$id` under `https://api.myndhyve.ai/schemas/artifacts/{artifactTypeId}.schema.json`. Serve it there too (runtime mirror). |
| (your integer schema version) | `schemaVersion` (integer) + advertise in `capabilities.schemaVersions{}` | Envelope-style integer, not semver. |
| `versionable` | `versionable` | 1:1. |
| `diffable` | `diffable` | 1:1 — feeds `:diff` tooling. |
| `icon`, `color` | **stays host-side** (your UI registry) | Not protocol surface. |
| `canvasTypeId` | **stays host-side** (your grouping) | Not protocol surface. |
| your artifact **viewers** (`PRDViewer`, `CADModelSpecViewer`, …) | `host.artifactTypes.render: true` only | The renderer is yours; the protocol carries only the advisory `rendering` hint. |
| your **exporters** (PPTX / pandoc / web) | `exportFormats: [...]` ids + `host.artifactTypes.export[]` | Identifiers only (`pdf`, `pptx`, …) — no byte semantics on the wire. |

### Suggested pack set (one per Canvas Type — maps to `src/canvas-types/*/artifacts/`)

| Pack (`kind: "artifact-type"`) | Declares `artifactTypeId`s |
|---|---|
| `vendor.myndhyve.app-builder` | `vendor.myndhyve.prd`, `.theme`, `.plan`, `.designSystem`, `.kanban`, `.code` |
| `vendor.myndhyve.documents` | `vendor.myndhyve.document` |
| `vendor.myndhyve.slides` | `vendor.myndhyve.presentationOutline`, `.slideContent`, `.presentationTheme` |
| `vendor.myndhyve.cad` | `vendor.myndhyve.cadModel`, `.bom`, `.complianceReport` |
| `vendor.myndhyve.drawings` | `vendor.myndhyve.colorPalette`, `.illustrationConcept`, `.brushPreset` |

(The `core.*` artifact types `prd`/`theme`/`plan`/`screen` in your `CORE_ARTIFACT_TYPE_IDS` should publish under `vendor.myndhyve.*` — `core.*` is reserved for the working group.)

## Acceptance evidence required (for `Active → Accepted`)

Mirror the 0045–0054 cohort evidence format ([`0045-0054-cohort-summary.md`](./0045-0054-cohort-summary.md)):

- **Suite:** `@openwop/openwop-conformance` ≥ the version shipping the 0071 scenarios (this PR adds them; pin the published minor once it cuts).
- **Discovery:** `https://api.myndhyve.ai/.well-known/openwop` advertises `host.artifactTypes.{supported,store,render,export}` + the `schemaVersions` entries — openwop-side curl-verified.
- **Conformance:**
  - `artifact-type-pack-manifest-validation.test.ts` — server-free, already passes (host-agnostic; validates your published pack manifests).
  - `artifact-schema-compile-bounded.test.ts` — server-free floor (always passes); the behavioral form (host rejects an over-bounds pack at `PUT`) verified via your registry.
  - **The two capability-gated behavioral scenarios** (install+validate → `artifact.created { registered: true }` after schema validation; store-without-render negotiation) — gated on `host.artifactTypes.supported`. These ship in this PR as `host-pending`; MyndHyve advertising the capability + wiring the path (or the documented `POST /v1/host/sample/artifacttypes/*` seam) is what flips them green and closes the gate.
- **Record:** an `INTEROP-MATRIX.md` row + a one-line README banner entry ("MyndHyve graduated RFC 0071 Phase 1 … on `workflow-runtime-XXXXX`, curl-verified").

## What this unblocks

Closing Phase 1 to `Accepted` is the proof that the artifact-type surface works cross-host. It also de-risks **Phase 2 (chat card packs, `kind: "card"`)**, whose `outputArtifactType` binding references exactly these registered artifact types — MyndHyve's `CardTemplateDefinition` model is the prior art there too (the portable kernel: `prompt.template` + `outputArtifactType` + `outputSchema`).

## References

- RFC: [`../../RFCS/0071-artifact-type-and-chat-card-packs.md`](../../RFCS/0071-artifact-type-and-chat-card-packs.md) (Phase 1 `Active`) + registers under `../../RFCS/registers/0071-*`
- Spec: [`../../spec/v1/artifact-type-packs.md`](../../spec/v1/artifact-type-packs.md), [`../../spec/v1/host-capabilities.md`](../../spec/v1/host-capabilities.md) §host.artifactTypes
- Schema: [`../../schemas/artifact-type-pack-manifest.schema.json`](../../schemas/artifact-type-pack-manifest.schema.json)
- Prior-art analysis (the MyndHyve → openwop mapping rationale): [`../OPENWOP-CANVAS-TYPE-PACKS-RESEARCH.md`](../OPENWOP-CANVAS-TYPE-PACKS-RESEARCH.md)
- PR: openwop/openwop#270

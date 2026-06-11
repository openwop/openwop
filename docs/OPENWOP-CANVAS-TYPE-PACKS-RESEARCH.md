# Research — Should OpenWOP define a "Canvas Type" (artifact-type) pack kind?

> **Status: Research / recommendation only.** This document evaluates whether openwop
> should promote the downstream "Canvas Type" concept into a first-class, spec-level
> pack capability. It does **not** author spec prose, schemas, or an RFC. If the
> recommendation is accepted, §8 sketches the RFC scope so it can feed `/prd`.
>
> Produced 2026-05-26. Inputs: `spec/v1/{node-packs,workflow-chain-packs,ai-envelope,
capabilities,host-capabilities,channels-and-reducers,positioning}.md`,
> `schemas/{node-pack-manifest,workflow-definition,run-event-payloads}.schema.json`,
> `registry/vendor.myndhyve.canvas/1.0.0/`, and the MyndHyve checkout at
> `/Users/david/dev/myndhyve` (`docs/CANVAS_TYPE_*`, `src/canvas-types/`,
> `src/core/types/index.ts`, `OPENWOP-RFC-ADOPTION.md`).

---

## 0. TL;DR

- **The question is not "should we invent canvases."** openwop already ships the latent
  infrastructure: a `kind` pack discriminator (`node`, `workflow-chain`, and an existing
  `prompt-pack-manifest.schema.json`), an **unspecified** `nodes[].artifact.{typeId,
syncOn, supportsCheckpoint}` field in the node-pack manifest schema, a free-string
  `artifact.created` run event, a `WorkflowNode.artifactType` tag, and AI Envelopes with
  per-kind payload schemas + advisory `meta.rendering` hints. The pieces exist but are
  uncoordinated and partly contract-free.
- **MyndHyve already built the full thing downstream** — `CanvasManifest` bundling
  `nodePack` + `cardPack` + `canvasPack` + `artifactTypes[]` + `collectionSchemas[]` +
  `workflowTemplates[]`. But what they _published_ to the openwop registry
  (`vendor.myndhyve.canvas`) encodes **none** of it — it's four opaque `canvasCreate/
Read/Write/crossCanvasInvoke` CRUD nodes with `additionalProperties: true` blobs. The
  entire canvas-type model lives above the protocol, inside their React/Fabric.js/Firestore
  stack.
- **The genuinely portable nucleus is small**: a distributable, signed, versioned
  declaration of an **artifact type** = `artifactTypeId` + JSON Schema + advisory
  rendering/export hints + sync/checkpoint semantics. Everything that makes a "Canvas
  Type" feel like a product (viewers, Zustand stores, Fabric.js canvas shell, chat-card
  registries) is UI-coupled and **must stay out of spec** per `positioning.md`.
- **Recommendation: Option C (narrow) — spec an `artifact-type` pack kind plus a host
  capability for store/render/export negotiation, and give the already-shipped-but-
  contract-free `nodes[].artifact` field its normative prose.** Do **not** spec
  "canvases," viewers, card packs, or canvas-pack rendering. Name it
  **artifact-type packs**, not "canvas packs" — the canvas is MyndHyve's product framing;
  the protocol concern is the typed artifact on the wire.

---

## 1. What a "Canvas Type" actually is downstream (the prior art)

MyndHyve's `CanvasManifest` (`src/core/types/index.ts:635`) is a **vertical solution pack**.
Its fields, classified by whether a protocol could ever own them:

| Manifest section                                                                                                               | What it is                                                                              | Protocol-portable?                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| identity (`canvasTypeId`, `version`, `name`, `publisher`, `tags`, `visibility`)                                                | metadata                                                                                | **Portable** (already mirrors pack identity)                                                                             |
| `nodePack` → `NodeTypeDefinition[]`                                                                                            | workflow node executors w/ typed ports (`type:'artifact'`), `configSchema`, `execution` | **Portable** (this is just node packs)                                                                                   |
| `artifactTypes[]` → `ArtifactTypeDefinition` (`typeId`, `schema`, `icon`, `color`, `versionable`, `diffable`)                  | declares the typed outputs nodes produce                                                | **Portable** — this is the nucleus                                                                                       |
| `collectionSchemas[]`                                                                                                          | domain data models                                                                      | Portable (plain JSON Schema)                                                                                             |
| `cardPack` → `CardTemplateDefinition` (`primaryPrompt`, `outputArtifactType`, `outputSchema`)                                  | chat-driven AI step cards                                                               | Partly — prompt text + output-type ref portable; `artifact-reference`/`canvas-reference` field types assume MyndHyve IDs |
| `canvasPack` → `CanvasTypeDefinition` / `CanvasComponentDefinition` (`coordinateSystem`, `defaultPageSize`, component palette) | visual editing surface                                                                  | **UI-coupled** — Fabric.js viewport concepts                                                                             |
| artifact **viewers** (`PRDViewer`, `CADModelSpecViewer`, …)                                                                    | React+MUI render components                                                             | **UI-coupled** — no wire form                                                                                            |
| `canvasExtension`, Canvas Shell plugin registries, Zustand stores                                                              | runtime UI plumbing                                                                     | **UI-coupled**                                                                                                           |
| **exporters** (PPTX, pandoc, web export)                                                                                       | no manifest field at all; service classes                                               | host-domain today                                                                                                        |

**The linkage that matters** (how a node says "I produce artifact X"): three uncoordinated
paths downstream — (A) a node output port with `type:'artifact'` (generic, doesn't name the
type); (B) `WorkflowNode.artifactType:'prd'` string on the instance, resolved by their
engine's `getRunArtifactByType()` and a runtime `ArtifactTypeRegistry` mapping the string to
`{envelopeType, chatCard, viewer, stage}`; (C) `CardTemplateDefinition.outputArtifactType`.
**Only (A) and the string tag are portable**; the registry resolution to viewers/cards is
the UI-coupled part.

**Crucial finding:** the artifact↔schema↔renderer coupling downstream is a _runtime string
registry_, not a schema-enforced relationship. That is exactly the kind of latent, unsafe
coupling a wire spec is good at hardening — and exactly what openwop has left contract-free
(see §2).

---

## 2. What OpenWOP already has (the surface), and why it doesn't close the loop

openwop is **further along than the original prompt assumed**. Existing surfaces:

1. **`kind` pack discriminator is real and extensible.** `node-packs.md` distinguishes
   `kind:"node"` and `kind:"workflow-chain"`, each validated against its own manifest
   schema at registry `PUT`. A **third** schema, `schemas/prompt-pack-manifest.schema.json`,
   already exists — so the pack-kind extension point has been exercised more than once. A
   `kind:"artifact-type"` slots in additively (the node schema's `const:"node"` would
   become a discriminated union).
2. **`nodes[].artifact` already exists in the manifest schema** — `schemas/node-pack-manifest.schema.json`
   lines 144–151: `{typeId, syncOn: completion|approval|manual, supportsCheckpoint}`.
   **It has zero normative prose in `node-packs.md` and zero conformance coverage.** This is
   a stub waiting for a contract.
3. **`artifact.created` run event** (`run-event-payloads.schema.json:599`) fires when a node
   "produces a typed artifact (PRD, theme, plan, etc.)" — but `artifactType` is a free
   string with `additionalProperties:true`, no schema pointer, no renderer.
4. **`WorkflowNode.artifactType`** (`workflow-definition.schema.json:154`) — first-class
   string tag, no schema attachment.
5. **AI Envelopes** (`ai-envelope.md`) are the most developed typed-output surface: `type`
   discriminator, `schemaVersion`, payload validated against
   `{HostBase}/schemas/envelopes/{K}.schema.json`, and **advisory** `meta.rendering`
   (`display: markdown|code|card|image|audio|file`, `mimeType`, `alt`, `title`). But the
   schema lives **host-private**, the flow is LLM→engine (inbound), and there's no export
   declaration and no host capability for "I can render kind K."
6. **`media.{image,audio,file}`** envelope kinds define asset-URL discipline but no
   schema+renderer+export bundle.

**Why the loop is open:** a node _cannot_ declare, in a normatively enforced and
distributable way, "I emit artifact type X conforming to schema Y, rendering hint Z,
exportable as W." The type tag is a free string; the schema (when it exists) is host-private
and undistributed; rendering is advisory-inbound-only; and there is **no capability key** to
negotiate store-vs-render-vs-export across hosts.

---

## 3. The gap, stated precisely

1. **No distributable artifact-type declaration.** Artifact schemas live on the host
   (envelope kinds) or in a downstream TypeScript registry (MyndHyve). They cannot be
   published, signed, versioned, or verified independently of the host that authored them.
2. **No schema binding for the type tag.** `WorkflowNode.artifactType` and
   `artifact.created.artifactType` are free strings. Two hosts using `"prd"` have no
   guarantee they mean the same shape.
3. **No store/render/export capability negotiation.** If host A can _store_ a
   `vendor.acme.cad-drawing` but not _render_ it, there is no capability key to advertise
   that and no refusal contract. (Today `runtimeCapabilities[]` is an opaque string list;
   `supportedEnvelopes[]` covers inbound LLM kinds only.)
4. **A shipped-but-undefined field.** `nodes[].artifact.{typeId,syncOn,supportsCheckpoint}`
   exists in the schema with no prose — a latent inconsistency the spec should either define
   or remove.

---

## 4. The "no UI" boundary — what must stay out of spec

`positioning.md` is explicit: _"openwop is the wire contract; engines implement that
contract,"_ and it "is not a BPMN renderer." The furthest the spec goes toward rendering is
the **advisory** `meta.rendering` hint and the `x-openwop-form` config annotation (RFC 0066),
both "advisory only, never changes validation, consumers MUST degrade gracefully."

Therefore the following are **permanently host-domain** and any proposal touching them should
be rejected:

- Artifact **viewers** / render components (MyndHyve's `PRDViewer`, Fabric.js canvas).
- `canvasPack` concepts: `coordinateSystem`, `defaultPageSize`, component palettes.
- Card packs as a UI invocation layer, chat-card registries, Zustand stores.
- Concrete **export implementations** (PPTX/pandoc). The spec may name an _export format
  identifier_ (a hint); it must not specify how bytes are produced.

The protocol's legitimate concern is the **typed artifact on the wire**: identity, schema,
sync/checkpoint lifecycle, and capability negotiation. That is a strict subset of
"Canvas Type."

---

## 5. Options

### Option A — Do nothing (status quo)

Leave artifact typing as a host concern; MyndHyve keeps its downstream registry.

- **Pro:** zero spec surface, zero interop risk, honest about the single-adopter reality.
- **Con:** leaves `nodes[].artifact` contract-free (a standing inconsistency); the free-string
  `artifactType` is a latent interop trap if a second host ever emits artifacts; no portability
  for the one feature the adopter most visibly built on top of openwop.

### Option B — Host-extension only (document, don't standardize)

Treat artifact types like `host.canvas` today: a vendor capability namespace, documented as
an extension pattern, with no core schema.

- **Pro:** low commitment; matches how `host.canvas` already works; reversible.
- **Con:** doesn't harden the free-string tag or distribute schemas; every host reinvents the
  registry; doesn't resolve the orphaned `nodes[].artifact` field.

### Option C — Narrow spec capability (RECOMMENDED)

Define an **`artifact-type` pack kind** + a **host `artifactTypes` capability** for
store/render/export negotiation + give `nodes[].artifact` its normative prose binding a node's
output to a registered artifact-type pack. **Explicitly excludes** viewers, card packs, canvas
rendering.

- **Pro:** distributable/signed/versioned artifact schemas; hardens the type tag to a
  registered id; gives the orphaned field a contract; clean store/render/export negotiation;
  reuses the proven `kind` discriminator and registry naming/signing wholesale.
- **Con:** real spec + schema + conformance surface; needs an RFC and triggers the gates
  (§7); risks scope-creep toward "canvases" if the boundary in §4 isn't policed.

### Option D — Full canvas-type pack (REJECTED)

Port the whole `CanvasManifest` (canvasPack, viewers, card UI) into spec.

- **Rejected:** violates the `positioning.md` "no rendering surface" invariant; ports
  UI-coupled, single-adopter concepts into a wire protocol; unbounded conformance burden.

---

## 6. Recommendation

**Adopt Option C, scoped tightly.** Rationale:

- It closes a _real_ protocol gap (undistributable schemas + free-string type) rather than
  chasing a product feature.
- It cleans up an existing inconsistency (`nodes[].artifact` with no prose) — this alone is
  worth a small RFC.
- The cost is bounded because the infrastructure is already present: the `kind` discriminator,
  registry naming/signing, and AI-envelope per-kind schema validation are all reusable.
- It stays on the correct side of the `positioning.md` line: standardize the _type and
  transport_, leave _rendering and editing_ to the host.

**Naming:** call it **artifact-type packs** (`kind:"artifact-type"`), not "canvas packs."
"Canvas" is MyndHyve's product surface; conflating them re-imports the UI boundary we are
trying to keep out.

**Sequencing note for the maintainer:** this overlaps the agent-runtime track
([[project_agent_runtime_gap]]) only in that both are "promote a downstream pattern into a
real consumed contract." It is independent and smaller. It is also a cleaner first proof that
the `kind` extension point generalizes beyond `node`/`workflow-chain`/`prompt`.

---

## 7. Before any code — governance + gates

Per repo memory and the working-group rules:

- **This needs an RFC.** Adding a pack kind + capability key is additive-but-normative.
  Run `/prd` (the openwop RFC-authoring workflow) once this research is accepted.
- **Single-maintainer reality.** openwop still claims FINAL v1 with one steward-maintainer;
  the non-steward maintainer tripwire hasn't fired ([[project_openwop_status]]). A new pack
  kind is exactly the kind of normative surface that wants a second reviewer — flag it.
- **Gates that will fire** (`scripts/openwop-check.sh`): step 7 `protocol:status` (new RFC ⇒
  sync `docs/PROTOCOL-STATUS.md` + README counts, see [[project_adding_rfcs_gate]]); registry
  `PUT` handler + a new `schemas/artifact-type-pack-manifest.schema.json`; conformance
  scenarios gated on the new capability; CHANGELOG `[Unreleased]`.
- **Signing unchanged:** Ed25519 `pack.json.sig` applies to all kinds ([[reference_pack_signing_keys]]).
- **Parallel-session hygiene:** do the RFC + schema work in a `git worktree` off
  `origin/main`, never in the shared checkout ([[feedback_parallel_agent_worktree]]).

---

## 8. RFC scope sketch (only if Option C is accepted — feeds `/prd`)

Five-architect pass should resolve, at minimum:

1. **Spec.** New `kind:"artifact-type"` section in `node-packs.md` (or a sibling
   `artifact-type-packs.md`). Define artifact-type identity (reverse-DNS, parallel to node
   `typeId`), the in-tarball schema reference, advisory rendering hint (reuse the
   `meta.rendering` vocabulary — do **not** invent a second one), and an export-format _hint_
   list (identifiers only, no byte semantics). Give `nodes[].artifact.typeId` its prose,
   binding it to a registered artifact-type pack.
2. **Schema.** `schemas/artifact-type-pack-manifest.schema.json`; turn the node manifest's
   `kind:const "node"` into a discriminated union; cross-reference `artifact.created.artifactType`
   and `WorkflowNode.artifactType` to the registered id (string ref, validated when the host
   advertises the capability).
3. **Security.** Schema-injection / unbounded-payload review for distributed artifact schemas;
   asset-URL discipline if artifacts carry binary refs (reuse `media.*` rules); signing already
   covered.
4. **Conformance.** Scenarios for: publish/fetch an artifact-type pack; node declares
   `artifact.typeId` ⇒ `artifact.created` validates against the pack schema; capability gating
   — host that stores-but-cannot-render refuses/degrades correctly.
5. **Compatibility.** Additive only: existing `kind:"node"` packs and free-string
   `artifactType` must keep working (the registered-id binding is opt-in behind the host
   capability). Version-negotiation: what an old engine does with an `artifact-type` pack it
   doesn't understand (registry `pack_kind_invalid` vs. graceful skip).

**Open questions to put to the maintainer before drafting:**

- Should the artifact _schema_ live inside the artifact-type pack, or continue to live at the
  host's `{HostBase}/schemas/envelopes/{K}` and merely be _referenced_? (Distribution vs.
  host-authority trade-off.)
- Is the new host capability `host.artifactTypes` (parallel to `host.canvas`) or a block under
  the existing `capabilities` advertisement?
- Do we deprecate the free-string `artifactType`, or permanently allow it as the
  "unregistered/local" escape hatch (mirrors `local.*` pack scope)?

---

## 9. Definition of done (for this research track)

- [x] Prior art extracted and portability-classified (§1).
- [x] Existing openwop surface mapped, including the latent/contract-free fields (§2–3).
- [x] `positioning.md` boundary stated as a hard constraint (§4).
- [x] Options enumerated with a defended recommendation (§5–6).
- [x] Governance gates and RFC scope sketched for handoff to `/prd` (§7–8).
- [ ] **Next action (maintainer):** accept/modify Option C, answer the three open questions in
      §8, then run `/prd` to author `RFCS/NNNN-artifact-type-packs.md`. No spec/schema written
      until then.

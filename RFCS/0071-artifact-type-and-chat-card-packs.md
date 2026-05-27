# RFC 0071: Artifact-Type Packs and AI Chat Card Packs

| Field | Value |
|---|---|
| **RFC** | 0071 |
| **Title** | Artifact-Type Packs and AI Chat Card Packs |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-26 |
| **Updated** | 2026-05-26 |

> **Phase 1 ACCEPTED (2026-05-27).** RFC 0071 **Phase 1 (artifact-type packs) graduated to `Accepted`** on MyndHyve's production adoption — the first non-steward host to advertise + honor `host.artifactTypes`. Steward-curl-verified at `https://api.myndhyve.ai/.well-known/openwop` (2026-05-27, revision `workflow-runtime-00396-cuj`): `capabilities["host.artifactTypes"]: {supported,store,render,export}` is served **unconditionally** (env gate dropped) with all 16 `vendor.myndhyve.*` `schemaVersions`, backed by a live `WorkflowNode.artifactType` validate-before-emit binding; the install + store-without-render + manifest-validation + bounded-compile conformance scenarios pass. [`spec/v1/artifact-type-packs.md`](../spec/v1/artifact-type-packs.md) is promoted DRAFT → FINAL; the R1 `artifact-schema-compile-bounded` invariant is enforced. **The RFC's overall `Status` stays `Active` because Phase 2 (chat card packs, `kind: "card"`) remains `Draft`** (gated on R2 + G9). Evidence: [`docs/openwop-adoption/0071-artifact-type-packs-myndhyve-adoption-evidence.md`](../docs/openwop-adoption/0071-artifact-type-packs-myndhyve-adoption-evidence.md).
>
> **Promotion note (2026-05-26):** Maintainer **waived the 7-day comment window** (`RFCS/README.md` §Process). The architect pass resolved all six original design questions (see §"Resolved design decisions") and the Phase-1 wire surface (`artifact-type-packs.md` + `artifact-type-pack-manifest.schema.json` + `node-packs.md` prose + `artifact.created.registered` + `§host.artifactTypes`) landed atomically, so **Phase 1 is `Active`** (wire shapes locked; conformance + reference-host implementation pending per the acceptance criteria). `Active → Accepted` for Phase 1 requires the R1 `artifact-schema-compile-bounded` invariant + test and the three conformance scenarios. **Phase 2 (chat card packs, `kind: "card"`) remains `Draft`** within this RFC pending G9 + R2.
| **Affects** | new `spec/v1/artifact-type-packs.md` (Phase 1), new `spec/v1/chat-card-packs.md` (Phase 2), `spec/v1/node-packs.md` (§"Manifest format" kind prose + `PackNode.artifact` prose), `spec/v1/host-capabilities.md` (§host.chat, new §host.artifactTypes), `spec/v1/capabilities.md`; new `schemas/artifact-type-pack-manifest.schema.json`, new `schemas/chat-card-pack-manifest.schema.json`, `schemas/run-event-payloads.schema.json`, `schemas/capabilities.schema.json`; `api/openapi.yaml`, `api/asyncapi.yaml`; conformance scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop distributes node packs, workflow-chain packs, and prompt packs, but it has no way to distribute the **typed artifacts** workflow nodes produce (documents, slides, app designs, CAD drawings) or the **prompt-driven AI chat cards** that generate them — both currently live as host-private runtime registries (MyndHyve) or hard-coded component switches (the OpenWOP demo app), keyed by unverifiable free strings. This RFC adds two new pack `kind`s — `artifact-type` and `card` — that make an artifact's schema + rendering hint + lifecycle, and a card's prompt template + output contract, distributable, signed, versioned, and capability-negotiable, and binds them to the already-shipped-but-contract-free `nodes[].artifact.typeId`, `WorkflowNode.artifactType`, `WorkflowNode.cardType`, and `artifact.created.artifactType` surfaces. It is strictly additive, phased (artifact-type packs first, chat card packs second), and deliberately stops at the wire contract: viewers, field widgets, and concrete export byte-production remain host-domain per `positioning.md`.

## Motivation

**Who hits this today.** The one real non-steward adopter (MyndHyve) built an entire "Canvas Type" system — a manifest bundling node pack + card pack + artifact types — on top of openwop, but what it actually *published* to the registry (`vendor.myndhyve.canvas`) encodes none of it: four opaque `canvasCreate/Read/Write/crossCanvasInvoke` CRUD nodes whose mutation/state shapes are `additionalProperties: true` blobs. The artifact-type and card models live entirely above the protocol, in a host-private runtime registry mapping free strings (`"prd"`, `"theme"`) to React viewers. The OpenWOP demo app independently re-implemented a `cardType: string → component` registry in `chat/registry/`. Two adopters, two incompatible private vocabularies, zero interop.

**Why the spec is the right place.** openwop already ships the *latent* surface for both concepts but left it contract-free:

- `schemas/node-pack-manifest.schema.json` defines a `PackNode.artifact` object — `{ typeId, syncOn, supportsCheckpoint }` — with **no normative prose in `node-packs.md` and no conformance coverage.**
- `schemas/workflow-definition.schema.json` defines first-class `WorkflowNode.artifactType` and `WorkflowNode.cardType` fields, both free strings with no schema attachment and no registry binding.
- `schemas/run-event-payloads.schema.json` emits `artifact.created` with a free-string `artifactType` and `additionalProperties: true`.
- `spec/v1/host-capabilities.md` §host.chat defines `ctx.chat.emitCard({ cardId, cardType, payload, idempotencyKey })`, gated on `host.chat.cards: supported` — the card *emission* runtime exists, but `cardType` is a free-form string the spec only illustrates.

Two hosts using `artifactType: "prd"` or `cardType: "prd.create"` have **no guarantee they mean the same shape.** A free-string tag with a host-private schema is exactly the latent interop trap a wire contract exists to harden. This RFC closes the loop without inventing new primitives: it reuses the proven `kind` pack discriminator (`node-packs.md` §"Manifest format", which already distinguishes `node`/`workflow-chain`/`prompt`, each with its own manifest schema), the AI-envelope per-kind schema convention (`ai-envelope.md` §"Canonical schema location"), and the `host.*` capability pattern (`host-capabilities.md` §"The contract pattern").

## Proposal

The RFC is **phased**. Phase 1 (artifact-type packs) is self-contained and the merge target for `Active`. Phase 2 (chat card packs) depends on Phase 1's `outputArtifactType` linkage and lands at a later `Active` milestone.

### Mechanism: new pack kinds are additive, not a schema rewrite

Each existing pack kind ships its **own** manifest schema and its own `kind` const (`node-pack-manifest` `kind: "node"`, `workflow-chain-pack-manifest` `kind: "workflow-chain"`, `prompt-pack-manifest` `kind: "prompt"`). The registry already selects the validating schema by the manifest's `kind` and rejects mixed content with `pack_kind_invalid`. This RFC follows that pattern exactly: it adds two **new** manifest schemas, each with its own `kind` const, and **does not modify** `node-pack-manifest.schema.json` (its `kind: "node"` const stays). The only prose edit to `node-packs.md` is to extend the "Pack kinds" paragraph to name the new kinds.

### Phase 1 — Artifact-Type Packs (`kind: "artifact-type"`)

New doc `spec/v1/artifact-type-packs.md` (Status: DRAFT) and new schema `schemas/artifact-type-pack-manifest.schema.json` (`$id: https://openwop.dev/spec/v1/artifact-type-pack-manifest.schema.json`).

**Manifest shape** (`kind: "artifact-type"`, `required: ["name","version","kind","engines","artifactTypes"]`):

```diff
+{
+  "kind": "artifact-type",
+  "name": "vendor.acme.cad",
+  "version": "1.0.0",
+  "engines": { "openwop": ">=1.1 <2.0.0" },
+  "artifactTypes": [{
+    "artifactTypeId": "vendor.acme.cad.model",
+    "schemaVersion": 1,
+    "schemaRef": "schemas/cad-model.schema.json",
+    "rendering": { "display": "file", "mimeType": "model/step" },
+    "exportFormats": ["step", "stl", "pdf"],
+    "syncOn": "completion",
+    "supportsCheckpoint": true
+  }]
+}
```

Normative requirements (full prose in `spec/v1/artifact-type-packs.md`):

- A manifest **MUST** set `kind: "artifact-type"` and declare a non-empty `artifactTypes[]`; it **MUST NOT** declare `nodes[]`/`chains[]`/`prompts[]` (one kind per pack).
- Each `artifactTypeId` **MUST** be reverse-DNS scoped; `core.*` is reserved.
- `schemaRef` **MUST** resolve to a Draft-2020-12 schema inside the tarball with top-level `additionalProperties: false` and an `$id` under `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json`.
- `rendering` is **OPTIONAL** and **MUST** reuse the `ai-envelope.md` §"Rendering hints" vocabulary (advisory; consumers degrade gracefully; `card` display reserved for envelopes). No second rendering vocabulary is introduced.
- `exportFormats` is **OPTIONAL** format-identifier hints only; this RFC **MUST NOT** specify byte production.

**Binding the contract-free surfaces** (when `host.artifactTypes: supported`): a `PackNode.artifact.typeId` / `WorkflowNode.artifactType` / `artifact.created.artifactType` value that matches a registered `artifactTypeId` is *registered* — the host **MUST** validate the payload against the pack schema before emitting `artifact.created`. A value matching no registered type remains valid (unregistered escape hatch, mirroring `local.*`): the host **MUST NOT** reject or schema-validate it, and **SHOULD** mark `artifact.created.registered: false`.

**New host capability §host.artifactTypes** advertises store/render/export independently:

```json
"host.artifactTypes": { "supported": true, "store": true, "render": false, "export": ["pdf"] }
```

A host advertising `render: false` for a type it can store **MUST** still accept and store it and **MUST NOT** fail the run for lack of a renderer. This is the cross-host negotiation the spec lacks today.

**`artifact.created` schema delta** (`run-event-payloads.schema.json`): add optional `registered: boolean` (absent ⇒ true).

### Phase 2 — AI Chat Card Packs (`kind: "card"`)

A card is `(inputs + prompt) → LLM call → typed artifact`. New doc `spec/v1/chat-card-packs.md` (DRAFT) and `schemas/chat-card-pack-manifest.schema.json`.

**Manifest shape** (`kind: "card"`, `required: ["name","version","kind","engines","cards"]`):

```diff
+{
+  "kind": "card",
+  "name": "vendor.acme.cad-cards",
+  "version": "1.0.0",
+  "engines": { "openwop": ">=1.1 <2.0.0" },
+  "peerDependencies": { "host.aiEnvelope": "supported", "host.chat.cards": "supported" },
+  "cards": [{
+    "cardTypeId": "vendor.acme.cad.model.create",
+    "prompt": { "template": "Design a model for: {{spec}}", "placeholderMapping": { "spec": "inputs.spec" }, "temperature": 0.2 },
+    "inputs": [{ "id": "spec", "type": "text", "label": "Part spec", "required": true }],
+    "outputArtifactType": "vendor.acme.cad.model",
+    "outputSchemaRef": "schemas/cad-model.schema.json"
+  }]
+}
```

Normative requirements:

- `kind: "card"` with non-empty `cards[]`; reverse-DNS `cardTypeId`.
- `prompt.template` + `prompt.placeholderMapping` **REQUIRED**; the host **MUST** substitute mapped inputs and route the call through `ctx.aiEnvelope.generate(...)`.
- `outputArtifactType` **OPTIONAL**; when present **MUST** reference an installed artifact-type pack's `artifactTypeId` (the Phase 1 linkage); the host **MUST** validate the LLM output against that type's schema and emit `artifact.created`.
- `inputs[].type` is a **closed portable enum** `text|longtext|number|boolean|select|artifact-ref`. MyndHyve's `canvas-reference`/`collection-reference` widget types and i18n keys are **out of scope** (host-UI). A host **MAY** add a `vendor.*`-prefixed type others ignore.

**Binding `WorkflowNode.cardType` and `ctx.chat.emitCard`** (when new sub-flag `host.chat.cardPacks: supported`): a `WorkflowNode.cardType` / `emitCard` cardType value **SHOULD** reference a registered `cardTypeId`; existing free-form values (`'progress'`, `'approval'`) remain valid. `host.chat.cards` behavior is unchanged.

### Examples

**Positive** (artifact-type pack): the manifest above with a resolvable `schemaRef` (top-level `additionalProperties: false`). **Negative** (`pack_kind_invalid`): a manifest declaring both `artifactTypes[]` and `nodes[]`. **Negative** (schema error): `artifactTypeId` of `core.openwop.cad.model` from a non-core account; `rendering.display` of `"3d-viewport"` (closed enum).

## Compatibility

**Classification: additive** per `COMPATIBILITY.md` §2.1.

- **New pack kinds** are new optional registry content with new manifest schemas; `node-pack-manifest.schema.json` is **unchanged**. Hosts that don't support them advertise no capability and reject installs as today (§2.1: new endpoints/optional capabilities MAY be added).
- **`artifact.created.registered`** is a new optional field, default `true`; existing clients ignore it, existing servers omit it — the default preserves today's "every artifactType accepted" semantics.
- **Free-string `artifactType`/`cardType`** remain valid (unregistered escape hatch). The RFC adds a `SHOULD` and a *conditional* `MUST` (validate iff registered **and** capability advertised); it relaxes no existing `MUST` and rejects no input that previously succeeded (§4: new normative requirement on previously-undefined behavior = additive).
- **`PackNode.artifact`** gains prose, not shape.
- **§host.artifactTypes** and **§host.chat.cardPacks** are off by default.

Spec **minor** bump; no major bump. No `version-negotiation.md` runbook needed (no negotiation-axis change).

## Conformance

**Existing adjacent:** `pack-registry-publish.test.ts`, `workflow-chain-pack-manifest-validation.test.ts`, `prompt-pack-install.test.ts`, `envelope-rendering-hint.test.ts` (RFC 0055 closed `display` enum), `workflow-primary-output-annotation.test.ts` (RFC 0065).

**New (Phase 1):** `artifact-type-pack-manifest-validation.test.ts` (server-free: valid passes; mixed-kind rejected; core-scope-from-non-core rejected; unknown `display` rejected; empty `artifactTypes` rejected; <1s); `artifact-type-pack-install.test.ts` (publish→install→registered validates; unregistered accepted with `registered:false`; gated on `host.artifactTypes.supported`); `artifact-type-store-without-render.test.ts` (`store:true,render:false` stores and does not fail run).

**New (Phase 2):** `chat-card-pack-manifest-validation.test.ts` (closed `inputs[].type` enum; `vendor.*` tolerated); `chat-card-pack-execution.test.ts` (prompt routed through `ctx.aiEnvelope.generate`; output validated against linked `outputArtifactType`; gated on `host.chat.cardPacks.supported`).

All behavior scenarios use `describe.skipIf(!driver.capabilities.<flag>)` per `conformance/coverage.md`. New flags: `host.artifactTypes.supported`, `host.chat.cardPacks.supported`. Behavior grade starts `host-pending`. New fixtures `conformance-artifact-type`, `conformance-chat-card` + `fixtures.md` rows. INTEROP-MATRIX gains `host.artifactTypes` (store/render/export) + `host.chat.cardPacks` columns.

## Alternatives considered

1. **Do nothing.** Leave artifact/card typing host-private. *Rejected:* leaves `PackNode.artifact` contract-free, guarantees any second artifact-producing host is non-interoperable with MyndHyve, and wastes the feature the sole adopter most visibly built on openwop.
2. **Host-extension only** (document `host.artifactTypes` as a vendor capability, no pack kind, like `host.canvas`). *Rejected:* doesn't make schemas distributable/signed/verifiable, doesn't harden the free-string tag, leaves every host reinventing the registry, and leaves `PackNode.artifact` undefined.
3. **One combined "canvas-type" pack** porting MyndHyve's full manifest (node + card + canvas + viewers). *Rejected:* violates `positioning.md` ("openwop is the wire contract … not a renderer"); imports UI-coupled single-adopter React/Fabric.js concepts; unbounded conformance burden.
4. **Fold cards into the existing `prompt` pack kind.** *Considered, deferred to Q4:* prompt packs distribute reusable prompt fragments; cards are prompt + typed-output-artifact + input contract. Possibly unifiable, but conflating now risks overloading `prompt-pack-manifest.schema.json`.

## Resolved design decisions

The architect pass resolved all six original open questions, optimizing for low-friction adoption and consistency with existing corpus idioms. Each is now baked into the Phase 1 spec/schema:

1. **Schema home → in-tarball source of truth + optional host-served mirror.** The schema travels in the signed tarball at `schemaRef` (offline-verifiable, no host infra required to publish — matching node packs' `*SchemaRef`); a host that installs the pack and renders SHOULD *additionally* serve it at `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json` for runtime discovery by non-installing consumers (the envelope canonical-URL convention). Both copies MUST be byte-identical. Best of both: verifiable distribution *and* frictionless resolution, neither forced.
2. **Capability shape → single `host.artifactTypes` object** with `store` / `render` / `export[]` facets, not dotted sub-capabilities. `export` carries a list (impossible as a boolean dotted key), and the facets are negotiated together rather than dispatched as independent methods (the distinction that justifies `host.canvas.create`'s dotted form).
3. **Unregistered types → permanent first-class tier.** Free-string `artifactType` is the `local.*`-scope analog and the adoption on-ramp; `registered: false` is a permanent, honest signal, not a transitional wart. Registration governs whether a shape is bound to a distributed contract — never a precondition for producing artifacts.
4. **Card kind → distinct `kind: "card"`.** A prompt pack distributes reusable prompt fragments surfaced via `GET /v1/prompts`; a card is a higher-order composite (input contract + prompt + output-artifact binding) consumed via `WorkflowNode.cardType` / `ctx.chat.emitCard`. A card MAY *reference* a prompt-pack template (composition over absorption), keeping the surfaces clean and DRY.
5. **Versioning axis → integer `schemaVersion`** on the artifact type, riding the existing `capabilities.schemaVersions: Record<string, number>` advertisement; the *pack* keeps SemVer. This is the exact envelope split; semver minor/patch is meaningless for a wire schema.
6. **`exportFormats` → reserved core identifier set + `vendor.*`/`x-` extension.** A core vocabulary (`pdf`, `pptx`, `docx`, `md`, `html`, `png`, `svg`, `csv`, `json`, `step`, `stl`, …) carries interoperable meaning; domain formats extend via prefixed identifiers. Mirrors the `requiredModelCapabilities` idiom — interop without a codec spec.

## Remaining open items (gate Phase-1 `Active`)

1. **R1 — bounded artifact-schema compilation.** Distributed schemas are attacker-controllable input the engine compiles (Ajv). Before `Active`: bound schema byte-size, `$ref` depth, and keyword count at registry `PUT` and at install; compile under a timeout; reject catastrophic-backtracking `pattern`s. Land a protocol-tier `artifact-schema-compile-bounded` MUST-NOT in `SECURITY/invariants.yaml` + a public conformance test (`scripts/check-security-invariants.sh` gate). Extends `SECURITY/threat-model-node-packs.md`.
2. **R2 — card-input trust boundary (Phase 2).** Card `prompt.template` interpolates workflow inputs; those derive `EnvelopeMeta.contentTrust: 'untrusted'` and MUST propagate through `ctx.aiEnvelope.generate`. Document in `SECURITY/threat-model-prompt-injection.md` + assert trust-tag propagation in `chat-card-pack-execution`.
3. **G9 — portable card input-field subset.** Confirm the `inputs[].type` closed enum (`text|longtext|number|boolean|select|artifact-ref`) against MyndHyve's field types before Phase 2 schema freeze.

## Implementation notes (non-normative)

- **Sequencing:** Phase 1 is independently shippable and should reach `Accepted` before Phase 2 (whose `outputArtifactType` references Phase 1's registry). `/plan 0071` produced two milestone tracks.
- **Reuse, don't reinvent:** registry `PUT` already validates per-`kind` and emits `pack_kind_invalid`; adding two kinds = two new manifest schemas + registry recognizing two new `kind` values. `node-pack-manifest.schema.json` is untouched. Signing (Ed25519) and naming are inherited.
- **Gate (`scripts/openwop-check.sh`):** new RFC + two spec docs + two schemas trigger **step 7** (`generate-protocol-status.mjs --check`): update `README.md` corpus + RFC counts, then `npm run protocol:status`. **Step 9** (`check-security-invariants.sh`) fires if a new MUST-NOT lands (see Risk R1). OpenAPI/AsyncAPI (steps 5–6) need the new manifest component(s).
- **Security:** distributed artifact/output schemas are attacker-compilable input (Ajv) — bound size/`$ref`-depth at registry `PUT`, add a protocol-tier MUST-NOT invariant + public test (R1). Card prompt templates are a prompt-injection surface — mandate `contentTrust='untrusted'` propagation (R2).
- **Governance:** a new normative pack kind merging under a single steward-maintainer (the non-steward tripwire has not fired — `GOVERNANCE.md`, `ROADMAP.md`) warrants the full RFC comment window; solicit MyndHyve as external reviewer.
- **Reference consumers:** demo app `chat/registry/CardHost.tsx` and MyndHyve's runtime registries; neither has live card definitions yet, so Phase 2 defines the wire shape without breaking existing data.

## Acceptance criteria

- [x] Spec text merged: `artifact-type-packs.md` (**FINAL**), `chat-card-packs.md` (DRAFT, Phase 2), §host.artifactTypes + §host.chat.cardPacks, `node-packs.md` `PackNode.artifact` prose. (#270)
- [x] Schemas merged: `artifact-type-pack-manifest.schema.json`, `chat-card-pack-manifest.schema.json`, `run-event-payloads.schema.json` (`registered`). (`host.*` capabilities advertise via the discovery open-set, not `capabilities.schema.json` — see `host-capabilities.md` §"The contract pattern"; no OpenAPI/AsyncAPI change — packs reuse the existing registry endpoints.)
- [x] ≥1 conformance scenario per phase incl. the `store-without-render` negotiation scenario. (4 Phase-1 + 2 Phase-2 scenarios)
- [x] CHANGELOG entry under the spec-minor heading.
- [x] **Phase 1:** the non-steward MyndHyve `workflow-runtime` host implements `host.artifactTypes` store-side + passes the scenarios (steward production-curl-verified 2026-05-27) — **Phase 1 `Accepted`**.

**Remaining for the RFC overall (keeps `Status: Active`): Phase 2 (`kind: "card"`) → Active** needs the R2 `chat-card-input-trust-boundary` proof passing against a host + G9 (confirm the `inputs[].type` subset with MyndHyve).

## References

- Spec docs: `spec/v1/node-packs.md` §"Manifest format", §Naming; `spec/v1/ai-envelope.md` §"Rendering hints", §"Canonical schema location"; `spec/v1/host-capabilities.md` §host.chat, §host.aiEnvelope, §"The contract pattern"; `spec/v1/capabilities.md` §"Network-handshake shape"; new `spec/v1/artifact-type-packs.md`.
- Schemas: `schemas/node-pack-manifest.schema.json` (`PackNode.artifact`), `schemas/workflow-definition.schema.json` (`artifactType`, `cardType`), `schemas/run-event-payloads.schema.json` (`artifactCreated`), `schemas/prompt-pack-manifest.schema.json` (third-kind precedent), new `schemas/artifact-type-pack-manifest.schema.json`.
- Related RFCs: RFC 0013 (workflow-chain packs — pack-kind precedent), RFC 0028 (prompt packs — third-kind precedent), RFC 0055 (`meta.rendering` — vocabulary reused), RFC 0065 (`outputRole`), RFC 0066 (`x-openwop-form` — advisory-UI-hint precedent).
- Prior art: MyndHyve `CanvasManifest`/`CardTemplateDefinition`/`ArtifactTypeDefinition`; OpenWOP demo app `chat/registry/CardHost.tsx`; npm pack-kind / Helm chart-type discriminators; MCP resource typing.
- Research: `docs/OPENWOP-CANVAS-TYPE-PACKS-RESEARCH.md`.
- Companion registers: `RFCS/registers/0071-artifact-type-and-chat-card-packs.gaps.md`, `RFCS/registers/0071-artifact-type-and-chat-card-packs.risks.md`.

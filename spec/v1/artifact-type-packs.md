# openwop Spec v1 — Artifact-Type Packs

> **Status: Stable · v1.1 (2026-05-27; amended by [RFC 0075](../../RFCS/0075-artifact-type-packs-realworld-amendment.md) 2026-05-27).** **RFC 0075 (real-world adoption amendment)** folds in the gaps the first AI-native adopter (MyndHyve) surfaced: a **host-registered** tier with `registrationSource` (P0-1), `additionalProperties:false` relaxed MUST→SHOULD + a `validation: "open"\|"closed"` field for AI-produced artifacts (P0-2), per-type capability facets + `validated`-vs-`schemaVersions` decoupling (P1-1/P1-2), and serving the canonical schema URL as a MUST for no-pack types (P1-3). All additive or MUST→SHOULD relaxations — existing conformance unaffected. Phase 1 of [RFC 0071 — Artifact-Type Packs and AI Chat Card Packs](../../RFCS/0071-artifact-type-and-chat-card-packs.md), promoted DRAFT → FINAL on MyndHyve's production adoption: the non-steward `workflow-runtime` host advertises `host.artifactTypes` unconditionally on `api.myndhyve.ai` (steward curl-verified 2026-05-27, revision `workflow-runtime-00396-cuj`) with a live `WorkflowNode.artifactType` validate-before-emit binding, and passes the manifest-validation + install + store-without-render conformance scenarios. Specifies a pack kind that publishes **typed artifact definitions** — the schema, rendering hint, lifecycle, and export-format hints for the rich outputs workflow nodes produce (documents, slides, app designs, CAD drawings). Phase 2 (chat card packs) graduated to `Accepted` (2026-05-27) — see [`chat-card-packs.md`](./chat-card-packs.md). Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

---

## Why this exists

Workflow nodes already produce typed artifacts — a PRD, a slide deck, a CAD model — and the protocol already carries a thin trace of them: `WorkflowNode.artifactType` (a string tag), the `artifact.created` run event, and an undocumented `nodes[].artifact` block in the node-pack manifest. But the **shape** of an artifact — its JSON Schema, how a consumer should render it, what export formats it offers — has nowhere to live on the wire. Today that shape is host-private: one adopter resolves the free string `"prd"` to a React viewer through an in-memory registry; another would resolve the same string to something else. Two hosts using `artifactType: "prd"` have no guarantee they mean the same thing, and no host can publish an artifact definition for another to consume.

An **artifact-type pack** is the distribution unit for that missing shape. It is a signed, versioned tarball — the same pipeline that already serves node, workflow-chain, and prompt packs (`node-packs.md` §Distribution) — whose manifest declares one or more artifact types. Each declaration binds an `artifactTypeId` to a JSON Schema, an advisory rendering hint, and a lifecycle. Hosts that advertise `host.artifactTypes` validate produced artifacts against the registered schema and negotiate, per type, whether they can **store**, **render**, or **export** it.

This doc deliberately stops at the wire contract. It does **not** specify viewers, editing surfaces, or how export bytes are produced — those are host-product concerns per `positioning.md`. It specifies the *type and transport* of an artifact; the host owns *rendering and editing*.

This is distinct from neighbouring primitives: an **AI envelope** (`ai-envelope.md`) is an LLM-inbound structured message validated per-kind; an **artifact** is the durable, node-produced output an envelope may carry into. A **channel** (`channels-and-reducers.md`) is run-scoped mutable state; an artifact is a registered, durable, externally-referenceable deliverable. An artifact-type pack reuses the envelope rendering-hint vocabulary and the pack distribution pipeline rather than introducing new machinery.

---

## Pack kind

Artifact-type packs are a fourth pack `kind`, peer to `node`, `workflow-chain` (`workflow-chain-packs.md`), and `prompt` (`prompts.md` §"Discovery & distribution"). The four kinds share the `pack.json` filename and the signed-tarball + Ed25519 + SRI pipeline; they are disjoint via the top-level `kind` discriminator and each validates against its own manifest schema.

A manifest with `kind: "artifact-type"` validates against [`artifact-type-pack-manifest.schema.json`](../../schemas/artifact-type-pack-manifest.schema.json). It MUST declare a non-empty `artifactTypes[]` and MUST NOT declare `nodes[]`, `chains[]`, or `prompts[]`; mixing kinds is rejected at registry `PUT` with `pack_kind_invalid` (`node-packs.md` §"Registry HTTP API"), consistent with the existing one-kind-per-pack rule.

## Manifest format

```json
{
  "kind": "artifact-type",
  "name": "vendor.acme.cad",
  "version": "1.0.0",
  "engines": { "openwop": ">=1.1 <2.0.0" },
  "artifactTypes": [
    {
      "artifactTypeId": "vendor.acme.cad.model",
      "schemaVersion": 1,
      "schemaRef": "schemas/cad-model.schema.json",
      "displayName": "Parametric CAD Model",
      "rendering": { "display": "file", "mimeType": "model/step", "title": "CAD model" },
      "exportFormats": ["step", "stl", "pdf"],
      "syncOn": "completion",
      "supportsCheckpoint": true,
      "versionable": true,
      "diffable": false
    }
  ],
  "signing": { "publicKeyRef": "keys/2026-05.pem", "signatureRef": "pack.json.sig" }
}
```

### Required fields

| Field | Description |
|---|---|
| `kind` | MUST be the literal `"artifact-type"`. |
| `name` | Reverse-DNS pack name per `node-packs.md` §Naming. Reserved scopes are identical (`core.*` / `vendor.<org>.*` / `community.<author>.*` / `private.<host>.*`; `local.*` not published). |
| `version` | Pack-level SemVer 2.0.0. |
| `engines.openwop` | Semver range of protocol versions this pack works against. |
| `artifactTypes[]` | One or more artifact-type declarations. Each `artifactTypeId` MUST be unique within the pack. |

### Optional fields

`description`, `author`, `license`, `homepage`, `repository`, `keywords[]`, `dependencies` (other packs), `signing` (see `node-packs.md` §signing).

### The `ArtifactType` declaration

| Field | Req. | Description |
|---|---|---|
| `artifactTypeId` | MUST | Reverse-DNS `<scope>.<author>.<name>` identifier, same pattern as pack `name`. Third parties MUST NOT publish under `core.*`. This is the value `WorkflowNode.artifactType`, `nodes[].artifact.typeId`, and `artifact.created.artifactType` reference. |
| `schemaRef` | MUST | Path inside the pack tarball to the artifact's JSON Schema (Draft 2020-12). The target schema **SHOULD** set `additionalProperties: false` at its top level when the type is a `closed`-`validation` contract, and **MUST** declare an `$id` under the publishing host's `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json` namespace, mirroring the envelope convention in `ai-envelope.md` §"Canonical schema location". **(RFC 0075, amending RFC 0071.)** The strict-`additionalProperties:false` requirement was relaxed from MUST to SHOULD: a closed-world artifact contract contradicts the protocol's own forward-compatibility mandate (`COMPATIBILITY.md` §2.1 — *consumers MUST ignore unknown fields*), and the first AI-native adopter cannot meet it (LLM output carries drift, extra fields, and reasoning slots that a strict schema rejects). See the `validation` field below; consumers MUST NOT assume closed-world shape unless the schema declares `validation: "closed"`. |
| `validation` | SHOULD | `"open"` or `"closed"` (RFC 0075). Advertises the strictness contract of the artifact's schema. `"closed"` ⇒ the schema is a closed-world contract (`additionalProperties: false`); a consumer MAY rely on the absence of unknown fields. `"open"` (recommended for AI/LLM-produced artifacts) ⇒ the schema tolerates extra fields (`additionalProperties: true`/absent) to absorb model drift; consumers MUST ignore unknown fields per `COMPATIBILITY.md` §2.1. Absent ⇒ `"open"` (the forward-compatible default; a consumer MUST NOT assume closed-world). The host validates emit-time output against the schema as-written — it does not maintain a separate strict contract schema. |
| `schemaVersion` | SHOULD | Non-negative integer, parallel to the per-kind integer in `capabilities.schemaVersions` (`capabilities.md`). Absent ⇒ treated as `0`. Bumped when the artifact schema changes shape. **`schemaVersions` is a version *declaration*, not a validation guarantee** — the runtime "I validate this type before emit" guarantee is carried by the per-type `validated` facet in `host-capabilities.md` §host.artifactTypes (RFC 0075 / P1-2). |
| `displayName` | MAY | Human-readable label for management UIs. Non-normative. |
| `rendering` | MAY | Advisory `RenderingHint`. When present it MUST reuse the vocabulary defined in `ai-envelope.md` §"Rendering hints": a closed `display` enum (`markdown` / `code` / `image` / `audio` / `file`; `card` is reserved for envelopes and SHOULD NOT be used for durable artifacts), plus optional `mimeType`, `lang`, `alt`, `title`. It is advisory only — consumers MUST degrade gracefully when they do not recognize a value and MUST NOT treat `rendering` as a validation input. |
| `exportFormats` | MAY | List of export-format **identifiers** (hints) a renderer MAY offer. Spec-reserved core identifiers carry interoperable meaning (the lowercase file-extension / common name): `pdf`, `pptx`, `docx`, `xlsx`, `md`, `html`, `txt`, `csv`, `json`, `png`, `svg`, `jpeg`, `step`, `stl`, `dxf`. Identifiers outside the core set MUST be `vendor.<org>.<format>`- or `x-<format>`-prefixed (the same reserved-core + extension idiom as `requiredModelCapabilities` in `node-packs.md`). This spec assigns no byte-level *production* semantics to any identifier — it standardizes the identifier so two hosts agree what `pptx` names, not how the bytes are produced. |
| `syncOn` | SHOULD | When the host registers the artifact as durable: `"completion"` (on node completion), `"approval"` (after a HITL gate resolves), or `"manual"` (host-triggered). Default `"completion"`. Carries the same meaning as `nodes[].artifact.syncOn`. |
| `supportsCheckpoint` | MAY | `true` if the artifact participates in checkpoint/resume. Mirrors `nodes[].artifact.supportsCheckpoint`. |
| `versionable` | MAY | `true` if the host SHOULD retain prior versions of the artifact. Non-normative storage hint. |
| `diffable` | MAY | `true` if the artifact's schema supports structural diffing (informs run-diff tooling, `rest-endpoints.md` §:diff). Non-normative. |

### Schema distribution — source of truth and runtime mirror

The artifact's JSON Schema travels **inside the signed pack tarball** at `schemaRef` — this is the normative source of truth. It is covered by the pack's Ed25519 signature and SRI hash (`node-packs.md` §signing, §"Content addressing"), so a consumer that installs the pack can verify the schema offline, exactly as it already does for a node's `configSchemaRef` / `inputSchemaRef` / `outputSchemaRef`. No host infrastructure is required to *publish* an artifact type — an author drops a schema file in the tarball and signs it.

For *runtime* discovery by consumers that have not installed the pack (a peer host forwarding an artifact, a UI resolving a stored artifact's shape), a host that has installed an artifact-type pack and advertises `host.artifactTypes` **SHOULD** additionally serve each registered type's schema at the canonical URL `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json` (the artifact analog of the envelope convention in `ai-envelope.md` §"Canonical schema location"), with `Content-Type: application/schema+json`. The schema's `$id` MUST be that canonical URL.

**Serving is a MUST for host-registered (no-pack) types (RFC 0075 / P1-3).** When a host advertises a `schemaVersion` for a type that is **not** backed by an installed pack — i.e. a host-registered type (§"Binding") — the canonical served URL is the *only* resolution path, so serving it **MUST** be honored. Without it, a consumer reading `registered: true` + `schemaVersions["…"] = N` could not fetch the schema, leaving the protocol's strongest signal unverifiable. Pack-publishing hosts are unaffected (the schema travels in the tarball; serving stays a SHOULD for them).

**Byte-identical clause (clarified, RFC 0075).** When *both* an in-tarball copy and a host-served copy exist for a given `(artifactTypeId, schemaVersion)`, they MUST be byte-identical. A host-registered (no-pack) type ships only the served URL — there is no tarball copy to match, so the byte-identical requirement does not apply to it. Together this gives verifiable offline distribution (the pack) and frictionless runtime resolution (the URL) without forcing either on an adopter who only needs one.

### Bounded schema compilation (normative)

Because `schemaRef` schemas are third-party-authored and the engine compiles them (e.g., Ajv) at install and at validation time, a host MUST bound that compilation so a malicious or malformed pack cannot cause denial of service. At registry `PUT` and at pack install, a host MUST reject an artifact schema that exceeds host bounds on serialized byte size, `$ref` nesting depth, and total keyword/subschema count, and MUST compile under a wall-clock timeout. A host SHOULD reject schemas containing a regular-expression `pattern` it cannot evaluate in linear time (catastrophic-backtracking defense). Rejection returns `pack_validation_failed` (structural mismatches use `pack_kind_invalid`). This is the artifact-schema analog of the node-pack supply-chain controls in [`SECURITY/threat-model-node-packs.md`](../../SECURITY/threat-model-node-packs.md), enforced by the protocol-tier `artifact-schema-compile-bounded` invariant (RFC 0071 risk R1).

## Binding the existing artifact surfaces

The protocol already carries three artifact references that, until now, lacked a registry to resolve against. When a host advertises `host.artifactTypes` (below), it MUST treat them as follows:

- A `nodes[].artifact.typeId` (node-pack manifest), a `WorkflowNode.artifactType` (workflow definition), or an `artifact.created.artifactType` (run event) value is *registered* when it matches an artifact type the host knows by schema. There are **two registration tiers** (RFC 0075, amending RFC 0071):
  - **pack-registered** — matches an `artifactTypeId` of an installed artifact-type pack. `artifact.created.registrationSource: "pack"`.
  - **host-registered** — matches a **host-native** artifact type the host validates against a host-known schema, independent of any installed pack. `artifact.created.registrationSource: "host"`. This is the realistic shape of an AI-native host whose artifact types are first-class products of its own system (e.g. MyndHyve's Canvas Type `prd`/`theme`/`screen`), which it will never sign into a tarball merely to be "registered." It is the registration-axis analog of the `local.*` pack scope: validated, durable, first-class — just not pack-distributed.

  For **either** tier: before emitting `artifact.created` for a registered type the host MUST validate the artifact payload against the type's schema (per its `validation` strictness) and, on failure, MUST NOT emit `artifact.created` and MUST surface the validation error; it then sets `registered: true` + the matching `registrationSource`. A host MAY emit `registered: true` for a **host-registered** type **only if** that type's schema is resolvable — i.e. it serves the canonical `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json` URL (see §"Schema distribution", which makes serving a MUST for the no-pack case). This keeps `registered: true` a downstream-verifiable promise rather than an unfetchable assertion. `registrationSource` is optional; absent ⇒ existing (pack-or-unspecified) semantics, so no consumer breaks.
- A value that matches **no** installed artifact type is *unregistered*. Unregistered values remain valid — the host MUST NOT reject them and MUST NOT schema-validate them. This is a **permanent, first-class tier**, not a transitional allowance: it is the artifact-type analog of the `local.*` pack scope, and it is the on-ramp that lets any node emit a typed artifact (a prototype's `"prd"`, a host-private type) without first publishing and signing a pack. Registration governs *whether an artifact's shape is bound to a distributed contract*; it is never a precondition for producing artifacts. The host SHOULD set `artifact.created.registered: false` for unregistered types — a stable, honest signal consumers and tooling can act on (e.g., warn on a typo'd `artifactTypeId` that was meant to resolve) — and SHOULD log an unresolved-artifact-type warning.

A host that does **not** advertise `host.artifactTypes` treats every `artifactType` as today: an opaque string, never schema-validated. The `registered` field defaults to `true`, preserving the pre-RFC-0071 semantics in which every artifact was effectively accepted without registry validation.

## Host capability — `host.artifactTypes`

Following the contract pattern in `host-capabilities.md` §"The contract pattern", a host advertises store / render / export support **independently per host**, so a host that can persist an artifact but not render it is expressible:

```json
"host.artifactTypes": {
  "supported": true,
  "store": true,
  "render": false,
  "export": ["pdf"]
}
```

| Sub-flag | Meaning |
|---|---|
| `supported` | The host honors registered artifact types (validation + the bindings above). |
| `store` | The host persists artifacts of registered types and emits `artifact.created`. A host advertising `store: true` MUST do so. |
| `render` | The host has a renderer for registered types. Advisory: this spec defines no rendering surface. A host advertising `render: false` for a type it can store MUST still accept and store the artifact and MUST NOT fail the run because it cannot render it. |
| `export` | List of export-format identifiers the host can materialize, drawn from declared `exportFormats`. Advisory. |

The independence of `store` and `render` is the cross-host negotiation this surface exists to provide: an artifact produced on a richly-rendering host MUST remain storable, forwardable, and inspectable on a host that only persists it. A host MUST NOT terminate a run with an error solely because it lacks a renderer for a stored artifact type.

**Per-type facets (RFC 0075 / P1-1).** Capability is genuinely *per-type*: a real host validates some types, store-only relays others, renders a subset, and exports different formats per type — a single host-global object cannot express a heterogeneous fleet (forcing an adopter to advertise only the intersection). A host MAY therefore declare a `types` map whose entries override the global object for a given `artifactTypeId`; the global object is the default/fallback for any type not listed. A per-type entry carries `{ validated, validation, schemaVersion, store, render, export }`:

```jsonc
"host.artifactTypes": {
  "supported": true, "store": true, "render": true, "export": ["pdf"],     // defaults (fallback)
  "types": {
    "vendor.myndhyve.prd":   { "validated": true,  "validation": "open",   "schemaVersion": 1, "render": true },
    "vendor.acme.cad.model": { "validated": false, "store": true, "render": false }
  }
}
```

- `validated` (RFC 0075 / P1-2) is the **runtime validation guarantee**: `true` ⇒ the host validates this type against its schema before emitting `artifact.created` (and so emits `registered: true`). It is distinct from `schemaVersions["…"]`, which is only a **version declaration** ("I know this type at version N"). Decoupling the two removes the ambiguity that otherwise forces a host to either over-promise validation or under-advertise known types.
- `validation` mirrors the `ArtifactType.validation` strictness (`"open"`/`"closed"`) so a consumer can read it from discovery without fetching the schema.
- `types` absent ⇒ today's host-global semantics; any facet absent from an entry ⇒ the global default. Additive.

A pack MAY declare `peerDependencies: { "host.artifactTypes": "supported" }`; the registry refuses to register such a pack against a host that does not advertise the capability (`node-packs.md` §"Engine integration").

## Examples

**Positive.** The manifest above, when `schemas/cad-model.schema.json` exists in the tarball with `additionalProperties: false` and a conformant `$id`, validates and installs.

**Negative — `pack_kind_invalid`.** A manifest declaring both `artifactTypes[]` and `nodes[]`.

**Negative — schema validation.** An `artifactTypeId` of `core.openwop.cad.model` published from a non-core account (reserved scope); a `rendering.display` value of `"3d-viewport"` (not in the closed enum); an `artifactTypes[]` of length 0.

**Store-without-render (negotiation).** A host advertising `host.artifactTypes: { supported: true, store: true, render: false }` runs a workflow whose terminal node declares `artifact.typeId: "vendor.acme.cad.model"`. The host validates the payload against the registered schema, persists it, emits `artifact.created` with `registered: true`, and completes the run — it does not fail for lack of a CAD renderer.

## Resolved design decisions

The RFC 0071 architect pass resolved the design questions this doc was drafted against, optimizing for low-friction, widely-adoptable wire shapes consistent with the existing corpus:

| Decision | Resolution | Grounding |
|---|---|---|
| Schema home | **In-tarball `schemaRef` is the signed source of truth; the host SHOULD additionally serve it at `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json`.** | Matches node packs' in-tarball `*SchemaRef` (offline-verifiable, no host infra to publish) + the envelope canonical-URL convention (runtime discovery). See §"Schema distribution". |
| Capability shape | **Single `host.artifactTypes` object with `store` / `render` / `export[]` facets** (not dotted sub-capabilities). | `export` carries a list; the facets are negotiated together, not dispatched as separate methods (unlike `host.canvas.create`). |
| Versioning axis | **Integer `schemaVersion` on the artifact type (riding `capabilities.schemaVersions{}`); the *pack* keeps SemVer.** | Exactly the envelope split (`schemaVersions: Record<string, number>`); semver's minor/patch is meaningless for a wire schema. |
| `exportFormats` | **Reserved core identifier set + `vendor.*`/`x-` extension.** | Mirrors the `requiredModelCapabilities` reserved-core + extension idiom; gives interop without a codec spec. |
| Unregistered types | **Permanent first-class tier** (`registered: false`), not a transitional escape hatch. | The adoption on-ramp; the `local.*`-scope analog. |

## Open spec gaps

| Gap | Tracking |
|---|---|
| Chat card packs (`kind: "card"`), which produce artifacts of these types via prompts. | RFC 0071 Phase 2 / `chat-card-packs.md` (pending) |
| Bounded-compilation limits for distributed artifact schemas (schema-bomb / ReDoS defense) — the protocol-tier invariant + conformance test that gates this surface to `Active`. | RFC 0071 risk R1 / `SECURITY/invariants.yaml` |

## References

- [RFC 0071 — Artifact-Type Packs and AI Chat Card Packs](../../RFCS/0071-artifact-type-and-chat-card-packs.md)
- [`node-packs.md`](./node-packs.md) — pack identity, naming, distribution, signing, registry API, the `kind` discriminator.
- [`ai-envelope.md`](./ai-envelope.md) — the `RenderingHint` vocabulary reused here; the `{HostBase}/schemas/envelopes/{K}` convention paralleled by `schemas/artifacts/{artifactTypeId}`.
- [`host-capabilities.md`](./host-capabilities.md) — the `host.*` contract pattern; §host.artifactTypes.
- [`capabilities.md`](./capabilities.md) — `schemaVersions` integer-version precedent; the discovery document.
- [`positioning.md`](./positioning.md) — the wire-contract / no-renderer boundary this doc respects.
- `schemas/artifact-type-pack-manifest.schema.json`; `schemas/run-event-payloads.schema.json` (`artifact.created` `registered` field).
- `docs/OPENWOP-CANVAS-TYPE-PACKS-RESEARCH.md` — prior-art analysis (MyndHyve Canvas Types, demo-app card registry).

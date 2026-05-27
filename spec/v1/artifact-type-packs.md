# openwop Spec v1 — Artifact-Type Packs

> **Status: DRAFT (2026-05-26).** Phase 1 of [RFC 0070 — Artifact-Type Packs and AI Chat Card Packs](../../RFCS/0070-artifact-type-and-chat-card-packs.md). Specifies a new pack kind that publishes **typed artifact definitions** — the schema, rendering hint, lifecycle, and export-format hints for the rich outputs workflow nodes produce (documents, slides, app designs, CAD drawings). Promotes to FINAL when (a) the reference host implements `host.artifactTypes` store-side and (b) the manifest-validation + install + store-without-render conformance scenarios pass. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

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
| `schemaRef` | MUST | Path inside the pack tarball to the artifact's JSON Schema (Draft 2020-12). The target schema MUST set `additionalProperties: false` at its top level and MUST declare an `$id` under the publishing host's `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json` namespace, mirroring the envelope convention in `ai-envelope.md` §"Canonical schema location". |
| `schemaVersion` | SHOULD | Non-negative integer, parallel to the per-kind integer in `capabilities.schemaVersions` (`capabilities.md`). Absent ⇒ treated as `0`. Bumped when the artifact schema changes shape. |
| `displayName` | MAY | Human-readable label for management UIs. Non-normative. |
| `rendering` | MAY | Advisory `RenderingHint`. When present it MUST reuse the vocabulary defined in `ai-envelope.md` §"Rendering hints": a closed `display` enum (`markdown` / `code` / `image` / `audio` / `file`; `card` is reserved for envelopes and SHOULD NOT be used for durable artifacts), plus optional `mimeType`, `lang`, `alt`, `title`. It is advisory only — consumers MUST degrade gracefully when they do not recognize a value and MUST NOT treat `rendering` as a validation input. |
| `exportFormats` | MAY | List of export-format **identifiers** (hints) a renderer MAY offer (e.g., `"pdf"`, `"pptx"`, `"stl"`). This spec assigns no byte-level meaning to any identifier; producing bytes is a host concern. |
| `syncOn` | SHOULD | When the host registers the artifact as durable: `"completion"` (on node completion), `"approval"` (after a HITL gate resolves), or `"manual"` (host-triggered). Default `"completion"`. Carries the same meaning as `nodes[].artifact.syncOn`. |
| `supportsCheckpoint` | MAY | `true` if the artifact participates in checkpoint/resume. Mirrors `nodes[].artifact.supportsCheckpoint`. |
| `versionable` | MAY | `true` if the host SHOULD retain prior versions of the artifact. Non-normative storage hint. |
| `diffable` | MAY | `true` if the artifact's schema supports structural diffing (informs run-diff tooling, `rest-endpoints.md` §:diff). Non-normative. |

## Binding the existing artifact surfaces

The protocol already carries three artifact references that, until now, lacked a registry to resolve against. When a host advertises `host.artifactTypes` (below), it MUST treat them as follows:

- A `nodes[].artifact.typeId` (node-pack manifest), a `WorkflowNode.artifactType` (workflow definition), or an `artifact.created.artifactType` (run event) value that **matches an `artifactTypeId` of an installed artifact-type pack** is *registered*. Before emitting `artifact.created` for a registered type, the host MUST validate the artifact payload against the type's `schemaRef`; on failure it MUST NOT emit `artifact.created` and MUST surface the validation error.
- A value that matches **no** installed artifact type is *unregistered*. Unregistered values remain valid — the host MUST NOT reject them and MUST NOT schema-validate them. This is the deliberate escape hatch for in-development and host-local artifact types, mirroring the `local.*` pack scope. The host SHOULD set `artifact.created.registered: false` for these and SHOULD log an unresolved-artifact-type warning (a typo'd `artifactTypeId` otherwise fails silent).

A host that does **not** advertise `host.artifactTypes` treats every `artifactType` as today: an opaque string, never schema-validated. The `registered` field defaults to `true`, preserving the pre-RFC-0070 semantics in which every artifact was effectively accepted without registry validation.

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

A pack MAY declare `peerDependencies: { "host.artifactTypes": "supported" }`; the registry refuses to register such a pack against a host that does not advertise the capability (`node-packs.md` §"Engine integration").

## Examples

**Positive.** The manifest above, when `schemas/cad-model.schema.json` exists in the tarball with `additionalProperties: false` and a conformant `$id`, validates and installs.

**Negative — `pack_kind_invalid`.** A manifest declaring both `artifactTypes[]` and `nodes[]`.

**Negative — schema validation.** An `artifactTypeId` of `core.openwop.cad.model` published from a non-core account (reserved scope); a `rendering.display` value of `"3d-viewport"` (not in the closed enum); an `artifactTypes[]` of length 0.

**Store-without-render (negotiation).** A host advertising `host.artifactTypes: { supported: true, store: true, render: false }` runs a workflow whose terminal node declares `artifact.typeId: "vendor.acme.cad.model"`. The host validates the payload against the registered schema, persists it, emits `artifact.created` with `registered: true`, and completes the run — it does not fail for lack of a CAD renderer.

## Open spec gaps

| Gap | Tracking |
|---|---|
| Whether the artifact schema lives in-tarball (`schemaRef`, specified here) or is host-served and referenced by URL. | RFC 0070 Unresolved Q1 |
| Whether `host.artifactTypes` stays a single capability with sub-flags or splits into dotted `host.artifactTypes.{store,render,export}`. | RFC 0070 Unresolved Q2 |
| Whether `schemaVersion` (integer) or pack-style semver is the right versioning axis for an artifact type. | RFC 0070 Unresolved Q5 |
| Whether `exportFormats` identifiers are free or drawn from a controlled vocabulary. | RFC 0070 Unresolved Q6 |
| Chat card packs (`kind: "card"`), which produce artifacts of these types via prompts. | RFC 0070 Phase 2 / `chat-card-packs.md` (pending) |

## References

- [RFC 0070 — Artifact-Type Packs and AI Chat Card Packs](../../RFCS/0070-artifact-type-and-chat-card-packs.md)
- [`node-packs.md`](./node-packs.md) — pack identity, naming, distribution, signing, registry API, the `kind` discriminator.
- [`ai-envelope.md`](./ai-envelope.md) — the `RenderingHint` vocabulary reused here; the `{HostBase}/schemas/envelopes/{K}` convention paralleled by `schemas/artifacts/{artifactTypeId}`.
- [`host-capabilities.md`](./host-capabilities.md) — the `host.*` contract pattern; §host.artifactTypes.
- [`capabilities.md`](./capabilities.md) — `schemaVersions` integer-version precedent; the discovery document.
- [`positioning.md`](./positioning.md) — the wire-contract / no-renderer boundary this doc respects.
- `schemas/artifact-type-pack-manifest.schema.json`; `schemas/run-event-payloads.schema.json` (`artifact.created` `registered` field).
- `docs/OPENWOP-CANVAS-TYPE-PACKS-RESEARCH.md` — prior-art analysis (MyndHyve Canvas Types, demo-app card registry).

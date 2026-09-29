# Artifact-Type Packs

> **Status: Stable.**
> **Normative home:** `artifactTypes`.

## Why this exists

An artifact-type pack binds an `artifactTypeId` to a JSON Schema, an advisory rendering hint and export formats, so two hosts mean the same thing by one type. The manifest is `schemas/v2/artifact-type-pack-manifest.schema.json`, whose descriptions carry the per-field rules; installation and signing follow [packs.md](packs.md).

A registry MUST refuse a manifest that mixes `kind: "artifact-type"` with `nodes[]`, `chains[]` or `prompts[]`, with `pack_kind_invalid`.

## Schema distribution

The schema at `schemaRef`, inside the signed tarball, is the source of truth. Its canonical URL and `$id` is `{HostBase}/schemas/artifacts/{artifactTypeId}.schema.json`, served as `application/schema+json`.

- A host advertising `artifactTypes` SHOULD serve each installed type's schema there, and MUST for a host-registered type whose `schemaVersion` it advertises.
- A tarball copy and a served copy of one `(artifactTypeId, schemaVersion)` MUST be byte-identical.

At registry publish and at install, a host (invariant `artifact-schema-compile-bounded`):

- MUST reject, with `pack_validation_failed`, an artifact schema exceeding its bounds on serialized size, `$ref` depth or keyword/subschema count;
- MUST compile it under a wall-clock timeout;
- SHOULD reject a `pattern` it cannot evaluate in linear time.

## Registration

A host advertising `artifactTypes` places each `WorkflowNode.artifactType`, `nodes[].artifact.typeId` and `artifact.created.artifactType` value in one tier: **pack-registered** (an installed pack declares it; `registrationSource: "pack"`), **host-registered** (a host-native type with a host-known schema; `"host"`), or **unregistered**.

- Before emitting `artifact.created` for a registered type, the host MUST validate the payload against its schema as written, per its `validation`. On failure it MUST NOT emit and MUST surface the error; on success it sets `registered: true` and the matching `registrationSource`.
- A host MAY emit `registered: true` for a host-registered type only if it serves that type's schema.
- A host MUST NOT reject or schema-validate an unregistered value. It SHOULD emit `registered: false` and SHOULD log an unresolved-type warning.
- A host not advertising `artifactTypes` treats every value as an opaque string.

## The capability

`artifactTypes` advertises `store`, `render` and `export` independently; `types` overrides them per `artifactTypeId`, falling back to the global values (`schemas/v2/capabilities.schema.json`).

- **`store`** — every path by which a host persists an artifact of a registered type MUST emit `artifact.created`; a host with a silent path MUST NOT advertise `store: true` for that type.
- **`render`**, **`export`** — advisory. A host MUST NOT refuse to store an artifact, or fail a run, because it cannot render it.

*Sources: RFCs 0071, 0075, 0141, 0145, 0205.*

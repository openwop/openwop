# Packs

> **Status: Stable · RFC 0177.**
> **Normative home:** `packs`.

## Why this exists

The v2 contract for pack manifests, the registry tree, peer-dependency identifiers, and signing. The per-kind rules live in connection-packs.md, form-content-packs.md, and workflow-chain-packs.md; the capability vocabulary a pack requires is capabilities.md.

## The engine range

A manifest's `engines.openwop` MUST match the grammar in `schemas/v2/node-pack-manifest.schema.json`: a `>=` lower bound and an explicit `<` major ceiling (`^>=\d+(\.\d+){0,2} <\d+\.0\.0$`). A v2 host MUST treat a range with no upper bound as bounded by `<2.0.0`. A host MUST refuse to install a version whose range does not admit the host's protocol major with `pack_engine_unsupported` (`spec/v2/errors.json`); `pack_runtime_requirement_unmet` remains a runtime-requirement code and MUST NOT be used for the protocol major. The range is a claim about the pack's own surface, not about run semantics: admitting major M asserts that the manifest validates against the `schemas/v2/` manifest schema for its `kind`, that every `peerDependencies` key resolves (§"Peer-dependency identifiers"), and that the version carries a §Signing signature. Each conjunct keeps its own refusal code; a mechanical ceiling bump is not a verification. Both checks MUST run at install on every publication path — the canonical registry, a vendor registry's write API, and a mirror ingest — so no registry-side artifact can bypass it.

## The `packs` capability

A host advertises `packs` when it serves the registry surface above. The record
is the advertisement: a host MUST NOT advertise `packs` unless it resolves pack
references through a registry reachable from its discovery document, and a
client MUST treat an absent record as "this host installs no packs" rather than
as an unknown.

`testMode` is DEPRECATED and MUST NOT be relied on by a client. It advertises
the v1 `/v1/packs-test/*` mirror, a conformance seam (`conformance.md`
§"The seams profile"), and remains advertisable through the overlap because hosts already publish it; it is
removed at 3.0. A host mounting a test catalog SHOULD advertise the seams
profile instead, and MUST NOT treat `testMode` as a second way to claim one.

## The registry tree

The registry is versioned by tree, not header. It publishes `registry/v2/packs/<name>/-/<version>.{json,sbom.json,sig,tgz}` as a parallel tree of re-signed manifests with regenerated SBOMs and index; the v1 tree is frozen through the overlap, deliberately behind this one. A signed compatibility overlay MUST be rejected: signatures authorize by namespace, and a mirror re-derives the signer at ingest.

`.well-known/openwop-registry.json` `endpoints` is the negotiation: it names both trees, and a client MUST resolve every registry path through it rather than construct one. `publicKey` is unversioned: keys are not protocol-versioned.

## Peer-dependency identifiers

A `peerDependencies` key MUST be a `families[].key` in `spec/v2/declaration.json` whose `anchor` is not `deleted` — equivalently a root key of the generated `schemas/v2/capabilities.schema.json` — or carry a row in `spec/v2/peer-dependency-aliases.json`, which is how a v1-era key reaches a v2 family through the overlap; the declaration key, the peer-dependency identifier, and the capabilities.md section anchor are one identifier. A host MUST refuse a key the declaration file does not name with `pack_peer_dependency_undefined`. Facet paths are not identifiers: a pack requires a family by its key and names facets in `peerDependenciesMeta.<family>.facets[]`.

```jsonc
"peerDependencies": { "aiProviders": "required" },
"peerDependenciesMeta": { "aiProviders": { "facets": ["imageGeneration"] } }
```

## The alias table

`spec/v2/peer-dependency-aliases.json` is generated from the declaration file and the published-manifest inventory, never hand-kept; each of its 23 rows is `{ alias, family, facets?, publishedUses, removalTrigger }` and covers a v1 grammar found in the wild (`host.*` dotted twins, `openwop.agents.memoryBackends`, facet paths such as `aiProviders.imageGeneration`). A v2 host MAY resolve an alias through the table during the overlap and MUST NOT resolve one after v1 end-of-support (`removalTrigger: v1-end-of-support`). A row the declaration file cannot explain fails the corpus gate.

## The manifest schema family

The 13 manifest schemas carry `$id` under `https://openwop.dev/spec/v2/`; the v1 `$id`s are immutable and served read-only.

| Schema (`schemas/v2/…`) | Author | Vendor hatch |
| --- | --- | --- |
| `node-pack-manifest`, `prompt-pack-manifest`, `workflow-chain-pack-manifest`, `artifact-type-pack-manifest`, `chat-card-pack-manifest`, `connection-pack-manifest`, `form-content-pack-manifest`, `frontend-plugin-manifest`, `registry-version-manifest` | pack | REQUIRED |
| `agent-manifest`, `prompt-template` | pack (nested under a pack root) | REQUIRED |
| `pack-lockfile` | host | closed |
| `security-advisory` | registry | closed |
| `prompt-ref` | leaf | none |

Every pack-authored document MUST admit `patternProperties` `^(openwop-|x-|vendor\.)`. A consumer that does not recognize a hatch property MUST ignore it and MUST NOT reject the document; the value is pack-authored and therefore untrusted (security-defaults.md).

## Signing

There is one signing scheme. `signing` on a version manifest (`schemas/v2/registry-version-manifest.schema.json`) is `{ keyId, scheme }`, both REQUIRED:

| Field | Rule |
| --- | --- |
| `scheme` | MUST be `ed25519-canonical-json`: a detached 64-byte Ed25519 signature over the RFC 8785 (JCS) bytes of `pack.json` inside a deterministic tarball; the input MUST satisfy `conformance.md` §"Canonical JSON" (RFC 0212) |
| `keyId` | the signing key id; `publicKeyRef` does not exist |
| `method` | does not exist; a manifest carrying it fails validation |

The same block applies to a **bare manifest** — the `pack.json` inside the tarball, which is the document the signature covers. `signing` is OPTIONAL there, because an authoring-time `pack.json` exists before it is signed; when present it MUST be the identical closed `{ keyId, scheme }` object, and the v1 `{ publicKeyRef, signatureRef, method }` block fails validation on every bare manifest kind (migration row `openwop.migration.C10.1`).

A verifier MUST verify the signature against the issuing registry's key for `keyId` and MUST check the pack name against that key's `permittedNamespaces`. A signature over tarball bytes is not a v2 signature; such a pack MUST be re-signed, not relabeled.

## Version manifests

`kind` is REQUIRED on every version manifest and every bare manifest; the v1 "absent means `node`" reading does not exist. A deprecated version is flagged `versionDeprecated: true`; the registry continues to serve it and a consumer MAY refuse to install it.

## The registry's own schemas

A registry MUST validate submissions against vendored copies of these schemas pinned to a corpus tag, and MUST re-sync them from that tag before any v2 publication. An unpinned or drifted vendored schema is a registry defect: it rejects documents the protocol requires the registry to accept.

## Errors

| Code | Raised when |
| --- | --- |
| `pack_engine_unsupported` | the range does not admit the host's protocol major (install, every path) |
| `pack_peer_dependency_undefined` | a peer-dependency key is not a declaration-file key or an overlap alias |
| `pack_signature_invalid` | the signature, key, or namespace check fails |

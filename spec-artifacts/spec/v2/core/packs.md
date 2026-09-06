# Packs

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0177.**

## Why this exists

Every one of the 282 pack versions published under v1 either pins `<2.0.0` or declares no ceiling at all, four peer-dependency grammars were signed into the registry, and two signing conventions shared one word while signing different bytes. This document is the v2 contract for pack manifests, the registry tree, peer-dependency identifiers, and signing. The per-kind rules live in connection-packs.md, form-content-packs.md, and workflow-chain-packs.md; the capability vocabulary a pack requires is capabilities.md.

## The engine range

A manifest's `engines.openwop` MUST match the grammar in `schemas/v2/node-pack-manifest.schema.json`: a `>=` lower bound and an explicit `<` major ceiling (`^>=\d+(\.\d+){0,2} <\d+\.0\.0$`). A v2 host MUST treat a range with no upper bound as bounded by `<2.0.0`. A host MUST refuse to install a version whose range does not admit the host's protocol major with `pack_engine_unsupported` (`spec/v2/errors.json`); `pack_runtime_requirement_unmet` remains a runtime-requirement code and MUST NOT be used for the protocol major. The check MUST run at install on every publication path — the canonical registry, a vendor registry's write API, and a mirror ingest — so no registry-side artifact can bypass it.

## The registry tree

The registry is versioned by tree, not by header. It publishes `registry/v2/packs/<name>/-/<version>.{json,sbom.json,sig,tgz}` as a parallel tree of re-signed manifests with regenerated SBOMs and index; the v1 tree is served read-only through the overlap. A signed compatibility overlay MUST be rejected: signatures authorize by namespace, and a mirror re-derives the signer at ingest.

`.well-known/openwop-registry.json` `endpoints` is the negotiation: it names both trees, and a client MUST resolve every registry path through `endpoints` rather than by constructing one. `publicKey` is unversioned; keys are not protocol-versioned.

## Peer-dependency identifiers

A `peerDependencies` key MUST be a root key of `spec/v2/declaration.json`; the declaration key, the peer-dependency identifier, and the capabilities.md section anchor are one identifier. A host MUST refuse a key the declaration file does not name with `pack_peer_dependency_undefined`. Facet paths are not identifiers: a pack requires a family by its key and names facets in `peerDependenciesMeta.<family>.facets[]`.

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

Every pack-authored document MUST admit `patternProperties` `^(openwop-|x-|vendor\.)`. The `openwop-` prefix is the v2 spelling of the v1 `x-openwop-*` annotation keys, renamed so annotation keys and wire headers stop sharing a token shape. A consumer that does not recognize a hatch property MUST ignore it and MUST NOT reject the document; the value is pack-authored and therefore untrusted (security-defaults.md).

## Signing

There is one signing scheme. `signing` on a version manifest (`schemas/v2/registry-version-manifest.schema.json`) is `{ keyId, scheme }`, both REQUIRED:

| Field | Rule |
| --- | --- |
| `scheme` | MUST be `ed25519-canonical-json`: a detached 64-byte Ed25519 signature over the canonical-JSON `pack.json` inside a deterministic tarball |
| `keyId` | the signing key id; `publicKeyRef` does not exist |
| `method` | does not exist; a manifest carrying it fails validation |

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

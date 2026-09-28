# Packs

> **Status: Stable.**
> **Normative home:** `packs`.

## Why this exists

The v2 contract for pack manifests, the registry tree, peer-dependency identifiers, and signing. The per-kind rules live in [connection-packs.md](connection-packs.md), [form-content-packs.md](form-content-packs.md), and [workflow-chain-packs.md](workflow-chain-packs.md); the capability vocabulary a pack requires is [capabilities.md](capabilities.md).

## The engine range

A manifest's `engines.openwop` MUST match the grammar in `schemas/v2/node-pack-manifest.schema.json`: a `>=` lower bound and an explicit `<` major ceiling (`^>=\d+(\.\d+){0,2} <\d+\.0\.0$`).

- A v2 host MUST treat a range with no upper bound as bounded by `<2.0.0`.
- A host MUST refuse to install a version whose range does not admit the host's protocol major with `pack_engine_unsupported` (`spec/v2/errors.json`).
- `pack_runtime_requirement_unmet` remains a runtime-requirement code and MUST NOT be used for the protocol major.
- Both checks MUST run at install on every publication path — the canonical registry, a vendor registry's write API, and a mirror ingest — so no registry-side artifact can bypass it.

The range is a claim about the pack's own surface, not about run semantics. Admitting major M asserts that:

- the manifest validates against the `schemas/v2/` manifest schema for its `kind`;
- every `peerDependencies` key resolves (§"Peer-dependency identifiers");
- the version carries a §Signing signature.

Each conjunct keeps its own refusal code. A mechanical ceiling bump is not a verification.

## The `packs` capability

A host advertises `packs` when it serves the registry surface above. The record is the advertisement:

- A host MUST NOT advertise `packs` unless it resolves pack references through a registry reachable from its discovery document.
- A client MUST treat an absent record as "this host installs no packs", not as an unknown.

`testMode` is DEPRECATED and MUST NOT be relied on by a client (see §"During the v1 overlap"). A host mounting a test catalog SHOULD advertise the seams profile instead, and MUST NOT treat `testMode` as a second way to claim one.

## The registry tree

The registry is versioned by tree, not header. It publishes `registry/v2/packs/<name>/-/<version>.{json,sbom.json,sig,tgz}` as a parallel tree of re-signed manifests with regenerated SBOMs and index.

- A signed compatibility overlay MUST be rejected: signatures authorize by namespace, and a mirror re-derives the signer at ingest.
- `.well-known/openwop-registry.json` `endpoints` is the negotiation: it names both trees, and a client MUST resolve every registry path through it rather than construct one.
- `publicKey` is unversioned: keys are not protocol-versioned.

## Peer-dependency identifiers

A `peerDependencies` key MUST either:

- be a `families[].key` in `spec/v2/declaration.json` whose `anchor` is not `deleted` — equivalently a root key of the generated `schemas/v2/capabilities.schema.json`; or
- carry a row in `spec/v2/peer-dependency-aliases.json` (§"The alias table").

The declaration key, the peer-dependency identifier, and the capabilities.md section anchor are one identifier. A host MUST refuse a key the declaration file does not name with `pack_peer_dependency_undefined`.

Facet paths are not identifiers: a pack requires a family by its key and names facets in `peerDependenciesMeta.<family>.facets[]`.

```jsonc
"peerDependencies": { "aiProviders": "required" },
"peerDependenciesMeta": { "aiProviders": { "facets": ["imageGeneration"] } }
```

## The alias table

`spec/v2/peer-dependency-aliases.json` is generated from the declaration file and the published-manifest inventory, never hand-kept. It is how a v1-era key reaches a v2 family through the overlap. Each row is `{ alias, family, facets?, publishedUses, removalTrigger }` and covers a v1 grammar found in the wild (`host.*` dotted twins, `openwop.agents.memoryBackends`, facet paths such as `aiProviders.imageGeneration`).

A v2 host MAY resolve an alias through the table during the overlap, and MUST NOT resolve one after v1 end-of-support (`removalTrigger: v1-end-of-support`).

## The manifest schema family

The manifest schemas carry `$id` under `https://openwop.dev/spec/v2/`; the v1 `$id`s are immutable and served read-only.

| Schema (`schemas/v2/…`) | Author | Vendor hatch |
| --- | --- | --- |
| `node-pack-manifest`, `prompt-pack-manifest`, `workflow-chain-pack-manifest`, `artifact-type-pack-manifest`, `chat-card-pack-manifest`, `connection-pack-manifest`, `form-content-pack-manifest`, `frontend-plugin-manifest`, `registry-version-manifest` | pack | REQUIRED |
| `agent-manifest`, `prompt-template` | pack (nested under a pack root) | REQUIRED |
| `pack-lockfile` | host | closed |
| `security-advisory` | registry | closed |
| `prompt-ref` | leaf | none |

Every pack-authored document MUST admit `patternProperties` `^(openwop-|x-|vendor\.)`. A consumer that does not recognize a hatch property MUST ignore it and MUST NOT reject the document; the value is pack-authored and therefore untrusted ([security-defaults.md](security-defaults.md)).

## Signing

There is one signing scheme. `signing` on a version manifest (`schemas/v2/registry-version-manifest.schema.json`) is the closed object `{ keyId, scheme }`, both REQUIRED:

- **`scheme`** MUST be `ed25519-canonical-json`: a detached 64-byte Ed25519 signature over the RFC 8785 (JCS) bytes of `pack.json` inside a deterministic tarball. The input MUST satisfy `conformance.md` §"Canonical JSON".
- **`keyId`** is the signing key id.
- A block carrying `method`, `publicKeyRef` or `signatureRef` fails validation.

The same block applies to a **bare manifest** — the `pack.json` inside the tarball, which is the document the signature covers. `signing` is OPTIONAL there, because an authoring-time `pack.json` exists before it is signed. When present it MUST be the identical closed `{ keyId, scheme }` object, on every bare manifest kind.

- A verifier MUST verify the signature against the issuing registry's key for `keyId`, and MUST check the pack name against that key's `permittedNamespaces`.
- A signature over tarball bytes is not a v2 signature; such a pack MUST be re-signed, not relabeled.

A registry lists its keys as `signingKeys[]` in `.well-known/openwop-registry.json`, each with `keyId`, `publicKeyUrl`, `permittedNamespaces` and `status`:

- Only a key whose `status` is `active` MAY sign a new publication.
- A key MUST stay listed, with its `permittedNamespaces`, while any served version names it.
- A verifier MUST NOT refuse a version because its key is no longer `active`.

## Version manifests

`kind` is REQUIRED on every version manifest and every bare manifest.

There are no lifecycle endpoints: `writeApi` in `.well-known/openwop-registry.json` says how to submit, and a lifecycle change republishes the version manifest. These flags sit outside the signature, which covers only `pack.json`.

- **Deprecated.** `versionDeprecated: true`, optionally with `deprecationReason` and `supersededBy`. It stays served; a consumer MAY refuse to install it, and SHOULD warn with both values when it does not.
- **Yanked.** `yanked: true`, optionally with `yankedReason`. The registry MUST keep serving its manifest, tarball and signature, and its pack index MUST NOT name it `latest` while any version is not yanked.
- A consumer resolving a range MUST exclude yanked versions. An exact pin MAY resolve one.
- A version that a registry security advisory lists in `affected[]` MUST be yanked.

## Submissions

A registry MUST refuse a submission that fails a check below: a write API answers with the code, and a pull-request registry fails its gate.

| Check | Code |
| --- | --- |
| `integrity` matches the tarball | `pack_integrity_failure` |
| Both manifests validate against the schema for `kind`, and `name` and `version` match the path | `pack_validation_failed` |
| The version is not already published | `version_conflict` |
| The signature verifies under an `active` key permitted for the namespace | `pack_signature_invalid` |
| `engines.openwop` admits the tree's major | `pack_engine_unsupported` |
| Every `peerDependencies` key is defined | `pack_peer_dependency_undefined` |

## The registry's own schemas

A registry MUST validate submissions against vendored copies of these schemas pinned to a corpus tag, and MUST re-sync them from that tag before any v2 publication. An unpinned or drifted vendored schema is a registry defect: it rejects documents the protocol requires the registry to accept.

## Errors

| Code | Raised when |
| --- | --- |
| `pack_engine_unsupported` | the range does not admit the host's protocol major (install, every path) |
| `pack_peer_dependency_undefined` | a peer-dependency key is not a declaration-file key or an overlap alias |
| `pack_signature_invalid` | the signature, key, or namespace check fails |

## During the v1 overlap

- The v1 registry tree is frozen through the overlap, behind the v2 tree.
- `testMode` advertises the v1 `/v1/packs-test/*` mirror, a conformance seam ([conformance.md §"The seams profile"](conformance.md)). It remains advertisable through the overlap and is removed at 3.0.

*Sources: RFC 0177, RFC 0212, RFC 0222.*

# Conformance

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0168.**

## Why this exists

v1 could say a host passed and could not say what it witnessed: test ids were derived from titles, the witness class was recorded on extensions but not requirements, nine test-seam operations sat in the canonical API, and the certification bundle had an open root and no signature. This document is the v2 evidence contract: how a requirement is asserted, how every requirement declares what can witness it, how the seams are mounted, what the suite ships, and what a bundle proves. Profiles are in overview.md; the capability vocabulary the suite gates on is capabilities.md.

## Requirement ids

`expect(x, req('openwop.<area>.<slug>', '<doc> §<section>', '<requirement>'))` is the only assertion form. A scenario assertion without a requirement id MUST fail the suite's lint. Ids are minted in `conformance/requirements.json`; every test declares its id explicitly. A title reword without a corresponding `requirement-aliases.json` row MUST fail CI, because published bundles cite ids and an orphaned id orphans every bundle that cited it.

The ledger records per `it`, and a bundle's `results.requirements[]` is the per-assertion list. A post-assertion soft-skip MUST record `skipped` for every id not reached and MUST NOT record `pass`.

## Witness class

Every family in `spec/v2/declaration.json`, every requirement in `conformance/requirements.json`, and every row of `SECURITY/invariants.yaml` MUST carry `witness` from the closed set:

| Class | Meaning |
| --- | --- |
| `witnessable-unaided` | the suite observes it on any host with no advertisement |
| `witnessable-gated` | observed when the host advertises the gating capability |
| `seam-gated` | observed only through the seams profile |
| `claims-check` | the host's own claim is checked for shape, not behavior |
| `negative-existence` | the suite asserts a thing is absent |
| `unwitnessable` | no observation path exists; `rationale` REQUIRED |

A protocol-tier invariant marked `unwitnessable` MUST fail the corpus gate. `tests: []` is expressible only as `unwitnessable`. A bundle disposition `blocked` does not exist as a witness class: what v1 called blocked is `seam-gated` or `unwitnessable`.

The six v1 certification admissions map to one class each: the shape-versus-behavior dual grade is `witnessable-gated` on the behavioral leg, never two grades; "blocked as unobservable" is `seam-gated` or `unwitnessable`; install-time-only extension opacity is `claims-check`; corpus-structural legs run in the spec repo's CI and have no host class; gRPC end-to-end is `unwitnessable` (interop.md); a negative-existence claim is `negative-existence`.

A MUST whose only witness is `seam-gated` MUST either mint a normative observation path before the cut or be demoted to SHOULD. The seam count in `docs/witness-baseline.json` is a ratchet and MUST NOT rise.

## The seams profile

Test seams are the profile `openwop-conformance-seams-v2` (`spec/v2/profiles.json`), described by `api/seams-v2.yaml` with schemas under `schemas/v2/seams/`, in the path space `/conformance/seams/…`. The seam schemas `$ref` the canonical error and event schemas with no tolerance path. A host that mounts the seams MUST advertise the profile in `profiles[]`; a `testSeams` capability flag does not exist and MUST NOT be advertised. `api/v2/openapi.yaml` and `spec/v2/path-manifest.json` MUST contain no seam or sample-host operation; an SDK generated from the canonical document has no seam method. The profile is versioned with the suite (`seams-v2` for 2.x).

## Two products, two ledgers

Corpus-coherence checks run in the spec repo's CI (`scripts/check-spec-coherence.mjs`) and MUST NOT appear in a host bundle; the bundle schema forbids their ids. `--offline` is a declared property of a scenario, not a runtime discovery.

`@openwop/openwop-conformance@2.0.0` ships `dist`, `fixtures`, and `vectors` only. The corpus — `api/`, `schemas/`, the `spec/v2/*.json` registries, `CORPUS-STAMP.json` — is `@openwop/spec-artifacts@2.0.0`, an exact-pinned peer dependency the suite MUST digest-check at start and MUST refuse to run against on a mismatch. The suite is one package: `--target-major 1|2` selects the target (default: the host's `preferredVersion`), scenario ids share one namespace across majors, and the 1.x target is removed at v1 end-of-support.

## Bundle v3

A certification bundle validates against `schemas/v2/certification-bundle.schema.json`: closed root, `bundleVersion: "3"`.

| Field | Rule |
| --- | --- |
| `suite` | `name`, `version`, `targetMajor`, `specArtifactsVersion` REQUIRED |
| `host` | `name`, `version`, `build.{kind, id}` REQUIRED; `kind` is `image-digest`, `commit`, or `artifact-sha256` |
| `discovery` | `url`, `sha256`, `protocolVersions`, `preferredVersion` REQUIRED |
| `claimedProfiles[]` | `id`, `evidenceTier` (`self` \| `steward` \| `independent`), `witnessCount`, `certified` REQUIRED |
| `results` | `totals` and the per-requirement list REQUIRED |
| `witnessSha256` | REQUIRED; covers the reporter record |
| `assertionCount` | REQUIRED, ≥ 1 |
| `detail.nonPass[]` | REQUIRED when any total other than `executedPass` is non-zero |
| `signature` | REQUIRED |

`signature` is an Ed25519 attestation over the canonical JSON of `{ witnessSha256, host.build, suite.version, discovery.sha256 }`; `over` MUST list exactly those four members. A host that signs bundles MUST publish the corresponding public keys as `signingKeys[]` in its discovery document, and `signature.keyId` MUST name one of them. A verifier MUST resolve `keyId` there — in the discovery document of the host the bundle is *about* — and MUST verify the attestation under the published key.

A signature that cannot be resolved to a published key attests **integrity only**: it proves the bundle was not altered after signing, and proves nothing about who signed it, because a signer can mint a keypair and a key id at will. Such a bundle MUST NOT be read as attributable evidence, and a gate MUST distinguish three outcomes that a presence check collapses into one — *no discovery document was read*, *read and the key is not published*, and *the attestation does not verify*. A retired key MUST stay listed, because removing it silently invalidates every bundle it already signed. `evidenceTier: independent` MUST carry a `verifierKeyId` distinct from the host's signing key; the verifier MUST refuse, not warn, on a missing or self-signed independent claim. A bundle with `totals.blocked > 0` does not certify. A profile that carries an operator relaxation (`host.relaxations[]`) cannot certify. v1 and v2 bundles are never upgraded to v3; a bundle is evidence at its own version.

## Corpus-gate evidence

An RFC whose acceptance criteria are corpus gates rather than host scenarios records the evidence label **corpus gate — no host tier** in its `Updated` line; the accepted-predicate check reads `(corpus)` rows from `evidence/corpus-ledger.json` for such an RFC and MUST NOT require a host bundle for it.

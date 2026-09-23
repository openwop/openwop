# Conformance

> **Status: Stable · RFC 0168.**

## Why this exists

The v2 evidence contract: how a requirement is asserted, how every requirement declares what can witness it, how the seams are mounted, what the suite ships, and what a bundle proves. Profiles are in overview.md; the capability vocabulary the suite gates on is capabilities.md.

## Requirement ids

`expect(x, req('openwop.<area>.<slug>', '<doc> §<section>', '<requirement>'))` is the only assertion form. A scenario assertion without a requirement id MUST fail the suite's lint. Ids are minted in `conformance/requirements.json`; every test declares its id explicitly. A title reword without a corresponding `requirement-aliases.json` row MUST fail CI.

The ledger records per `it`, and a bundle's `results.requirements[]` is the per-assertion list. A post-assertion soft-skip MUST record `skipped` for every id not reached and MUST NOT record `pass`.

### Whose fact is the reason?

A soft-skip carries a disposition and a reason. The reason MUST identify a fact
about the host under test. Use `inapplicable` only when the requirement does not
bind that host. A missing fixture, unreadable corpus file, or other suite-side
failure MUST be `blocked`, never `inapplicable`; a suite with a blocked row MUST
NOT issue a certification (RFC 0168 §E.1).

When more than one gate can skip a test, evaluate host predicates before suite
predicates.

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

A MUST whose only witness is `seam-gated` MUST either mint a normative observation path before the cut or be demoted to SHOULD. The seam count in `docs/witness-baseline.json` is a ratchet and MUST NOT rise.

## The seams profile

Test seams are the profile `openwop-conformance-seams-v2` (`spec/v2/profiles.json`), described by `api/seams-v2.yaml` with schemas under `schemas/v2/seams/`, in the path space `/conformance/seams/…`. The seam schemas `$ref` the canonical error and event schemas with no tolerance path. A host that mounts the seams MUST advertise the profile as `conformance.seamsProfile: "openwop-conformance-seams-v2"` at the discovery root (RFC 0168 §C.1, erratum 2026-09-05; the closed root has no `profiles[]`, capabilities.md §3); a `testSeams` capability flag does not exist and MUST NOT be advertised. `api/v2/openapi.yaml` and `spec/v2/path-manifest.json` MUST contain no seam or sample-host operation; an SDK generated from the canonical document has no seam method. The profile is versioned with the suite (`seams-v2` for 2.x).

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
| `witnessSha256` | REQUIRED; covers the reporter record and, when any are declared, `host.relaxations[]` |
| `assertionCount` | REQUIRED, ≥ 1 |
| `detail.nonPass[]` | REQUIRED when any total other than `executedPass` is non-zero |
| `results.requirements[].evidence` | OPTIONAL, closed; structured evidence on an `executed-pass` row (below) |
| `durability.rung` | OPTIONAL; a claim the verifier re-derives (below) |
| `signature` | REQUIRED |

`signature` is an Ed25519 attestation over the canonical JSON of `{ witnessSha256, host.build, suite.version, discovery.sha256 }`; `over` MUST list exactly those four members. A host that signs bundles MUST publish the corresponding public keys as `signingKeys[]` in its discovery document, and `signature.keyId` MUST name one of them. A verifier MUST resolve `keyId` there — in the discovery document of the host the bundle is *about* — and MUST verify the attestation under the published key.

A signature that cannot be resolved to a published key attests **integrity only**. Such a bundle MUST NOT be read as attributable evidence, and a gate MUST distinguish three outcomes that a presence check collapses into one — *no discovery document was read*, *read and the key is not published*, and *the attestation does not verify*. A retired key MUST stay listed. `evidenceTier: independent` MUST carry a `verifierKeyId` distinct from the host's signing key; the verifier MUST refuse, not warn, on a missing or self-signed independent claim. A bundle with `totals.blocked > 0` does not certify. At major 2 a requirement a test did not observe records `blocked` even when the test asserted setup facts first; an `executed-pass` carrying a `partial-witness:` detail is reserved for a leg that observed its requirement and skipped an optional extra. A verifier MUST derive the operator's opt-outs from the signed `skipped` rows and MUST reject a bundle whose captured discovery document advertises one of them (`opted-out-but-advertised`). v1 and v2 bundles are never upgraded to v3; a bundle is evidence at its own version.

### Recovery evidence

Recovery evidence (RFC 0158 §E) rides on rows, which `witnessSha256` digests: a row's `evidence` enters the digest only when present, and a bundle without it digests as it always did.

| Row | `evidence` member |
| --- | --- |
| `0158.bound-is-derived` | `recoveryBounds[]` of `{ class, bound, terms[] }`, each term `{ name, ms }`; `bound` MUST equal the sum of its terms. One entry per recovery class; there is no aggregate bound. |
| `0158.kill-after-accept`, `0158.kill-during-execution` | `recovery: { class, boundMs, observedMs }` — the class exercised, the bound it was judged against, and the observed kill-to-resumption interval. |

`class` and `name` are opaque host-chosen identifiers, never a closed vocabulary. `durability.rung` is outside the attestation, so a verifier MUST re-derive it and MUST reject (`rung-not-derivable`) a claim it cannot derive: every row of the rung `executed-pass`, each kill row's `class` naming a declared entry whose `bound` equals its `boundMs` and is not exceeded by its `observedMs`. Only `durable-single-instance` is derivable in this revision; a higher claim is refused. This proves arithmetic and that recovery ran once inside the bound. It does not prove the kill landed in the class it names; killing only once the execution claim is held is the host's obligation.

## Corpus-gate evidence

An RFC whose acceptance criteria are corpus gates rather than host scenarios records the evidence label **corpus gate — no host tier** in its `Updated` line; the accepted-predicate check reads `(corpus)` rows from `evidence/corpus-ledger.json` for such an RFC and MUST NOT require a host bundle for it.

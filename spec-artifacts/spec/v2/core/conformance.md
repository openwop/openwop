# Conformance

> **Status: Stable.**

## Why this exists

The v2 evidence contract: how a requirement is asserted, how every requirement declares what can witness it, how the seams are mounted, what the suite ships, and what a bundle proves. Profiles are in [overview.md](overview.md); the capability vocabulary the suite gates on is in [capabilities.md](capabilities.md).

## Requirement ids

`expect(x, req('openwop.<area>.<slug>', '<doc> §<section>', '<requirement>'))` is the only assertion form. Ids are minted in `conformance/requirements.json`, and every test declares its id explicitly.

- A scenario assertion without a requirement id MUST fail the suite's lint.
- A title reword without a corresponding `requirement-aliases.json` row MUST fail CI.

The ledger records per `it`; a bundle's `results.requirements[]` is the per-assertion list. A post-assertion soft-skip MUST record `skipped` for every id not reached and MUST NOT record `pass`.

### Whose fact is the reason?

A soft-skip carries a disposition and a reason. The reason MUST identify a fact about the host under test.

- Use `inapplicable` only when the requirement does not bind that host.
- A missing fixture, unreadable corpus file, or other suite-side failure MUST be `blocked`, never `inapplicable`.
- A suite with a blocked row MUST NOT issue a certification.

When more than one gate can skip a test, evaluate host predicates before suite predicates.

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

- A protocol-tier invariant marked `unwitnessable` MUST fail the corpus gate.
- `tests: []` is expressible only as `unwitnessable`.
- `blocked` is a bundle disposition, not a witness class.
- A MUST whose only witness is `seam-gated` MUST either mint a normative observation path before the cut or be demoted to SHOULD.
- The seam count in `docs/witness-baseline.json` is a ratchet and MUST NOT rise.

## The seams profile

Test seams are the profile `openwop-conformance-seams-v2` (`spec/v2/profiles.json`), described by `api/seams-v2.yaml` with schemas under `schemas/v2/seams/`, in the path space `/conformance/seams/…`. The seam schemas `$ref` the canonical error and event schemas with no tolerance path. The profile is versioned with the suite (`seams-v2` for 2.x).

- A host that mounts the seams MUST advertise the profile as `conformance.seamsProfile: "openwop-conformance-seams-v2"` at the discovery root (the closed root has no `profiles[]`; [capabilities.md](capabilities.md) §3).
- A host MUST NOT advertise a `testSeams` capability flag.
- `api/v2/openapi.yaml` and `spec/v2/path-manifest.json` MUST contain no seam or sample-host operation; an SDK generated from the canonical document has no seam method.

## Two products, two ledgers

Corpus-coherence checks run in the spec repo's CI (`scripts/check-spec-coherence.mjs`) and MUST NOT appear in a host bundle; the bundle schema forbids their ids. `--offline` is a declared property of a scenario, not a runtime discovery.

- `@openwop/openwop-conformance@2.0.0` ships `dist`, `fixtures` and `vectors` only.
- The corpus — `api/`, `schemas/`, the `spec/v2/*.json` registries, `CORPUS-STAMP.json` — is `@openwop/spec-artifacts@2.0.0`, an exact-pinned peer dependency. The suite MUST digest-check it at start and MUST refuse to run against it on a mismatch.
- The suite is one package: `--target-major 1|2` selects the target (default: the host's `preferredVersion`), and scenario ids share one namespace across majors. The 1.x target is removed at v1 end-of-support.

## Bundle v3

A certification bundle validates against `schemas/v2/certification-bundle.schema.json`: closed root, `bundleVersion: "3"`.

| Field | Rule |
| --- | --- |
| `suite` | `name`, `version`, `targetMajor`, `specArtifactsVersion` REQUIRED |
| `host` | `name`, `version`, `build.{kind, id}` REQUIRED; `kind` is `image-digest`, `commit` or `artifact-sha256` |
| `host.deployment` | OPTIONAL; `colocated-companion` only (below). Absent: the bundle measures the served host |
| `discovery` | `url`, `sha256`, `protocolVersions`, `preferredVersion` REQUIRED |
| `claimedProfiles[]` | `id`, `evidenceTier` (`self` \| `steward` \| `independent`), `witnessCount`, `certified` REQUIRED |
| `results` | `totals` and the per-requirement list REQUIRED |
| `witnessSha256` | REQUIRED; SHA-256 of the preimage in §"Canonical JSON" |
| `assertionCount` | REQUIRED, ≥ 1 |
| `detail.nonPass[]` | REQUIRED when any total other than `executedPass` is non-zero |
| `results.requirements[].evidence` | OPTIONAL, closed; structured evidence on an `executed-pass` row (below) |
| `durability.rung` | OPTIONAL; a claim the verifier re-derives (below) |
| `signature` | REQUIRED |

### Signature and attribution

`signature` is an Ed25519 attestation over the JCS bytes (§"Canonical JSON") of `{ witnessSha256, host.build, suite.version, discovery.sha256 }`; `over` MUST list exactly those four members.

- A host that signs bundles MUST publish the corresponding public keys as `signingKeys[]` in its discovery document, and `signature.keyId` MUST name one of them.
- A verifier MUST resolve `keyId` there — in the discovery document of the host the bundle is *about* — and MUST verify the attestation under the published key.
- A retired key MUST stay listed.

A signature that cannot be resolved to a published key attests **integrity only**, and the bundle MUST NOT be read as attributable evidence. A gate MUST distinguish three outcomes that a presence check collapses into one: *no discovery document was read*, *read and the key is not published*, and *the attestation does not verify*.

`evidenceTier: independent` MUST carry a `verifierKeyId` distinct from the host's signing key. The verifier MUST refuse, not warn, on a missing or self-signed independent claim.

### Certification

- A bundle with `totals.blocked > 0` does not certify.
- At major 2 a requirement a test did not observe records `blocked`, even when the test asserted setup facts first.
- An `executed-pass` carrying a `partial-witness:` detail is reserved for a leg that observed its requirement and skipped an optional extra.
- A verifier MUST derive the operator's opt-outs from the signed `skipped` rows and MUST reject a bundle whose captured discovery document advertises one of them (`opted-out-but-advertised`).
- v1 and v2 bundles are never upgraded to v3; a bundle is evidence at its own version.

### Colocated companion

A *colocated companion* is the served host's image run beside the suite, so it can trust a suite-held trust anchor.

- A bundle cut from one MUST carry `host.deployment: "colocated-companion"`, which the preimage covers (§"Canonical JSON").
- A host serving production traffic MUST NOT list a suite-held trust anchor among the trust roots it advertises.
- A companion is evidence only for the requirements in `spec/v2/harness-trust-anchors.json`, and only when it pairs with a certified served-host bundle of the same `image-digest` build, signed under a key that bundle's discovery publishes, whose discovery document is equal once each document's origin and the `oidc` lane's `issuers` are set aside.

### Canonical JSON

Every signature and digest in this corpus is over the RFC 8785 (JCS) serialization, UTF-8 encoded. `conformance/vectors/jcs-v1.json` is normative.

The value MUST be I-JSON (RFC 7493):

- A signer or hasher MUST refuse, not coerce, a value with duplicate member names, a lone surrogate, a non-finite number, an integer literal whose magnitude exceeds 2^53 − 1, or a non-JSON value.
- A verifier that meets one in a document it must re-canonicalize MUST fail verification.

`witnessSha256` is SHA-256 over the JCS bytes of the rows:

- One object per `results.requirements[]` entry, with exactly `id`, `scenario`, `result` and, each only when present, `assertions`, `detail`, `evidence`.
- Rows sorted by `id` in UTF-16 code-unit order. A locale-sensitive comparator MUST NOT be used.
- Only when `host.relaxations[]` is non-empty or `host.deployment` is present, the preimage is instead `{ "rows": …, "relaxations": …, "deployment": … }`, carrying each of the last two only when so, with relaxations in the order carried.

`discovery.sha256` is SHA-256 over the JCS bytes of the captured document.

### Recovery evidence

Recovery evidence rides on rows: a row's `evidence` enters `witnessSha256` only when present.

| Row | `evidence` member |
| --- | --- |
| `0158.bound-is-derived` | `recoveryBounds[]` of `{ class, bound, terms[] }`, each term `{ name, ms }` |
| `0158.kill-after-accept`, `0158.kill-during-execution` | `recovery: { class, boundMs, observedMs }` |

- In `recoveryBounds[]`, `bound` MUST equal the sum of its terms. There is one entry per recovery class and no aggregate bound.
- In `recovery`, `class` is the class exercised, `boundMs` the bound applied, `observedMs` the kill-to-resumption interval.
- `class` and `name` are opaque host-chosen identifiers, never a closed vocabulary.

`durability.rung` is outside the attestation, so a verifier MUST re-derive it and MUST reject (`rung-not-derivable`) a claim it cannot derive. Derivation requires every row of the rung to be `executed-pass`, and each kill row's `class` to name a declared entry whose `bound` equals its `boundMs` and is not exceeded by its `observedMs`. Only `durable-single-instance` is derivable in this revision; a higher claim is refused.

This proves the arithmetic and that recovery ran once inside the bound. It does not prove the kill landed in the class it names; killing only once the execution claim is held is the host's obligation.

## Corpus-gate evidence

An RFC whose acceptance criteria are corpus gates rather than host scenarios records the evidence label **corpus gate — no host tier** in its `Updated` line. For such an RFC the accepted-predicate check reads `(corpus)` rows from `evidence/corpus-ledger.json` and MUST NOT require a host bundle.

*Sources: RFC 0158, RFC 0168, RFC 0212, RFC 0216.*

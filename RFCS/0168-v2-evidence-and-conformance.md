# RFC 0168: v2 evidence and conformance — requirement ids in source, witness class on every requirement, seams as a versioned profile evicted from the canonical API, two products in two ledgers, a suite that ships only the suite, and bundle v3 closed and signed

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0168                                                            |
| **Title**         | v2 evidence and conformance: `expect(x, req('openwop.<id>', …))` is the assertion form and the ledger records per `it` with a reword-without-alias CI failure (the Phase 1 helper exists with `explicitIds: 0` and an empty alias file — v2 makes it the only form); the witness verdict is a required field on every capability record, requirement and invariant from the closed six-class set, with `unwitnessable` requiring a rationale and failing the gate on a protocol-tier invariant; the six things v1 admits it cannot certify are the migration set, each mapped to one class; a seam-gated MUST mints a normative observation path or is demoted; `host-sample-test-seams.md` becomes the profile `openwop-conformance-seams-v2` with its own `api/seams-v2.yaml`, validated against the canonical schemas with no tolerance path, forbidden from the capability namespace, and its nine operations evicted from the canonical OpenAPI and the SDK path manifest; the 29 corpus-coherence scenarios leave host bundles for the spec repo's CI; the published suite is `dist`, `fixtures`, `vectors` only with the corpus as a digest-checked peer dependency `@openwop/spec-artifacts`; suite 2.0.0 is one package with `--target-major` and a shared scenario-id namespace; bundle v3 has a closed root, `bundleVersion: "3"`, `witnessSha256`, `assertionCount`, `detail`, `host.build`, per-profile `evidenceTier`/`witnessCount` required, and an Ed25519 attestation over `{witnessSha256, host.build, suite.version, discovery.sha256}` with `independent` requiring a verifier key distinct from the host's |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167 (the bundle is the artifact every security claim rests on). Adversarial review recorded below.) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C1.** v2 (Phase 3): `conformance/` 2.0.0 (`req()` as the only assertion form, per-`it` ledger, `--target-major`, `--offline` declared, corpus-coherence scenarios moved to `scripts/`), `@openwop/spec-artifacts` (NEW package: `api/`, `schemas/`, `spec/v2/*.json` registries, `CORPUS-STAMP.json`), `api/seams-v2.yaml` + `schemas/v2/seams/` (NEW profile), `api/v2/openapi.yaml` without the nine seam operations, `spec/v2/operation-path-manifest.json`, `schemas/v2/certification-bundle.schema.json` (v3, closed), `conformance/src/lib/certification-bundle-sign.ts` + `-verify.ts`, `spec/v2/declaration.json` (witness required per family — RFC 0169), `SECURITY/invariants.yaml` (`witness` required, `unwitnessable` needs `rationale`), `spec/v2/core/conformance.md`; v1.x (this PR): `spec/v1/migrations.json` rows `openwop.migration.C1.1`–`C1.10` (C1.1 re-kinded `behavior`: a bundle is never upgraded, a codemod would fabricate evidence); deprecation rows `seam-operations-in-canonical-api`, `suite-vendored-corpus`, `coherence-scenarios-in-host-bundle`, `certification-bundle-v2-open-root` (`proposed`); `conformance/src/cli.ts` help text corrected (`--bundle-version` default is `2`, not `1`; packed content, so suite `1.161.0 → 1.162.0`); `host-sample-test-seams.md` §Open spec gaps' two seam-flag proposals closed by deletion |
| **Compatibility** | `breaking` (v2). In v1.x this PR changes no wire shape; one CLI help string is corrected and two gap rows are closed |
| **Supersedes**    | — (amends RFC 0089, RFC 0148 §C, RFC 0154 G4, `host-sample-test-seams.md` for v2) |
| **Superseded by** | —                                                               |

## Summary

v1 can say a host passed and cannot say what it witnessed. 1,974 tests have stable ids derived from their titles, zero declare one, and the alias file is empty, so a reword silently orphans every bundle that cited it. Every extension record carries a witness class (Phase 1) but the requirement ledger does not, 55 invariants are `unwitnessable`, and 37 ship `tests: []`. The seams document is Stable, full of MUSTs, "NOT part of the v1 wire surface," and nine of its operations sit in the canonical 56-operation manifest an SDK generates from. Twenty-nine scenarios about the spec corpus report `blocked` in every host bundle about a host they never examined. The tarball vendors `api/` and `schemas/` and the README calls that a consumer contract — the 1.138.1 defect's mechanism, now digest-checked but still a copy. Bundle v2 regressed to an open root, lists `witnessSha256` nowhere, and the CLI's help text says the default is `1` while the code says `2`; the same commit rebuilt scored 283/22 and 303/2 and nothing in the bundle could tell them apart. v2 makes the requirement id the assertion, the witness class a required field everywhere a MUST lives, the seams a versioned profile outside the canonical API, the corpus a separate product the suite verifies by digest, and the bundle a closed, signed artifact.

## Motivation

- `conformance/requirements.json` `counts`: `files 473, tests 1974, withStableId 1951, interpolatedTitles 23, explicitIds 0`; `conformance/requirement-aliases.json` `aliases: {}`; `conformance/src/lib/requirement-ids.ts:101` `req(id, specSection, requirement)` exists (Phase 1) and no scenario calls it; the per-`it` ledger is `conformance/src/setup.ts:229–251`. The registry covers one id per file, which is what produces RFC 0148 G8 (post-assertion soft-skips that record a pass).
- `spec/v1/extensions.json`: 73 records with `witness` (`witnessable-gated` 51, `claims-check` 17, `seam-gated` 5); `SECURITY/invariants.yaml`: 191 rows with `witness`, 55 `unwitnessable`, 37 `tests: []`; `capabilities.md` §"What a capability may vary" names the hazard ("an unconditional requirement whose only conformance probe is gated on an optional advertisement is unfalsifiable on every host that does not advertise"). The six v1 admissions (shape-vs-behavior dual grade; blocked as "unobservable, not unmet"; install-time-only extension opacity; corpus-structural legs; gRPC end-to-end; negative-existence claims) each already have a class name and no rule that assigns it.
- `host-sample-test-seams.md:3` Stable; "NOT part of the v1 wire surface"; 136 live paths; `spec/v1/operation-path-manifest.json:137` carries `/v1/host/sample/a2a/tasks/{taskId}` and eight more seam/test operations (`/v1/host/workspace/files*`, four `/v1/packs-test/*`) among the 56 canonical operations; `:649–650` proposes two more discovery flags for seams.
- `conformance/src/lib/spec-coherence.ts` — 29 `SPEC_COHERENCE_SCENARIOS`, reported `blocked` per host bundle ("why not a new disposition value", `scenario-disposition.ts:124`); `conformance/package.json` `files` ships `src`, `api`, `schemas` with `prepack: pack-vendor.sh`; 16 `src/lib/*.test.ts` suite self-tests ride along; `conformance/README.md:100–102` "The vendored contract is digest-checked" — a copy verified at start, not a dependency.
- `schemas/certification-bundle-v2.schema.json`: root `additionalProperties: true`, no `witnessSha256` property; RFC 0148 §C says it MUST cover the reporter record; `conformance/src/cli.ts:206` "`--bundle-version <1|2>` … Default 1" while `:87` sets `'2'`; no signing helper exists; RFC 0148 G4 and RFC 0154 G4 record that no bundle is signed; RFC 0148 R5 open. `conformance-certification-bundle.schema.json` (v1) is closed; v2 opened it.
- Register: `openwop.migration.C1.1` is `retype` with `codemod: null` — §G.1 fails on this child unless re-kinded or given a codemod; a codemod that produces a v3 bundle from a v2 one would invent a witness digest and a signature.

## Proposal

### §A. Requirement ids and the ledger

**§A.1** `expect(x, req('openwop.<area>.<slug>', '<doc> §<section>', '<requirement>'))` is the only assertion form in suite 2.0.0; `driver.describe(...)` without an id fails the suite's own lint. Ids are minted in `conformance/requirements.json` (`explicitIds` = every test); a title reword without a `requirement-aliases.json` row fails CI (the generator diffs ids against the last published set). **§A.2** The ledger records per `it` (the Phase 1 seat) and the bundle's `results[].requirements[]` is the per-assertion list; a post-assertion soft-skip records `skipped` for the ids not reached, never `pass` (RFC 0148 G8 closed).

### §B. Witness class everywhere

**§B.1** `witness` from the closed set `witnessable-unaided | witnessable-gated | seam-gated | claims-check | negative-existence | unwitnessable` is required on every family in `spec/v2/declaration.json` (RFC 0169), every requirement in `requirements.json`, and every row of `SECURITY/invariants.yaml`; `unwitnessable` requires `rationale`; a protocol-tier invariant marked `unwitnessable` fails the gate; `tests: []` is expressible only as `unwitnessable`. **§B.2** The six v1 admissions map: shape-vs-behavior → `witnessable-gated` (the behavioral leg's class) never a dual grade; "blocked" → `seam-gated` or `unwitnessable`, never `blocked`; install-time-only extension opacity → `claims-check`; corpus-structural → the spec repo's CI (§D), not a host class; gRPC end-to-end → `unwitnessable` (RFC 0175 §A.1); negative-existence → `negative-existence`. **§B.3** A seam-gated MUST mints a normative observation path before the cut or is demoted to SHOULD; `compensation.md` G9 is the worked case and RFC 0173 §C is its path. The seam ratchet (`docs/witness-baseline.json`) publishes the count and cannot rise.

### §C. Seams as a profile

**§C.1** `openwop-conformance-seams-v2` is a profile with `api/seams-v2.yaml` and `schemas/v2/seams/*.schema.json`, `$ref`-ing the canonical error and event schemas with no tolerance path, and forbidden from the capability namespace: a host advertises the profile in `profiles[]`, never a `testSeams` flag (the two `:649–650` proposals are closed by deletion). **§C.2** The nine seam/test operations leave `api/v2/openapi.yaml` and `spec/v2/operation-path-manifest.json`; an SDK generated from the canonical document has no seam method. **§C.3** The profile is versioned with the suite (`seams-v2` for 2.x) and its numbering collision with the sample host is resolved by the profile's own path space `/conformance/seams/...`.

### §D. Two products, two ledgers

**§D.1** Corpus-coherence scenarios run in the spec repo's CI (`scripts/check-spec-coherence.mjs`) and never enter a host bundle; the published suite contains only host-facing scenarios; `--offline` is a declared property of a scenario, not a runtime discovery. **§D.2** `@openwop/openwop-conformance@2.0.0` publishes `dist`, `fixtures`, `vectors` only; `api/`, `schemas/`, the `spec/v2/*.json` registries and `CORPUS-STAMP.json` are `@openwop/spec-artifacts@2.0.0`, a peer dependency the suite digest-checks at start (the 1.138.1 mechanism removed: one source, no copy). Suite self-tests stay in the repo. **§D.3 Packaging.** One package; `--target-major 1|2` (default: the host's `preferredVersion`); scenario ids share one namespace with 1.x (bundles cite ids, and the alias file covers renames across the major); `schemas/v2/` is a sibling tree in `@openwop/spec-artifacts`.

### §E. Bundle v3

**§E.1** `schemas/v2/certification-bundle.schema.json`: closed root, `bundleVersion: const "3"`, required `witnessSha256` (over the reporter record, RFC 0148 §C), `assertionCount`, `detail` (required when any result is not `pass`), `host.build.{kind, id}`, per-profile `evidenceTier` and `witnessCount`, `host.relaxations[]` (RFC 0173 §A.2), `signature`. **§E.2** `signature` is an Ed25519 attestation over the canonical JSON of `{witnessSha256, host.build, suite.version, discovery.sha256}`; `evidenceTier: independent` requires a verifier key distinct from the host's signing key; the verifier (`certification-bundle-verify.ts`) refuses, not warns, on a missing or self-signed independent claim (RFC 0148 R5 mitigated; RFC 0148 G4 / RFC 0154 G4 closed). **§E.3** v1 and v2 bundles are never upgraded; v1 substantiates nothing after 2026-11-10 (row `certification-bundle-v1`); the v1 schema is deleted at the cut and the v2 schema is deleted at v1 end-of-support; every host produces a fresh v2-rc bundle before the cut (RFC 0176 §D.1). **§E.4 Now (v1.x):** the CLI help text is corrected to the code's default (`2`).

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C1.1` | behavior | certification bundle v1 (`bundleVersion "1"`) and v2 (open root) | bundle v3: closed root, witness/build/tier/count/signature required; earlier bundles never upgraded | — (a codemod would fabricate a witness digest and a signature; bundles are evidence at their version) | never-upgraded |
| `openwop.migration.C1.2` | require | `driver.describe(...)` citations; ids derived from titles; `explicitIds: 0` | `req()` the only form; ids explicit; reword without alias fails CI | — | not-persisted |
| `openwop.migration.C1.3` | require | `witness` on extensions and invariants only | `witness` required on every family, requirement and invariant; `unwitnessable` needs `rationale`; protocol-tier `unwitnessable` fails | — | not-persisted |
| `openwop.migration.C1.4` | behavior | six certification admissions in prose | each mapped to one class (§B.2); `blocked` retired as a bundle disposition | — | not-persisted |
| `openwop.migration.C1.5` | behavior | seam-gated MUSTs stay MUST | mint an observation path or demote; ratchet published | — | not-persisted |
| `openwop.migration.C1.6` | behavior | nine seam/test operations in the canonical OpenAPI and path manifest; `testSeams` flags | `openwop-conformance-seams-v2` profile with `api/seams-v2.yaml`; evicted from the canonical documents | — (a generated document; re-kinded `behavior` under RFC 0167 §D.4) | not-persisted |
| `openwop.migration.C1.7` | behavior | 29 corpus-coherence scenarios `blocked` in every host bundle | spec-repo CI; never in a bundle | — | not-persisted |
| `openwop.migration.C1.8` | behavior | tarball vendors `api/` + `schemas/` + `src` + self-tests | `dist`, `fixtures`, `vectors`; corpus via `@openwop/spec-artifacts` peer dependency, digest-checked | — (package contents; `behavior` under §D.4) | not-persisted |
| `openwop.migration.C1.9` | add | one package, `--bundle-version` | `--target-major`; shared scenario-id namespace; `schemas/v2/` sibling tree | — | not-persisted |
| `openwop.migration.C1.10` | add | no signature; `witnessSha256` unemitted | Ed25519 attestation; `independent` needs a distinct verifier key | — | not-persisted |

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| Published certification bundles (hosts' images; INTEROP-MATRIX citations) | v1 / v2 bundles | never-upgraded; v1 substantiates nothing after 2026-11-10; v2 until v1 end-of-support |
| `conformance/requirements.json`, `requirement-aliases.json` | title-derived ids; empty aliases | translated: explicit ids minted from the current derivation so every 1.x bundle id resolves through the alias file |
| npm tarballs `@openwop/openwop-conformance@1.x` | vendored corpus copies | unchanged (immutable publications); 2.0.0 ships without them |
| `docs/witness-baseline.json` | seam and self-carry ratchets | unchanged; the seam count may only fall |

## Compatibility

`breaking` (v2). This PR changes no v1.x wire shape: one CLI help string is corrected to match the code (a documentation fix), two seam-flag proposals in a gap table are closed, and register rows are added.

## Conformance

The child's own witnesses are corpus gates and the suite's self-tests: `req-only-assertions` (lint: no `describe` citation without an id), `alias-covers-reword` (generator diff), `witness-required` (declaration, requirements, invariants), `seams-not-in-canonical` (the canonical OpenAPI and path manifest name no `/conformance/seams/` or `/host/sample/` operation), `coherence-not-in-bundle` (bundle v3 schema forbids the 29 ids), `spec-artifacts-digest` (suite refuses to start on a mismatch), `bundle-v3-signed` (verify refuses an unsigned or self-signed `independent` bundle; the tampering vector flips `witnessSha256`).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 `req()` only; reword fails | suite lint + generator diff | the corpus gate | witnessable — unaided (corpus) |
| §A.2 soft-skip never records pass | bundle `results[].requirements[]` | the suite's self-test | witnessable — unaided (corpus) |
| §B.1 witness required; protocol-tier `unwitnessable` fails | corpus gate | the corpus gate | witnessable — unaided (corpus) |
| §B.3 seam-gated MUST minted or demoted | ratchet + falsifiability tables | the corpus gate | witnessable — unaided (corpus) |
| §C.2 no seam op in the canonical documents | OpenAPI + manifest | the corpus gate | witnessable — unaided (corpus) |
| §D.1 coherence ids absent from bundles | bundle schema | the suite, unaided | witnessable — unaided |
| §D.2 corpus digest-checked at start | suite refusal | the suite's self-test | witnessable — unaided (corpus) |
| §E.1 closed root, required fields | bundle schema | the suite, unaided | witnessable — unaided |
| §E.2 signature verifies; self-signed `independent` refused | verifier | the suite's self-test with a tampering vector | witnessable — unaided |

## Adversarial review

1. **A corpus gate is not a conformance witness; this child certifies nothing about a host.** Disposition: correct and intended — C.1 is the instrument, and its falsifiability rows say `(corpus)`; the host-facing witness is every other child's scenario running under this instrument.
2. **Re-kinding C1.1 from `retype` to `behavior` dodges the codemod rule.** Disposition: the disposition is `never-upgraded`; a transform that emits a v3 bundle from a v2 one must invent `witnessSha256` and `signature`, which is exactly RFC 0148 R5's "malicious generator fabricates witnesses"; RFC 0167 §D.4 permits the re-kind when the artifact is evidence, and the row says why.
3. **Splitting `@openwop/spec-artifacts` out makes two packages that can drift.** Disposition: they drift today inside one tarball (1.138.1); a peer dependency with a digest check at start is one source and one verification, and the tag-publish rule applies to both.
4. **Evicting the seams from the canonical OpenAPI breaks openwop-app's generated client.** Disposition: the seams profile has its own document; a host mounts it from `api/seams-v2.yaml`; the canonical SDK never had a reason to call a seam.
5. **`--target-major` on one package means a 2.x suite carries 1.x scenarios forever.** Disposition: through the overlap only; the 1.x target is removed at v1 end-of-support, same trigger as every other alias.
6. **Ed25519 attestation without a key registry is a signature nobody can check.** Disposition: the host's key is `host.build`'s signer published in its discovery document (`signingKeys[]`, RFC 0169 family); the verifier's key is the registry's `signingKeys[]` entry for the verifier org; both exist today for packs.
7. **The CLI help fix is a v1.x change.** Disposition: documentation matching code is a correction, not a wire change; it lands here because the inventory found it.

## Alternatives considered

1. Two suite packages (1.x and 2.x). Rejected: bundles cite scenario ids; one namespace with an alias file is the coexistence mechanism every other child uses.
2. Keep seams in the canonical OpenAPI under a tag. Rejected: an SDK generator does not read tags; two documents, two manifests.
3. in-toto instead of a bare Ed25519 envelope. Deferred: the attestation payload is fixed here; the envelope format is a Phase 3 choice recorded as G1.

## Unresolved questions

1. Whether the attestation envelope is a bare Ed25519 signature or an in-toto statement. Recommended: bare envelope in 2.0 with the in-toto wrapper as a v2.x additive.

## Implementation notes (non-normative)

The Phase 1 helper and ledger already exist; the 2.0.0 work is the lint, the generator diff, the eviction, the package split and the signer. openwop-app's `CERTIFICATION_BUNDLE_PATH` route serves v3 unchanged (a static file); its Phase 4 leg adds the host key to discovery.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; rows `C1.1`–`C1.10` (C1.1 re-kinded); four deprecation rows with detectors; CLI help corrected; the two seam-flag gap rows closed; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): suite 2.0.0 with `req()` only and the per-`it` ledger; `@openwop/spec-artifacts@2.0.0`; `api/seams-v2.yaml`; the canonical documents without seams; bundle v3 schema, signer and verifier; the seven self-tests; every other child's scenarios running under it; openwop-app's fresh v2-rc bundle verifying.

## References

- `conformance/requirements.json`, `conformance/requirement-aliases.json`, `conformance/src/lib/requirement-ids.ts`, `conformance/src/setup.ts`, `conformance/src/lib/spec-coherence.ts`, `conformance/src/cli.ts`, `conformance/package.json`, `conformance/README.md` §"The vendored contract is digest-checked"
- `schemas/certification-bundle-v2.schema.json`, `schemas/conformance-certification-bundle.schema.json`, `spec/v1/operation-path-manifest.json`, `spec/v1/host-sample-test-seams.md`, `spec/v1/capabilities.md` §"What a capability may vary", `SECURITY/invariants.yaml`, `docs/witness-baseline.json`
- RFC 0089; RFC 0148 §C/G4/G8/R5; RFC 0154 G4; RFC 0166; RFC 0167 §C/§D.4/§G.1; RFC 0169 §B; RFC 0173 §A.2/§C; RFC 0175 §A.1; RFC 0176 §D.1

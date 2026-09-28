# RFC 0222: v2 registry operations — lifecycle by publication, key rotation, and the checks a registry refuses on

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0222                                                            |
| **Title**         | v2 registry operations — lifecycle by publication, key rotation, and the checks a registry refuses on |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-28                                                      |
| **Updated**       | 2026-09-28 — filed and moved `Draft → Active` in the filing PR. **Comment window waived** (7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation", logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: registry lifecycle is not replay, an external effect or certification, and the signing-key rules neither widen nor narrow who may sign a namespace (`packs.md` §Signing already requires the `permittedNamespaces` check). The steward confirmed this on 2026-09-28: the key rules narrow nothing §Signing did not already require, and §A.6 names replay, external effects and certification, so no override is needed. The evidence gate is not waived. 2026-09-28 — both registry-side acceptance boxes ticked: openwop-registry #79 refuses a changed published version and a new version signed by a key that is not `active`. |
| **Affects**       | `spec/v2/core/packs.md` §Signing (the key list), §"Version manifests" (deprecate and yank), a submission sentence · `schemas/v2/registry-version-manifest.schema.json` `yanked` and `supersededBy` descriptions · `docs/runbooks/PACK-LIFECYCLE.md` · conformance: `v2-registry-lifecycle.test.ts` (suite 2.43.0) · openwop-registry: `build-index.mjs --tree v2`, `writeApi.publishUrl` |
| **Compatibility** | `additive` — the rules restate for v2 what `spec/v1/registry-operations.md` required, filtered to what the static tree can do. No schema shape, error code, status or endpoint changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The earlier major's `registry-operations.md` (about 4,000 words) specifies write endpoints — `POST …/deprecate`, `POST …/yank`, `GET …/keychain`, `POST …/keychain/rotate` — that the only real registry never served. `packs.openwop.dev` is a static signed tree whose `.well-known/openwop-registry.json` declares `writeApi: { supported: false, publishMethod: "github-pull-request" }`; every lifecycle change lands as a pull request. The v2 `packs.md` covers the tree, signing, `versionDeprecated` and three error codes, and says nothing normative about yank, key rotation, or what a registry refuses. `schemas/v2/registry-version-manifest.schema.json` carries `yanked`, `yankedReason`, `deprecationReason` and `supersededBy` with no v2 prose, and its `yanked` description contradicted both the earlier prose and the served tree.

This RFC gives v2 that prose, taken from what the registry actually does:

- **§A** Lifecycle changes are publications, not endpoints. The earlier write endpoints are not carried.
- **§B** Deprecate and yank: a yanked version stays served, is never the pack's `latest` while an unyanked version exists, and is excluded from range resolution. A version a registry advisory names is yanked.
- **§C** Keys: only an `active` key signs new publications; a key stays listed while any served version names it; a verifier does not refuse a version because its key stopped being `active`.
- **§D** The six checks a registry refuses a submission on, each mapped to an existing v2 error code.

## Motivation

Measured on 2026-09-28 against openwop-registry `origin/main` (`4c5de1f`) and the served tree:

- **The write endpoints do not exist.** `writeApi.supported` is `false`. No v2 operation in `api/v2/openapi.yaml` touches a registry.
- **`writeApi.publishUrl` was stale.** It named `github.com/openwop/openwop/pulls`, where pack submissions stopped landing at the repo split.
- **Yanked versions are served.** The v1 tree has seven yanked versions (for example `core.openwop.examples@1.0.0`, `vendor.openwop.rust-hello@1.0.0`); each still serves `.json`, `.tgz` and `.sig`. That matches the earlier prose ("Still served … consumers may need it for forensic analysis") and contradicts both the v2 schema description ("Registry MUST refuse to serve the tarball") and `PACK-LIFECYCLE.md` ("the registry MUST stop serving the tarball").
- **`latest` was not yank-aware.** `build-index.mjs` set `latest = versions[versions.length - 1]` and hard-coded `yanked: false` on every registry-wide row, although `PACK-LIFECYCLE.md` said it "excludes it from `latestVersion` resolution". `vendor.openwop.rust-hello`'s `latest` is its one, yanked, version. The v2 tree has no yanked version yet, so nothing served was wrong; the next yank would have been.
- **Key status is not read.** Every `signingKeys[]` entry is `status: "active"`. `verify-signatures.mjs` authorizes by `keyId` and `permittedNamespaces` alone, and verifies every version, yanked or not, so a key removed from the list fails the gate for every version it signed. `KEY-ROTATION.md` describes marking the old key non-`active` and removing it only after its versions are re-signed.
- **The lifecycle flags are unsigned.** The v2 signature covers the canonical `pack.json` inside the tarball (`packs.md` §Signing). `yanked` and `versionDeprecated` sit on the served version manifest, outside it. "A re-signed version manifest" is not what a lifecycle change is; it is a republication of unsigned registry metadata.

## Proposal

### §A. Lifecycle by publication

`spec/v2/core/packs.md` §"Version manifests":

> Lifecycle flags sit outside the signature; changing one republishes the version manifest.

The registry's `writeApi` (`.well-known/openwop-registry.json`) says how a submission is made; the protocol names no endpoint for it.

Not carried from the earlier major: the `deprecate`, `yank` and `keychain` endpoints and their scopes (`packs:yank`, `packs:yank-revert`), the `keychain` document with `validFrom` / `validUntil` / `rotationProof`, and the 72-hour unpublish window. A registry with a write API MAY still offer them; the protocol names none.

### §B. Deprecate and yank

> - `versionDeprecated: true`: still served; a consumer MAY refuse to install it.
> - `yanked: true`: its manifest, tarball and signature stay served, and the pack index MUST NOT name it `latest` while an unyanked version exists. A range MUST skip it; a pin MAY resolve it. Advisory-listed versions MUST be yanked.

"Advisory-listed" means named by an `affected[]` range in the registry's security-advisory feed (`schemas/v2/security-advisory.schema.json`). `deprecationReason`, `supersededBy` and `yankedReason` remain optional display fields.

Where each rule came from:

- **Still served:** the earlier "Yank flow §Effects" 1, and the served v1 tree (seven yanked versions, all three files `200` on packs.openwop.dev). The v2 schema's `yanked` description said the opposite and now says this.
- **Not `latest`:** the earlier "Effects" 3 (yanked versions leave range resolution) applied to the one resolution the registry itself performs. openwop-registry's `build-index.mjs --tree v2` now implements it; the v1 tree is frozen and keeps highest-semver.
- **Range vs pin:** the earlier "Yank consumer semantics" — a pin is contractual, a range skips the version.
- **Advisory → yanked:** `check-advisories.mjs`, which already fails the registry gate when an advisory's `affected[]` range matches an unyanked version, on both trees.
- **Deprecation:** unchanged from the existing v2 rule (still served, a consumer MAY refuse). The earlier SHOULD-warn is not carried: a warning is operator-facing, has no wire form, and the core word budget had no room for an unwitnessable SHOULD.

### §C. Signing keys

`spec/v2/core/packs.md` §Signing:

> Only a `signingKeys[]` entry whose `status` is `active` MAY sign a new publication. A key MUST stay listed while a served version names it, and a verifier MUST NOT refuse a version because its key is not `active`.

Every entry in the served `.well-known/openwop-registry.json` carries `keyId`, `publicKeyUrl`, `permittedNamespaces` and `status`; the conformance leg requires all four.

No schema for that document exists in the corpus, and this RFC does not add one. `active` is the only `status` value in use and the only one this RFC gives a meaning; any other value means "verifies what it signed, signs nothing new". `KEY-ROTATION.md` uses `rotated`, which is such a value. The "stays listed" rule is the earlier "old keys remain usable for old packs", and it is what `verify-signatures.mjs` already enforces by verifying every served version, yanked ones included. Since §B keeps a yanked version served, yanking does not release its key.

### §D. Submissions

> A registry MUST refuse a submission that breaks these rules or republishes a version, with `pack_integrity_failure`, `pack_validation_failed`, `pack_signature_invalid`, `pack_engine_unsupported`, `pack_peer_dependency_undefined` or `version_conflict`.

A write API answers with the code; a registry that publishes by pull request fails its gate. The checks and codes:

| Check | Code | openwop-registry gate (`npm run check`, v2 leg) |
| --- | --- | --- |
| `integrity` matches the tarball | `pack_integrity_failure` | `build-index.mjs --tree v2 --check` recomputes it |
| Both manifests validate against the schema for `kind`, and `name` and `version` match the path | `pack_validation_failed` | `test-registry-v2-schemas.mjs`, `check-pack-manifest-schemas.mjs`, `conformance-check.mjs --tree v2` |
| The version is not already published | `version_conflict` | `check-published-immutable.mjs` (openwop-registry #79): a published `.tgz` or `.sig` may not change, and its manifest may change only the lifecycle fields |
| The signature verifies under an `active` key permitted for the namespace | `pack_signature_invalid` | `verify-signatures.mjs --tree v2`, `check-pack-namespace-authority.mjs`; the `active` half is `check-published-immutable.mjs` (#79), on the versions a PR adds |
| `engines.openwop` admits the tree's major | `pack_engine_unsupported` | `check-pack-engines-admit-major.mjs --major 2` |
| Every `peerDependencies` key is defined | `pack_peer_dependency_undefined` | `check-pack-peer-dependencies.mjs` |

Taken from the earlier "Required checks", filtered: `X-Pack-Sha256`, the account-namespace claim, `invalid_engines_range`, `unsupported_runtime` and `schema_ref_missing` belonged to an upload endpoint or are now schema-validation failures. The namespace check uses `pack_signature_invalid`, as `packs.md` §Errors already says.

### Examples

**Conforming.** `core.openwop.ai` publishes 1.3.3, 1.4.0 and 1.4.1, and 1.4.1 is yanked: the pack index says `latest: "1.4.0"`, `versions[2].yanked: true`, and `/v2/packs/core.openwop.ai/-/1.4.1.{json,tgz,sig}` all answer `200`. `openwop-team-1` is marked `status: "rotated"` after a successor key is added; the versions it signed still verify, and it signs nothing new.

**Non-conforming.** The pack index keeps `latest: "1.4.1"` after the yank. The yank PR deletes `1.4.1.tgz`. A rotation PR removes `myndhyve-internal-1` from `signingKeys[]` while 39 served versions name it.

## Compatibility

`additive`. No schema shape, error code, status or endpoint changes; two schema descriptions are corrected to the prose. The registry conforms: its v2 tree has no yanked version, and `build-index.mjs --tree v2` now keeps a future one off `latest` (openwop-registry #77). A consumer that installed yanked versions by range was already outside the earlier major's rule.

## Conformance

`v2-registry-lifecycle.test.ts` reads a registry, not the host: it runs when `OPENWOP_REGISTRY_URL` names one, or `OPENWOP_TEST_PUBLIC_REGISTRY=true` names `packs.openwop.dev`, and records `inapplicable` otherwise. It is a major-2 file, so it runs in a major-2 lane (`OPENWOP_TARGET_MAJOR=2`). Paths come from `.well-known` `endpoints.v2`.

1. **`openwop.requirement.0222.yanked-version-lifecycle`** — every pack index agrees with its version manifests on `yanked` and `versionDeprecated`; `latest` is not yanked while an unyanked version exists; the registry-wide row agrees; every yanked version's tarball and signature are served.
2. **`openwop.requirement.0222.signing-keys-cover-served-versions`** — every served version names a listed key whose `permittedNamespaces` admit it, and its `integrity` and signature verify over the in-tarball `pack.json`, whatever the key's `status`.

Witnessed 2026-09-28:

| Registry | Result |
| --- | --- |
| `https://packs.openwop.dev` (live) | pass, 198 versions; leg 1 records `partial-witness` because no v2 version is yanked |
| local `serve.mjs`, `core.openwop.ai@1.4.1` yanked and rebuilt with the fixed `build-index` | pass, both legs non-vacuous |
| same, with every `openwop-team-1` and `myndhyve-internal-1` entry set `status: "rotated"` | pass (verify-after-retirement) |
| sabotage: pack index keeps the yanked version as `latest` | **fail** leg 1 |
| sabotage: the registry's previous `build-index.mjs` rebuilds the yanked tree | **fail** leg 1 (`latest` 1.4.1) |
| sabotage: index says not yanked, manifest says yanked | **fail** leg 1 |
| sabotage: the yanked tarball deleted | **fail** leg 1 and leg 2 |
| sabotage: `myndhyve-internal-1` removed from `signingKeys[]` | **fail** leg 2 (39 versions) |
| sabotage: its `permittedNamespaces` narrowed to one pack | **fail** leg 2 (38 versions) |
| sabotage: one signature byte flipped | **fail** leg 2 |

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B a yanked version stays served and is never `latest` while an unyanked one exists; index and manifest agree (`openwop.requirement.0222.yanked-version-lifecycle`) | the pack index, the version manifests, and `200` on a yanked version's files | the suite, given a registry URL | witnessable — gated (on a registry being named) |
| §B a consumer resolving a range excludes yanked versions | nothing: no v2 operation takes a version range | — | unwitnessable — no v2 operation installs a pack by range, so which candidate a host excluded never reaches the wire |
| §B advisory-listed versions are yanked | the advisory feed and the version manifests | the registry gate | witnessable — unaided (registry side: `check-advisories.mjs --tree v2` in openwop-registry `npm run check`) |
| §C a key stays listed while a served version names it, and a non-`active` key still verifies (`openwop.requirement.0222.signing-keys-cover-served-versions`) | `signingKeys[]`, each version's `signing.keyId`, and the signature over the in-tarball `pack.json` | the suite, given a registry URL | witnessable — gated (on a registry being named) |
| §C only an `active` key signs a new publication | a new version whose key is not `active` | the registry gate, at submission | witnessable — unaided (registry side only: `check-published-immutable.mjs` refuses a version a PR adds whose key is not `active`. The served tree cannot decide it, because `publishedAt` is unsigned and a key carries no retirement time) |
| §D the six submission checks | a submission refused, with the code or a failed gate | the registry gate | witnessable — unaided (registry side: openwop-registry `npm run check`, per the §D table) |

## Alternatives considered

1. **Carry the write endpoints into v2.** Nobody serves them, and the one registry would have to build an authenticated API to host what a pull request already does with review and history.
2. **Sign the lifecycle flags.** A signed version manifest would stop a mirror from stripping `yanked`. It is a new signature over a new preimage, and a certification-class change; out of scope, recorded as risk R1.
3. **Stop serving a yanked tarball.** That is what the schema description and runbook said. It breaks every exact pin, which the earlier prose promised would keep working, and no yanked version on the live tree has ever been withheld.
4. **Define a `status` vocabulary now.** Only `active` is in use. Naming `rotated`, `revoked` and `retired` before anything reads them would be vocabulary without a witness.

## Unresolved questions

None.

## Implementation notes (non-normative)

- openwop-registry: `writeApi.publishUrl` → `github.com/openwop/openwop-registry/pulls`; `build-index.mjs --tree v2` keeps a yanked version off `latest` and marks the registry-wide row `yanked` only when every version is (openwop-registry #77, merged).
- `docs/runbooks/PACK-LIFECYCLE.md` now says a yanked tarball stays served and a publication PR goes to openwop-registry.

## Acceptance criteria

- [x] `Active`: the `packs.md` rules, the corrected schema descriptions, and `v2-registry-lifecycle.test.ts` (suite 2.43.0), passing on the live registry and sabotage-proved on a local one.
- [x] openwop-registry's gate refuses a new version signed by a key whose `status` is not `active` (§C first rule; §D signature cell). openwop-registry #79, `scripts/check-published-immutable.mjs`, runs in the `registry-publish` PR job against the PR base and in `npm run check`. Sabotage: a new version signed by a key set to `rotated`, or by an unlisted key, is refused; a new version signed by an active key passes.
- [x] openwop-registry's gate refuses a change to an already-published version's tarball or `pack.json` (§D `version_conflict` cell). Same script, same PR (#79). Refused: a modified `.tgz`, a flipped or deleted `.sig`, and an edited non-lifecycle field. Passed: setting all six lifecycle fields. It also failed in CI on a pushed sabotage commit that flipped a `.sig` byte (run 36418742170) before that commit was reverted. No published v2 artifact had ever been modified or deleted, so it blocks no past practice.
- [ ] Leg 1 `executed-pass` without `partial-witness` on the live registry — needs a yanked v2 version to exist.

## References

- `spec/v1/registry-operations.md` §"Validation flow", §"Deprecation flow", §"Yank flow", §"Signing-key rotation flow".
- openwop-registry `registry/.well-known/openwop-registry.json`, `registry/scripts/{build-index,verify-signatures,check-advisories}.mjs`, `scripts/registry-check.sh`.
- `docs/runbooks/KEY-ROTATION.md`, `docs/runbooks/PACK-LIFECYCLE.md`.
- RFC 0177 (the v2 registry tree), RFC 0212 (canonical JSON signing).

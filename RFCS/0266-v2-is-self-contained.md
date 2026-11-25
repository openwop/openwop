# RFC 0266: v2 is self-contained — no current v2 artifact depends on frozen v1

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0266                                                            |
| **Title**         | v2 is self-contained — no current v2 artifact depends on frozen v1 |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-25                                                      |
| **Updated**       | 2026-11-25 — filed straight to **`Active`**; comment window waived, not run, by the maintainer directly. **STEWARD OVERRIDE of RFC 0147 §A.6 — outside this grant** (recorded in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers"). RFC 0001 §5: the cross-organization review this would otherwise get is deferred while the maintainer set is one organization. |
| **Affects**       | new `spec/v2/deprecations.json` + schema, new `spec/v2/major-1-migrations.json` + schema; `spec/v2/core/overview.md`, `capabilities.md`, `versioning.md`, `security-defaults.md`, `packs.md` (register and registry-tree citations); prose homes in `spec/v2/core/*` or `schemas/v2/*` descriptions for the concepts in §B.2; `scripts/derive-v2-api.py`, `scripts/derive-v2-schemas.mjs`; new gate `scripts/check-v2-self-contained.mjs`; `spec-artifacts/` package contents; `registry/.well-known/openwop-registry.json` (openwop-registry) |
| **Compatibility** | `additive` on the wire (no request, response, event or discovery shape changes for a v2 host). §D changes the contents of the `@openwop/spec-artifacts` package and §E changes registry discovery after a dated floor; both carry a migration below. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

v1 reached end of support on 2026-10-04 (RFC 0234), and its tree is frozen as history. But v2 still leans on it. Normative v2 prose cites `spec/v1/deprecations.json` and `spec/v1/migrations.json` as the registers that hold live rules. 39 files under `spec/v2`, `schemas/v2` and `api/v2` carry 125 `spec/v1/…` references and about 150 bare v1 document names. Several concepts the v2 schemas use have their only prose in a v1 document. The v2 OpenAPI and 37 v2 schemas are generated from v1 sources. `@openwop/spec-artifacts` 2.x still ships the v1 tree. This RFC makes v2 self-contained: every rule, register and generator a current v2 artifact depends on lives in v2, and frozen v1 is an archive that nothing current reads.

## Motivation

- **A frozen tree cannot hold a live rule.** `overview.md:24,45` says alias removal dates live in `spec/v1/deprecations.json`, and three of its rows (`removeIn: 3.0`) are live v2 deprecations. RFC 0234 §A.3 says the v1 tree is "not edited token by token", so a v2 deprecation can never be added, changed or removed there without breaking the freeze.
- **A v2 implementer must read v1 to implement v2.** Channels and reducers (`channels-and-reducers.md`, 626 lines), observability privacy classification, the `x-host-` naming convention, pack naming and `agents[]`, the prompt resolution chain, stream modes, run options, the debug bundle and the `requiredModelCapabilities` registry are referenced by v2 schemas and have no v2 prose. `IMPLEMENT-CORE.md` already names corpus size as the main barrier; sending a first independent host into a retired major makes it worse.
- **v2 is generated from v1.** `derive-v2-api.py` builds `api/v2` from `api/openapi.yaml` (v1) and `derive-v2-schemas.mjs` seeds v2 schemas from v1; 37 still carry `x-openwop-seeded-from: v1`. A fix to a v2 operation has to be expressed as a change to the frozen v1 input or survive regeneration by accident.
- **The published package still advertises v1 as current input.** `@openwop/spec-artifacts@2.49.x` ships 82 flat v1 schemas, the v1 OpenAPI, AsyncAPI and gRPC files and 15 v1 registries, and its description says "v1 and v2". Hosts read from it: openwop-app's CORS header generator reads `api/openapi.yaml` (v1).
- **Doing nothing** keeps every one of these, and makes "v1 is retired" true of the wire but false of the documents that define the wire.

## Proposal

### §A. v2 owns its registers

**§A.1** `spec/v2/deprecations.json` (schema `spec/v2/deprecations.schema.json`) is the deprecation register for the v2 representation. It carries every row whose removal trigger is a v2 event — `removeIn` a 2.x minor or `3.0`, or `removalTrigger` `v1-installability-floor` (§E) — moved verbatim from `spec/v1/deprecations.json` with an added `movedFrom` field naming the v1 row id. The three `removeIn: 3.0` rows (`packs-test-mode-facet`, `observability-test-seams-facet`, `v2-family-false-booleans`) are the initial content, plus the §E row.

**§A.2** `spec/v2/major-1-migrations.json` (schema `spec/v2/major-1-migrations.schema.json`) holds the v1→v2 migration rows that v2 prose cites: `C2.*` (`capabilities.md:96,455`), `C5.*` (`versioning.md:189`) and `C6.*` (`security-defaults.md:144`), copied with their codemod ids. `spec/v2/migrations.json` stays the v2→v2 register of RFC 0197 R1 and is unchanged.

**§A.3** The four citing sites (`overview.md:24,45`, `capabilities.md:24,96,455`, `versioning.md:189`, `security-defaults.md:144`) cite the §A.1 and §A.2 registers. The v1 files are not edited (RFC 0234 §A.3); they keep their rows as history.

### §B. No current v2 artifact cites v1 as a rule

**§B.1** A file under `spec/v2/`, `schemas/v2/` or `api/v2/` MUST NOT cite a `spec/v1/` path, a flat `schemas/*.schema.json` path, `api/openapi.yaml`, `api/asyncapi.yaml` or a v1-only document name as the home of a rule it relies on. It MAY name v1 as history (a migration note, a "replaced X" sentence) when the sentence says so. `scripts/check-v2-self-contained.mjs` enforces this with an allow-list whose every row states why the reference is history, and fails on any new unlisted reference. `spec/v2/errors.json` `"v1 convention (node-packs.md)"` provenance strings are rewritten to name their v2 home.

**§B.2** Each concept below gets a v2 home. A small rule moves into the description of the v2 schema that uses it (the RFC 0261 precedent); a rule with behaviour gets a section in the named core document, inside the `check-core-budget` cap.

| Concept (v1 home) | v2 home |
| --- | --- |
| Channels and reducers (`channels-and-reducers.md`) | `spec/v2/core/runs.md` §Channels, summarising the reducer contract the v2 `workflow-definition` channel fields use; detail in the schema descriptions |
| Observability privacy classification (`observability.md`) | `spec/v2/core/telemetry.md` §Privacy classification |
| `x-host-` naming and host-extension paths (`host-extensions.md`) | `spec/v2/core/capabilities.md` §Host extensions |
| Pack naming and `agents[]` (`node-packs.md`) | `spec/v2/core/packs.md` §Names and agents |
| Prompt resolution chain (`prompts.md`) | `spec/v2/core/host-services.md` §`prompts` (Resolution already exists; it absorbs the cited rule) |
| Stream modes (`stream-modes.md`) | `spec/v2/core/events.md` §Stream modes |
| Run options (`run-options.md`) | `spec/v2/core/runs.md` §Run options |
| Debug bundle (`debug-bundle.md`) | `spec/v2/core/runs.md` §Debug bundle, or retired if no v2 operation serves it (decided in implementation; see UQ 1) |
| `requiredModelCapabilities` registry (`host-capabilities.md`) | `spec/v2/core/host-services.md` §`modelCapabilities` |
| Agent roster and org chart (`agent-roster.md`, `agent-org-chart.md`) | `spec/v2/core/execution.md` §Roster and §Org chart, beside the existing table row |

A concept that no v2 schema, operation or event uses is not re-homed; its v2 references are deleted instead.

### §C. v2 is generated from v2

**§C.1** `api/v2/openapi.yaml`, `api/v2/asyncapi.yaml` and `schemas/v2/*` are their own source. `derive-v2-api.py` and `derive-v2-schemas.mjs` stop reading v1 inputs; after a one-time cut-over they either derive only from v2 sources or are retired, and `openwop-check.sh` stops running the v1→v2 derivation. No v2 schema carries `x-openwop-seeded-from: v1`.

**§C.2** `docs/PROTOCOL-STATUS.md` headline counts (documents, schemas, operations) are computed from the v2 tree, and the root `package.json` version names the corpus major.

### §D. The published package stops shipping v1

**§D.1** From the first `@openwop/spec-artifacts` release after this RFC is `Accepted`, the 2.x package ships v2 contents only: no flat `schemas/*.schema.json`, no `api/openapi.yaml`, `api/asyncapi.yaml` or `api/grpc/openwop.proto` (v1), no `spec/v1/*.json`. Its description stops saying "v1 and v2".

**§D.2** The frozen v1 contents stay installable from the last 2.x release that ships them, which is named in the CHANGELOG entry for §D.1. Earlier 1.x and 2.x releases are never unpublished, so the 12-month installability floor of `overview.md:74` (to 2027-09-05) is met.

### §E. Registry discovery names v2 first

**§E.1** `.well-known/openwop-registry.json` `endpoints` names the v2 tree, and names the v1 tree until the v1 installability floor (2027-09-05). The flat v1-era alias keys stay until the floor and are deprecated by a §A.1 row with `removalTrigger: v1-installability-floor`. `protocolVersion` names `2.0`.

**§E.2** After the floor, `endpoints` MAY name only the v2 tree, and the v1 tree MAY stop being served. `packs.md:41` ("it names both trees") becomes "it names the v2 tree, and the v1 tree until the v1 installability floor".

**§E.3** `schemas/v2/registry-version-manifest.schema.json` and `security-advisory.schema.json` name `registry/v2/packs/` paths, not `/v1/packs/`.

## Compatibility

`additive` on the wire: no v2 request, response, event, error code or discovery field changes. Every rule that moves (§A, §B) moves with its meaning unchanged; a reader who resolved it through v1 gets the same answer through v2.

Two published surfaces change, each with a migration:

- **`@openwop/spec-artifacts` (§D).** A consumer that reads v1 files from the 2.x package pins the last release that ships them (named in the CHANGELOG), or moves to the v2 file. openwop-app is the one known steward consumer (its CORS header generator and its flat-schema loaders); it migrates before §D.1 ships (Acceptance criteria).
- **Registry discovery (§E).** Nothing changes for a client before 2027-09-05 except `protocolVersion` and the deprecation row. After the floor, a client that still resolves the flat v1 keys must resolve `endpoints.v2`.

## Conformance

These are corpus rules, so most are witnessed by the corpus gate rather than a host scenario.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1–§A.3 registers in v2 | the four citing sites name `spec/v2/*.json`; the registers validate against their schemas | anyone editing the corpus; `check-v2-self-contained` fails on a v1 register citation | witnessable (corpus gate) |
| §B.1 no v1 rule citation | `check-v2-self-contained` lists every v1 reference in `spec/v2`, `schemas/v2`, `api/v2`; an unlisted one fails it | the gate, unaided (sabotage: add a `spec/v1/` citation to a v2 doc) | witnessable (corpus gate) |
| §B.2 prose homes | each concept's v2 home exists; `check-v2-self-contained` finds no v1 doc name for it | the gate | witnessable (corpus gate) |
| §C.1 v2 generated from v2 | no `x-openwop-seeded-from: v1`; `openwop-check.sh` reads no v1 input | the gate (sabotage: re-add the stamp) | witnessable (corpus gate) |
| §D.1 package contents | `npm pack` of `@openwop/spec-artifacts` lists no v1 file | anyone, from the published tarball | witnessable |
| §E.1 registry discovery | `GET packs.openwop.dev/.well-known/openwop-registry.json` names `endpoints.v2` and `protocolVersion: "2.0"`; the alias-key deprecation row exists | anyone, unaided | witnessable |

A host-side witness for acceptance: a host's certified major-2 cut on a suite release that carries this RFC, with the host reading no v1 corpus file (below).

## Alternatives considered

1. **Delete the v1 tree.** Rejected by the maintainer (2026-11-24): RFC 0234 freezes v1 as history, v1 `$id`s are immutable, and 1.x packages must stay installable to 2027-09-05. Self-contained v2 gets the benefit without destroying the record.
2. **Edit the v1 registers in place.** Breaks the RFC 0234 freeze, and leaves a v2 implementer reading v1 to find a v2 rule.
3. **Keep v1 in `@openwop/spec-artifacts` under a `legacy/` path.** Keeps the package's description honest but keeps every consumer one import away from treating v1 as current input; a pinned last release does the archive's job without that.
4. **Do nothing.** See Motivation.

## Unresolved questions

1. **Debug bundle.** Whether any v2 operation serves the v1 debug bundle. If none does, §B.2 deletes the v2 references instead of re-homing them. Decided during implementation by reading `path-manifest.json`; recorded in the gap register.
2. **Word budget.** Whether §B.2's core-document sections fit `check-core-budget`. Where they do not, the rule moves into schema descriptions; the cap is not raised by this RFC.

## Implementation notes (non-normative)

- Sequencing: §A and §B.1 first (registers, citation gate with an allow-list seeded from today's references), then §B.2 a concept at a time, then §C, then §D and §E.
- The gate's allow-list starts with every current reference marked `history` or `to-rehome`; `to-rehome` rows must reach zero for acceptance.
- openwop-app work (its v2 migration plan, phase 3): CORS header generation reads `api/v2/openapi.yaml` only; the seven flat-schema loaders read `schemas/v2`; then its vendored flat `schemas/` copy is deleted.

## Acceptance criteria

- [ ] §A registers merged, schemas validate, the four citing sites updated.
- [ ] `check-v2-self-contained` in `openwop-check.sh`, sabotage-witnessed, with zero `to-rehome` rows.
- [ ] §B.2 homes merged (or UQ-1 deletions recorded); `check-core-budget` green.
- [ ] §C: no v2 artifact generated from a v1 input; no `x-openwop-seeded-from: v1`.
- [ ] §D: an `@openwop/spec-artifacts` release ships no v1 file; CHANGELOG names the last release that does.
- [ ] §E: openwop-registry discovery updated and deployed; the alias-key deprecation row in `spec/v2/deprecations.json`.
- [ ] **Host evidence (tier-1):** openwop-app's certified major-2 production cut on the suite release that ships §D, with the app's build and runtime reading no v1 corpus file (its `check-v1-reliance` extended to corpus inputs).
- [ ] CHANGELOG entry; register sweep (`RFCS/registers/0266-*.gaps.md`, `.risks.md`).

## References

- RFC 0234 (v1 end of support), RFC 0168 §D (suite major), RFC 0177 §A.3 (registry tree), RFC 0197 R1 (v2→v2 migration register), RFC 0261 (schema-description home precedent).
- `spec/v2/core/overview.md`, `capabilities.md`, `versioning.md`, `security-defaults.md`, `packs.md`.
- The 2026-11-24 v1-residue inventory behind the steward's v2 migration plan.

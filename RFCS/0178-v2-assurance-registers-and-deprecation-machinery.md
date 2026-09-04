# RFC 0178: v2 assurance registers and deprecation machinery — removal dates that bite, one gap namespace with witnesses, falsifiability as data, hygiene the cut does not carry forward

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0178                                                            |
| **Title**         | v2 assurance registers and deprecation machinery: `spec/v1/deprecations.json` becomes normative — every row generates `deprecated: true` and `x-openwop-remove-in` onto its schema and API nodes, and a removal date that has passed with the surface present fails the merge gate; `gaps.json` rows carry a real witness class and a requirement id, the per-RFC `G<n>` becomes an alias row with a scheduled removal, and the RFC falsifiability tables become the same data with a parser gate; cross-repo evidence stays resolved; schema and API hygiene (README maturity column, "kept in sync" mirrors, redocly suppressions, a stale artifact-type gap row) is fixed rather than carried into `schemas/v2/` |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167. Adversarial review recorded below.) · 2026-09-03 (filed). Evidence tier: corpus gate — no host tier is claimed at the release candidate (GOVERNANCE.md §"Acceptance evidence tiers"; the openwop-app bundle is a Phase 4 entry item). |
| **Affects**       | **Part of: RFC 0167 — child C11.** v1.x (this PR, non-wire): NEW `scripts/check-falsifiability.mjs` (every RFC 0167 child's falsifiability table parses and resolves); `spec/v1/gaps.json` witness classification begins (the 24 RFC 0167-family rows classified; ratchet lowered); `scripts/check-alias-coverage.mjs` covers every `kind`; `api/redocly.yaml` step citation corrected; `schemas/README.md` maturity column regenerated from RFC status; `spec/v1/artifact-type-packs.md:195` gap row closed. v2 (Phase 3): `scripts/generate-deprecation-annotations.mjs` writing `deprecated: true` + `x-openwop-remove-in` into `schemas/v2/` and `api/v2/`; `scripts/check-removal-dates.mjs`; `gaps.json` `requirementId` required for `open` rows on v2 RFCs; the four `$comment` mirrors generated or deleted; `redocly.yaml` suppressions re-enabled |
| **Compatibility** | `breaking` (v2) as a child; the v1.x items are gates, data classification, and editorial hygiene — no wire artifact changes. `COMPATIBILITY.md` §7's "the annotation is informational, not normative" holds through v1.x and is restated as binding only in `spec/v2/` |
| **Supersedes**    | — (restates `COMPATIBILITY.md` §7 for v2; RFC 0166 §B/§C remain the v1 register authorities) |
| **Superseded by** | —                                                               |

## Summary

Zero `deprecated:` annotations in 88 schemas, OpenAPI, and AsyncAPI; a deprecation register whose removal dates are validated for shape and enforced against nothing; a gap namespace of 558 rows every one of which is `witness: unclassified` and `requirementId: null`; falsifiability tables required by the template, present in nine RFCs, parsed by nothing; a schemas README whose "FINAL v1" header sits over rows that say Draft for Accepted RFCs; four schemas promising to be "kept in sync" with no gate; a redocly suppression citing a gate step that moved. v2 makes the register the source of the annotations and the removal dates a merge gate, binds every gap to a witness class and a requirement id, turns the falsifiability tables into checked data, and fixes the hygiene before `schemas/v2/` inherits it.

## Motivation

- `COMPATIBILITY.md:191` already says: "The v2 major makes the register normative (removal dates enforced at merge); see the v2 charter program item C.11." This is that item.
- `spec/v1/deprecations.json` has 27 rows and `codemod: null` on 24; `scripts/check-deprecations.mjs:15` validates `removeIn ≥ 2.0` and nothing consumes the date. `grep deprecated api/openapi.yaml` → 0; `api/asyncapi.yaml` → 0; the only `deprecated` in `schemas/` are enum values and a pack-manifest wire field (`registry-version-manifest.schema.json:173`) that an annotation generator must not collide with. `x-openwop-remove-in` exists only in RFC 0167 §C.11's proposal.
- `spec/v1/gaps.json`: 558 entries, `witness: unclassified` on 558, `requirementId: null` on 558, 389 `carried` (71%). The ratchet RFC 0166 landed has not moved.
- The template has required a falsifiability table since 2026-08-19; nine of 164 RFCs have one; `grep Falsifiability scripts/` → nothing. RFC 0167 §C (d) requires every child's rows to resolve to `gaps.json` ids or requirement ids and nothing checks it.
- `schemas/README.md:3` "Status: FINAL v1" over `:26` DRAFT, `:35–:39` "RFC 0114 (`Active`)", "RFC 0056 (`Draft`)", "RFC 0060 (`Active`)" — all three RFCs are Accepted. `schemas/conversation-event.schema.json:14,24,53,58` say "kept in sync" with `conversation-turn.schema.json` and `agent-ref.schema.json`; nine more files say "Mirrors X"; `capabilities.schema.json:2636` even states "the two surfaces MUST NOT disagree" with no gate. `api/redocly.yaml:20` cites step `[7/9]` for a compensator that runs in step `[4/9]`.
- `spec/v1/artifact-type-packs.md:195` says the bounded-compilation invariant and test do not exist; `SECURITY/invariants.yaml:331` and `conformance/src/coherence/artifact-schema-compile-bounded.test.ts` exist.

## Proposal

### §A. The deprecation register is normative in v2

**§A.1** In `spec/v2/`, `deprecations.json` is the **source** of every deprecation annotation: `scripts/generate-deprecation-annotations.mjs --write` sets `deprecated: true` and `x-openwop-remove-in: "<major>.<minor>"` on every `schemas/v2/` node and `api/v2/` operation, parameter, header, and channel the row's `surface`/`sources` name; `--check` fails when an annotation exists with no row or a row has no annotated node. The pack-manifest wire field `deprecated` (a version's advisory flag) is a different thing and is renamed `versionDeprecated` in the v2 manifest schema (C.10 row) so the annotation keyword is unambiguous.

**§A.2** `scripts/check-removal-dates.mjs` fails the merge gate when a row's `removeIn` major is at or below the corpus major and the surface is still present (a detector token still found, an annotated node still present, or a codemod-able migration row still `kind ≠ behavior` with the surface in the tree). `COMPATIBILITY.md` §7's "informational, not normative" is restated for v2: **the annotation binds; a deprecated surface continues to pass conformance until its removal version and fails the corpus gate after it.**

**§A.3** Every `deprecated` row of a codemod-able kind names a codemod by the umbrella's §G.1 predicate (RFC 0167 §D.3); every row of every `kind` has an alias detector — `check-alias-coverage.mjs` gains `prose-convention`, `artifact`, and `error-code` as visible kinds (this PR).

### §B. One gap namespace, with witnesses and requirement ids

**§B.1** `gaps.json` rows on a v2 RFC MUST carry a `witness` class other than `unclassified` and, when `disposition: open`, a `requirementId` (an id in `conformance/requirements.json` or a `planned:` id the C.1 suite will mint). `generate-gaps.mjs --check` fails a v2 row without them; v1 rows keep the ratchet.

**§B.2** The per-RFC `G<n>` is an alias: `gaps.json` already records `(rfc, local)`; in v2 the register files carry only the `openwop.gap.<rfc>.<n>` id in the ID column and `G<n>` is accepted as an alias until 2.1, when the alias column is removed (register row `openwop.deprecation.gap-local-alias`, `proposed`, `kind: prose-convention`).

**§B.3** A `carried:` target MUST be a different open row or a tracked surface (RFC 0174 §C.2); a gap that cites an artifact contradicting it (a test it says does not exist, an endpoint it says is deferred) fails — `check-gap-contradictions.mjs` resolves `sources[].file` tokens and, for rows whose text names a scenario or an OpenAPI path, checks existence (this PR lands the scenario/path resolver; `artifact-type-packs.md:195` is its first catch and is closed here).

**§B.4** The 43 prose "Open spec gaps" tables are absorbed in Phase 3 (RFC 0174 §E.3 owns the adapter); this RFC owns the row shape they land in.

### §C. Falsifiability tables are data

**§C.1** `scripts/check-falsifiability.mjs` parses every RFC's `### Falsifiability` table (the template shape: Requirement · Observable · Who can cause · Verdict) and fails when: an RFC 0167 child has no table; a row's verdict is not from the closed set (`witnessable — unaided | witnessable — gated | witnessable — unaided (corpus) | seam-gated | claims-check | negative-existence | unwitnessable`, mapped onto the RFC 0166 §C.1 enum); an `unwitnessable` row does not say why; a row names a scenario file that does not exist. This PR lands the parser and runs it over RFCs 0167, 0169, 0172, 0174, 0178. **§C.2** In v2 the parsed rows are emitted into `gaps.json` as `kind: requirement` entries with `requirementId` bound, so the falsifiability table and the gap register are one dataset viewed two ways.

### §D. Cross-repo evidence

**§D.1** `evidence/cross-repo-manifests.json` (Phase 1) stays the resolver; in v2 every `<repo>:<path>` pointer in `SECURITY/invariants.yaml`, `conformance/coverage.md`, and the INTEROP-MATRIX MUST resolve in the committed manifest and a missing sibling is never a pass (already the rule; restated as normative in `spec/v2/`).

### §E. Hygiene the cut does not carry forward

**§E.1** `schemas/README.md`'s maturity column is checked against the owning RFC's status now (`check-rfc-status-coherence.mjs`, this PR — five stale rows corrected) and generated in Phase 3; the "FINAL v1" header becomes the generated corpus version then. **§E.2** The four "kept in sync" mirrors in `conversation-event.schema.json` are generated from `conversation-turn.schema.json` and `agent-ref.schema.json` in Phase 3 or the mirror is replaced by a `$ref`; the nine "Mirrors X" comments get a `check-schema-mirrors.mjs` that diffs the named subschemas (Phase 3). **§E.3** `api/redocly.yaml`'s two suppressions are re-enabled in Phase 3 once the `if/then` sites are generated; the step-number citation is corrected now. **§E.4** `artifact-type-packs.md:195` is closed now; the doc's `Status: Stable` stands because the invariant and test exist.

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C11.1` | behavior | `deprecations.json` as an index; `Deprecated:` annotation informational | register generates annotations; removal dates enforced at merge | — (generator) | not-persisted |
| `openwop.migration.C11.2` | rename | pack-manifest wire field `deprecated` (advisory version flag) | `versionDeprecated` | `openwop.codemod.manifest-version-deprecated` (this PR; registry/v2 re-signs in Phase 3) | never-upgraded (signed manifests; registry/v2 re-signs or overlays) |
| `openwop.migration.C11.3` | behavior | `gaps.json` rows `witness: unclassified`, `requirementId: null` | witness class required; `requirementId` required on open v2 rows | — | not-persisted |
| `openwop.migration.C11.4` | behavior | per-RFC `G<n>` as the register id | `openwop.gap.<rfc>.<n>` as the id; `G<n>` alias until 2.1 | — | not-persisted |
| `openwop.migration.C11.5` | behavior | falsifiability tables as prose | parsed, checked, emitted into `gaps.json` | — | not-persisted |
| `openwop.migration.C11.6` | behavior | `schemas/README.md` maturity column hand-written | checked against RFC status (v1.x); generated (v2) | — | not-persisted |

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| openwop-registry signed manifests (282) | `deprecated` wire field on a version | never-upgraded; `registry/v2/` re-signs or overlays with `versionDeprecated` (C.10) |
| Corpus registers | `gaps.json`, `deprecations.json` | translated in place (data files, not host data) |

## Compatibility

`breaking` (v2) as a child. In v1.x this PR adds three corpus checks, classifies 24 gap rows, corrects a config comment and a README column, and closes one stale gap row; no wire artifact changes. §A.2's binding annotation is a v2 rule stated in `spec/v2/`; `COMPATIBILITY.md` §7's v1 sentence is untouched.

## Conformance

Corpus gates: `check-falsifiability.mjs`, `check-gap-contradictions.mjs`, `check-alias-coverage.mjs` (all kinds), `generate-schemas-readme.mjs --check` (this PR); `generate-deprecation-annotations.mjs --check`, `check-removal-dates.mjs`, `check-schema-mirrors.mjs`, the v2 `generate-gaps.mjs` rules (Phase 3).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 every annotation has a row and every row a node | `generate-deprecation-annotations.mjs --check` | the corpus gate | witnessable — unaided (corpus) |
| §A.2 a past removal date with the surface present fails | `check-removal-dates.mjs` | the corpus gate (a fixture row with `removeIn: 1.0`) | witnessable — unaided (corpus) |
| §A.3 every kind has a detector | `check-alias-coverage.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §B.1 v2 rows carry witness + requirementId | `generate-gaps.mjs --check` | the corpus gate | witnessable — unaided (corpus) |
| §B.3 a contradicting gap fails | `check-gap-contradictions.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §C.1 every child's table parses and resolves | `check-falsifiability.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §E.1 README maturity words agree with RFC status | `check-rfc-status-coherence.mjs` — `openwop.requirement.0172.release-identity` | the corpus gate | witnessable — unaided (corpus) |

## Adversarial review

1. **JSON Schema's `deprecated` keyword collides with the pack manifest's `deprecated` wire field.** Disposition: the v2 manifest renames the field `versionDeprecated` (row C11.2, C.10 re-sign); a generator that wrote the annotation onto that property would have changed a wire meaning silently.
2. **Enforcing removal dates at merge on v1 rows would fail today's tree** (every row is `removeIn: 2.0`, corpus major 1) — no; the check compares the row's major to the corpus major and 2 > 1 passes; the first bite is the 2.0 cut, exactly as MAINTAINERS §"Major bump" step 4 already requires.
3. **Requiring `requirementId` on open v2 rows when `conformance/requirements.json` cannot mint v2 ids until C.1 lands.** Disposition: a `planned:<id>` form is accepted until suite 2.0.0 exists; `check-falsifiability.mjs` reports the planned count as a ratchet.
4. **The falsifiability verdict vocabulary in existing tables is free text** ("witnessable — seam-gated", "witnessable — gated on subjects"). Disposition: the parser maps the observed forms onto the RFC 0166 enum and fails only on a token it cannot map; the mapping is data in the script and the RFC 0167-family tables are normalised in this PR.
5. **Classifying 24 gap rows "for real" by one person is the RFC 0166 §C.2 honesty problem again.** Disposition: the rows are the RFC 0167 family's own (0167, 0169, 0172, 0174, 0178), authored today with the witness stated in the falsifiability table; they are the one set a same-day review can classify without heuristics. The ratchet records the number.
6. **`check-gap-contradictions.mjs` cannot know every artifact a gap might name.** Disposition: it resolves the two classes the audit found (scenario files, OpenAPI paths); a gap naming anything else stays un-checked and the script says so in its summary line.

## Alternatives considered

1. Hand-annotate `deprecated: true` in schemas. Rejected: two sources for one fact; the register already exists.
2. Enforce removal dates in v1.x. Rejected: `COMPATIBILITY.md` §7 promises v1 surfaces keep behaving; the gate arms at the major.
3. Keep falsifiability tables as prose and lint them. Rejected: a lint that cannot resolve a row to a gap or a requirement checks spelling, not falsifiability.
4. Do nothing. Rejected: 558/558 unclassified is the measurement.

## Unresolved questions

1. Whether AsyncAPI 3.x carries a standard `deprecated` on channels/messages (it does on operations; messages need `x-` extension). Decided in Phase 3 with the generator; `x-openwop-remove-in` is the portable carrier either way.

## Implementation notes (non-normative)

This PR: `check-falsifiability.mjs` (parser + resolver), `check-gap-contradictions.mjs` (scenario/path resolver), `generate-schemas-readme.mjs`, the alias-coverage kinds, 24 gap rows classified, `redocly.yaml` and `artifact-type-packs.md` corrected, wired into `openwop:check` step 4. Phase 3: annotation generator, removal-date gate, mirrors check, the v2 `gaps.json` rules.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; the four this-PR checks green; 24 rows classified with the ratchet lowered; hygiene corrections; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): `generate-deprecation-annotations.mjs` and `check-removal-dates.mjs` in the gate over `schemas/v2/` and `api/v2/`; every v2 gap row with a witness and a requirement id; the mirrors generated or `$ref`'d; the redocly suppressions re-enabled. — met at the RC: both checks run in `scripts/openwop-check.sh` stage 10 (`check-removal-dates.mjs` reports 44 rows carrying `removeIn` against served major 2, all 44 due and none present in the v2 tree); every one of the 57 v2-era gap rows carries a witness class, none `unclassified`; the mirrors are generated — 93 `schemas/v2/**` files compile with `$id` under `/spec/v2/` and every cross-file `$ref` resolves inside `schemas/v2/` with no reach into v1 (`check-v2-schemas.mjs`); and the `no-required-schema-properties-undefined` suppression is answered rather than lifted — the conditional-requirement idiom it false-positives on is now GENERATED from `spec/v2/declaration.json`, and `scripts/check-required-properties-defined.mjs` is the compensating control in the gate, recorded in `api/v2/redocly.yaml`. deferred: `generate-deprecation-annotations.mjs` walks `schemas/v2/` only, so the `api/v2/` leg is unwritten (reason: no v2 OpenAPI node carries a deprecation row yet — `spec/v1/deprecations.json` names `api/openapi.yaml` and no `api/v2/` source); `requirementId` is still null on all 57 v2 rows (reason: v2 requirement ids are minted by the C.1 suite work; the `planned:<id>` form remains open per Adversarial review 3); 72 of the 93 v2 schemas still carry `x-openwop-seeded-from: v1` awaiting their child RFC's hand edit; and `operation-4xx-response` stays off for the unauthenticated discovery endpoints, as in `api/redocly.yaml` (Phase 4).

## References

- RFC 0167 §A (Axiom 2, 4), §C.11, §D, §E.2, §G.2 "Deprecation"; RFC 0166 §B, §C, §D; RFC 0148 §A/G3 (requirement ids); RFC 0174 §C.2/§E.3; `COMPATIBILITY.md` §7; `spec/v1/deprecations.json`, `deprecations.schema.json`, `gaps.json`, `gaps.schema.json`, `alias-detectors.json`; `scripts/check-deprecations.mjs`, `generate-gaps.mjs`, `check-alias-coverage.mjs`, `generate-cross-repo-evidence.mjs`; `schemas/README.md`; `schemas/conversation-event.schema.json`; `api/redocly.yaml`; `spec/v1/artifact-type-packs.md` §"Bounded compilation".

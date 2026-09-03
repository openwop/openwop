# RFC 0167: OpenWOP v2 — the program RFC

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0167                                                            |
| **Title**         | OpenWOP v2 — the umbrella ("program") RFC for the second major: six axioms, an eleven-child breaking-change program (C.1–C.11), every version axis and alias in the corpus enumerated with a disposition, a migration register as data, codemods with negative controls, the per-consumer migration plan, and the cut gates |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived**: the RFC 0001 §4 30-day breaking-change window is waived under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers"; the RFC 0001 §5 cross-organization approval rule is **not yet active** (one maintainer, one organization) and that note is carried here as §5 requires; **RFC 0147 §A.6** (a high-risk RFC touching identity, authorization, isolation, idempotency, replay, external effects, or certification MUST complete the full window) is **overridden and named**, as RFCs 0159/0163/0164/0165 did — this RFC touches all seven. Evidence gates are not waived: this RFC reaches `Accepted` only at the v2.0 cut (§G), and each child reaches `Accepted` only on a witnessed bundle. The umbrella is the first RFC tested by its own §C.7 rule that waiver authority is checked at merge.) · 2026-09-03 (filed)  · 2026-09-03 (**Phase 2 exit, §G.1:** all eleven children `Active` — 0168, 0169, 0170, 0171, 0172, 0173, 0174, 0175, 0176, 0177, 0178; `check-codemods --at-active`, `check-alias-coverage` and `check-migrations` green on the merged tree; 10 codemods with negative controls; 44 deprecation rows; 110 migration rows)|
| **Affects**       | `RFCS/0001-rfc-process.md` (§3: program RFCs and children) · NEW `spec/v1/migrations.json` + `migrations.schema.json` (the v1→v2 migration register) · NEW `spec/v1/alias-detectors.json` · `spec/v1/deprecations.json` (11 rows: `since`, the `X-` request-header family, `replay.fork`, debug-bundle `seq`, `credentialProvider`, `publicKeyRef`, the legacy interrupt payloads, `a2a-0.3-legacy`, `mcp-2025-06-18-legacy`, the SDK-only signature header, the RFC 0144 extension-class families) · NEW `codemods/` (harness + `openwop.codemod.capabilities-wrapper-removal`) · NEW `scripts/check-migrations.mjs`, `scripts/check-alias-coverage.mjs`, `scripts/check-codemods.mjs` (wired into `openwop:check` step 4) · editorial: `schemas/capabilities.schema.json` + `spec/v1/capabilities.md` (pre-rebrand `wop-agents-*` example strings), `schemas/debug-bundle.schema.json` (`bundleVersion` pattern admitted no documented value) · children RFC 0168–0178 (filed separately, §C) |
| **Compatibility** | `breaking` per `COMPATIBILITY.md` §5 — this RFC *is* the v2 plan §5 requires (migration plan §D, coexistence plan §B.5/§C.5/§C.9, deprecation timeline §E, `@openwop/openwop-conformance@2.0.0` §C.1). **Nothing in this PR changes v1.x wire shape**: the register, detectors, codemods and checks are data and scripts outside `schemas/` and `api/`; the two editorial corrections widen what is accepted (a Class-3 correction under the §3 precedent list) and fix example text. The eleven children land the breaking changes under `spec/v2/` and `schemas/v2/` in Phase 3; none lands in v1.x |
| **Supersedes**    | — (amends RFC 0001 §3; the v1 corpus is not superseded until the Phase 5 retirement, and then by the v2 tree, not by this RFC) |
| **Superseded by** | —                                                               |

> **Part of: RFC 0167 (this RFC is the parent).** Children are numbered RFC 0168 (C.1) through RFC 0178 (C.11) and each carries `Part of: RFC 0167 — child Cn` in its `Affects` row.

## Summary

v1 is a protocol whose defect record is written in its own registers: 545 gaps, 312 open risks, ~30 aliases with no removal date, eight-to-eighteen version axes with three different grammars, an event enum that a typo satisfies, a certification bundle nothing signs, and a capability root that any key extends. Phase 0 and Phase 1 of the v2 charter landed the additive preparation in v1.x (RFCs 0165 and 0166; suites 1.152–1.159). This RFC is the program: it fixes the six axioms, names the eleven children that each own one breaking surface, enumerates every version axis and every alias found in the tree with a disposition, defines the migration register and the codemod contract that turn each rename into a mechanical rewrite, states the per-consumer migration plan for the nine repositories we own, and sets the machine-true gates the v2.0 tag is cut on. Windows are waived under sole-steward operation; evidence is not.

## Motivation

`COMPATIBILITY.md` §5 says a v2 RFC MUST include a migration plan, a coexistence plan, a deprecation timeline, and a 2.0.0 suite. Nothing in the corpus was that RFC. The charter (an audited plan artifact, 2026-09-02, cited by RFC 0165 §References) is a plan, not a change set; RFC 0165 and 0166 were its preparation. Without an umbrella, eleven separate breaking RFCs would each re-derive the axioms, disagree on the vocabulary of a version axis or an alias, and have no shared predicate for "the cut is real". The umbrella exists so that every child answers to one enumeration, one register, one codemod contract, and one set of gates — and so that the waiver that makes sole-steward v2 work possible is written once, in the open, and checked by the tool it introduces.

## §A. Axioms

The six axioms are the tie-break for every child decision. A child that contradicts one says so and records why in its register.

1. **A MUST without a witness class is not a requirement.** Every normative statement in `spec/v2/core/` carries a requirement id and a witness class other than `unwitnessable`; an `ext/` MUST declares its class in the document header.
2. **One name per thing; every alias has a removal date.** No wrapper, no mirror, no dotted twin, no "legacy spelling retained". Every alias lives in `spec/v1/deprecations.json` with `removeIn` and a codemod id before the surface that replaces it is normative.
3. **Closed by default.** Discovery root, event envelope, payload registry, error registry, bundle, and `configurable` are `additionalProperties: false`; vendor extension is a positive pattern in one namespace, never an open root.
4. **Registers are data.** Gaps, risks, deprecations, migrations, witness classes, and dispositions are files with schemas and gates; prose tables are checked against them, never the reverse.
5. **Security defaults are obligations of the surface.** A behavior that protects a tenant binds when the surface is advertised, not when a flag is set; relaxation is an operator concern with a declared durability class, never a discovery field.
6. **Nothing persisted under v1 is orphaned.** Every artifact a v1 host persisted — event logs, run rows, bundles, resume tokens, signed manifests — has a stated disposition (`unchanged | translated | drained | legacy-stamped | never-upgraded`) in the migration register before the surface that produced it is removed.

## §B. What v2 is, in one page

- **B.1 Versioning.** `protocolVersions[]` (RFC 0165 §A) is the negotiation input; a v2 host advertises `["1.<n>", "2.0"]` through the overlap and a new root `preferredVersion`. v1 keeps its `/v1/…` path keys unchanged; v2 operations are unversioned path keys on a bare origin; `OpenWOP-Version: 2` selects a major on an unversioned path and defaults, when absent, to `preferredVersion`. No `/v2/` path space (C.5).
- **B.2 Discovery.** One closed root generated from one declaration file; every family is `{status, since, until?, witness, …facets}`; profiles are derived predicates; `contractProvenance`, `Capabilities-Etag`, the wrapper, and the dotted mirror are gone (C.2).
- **B.3 Identity.** The RFC 0165 Subject is required, `owner.principal` is removed, the legacy subject rule is normative, `SubjectLink` has a schema, every lane binds an issuer and a revocation rule, ids and handles have grammars, resume tokens carry a scheme prefix (C.3).
- **B.4 Envelope.** `oneOf` on a closed event `type` with one naming rule generated from `spec/v1/event-codemap.json`; a closed payload registry; `errors.json` as the one error registry; `OpenWOP-*` for every non-standard header; a closed `configurable` (C.4).
- **B.5 Coexistence.** Dual advertisement, dual header emission, dual cache validators through the overlap; a v2 receiver accepts a v1-signed webhook; a v2 host reads v1 event logs through the declared codemap adapter with sequence space preserved and forks a v1-written run (C.9).
- **B.6 Evidence.** Requirement ids in source, per-assertion ledger rows, bundle v3 closed and signed, seams as a versioned profile outside the canonical OpenAPI, the tarball carries only the suite (C.1).
- **B.7 Governance.** Terminal states used, registers typed, the Accepted predicate machine-checked, waiver authority checked at merge, the core under a 25,000-word budget with the tail in `ext/` (C.7).

## §C. The children

One RFC per charter item. Each child MUST carry: (a) `Part of: RFC 0167 — child Cn` in `Affects`; (b) a `## Migration table` section whose rows are exactly the `spec/v1/migrations.json` rows for that child (`scripts/check-migrations.mjs`); (c) a `## Persisted-data disposition` section with one row per store the child touches; (d) a falsifiability table whose rows resolve to `spec/v1/gaps.json` ids or requirement ids; (e) a `## Adversarial review` section recording the `/architect` pass that stands in for the external review that does not exist, with each finding's disposition; (f) the waiver literal and a ledger row.

| Child | RFC | Owns | Depends on | Lands in |
| --- | --- | --- | --- | --- |
| C.1 Evidence and conformance | 0168 | requirement ids in source; witness class required; seams as `openwop-conformance-seams-v2`; corpus-coherence out of host bundles; suite 2.0.0 packaging; bundle v3 closed and signed | C.4 (error shape for bundle `detail`) | PR F |
| C.2 Discovery and capabilities | 0169 | one capability record type; closed root; one declaration file replacing `extensions.json`, `core-standard-manifest.json`, `operation-path-manifest.json`, `capability-declaration-classes.json`; derived profiles; the two-axis maturity; `externally-gated` disposition | — | PR B |
| C.3 Identity | 0170 | Subject required; legacy subject; actor chain and proof; issuer binding and revocation per lane; `SubjectLink` schema; id and handle grammars; token agility; the lane vocabulary gap (RFC 0165 G6) | RFC 0165 (Accepted) | PR C |
| C.4 Wire envelope | 0171 | closed event enum from the codemap (18 review rows decided); closed payload registry; `errors.json`; header scheme; closed `configurable`; the poll cursor (RFC 0165 G7); closed-enum growth rule | C.2 (declaration file) | PR C |
| C.5 Versioning and release | 0172 | every axis in §E.1 retired or first-class; `preferredVersion`; `OpenWOP-Version`; bare origin; retraction of `rest-endpoints.md` §13–14, `grpc-transport.md` §49–50, AsyncAPI `pathname: /v1`; `schemas/v2/` and `/spec/v2/`; one release identity | — | PR B |
| C.6 Security defaults | 0173 | every opt-in security behavior becomes an obligation of its surface; sandbox isolation; effect-seam manifest for replay suppression; compensation trichotomy; Layer-2 effect identity decided; the interop threat model | C.3, C.4 | PR D |
| C.7 Governance | 0174 | terminal states used; Accepted as a machine predicate; waiver authority checked at merge; RFC 0158 ladder as the maturity template; extension budget repealed for witness classes; the front door under budget; gap tables retired into `gaps.json` | RFC 0166 (Accepted); §F of this RFC | PR B′ |
| C.8 Transports and embedded protocols | 0175 | gRPC demoted to `ext/` or generated; A2A 0.3 and MCP 2025-06-18 legacy profiles removed; authenticated negotiation with a minimum-version policy; MRTR ceiling; RFC 0100 UQ4 | C.5 | PR D |
| C.9 Persisted data and coexistence | 0176 | event-log translation contract from the codemap; v1-pinned run disposition; the well-known dual publication; per-store disposition for openwop-app and MyndHyve; corpus-tag pin | C.3, C.4 | PR E |
| C.10 Registry, packs, extension tail | 0177 | absent `engines` ceiling reads `<2.0.0`; `registry/v2/` or a signed overlay; peer-dependency alias table from the declaration file; the registry's own prefix; pack schema hatch rule; chain/form/content pack decisions | C.2, C.5 | PR E |
| C.11 Assurance registers and deprecation machinery | 0178 | `deprecations.json` normative with removal dates enforced at merge; `deprecated: true` and `x-openwop-remove-in` generated onto schema and API nodes; `gaps.json` witness classes; schema and API hygiene | — | PR B′ |

Children flip `Active` independently, in the order above (B and B′ in parallel). This RFC's Phase 2 exit (§G.1) is every child `Active` plus the two machinery gates green; this RFC flips `Accepted` at the Phase 3 cut (§G.2), when every child is `Accepted`.

## §D. The migration register and the codemod contract

**§D.1 Register.** `spec/v1/migrations.json` (schema `migrations.schema.json`) has one row per surface v2 changes: `{id: openwop.migration.<child>.<n>, child, kind, v1, v2, codemod, persistedData, requirementIds, gapIds, deprecationId}`. `kind ∈ {rename, remove, require, retype, unify, delete-alias, behavior, add}`; `persistedData` is the Axiom 6 disposition. A `rename`, `remove`, or `delete-alias` row MUST name a `deprecationId`. The register is seeded with 27 rows in this PR; children add rows, never prose-only tables. `scripts/check-migrations.mjs` validates the schema, the references, and the agreement between each child's `## Migration table` and the register.

**§D.2 Codemods.** A codemod is a pure transform over a persisted or emitted artifact — a discovery document, an event log, a bundle, a pack manifest, a workflow definition — never a source-code AST rewrite (SDK consumers take SDK 2 types and the migration guide). It lives at `codemods/<id>/` with `transform.mjs` exporting `{ id, transform }`, a `README.md`, and fixtures. Its id is `openwop.codemod.<slug>` and is referenced from `deprecations.json` and `migrations.json`.

**§D.3 Negative control.** `scripts/check-codemods.mjs` is the only runner. For every codemod it asserts four things and does one to itself: the positive fixture transforms to the expected output; the negative-control fixture is returned unchanged; a refused fixture, when present, throws (a codemod refuses rather than guesses which of two shapes is the truth); the transform is idempotent; and the runner corrupts the expected output in memory and asserts its own comparator fails — a comparator that cannot see a difference is not a witness (`docs/EVIDENCE-DISCIPLINE.md` §6). With `--at-active`, every `rename | remove | retype | unify | delete-alias` row of an `Active` child MUST have a codemod; that is the umbrella's §G.1 predicate. The first codemod, `openwop.codemod.capabilities-wrapper-removal`, lands with this RFC as the proof of the contract.

**§D.4 Not codemod-able.** A `behavior` row has no codemod; its witness is the child's conformance scenario. A `require` row's migration is the legacy-stamp rule (C.3 §B.3 of RFC 0165), not a rewrite.

## §E. Enumerations

**§E.1 Version axes (18).** Every axis found in the tree, with the disposition each child must honor. `unify` = one type and grammar; `first-class` = keeps its own schema-enforced grammar and negotiation rule; `retire` = absorbed into `{status, since, until?}`; `delete` = removed with a register row.

| # | Axis | Where | Today | Disposition (child) |
| --- | --- | --- | --- | --- |
| 1 | `protocolVersion` | `capabilities.schema.json` root, required | string `MAJOR.MINOR` (RFC 0149 §C) | first-class; negotiation input beside #2 (C.5) |
| 2 | `protocolVersions[]` + new `preferredVersion` | root (RFC 0165 §A) | string[], same grammar | first-class (C.5) |
| 3 | `engineVersion` | root integer; string on `run-event`, `run-snapshot`, three payload `$defs` | **split** (`version-negotiation.md` §"engineVersion axis is split") | unify (C.5); register `engine-version-type-split` |
| 4 | `eventLogSchemaVersion` | root + snapshot, integer, current value 2 | per-run | first-class; the C.9 reader rule keys on it |
| 5 | per-event `schemaVersion` | `run-event.schema.json` + six other schemas | integer, reader-tolerant | first-class; growth rule in C.4 §0 |
| 6 | `schemaVersions` map | root, required | envelope type → integer | first-class; RFC 0021 UQ1 upgrade path decided in C.4 |
| 7 | `version.pinned` | `version-negotiation.md` §Temporal-style pinning | per-`(run, changeId)` | first-class; the v1-pinned-run disposition is C.9 |
| 8 | `contractProvenance` | root, advisory | `{suiteVersion, corpusCommit}` | delete (C.2); register `contract-provenance` |
| 9 | `minimumSuiteVersion` | `extensions.json` records | derived | retire into the declaration file (C.2) |
| 10 | `bundleVersion` | certification v1 `"1"`, v2 `"2"`, export `"1"`, debug (pattern) | four declarations | unify to one `const` family; bundle v3 (C.1); debug pattern corrected here |
| 11 | A2A `protocolVersions[]` / `preferredVersion` | `capabilities.schema.json` a2a | `^[0-9]+\.[0-9]+$` | first-class (C.8); legacy profile deleted |
| 12 | MCP `protocolVersions[]` / `preferredVersion` | mcp | date form | first-class (C.8); legacy profile deleted |
| 13 | `multiAgent.executionModel.version` | capabilities | integer with a schema `maximum` | first-class (C.4 reads the ceiling from the schema) |
| 14 | OpenAPI / AsyncAPI `info.version` | `api/*.yaml:5` | hand-maintained `1.1.0` | generated; PROTOCOL-STATUS rows (C.5) |
| 15 | `minClientVersion` | root | advisory pin | first-class MUST (C.9, V3) |
| 16 | channel `schemaVersion` / `compatibleWith` | `channel-written-payload.schema.json` | per-channel | first-class (C.4) |
| 17 | webhook signature scheme | `webhooks.md` §"per-subscription scheme version" | prose axis | retire into `deprecations.json` (C.4) |
| 18 | pack `engines.openwop` ranges + `registryVersion` | manifests; `.well-known/openwop-registry.json` | semver ranges; `"1.0.0"` | first-class with the absent-ceiling rule (C.10) |

**§E.2 Aliases.** The inventory is `spec/v1/alias-detectors.json` (28 detectors, reviewed not derived) and the register is `spec/v1/deprecations.json` (26 rows after this PR: 20 `deprecated`, 6 `proposed`). `scripts/check-alias-coverage.mjs` fails when a detector's token is present with no row, when a token has left the corpus (stale detector), or when a visible-kind row has no detector. The eleven rows this PR adds: `poll-cursor-since`, `custom-request-headers-x-family`, `replay-fork-boolean`, `debug-bundle-seq`, `credential-provider-key`, `manifest-public-key-ref`, `legacy-interrupt-payloads`, `a2a-0-3-legacy-profile` (sunset 2027-03-12), `mcp-2025-06-18-legacy-profile` (sunset 2027-08-12), `sdk-webhook-signature-header`, `undeclared-host-extension-families`. Two findings were editorial, not aliases, and are fixed here: the pre-rebrand `wop-agents-*` example strings, and the debug-bundle `bundleVersion` pattern that rejected its own documented value.

**§E.3 Legacy dates.** A2A 1.0.0 published 2026-03-12, legacy window ends 2027-03-12; MCP 2026-07-28 accepted 2026-08-12, legacy window ends 2027-08-12 (`a2a-integration.md` §Discovery, `mcp-integration.md` §Discovery). Both adopter inventories (RFC 0152 G1, RFC 0153 G1) are open; C.8 closes them or records that no inventory is obtainable.

## §F. Per-consumer migration plan

The nine repositories we own, what each must do, and which phase does it. This table is the `CONTRIBUTING.md` cross-cut entry for the impl plan.

| Consumer | Coupling to v1 | Phase | Deliverable |
| --- | --- | --- | --- |
| openwop (corpus) | flat `schemas/` with v1 `$id`s; tarball; nine-step gate | 3 | `spec/v2/`, `schemas/v2/`, suite 2.0.0, the gates in §G.2 |
| openwop-app (tier-1) | SQLite + Postgres event logs; `metadata.owner` stamps; wrapper + mirror emitted from one function; ADR 0538 headers; vendored schemas pinned by tag | 4 | event codemap applied; wrapper/mirror removed on their register dates; dual-stack advertised; bundle v3; DEPLOY.md procedures; matrix row |
| MyndHyve (tier-2) | Firestore `runs/{id}/events` with two `EVENT_LOG_SCHEMA_VERSION` constants; in-repo engine fork; ~40 vendor packs; `openwop-core` alias in live profiles | 4 | constants unified before the codemap runs; fork to SDK 2 types or its own axis; packs re-published; bundle v3; matrix row |
| openwop-sdks | TS 1.9.0 / Py 1.7.0 / Go v1.6.0; operation-path manifest consumer | 3 | `@openwop/openwop@2.0.0`, `openwop-client==2.0.0`, Go `/v2`; v2 path manifest |
| openwop-examples | four hosts, nine clients, pins from `^1.20` to `^1.73` | 3 | the four hosts pass the 2.0.0 floor from the front door |
| openwop-registry | 282 signed manifests; `/v1` prefix; 13 manifest schemas | 3 | `registry/v2/` or a signed overlay; absent-ceiling rule |
| openwop-site | copies `schemas/` to `public/spec/v1/` | 3 | iterate `spec/v*`; `/spec/latest` repoint |
| openwop-cli | SDK 1 consumer | 3 | rewrite onto SDK 2, or frozen v1-only — recorded, not implied |
| openwop-paper | cites v1 numbers | 5 | v2 revision |

## §G. Gates

**§G.1 Phase 2 exit (this RFC stays `Active`).** Every child RFC `Active`; `scripts/check-codemods.mjs --at-active` green (every codemod-able row of an Active child has a codemod with a passing negative control); `scripts/check-alias-coverage.mjs` green; `scripts/check-migrations.mjs` green with every child table agreeing.

**§G.2 The cut (this RFC flips `Accepted`).** The charter's §F predicates, each machine-true on the release candidate: identity (every human-surface version generated with `--check`; tarball digest equals the tree's; PROTOCOL-STATUS lists all 18 axes), witness (every core MUST has a requirement id, a witness class, and a ledger row from a host bundle), registers (every gap, invariant, and register row carries a disposition; no protocol-tier invariant `unwitnessable`), closure (root, bundle v3, payload and error registries, `configurable` closed), coexistence (dual-stack, fork-a-v1-run, v1-signed webhook accepted, manifest without a ceiling refused), deprecation (every alias has a removal version; none past due with the surface present), paths (OpenAPI, AsyncAPI, proto resolve identical absolute paths; no seam in the canonical OpenAPI), codemods (every rename in C.2/C.4/C.5/C.10 has a codemod with a negative control), front door (`spec/v2/core/` under 25,000 words; an example host passes the 2.0.0 floor from it), waiver (this RFC's ledger row passes `check-waiver-ledger.mjs`).

## Compatibility

`breaking`, by definition of §5 — and nothing in this PR breaks v1.x. Classified against `COMPATIBILITY.md` §2.2: no required field changes, no optional field type changes, no event shape changes, no endpoint contract changes, no MUST relaxed, no error code changes. The register files are outside `schemas/` and `api/`. The debug-bundle pattern widening accepts `"1"` where the schema's own description already prescribed it (a Class-3 correction). The `wop-agents-*` edits touch a description string and an example. v2 changes land under `spec/v2/` and `schemas/v2/` in Phase 3; the v1 tree is read-only from the cut and served through the Phase 5 retirement under the host-inventory rule (`COMPATIBILITY.md` §5, restated normatively by C.7).

## Conformance

No new v1.x scenario: this RFC adds no v1 wire surface. Its witnesses are the three corpus gates (§D, §E.2) and, transitively, every child's. The v2 scenarios (dual-stack, fork-a-v1-run, v1-signed-webhook-accepted, manifest-ceiling-refused) are C.9/C.4/C.10 deliverables and enter suite 2.0.0.

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §C (a)–(f) every child carries the six parts | `check-migrations.mjs` (b), `check-waiver-ledger.mjs` (f), the child's own register (c–e) | the corpus gate, unaided | witnessable — unaided (corpus) |
| §D.1 a rename/remove/delete-alias row names a deprecationId | `check-migrations.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §D.3 a codemod passes the four legs; the runner sabotages itself | `check-codemods.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §D.3 every codemod-able row of an Active child has a codemod | `check-codemods.mjs --at-active` at §G.1 | the corpus gate | witnessable — unaided (corpus) |
| §E.2 every alias has a register row | `check-alias-coverage.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §G.2 the cut predicates | the Phase 3 release gate | the steward at the cut | witnessable — gated on the release candidate |

## Alternatives considered

1. **One 60,000-word RFC.** Rejected: no per-item witness, no per-item Active flip, one architect pass over eleven surfaces, and a single register with 300 rows nobody reads.
2. **Eleven independent RFCs, no umbrella.** Rejected: each re-derives the axioms and the axis and alias vocabularies drift; there is no one place a consumer's migration is stated; there is no §G.1.
3. **Path-versioned v2 (`/v2/…`).** Rejected in C.5: three normative texts already presume it and all three are wrong about the `/v1/v1` failure RFC 0149 fixed; a bare origin with header negotiation keeps one path manifest per major.
4. **Do nothing** — keep patching v1.x. Rejected: the §2.2 list makes every one of the eleven surfaces unfixable in v1.x, and the register record shows the aliases growing, not shrinking.

## Unresolved questions

1. The org question: whether `openwop.dev/spec/v2/` is served by the same organization and site generator (charter §H) — decided in C.5 with a fallback to the current org.
2. Whether the umbrella's `Accepted` predicate should additionally require a third-party host at the cut. Under sole-steward operation the answer is no (the host-inventory rule); recorded here so the retrospective (RFC 0156) can revisit it.

## Implementation notes (non-normative)

Phase 2 sequencing: PR A (this RFC + machinery) → PR B (C.2, C.5) ∥ PR B′ (C.7, C.11) → PR C (C.3, C.4) → PR D (C.6, C.8) → PR E (C.9, C.10) → PR F (C.1) → §G.1. Each child PR runs `/architect` before filing and records the pass. The openwop-app and MyndHyve legs are Phase 4 and are named in §F, not scheduled here. v2 MUST-NOTs do not enter `SECURITY/invariants.yaml` until Phase 3, when their tests exist; until then they are child falsifiability rows in `gaps.json`.

## Acceptance criteria

- [x] `Draft → Active`: RFC text, the RFC 0001 §3 amendment, `migrations.json` + schema (27 rows), `alias-detectors.json` (28), 11 deprecation rows, the codemod harness with one codemod, the three checks wired into `openwop:check`, the two editorial corrections, waiver ledger row, CHANGELOG. (This PR.)
- [ ] §G.1 — every child `Active`; `check-codemods.mjs --at-active`, `check-alias-coverage.mjs`, `check-migrations.mjs` green. (Phase 2 exit; recorded in `Updated`.)
- [ ] `Active → Accepted` — §G.2 on the v2.0 release candidate; every child `Accepted`. (Phase 3 cut.)

## Migration table

This RFC owns no register rows of its own; the rows are the children's (`spec/v1/migrations.json`, 27 seeded here across C.1, C.2, C.3, C.4, C.5, C.8, C.9, C.10). The one codemod landed here, `openwop.codemod.capabilities-wrapper-removal`, is bound to `openwop.migration.C2.1`.

## References

- The v2 charter (audited plan artifact, 2026-09-02) — program items C.1–C.11, §E sequencing, §F gates, §G audit ledger.
- `COMPATIBILITY.md` §2.2, §3, §5 (host-inventory rule), §7 (deprecation register); `GOVERNANCE.md` §"Sole-steward operation"; RFC 0001 §3–§5; RFC 0147 §A.6, §A.10.
- RFC 0165 (v2 preparation wire shapes; G6, G7), RFC 0166 (registers, witness classes), RFC 0073 (wrapper), RFC 0144 (declaration classes), RFC 0148/0149/0150 (evidence, paths, effect identity), RFC 0152/0153 (A2A/MCP), RFC 0154 (workload identity), RFC 0155 (extension registry), RFC 0156 (assurance), RFC 0158 (durability ladder), RFC 0164 (leaver contract).
- `spec/v1/version-negotiation.md`, `capabilities.md`, `webhooks.md`, `replay.md`, `storage-adapters.md`, `event-codemap.json`, `deprecations.json`, `gaps.json`; `docs/EVIDENCE-DISCIPLINE.md` §6; `MAINTAINERS.md` §"Major bump to v2.x".

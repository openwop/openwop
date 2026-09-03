# RFC 0169: v2 discovery and capabilities — one record type, a closed root, one declaration file, derived profiles

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0169                                                            |
| **Title**         | v2 discovery and capabilities: every family is one record type `{status, since, until?, witness, …facets}`; the discovery root is closed; the four unschema'd registries collapse into one declaration file that generates the schema, the pack peer-dependency identifiers, and the spec anchors; profiles are derived predicates in one generated registry with a two-axis maturity and an `externally-gated` disposition; the wrapper, the dotted mirror, `contractProvenance`, `Capabilities-Etag`, `auth.subjectLinking`, the bare `supported: true` in A2A/MCP, `replay.fork`, and the `openwop-core` alias are removed |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167. Adversarial review recorded in §"Adversarial review".) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C2.** v2: NEW `spec/v2/core/capabilities.md`, NEW `spec/v2/declaration.json` (+ schema) generating `schemas/v2/capabilities.schema.json`, `schemas/v2/profiles.json`, the pack peer-dependency alias table; retires `spec/v1/extensions.json`, `core-standard-manifest.json`, `operation-path-manifest.json` (the operations half moves to C.5), `capability-declaration-classes.json`. v1.x (this PR, data only): `spec/v1/migrations.json` rows `openwop.migration.C2.1`–`C2.10`; codemods `openwop.codemod.capabilities-wrapper-removal` (landed with 0167) and NEW `openwop.codemod.discovery-document-v2`; register rows |
| **Compatibility** | `breaking` (v2). Nothing in v1.x changes in this PR: the codemod and the register rows are data; the v2 declaration file and schema land in Phase 3 under `spec/v2/` and `schemas/v2/` |
| **Supersedes**    | — (RFC 0073, 0144, 0155 §A/§C remain the v1 authorities; the v2 tree supersedes them at the cut) |
| **Superseded by** | —                                                               |

## Summary

v1 discovery has 91 root properties on an open root, 103 `supported` declarations in four shapes (one of them a `string[]`), `tier`/`experimentalUntil` promised on every family but schema-legal on one, a `host.workspace` slot that is both forbidden and shipped, four machine registries with no schema of their own, a closed profile catalog of 13 beside three annex profiles and a root `profiles[]` that no schema declares and a production host emits. v2 replaces all of it with one capability record type on a closed root, generated from one declaration file that is also the source of pack peer-dependency identifiers and spec section anchors; profiles become derived predicates in one generated registry with technical and adoption maturity as separate axes and a third disposition, `externally-gated`, for surfaces held on neither ground.

## Motivation

- **One name is four shapes.** `supported` is a required boolean in 61 families, optional in 35, `const: true` in 6, and the provider-id list in `aiProviders.supported` (`capabilities.schema.json:1291`). Absence-of-family and `supported: false` encode one fact two ways in 61 places.
- **The root is open, so a typo is an extension.** `additionalProperties: true` at `capabilities.schema.json:4123` plus 15 nested open objects; RFC 0144 kept the root open deliberately so `host.forms` mirrors stayed valid. `contractProvenance` is an advisory self-declaration the wire cannot falsify (`capabilities.schema.json:26–42`).
- **Prose and schema disagree on where `tier` may go.** `capabilities.md:875` says every family MAY carry `tier`/`experimentalUntil`; the schema declares them only under `multiAgent.executionModel` (`:1024–1051`); every other family is `additionalProperties: false`, so the promised field is schema-invalid there.
- **`host.workspace` is MUST NOT advertise (`host-capabilities.md:2186`) and the gate for an Accepted, schema-declared surface (`agent-workspace.md:27`, RFC 0059).** `agent-manifest.schema.json:58` uses it as the example peer dependency; `host-capabilities.md:2188` makes that example rejectable.
- **Profiles have two vocabularies and a wire field the spec rejected.** `profiles.md:362–370` explains why `profiles[]` is not a wire field; `INTEROP-MATRIX.md:15` records MyndHyve's live root `profiles[]` carrying `openwop-agent-platform` full, which the same row measures as not certifiable. The 13-profile catalog sits beside 3 annex profiles, an alias, `auth.profiles`, `a2a.profiles`, `mcp.profiles`. All 73 extension records are `draft` because `stable` requires a tier-3 host that cannot exist under sole-steward operation.
- **Four registries, no schema.** `extensions.json`, `core-standard-manifest.json`, `operation-path-manifest.json`, `capability-declaration-classes.json` ("REVIEWED, not derived") are each generated or reviewed by a different script and validated by none.

## Proposal

### §A. One capability record type

**§A.1** Every family at the v2 discovery root is an object of the shape

```json
{ "status": "stable" | "experimental" | "deprecated",
  "since": "<major>.<minor>",
  "until": "<major>.<minor>" | "<YYYY-MM-DD>",
  "witness": "witnessable-unaided" | "witnessable-gated" | "seam-gated" | "claims-check" | "negative-existence",
  ...facets }
```

`status`, `since`, and `witness` are REQUIRED; `until` is REQUIRED when `status` is `experimental` or `deprecated` and MUST NOT be present when `status` is `stable`. `unwitnessable` is not a legal value on a wire record: a family that cannot be witnessed lives in `spec/v2/ext/` and is not advertised (RFC 0167 Axiom 1).

**§A.1a** Fifteen root keys are **metadata, not families** (`extensions.json` `coverage.metadataFields`: `compliance`, `configurable`, `conformance`, `discovery`, `engineVersion`, `eventLogSchemaVersion`, `extensions`, `fixtures`, `implementation`, `minClientVersion`, `observability`, `protocolVersions`, `runtimeCapabilities`, `supportedTransports`, `testing`) plus `protocolVersion` and the new `preferredVersion` (C.5). The declaration file declares each as metadata with its own schema; they are not capability records and carry no `status`/`witness`. Every other root key is a family record or is rejected.

**§A.2** There is no `supported` field. Presence of the family record is the claim; a host that does not support a family omits it. A family whose v1 shape was `supported: <string[]>` (`aiProviders`) carries that list under a named facet (`providers`).

**§A.3** `until` absorbs `tier`/`experimentalUntil`. An `until` in the past on an advertised family is non-conformant (`validation_error`, `details.reason: "until_in_past"`), exactly today's sunset rule (`capabilities.md:886`), now schema-enforced on every family.

**§A.4** The root is `additionalProperties: false`. Vendor and host extensions live under one key, `extensions`, whose members MUST match `^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$` (`<org>.<name>`); the reserved orgs are `openwop` (MUST NOT be used by a host) and `vendor` (the v1 escape hatch, retired). No dotted key, no wrapper, no mirror.

**§A.5** `contractProvenance`, `Capabilities-Etag`, `auth.subjectLinking`, `replay.fork`, the bare A2A/MCP `supported`, and the `openwop-core` alias are absent from the v2 root; `spec/v1/migrations.json` rows `C2.1`–`C2.10` carry each with its codemod.

### §B. One declaration file

**§B.1** `spec/v2/declaration.json` (schema `declaration.schema.json`, `$id` under `/spec/v2/`) is the single source for: the capability schema (`schemas/v2/capabilities.schema.json` is generated), the family list and each family's `witness` class and maturity, the pack peer-dependency identifier (identical to the root key), the spec section anchor (`spec/v2/core/capabilities.md#<key>` or `spec/v2/ext/<key>/`), the floor scenarios and requirement ids that define `openwop-core-standard`, and the profile predicates (§C). `extensions.json`, `core-standard-manifest.json`, and `capability-declaration-classes.json` are retired; the operations half of `operation-path-manifest.json` becomes C.5's path manifest.

**§B.2** The declaration file is generated **from** nothing and checked **against** everything: `scripts/check-declaration.mjs` fails when a root key in the generated schema, a `§` heading in `spec/v2/core/capabilities.md`, or a peer-dependency identifier in a pack manifest names a family the declaration does not.

**§B.3** Reserved slots are unrepresentable under a closed root. `host.media` and `host.collaboration` (`host-capabilities.md:2184–2185`) are deleted; `host.workspace` is the declared family `workspace` (RFC 0059 is Accepted; the MUST NOT at `:2186` is retracted). The 11 RFC 0144 extension-class families (`brand`, `canvas`, `chat`, `coordination`, `dataIntegration`, `entities`, `kanban`, `knowledge`, `launchStudio`, `messaging`, `webResearch`) move under `extensions.openwop-app.*` for the host that serves them and their prose to `spec/v2/ext/`. `imageGeneration`/`videoGeneration` are declared facets of `aiProviders` or deleted (C.10 decides with RFC 0105).

### §C. Profiles: derived, one registry, two axes, three dispositions

**§C.1** A profile is a predicate over the declaration file, published in `schemas/v2/profiles.json` (generated). No `profiles[]` exists at the v2 root; `auth.profiles`, `a2a.profiles`, `mcp.profiles` become facets (`auth.lanes[]`, `a2a.versions[]`, `mcp.revisions[]`) whose grammars C.3 and C.8 own. A host that emits a root `profiles[]` fails schema validation (§A.4).

**§C.2** Maturity has two axes: `technical` (`experimental | stable | deprecated`, from the record's `status`) and `adoption` (`none | single-witness | multi-witness | independent`, derived from the INTEROP-MATRIX bundle evidence). `stable` no longer requires a tier-3 host; `independent` records whether one exists. The RFC 0155 numeric budget is repealed by RFC 0166 §C.3; a family may exist at any count if it declares its witness class.

**§C.3** The three operational annex profiles (`openwop-core-standard`, `production`, `openwop-agent-platform`) become derived predicates like every other profile, or are documented-not-advertised; `core-standard-manifest.json` is the `openwop-core-standard` predicate inside the declaration file. The claim vocabulary (`profiles.md:324–325`) is restated in `spec/v2/core/` unchanged.

**§C.4** `externally-gated` is a third disposition for a surface held on grounds that are neither technical nor adoption: RFC 0121 (legal citation) and RFC 0035 (non-steward host tripwire). An externally-gated family MAY be declared with `status: experimental` and an `until` equal to the tripwire review date, or omitted; it MUST NOT be `stable`. `capabilities.sandbox` (declared today, RFC 0035 parked) is the first row.

**§C.5** The five Accepted RFCs with zero or single advertisers (0112–0116) are triaged on the adoption axis at the cut: `restTransport` and `a2uiSurface.deltaTransport` (`witness: claims-check`) move to `ext/` unless a behavioral witness lands; `memory.injectionBudget`, `toolCatalog` compact view, and `aiProviders.promptPrefixCache` keep their families with `adoption: single-witness`.

**§C.6** The invariant `profile-claim-floor-not-overstated` (`profiles.md:330`) is registered in `SECURITY/invariants.yaml` at the Phase 3 cut with its test (already exists: `certification-bundle-non-vacuous.test.ts`).

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C2.1` | remove | `capabilities` wrapper | none | `openwop.codemod.capabilities-wrapper-removal` | not-persisted |
| `openwop.migration.C2.2` | delete-alias | `host.<family>` dotted mirrors | none | `openwop.codemod.discovery-document-v2` | not-persisted |
| `openwop.migration.C2.3` | delete-alias | `openwop-core` in `profiles[]` | `openwop-discovery-core` | `openwop.codemod.discovery-document-v2` | never-upgraded |
| `openwop.migration.C2.4` | remove | `contractProvenance` | none | `openwop.codemod.discovery-document-v2` | not-persisted |
| `openwop.migration.C2.5` | remove | `auth.subjectLinking` | none | `openwop.codemod.discovery-document-v2` | not-persisted |
| `openwop.migration.C2.6` | rename | bare `a2a.supported` / `mcp.supported` | `protocolVersions[]` facets | `openwop.codemod.discovery-document-v2` (refuses when no array is present — it cannot invent versions) | not-persisted |
| `openwop.migration.C2.7` | rename | `replay.fork` boolean | `replay.modes[]` | `openwop.codemod.discovery-document-v2` | not-persisted |
| `openwop.migration.C2.8` | rename | the 11 extension-class `host.*` families | `extensions.<org>.<name>` | `openwop.codemod.discovery-document-v2` | not-persisted |
| `openwop.migration.C2.9` | behavior | `Capabilities-Etag` response header | standard `ETag` / `If-None-Match` (RFC 0165 §C.2 dual emission through the overlap) | — (a header is emitted, not persisted; clients read `ETag`) | not-persisted |
| `openwop.migration.C2.10` | add | root `profiles[]` (undeclared, emitted by one host) | none — schema-invalid under the closed root | — | not-persisted |

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| Certification bundles (all hosts) | `claimedProfiles[]` naming `openwop-core` | never-upgraded — valid v1 evidence at its version |
| Pack manifests (openwop-registry, 282 signed) | `peerDependencies` keyed by v1 family names | translated — the peer-dependency alias table generated from the declaration file (C.10 owns the re-publish) |
| Host discovery documents | wrapper, mirrors, dotted keys | not-persisted — the codemods rewrite a captured document; the host emits the v2 shape |

## Compatibility

`breaking` (v2). In v1.x this PR adds register rows and a codemod; no schema, OpenAPI, AsyncAPI, or prose MUST changes. The §2.2 list is untouched. The v2 shape lands under `schemas/v2/` in Phase 3.

## Conformance

v2 scenarios (suite 2.0.0, C.1 packaging): `capabilities-root-closed` (unaided: a document with an unknown root key fails; one with a dotted key fails; one with a wrapper fails), `capability-record-shape` (unaided: every family has `status`/`since`/`witness`; `until` rules), `profiles-derived-only` (unaided: root `profiles[]` fails; the generated registry's predicates reproduce every profile the bundle claims), `declaration-parity` (corpus: schema, prose anchors, and pack peer-dependency identifiers agree with the declaration file), `externally-gated-never-stable` (unaided).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 record shape required fields | discovery document | the suite, unaided | witnessable — unaided |
| §A.1/§A.3 `until` rules | discovery document with `until` in the past | the suite (fixture) / a host | witnessable — unaided |
| §A.2 no `supported` | schema validation | the suite | witnessable — unaided |
| §A.4 closed root, one extension key with a grammar | schema validation of an injected key | the suite | witnessable — unaided |
| §B.2 declaration parity | corpus gate | the corpus gate | witnessable — unaided (corpus) |
| §C.1 no root `profiles[]` | schema validation | the suite | witnessable — unaided |
| §C.2 adoption axis derived from bundles | generated registry vs INTEROP-MATRIX | the corpus gate | witnessable — unaided (corpus) |
| §C.4 externally-gated never `stable` | generated registry | the corpus gate | witnessable — unaided (corpus) |

## Adversarial review

Recorded from the `/architect` pass run before filing (RFC 0167 §C (e)).

1. **`Capabilities-Etag` vs `ETag` semantics differ** (`capabilities-change-detection.md:43`: byte caching vs negotiation safety). Disposition: accepted — v2 discards the distinction; a discovery document's bytes are its negotiation identity, and a host that changes semantics without changing bytes is the RFC 0165 §C.2 case already ruled non-conformant. Row `C2.9` is `behavior`, not a codemod.
2. **The bare-`supported` rename cannot be a pure transform** when no `protocolVersions[]` exists in the source document. Disposition: the codemod refuses (throws) rather than inventing versions; the refusal fixture is committed.
3. **Removing `host.workspace`'s MUST NOT is a v1.x prose change** and must not ride this PR. Disposition: retracted here only in the v2 text (§B.3); the v1 contradiction is filed as a gap (G2) for an editorial correction PR that cites RFC 0059.
4. **Two-axis maturity makes `stable` reachable without an independent host** — is that an honesty regression? Disposition: no; `adoption: independent` is where that fact lives, and the claim vocabulary keeps "OpenWOP conformant" bound to `openwop-core-standard` evidence, not to `stable`.
5. **Fifteen root keys are metadata, not families, and §A.1 as first drafted would have rejected them.** Disposition: §A.1a names them; the declaration file declares them as metadata with their own schemas.
6. **A v1 scenario reads a root `profiles[]`** (`agent-platform-aggregate-evidence.test.ts:37`, the RFC 0085 operational-annex claim). Disposition: the claim rides an undeclared field today; §C.3 gives the annex profiles a home as derived predicates and the adoption axis; the v2 scenario reads the generated registry, never the document. Filed as G5 so the v1 scenario is not orphaned at the cut.
7. **The discovery codemod refused two legitimate v1 shapes** — `a2a.supported: false` with no versions (the family is simply absent in v2) and a dotted-only `host.forms` (a host following `host-capabilities.md:505` emits only the dotted key). Disposition: the transform drops the family on `false` and promotes a dotted-only declared family to its plain key; fixtures cover both.
8. **The declaration file is a fifth registry until the four are deleted.** Disposition: the four are retired in the same Phase 3 PR that lands the generator; `check-declaration.mjs` refuses a tree where both exist.

## Alternatives considered

1. Keep the open root and add a lint. Rejected: a lint cannot see a key it does not know; the 91st key was a typo that validated.
2. Keep `supported` as the record discriminator. Rejected: 61 families already encode the same fact twice; a record's presence is the honest claim.
3. Keep the profile catalog as a hand-maintained closed list. Rejected: the catalog and the derivation library are two answers to one question (`profiles.md:362`), and a production host already emits a third.
4. Do nothing. Rejected: every one of the eight aliases in the migration table is `removeIn: 2.0` in the register already; this RFC is where the removal is specified.

## Unresolved questions

1. Whether `extensions.<org>.<name>` uses the reverse-DNS org form (`com.myndhyve`) or the short form (`myndhyve`). Recommended: short form, registered in the declaration file.
2. Whether `imageGeneration` / `videoGeneration` are declared facets or deleted (RFC 0105 G5). Decided with C.10.

## Implementation notes (non-normative)

Phase 3 lands the declaration file, the generator, and `schemas/v2/capabilities.schema.json`. openwop-app emits the wrapper, the root, and the mirror from one function today and drops two of three on the register date (Phase 4). MyndHyve drops its root `profiles[]` and the `openwop-core` alias in its Phase 4 leg.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; migration rows `C2.1`–`C2.10` in `spec/v1/migrations.json`; codemod `openwop.codemod.discovery-document-v2` with its four legs green; register rows; waiver ledger row; adversarial review recorded. (This PR.)
- [ ] `Active → Accepted` (Phase 3): declaration file + generator + `schemas/v2/capabilities.schema.json` + `profiles.json` landed; the five v2 scenarios in suite 2.0.0; the four v1 registries retired; an example host passes `capabilities-root-closed` from the front door.

## References

- RFC 0167 §A (Axioms 1–3), §C, §D, §E.1 axes 8–9; RFC 0073, 0144, 0155 §A/§C/§D, 0166 §C.3, 0059, 0105 G5, 0112–0116, 0121, 0035.
- `spec/v1/capabilities.md` §"Document-root layout", §"What a capability may vary", §"Sunset rule"; `profiles.md` §"Why this is not a wire field", §"Claim vocabulary"; `host-capabilities.md` §"Reserved-but-undocumented surfaces"; `agent-workspace.md`; `INTEROP-MATRIX.md` MyndHyve row.
- `spec/v1/migrations.json`, `deprecations.json`, `alias-detectors.json`; `codemods/`.

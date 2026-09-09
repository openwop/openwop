# RFC 0172: v2 versioning and release — major negotiation, one origin, every axis dispositioned, one release identity

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0172                                                            |
| **Title**         | v2 versioning and release: protocol-major negotiation by `protocolVersions[]` + root `preferredVersion` + the `OpenWOP-Version` request header on a bare origin with unversioned v2 path keys (no `/v2/` path space); every one of the 18 version axes in RFC 0167 §E.1 retired, unified, or made first-class with a schema-enforced grammar; `schemas/v2/` with `$id` under `/spec/v2/`; one release identity where the corpus tag is the only release event and every human-surface version is generated |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167. Adversarial review recorded below.) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C5.** v2: NEW `spec/v2/core/versioning.md`; `schemas/v2/capabilities.schema.json` root `preferredVersion`; the `OpenWOP-Version` request header; generated `api/v2/openapi.yaml`, `asyncapi.yaml`, proto (if C.8 keeps it) with identical absolute paths; `spec/v2/path-manifest.json`; retraction of `rest-endpoints.md` §Versioning bullets 1–3, `grpc-transport.md` §"One service per protocol major version", AsyncAPI `servers.production.pathname: /v1`; `docs/PROTOCOL-STATUS.md` rows for every axis. v1.x (this PR, data only): `spec/v1/migrations.json` rows `openwop.migration.C5.1`–`C5.9`; NEW codemod `openwop.codemod.engine-version-unify`; register rows |
| **Compatibility** | `breaking` (v2). Nothing in v1.x changes in this PR. A v1.x additive follow-up (root `preferredVersion` as an optional field with `protocolVersions[]` semantics) is filed separately under RFC 0165 §A's grammar so hosts can advertise it before the cut |
| **Supersedes**    | — (RFC 0149 §A/§C remain the v1 authorities)                    |
| **Superseded by** | —                                                               |

## Summary

v1 has one scalar the wire negotiates on, no way to advertise two majors that COMPATIBILITY §5 nonetheless requires, an `engineVersion` that is an integer at the root and a string on five carriers, `bundleVersion` declared four ways (one of them a pattern that rejected its own documented value), and three normative texts presuming a `/v2/` path space that the `/v1/v1` defect (RFC 0149 §A) already showed is the wrong model. v2 negotiates a major with `protocolVersions[]`, a root `preferredVersion`, and an `OpenWOP-Version` request header on a bare origin; v1 keeps its `/v1/` path keys through the overlap and v2 operations are unversioned; every axis RFC 0167 §E.1 enumerates gets a disposition here; `schemas/v2/` lives under `/spec/v2/`; the corpus tag is the only release event and every human-surface version is generated with `--check`.

## Motivation

- `version-negotiation.md:46–55` (RFC 0165 §A) ships `protocolVersions[]` and says "v2 defines the negotiation that acts on it". This is that definition.
- `rest-endpoints.md:12–14` says breaking changes go to `/v2/`, servers may serve both side by side, and servers MUST return `400` for unversioned roots; `grpc-transport.md:49–50` says v2 would introduce `openwop.v2.Engine` alongside; `api/asyncapi.yaml:42` carries `pathname: /v1` on the server — the AsyncAPI mirror of the `servers[].url` bug RFC 0149 §A fixed in OpenAPI and left in place here, and `rest-endpoints.md:15` makes the parity gate *enforce* the asymmetry.
- The `engineVersion` split is recorded at `version-negotiation.md:57–63` "rather than fixed"; `debug-bundle.schema.json:17` declared a `bundleVersion` pattern that rejected `"1"` until RFC 0167 corrected it.
- `docs/PROTOCOL-STATUS.md` §"Artifact Versions" lists two axes; the README banner once advertised three wrong versions on one line (`check-advertised-versions.mjs:18–23`); no `v1.4.0` tag was ever cut; OpenAPI and AsyncAPI `info.version` are hand-maintained and untracked.
- The A2A lane already solved the header-less default once: `a2a-integration.md:349` serves the `preferredVersion` card when no `A2A-Version` header is present. v2 applies the same rule to the protocol itself.

## Proposal

### §A. Major negotiation

**§A.1** A v2 host advertises `protocolVersions[]` (RFC 0165 §A grammar) containing every major.minor it serves and a root `preferredVersion` that MUST be a member of `protocolVersions[]`. During the overlap a host serves `["1.<n>", "2.<m>"]`; after Phase 5 it serves `["2.<m>"]`.

**§A.2** v1 operations keep their `/v1/…` path keys unchanged through the overlap. v2 operations are **unversioned path keys** on a bare origin (`servers[].url = https://{host}`, RFC 0149 §A): `/runs`, `/runs/{runId}`, `/.well-known/openwop`, … There is no `/v2/` path space. `rest-endpoints.md` §Versioning bullets 1–3 are retracted; the MUST that servers return `400` for unversioned roots is inverted: an unversioned path is the v2 surface.

**§A.3** A request on an unversioned path MAY carry `OpenWOP-Version: <major>` (integer major only; `OpenWOP-Version: 2`). A host MUST serve the named major when it is in `protocolVersions[]` and MUST answer `406 Not Acceptable` with error code `protocol_version_unsupported` and a `details.protocolVersions[]` echo when it is not. When the header is absent, a host MUST serve `preferredVersion`'s major; and while `protocolVersions[]` contains any `1.x` member, `preferredVersion` MUST be that `1.x` — otherwise this rule and RFC 0176 §C.1 (no header ⇒ the v1 document through the overlap) contradict each other, which the reference host found by being unable to satisfy both (Phase 3 P3-E4). A request on a `/v1/…` path key MUST NOT carry `OpenWOP-Version` with a value other than `1`; a host MUST answer `400` `protocol_version_mismatch` otherwise.

**§A.4** Responses on any path carry `OpenWOP-Version: <major>.<minor>` naming the contract that produced them. Reporting a version other than the one used is the silent downgrade `host-sample-test-seams.md:959` forbids; the dual-stack scenario (§Conformance) falsifies it.

**§A.5** Client precedence when both majors are advertised: a v2 client selects the highest major it implements that the host lists; a v1 client (no header, `/v1/` paths) is unaffected. `minClientVersion` (axis 15) becomes a MUST: a host MAY refuse a client below it with `426 Upgrade Required` and `client_version_unsupported`.

### §B. Every axis, dispositioned

The table is RFC 0167 §E.1 with the decision made. `unify` = one type and one grammar in v2 with a codemod; `first-class` = own schema-enforced grammar and negotiation rule; `retire` = absorbed into the capability record's `{status, since, until?}`; `delete` = removed with a register row.

| # | Axis | v2 disposition | Grammar in v2 | Owner of the text |
| --- | --- | --- | --- | --- |
| 1 | `protocolVersion` | first-class (scalar kept as `preferredVersion`'s twin for v1 readers through the overlap; removed after Phase 5) | `^(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)$` | this RFC |
| 2 | `protocolVersions[]` + `preferredVersion` | first-class, negotiation input | as #1 | this RFC |
| 3 | `engineVersion` | **unify**: integer everywhere; per-event carriers become `integer, minimum 0`; codemod `openwop.codemod.engine-version-unify` | integer | this RFC (C.9 reads) |
| 4 | `eventLogSchemaVersion` | first-class | integer; the v2 value and the reader rule are C.9's decision — this RFC only keeps the axis | C.9 |
| 5 | per-event `schemaVersion` | first-class | integer; closed-enum growth rule (C.4 §0) | C.4 |
| 6 | `schemaVersions` map | first-class, key grammar = the C.4 envelope-kind grammar | `additionalProperties: false` over declared kinds | C.4 |
| 7 | `version.pinned` | first-class | integer min/max; the v1-pinned-run disposition | C.9 |
| 8 | `contractProvenance` | delete | — | C.2 |
| 9 | `minimumSuiteVersion` | retire into the declaration file | semver | C.2 |
| 10 | `bundleVersion` | unify to one `const` family; certification v3 `"3"`, export `"2"`, debug `"2"` | string const | C.1 |
| 11 | A2A `protocolVersions[]`/`preferredVersion` | first-class facet | `^[0-9]+\.[0-9]+$` | C.8 |
| 12 | MCP `protocolVersions[]`/`preferredVersion` | first-class facet | date | C.8 |
| 13 | `multiAgent.executionModel.version` | first-class | integer with a schema `maximum` read by the suite | C.4 |
| 14 | OpenAPI/AsyncAPI `info.version` | **generated** from the corpus tag; PROTOCOL-STATUS rows | semver | this RFC |
| 15 | `minClientVersion` | first-class MUST (§A.5) | as #1 | this RFC |
| 16 | channel `schemaVersion`/`compatibleWith` | first-class | integer / range | C.4 |
| 17 | webhook signature scheme | retire into `deprecations.json` | — | C.4 |
| 18 | pack `engines.openwop` + `registryVersion` | first-class with the absent-ceiling rule | semver range / semver | C.10 |

One grammar covers protocol, envelope kind, and pack axes wherever a version is a `major.minor` (#1, #2, #11, #15); `typeId@<semver>` (RFC 0013 UQ2) is a pack axis and C.10 decides pin-or-float; the `2` in `typeId@2.0.0` never means `OpenWOP-Version: 2`.

### §C. Where v2 lives

**§C.1** `spec/v2/core/` and `spec/v2/ext/<name>/` (RFC 0167 §B.7); `schemas/v2/` with every `$id` under `https://openwop.dev/spec/v2/`; published at `/spec/v2/` by the site generator iterating `spec/v*/` (MAINTAINERS §"Major bump" steps 7–8). `schemas/` (flat, v1 `$id`s) is read-only from the cut. The org question (RFC 0167 UQ1): the same organization and site serve `/spec/v2/`; the fallback, if the domain moves, is that `$id` values are immutable identifiers and the site publishes a redirect — recorded as decided, not open.

**§C.2** Retractions: `rest-endpoints.md` §Versioning bullets 1–3; `grpc-transport.md:49–50` (C.8 owns the proto's fate; this RFC only retracts the `/v1 ↔ /v2` analogy); AsyncAPI `servers.production.pathname` becomes empty and channel addresses carry their own path, exactly as OpenAPI path keys do. A new corpus check, `scripts/check-path-parity.mjs`, resolves OpenAPI, AsyncAPI, and (if kept) the proto to absolute paths for the shared event stream and fails on any difference; the canonical OpenAPI contains no seam or test-mode operation (those move to C.1's seams profile).

**§C.3** The v2 path manifest (`spec/v2/path-manifest.json`, generated) carries operations **and** channels; `resolvedPath` on a bare origin, exactly one version segment for v1 rows (`/v1/…`) and none for v2 rows.

### §D. One release identity

**§D.1** The corpus tag `openwop/v2.<minor>.<patch>` is the only release event; suite, SDKs, registry, and site derive from it. Every human-surface version (README banner, PROTOCOL-STATUS, OpenAPI/AsyncAPI `info.version`, `conformance/package.json`) is generated with `--check` in the merge gate; the identity check (`check-published-suite-identity.mjs`) and the advertised-versions check keep their three-outcome discipline; the published tarball digest equals the tree's as a release precondition.

**§D.2** PROTOCOL-STATUS gains one row per axis in §B (18 rows), including OpenAPI and AsyncAPI `info.version`.

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C5.1` | unify | `engineVersion` integer at root, string on five carriers | integer everywhere | `openwop.codemod.engine-version-unify` | legacy-stamped (persisted run docs keep the string; the reader normalises) |
| `openwop.migration.C5.2` | behavior | channel state-key prefix conventions | typed channels + reducers (C.4) | — (a prose convention; the C.9 read-time adapter is the witness) | translated |
| `openwop.migration.C5.3` | add | — | root `preferredVersion` | — | not-persisted |
| `openwop.migration.C5.4` | add | — | `OpenWOP-Version` request/response header; `protocol_version_unsupported`, `protocol_version_mismatch`, `client_version_unsupported` error codes (registered in C.4's `errors.json`) | — | not-persisted |
| `openwop.migration.C5.5` | behavior | `/v1/<op>` path keys | unversioned `/<op>` path keys for v2 (v1 keys retained through the overlap) | — (a v2 SDK reads the v2 path manifest; no persisted artifact carries a path) | not-persisted |
| `openwop.migration.C5.6` | behavior | `400` for unversioned roots (`rest-endpoints.md` bullet 3) | unversioned roots are the v2 surface | — | not-persisted |
| `openwop.migration.C5.7` | rename | `$id` base `https://openwop.dev/spec/v1/` | `https://openwop.dev/spec/v2/` (new files; v1 `$id`s immutable) | — (new schema files, not rewrites) | never-upgraded |
| `openwop.migration.C5.8` | require | `minClientVersion` advisory | MUST (§A.5) | — | not-persisted |
| `openwop.migration.C5.9` | behavior | OpenAPI/AsyncAPI `info.version` hand-maintained | generated from the corpus tag | — (generator) | not-persisted |

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| Run documents / snapshots (openwop-app SQL, MyndHyve Firestore) | `engineVersion` as a string | legacy-stamped; the reader normalises to integer; `openwop.codemod.engine-version-unify` for exported artifacts |
| Event logs | per-event `engineVersion` string | legacy-stamped; sequence space untouched (C.9) |
| Published schemas at `/spec/v1/` | v1 `$id`s | never-upgraded; served read-only |
| SDK path manifests | `/v1/…` resolved paths | never-upgraded for SDK 1; SDK 2 consumes the v2 manifest |

## Compatibility

`breaking` (v2). This PR changes no v1.x wire shape. The v1.x additive root `preferredVersion` is filed as its own small RFC under RFC 0165 §A so both majors can be advertised before the cut; it is optional, MUST be a member of `protocolVersions[]`, and is ignored by v1 consumers.

## Conformance

v2 scenarios (suite 2.0.0): `dual-stack-negotiation` (gated on a host advertising two majors: the same run is created and read through `/v1/runs` with no header and through `/runs` with `OpenWOP-Version: 2`; response headers name the contract used; a header naming an unlisted major yields `406`; `OpenWOP-Version: 2` on a `/v1/` path yields `400`), `preferred-version-default` (unaided: a header-less request on an unversioned path is served as `preferredVersion`), `min-client-version` (gated), `path-parity` (corpus), `release-identity` (corpus: every human-surface version generated; tarball digest equals the tree).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 `preferredVersion` ∈ `protocolVersions[]` | discovery document — `openwop.requirement.0172.preferred-version-default` | the suite, unaided | witnessable — unaided |
| §A.3 header selects a listed major; unlisted ⇒ `406`; wrong header on `/v1/` ⇒ `400` | response status and headers — `openwop.requirement.0172.dual-stack-negotiation` | the suite, on a dual-advertising host | witnessable — gated on two majors |
| §A.3 absent header ⇒ `preferredVersion` | response `OpenWOP-Version` — `openwop.requirement.0172.preferred-version-default` | the suite, unaided | witnessable — unaided |
| §A.4 response header equals the contract used | dual-stack scenario — `openwop.requirement.0172.dual-stack-negotiation`, `openwop.requirement.0171.header-scheme` | the suite | witnessable — gated |
| §A.5 `minClientVersion` refusal | `426` — `openwop.requirement.0172.min-client-version` | the suite, gated on a host that sets it | witnessable — gated |
| §B.3 `engineVersion` integer everywhere | schema validation of snapshot and events — `openwop.requirement.0170.id-grammar`, `openwop.requirement.0171.event-type-closed` | the suite, unaided | witnessable — unaided |
| §C.2 path parity; no seam in canonical OpenAPI | corpus gate | the corpus gate | witnessable — unaided (corpus) |
| §D.1 generated versions; tarball digest | corpus gate; publish preflight | the corpus gate | witnessable — unaided (corpus) |
| §A.3 `OpenWOP-Version` is honored or refused, never ignored | `openwop.requirement.0172.version-header-honored` — the header-less and `2.0` representations are fetched and compared byte-for-byte | any host, including one that does not implement major 2 | witnessable — unaided |

RFC 0167 G1 (`openwop.gap.0167.1`, the header-less default has no v1 precedent) is classified here as `witnessable-gated` and carried to `openwop.gap.0172.1` with the dual-stack scenario as its witness.

## Adversarial review

1. **A v1 client never sends the header, so the header cannot be the sole selector.** Disposition: it is not — the `/v1/` path key selects v1 through the overlap; the header selects among unversioned majors and defaults to `preferredVersion` (§A.2–§A.3; the A2A precedent at `a2a-integration.md:349`).
2. **`rest-endpoints.md` bullet 3 MUSTs a `400` on unversioned roots — the plan inverts a MUST.** Disposition: yes, and only in v2; v1 hosts keep the MUST. Recorded as row `C5.6` (`behavior`) and named in §C.2 as a retraction, not a silent edit.
3. **`OpenWOP-Version` on a response is a new header on the v1 surface if a host emits it on `/v1/` paths.** Disposition: emitting it on v1 responses is additive (RFC 0165 §C.1 precedent for `OpenWOP-*`); MAY in v1.x, MUST in v2.
4. **The engineVersion codemod cannot know whether a string carrier was "the decimal rendering of the root integer."** Disposition: the codemod refuses any value that is not `^(0|[1-9][0-9]*)$`; the refusal fixture is committed.
5. **`typeId@2.0.0` and `OpenWOP-Version: 2` share a digit and no meaning.** Disposition: stated in §B; C.10 owns the pack axis.
6. **The axis table asserted `eventLogSchemaVersion` v2 value `3`, pre-empting C.9.** Disposition: retracted; the row keeps the axis first-class and names C.9 as the owner of the value.
7. **New error codes: `protocol_version_unsupported`, `protocol_version_mismatch`, `client_version_unsupported`.** No collision (`interop_version_unsupported` is the A2A/MCP boundary code and stays); `426` is already the documented `minClientVersion` status (`capabilities.md:168`, `version-negotiation.md:265`); the flat envelope carries no status field so nothing else changes. Registered in C.4's `errors.json`.
8. **No v1 scenario asserts the `400` on unversioned roots** (only path-resolution tests exist), so a dual-stack host does not fail a v1 leg by serving v2 there.
9. **The `/v1/` path prefix is a `path` surface, not a discovery shape.** Disposition: `deprecations.schema.json` `kind` gains `path` (additive enum growth on a non-wire data schema); the row is re-kinded; the alias-coverage gate treats `path` as a visible kind.
10. **MAINTAINERS step 6 edits `spec/v1/auth.md` at the cut while RFC 0167 says v1 is read-only from the cut.** Disposition: the status-legend pointer is the one permitted v1 edit at the cut; recorded as G2.

## Alternatives considered

1. `/v2/` path space. Rejected: three texts presume it and all inherit the `/v1/v1` composition hazard; two path manifests per major; RFC 0149 §A's bare-origin rule already exists.
2. Two discovery documents (`/.well-known/openwop` and `/.well-known/openwop-v2`). Rejected by C.9: one fetch answers both majors.
3. Keep `engineVersion` split with a reader rule only. Rejected: Axiom 2 (one name per thing) and the codemod is trivial.
4. Do nothing. Rejected: COMPATIBILITY §5 requires a coexistence plan and none exists.

## Unresolved questions

1. Whether `OpenWOP-Version` on requests should accept `major.minor` (a client pinning a minor) or integer major only. Recommended: integer major only; a minor pin is what `minClientVersion` and additive rules already cover.

## Implementation notes (non-normative)

The v1.x `preferredVersion` RFC is a one-field additive change (schema optional field + RFC 0165 §A cross-reference) and can land before Phase 3 so both hosts advertise it in their Phase 4 legs. `check-path-parity.mjs` and the generated `info.version` land with the v2 tree in Phase 3.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; rows `C5.1`–`C5.9`; codemod `openwop.codemod.engine-version-unify` green on its four legs; register rows; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): `spec/v2/core/versioning.md`; root `preferredVersion` in `schemas/v2/`; the three retractions; `check-path-parity.mjs`; generated `info.version`; PROTOCOL-STATUS 18 rows; the five scenarios in suite 2.0.0; dual-stack passing on openwop-app from both majors.

## References

- RFC 0167 §A, §B.1, §E.1, G1, UQ1; RFC 0149 §A/§C; RFC 0165 §A; RFC 0152/0153 (`preferredVersion` precedent); RFC 0013 UQ2; RFC 0021 UQ1.
- `spec/v1/version-negotiation.md` §"Protocol version grammar", §"protocolVersions[]", §"engineVersion axis is split", gaps V1–V5; `rest-endpoints.md` §Versioning; `grpc-transport.md`; `api/asyncapi.yaml` servers; `a2a-integration.md:349`; `docs/PROTOCOL-STATUS.md`; `MAINTAINERS.md` §"Major bump to v2.x"; `scripts/check-published-suite-identity.mjs`, `check-advertised-versions.mjs`.

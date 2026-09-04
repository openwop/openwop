# Versioning and Release

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0172, 0179, 0176.**

## Why this exists

v1 negotiated on one scalar, could not advertise two majors, split `engineVersion` across two types, and presumed a `/v2/` path space that the `/v1/v1` defect already showed is the wrong model. This document is the one place a v2 host reads to learn how a major is selected, what each version axis means, and what a release is.

## 1. Major negotiation (RFC 0172 §A)

### 1.1 Advertisement

A v2 host MUST advertise `protocolVersions[]` (grammar `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$` per member) containing every `<major>.<minor>` it serves, and a root `preferredVersion` that MUST be a member of `protocolVersions[]`. Both are REQUIRED root metadata in `schemas/v2/capabilities.schema.json` (see `capabilities.md`). Through the overlap a host serves `["1.<n>", "2.<m>"]`; after v1 end-of-support it serves `["2.<m>"]`.

**Through the overlap `preferredVersion` MUST name a 1.x member.** A header-less request is a v1 client's request: `capabilities.md` §1 makes the header-less representation the v1 document, and §1.3 makes the header-less default `preferredVersion`'s major, so on a host whose `protocolVersions[]` contains any `1.x` member the two rules agree only when `preferredVersion` is that `1.x`. A host that drops v1 from `protocolVersions[]` advertises a `2.x` `preferredVersion` and its header-less representation becomes the closed v2 root. On a host serving a single major, `preferredVersion` MUST equal `protocolVersion` (RFC 0179 §A.1). A v2 consumer reads `preferredVersion` as the header-less default; when it is absent on a v1 document the consumer's default is `max(protocolVersions[])`, else `protocolVersion` (RFC 0179 §A.2). The suite's `--target-major` defaults from it (RFC 0168 §D.3).

### 1.2 Paths

v1 operations keep their `/v1/…` path keys unchanged through the overlap. v2 operations are unversioned path keys on a bare origin (`servers[].url = https://{host}`): `/runs`, `/runs/{runId}`, `/.well-known/openwop`. There is no `/v2/` path space. An unversioned path is the v2 surface; the v1 MUST that servers answer `400` for unversioned roots is retracted for v2.

`spec/v2/path-manifest.json` (generated) carries operations and channels with a `resolvedPath` on a bare origin: exactly one version segment for v1 rows and none for v2 rows. OpenAPI (`api/v2/openapi.yaml`), AsyncAPI (`api/v2/asyncapi.yaml`), and any kept proto MUST resolve to identical absolute paths for the shared event stream (`scripts/check-path-parity.mjs`); the canonical OpenAPI MUST contain no seam or test-mode operation (those live in the seams profile, see `conformance.md`).

### 1.3 The request header

A request on an unversioned path MAY carry `OpenWOP-Version: <major>` (integer major only, e.g. `OpenWOP-Version: 2`).

| Condition | Host behavior |
| --- | --- |
| Header names a major in `protocolVersions[]` | MUST serve that major |
| Header names a major not in `protocolVersions[]` | MUST answer `406` `protocol_version_unsupported` with `details.protocolVersions[]` echoing the list |
| Header absent on an unversioned path | MUST serve `preferredVersion`'s major |
| `/v1/…` path with `OpenWOP-Version` other than `1` | MUST answer `400` `protocol_version_mismatch` |

A request on a `/v1/…` path key MUST NOT carry `OpenWOP-Version` with a value other than `1`. All three codes are rows in `spec/v2/errors.json` (see `errors.md`).

### 1.4 The response header

A response on any path MUST carry `OpenWOP-Version: <major>.<minor>` naming the contract that produced it. Reporting a version other than the one used is a silent downgrade and non-conformant; the `dual-stack-negotiation` scenario falsifies it. Emitting the header on `/v1/` responses is additive in v1.x and REQUIRED in v2.

### 1.5 Client precedence and `minClientVersion`

When both majors are advertised, a v2 client MUST select the highest major it implements that the host lists; a v1 client (no header, `/v1/` paths) is unaffected. `minClientVersion` (axis 15, grammar as axis 1) is a MUST: a host MAY refuse a client below it with `426` `client_version_unsupported`.

`OpenWOP-Version` on a request carries an integer major only; a minor pin is what `minClientVersion` and the additive rules cover (RFC 0172 UQ1, recommended disposition).

## 2. The 18 version axes (RFC 0172 §B; RFC 0167 §E.1)

`unify` = one type and grammar with a codemod; `first-class` = own schema-enforced grammar and negotiation rule; `retire` = absorbed into the capability record's `{status, since, until?}`; `delete` = removed with a register row.

| # | Axis | Disposition | v2 grammar | Owner |
| --- | --- | --- | --- | --- |
| 1 | `protocolVersion` | first-class; kept as `preferredVersion`'s twin for v1 readers through the overlap, removed after | `^(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)$` | this document |
| 2 | `protocolVersions[]` + `preferredVersion` | first-class, negotiation input | as #1 | this document |
| 3 | `engineVersion` | unify: integer everywhere; codemod `openwop.codemod.engine-version-unify` | `integer, minimum 0` | this document |
| 4 | `eventLogSchemaVersion` | first-class, the era key | integer; v2 writes `3` | `persistence.md` |
| 5 | per-event `schemaVersion` | first-class; §0 growth rule | integer | `events.md` |
| 6 | `schemaVersions` map | first-class; keys = envelope-kind grammar | `additionalProperties: false` over declared kinds | `events.md` |
| 7 | `version.pinned` | first-class; the v1-pinned-run disposition | integer min/max | `persistence.md` |
| 8 | `contractProvenance` | delete | — | `capabilities.md` |
| 9 | `minimumSuiteVersion` | retire into `spec/v2/declaration.json` | semver | `capabilities.md` |
| 10 | `bundleVersion` | unify to one `const` family: certification v3 `"3"`, export `"2"`, debug `"2"` | string const | `conformance.md` |
| 11 | A2A `versions[]` / `preferredVersion` | first-class facet of `a2a` | `^[0-9]+\.[0-9]+$` | `interop.md` |
| 12 | MCP `revisions[]` / `preferredVersion` | first-class facet of `mcp` | date | `interop.md` |
| 13 | `multiAgent.executionModel.version` | first-class | integer with a schema `maximum` the suite reads | `events.md` |
| 14 | OpenAPI / AsyncAPI `info.version` | generated from the corpus tag | semver | this document |
| 15 | `minClientVersion` | first-class MUST (§1.5) | as #1 | this document |
| 16 | channel `schemaVersion` / `compatibleWith` | first-class | integer / range | `events.md` |
| 17 | webhook signature scheme | retire into `deprecations.json` | — | `webhooks.md` |
| 18 | pack `engines.openwop` + `registryVersion` | first-class with the absent-ceiling rule | semver range / semver | `packs.md` |

One grammar covers protocol, envelope-kind, and pack axes wherever a version is `<major>.<minor>` (#1, #2, #11, #15). `typeId@<semver>` is a pack axis (`packs.md`); the `2` in `typeId@2.0.0` never means `OpenWOP-Version: 2`. `docs/PROTOCOL-STATUS.md` carries one row per axis (RFC 0172 §D.2).

### 2.1 `engineVersion` (axis 3)

`engineVersion` MUST be an integer (`minimum 0`) at the discovery root and on every per-event carrier. A persisted v1 run document that carries the string form is legacy-stamped: the reader MUST normalise it to an integer and MUST NOT rewrite the stored document. The codemod `openwop.codemod.engine-version-unify` MUST refuse any value not matching `^(0|[1-9][0-9]*)$`.

### 2.2 `eventLogSchemaVersion` (axis 4; RFC 0176 §A.2)

`eventLogSchemaVersion` is the era key. A v2 host MUST stamp `3` on every run it creates. A run document without the field on a store that has ever been written by a v1 host MUST read as `2` (v1 era). The v1 rule for `< 2` (snapshot fallback, no projection write-through) is unchanged. Discovery advertises the value the host writes for new runs and nothing else; the schema floor is `minimum 2`. The reader contract is `persistence.md`.

## 3. Where v2 lives (RFC 0172 §C)

`spec/v2/core/` and `spec/v2/ext/<key>/` hold the prose; `schemas/v2/` holds every v2 schema with `$id` under `https://openwop.dev/spec/v2/`; the site publishes them at `/spec/v2/`. The flat `schemas/` tree (v1 `$id`s) is read-only from the cut; v1 `$id` values are immutable identifiers, and a domain move is answered by a redirect, never a rewrite. AsyncAPI `servers.production.pathname` is empty and every channel address carries its own path, exactly as OpenAPI path keys do.

## 4. One release identity (RFC 0172 §D)

The corpus tag `v2.<minor>.<patch>` (release candidates `v2.0.0-rc.<n>`) is the only release event; suite, SDKs, registry, and site derive from it. `spec/v2/release.json` carries the next tag as `version` and is bumped only by the release PR that cuts the tag. Every human-surface version (README banner, `docs/PROTOCOL-STATUS.md`, OpenAPI and AsyncAPI `info.version`, `conformance/package.json`) MUST be generated from it and checked with `--check` in the merge gate; the published tarball digest MUST equal the tree's as a release precondition. The identity and advertised-versions checks keep their three-outcome discipline (`conformance.md`).

A consumer that vendors any file from `schemas/`, `api/`, or `spec/` MUST pin to a published tag, record it, and refuse a sync from any other ref; a v1.x consumer MUST NOT vendor `schemas/v2/` (RFC 0176 §E.1).

## 5. The overlap (RFC 0167 §B.5; RFC 0176)

Through the overlap a host MUST advertise both majors (§1.1), MUST emit `OpenWOP-Version` on every response (§1.4), and MUST serve `/.well-known/openwop` as one resource whose representation the request header selects (`capabilities.md`). The dual-stack scenario creates one run through `/v1/runs` with no header and reads it through `/runs` with `OpenWOP-Version: 2`; the response headers name the contract used. The overlap ends at v1 end-of-support (`overview.md`), when `protocolVersions[]` drops the `1.<n>` member and every alias carrying the `v1-end-of-support` trigger is removed.

## 6. Migration rows (RFC 0172)

| Row | v1 | v2 |
| --- | --- | --- |
| `C5.1` | `engineVersion` integer at root, string on five carriers | integer everywhere; codemod `engine-version-unify` |
| `C5.3` | — | root `preferredVersion` |
| `C5.4` | — | `OpenWOP-Version` request/response header; three error codes |
| `C5.5` | `/v1/<op>` path keys | unversioned `/<op>` keys (v1 keys retained through the overlap) |
| `C5.6` | `400` for unversioned roots | unversioned roots are the v2 surface |
| `C5.7` | `$id` base `/spec/v1/` | `/spec/v2/` (new files; v1 `$id`s immutable) |
| `C5.8` | `minClientVersion` advisory | MUST (§1.5) |
| `C5.9` | `info.version` hand-maintained | generated from the corpus tag |

Row `C5.2` (channel state-key prefixes → typed channels) is owned by `events.md`. Every row is a `spec/v1/migrations.json` entry; the persisted-data disposition for each is `not-persisted` except `C5.1` (legacy-stamped) and `C5.7` (never-upgraded).

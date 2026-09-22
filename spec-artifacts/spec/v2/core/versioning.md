# Versioning and Release

> **Status: Stable · RFC 0172, 0179, 0176.**

## Why this exists

How a v2 host selects a major, what each version axis means, and what a release is.

## 1. Major negotiation (RFC 0172 §A)

### 1.1 Advertisement

A v2 host MUST advertise `protocolVersions[]` (grammar `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$` per member) containing every `<major>.<minor>` it serves, and a root `preferredVersion` that MUST be a member of `protocolVersions[]`. Both are REQUIRED root metadata in `schemas/v2/capabilities.schema.json` (see `capabilities.md`). Through the overlap a host serves `["1.<n>", "2.<m>"]`; after v1 end-of-support it serves `["2.<m>"]`.

**Through the overlap `preferredVersion` MUST name a 1.x member**, because a header-less request is a v1 client's (`capabilities.md` §1; §1.3). A host that drops v1 from `protocolVersions[]` advertises a `2.x` `preferredVersion` and its header-less representation becomes the closed v2 root. On a host serving a single major, `preferredVersion` MUST equal `protocolVersion` (RFC 0179 §A.1). A v2 consumer reads `preferredVersion` as the header-less default; when it is absent on a v1 document the consumer's default is `max(protocolVersions[])`, else `protocolVersion` (RFC 0179 §A.2). The suite's `--target-major` defaults from it (RFC 0168 §D.3).

### 1.2 Paths

v1 operations keep their `/v1/…` path keys unchanged through the overlap. v2 operations are unversioned path keys on a bare origin (`servers[].url = https://{host}`): `/runs`, `/runs/{runId}`, `/.well-known/openwop`. There is no `/v2/` path space. An unversioned path is the v2 surface; the v1 MUST that servers answer `400` for unversioned roots is retracted for v2.

A host that advertises a major in `protocolVersions[]` MUST reach, under that major, every operation **named in `spec/v2/path-manifest.json`** that it serves under the other: advertising a major is a claim about the **path space**, not about `/.well-known/openwop` alone (§1.3 selects that resource's representation). If `/v1/<op>` answers and the unversioned `/<op>` returns `404` under the advertised major, the host MUST NOT advertise that major until the surface is reachable.

Seam and proprietary paths are not manifest operations and need no per-major twin.

`spec/v2/path-manifest.json` (generated) carries operations (`method`, `path`, `operationId`) and channels (`name`, `address`) on a bare origin, and **every path in it is unversioned** — there are no `/v1` rows. The `/v1` twin of a manifest row is derived by prefixing, which is what the pairing above compares. OpenAPI (`api/v2/openapi.yaml`), AsyncAPI (`api/v2/asyncapi.yaml`), and any kept proto MUST resolve to identical absolute paths for the shared event stream (`scripts/check-path-parity.mjs`) (seams: `conformance.md`).

### 1.3 The request header

A request on an unversioned path MAY carry `OpenWOP-Version: <major>` or `OpenWOP-Version: <major>.<minor>` — `2` and `2.0` select the same major and a host MUST accept both. Only the major selects; a minor in the header is informational, and what pins a minor is `minClientVersion` plus the additive rules.

| Condition | Host behavior |
| --- | --- |
| Header names a major in `protocolVersions[]` | MUST serve that major |
| Header names a major not in `protocolVersions[]` | MUST answer `406` `protocol_version_unsupported` with `details.protocolVersions[]` echoing the list |
| Header absent on an unversioned path | MUST serve `preferredVersion`'s major |
| `/v1/…` path with `OpenWOP-Version` other than `1` | MUST answer `400` `protocol_version_mismatch` |

A request on a `/v1/…` path key MUST NOT carry `OpenWOP-Version` with a value other than `1`. All three codes are rows in `spec/v2/errors.json` (see `errors.md`).

### 1.4 The response header

Every protocol response MUST carry `OpenWOP-Version: <major>.<minor>` naming the contract that produced it. Reporting a version other than the one used is a silent downgrade and non-conformant; the `dual-stack-negotiation` scenario falsifies it. Emitting the header on `/v1/` responses is additive in v1.x and REQUIRED in v2.

A *protocol response* is one produced by an operation named in
`spec/v2/path-manifest.json` (or its `/v1/` twin through the overlap). A shell,
hosting fallback, conformance seam, or proprietary route has no protocol
version to name.

**On a manifest-named path, a non-protocol response MUST NOT carry `OpenWOP-Version` and MUST NOT be `application/json`**; a reader, a cache or the suite MUST NOT count a response without the header, or with a `text/html` body, as reaching the operation (`reachedUnderMajor2`). A vendor path (§5) is not a shared name and is unconstrained.

**Content negotiation on a shared name is permitted, with conditions.** A host MAY serve a protocol operation and a page under one unversioned name, selecting on `Accept`, iff:

1. A request identifying as a protocol client — `OpenWOP-Version` present, **or** an `Accept` admitting `application/json` without preferring `text/html` (absent and `*/*` included) — MUST get the protocol response for the applicable major (§1.3) with `OpenWOP-Version`; only an explicit `text/html` preference selects the page.
2. The page obeys the paragraph above.
3. The response carries `Vary: Accept, OpenWOP-Version`.

Otherwise the page MUST move off the shared name.

### 1.5 Client precedence and `minClientVersion`

When both majors are advertised, a v2 client MUST select the highest major it implements that the host lists; a v1 client (no header, `/v1/` paths) is unaffected. `minClientVersion` (axis 15, grammar as axis 1) is a MUST: a host MAY refuse a client below it with `426` `client_version_unsupported`.

## 2. The 18 version axes (RFC 0172 §B; RFC 0167 §E.1)

`unify` = one type and grammar with a codemod; `first-class` = own schema-enforced grammar and negotiation rule; `retire` = absorbed into the capability record's `{status, since, until?}`; `delete` = removed with a register row.

| # | Axis | Disposition | v2 grammar | Owner |
| --- | --- | --- | --- | --- |
| 1 | `protocolVersion` | first-class; kept as `preferredVersion`'s twin for v1 readers through the overlap, removed after | `^(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)$` | this document |
| 2 | `protocolVersions[]` + `preferredVersion` | first-class, negotiation input | as #1 | this document |
| 3 | `engineVersion` | unify: integer everywhere; codemod `openwop.codemod.engine-version-unify` | `integer, minimum 0` | this document |
| 4 | `eventLogSchemaVersion` | first-class, the era key | integer; v2 writes `3` | `persistence.md` |
| 5 | per-event `schemaVersion` | first-class; §0 growth rule | integer | `events.md` |
| 6 | `schemaVersions` map | first-class; the map moves into the record's `kinds` seat (RFC 0193) | `propertyNames` = the envelope-kind grammar, values `integer, minimum 0`; NOT a closed enum — a vendor kind is host-published and never corpus-declared | `events.md` |
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

`eventLogSchemaVersion` is the era key; the schema floor is `minimum 2`. Its stamping, absent-⇒-`2` and discovery rules are `persistence.md` §"The era key"; the reader contract is `persistence.md`.

## 3. Where v2 lives (RFC 0172 §C)

`spec/v2/core/` and `spec/v2/ext/<key>/` hold the prose; `schemas/v2/` holds every v2 schema with `$id` under `https://openwop.dev/spec/v2/`; the site publishes them at `/spec/v2/`. The flat `schemas/` tree (v1 `$id`s) is read-only from the cut; v1 `$id` values are immutable identifiers, and a domain move is answered by a redirect, never a rewrite. AsyncAPI `servers.production.pathname` is empty and every channel address carries its own path, exactly as OpenAPI path keys do.

## 4. One release identity (RFC 0172 §D)

The corpus tag `v2.<minor>.<patch>` (release candidates `v2.0.0-rc.<n>`) is the only release event; suite, SDKs, registry, and site derive from it. `spec/v2/release.json` carries the next tag as `version` and is bumped only by the release PR that cuts the tag. Every human-surface version (README banner, `docs/PROTOCOL-STATUS.md`, OpenAPI and AsyncAPI `info.version`, `conformance/package.json`) MUST be generated from it and checked with `--check` in the merge gate; the published tarball digest MUST equal the tree's as a release precondition. The identity and advertised-versions checks keep their three-outcome discipline (`conformance.md`).

A consumer that vendors any file from `schemas/`, `api/`, or `spec/` MUST pin to a published tag, record it, and refuse a sync from any other ref; a v1.x consumer MUST NOT vendor `schemas/v2/` (RFC 0176 §E.1).

## 5. The overlap (RFC 0167 §B.5; RFC 0176)

Through the overlap a host MUST advertise both majors (§1.1), MUST emit `OpenWOP-Version` on every response (§1.4), and MUST serve `/.well-known/openwop` as one resource whose representation the request header selects (`capabilities.md`). The dual-stack scenario creates one run through `/v1/runs` with no header and reads it through `/runs` with `OpenWOP-Version: 2`; the response headers name the contract used.

**A run minted under major 1 and read under major 2 MUST use the tenant-bound
projection** `<tenantId>/<v1-id>` (`identity.md` §5). A host MUST NOT return a
bare v1 id in a major-2 response.

The overlap ends at v1 end-of-support (`overview.md`), when `protocolVersions[]` drops the `1.<n>` member and every alias carrying the `v1-end-of-support` trigger is removed.

**Retirement is atomic.** §1.1 admits no state in which both majors are advertised and `2.x` is preferred, so dropping v1 retires the whole `/v1` path space at once.

**Retirement changes every header-less request's default contract.** Before
end-of-support, a header-less unversioned request uses major 1; afterward it uses
major 2. Before retirement, a host MUST check for collisions between manifest
top-level path segments and non-protocol unversioned routes. It MUST move each
colliding route or apply §1.4 content negotiation.

**Host-proprietary paths live at `/host/<org>/…` (RFC 0181).** Every vendor namespace — capability records (`capabilities.md` §3.2), error codes, event types, pack properties — is keyed to an org registered in `spec/v2/declaration.json`; paths join that pattern. A host MAY serve operations the manifest does not name under `/host/<org>/…` for its registered org: no major in the path, served regardless of `OpenWOP-Version`, never a protocol operation, never measured, outside §1.4. An org MUST NOT be named after a manifest segment under `/host/` (`reservedOrgs`); a host SHOULD advertise the mount under `extensions.<org>.<name>`. A `/v1/host/<org>/…` twin MAY ride the overlap and retires atomically with `/v1`.

## 6. Migration rows (RFC 0172)

Rows `C5.1`–`C5.9` are `spec/v1/migrations.json` entries (`C5.2` is owned by `events.md`); the persisted-data disposition for each is `not-persisted` except `C5.1` (legacy-stamped) and `C5.7` (never-upgraded).

# Versioning and Release

> **Status: Stable.**

## Why this exists

How a v2 host selects a major, what each version axis means, and what a release is.

## 1. Major negotiation

### 1.1 Advertisement

A v2 host MUST advertise two root fields, both REQUIRED in `schemas/v2/capabilities.schema.json` ([capabilities.md](capabilities.md)):

- `protocolVersions[]` — every `<major>.<minor>` it serves, each matching `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`. Through the overlap that is `["1.<n>", "2.<m>"]`; after v1 end-of-support, `["2.<m>"]`.
- `preferredVersion` — MUST be a member of `protocolVersions[]`. Through the overlap it MUST name a 1.x member, because a header-less request is a v1 client's ([capabilities.md](capabilities.md) §1; §1.3). On a host serving a single major, it MUST equal `protocolVersion`.

A host that drops v1 advertises a `2.x` `preferredVersion`; its header-less representation becomes the closed v2 root.

A v2 consumer reads `preferredVersion` as the header-less default. When it is absent on a v1 document, the default is `max(protocolVersions[])`, else `protocolVersion`. The suite's `--target-major` defaults from it.

### 1.2 Paths

- v1 operations keep their `/v1/…` path keys unchanged through the overlap.
- v2 operations are unversioned path keys on a bare origin (`servers[].url = https://{host}`): `/runs`, `/runs/{runId}`, `/.well-known/openwop`. There is no `/v2/` path space.
- An unversioned path is the v2 surface; v1's rule that it answers `400` does not apply.

Advertising a major is a claim about the whole **path space**, not about `/.well-known/openwop` alone (§1.3 selects that resource's representation):

- A host that advertises a major in `protocolVersions[]` MUST reach, under that major, every operation named in `spec/v2/path-manifest.json` that it serves under the other.
- If `/v1/<op>` answers and the unversioned `/<op>` returns `404` under the advertised major, the host MUST NOT advertise that major until the surface is reachable.
- Seam and proprietary paths are not manifest operations and need no per-major twin.

`spec/v2/path-manifest.json` (generated) lists operations (`method`, `path`, `operationId`) and channels (`name`, `address`) on a bare origin. Every path in it is unversioned; the pairing above compares each row with its `/v1` twin, derived by prefixing.

OpenAPI (`api/v2/openapi.yaml`), AsyncAPI (`api/v2/asyncapi.yaml`) and any kept proto MUST resolve to identical absolute paths for the shared event stream (`scripts/check-path-parity.mjs`). Seams are in [conformance.md](conformance.md).

### 1.3 The request header

A request on an unversioned path MAY carry `OpenWOP-Version: <major>` or `OpenWOP-Version: <major>.<minor>`. `2` and `2.0` select the same major, and a host MUST accept both. Only the major selects: a minor in the header is informational. What pins a minor is `minClientVersion` plus the additive rules (`COMPATIBILITY.md` §2.4).

| Condition | Host behavior |
| --- | --- |
| Header names a major in `protocolVersions[]` | MUST serve that major |
| Header names a major not in `protocolVersions[]` | MUST answer `406` `protocol_version_unsupported`, with `details.protocolVersions[]` echoing the list |
| Header absent on an unversioned path | MUST serve `preferredVersion`'s major |
| `/v1/…` path with `OpenWOP-Version` other than `1` | MUST answer `400` `protocol_version_mismatch` |

A request on a `/v1/…` path key MUST NOT carry `OpenWOP-Version` with a value other than `1`. `protocol_version_unsupported`, `protocol_version_mismatch` and `client_version_unsupported` (§1.5) are rows in `spec/v2/errors.json` ([errors.md](errors.md)).

### 1.4 The response header

Every protocol response MUST carry `OpenWOP-Version: <major>.<minor>` naming the contract that produced it, `/v1/` responses included (REQUIRED in v2). Reporting a version other than the one used is a silent downgrade and non-conformant (scenario `dual-stack-negotiation`).

A *protocol response* is one produced by an operation named in `spec/v2/path-manifest.json` (or its `/v1/` twin through the overlap). A shell, hosting fallback, conformance seam or proprietary route has no protocol version to name.

On a manifest-named path:

- A non-protocol response MUST NOT carry `OpenWOP-Version` and MUST NOT be `application/json`.
- A reader, a cache or the suite MUST NOT count a response without the header, or with a `text/html` body, as reaching the operation (`reachedUnderMajor2`).

A vendor path (§5) is not a shared name and is unconstrained.

#### Content negotiation on a shared name

A host MAY serve a protocol operation and a page under one unversioned name, selecting on `Accept`, iff:

1. A request identifying as a protocol client — `OpenWOP-Version` present, **or** an `Accept` admitting `application/json` without preferring `text/html` (absent and `*/*` included) — MUST get the protocol response for the applicable major (§1.3) with `OpenWOP-Version`. Only an explicit `text/html` preference selects the page.
2. The page obeys the rules above.
3. The response carries `Vary: Accept, OpenWOP-Version`.

Otherwise the page MUST move off the shared name.

### 1.5 Client precedence and `minClientVersion`

When both majors are advertised, a v2 client MUST select the highest major it implements that the host lists. A v1 client (no header, `/v1/` paths) is unaffected.

A client announces the protocol version it implements in the `OpenWOP-Client-Version` request header, as `<major>.<minor>` or `<major>.<minor>.<patch>` (non-negative integers, no leading zeros). The value is the corpus release the client is built against (§4), not an SDK or product version.

- A client SHOULD send it on every request under major 2.
- The header is optional on every operation and never selects a major (§1.3). A host MUST NOT choose a major or a representation from it.
- A host MUST NOT refuse a request because it omits the header or sends a malformed value.
- A value outside the grammar MUST be treated as absent, and MUST NOT produce a `400`.
- The value is the client's claim. A host MUST NOT use it as an authentication or authorization input.

`minClientVersion` (axis 15) is optional. When a host advertises it:

- It MUST use the axis-1 grammar.
- A client is below it when the client's major and minor, compared as integers, are less than the floor's. The patch never decides.
- A host MAY refuse a client below it. A refusal MUST be `426` `client_version_unsupported`, and MAY carry `details.minClientVersion` naming the floor ([errors.md](errors.md)).
- The discovery document is not exempt: a client refused there learns the floor from `details.minClientVersion`.

A host MUST NOT answer `426` `client_version_unsupported` to a request that does not carry a well-formed `OpenWOP-Client-Version` below its advertised `minClientVersion`.

This header rule binds requests served under major 2. A request served under major 1 follows that major's frozen text.

Open gap: RFC 9110 §15.5.22 requires an `Upgrade` header on every `426`. This floor departs from it, and no `Upgrade` value is defined yet.

## 2. The 18 version axes

Dispositions:

- `unify` — one type and grammar, with a codemod.
- `first-class` — own schema-enforced grammar and negotiation rule.
- `retire` — absorbed into the capability record's `{status, since, until?}`.
- `delete` — removed, with a register row.

| # | Axis | Disposition | v2 grammar | Owner |
| --- | --- | --- | --- | --- |
| 1 | `protocolVersion` | first-class; `preferredVersion`'s twin for v1 readers through the overlap, removed after | `^(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)$` | this document |
| 2 | `protocolVersions[]` + `preferredVersion` | first-class, negotiation input | as #1 | this document |
| 3 | `engineVersion` | unify: integer everywhere; codemod `openwop.codemod.engine-version-unify` | `integer, minimum 0` | this document |
| 4 | `eventLogSchemaVersion` | first-class, the era key | integer; v2 writes `3` | `persistence.md` |
| 5 | per-event `schemaVersion` | first-class; §0 growth rule | integer | `events.md` |
| 6 | `schemaVersions` map | first-class; the map moves into the record's `kinds` seat | `propertyNames` = the envelope-kind grammar, values `integer, minimum 0`; not a closed enum — a vendor kind is host-published, never corpus-declared | `events.md` |
| 7 | `version.pinned` | first-class; the v1-pinned-run disposition | integer min/max | `persistence.md` |
| 8 | `contractProvenance` | delete | — | `capabilities.md` |
| 9 | `minimumSuiteVersion` | retire into `spec/v2/declaration.json` | semver | `capabilities.md` |
| 10 | `bundleVersion` | unify to one `const` family: certification v3 `"3"`, export `"2"`, debug `"2"` | string const | `conformance.md` |
| 11 | A2A `versions[]` / `preferredVersion` | first-class facet of `a2a` | `^[0-9]+\.[0-9]+$` | `interop.md` |
| 12 | MCP `revisions[]` / `preferredVersion` | first-class facet of `mcp` | date | `interop.md` |
| 13 | `multiAgent.executionModel.version` | first-class | integer with a schema `maximum` the suite reads | `events.md` |
| 14 | OpenAPI / AsyncAPI `info.version` | generated from the corpus tag | semver | this document |
| 15 | `minClientVersion` | first-class (§1.5) | as #1 | this document |
| 16 | channel `schemaVersion` / `compatibleWith` | first-class | integer / range | `events.md` |
| 17 | webhook signature scheme | retire into `deprecations.json` | — | `webhooks.md` |
| 18 | pack `engines.openwop` + `registryVersion` | first-class with the absent-ceiling rule | semver range / semver | `packs.md` |

- One grammar covers protocol, envelope-kind and pack axes wherever a version is `<major>.<minor>` (#1, #2, #11, #15).
- `typeId@<semver>` is a pack axis (`packs.md`); the `2` in `typeId@2.0.0` never means `OpenWOP-Version: 2`.
- `docs/PROTOCOL-STATUS.md` carries one row per axis.

### 2.1 `engineVersion` (axis 3)

- `engineVersion` MUST be an integer (`minimum 0`) at the discovery root and on every per-event carrier.
- A persisted v1 run document that carries the string form is legacy-stamped: the reader MUST normalise it to an integer and MUST NOT rewrite the stored document.
- The codemod `openwop.codemod.engine-version-unify` MUST refuse any value not matching `^(0|[1-9][0-9]*)$`.

### 2.2 `eventLogSchemaVersion` (axis 4)

`eventLogSchemaVersion` is the era key; the schema floor is `minimum 2`. Its stamping, absent-⇒-`2` and discovery rules are `persistence.md` §"The era key"; the reader contract is `persistence.md`.

## 3. Where v2 lives

- `spec/v2/core/` and `spec/v2/ext/<key>/` hold the prose.
- `schemas/v2/` holds every v2 schema, with `$id` under `https://openwop.dev/spec/v2/`; the site publishes them at `/spec/v2/`.
- The flat `schemas/` tree (v1 `$id`s) is read-only. v1 `$id` values are immutable identifiers: a domain move is answered by a redirect, never a rewrite.
- AsyncAPI `servers.production.pathname` is empty; every channel address carries its own path, as OpenAPI path keys do.

## 4. One release identity

The corpus tag `v2.<minor>.<patch>` (release candidates `v2.0.0-rc.<n>`) is the only release event; suite, SDKs, registry and site derive from it. `spec/v2/release.json` carries the next tag as `version`, and only the release PR that cuts the tag bumps it.

- Every human-surface version (README banner, `docs/PROTOCOL-STATUS.md`, OpenAPI and AsyncAPI `info.version`, `conformance/package.json`) MUST be generated from it and checked with `--check` in the merge gate.
- The published tarball digest MUST equal the tree's as a release precondition.
- The identity and advertised-versions checks keep their three-outcome discipline ([conformance.md](conformance.md)).
- A consumer that vendors any file from `schemas/`, `api/` or `spec/` MUST pin to a published tag, record it, and refuse a sync from any other ref.
- A v1.x consumer MUST NOT vendor `schemas/v2/`.

## 5. The overlap

Through the overlap a host:

- MUST advertise both majors (§1.1);
- MUST emit `OpenWOP-Version` on every response (§1.4);
- MUST serve `/.well-known/openwop` as one resource whose representation the request header selects ([capabilities.md](capabilities.md)).

The dual-stack scenario creates one run through `/v1/runs` with no header and reads it through `/runs` with `OpenWOP-Version: 2`; the response headers name the contract used.

A run minted under major 1 and read under major 2 MUST use the tenant-bound projection `<tenantId>/<v1-id>` ([identity.md](identity.md) §5). A host MUST NOT return a bare v1 id in a major-2 response.

### Retirement

The overlap ends at v1 end-of-support ([overview.md](overview.md)): `protocolVersions[]` drops the `1.<n>` member, and every alias carrying the `v1-end-of-support` trigger is removed.

- **Retirement is atomic.** §1.1 admits no state in which both majors are advertised and `2.x` is preferred, so dropping v1 retires the whole `/v1` path space at once.
- **Retirement changes every header-less request's default contract**, from major 1 to major 2. Before retirement, a host MUST check for collisions between manifest top-level path segments and non-protocol unversioned routes, and MUST move each colliding route or apply §1.4 content negotiation.

### Host-proprietary paths: `/host/<org>/…`

Every vendor namespace — capability records ([capabilities.md](capabilities.md) §3.2), error codes, event types, pack properties — is keyed to an org registered in `spec/v2/declaration.json`; paths join that pattern.

- A host MAY serve operations the manifest does not name under `/host/<org>/…` for its registered org. Such a path has no major, is served regardless of `OpenWOP-Version`, is never a protocol operation, is never measured, and is outside §1.4.
- An org MUST NOT be named after a manifest segment under `/host/` (`reservedOrgs`).
- A host SHOULD advertise the mount under `extensions.<org>.<name>`.
- A `/v1/host/<org>/…` twin MAY ride the overlap; it retires atomically with `/v1`.

## 6. Migration rows

Rows `C5.1`–`C5.9` are `spec/v1/migrations.json` entries (`C5.2` is owned by `events.md`). The persisted-data disposition for each is `not-persisted`, except `C5.1` (legacy-stamped) and `C5.7` (never-upgraded).

*Sources: RFC 0167, RFC 0168, RFC 0172, RFC 0176, RFC 0179, RFC 0181, RFC 0193, RFC 0219.*

# RFC 0182: `listRuns` — a portable, tenant-scoped, paginated run list under major 2

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0182                                                            |
| **Title**         | `GET /runs`: a portable run list — tenant-scoped, bound ids, cursor pagination, filters — advertised by the `runList` family |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-11                                                      |
| **Updated**       | 2026-09-11 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) under `GOVERNANCE.md` §"Sole-steward operation"; logged here, in `MAINTAINERS.md`, and in `CHANGELOG.md` 2.1.0.) · 2026-09-11 (`Active → Accepted`). **Evidence tier: tier-1 — steward-verified** (`GOVERNANCE.md` §"Acceptance evidence tiers"): the reference host (openwop-examples `cc2d181`, suite `2.1.1`) advertises `runList` (`maxPageSize` 100, `filters` `workflowId`/`status`) and its CI run 34558191209 selected 74 major-2 scenario files and passed `v2-run-list` 3/3 (263 tests, 74/74 files). Recorded honestly: suite 2.1.0 packaged the scenario without a `scenario-majors.json` row, so openwop-examples #39's 260/260 never ran it; 2.1.1 (openwop#1327) regenerated the registry and gated its drift, and only the 2.1.1 run counts as evidence. |
| **Affects**       | `api/v2/openapi.yaml` (`listRuns`), `spec/v2/path-manifest.json`, `schemas/v2/run-list-response.schema.json` (new), `spec/v2/declaration.json` (family `runList`), `spec/v2/facets/runList.schema.json` (new), `spec/v2/core/runs.md` §Surface + §List, `spec/v2/core/capabilities.md` § runList, conformance `v2-run-list` |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1): one new optional operation gated on a new family; no existing field, MUST, error code or v1 surface changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

v2 has no way to enumerate runs: `createRun` returns an id and `getRun` reads one, and every UI in the field has grown a proprietary list. This RFC adds `GET /runs` (`listRuns`) as an OPTIONAL major-2 operation advertised by a new core family `runList`: tenant-scoped by construction, every id in the body tenant-bound, cursor-paginated with a host-advertised page ceiling, and filterable by `workflowId` and `status`. The response reuses `RunSnapshot`; no new id kind and no new shape beyond the envelope.

## Motivation

The question came in as "should `GET /runs` join the manifest before December" and was found, on measurement, to be misfiled: `GET /runs` was never a v1 protocol operation (the v1 OpenAPI carries only `createRun` and `getRun` on those paths), so it is a host extension at a protocol-shaped path — and after `versioning.md` §1.4 (2.0.12) a JSON list at `GET /runs` is an unnamed method on a manifest-named path that MUST NOT be `application/json`. The host in question moves its list under `/host/<org>/` (RFC 0181) and nothing breaks. What remains is the interop gap: a client that speaks the protocol to two hosts has two list addresses, two envelopes, two pagination schemes. A run list is the most-used read after the snapshot, and the corpus has everything it needs to define one portably — tenant-bound ids (`identity.md` §5), the snapshot shape, the family registry.

## Proposal

**§A.1 Operation.** `GET /runs` (`listRuns`, scope `runs:read`) with optional query parameters `limit` (integer ≥ 1), `cursor` (opaque string from a previous response), `workflowId` (the `workflowId` grammar), `status` (a `RunSnapshot.status` value). Response `200` is `run-list-response.schema.json`: `{ runs: RunSnapshot[], nextCursor?: string }`. Absent `nextCursor` means the page is the last one.

**§A.2 Tenant scoping.** The list MUST contain only runs whose tenant-bound `runId` tenant segment is the caller's; every `runId` in the body MUST be bound (`identity.md` §5 — the affordance for bare ids on a request path does not extend to documents). A run created by the caller MUST appear in the unfiltered list within the host's ordinary read consistency.

**§A.3 Pagination.** A host MUST honour `limit` up to the `runList.maxPageSize` facet and MAY clamp above it; it MUST NOT return more than `maxPageSize` rows. `cursor` is opaque; a host MUST refuse a cursor it did not mint with `400 validation_error`. Ordering is by creation time, newest first, unless the host advertises otherwise in a future facet.

**§A.4 Filters.** `workflowId` and `status` are exact-match filters; an unadvertised filter name is ignored, not refused, so the list stays usable across hosts with different facet sets.

**§A.5 Advertisement.** The family record `runList` (capability record shape, `capabilities.md` §2) carries facets `maxPageSize` (integer ≥ 1, required) and `filters` (array of `"workflowId" | "status"`). A host that does not advertise `runList` has no obligation; `GET /runs` then answers `404 not_found` like every other unadvertised operation (`runs.md` §Surface).

Positive example: `GET /runs?limit=2&workflowId=conformance-noop` → `200 { runs: [<two RunSnapshots, both runId "tenant/…", both workflowId conformance-noop>], nextCursor: "…" }`. Negative examples: a body carrying a bare `runId` (fails `run-snapshot.schema.json`); `GET /runs?cursor=garbage` → `400 validation_error`; a page longer than `maxPageSize`.

## Compatibility

`additive`. v1 is untouched (it never had the operation). A v2 host that does not advertise `runList` is unaffected; the suite records the scenario `inapplicable`. The response reuses `RunSnapshot`, so no consumer needs a new type beyond the envelope.

## Conformance

New scenario `v2-run-list` (target major 2, gated on `runList`): creates two runs from the `conformance-noop` fixture, lists with `limit` = the advertised `maxPageSize` (walking `nextCursor` up to a bound), validates the body against `run-list-response.schema.json`, asserts both created ids are present, asserts every `runId` carries the caller's tenant segment (the segment of the ids the host just minted for it), and, when `filters` names `workflowId`, asserts the filtered list contains only `conformance-noop` runs. A malformed cursor MUST be `400 validation_error`.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.2 a created run appears; every id bound to the caller's tenant | the list body | the suite, unaided (create, then list) | witnessable — unaided |
| §A.2 another tenant's run appears | a `runId` whose tenant segment is not the caller's | a host defect; the suite has one credential | witnessable in the negative only — every id is checked against the caller's segment; a foreign run cannot be planted |
| §A.3 page ceiling; foreign cursor refused | row count; `400 validation_error` on a garbage cursor | the suite, unaided | witnessable — unaided |
| §A.4 filter exactness | a `workflowId` filter returning only that workflow | the suite, unaided (when advertised) | witnessable — gated on the `filters` facet |
| §A.5 unadvertised → 404 | `GET /runs` on a host without `runList` | any host | witnessable — unaided |

## Alternatives considered

1. **Leave listing to hosts (RFC 0181 vendor paths).** Works, and is the fallback for a host that never advertises `runList`; but every protocol client keeps N list adapters. The family gate makes this RFC strictly additive over that state.
2. **A summary row shape instead of `RunSnapshot`.** Smaller pages; a second shape to keep in parity across three SDKs and every host. Rejected for 2.1; a `fields` projection facet can come later without breaking the envelope.
3. **Make `listRuns` a floor of `openwop-core-standard`.** Would turn every certified host red on the day it lands. Rejected; families are opt-in and floors are stable.
4. **Filter by `since`/`until`.** Deferred; time filters need an ordering guarantee this RFC does not yet make normative.

## Unresolved questions

1. Whether ordering (newest first) should be a MUST or an advertised facet. Left as SHOULD-by-default until a second host needs otherwise.
2. A `fields` projection facet for lighter pages (alternative 2).

## Implementation notes (non-normative)

The reference host implements the list over its run store keyed by tenant; page size 100. openwop-app's existing list moves under `/host/openwop-app/` first (RFC 0181) and can then also mount `GET /runs` when it advertises `runList`. The 2.x SDKs gain `runs.list({ limit, cursor, workflowId, status })` in the same minor.

## Acceptance criteria

- [x] `Draft → Active`: OpenAPI operation + manifest row, `run-list-response` schema, `runList` family + facets, `runs.md` prose, `v2-run-list` scenario, CHANGELOG 2.1.0. (This PR.)
- [x] `Active → Accepted`: the reference host advertises `runList` and passes `v2-run-list` (tier-1), or a tier-2 host does. (openwop-examples `cc2d181`, run 34558191209, suite 2.1.1: 74 files selected, `v2-run-list` 3/3.)

## References

- `runs.md` §Surface, §Snapshot; `identity.md` §5; `capabilities.md` §2, §3.2; `versioning.md` §1.4; RFC 0181 §Unresolved-1 (why this is not a vendor path question); RFC 0169 §B (declaration file).
- Steward bus 2026-09-11: `cc6c` (the correction that reframed the question).

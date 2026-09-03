# RFC 0179: Root `preferredVersion` — the v1.x additive half of protocol-major negotiation

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0179                                                            |
| **Title**         | Root `preferredVersion` (optional in v1.x): the `<major>.<minor>` a host serves to a header-less request, which MUST be a member of `protocolVersions[]` and equal `protocolVersion` while the host serves one major — the field RFC 0172 §A.1 requires at v2 and said would be "filed separately" so hosts can advertise it before the cut; the 2.0.0 suite's `--target-major` default reads it |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`.) · 2026-09-03 (filed; v2 charter Phase 3, P3-A — the /architect pass on the Phase 3 plan found the suite defaulting on a field no v1 host could advertise) |
| **Affects**       | `schemas/capabilities.schema.json` (root `preferredVersion`, optional, RFC 0165 §A grammar), `spec/v1/capabilities.md` §"Document-root layout" (one row), suite `1.162.0 → 1.163.0` (packed content) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.1): one optional root field; no existing field, MUST, or error changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0172 §A.1 makes `preferredVersion` a required v2 root field and its §A.3 makes it the header-less default for major negotiation; RFC 0176 §C.1 keys the well-known representation on it; RFC 0168 §D.3 defaults the suite's `--target-major` from it. RFC 0172 §Compatibility said the v1.x additive half "is filed separately" and nothing filed it. This RFC is that half.

## Motivation

`schemas/capabilities.schema.json` carries `preferredVersion` only under `a2a` and `mcp` (`:2898`, `:3390`); no v1 host can advertise the root field; a dual-advertising host through the overlap would have `protocolVersions: ["1.11", "2.0"]` and no way to say which it serves without a header.

## Proposal

**§A.1** `preferredVersion` (string, RFC 0165 §A grammar `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`) is an OPTIONAL root field in v1.x. When present it MUST be a member of `protocolVersions[]` (when that is present) and, on a host serving a single major, MUST equal `protocolVersion`. **§A.2** A v1 consumer ignores it. A v2 consumer (suite 2.0.0) reads it as the header-less default; absent, the consumer's default is `max(protocolVersions[])`, else `protocolVersion`. **§A.3** The A2A precedent (`a2a-integration.md:349`, the `preferredVersion` card served without an `A2A-Version` header) is the model.

## Compatibility

`additive`. The v1 suite adds no assertion; the schema accepts documents with or without the field.

## Conformance

Suite 1.163.0: schema acceptance only (`spec-corpus-validity` compiles the field). Suite 2.0.0: `dual-stack-negotiation` (RFC 0172) reads it.

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 member of `protocolVersions[]`; equals `protocolVersion` on a single-major host | discovery document | the suite, unaided (2.0.0 `dual-stack-negotiation`) | witnessable — unaided |

## Alternatives considered

1. Default `--target-major` from `max(protocolVersions[])` only. Kept as the fallback; a host that serves two majors and prefers the older one cannot say so without the field.

## Unresolved questions

None.

## Acceptance criteria

- [x] `Draft → Active`: schema field; capabilities.md row; suite 1.163.0. (This PR.)
- [ ] `Active → Accepted`: openwop-app advertises it (Phase 4 leg) and the 2.0.0 `dual-stack-negotiation` scenario reads it.

## References

- RFC 0165 §A; RFC 0172 §A.1/§A.3/§Compatibility; RFC 0176 §C.1; RFC 0168 §D.3; `spec/v1/a2a-integration.md:349`

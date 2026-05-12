# RFC 0011: Auth-Scoped Discovery Advertisement

| Field | Value |
|---|---|
| **RFC** | 0011 |
| **Title** | Auth-Scoped Discovery Advertisement |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-12 |
| **Updated** | 2026-05-12 (Active → Accepted: all 5 acceptance-criteria items satisfied — `capabilities.discovery.authScoped` block landed in `schemas/capabilities.schema.json`, the 3-subtest auth-scoped behavior probe in `conformance/src/scenarios/discovery.test.ts` passes per RFC 0011 §B (capability shape + required-field preservation in authenticated view always; authorization-oracle probe gated on `OPENWOP_TEST_UNAUTHORIZED_API_KEY`), `conformance/coverage.md` §"Discovery and capability handshake" references the new subtest and the capability-gated table lists `openwop-discovery-auth-scoped`, SQLite reference host implements same-endpoint mode end-to-end per `INTEROP-MATRIX.md` (tenant2 principal sees STRICT subset of primary's view; `orchestrator` + `dispatch` blocks omitted), and CHANGELOG records the Active landing. The three unresolved questions remain open as documented and may be revisited as additive sub-RFCs without breaking v1 wire compatibility.) |
| **Affects** | `spec/v1/capabilities-change-detection.md`, `schemas/capabilities.schema.json`, `conformance/src/scenarios/discovery.test.ts` (additive subtest), `conformance/coverage.md` |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Formalize the optional auth-scoped discovery surface from `spec/v1/capabilities-change-detection.md` §"Scoped capability views" into an advertisable capability flag (`capabilities.discovery.authScoped.supported`) so the conformance suite can gate scenarios on host advertisement rather than probing every host blindly. Add a new conformance subtest under `discovery.test.ts` that exercises the auth-scoped variant when advertised and verifies the §"Scoped capability views" normative requirements (authenticated view satisfies the base schema; no capabilities outside the caller's authorization). Pure additive — no v1 wire-shape change.

## Motivation

`capabilities-change-detection.md` §"Scoped capability views" (FINAL v1 since 2026-05-10) normates the response shape for auth-scoped discovery: hosts MAY expose authenticated discovery views, those views MUST still satisfy `capabilities.schema.json`, and scoped discovery MUST NOT become an authorization oracle. The annex §"Conformance expectations" line 105 explicitly calls out:

> "Auth-scoped discovery, when advertised, returns a valid capability shape and does not expose capabilities outside the caller's authorization."

Today, neither the schema nor the conformance suite has a corresponding hook:
- Hosts that implement auth-scoped discovery have no formal capability flag to advertise it on. `extensions.*` works informally but is not discoverable by tools.
- The conformance scenario `discovery.test.ts` exercises only the public (unauthenticated) endpoint. There is no subtest that hits the authenticated variant.
- A reviewer auditing whether a given host's auth-scoped advertisement satisfies the §"Scoped capability views" requirements has no mechanical check to point at.

The `ROADMAP.md` v1.X protocol gap closure queue (Track 2 — Capability handshake hardening) lists "next add auth-scoped discovery variants when a host advertises them" as the open work. This RFC closes that line item.

## Proposal

### §A Capability shape

Add a top-level `discovery` block to `capabilities.schema.json`. Optional in v1; absence means the host doesn't claim auth-scoped discovery support beyond the baseline public payload.

Schema diff (relative to `schemas/capabilities.schema.json`):

```diff
   "properties": {
     ...
     "auth": { ... },          // RFC 0010
+    "discovery": {
+      "type": "object",
+      "description": "Discovery advertisement (capabilities-change-detection.md). Optional in v1; absence means the host serves only the public unauthenticated payload at /.well-known/openwop. Landed by RFC 0011.",
+      "properties": {
+        "authScoped": {
+          "type": "object",
+          "description": "Auth-scoped discovery advertisement (capabilities-change-detection.md §\"Scoped capability views\"). Hosts that return a different payload when called with Authorization than when called anonymously declare it here.",
+          "properties": {
+            "supported": {
+              "type": "boolean",
+              "description": "Host returns an authenticated/tenant-scoped capability view when the discovery endpoint is called with valid bearer credentials. The view MUST still satisfy capabilities.schema.json per the spec annex §\"Scoped capability views\"."
+            },
+            "mode": {
+              "type": "string",
+              "enum": ["same-endpoint", "extension-endpoint"],
+              "description": "How the host exposes the auth-scoped view. `same-endpoint`: the canonical /.well-known/openwop returns a narrowed/enriched view when authenticated. `extension-endpoint`: a separate host route (e.g., /v1/capabilities) carries the scoped view. Hosts using the third pattern from the spec annex (documentation pointer in the public payload) MAY omit this field."
+            },
+            "endpointPath": {
+              "type": "string",
+              "description": "When `mode: \"extension-endpoint\"` is advertised, the path the host serves the scoped view from. The conformance scenario hits this path with bearer credentials."
+            }
+          },
+          "additionalProperties": false
+        }
+      },
+      "additionalProperties": false
+    }
   }
```

Positive example (host with same-endpoint auth-scoped discovery):

```json
"discovery": {
  "authScoped": { "supported": true, "mode": "same-endpoint" }
}
```

Positive example (host with separate `/v1/capabilities` endpoint):

```json
"discovery": {
  "authScoped": { "supported": true, "mode": "extension-endpoint", "endpointPath": "/v1/capabilities" }
}
```

Negative example: in-memory reference host has no tenants, no auth-scoped view; the `discovery` block is absent entirely. Scenario skips with `behaviorGate('openwop-discovery-auth-scoped', false)`.

### §B Conformance subtest — additive in `discovery.test.ts`

Extend `conformance/src/scenarios/discovery.test.ts` with a new `describe()` block:

- **Gating:** `behaviorGate('openwop-discovery-auth-scoped', capabilities.discovery?.authScoped?.supported === true)`.
- **Path resolution:**
  - `mode: "same-endpoint"` → hit `/.well-known/openwop` with `Authorization: Bearer <key>`.
  - `mode: "extension-endpoint"` → hit `discovery.authScoped.endpointPath` with bearer; reject the scenario as a capability-shape violation when `endpointPath` is unset.
- **Assertions:**
  1. Authenticated response status is 200.
  2. Response body validates against `capabilities.schema.json` (the test uses the same in-suite Ajv compile as `spec-corpus-validity.test.ts`).
  3. Required fields per `capabilities.md` §3 (`protocolVersion`, `supportedEnvelopes`, `schemaVersions`, `limits`) are present.
  4. Public-payload required fields are not REMOVED from the authenticated view (additive-only narrowing is acceptable; required-field omission is not).
  5. **Authorization-oracle probe**: when the scenario is run with `OPENWOP_TEST_UNAUTHORIZED_API_KEY` (an operator-supplied API key for a tenant with strictly-fewer capabilities than the primary), the response under that key MUST NOT include any optional capability that the primary key's response also lacks. This is the "no capabilities outside the caller's authorization" assertion from line 69 of the spec annex.

### §C No new endpoint normation

This RFC does NOT normate a specific endpoint path or grant flow for auth-scoped discovery. `capabilities-change-detection.md` §"Scoped capability views" already lists three valid patterns; this RFC adds an advertisement mechanism for two of them (`same-endpoint`, `extension-endpoint`). Hosts using the third pattern (documentation pointer) MAY still advertise `discovery.authScoped.supported: true` without `mode` or `endpointPath`; the conformance scenario then asserts only the capability-shape, not the live-fetch behavior.

### §D Coverage table

`conformance/coverage.md` "Discovery and capability handshake" row gains the new subtest reference. The capability-gated table gains an `openwop-discovery-auth-scoped` row alongside the existing rows.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1:

- New `capabilities.discovery` block is optional; absence preserves v1.0 behavior.
- Sub-block `authScoped` has `supported: boolean` (no required fields).
- New conformance subtest is capability-gated; v1.0 hosts that don't advertise the block skip cleanly.
- No new error codes; no endpoint contract changes (auth-scoped behavior is already normated in `capabilities-change-detection.md`).
- `additionalProperties: false` preserved on both the parent `discovery` block and the nested `authScoped` block.

## Conformance

Existing scenario that covers this surface (partially): `discovery.test.ts` (public path only).

New subtest required by this RFC:

1. `conformance/src/scenarios/discovery.test.ts` — adds a new `describe('discovery: auth-scoped view', ...)` block per §B.

No new fixture required — the scenario uses the host's discovery endpoint directly.

## Alternatives considered

1. **Skip the capability flag; have the scenario probe by sending bearer credentials to every host.** Rejected: probing introduces auth side-effects (rate limits, audit-log spam, possibly account lockout on misconfigured hosts) for hosts that don't implement scoped discovery. The capability flag opt-in is the safe default.

2. **Normate a specific endpoint path (e.g., `/v1/capabilities`).** Rejected: `capabilities-change-detection.md` already allows three patterns; collapsing to one breaks hosts that have already implemented the other two. The `mode` enum is the compromise — discoverable without prescriptive.

3. **Fold the advertisement under `capabilities.extensions.*` per the existing convention.** Rejected: `extensions.*` is the catch-all for unschema'd metadata. Auth-scoped discovery is a stable enough surface (FINAL v1 since 2026-05-10) to deserve formal schema treatment, matching the `production` / `auth` precedents.

4. **Do nothing.** Rejected: `ROADMAP.md` Track 2 lists this as the remaining gap and the §"Conformance expectations" line in `capabilities-change-detection.md` explicitly calls out the missing scenario.

## Unresolved questions

1. **`endpointPath` syntax — absolute vs. relative.** Current draft is relative (e.g., `/v1/capabilities`). Should the schema enforce a leading slash? Hosts that publish a fully-qualified URL (`https://...`) would fail the implicit shape. Tentatively: require leading slash; reject absolute URLs at the schema level. Worth confirmation.

2. **Authorization-oracle probe granularity.** §B assertion 5 compares two responses (primary key + unauthorized key). What counts as "an optional capability the primary key also lacks"? The scenario draft uses a simple set comparison on `capabilities.*` keys. A future refinement could compare specific advertised values (e.g., `oauth2.audience` differing between primary and unauthorized). Out of scope for this RFC.

3. **Caching headers on auth-scoped responses.** `capabilities-change-detection.md` §"Cache validators" doesn't distinguish auth-scoped from public for caching. Hosts MAY return different `Cache-Control` headers on the authenticated variant. The conformance scenario doesn't currently assert anything about caching of the auth-scoped response. Optional follow-up sub-RFC if a real-world host trips on this.

## Implementation notes (non-normative)

- Suite version bump: `@openwop/openwop-conformance` `1.X.0` (continuing the RFC 0009/0010 cadence).
- No SDK changes required — the wire shapes are server-advertised; the SDK already exposes the discovery payload through `OpenwopClient.getCapabilities()`.
- Reference-host implementation is **optional** in the same wave. The in-memory and SQLite hosts have no tenant model and would not naturally advertise this profile. The Postgres host has tenant infrastructure via session-level keys but doesn't currently emit a scoped view; that's a future implementation step.

## Acceptance criteria

- [ ] `RFCS/0011-auth-scoped-discovery.md` merged at `Status: Active` after the 7-day comment window (or waived per bootstrap-phase rule).
- [ ] `schemas/capabilities.schema.json` includes the `discovery` block per §A.
- [ ] `conformance/src/scenarios/discovery.test.ts` includes the auth-scoped subtest per §B.
- [ ] `conformance/coverage.md` "Discovery and capability handshake" row references the new subtest; capability-gated table includes `openwop-discovery-auth-scoped`.
- [ ] `CHANGELOG.md` entry under the relevant version.

## References

- `spec/v1/capabilities-change-detection.md` §"Scoped capability views" — the prose this RFC mechanizes.
- `spec/v1/capabilities.md` §3 — required fields in the base capability payload.
- `RFCS/0009-production-profile-conformance.md` + `RFCS/0010-auth-profile-conformance.md` — same-pattern precedents (capability shape + conformance scenario + behavior-mode gate).
- `ROADMAP.md` v1.X protocol gap closure queue, Track 2 — the planning context.

# RFC 0153: MCP 2026-07-28 Versioned Composition

| Field | Value |
| --- | --- |
| **RFC** | 0153 |
| **Title** | MCP 2026-07-28 Versioned Composition |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** RFC text and its gap/risk registers. **Carried forward, not closed:** the MCP 2026-07-28 profile, callback-to-MRTR migration, and validation against a real upstream peer.) |
| **Affects** | `spec/v1/mcp-integration.md`, `schemas/capabilities.schema.json`, MCP projection schemas, fake and real peer harnesses, RFC 0020, `INTEROP-MATRIX.md` |
| **Compatibility** | `additive` current profile with legacy 2025-06-18 deprecation |
| **Supersedes** | Unqualified MCP support and 2025-06-18 as the current composition profile |
| **Superseded by** | — |

## Summary

This RFC defines an exact `mcp-2026-07-28` OpenWOP composition profile for MCP's stateless, self-describing request model, discovery, routing headers, MRTR, cacheable lists, extensions, and current authorization behavior. Existing initialization/session/callback integration remains temporarily available as `mcp-2025-06-18-legacy`; hosts must advertise exact versions and may not claim generic current MCP support.

## Motivation

OpenWOP normatively targets MCP 2025-06-18 and tests `initialize`, sampling callbacks, and elicitation callbacks. MCP 2026-07-28 retired initialization/sessions for the core model and introduced `server/discover`, request routing headers, MRTR, cacheable ordered lists, extensions, and auth hardening. The current OpenWOP capability cannot distinguish these incompatible profiles.

## Proposal

### §A — Discovery

```diff
 "mcp": {
   "supported": true,
+  "protocolVersions": ["2026-07-28", "2025-06-18"],
+  "preferredVersion": "2026-07-28",
+  "profiles": ["mcp-2026-07-28", "mcp-2025-06-18-legacy"],
+  "features": ["server-discover", "mrtr", "cacheable-lists", "extensions"]
 }
```

Versions use MCP's date form exactly. Preferred version **MUST** be supported. Unqualified `supported:true` is deprecated and cannot substantiate current-MCP claims.

### §B — Stateless routing and discovery

The current profile **MUST NOT** require `initialize` or session state for a core request. Each request **MUST** carry the MCP-required self-description and version/routing metadata. OpenWOP clients and servers **MUST** implement `server/discover` and the current `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` header semantics as defined upstream. Header values **MUST** agree with the request body; disagreement fails closed.

### §C — MRTR and callback replacement

OpenWOP's legacy `sampling/createMessage` and `elicitation/create` bridges **MUST NOT** be projected as current-profile continuously open callbacks. Current-profile remote work uses MCP's MRTR mechanism. The mapping **MUST** define durable request identity, timeout, cancellation, retry, interrupt/HITL composition, and replay-recorded outcomes. A current-profile host **MUST NOT** silently fall back to legacy callbacks.

### §D — Cacheable lists and extensions

Ordered list responses **MUST** preserve upstream ordering and cache validators. Cache keys **MUST** include authenticated tenant/principal scope and authorization-relevant discovery context. MCP extensions remain opaque unless OpenWOP defines a named mapping; an extension **MUST NOT** gain tool authority or secret reach merely by appearing in `_meta`.

### §E — Authorization and tenant binding

MCP authentication identifies a peer; every tool/resource/prompt request **MUST** pass OpenWOP authorization, tenant, workspace, audience, and policy evaluation. An anonymous MCP principal **MUST NOT** be the production default for an advertised current profile. Tool arguments and returned content remain untrusted; MCP content **MUST NOT** advance approval gates.

Add invariants `mcp-version-no-silent-downgrade`, `mcp-header-body-consistent`, `mcp-cache-tenant-scoped`, `mcp-extension-no-authority`, and `mcp-peer-no-authority-escalation`.

## Compatibility

Additive exact-version profile. Legacy 2025-06-18 MAY coexist for a proposed 12 months after current-profile acceptance. Existing legacy callbacks continue only under the legacy profile. Removing legacy is v2 unless a separately reviewed upstream security issue justifies the safety-fix path. SDKs warn when consuming unqualified MCP discovery.

## Conformance

New scenarios:

- `mcp-2026-07-28-discover.test.ts`;
- `mcp-stateless-request.test.ts`;
- `mcp-routing-headers.test.ts`;
- `mcp-mrtr-roundtrip.test.ts`;
- `mcp-cache-tenant-scope.test.ts`;
- `mcp-extension-opacity.test.ts`;
- `mcp-version-downgrade.test.ts`; and
- `mcp-current-auth-boundary.test.ts`.

Acceptance requires a pinned real MCP 2026-07-28 peer plus fake-peer negative controls. Exact profile advertisement makes all mandatory legs non-vacuous under strict certification. Legacy tests remain separately labeled.

## Alternatives considered

1. Mutate RFC 0020 in place. Rejected: legacy and current behavior need explicit coexistence.
2. Continue session initialization as an OpenWOP extension. Rejected for the current profile; it misrepresents upstream core behavior.
3. Map MRTR onto old callbacks internally but advertise current. Rejected unless wire behavior is indistinguishable and tests prove it; silent fallback is forbidden.
4. Do nothing. Rejected: current MCP peers cannot rely on the advertised contract.

## Unresolved questions

1. Exact legacy adopter population and deprecation date.
2. Which official MCP implementation becomes the real-peer fixture?
3. Complete MRTR-to-run/interrupt mapping and timeout ownership.
4. Which extension identifiers receive first-class OpenWOP mappings?
5. Cache validator behavior when authorization scope changes.

## Implementation notes (non-normative)

Keep upstream types generated or vendored once with provenance, not copied across hosts. Resolve MRTR identity through RFC 0150 and authorization through RFC 0154. This RFC is SR-6 under RFC 0147.

## Acceptance criteria

- [ ] Current profile, discovery schema, and complete mapping land. (Discovery schema landed — date-form `protocolVersions`, `preferredVersion`, `profiles`, and a closed `features` list on the `mcp` family, with `versioned-composition-profiles.test.ts`. **Shape only.** Carried: the profile itself and the mapping.) (Formerly: nothing had landed. The RFC text is the only specification of this surface; no schema, no spec prose, no conformance. Status is `Accepted` per the corpus's own bar, which RFC 0147 §A.10 forbids citing as evidence the gap is closed.)
- [ ] Stateless discovery, headers, MRTR, caching, extensions, downgrade, and auth tests pass. (Carried — depends on the profile above.)
- [ ] Pinned real MCP current peer passes in CI. (Carried, and externally gated: it needs a pinned upstream MCP peer at the current revision.)
- [ ] Legacy profile and migration/deprecation runbook publish. (Carried — same shape as RFC 0152: the legacy revision the corpus handles today is neither named nor time-bounded.)
- [ ] Threat models, invariants, SDKs, interop matrix, and CHANGELOG update. (Carried with the profile above.)

## References

- RFC 0020 and RFC 0147 Workstream 5
- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- `spec/v1/mcp-integration.md`


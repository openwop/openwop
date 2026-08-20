# RFC 0153: MCP 2026-07-28 Versioned Composition

| Field | Value |
| --- | --- |
| **RFC** | 0153 |
| **Title** | MCP 2026-07-28 Versioned Composition |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-16 later (S16, suite 1.113.0: dual-era `McpFakeServer` at 2026-07-28 incl. See [Amendment record](#amendment-record). |
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

1. Exact legacy adopter population and ~~deprecation date~~. **Date resolved 2026-08-16:** 2027-08-12 (`mcp-integration.md` §A). Population unknown (G1).
2. Which official MCP implementation becomes the real-peer fixture?
3. ~~Complete MRTR-to-run/interrupt mapping and timeout ownership.~~ **Resolved 2026-08-16:** `mcp-integration.md` §C — client and server tables; the OpenWOP node owns the timeout (node timeout / RFC 0058), the server owes nothing to a pending request; the retry chain is one RFC 0150 §B logical invocation; `requestState` is opaque to the client and HMAC-bound (principal, TTL, request digest, `runId`, interrupt token) by the server; replay never re-issues the retry.
4. ~~Which extension identifiers receive first-class OpenWOP mappings?~~ **Resolved 2026-08-16: none first-class.** OTel `_meta` keys and `io.modelcontextprotocol/logLevel` are the only named mappings; `io.modelcontextprotocol/tasks` is deliberately unmapped (RFC 0100 owns durable interop). Promote only on evidence (`mcp-integration.md` §D, gap G5).
5. ~~Cache validator behavior when authorization scope changes.~~ **Resolved 2026-08-16:** a scope change makes cached `"private"` results for that principal stale regardless of `ttlMs`; `"private"` never crosses authorization contexts; keys include tenant/workspace/principal/origin/revision/discovery context (`mcp-integration.md` §D, gap G4 closed).

## Implementation notes (non-normative)

Keep upstream types generated or vendored once with provenance, not copied across hosts. Resolve MRTR identity through RFC 0150 and authorization through RFC 0154. This RFC is SR-6 under RFC 0147.

## Acceptance criteria

- [ ] Current profile, discovery schema, and complete mapping land. (Discovery schema landed — date-form `protocolVersions`, `preferredVersion`, `profiles`, and a closed `features` list on the `mcp` family, with `versioned-composition-profiles.test.ts`. **Shape only.** 2026-08-16: **the profile prose and the mapping landed** — `spec/v1/mcp-integration.md` §"MCP 2026-07-28 versioned composition" §A–§E, pinned to the upstream 2026-07-28 revision. Carried: witnessing §B's stateless rules, §C, and §D — the suite's fake server still speaks the 2025-06-18 handshake.) (Formerly: nothing had landed. The RFC text is the only specification of this surface; no schema, no spec prose, no conformance. Status is `Accepted` per the corpus's own bar, which RFC 0147 §A.10 forbids citing as evidence the gap is closed.)
- [ ] Stateless discovery, headers, MRTR, caching, extensions, downgrade, and auth tests pass. (**Header and downgrade witnesses now exist**: `mcp-version-negotiation.test.ts`, driven against `McpFakeServer` with header capture — date-form revision on the wire, negotiated revision must be advertised, unsupported revision fails through the canonical envelope. 2026-08-16 (suite 1.113.0): the fake server is dual-era and the **stateless discovery, headers, MRTR, caching, extensions, downgrade, and auth** legs all exist — `mcp-2026-07-28-discover`, `mcp-stateless-request`, `mcp-mrtr-roundtrip`, `mcp-cache-tenant-scope`, `mcp-extension-opacity`, `mcp-current-auth-boundary`, plus `mcp-version-negotiation` — gated on `mcp.profiles ∋ mcp-2026-07-28` (or the §B advert + seam blocks); `blocked` on today's hosts, witnesses when one flips. Carried: a host that claims the profile. The invoke seam is catalogued (`host-sample-test-seams.md` §23); openwop-app's live origin passes the §A legs and has NOT wired the seam, so its §B legs are `blocked` — corrected 2026-08-16 from an earlier "passes §A/§B".)
- [ ] Pinned real MCP current peer passes in CI. (Carried, and externally gated: it needs a pinned upstream MCP peer at the current revision.)
- [ ] Legacy profile and migration/deprecation runbook publish. (2026-08-16: **named and time-bounded** — `mcp-2025-06-18-legacy` is the pre-2026-08-16 body of `mcp-integration.md`; hosts SHOULD NOT advertise it after 2027-08-12 (12 months after the profile's 2026-08-12 acceptance, per §Compatibility). Carried: the migration runbook beyond §A's paragraph, and the adopter inventory (G1).)
- [ ] Threat models, invariants, SDKs, interop matrix, and CHANGELOG update. (**2026-08-16: invariants registered** — `mcp-cache-tenant-scoped`, `mcp-extension-no-authority`, `mcp-peer-no-authority-escalation`, `mcp-header-body-consistent` (both halves — the Mcp-Method/Mcp-Name half needed a new leg in `mcp-stateless-request.test.ts`) in `SECURITY/invariants.yaml`, each driven non-vacuously against the first 2026-07-28 host (openwop-app ADR 0553 P2 branch `3c2cd839a`, strict, fake server); **interop matrix** — `INTEROP-MATRIX.md` §"Versioned composition profiles" (tier-1 local boot of an unmerged branch, stated as such); **CHANGELOG** landed with each piece. Still carried: a dedicated threat-model document and the SDK half.)

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- MRTR; the six RFC-named legs landed, gated; correction: openwop-app passes §A only — no invoke seam).
- 2026-08-16 (§B/§C/§D/§E prose landed in `spec/v1/mcp-integration.md` §"MCP 2026-07-28 versioned composition" — pinned to upstream revision 2026-07-28: stateless `_meta` + `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` rules with fail-closed header/body agreement, `server/discover`, the MRTR mapping in both directions (identity, `requestState` binding, retry, timeout, cancellation, replay, interrupt composition — G2/UQ3), `CacheableResult` + tenant-scoped cache keys + scope-change staleness (G4/UQ5), extensions opaque with OTel/`logLevel` as the only named mappings and `io.modelcontextprotocol/tasks` deliberately unmapped (UQ4), the anonymous-principal production rule, `mcp-2025-06-18-legacy` named and time-bounded to 2027-08-12 (UQ1 date), seam §23 catalogued.
- Not landed: a 2026-07-28-shaped fake server, the six named scenarios, the four unregistered invariants, a real current peer, the adopter inventory.) 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers".
- **Landed:** RFC text and its gap/risk registers. **Carried forward, not closed:** the MCP 2026-07-28 profile, callback-to-MRTR migration, and validation against a real upstream peer.).

## References

- RFC 0020 and RFC 0147 Workstream 5
- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- `spec/v1/mcp-integration.md`


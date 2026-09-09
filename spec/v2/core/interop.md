# Interop

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0175.**

## Why this exists

v1 advertised a `supportedTransports` list that could only honestly say `rest`, carried two legacy embedded-protocol profiles with dated sunsets, and let an unauthenticated peer steer version negotiation with no floor, no refresh obligation, and no audit record. This document is the v2 contract for the two embedded protocols (A2A and MCP): how a host advertises them, how a version is negotiated, and what every negotiation leaves behind. Capability shapes are in capabilities.md; the peer identity is the Subject of identity.md.

## REST is the wire

REST and SSE are the wire. A host MUST NOT advertise a transport list; `supportedTransports` does not exist in `schemas/v2/capabilities.schema.json`, and a discovery document carrying it MUST fail validation. A2A and MCP are **compositions** over the wire, advertised by their own facets and nothing else.

## The facets

A host that speaks either protocol MUST advertise the corresponding facet with every required field (`spec/v2/facets/a2a.schema.json`, `spec/v2/facets/mcp.schema.json`).

| Facet field | A2A (`a2a`) | MCP (`mcp`) | Rule |
| --- | --- | --- | --- |
| Offered versions | `versions[]` (`major.minor`) | `revisions[]` (dates) | REQUIRED, at least one entry |
| Default | `preferredVersion` | `preferredVersion` | REQUIRED; served when the peer names none |
| Floor | `minimumVersion` | `minimumRevision` | REQUIRED; below it negotiation fails closed |
| Freshness | `refreshedAt` | `refreshedAt` | REQUIRED; see the refresh SLA |
| Profiles | `profiles[]` `a2a-<major.minor>` | `profiles[]` `mcp-<date>` | no `-legacy` alternative exists |
| Protocol-specific | `agentCardUrl`, `streaming`, `pushNotifications`, `durableTasks` | `features[]`, `serverUrls[]`, `serverMount.transports[]` (`stdio` \| `streamable-http`), `mrtr.maxRounds` | optional |

`mcp.serverMount.transports[]` is the MCP server's own transport enum; it is not a host transport advertisement.

## Legacy profiles are absent

The profile ids `a2a-0.3-legacy` and `mcp-2025-06-18-legacy` do not exist in v2. The `profiles[]` item patterns admit no `-legacy` suffix, and the legacy code paths (the A2A 0.3 mapping and the MCP live-callback bridges) are not part of this corpus. A host that still speaks a legacy version does so as a private, non-advertised behavior. When no `A2A-Version` header is present, a host MUST serve the agent card of `preferredVersion`.

## Negotiation is a protocol

**Authentication.** A version-negotiation exchange on either protocol MUST be authenticated: the peer identity is the caller's Subject (identity.md) or the host's own outbound identity. An unauthenticated exchange MUST NOT lower the negotiated version below `preferredVersion`.

**The floor.** A negotiation that would land below `minimumVersion` / `minimumRevision` MUST fail closed with `interop_version_unsupported` (`spec/v2/errors.json`), whether or not host policy permits an explicit downgrade above the floor.

**The audit event.** Every negotiation outcome, including the refused one, MUST emit a `negotiation.decided` event on the host's own event log:

```jsonc
{ "protocol": "a2a" | "mcp", "peer": "<origin digest>", "requested": "…",
  "negotiated": "…" | null, "outcome": "accepted" | "downgraded" | "refused", "reason": "…" }
```

The event is content-free: `peer` MUST be a digest of the peer origin, never the origin in clear. The event on the host's own log is the normative witness of the two silent-downgrade invariants (`a2a-version-no-silent-downgrade`, `mcp-version-no-silent-downgrade`); the conformance seams profile (conformance.md) drives the exchange and captures the wire leg.

**The refresh SLA.** A host MUST re-evaluate its advertised `versions[]` / `revisions[]` against the upstream registry within the window its `refreshedAt` declares, and that window MUST NOT exceed 90 days. An advertisement older than its window is non-conformant.

**Downgrade above the floor.** A host MAY accept an authenticated request for a version between the floor and `preferredVersion`; the event then reports `outcome: downgraded`.

## The MCP round ceiling

`mcp.mrtr.maxRounds` (integer, 1–16) is the advertised ceiling on multi-round tool-result rounds. A host MUST refuse an `input_required` round beyond `maxRounds` with `mcp_mrtr_rounds_exceeded` (`spec/v2/errors.json`). The v1 `requestState` requirements carry over unchanged.

## The durable-task projection

`auth-required` remains a member of the persisted A2A task state enum (`schemas/v2/a2a-task-state.schema.json`) for the reverse direction (consuming an external A2A agent). The forward projection MUST NOT emit it: v2 has no `auth` interrupt kind. Adding one is an additive v2.x RFC, not a host extension.

## gRPC

gRPC is not part of the core wire. Its document lives at `spec/v2/ext/grpc-transport/` with `witness: unwitnessable` and `adoption: none`; its requirements are SHOULDs of that extension. A host MUST NOT advertise a `grpc` capability block — an unwitnessable family is not advertisable — and `api/v2/openapi.yaml` and the AsyncAPI document are the only canonical API descriptions. The extension re-enters core only by a v2.x additive RFC that generates the proto from `spec/v2/declaration.json` and lands a suite client.

## Threat model

`SECURITY/threat-model-interop.md` is the threat model for this document: downgrade, card/runtime drift, cross-tenant lookup through a peer, artifact leakage across the boundary, the anonymous end-user actor, and negotiation replay. Its invariants are the two silent-downgrade rows plus `interop-negotiation-authenticated`, `interop-minimum-version-enforced`, and `interop-peer-no-authority-escalation` in `SECURITY/invariants.yaml`. Peer identity and authorization at the boundary are governed by security-defaults.md; a peer MUST NOT gain authority the caller's Subject does not hold.

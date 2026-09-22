# Interop

> **Status: Stable · RFC 0175.**
> **Normative home:** `a2a`, `mcp`.

## Why this exists

The v2 contract for the two embedded protocols (A2A and MCP): how a host advertises them, how a version is negotiated, and what every negotiation leaves behind. Capability shapes are in capabilities.md; the peer identity is the Subject of identity.md.

## REST is the wire

REST and SSE are the wire. A host MUST NOT advertise a transport list; `supportedTransports` does not exist in `schemas/v2/capabilities.schema.json`, and a discovery document carrying it MUST fail validation. A2A and MCP are **compositions** over the wire, advertised by their own facets and nothing else.

## The facets

A host that speaks either protocol MUST advertise the corresponding facet — `a2a` or `mcp` — with every required field (`spec/v2/facets/a2a.schema.json`, `spec/v2/facets/mcp.schema.json`).

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

## The operation mappings (RFC 0208)

`spec/v2/interop-map.json` (schema `interop-map.schema.json`) maps each profile's upstream operations, states, fields and errors to the v2 wire, pinned to an upstream release. A host advertising a profile MUST serve every row it implements as the row states, under the caller's Subject with the authorization, tenant scoping and state of the v2 operation the row names; MUST refuse a row whose `requires` facet it does not advertise with the row's error; and MUST list every feature the map requires for that profile. What the map does not name is opaque: it MUST round-trip where upstream requires it and MUST NOT become authority, a prompt segment, a tool call or a workflow variable. A patch release that re-maps a row is a map edit; patch numbers are never negotiated.

**Isolation.** On either interface, a task the caller could not read through `getRun` MUST be answered exactly as a nonexistent one, including a tenant mismatch REST refuses `403`. `ListTasks` MUST return only runs `listRuns` would return to the same Subject, whether or not `runList` is advertised. `contextId`, `tenant` and `_meta` never select a tenant, workspace or principal.

**A2A multi-turn (A2A §3.4.3).** A message carrying `taskId` without `contextId` MUST be answered with the task's `contextId`. A message whose `contextId` is not its task's MUST be refused with its binding's invalid-parameters error and MUST NOT change the run. A message to a retained terminal task MUST be refused `UnsupportedOperationError`; `TaskNotFoundError` is for unknown, purged and unreadable tasks.

## MCP tasks and cancellation (RFC 0198)

A host MAY serve the MCP Tasks extension `io.modelcontextprotocol/tasks` (revision `2026-07-28`) on its server mount. It advertises it in its `server/discover` `capabilities.extensions` and by listing `extensions` in `mcp.features[]`, and nowhere else. A host that advertises it MUST implement the extension as published and the map's `mcp.tasks` rows, and:

- MUST answer a `tools/call` that declared the extension with `CreateTaskResult` whenever the run is not terminal when the host answers, never with `InputRequiredResult`;
- MUST use the run's projected `runId` (identity.md §5) as `taskId`, with an opaque segment of at least 128 bits of entropy. A `taskId` is never a credential;
- MUST NOT append to a run's log to answer `tasks/get`.

**Cancellation.** Until the host has sent its whole response to a request that starts or continues a run, the run belongs to that request: a client disconnect on streamable HTTP, or a stdio `notifications/cancelled` naming the request, MUST cancel the run as `cancelRun` would, with `run.cancelled.reason` `mcp-request-cancelled`. Once the response is sent, a disconnect MUST NOT affect the run; a task ends through `tasks/cancel`, `cancelRun`, or its own terminal state. A host MUST NOT send `notifications/cancelled` except to end a `subscriptions/listen` stream.

## The MCP round ceiling

`mcp.mrtr.maxRounds` (integer, 1–16) is the advertised ceiling on multi-round tool-result rounds. A host MUST refuse an `input_required` round beyond `maxRounds` with `mcp_mrtr_rounds_exceeded` (`spec/v2/errors.json`). The `requestState` rules are the map's `mcp.mrtr` rows.

## The durable-task projection

`auth-required` remains a member of the persisted A2A task state enum (`schemas/v2/a2a-task-state.schema.json`) for the reverse direction (consuming an external A2A agent). The forward projection MUST NOT emit it: v2 has no `auth` interrupt kind. Adding one is an additive v2.x RFC, not a host extension.

## Per-agent cards

A host advertising `a2a.agentCards` MUST also offer the `a2a-1.0` profile and `agents.manifestRuntime`, and MUST declare `capabilities.extendedAgentCard: true` on its public card. It publishes each entry of a caller's agent inventory (`GET /agents`) as an A2A `AgentCard`, reached through the entry's `a2aTenant`: an opaque routing value `R` the host mints, stable for the agent and host version, that MUST NOT encode a tenant, workspace, or principal.

`GetExtendedAgentCard` with `tenant: R` MUST return that agent's card: `name` is the entry's `persona`, `version` its `packVersion`, `description` its `description` or else `label`; `supportedInterfaces[]` are the host card's interfaces, each carrying `tenant: R`; `capabilities` and `securitySchemes` equal the host card's; `skills[]` holds one skill per workflow the host routes to the agent for this caller. The card MUST NOT carry anything the inventory entry may not, and does not replace it: `degraded[]` and `memoryDegraded` stay on the entry.

**Non-disclosure.** A request carrying `R` MUST be authenticated and authorized as `GET /agents/{agentId}` is, before `R` is resolved. For an `R` naming an agent outside the caller's inventory, every A2A operation MUST return what it returns for an `R` the host never minted, apart from the JSON-RPC `id`. The public card at `agentCardUrl` MUST NOT list any `R`. `R` is a `tenant` value under §"The operation mappings" **Isolation**.

## gRPC

gRPC is not part of the core wire. Its document lives at `spec/v2/ext/grpc-transport/` with `witness: unwitnessable` and `adoption: none`; its requirements are SHOULDs of that extension. A host MUST NOT advertise a `grpc` capability block — an unwitnessable family is not advertisable — and `api/v2/openapi.yaml` and the AsyncAPI document are the only canonical API descriptions. The extension re-enters core only by a v2.x additive RFC that generates the proto from `spec/v2/declaration.json` and lands a suite client.

## Trace context (RFC 0207)

A host that propagates W3C Trace Context into an MCP request MUST carry it in that request's `params._meta` (unprefixed `traceparent`, and `tracestate` when present; MCP 2026-07-28 `_meta`, SEP-414) or in the HTTP `traceparent` header, and SHOULD use `_meta`, the only carrier on stdio. Into an A2A message it MUST carry it in `Message.metadata.openwop.traceparent` and `.tracestate` or in the HTTP header, and SHOULD use the metadata. A receiver prefers the in-message value, ignores a malformed one, and MUST NOT derive tenant, principal or scope from either.

## Threat model

`SECURITY/threat-model-interop.md` is the threat model for this document; its invariants are rows of `SECURITY/invariants.yaml`. Peer identity and authorization at the boundary are governed by security-defaults.md; a peer MUST NOT gain authority the caller's Subject does not hold.

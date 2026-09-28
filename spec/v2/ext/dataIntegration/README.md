# `dataIntegration` extension

> **Status: Draft.**

`dataIntegration` names typed data-source operations: fetches from configured external sources, transforms and run-scoped variables. It is a discovery-only reservation: v2 defines no portable operations or payload contract for it.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **peer-dependency id** | `dataIntegration` |
| **advertised as** | `extensions.<org>.data-integration` |
| **declared facets** | none defined |

## Contract boundary

A host MAY advertise `dataIntegration` as `extensions["<org>.data-integration"]`, where `<org>` is its registered organization ([capabilities.md §3.2](../../core/capabilities.md)). The record is organization-defined, so:

- a client MUST NOT infer portable operations, payloads, or authorization semantics from its presence;
- a pack may name `dataIntegration` as a dependency only when the host and pack share an out-of-band definition of it.

For MCP access, `ctx.mcp` ([`host-services.md`](../../core/host-services.md) §`mcp`) supersedes the v1 `ctx.dataIntegration.fetchMCP` operation and returns MCP results unaltered. Whether an organization's `dataIntegration` record keeps `fetchMCP` is that organization's decision.

## Conformance

The `claims-check` witness checks only that the discovery claim is well formed, not runtime behavior. `conformance/src/scenarios/v2-ext-family-claims.test.ts` records it under `openwop.family.dataIntegration`:

- the key `<org>.data-integration` matches `extensionsKeyPattern`, and `<org>` is registered and not reserved;
- the record is a JSON object;
- `dataIntegration` is not also a member of the discovery root.

A host that does not advertise the family records `inapplicable`. A `Stable` label on this page therefore means a host at evidence tier 2 or better advertises the reservation correctly. It does not mean two hosts interoperate on it ([`../README.md`](../README.md)).

*Sources: RFC 0144, RFC 0204.*

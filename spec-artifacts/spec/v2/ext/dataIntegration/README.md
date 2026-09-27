# `dataIntegration` extension

> **Status: Draft.**

`dataIntegration` names typed data-source operations: fetches from configured external sources, transforms and run-scoped variables. It is a discovery-only reservation: v2 defines no portable operations or payload contract for it.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `single-witness` |
| **peer-dependency id** | `dataIntegration` |
| **advertised as** | `extensions.<org>.dataIntegration` |
| **declared facets** | none defined |

## Contract boundary

A host MAY advertise `dataIntegration` under its registered organization namespace. The record is organization-defined, so:

- a client MUST NOT infer portable operations, payloads, or authorization semantics from its presence;
- a pack may name `dataIntegration` as a dependency only when the host and pack share an out-of-band definition of it.

For MCP access, `ctx.mcp` ([`host-services.md`](../../core/host-services.md) §`mcp`) supersedes the v1 `ctx.dataIntegration.fetchMCP` operation and returns MCP results unaltered. Whether an organization's `dataIntegration` record keeps `fetchMCP` is that organization's decision.

## Conformance

The `claims-check` witness checks only that the discovery claim is well formed, not runtime behavior.

*Sources: RFC 0144, RFC 0204.*

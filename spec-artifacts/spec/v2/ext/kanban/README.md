# `kanban` extension

> **Status: Draft · v2 extension.** Discovery-only reservation; no portable
> operations or payload contract is defined in v2.3.3.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `single-witness` |
| **peer-dependency id** | `kanban` |
| **advertised as** | `extensions.<org>.kanban` |
| **owning RFC** | RFC 0144 |
| **declared facets** | none defined |

## Contract boundary

A host MAY advertise this identifier under its registered organization namespace.
The extension record is organization-defined, so clients MUST NOT infer portable
operations, payloads, or authorization semantics from its presence. A pack may
name `kanban` as a dependency only when the host and pack share
an out-of-band definition of that dependency.

The v1 description, [`spec/v1/host-capabilities.md`](https://github.com/openwop/openwop/blob/v2.3.3/spec/v1/host-capabilities.md#hostkanban) (§host.kanban), is useful for migration but is not a
standalone v2 interoperability contract. A future revision can replace this
boundary with normative behavior, schemas, and a behavioral witness.

## Conformance

The current `claims-check` witness validates only that the discovery claim is
well formed. It does not demonstrate compatible runtime behavior.

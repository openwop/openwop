# `webResearch` extension

> **Status: Draft.**

`webResearch` names search, fetch and research orchestration through the host's search adapter. It is a discovery-only reservation: v2 defines no portable operations or payload contract for it.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `single-witness` |
| **peer-dependency id** | `webResearch` |
| **advertised as** | `extensions.<org>.webResearch` |
| **declared facets** | none defined |

## Contract boundary

A host MAY advertise `webResearch` under its registered organization namespace. The record is organization-defined, so:

- a client MUST NOT infer portable operations, payloads, or authorization semantics from its presence;
- a pack may name `webResearch` as a dependency only when the host and pack share an out-of-band definition of it.

## Conformance

The `claims-check` witness checks only that the discovery claim is well formed, not runtime behavior.

*Sources: RFC 0144.*

# `restTransport` extension

> **Status: Draft.**

`restTransport` names conditional GET and response compression on run reads. It is a discovery-only reservation: v2 defines no portable operations or payload contract for it.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **peer-dependency id** | `restTransport` |
| **advertised as** | `extensions.<org>.restTransport` |
| **declared facets** | `conditionalRunGet`, `contentEncodings` |

## Contract boundary

A host MAY advertise `restTransport` under its registered organization namespace. The record is organization-defined, so:

- a client MUST NOT infer portable operations, payloads, or authorization semantics from its presence;
- a pack may name `restTransport` as a dependency only when the host and pack share an out-of-band definition of it.

## Conformance

The `claims-check` witness checks only that the discovery claim is well formed, not runtime behavior.

*Sources: RFC 0115.*

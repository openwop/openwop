# `restTransport` extension

> **Status: Draft · v2 extension.** Discovery-only reservation; no portable
> operations or payload contract is defined in the current v2 corpus.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **peer-dependency id** | `restTransport` |
| **advertised as** | `extensions.<org>.restTransport` |
| **owning RFC** | RFC 0115 |
| **declared facets** | `conditionalRunGet`, `contentEncodings` |

## Contract boundary

A host MAY advertise this identifier under its registered organization namespace.
The extension record is organization-defined, so clients MUST NOT infer portable
operations, payloads, or authorization semantics from its presence. A pack may
name `restTransport` as a dependency only when the host and pack share
an out-of-band definition of that dependency.

The v1 description, [`spec/v1/capabilities.md`](https://github.com/openwop/openwop/blob/main/spec/v1/capabilities.md) (`restTransport`), is useful for migration but is not a
standalone v2 interoperability contract. A future revision can replace this
boundary with normative behavior, schemas, and a behavioral witness.

## Conformance

The current `claims-check` witness validates only that the discovery claim is
well formed. It does not demonstrate compatible runtime behavior.

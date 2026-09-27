# Portability notes

> **Status: Note.**

Notes on organization-specific portability extensions. This page is not a declared extension family: `portability` is a core family ([capabilities.md § portability](../../core/capabilities.md)).

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | `extensions.<org>.portability` |

The v2 core API defines no goals, export, or import operations. The [`export-bundle` schema](../../../../schemas/v2/export-bundle.schema.json) records the proposed bundle shape, but no portable transport or behavioral witness is defined.

- A host MAY expose an organization-specific portability extension.
- A client MUST NOT assume it is compatible with another host's extension.

*Sources: RFC 0086, RFC 0087, RFC 0168, RFC 0174.*

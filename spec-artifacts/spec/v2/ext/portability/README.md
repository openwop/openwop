# Portability notes

> **Status: Draft · non-core note.** This is not a declared extension family
> and is outside this rule.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | `extensions.<org>.portability` |
| **owning RFC** | RFC 0168 (decided in C.1 per RFC 0174 §E.2), RFC 0086/0087 (v1 text) |

The v2 core API does not define goals, export, or import operations. The
[`export-bundle` schema](../../../../schemas/v2/export-bundle.schema.json) records
the proposed bundle shape, but no portable transport or behavioral witness is
defined. A host may expose an organization-specific portability extension; a
client must not assume it is compatible with another host's extension.

The v1 background is in [`spec/v1/portability.md`](https://github.com/openwop/openwop/blob/v2.3.3/spec/v1/portability.md).

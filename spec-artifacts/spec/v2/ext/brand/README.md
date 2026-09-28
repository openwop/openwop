# `brand` extension

> **Status: Stable.**

`brand` names a host service for brand artifacts: themes and personas. It is a discovery-only reservation: v2 defines no portable operations or payload contract for it.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `stable` |
| **adoption:** | `single-witness` |
| **peer-dependency id** | `brand` |
| **advertised as** | `extensions.<org>.brand` |
| **declared facets** | none defined |

## Contract boundary

A host MAY advertise `brand` as `extensions["<org>.brand"]`, where `<org>` is its registered organization ([capabilities.md §3.2](../../core/capabilities.md)). The record is organization-defined, so:

- a client MUST NOT infer portable operations, payloads, or authorization semantics from its presence;
- a pack may name `brand` as a dependency only when the host and pack share an out-of-band definition of it.

## Conformance

The `claims-check` witness checks only that the discovery claim is well formed, not runtime behavior. `conformance/src/scenarios/v2-ext-family-claims.test.ts` records it under `openwop.family.brand`:

- the key `<org>.brand` matches `extensionsKeyPattern`, and `<org>` is registered and not reserved;
- the record is a JSON object;
- `brand` is not also a member of the discovery root.

A host that does not advertise the family records `inapplicable`. A `Stable` label on this page therefore means a host at evidence tier 2 or better advertises the reservation correctly. It does not mean two hosts interoperate on it ([`../README.md`](../README.md)).

*Sources: RFC 0144.*

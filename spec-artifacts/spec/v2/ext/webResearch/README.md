# `webResearch` extension

> **Status: Stable.**

`webResearch` names search, fetch and research orchestration through the host's search adapter. It is a discovery-only reservation: v2 defines no portable operations or payload contract for it.

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `stable` |
| **adoption:** | `multi-witness` |
| **peer-dependency id** | `webResearch` |
| **advertised as** | `extensions.<org>.web-research` |
| **declared facets** | none defined |

## Contract boundary

A host MAY advertise `webResearch` as `extensions["<org>.web-research"]`, where `<org>` is its registered organization ([capabilities.md §3.2](../../core/capabilities.md)). The record is organization-defined, so:

- a client MUST NOT infer portable operations, payloads, or authorization semantics from its presence;
- a pack may name `webResearch` as a dependency only when the host and pack share an out-of-band definition of it.

## Conformance

The `claims-check` witness checks only that the discovery claim is well formed, not runtime behavior. `conformance/src/scenarios/v2-ext-family-claims.test.ts` records it under `openwop.family.webResearch`:

- the key `<org>.web-research` matches `extensionsKeyPattern`, and `<org>` is registered and not reserved;
- the record is a JSON object;
- `webResearch` is not also a member of the discovery root.

A host that does not advertise the family records `inapplicable`. A `Stable` label on this page therefore means a host at evidence tier 2 or better advertises the reservation correctly. It does not mean two hosts interoperate on it ([`../README.md`](../README.md)).

*Sources: RFC 0144.*

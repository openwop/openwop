# Provider idempotency registry

> **Status: Draft.**

A supporting registry, not a declared family.

| Field | Value |
| --- | --- |
| **witness:** | `witnessable-gated` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not applicable |

[`registry.json`](./registry.json) lists providers known to expose a natural business-identity key. It informs the Layer-2 idempotency requirement in [`security-defaults.md`](../../core/security-defaults.md). Hosts report the chosen strategy through `GET /runs/{runId}/effects` and the `keying` field of `effect-ledger-projection.schema.json`.

*Sources: RFC 0150, RFC 0173.*

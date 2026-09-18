# Provider idempotency registry

> **Status: Draft · supporting registry.** This is not a declared extension
> family and is outside this rule.

| Field | Value |
| --- | --- |
| **witness:** | `witnessable-gated` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not a discovery family — a data registry (`registry.json`) the Layer-2 obligation reads |
| **owning RFC** | RFC 0173 §C.2, RFC 0150 G3 |

[`registry.json`](./registry.json) lists providers known to expose a natural
business-identity key. It informs the Layer-2 idempotency requirement in
[`security-defaults.md`](../../core/security-defaults.md); it does not add a
discovery family. Hosts report the chosen strategy through
`GET /runs/{runId}/effects` and the `keying` field of
`effect-ledger-projection.schema.json`.

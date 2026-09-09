# `provider-idempotency` — extension (registry)

| Field | Value |
| --- | --- |
| **witness:** | `witnessable-gated` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not a discovery family — a data registry (`registry.json`) the Layer-2 obligation reads |
| **owning RFC** | RFC 0173 §C.2, RFC 0150 G3 |

> **Status: Draft · v2.0.0-rc (2026-09-03).** `registry.json` records which providers have a natural business-identity key (RFC 0173 §C.2: business-identity keying is the core obligation; the activity recipe is the documented fallback). Rows are measured by the Phase 4 host legs. The witness is `GET /runs/{runId}/effects` (`effect-ledger-projection.schema.json` `keying`).

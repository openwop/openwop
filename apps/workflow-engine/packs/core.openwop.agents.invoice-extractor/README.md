# `core.openwop.agents.invoice-extractor`

Extracts structured fields from invoice PDFs or text. Flags arithmetic and consistency anomalies.

| Pack name | `core.openwop.agents.invoice-extractor` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `host.fs` |
| License | Apache-2.0 |

## Why this exists

Finance/ops verticals have ~8.9-month median payback per 2026 IDC data. Invoice intake is the canonical entry point — every accounting workflow starts with "what was the invoice for, who's it from, how much, when's it due."

## Anomaly flags

- `math_mismatch` — line items don't sum to subtotal, or subtotal + tax ≠ total
- `missing_required_field` — no vendor name, no total, no invoice number
- `duplicate_invoice_number` — caller-supplied prior numbers contain a match
- `suspicious_vendor` — vendor name matches a caller-supplied watchlist
- `currency_mismatch` — mixed-currency line items

## Handoff schemas

- `schemas/invoice-extractor.task.schema.json` — `{ pdfPath? OR text, knownInvoiceNumbers?, vendorWatchlist? }`
- `schemas/invoice-extractor.return.schema.json` — `{ invoice: {vendor, total, tax, lineItems, ...}, anomalies, fieldConfidence }`

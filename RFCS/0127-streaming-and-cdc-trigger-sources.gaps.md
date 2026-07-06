# RFC 0127 — Gap Register

Companion to `0127-streaming-and-cdc-trigger-sources.md`. Open questions, deferred decisions, and missing inputs beyond the in-template resolved questions. Each has an owner + a resolution path; a gap with no path is promoted to a Risk.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | Proposal §1 | **RESOLVED 2026-07-06** — full sweep: 5 schema surfaces extended in one PR (trigger-event, trigger-subscription, trigger-subscription-registration, run-event-payloads `trigger.*` payload, capabilities `sources[]` + `ingestion.externalSources[]`). SDK types carry `source` as an open string with a descriptive comment (no closed union) — no SDK lockstep required. | Schema Architect | — | — |
| G2 | Proposal §2 | **RESOLVED 2026-07-06 — premise corrected.** `metadata.triggerData` doesn't exist on the wire; the TriggerEvent envelope carries per-source sub-objects, so `op` lives in the new `ChangeEvent` $def where REQUIRED **is** schema-expressible (`"required": ["op"]`). RFC §2 amended; conformance still asserts it at the seam (belt + braces). | Schema + Conformance Architect | — | — |
| G3 | Conformance | Server-free seam for `stream`/`change` — the existing `trigger-bridge-delivery` scenario drives `ingestExternalEvent` via a host seam. Confirm the seam accepts `source:"stream"` / `source:"change"` (with `op`) without a real broker, and that the gated leg cannot soft-skip into a vacuous pass (the RFC 0100 vacuous-witness trap). | Conformance Architect | Extend the seam contract + scenario; non-vacuity bar = a real `trigger.delivery.attempted` for BOTH new sources. | Scenario authoring |
| G4 | Acceptance | Second witness — MyndHyve cannot witness honestly without operating a real broker/CDC consumer (RFC 0099 honesty rule). Architect ruling 2026-07-06: single-witness path approved (0124-G6 analog); second witness = first host operating a real streaming/CDC consumer. | Compatibility Architect | Named carry-forward at `Accepted`; INTEROP-MATRIX cells stay honest until a consumer host exists. | — (carry-forward) |
| G5 | Proposal §4 | **RESOLVED 2026-07-06** — SHOULD kept; the stability floor landed as prose in `trigger-bridge.md` §F.5: the dedup key MUST be stable across redelivery of the same broker message, however derived. | Spec Architect | — | — |

## Sweep at `Accepted` (2026-07-06)

Single-witness graduation (tier-1 reference host openwop-app rev `00411-77q`) under the bootstrap steward waiver; steward-curl-verified on the wire.

| ID | Disposition | Evidence / carry-forward home |
|---|---|---|
| G1 | **RESOLVED** | Five schema surfaces extended in lockstep (PR #835); SDK `source` is an open string (no union). |
| G2 | **RESOLVED** | `op` REQUIRED lives in the `ChangeEvent` $def (schema-enforced) + conformance op-required negative. |
| G3 | **RESOLVED** | Non-vacuity met: `trigger-stream-cdc-sources.test.ts` drove BOTH sources through `/v1/host/sample/trigger-bridge/{ingest,deliver}`, no soft-skips; steward curl confirmed. |
| G4 | **CARRIED FORWARD** | Second witness = the first host operating a real streaming/CDC consumer. Tier-2 MyndHyve lacks a broker/CDC consumer (0124-G6 analog); the openwop-app witness rides the conformance seam. Named open gap. |
| G5 | **RESOLVED** | Dedup-key SHOULD + stability floor pinned in `trigger-bridge.md` §F.5. |

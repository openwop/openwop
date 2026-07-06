# RFC 0129 — Gap register

Companion to `0129-data-residency-region-advertisement-and-honor-or-reject.md`. Open
questions, deferred decisions, and missing inputs beyond the in-template Resolved/Open
questions. Each has an owner + a resolution path; a gap with no path is promoted to a
Risk.

| ID | Anchor | Gap / disposition | Owner | Resolution path | Blocks `Accepted`? |
| --- | --- | --- | --- | --- | --- |
| G1 | Proposal §1–§2 | **RESOLVED 2026-07-06 (schema-fidelity, /architect find)**: `capabilities.schema.json` gains the `dataResidency` object; `residency` is a new `schemas/residency.schema.json` (`$id` `…/residency.schema.json`, `additionalProperties:false`, `region` required) `$ref`'d from the `POST /v1/runs` `allOf` in `api/openapi.yaml` — there is NO `run-create-request.schema.json`. RFC 0094 §A forbids a closed branch inside that allOf, so the closed shape lives in the referenced file (the composed body stays satisfiable). Both landed additively. | Schema Architect | — | — |
| G2 | Proposal §3 | **RESOLVED 2026-07-06 (convention fix, /architect find)**: `residency_unavailable` registered in `rest-endpoints.md` §Common error codes. HTTP status widened from a hard-pinned 422 to **one-of 400/404/422** — the #815 envelope-not-status convention (`capability_required`/`runner_unavailable` assert the `{code}` envelope, not a byte-identical numeric). Conformance asserts the `code` + no-run-created. | Spec + Schema Architect | — | — |
| G3 | Conformance | **Non-vacuity**: the `data-residency-*` scenarios must be capability-gated AND non-vacuous under `REQUIRE_BEHAVIOR` — a host advertising `dataResidency` that fails to reject an unadvertised region MUST fail scenario 2. | Conformance Architect | Author the three scenarios; verify scenario 2 fails a deliberately-hollow advert (the vacuous-witness guard). | Yes. |
| G4 | Acceptance | **Witness tier**: openwop-app is the tier-1 reference host (advertises `dataResidency` once an operator declares regions). A second/tier-2 witness requires a *second* host that advertises `dataResidency` and honors-or-rejects. As with 0127 G4 / 0128 G4, MyndHyve may lack a genuine multi-region deployment to witness honestly. | Compatibility Architect | Single-witness graduation under the bootstrap-steward waiver is available (0127/0128 precedent); the tier-2 witness is the first *second* residency-advertising host. Carry forward as a named gap if tier-2 is unavailable this cycle. | Named carry-forward permitted at `Accepted` (like 0127/0128 G4). |
| G5 | §4 | **Physical-residency attestation is out-of-band by design** — there is no wire evidence for the §4 SHOULD. This is intentional (the falsifiability scoping), not a gap to close on the wire; recorded so a future reader does not mistake the absence of a physical-residency conformance test for an oversight. | Spec Architect | Resolved-by-design; documented in RFC §4. | No. |

## Sweep disposition (to be completed at the `Active → Accepted` flip)

| ID | Disposition | Evidence / carry-forward home |
| --- | --- | --- |
| G1 | **RESOLVED** | `dataResidency` in capabilities.schema.json + `residency` = new residency.schema.json $ref'd from the openapi createRun allOf (no phantom run-create schema; RFC 0094 §A satisfiable). |
| G2 | **RESOLVED** | `residency_unavailable` registered (one-of 400/404/422 per #815 envelope-not-status). |
| G3 | _pending_ | `data-residency-*` scenarios, scenario 2 non-vacuous. |
| G4 | _pending_ | Single-witness (openwop-app) or tier-2 second residency host. |
| G5 | **RESOLVED (by design)** | Physical residency is a declared operator SHOULD (§4), not a wire test — the falsifiability scoping, not an open gap. |

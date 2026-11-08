# RFC 0259 — Gap register

Severity is the first word of each question: **High** blocks `Active`; **Medium** and **Low** do not.

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Proposal | **High.** Which seat records a token resolution: a new Subject `kind` in `resolvedBy`, a separate schema under an `anyOf`, or a sibling property? | Schema Architect | `closed` 2026-11-04 — independent architect review: a sibling `resolvedVia`; `subject.schema.json` untouched (§Alternatives 1–2). | `Active` |
| G2 | §Motivation | **High.** What the one known consumer needs to accept a link approval. | Spec Architect | `closed` 2026-11-04 — Book AI answered: a host-attested `boundTo` that is a full user Subject on the owner mapping; minter does not count; unbound refused; token off the record. | `Active` |
| G3 | §A.4 | **Medium.** The eligibility rule (ACL'd interrupt ⇒ `boundTo` or refuse) has no witness: the suite cannot name itself in a host's approver list. | Conformance Architect | `transferred:RFC 0259 Decided questions` 2026-11-08 — Decided 2: a seam revision once a host implements the binding. | none |
| G4 | §Open spec gaps | **Medium.** MCP `requestState` and inbound-webhook resumes have no `scheme` member. | Spec Architect | `transferred:RFC 0259 Open spec gaps` 2026-11-04 — row 1 / UQ 1. | none |
| G5 | §Conformance | **Medium.** No host implements `readInterruptToken` yet, so every host leg records `inapplicable` or `blocked` until one does. | Conformance Architect | `transferred:RFC 0259 Acceptance criteria` 2026-11-04 — the `Accepted` gate. | `Accepted` |
| G6 | §A.5 | **Low.** No dedicated fork leg for `resolvedVia`. | Conformance Architect | `transferred:RFC 0259 Conformance` 2026-11-04 — falsifiability row §A.5, planned beside `v2-approval-reject-disposition` leg 9. | none |
| G7 | §References | **Low.** The share-link prior art (Google Docs, Notion) is from the author's knowledge, not re-checked against current documentation. | Spec Architect | `transferred:RFC 0259 Decided questions` 2026-11-08 — check during implementation; it supports no normative text. | none |
| G8 | §Status | **High.** Whether the 7-day window may be waived. | Spec Architect | `closed` 2026-11-08 — waived by the maintainer directly (steward override of RFC 0147 §A.6, recorded in `MAINTAINERS.md`). | `Active` |
| G9 | §A.4 | **Medium.** Book AI's follow-up: will the host state single use, expiry, the issue window, and host-issued links only? | Spec Architect | `closed` 2026-11-04 — §A.4: host-issued links only and expiry + one vote per `boundTo` are MUSTs for a host that sets `boundTo`; `mintedAt`/`expiresAt` are optional fields with a SHOULD. | none |


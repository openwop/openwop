# RFC 0164 — Risk register

Risks identified while authoring RFC 0164. Scored Likelihood × Impact (H/M/L).

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A combined host exists that the sweep missed (advertises both profiles, no flag) → this RFC de-conforms it and should have been `safety-fix` | L | M | Low | G1 sweep at `Active` and again at `Accepted`; `version-negotiation.md` §"Combined SAML + SCIM hosts" gives the two migration paths regardless of classification | Compatibility Architect | Open (sweep clean 2026-09-02) |
| R2 | The identity-RFC no-waiver clause (RFC 0147 §A.6) is applied inconsistently — waived for 0159/0163/0164, enforced elsewhere | M | L | Low | Stated in the RFC header rather than hidden; `MAINTAINERS.md` ledger row; the waiver audit already tracks the class | Governance | Open (documented) |
| R3 | A host narrows its advertisement (§A.2) by dropping `openwop-auth-scim` while still exposing `/scim/v2` — consumers lose the discovery signal for a lane that exists | L | L | Low | Advertising is a conformance claim, not an inventory; the runbook says so; RFC 0164 UQ1 records the v2 single-profile alternative | Spec Architect | Open |
| R4 | Suite consumers pinned to the old flag gate read `executed-fail` on a combined host that previously read `inapplicable` | L | L | Low | That is the intended tightening (COMPATIBILITY §2.3 — a new scenario finding a previously untested gap); CHANGELOG names it | Conformance Architect | Open (intended) |

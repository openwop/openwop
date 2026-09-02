# RFC 0050 — Gap register

Opened 2026-09-02 (the RFC graduated without one). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Conformance | **CLOSED 2026-09-02.** The §A "synthetic-IdP reference suite" (1 positive + 6 negatives) lived inside `conformance/src/scenarios/auth-saml-profile.test.ts`, so every host bundle recorded an `executed-pass` for a block that never touched the host (conformance-certification.md gap G8; named by RFC 0163 gap G5). Moved to `conformance/src/lib/saml-idp.test.ts`, which runs in the published suite but records no scenario ledger row. The acceptance evidence this RFC cites (`conformance/src/lib/saml-idp.ts` + the MyndHyve live-ACS drive) is unchanged; `coverage.md` now grades the scenario `host-pending` on its opt-in host-ACS leg. | Conformance Architect | Suite 1.152.0 | — |

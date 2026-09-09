# RFC 0168 — Gap register

Open design gaps discovered while authoring RFC 0168 (v2 evidence and conformance; RFC 0167 child C.1). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §E.2 | Whether the bundle attestation is a bare Ed25519 envelope or an in-toto statement. | Conformance Architect | `open` — bare envelope in 2.0 with in-toto as a v2.x additive; decided when the signer lands in Phase 3 | RFC 0168 `Accepted` |
| G2 | §D.2 | `@openwop/spec-artifacts` does not exist; its publish is tag-triggered like the suite's and needs its own identity check (`check-published-suite-identity.mjs` generalized). | Steward | `open` — created in the Phase 3 packaging PR; the identity script takes a package argument | RFC 0168 `Accepted` |
| G3 | §A.1 | 23 interpolated test titles can never derive a stable id; they need explicit ids minted by hand before the lint can be total. | Conformance Architect | `open` — minted in the Phase 3 suite PR | RFC 0168 `Accepted` |
| G4 | §B.1 | 55 `unwitnessable` invariants exist; the protocol-tier subset must be given a path, demoted, or fail the gate at the cut. The count is measured, not decided, here. | Security Architect | `open` — RFC 0166's seam-eviction review per row in Phase 3 | RFC 0168 `Accepted` |

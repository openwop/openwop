# RFC 0172 — Gap register

Open design gaps discovered while authoring RFC 0172 (v2 versioning and release; RFC 0167 child C.5). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.3 | The header-less default to `preferredVersion` has no v1 precedent on the protocol surface (the A2A lane has one); witnessed only by the dual-stack scenario on a host advertising two majors. Carried from RFC 0167 G1. | Spec Architect | `open` — witness class `witnessable-gated`; the `dual-stack-negotiation` scenario in suite 2.0.0 is the witness; closes when openwop-app passes it from both majors | RFC 0172 `Accepted` |
| G2 | §C.1 | MAINTAINERS §"Major bump" step 6 edits `spec/v1/auth.md`'s status legend at the cut while RFC 0167 says the v1 tree is read-only from the cut. | Steward | `open` — the legend pointer is the one permitted v1 edit at the cut; recorded in RFC 0174 (C.7) when it restates the read-only rule | RFC 0174 `Active` |
| G3 | Unresolved Q1 | Whether `OpenWOP-Version` on requests accepts `major.minor`. | Spec Architect | `open` — integer major only unless a Phase 4 host shows a minor pin is needed; decided before `Accepted` | RFC 0172 `Accepted` |

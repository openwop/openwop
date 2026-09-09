# RFC 0173 — Gap register

Open design gaps discovered while authoring RFC 0173 (v2 security defaults; RFC 0167 child C.6). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §D.1 | RFC 0035 (Active, Parked on a non-steward fencing host) is superseded by this child's `packs` obligation at the cut; until then it stays Parked and its §B probes are the eight `sandbox-*` scenarios this RFC binds to execution. | Steward | `open` — flipped `Superseded` with a forward pointer in the Phase 3 PR under RFC 0174 §A.1 | RFC 0173 `Accepted` |
| G2 | §C.1 | The effect-seam manifest is a host self-declaration; a seam omitted from it is invisible to the suite (`negative-existence`). The RFC 0140 R5 audit class (outbound clients vs the manifest) is the only check and is not a corpus gate. | Security Architect | `open` — Phase 4 host legs each publish the audit that produced their manifest; a later independent audit (RFC 0156) is the real control | Phase 4 |
| G3 | Unresolved Q1 | `approversList` enforcement on a host with no RBAC surface (`refKinds` group or role). | Spec Architect | `open` — explicit principals bind everywhere; `group`/`role` bind only where `authorization` is advertised; confirmed in the Phase 3 obligation table | RFC 0173 `Accepted` |
| G4 | §B | Compensation and Layer 2 are core obligations *of their surfaces* with declared witnesses; either may still end in `ext/` at the cut if the witness (read projection, fixture provider) does not land. | Conformance Architect | `open` — decided at the cut by whether the two scenarios pass on openwop-app; §D.1 names both outcomes | RFC 0173 `Accepted` |
| G5 | §B | `interrupt.approverRouting` has two named advertisers in RFC 0104's header and no INTEROP-MATRIX row; `compensation.supported`'s advertiser status is recorded three ways (extensions.json, two matrix rows). | Spec Architect | `open` — extensions.json note corrected in this PR; the matrix rows are reconciled in the Phase 4 host legs | Phase 4 |

# RFC 0164 — Gap register

Open design gaps discovered while authoring RFC 0164 (mandatory SCIM ⟷ SAML subject linking for combined hosts). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Compatibility | The `additive` classification rests on an empirical fact (no production host advertises both profiles at filing). If a host is found to have advertised both without the flag before this RFC reached `Active`, the classification MUST be re-stated as `safety-fix` and the host given the §3 migration path. | Compatibility Architect | INTEROP-MATRIX + live-discovery sweep at `Active` (done 2026-09-02: MyndHyve no `auth` block; openwop-app seams-only; matrix empty); re-check at `Accepted` | — |
| G2 | §A.2 | "Lanes serve different tenant realms" is host configuration the suite cannot see; the only witnessable consequence is the narrowed advertisement. Should v2's Subject record carry the realm per lane? | Spec Architect | v2 charter (identity record) | — (v2) |
| G3 | Reference host | openwop-app must narrow its advertisement (drop one profile) when `subjectLinkRealmAlignment().aligned` is false, instead of advertising both without the flag; plus a witness that discovery never carries both profiles without `subjectLinking:true` + `subjectLinkKey`. | Reference host | openwop-app PR after `Active` (crosstalk `0164`, T-host) | `Active → Accepted` |
| G4 | UQ1 | v2: remove `subjectLinking` only, or fold the two profiles into one `openwop-auth-enterprise-identity` profile whose predicate is the combined contract? | Spec Architect | v2 charter | — (v2) |

# RFC 0170 — Gap register

Open design gaps discovered while authoring RFC 0170 (v2 identity; RFC 0167 child C.3). Keyed to the RFC; each row has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.1 | The Subject MUST on the `run.started` echo is unenforceable while `runStarted` is `additionalProperties: true` (63 of 120 payload defs open). | Spec Architect | `open` — RFC 0171 §A.4 closes every payload def; PR C lands both so neither is unwitnessable alone | RFC 0171 `Accepted` |
| G2 | §B.3 | mTLS revocation: CRL, OCSP, or short-lived certificates — which a host advertises is its choice, but no host has any today, and the corpus has no CRL/OCSP text at all. | Security Architect | `open` — the per-lane revoke seam (§Conformance) is written in Phase 3; a host with no mechanism cannot advertise `mtls` | RFC 0170 `Accepted` |
| G3 | §B.5 | DPoP availability across the three SDKs is unmeasured (RFC 0154 G2). | SDK maintainer | `open` — measured in Phase 3 and recorded on the extension record before `delegationProofs[]` may list `dpop` | RFC 0170 `Accepted` |
| G4 | §D.1 | Whether `tenantId` itself needs a grammar beyond the opaque form (host-minted vs operator-chosen). | Spec Architect | `open` — decided with `ids.schema.json` in Phase 3 | RFC 0170 `Accepted` |
| G5 | §E.2 | Eight invariants named here enter `SECURITY/invariants.yaml` only with tests (RFC 0167 §C rule); until Phase 3 they exist as falsifiability rows. | Security Architect | `open` — each row above names its witness class; an invariant with no test at the cut is demoted and recorded, never carried silently | RFC 0170 `Accepted` |
| G6 | Unresolved Q2 | Whether `keyClass` extends to `oidc` (a stable `sub` is `opaque-idp` by RFC 0163's argument). | Spec Architect | `open` — decided with the C.8 interop threat model | RFC 0175 `Active` |

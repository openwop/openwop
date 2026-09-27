# RFC 0220 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §C.2 | `a2uiSurface` has no tier-2 witness path. MyndHyve's v2 discovery drops `schemaVersions.kinds`, it serves no `POST /conformance/seams/sample/a2ui/emit-surface`, and its seams profile is off. | Conformance Architect | `transferred:myndhyve/services/workflow-runtime` — a MyndHyve change set: project `schemaVersions.kinds` into v2, serve the emit-surface seam through its production envelope admission, advertise the seams profile once its blocked rows are cleared. Then re-cut. | `a2uiSurface` `Draft → Stable` only. |
| G2 | §B | The 11 reservations have no portable contract, so their `Stable` means "advertised correctly by a tier-2 host", not interoperation. | Spec Architect | `externally-gated:cross-host-demand` — one RFC per family once a second host or an adopter asks for its operations; `chat` first (Unresolved 1). | Nothing in this RFC. |
| G3 | §D | `evidence/host-tiers.json` has no tier-3 row; the first independent host adds one. | Governance | `externally-gated:tier-3-host` — added with an independent host's first certified bundle. | Nothing. |

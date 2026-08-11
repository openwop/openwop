# RFC 0148 — Gap Register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §C | Exact canonical witness transcript is undecided. | Conformance Architect | Prototype JSON canonical transcript and signed event forms. | Active |
| G2 | §D | Historic public bundle inventory is incomplete. | Release Maintainer | Search releases, interop matrix, examples, and hosted artifacts. | Accepted |
| G3 | §C | Stable `requirementId` registry and alias policy do not exist. **Measured 2026-08-11** (`docs/REQUIREMENT-REGISTRY-FEASIBILITY.md`): 1,544 `driver.describe()` sites, 87.8% generatable from two string literals. Two blockers the gap did not anticipate — 168 sites interpolate the requirement text at run time, so **no text-derived ID can be stable for them by construction**; and citations use **six** addressing conventions for the same documents, so a text-derived ID encodes an authoring accident until addressing is normalized. | Spec Architect | Generate + accept hand-authored entries; normalize citation addressing FIRST (overlaps RFC 0149 §D); alias file makes reworded IDs a reviewable act. | Active |
| G4 | §E | Signing boundary between RFC 0148 and RFC 0154 is unsettled. | Security Architect | 0148 owns digest; 0154 decides attestations/signatures. | Accepted |
| G5 | Conformance | Vitest reporter API support for assertion-level custom events needs validation. | Conformance Architect | Spike reporter; fall back to explicit ledger calls with CI completeness check. | Active |


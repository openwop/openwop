# RFC 0235 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §D | The v2 reference host compares `If-None-Match` byte-exact on the run snapshot and member-exact on discovery, so it fails §D 1–3 once the legs ship. | Reference Implementation Architect | `externally-gated:v2-reference-if-none-match-helper` One RFC 9110 helper for both routes in `openwop-examples`, then a re-cut. | A reference-host certification on the suite that ships §D. |
| G2 | §D | No host bundle records the four `openwop.requirement.0235.*` ids, because the legs are not written yet. | Conformance Architect | `carried:openwop.gap.0235.2` The legs ship with the `Active` change; a certified major-2 bundle closes this. | `Accepted` |

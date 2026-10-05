# RFC 0235 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §D | The v2 reference host compares `If-None-Match` byte-exact on the run snapshot and member-exact on discovery, so it fails §D 1–3 once the legs ship. | Reference Implementation Architect | `closed` 2026-10-05 — one RFC 9110 helper for both routes (openwop-examples #152); the certified 2.45.18 cut (build `commit:e5f27708`) records the §D legs `executed-pass`. | A reference-host certification on the suite that ships §D. |
| G2 | §D | No host bundle records the four `openwop.requirement.0235.*` ids, because no host has cut on the suite that ships the legs (2.45.18). | Conformance Architect | `closed` 2026-10-05 — the v2 reference host's certified 2.45.18 cut records all four ids `executed-pass` (`evidence/v2-host-bundles/openwop-host-v2-reference.json`). | `Accepted` |

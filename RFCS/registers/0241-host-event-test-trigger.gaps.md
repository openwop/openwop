# RFC 0241 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §D | No host serves `POST /host/events/test` or lists the §A types, so no production host can witness RFC 0236's event-causing legs. | Reference Implementation Architect | `closed` 2026-10-08 — openwop-examples #160 serves §B and lists both §A types; its certified seams-off public cut on 2.45.28 (build `commit:bb7c5930`) causes every RFC 0236 event through it. openwop-app's adoption is tracked in TODO. | `Accepted` |
| G2 | §D | No host bundle records the six `openwop.requirement.0236.*` ids with §B as the cause. | Conformance Architect | `closed` 2026-10-08 — the v2 reference host's certified seams-off 2.45.28 cut records all six `openwop.requirement.0236.*` ids `executed-pass` (`evidence/v2-host-bundles/openwop-host-v2-reference-2.45.28-seams-off.json`). | `Accepted` |

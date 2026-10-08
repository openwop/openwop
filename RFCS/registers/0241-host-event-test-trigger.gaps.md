# RFC 0241 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §D | No host serves `POST /host/events/test` or lists the §A types, so no production host can witness RFC 0236's event-causing legs. | Reference Implementation Architect | `externally-gated:host-event-test-trigger-host` The v2 reference host serves §B with the seams profile off and cuts certified; openwop-app follows. | `Accepted` |
| G2 | §D | No host bundle records the six `openwop.requirement.0236.*` ids with §B as the cause. | Conformance Architect | `carried:openwop.gap.0241.2` The §D change ships with `Active`; a certified seams-off bundle closes this. | `Accepted` |

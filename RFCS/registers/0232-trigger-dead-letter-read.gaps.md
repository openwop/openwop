# RFC 0232 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §E | How leg 4 is scored on a host where only the read is available: split the requirement and record the state-change half `inapplicable` without a seam (a), split and move that half out of the floor (b), or keep one id (c). Unresolved question 1. | Conformance Architect | `carried:openwop.gap.0232.1` The maintainer decides before `Active`. The author leans to (a). | `Active`, and RFC 0230's production acceptance |
| G2 | §C, Falsifiability | A `stateChange` record's content-freeness cannot be witnessed on a host without seams: no wire surface causes a subscription state change. | Conformance Architect | `externally-gated:trigger-subscription-pause-surface` A later RFC adding pause and resume (Unresolved question 3) makes the state change causable. | Nothing in this RFC. |
| G3 | §B | No host serves the read, so none of the §E rows has a witness. | Reference Implementation Architect | `externally-gated:openwop-app-serves-trigger-dead-letters` openwop-app serves the read and advertises the facet, then cuts on a suite carrying the §E path. | `Accepted` |
| G4 | §D | Whether any host routes dead-lettered trigger deliveries to the RFC 0053 run sink, which §D's correction would change for it. | Compatibility Architect | `carried:openwop.gap.0232.4` Ask the two hosts that advertise `triggerBridge` during the comment window. | Nothing in this RFC. |

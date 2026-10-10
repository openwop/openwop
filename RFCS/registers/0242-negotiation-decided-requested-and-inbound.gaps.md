# RFC 0242 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §D | No host records an inbound negotiation as a host event or lists the reserved type, so B.2 and B.3 have no witness. | Reference Implementation Architect | `externally-gated:negotiation-inbound-host` The v2 reference host emits the host event from its agent-card and MCP server routes and cuts certified; openwop-app follows. | `Accepted` |
| G2 | §A.3 | No host in `INTEROP-MATRIX.md` offers a version between its floor and its preferred version, so no host can be shown to record a downgrade above the floor. | Conformance Architect | `carried:openwop.gap.0242.2` The A.3 leg records `inapplicable` until a host's `versions[]` spans floor to preferred; the same posture RFC 0175 G6 waits on. | — |

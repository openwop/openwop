# RFC 0242 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §D | No host records an inbound negotiation as a host event or lists the reserved type, so B.2 and B.3 have no witness. | Reference Implementation Architect | `closed` 2026-10-11 — openwop-examples #170 records inbound A2A and MCP negotiations as the durable host event and lists it; its certified public cut on 2.46.0 (build `commit:d16cac40`) records `openwop.requirement.0242.inbound.*` `executed-pass` (`evidence/v2-host-bundles/openwop-host-v2-reference-2.46.0.json`). openwop-app serves no inbound A2A or MCP today, so B.3 does not bind it. | `Accepted` |
| G2 | §A.3 | No host in `INTEROP-MATRIX.md` offers a version between its floor and its preferred version, so no host can be shown to record a downgrade above the floor. | Conformance Architect | `externally-gated:host-floor-below-preferred` — the tripwire RFC 0175 G6 waits on: the A.3 leg records `inapplicable` until a host's `versions[]` spans floor to preferred. | — |

# RFC 0114 — Gap Register

| ID  | Section     | Question / Missing Input                                                  | Owner                 | Resolution Path                              | Blocks          |
| --- | ----------- | ------------------------------------------------------------------------ | --------------------- | -------------------------------------------- | --------------- |
| G1 | Proposal | Negotiation channel: subscribe query param vs envelope-request handshake | Spec Architect | `carried:openwop.gap.0114.1` Decision | Active→Accepted |
| G2 | Proposal | `surfaceId` eviction / max-updates-before-forced-full | Spec Architect | `carried:openwop.gap.0114.2` Decision; default host-discretionary with SHOULD | Schema finalize |
| G3 | Proposal | Restrict RFC 6902 op set (drop `move`/`copy`) for replay safety? | Schema/Security | `carried:openwop.gap.0114.3` Decision after replay analysis | Schema finalize |
| G4 | Conformance | `a2uiSurface.deltaTransport` has one witness (openwop-app, 2026-07-06), now implemented behind an env flag and not advertised on the live host (observed 2026-09-22, INTEROP-MATRIX); no second host advertises it | Conformance Architect | `carried:openwop.gap.0114.4` Adoption-gated; tier-2 witness suffices | Accepted flip |

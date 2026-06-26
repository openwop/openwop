# RFC 0114 — Gap Register

| ID  | Section     | Question / Missing Input                                                  | Owner                 | Resolution Path                              | Blocks          |
| --- | ----------- | ------------------------------------------------------------------------ | --------------------- | -------------------------------------------- | --------------- |
| G1  | Proposal    | Negotiation channel: subscribe query param vs envelope-request handshake | Spec Architect        | Decision                                     | Active→Accepted |
| G2  | Proposal    | `surfaceId` eviction / max-updates-before-forced-full                     | Spec Architect        | Decision; default host-discretionary with SHOULD | Schema finalize |
| G3  | Proposal    | Restrict RFC 6902 op set (drop `move`/`copy`) for replay safety?          | Schema/Security       | Decision after replay analysis               | Schema finalize |
| G4  | Conformance | No host advertises `ui.a2ui-surface.deltaUpdates` yet                     | Conformance Architect | Adoption-gated; tier-2 witness suffices      | Accepted flip   |

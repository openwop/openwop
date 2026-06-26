# RFC 0115 — Gap Register

| ID  | Section     | Question / Missing Input                                              | Owner                 | Resolution Path                          | Blocks          |
| --- | ----------- | -------------------------------------------------------------------- | --------------------- | ---------------------------------------- | --------------- |
| G1  | Proposal    | Pin `ETag` derivation (latest event seq) vs host-defined             | Spec Architect        | Decision; host-defined unless cross-host predictability demanded | Active→Accepted |
| G2  | Proposal    | `zstd` in the enum from day one vs gzip-only with zstd optional       | Spec Architect        | Decision; default both, gzip mandatory if any | Schema finalize |
| G3  | Proposal    | Extend conditional GET to `/v1/runs/{runId}/artifacts` now or follow-up | Spec Architect      | Defer to follow-up RFC                   | —               |
| G4  | Conformance | No host advertises `transport.conditionalRunGet` yet                | Conformance Architect | Adoption-gated; tier-2 witness suffices  | Accepted flip   |

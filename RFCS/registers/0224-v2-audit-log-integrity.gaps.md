# RFC 0224 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Conformance | The witness is loopback only; `Accepted` needs a certified public v2 bundle from a host advertising the family. | Conformance Architect | `externally-gated:v2-reference-public-cut` — an operator-run `scripts/cut-public.sh` on a published 2.43.x contract; recorded in the RFC's second acceptance box. | `Accepted`. |
| G2 | §Unresolved questions | A dual-signing host lists a checkpoint under a key other than `checkpointPublicKey`, which the signature row fails; v2 advertises one key. | Spec Architect | `externally-gated:first-rotating-host` — a `checkpointPublicKeys[]` facet is additive and waits for a host that dual-signs; none does today. | Nothing in this RFC. |

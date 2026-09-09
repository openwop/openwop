# RFC 0178 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A removal-date gate that arms at the major fails the 2.0 cut on a surface nobody remembered to remove | M | L | Low | That is the point; MAINTAINERS §"Major bump" step 4 already requires it; the alias detectors name the surface | Steward | `accepted` |
| R2 | A generated `deprecated: true` lands on the pack-manifest `deprecated` wire field and changes its meaning | L | H | Medium | The field is renamed `versionDeprecated` (row C11.2) before the generator runs on the v2 manifest schema | Spec Architect | `mitigated` |
| R3 | Same-day witness classification of the RFC 0167 family's rows by their author repeats the RFC 0166 §C.2 honesty problem | M | M | Medium | The rows' witnesses are stated in each RFC's falsifiability table, which `check-falsifiability.mjs` parses; the classification is the table's verdict, not a heuristic | Security Architect | `mitigated` |
| R4 | `planned:` requirement ids on open v2 rows never become real | M | M | Medium | The planned count is a ratchet printed by `check-falsifiability.mjs`; suite 2.0.0 (C.1) mints the ids and the ratchet must reach zero at `Accepted` | Conformance Architect | `open` |

# RFC 0237 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §D | No host installs `conformance-nondeterminism` or lists `nondeterminismPolicy.sources`. | Reference Implementation Architect | `externally-gated:v2-reference-nondeterminism-fixture` The v2 reference host adds the fixture node and lists its sources, then re-cuts. | A reference-host certification on the suite that ships the leg. |
| G2 | §Conformance | No host bundle records the two `openwop.requirement.0237.*` ids yet; the legs shipped in suite 2.45.23. | Conformance Architect | `carried:openwop.gap.0237.2` A certified major-2 bundle closes this. | `Accepted` |
| G3 | §C | The two required booleans stay in v2 (`overview.md` §0a predicate 4). | Spec Architect | `externally-gated:next-major` Remove `nondeterminismPolicy.declared` and `envelopeContracts.advertised` at 3.0, via the deprecation row the `Active` change adds. | — |

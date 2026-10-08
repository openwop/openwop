# RFC 0237 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §D | No host installs `conformance-nondeterminism` or lists `nondeterminismPolicy.sources`. | Reference Implementation Architect | `closed` 2026-10-08 — openwop-examples #161 lists `clock`, `random` and `id` and executes the fixture node; its certified 2.45.25 cut (build `commit:a8e6db64`) records the fixture run and its replay. | A reference-host certification on the suite that ships the leg. |
| G2 | §Conformance | No host bundle records the two `openwop.requirement.0237.*` ids yet; the legs shipped in suite 2.45.23. | Conformance Architect | `closed` 2026-10-08 — the v2 reference host's certified 2.45.25 cut records both `openwop.requirement.0237.*` ids `executed-pass` (`evidence/v2-host-bundles/openwop-host-v2-reference.json`). | `Accepted` |
| G3 | §C | The two required booleans stay in v2 (`overview.md` §0a predicate 4). | Spec Architect | `externally-gated:next-major` Remove `nondeterminismPolicy.declared` and `envelopeContracts.advertised` at 3.0, via the deprecation row the `Active` change adds. | — |

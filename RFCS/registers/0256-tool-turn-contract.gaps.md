# RFC 0256 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A | Production volume of inline tool syntax is unmeasured | Reference host | `closed` 2026-10-30 — 0 detections in 30 days, control working; delete the parser | — |
| G2 | §A | Two of 13 model paths were not fully checked, and 19 pack files with `JSON.parse` are unclassified | Reference host | `transferred:TODO.md` — finish the enumeration | `Active` |
| G3 | §D | `replayPolicy` is absent from the capability resolver, so no tool declares it | Spec Architect | `transferred:TODO.md` — populate from tool descriptors; until then every write tool fails closed in doubt | `Active` |
| G4 | §D | `runToolLoop` passes no `onEvent`, so mid-loop events may not be durable (inferred) | Reference host | `transferred:TODO.md` — verify | `Active` |
| G5 | §F | Provider connector behaviour is from secondhand sources | Security Architect | `transferred:TODO.md` — read primary docs | `Active` |

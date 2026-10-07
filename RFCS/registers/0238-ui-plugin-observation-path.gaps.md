# RFC 0238 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §C | No host serves the frame document or the dispatch operation at the normative paths, so none of the §F rows has a witness. openwop-app dispatches at a vendor path and mounts frames by `srcdoc`. | Reference Implementation Architect | `closed` 2026-10-07 — openwop-app serves both operations and mounts plugins from the frame URL (#4509, #4568, ADR 0840) with the §D fixture installed; its certified 2.45.23 cut (build `commit:e33f3a19c`) records all four `openwop.requirement.0238.*` ids `executed-pass`. | `Accepted` |
| G2 | Decisions 3 | A non-iframe isolation mechanism has no HTTP-visible boundary, so `frontend-plugin-isolation` keeps a seam witness for such a host. | Conformance Architect | `externally-gated:non-iframe-ui-plugin-host` Re-open when a host advertises a non-iframe `uiPlugins.isolation`. | Nothing while no host ships one. |
| G3 | Decisions 5 | The always-on schema legs of `frontend-plugin-packs.test.ts` read only the corpus but run in a major-1 host bundle. | Conformance Architect | `closed` 2026-10-07 — moved to `src/coherence/frontend-plugin-schemas.test.ts` in suite 2.45.25 (#1937). | Nothing in this RFC. |

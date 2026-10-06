# RFC 0238 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B, §C | No host serves the frame document or the dispatch operation at the normative paths, so none of the §F rows has a witness. openwop-app dispatches at a vendor path and mounts frames by `srcdoc`. | Reference Implementation Architect | `externally-gated:openwop-app-ui-plugin-served` openwop-app serves both operations, mounts from the frame URL and installs the §D fixture; its certified cut closes this. | `Accepted` |
| G2 | Decisions 3 | A non-iframe isolation mechanism has no HTTP-visible boundary, so `frontend-plugin-isolation` keeps a seam witness for such a host. | Conformance Architect | `externally-gated:non-iframe-ui-plugin-host` Re-open when a host advertises a non-iframe `uiPlugins.isolation`. | Nothing while no host ships one. |

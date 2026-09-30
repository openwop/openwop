# RFC 0230 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Conformance | No scenario drives the normative-surface ingest path yet. `trigger-bridge-delivery.test.ts` still witnesses only through the host seams. | Conformance Architect | `carried:openwop.gap.0230.1` The public-path legs land in the next suite cycle, with dedup and run-less-event content-freeness split into their own requirement ids and kept in the floor. | `Accepted` |
| G2 | §Compatibility | No host advertises `inboundSigning` yet. openwop-app serves an ingest route with a different contract (OpenWOP-credentialed, wrapped body, 200/422). | openwop-app steward | `carried:openwop.gap.0230.2` openwop-app implements §B–§D, advertises the facet, and passes the path on a strict production cut. | `Accepted` |

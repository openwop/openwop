# RFC 0230 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Conformance | No scenario drives the normative-surface ingest path yet. `trigger-bridge-delivery.test.ts` still witnesses only through the host seams. | Conformance Architect | `closed` 2026-10-03 — #1827 (suite 2.45.3) added the normative-surface path to `trigger-bridge-delivery`, and #1872 (2.45.11) ported it to major 2 (`v2-trigger-bridge-delivery`). | `Accepted` |
| G2 | §Compatibility | No host advertises `inboundSigning` yet. openwop-app serves an ingest route with a different contract (OpenWOP-credentialed, wrapped body, 200/422). | openwop-app steward | `closed` 2026-10-03 — openwop-app advertises `triggerBridge.ingestion.inboundSigning: ["standard-webhooks-1"]` at both majors (build `451a665e8`, live discovery) and serves the RFC 0230 ingest. | `Accepted` |
| G3 | §D, Falsifiability | `409 subscription_not_active` has no observation path: no wire surface or seam makes a subscription non-active. The table claimed a pause "via the existing operator surface"; none exists. | Conformance Architect | `externally-gated:trigger-subscription-pause-surface` A pause or resume surface (RFC 0232 §Decisions 3) makes the row witnessable. | Nothing in this RFC. |

# RFC 0217 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Compatibility | MyndHyve's not-found branch answers the unregistered code `subscription_not_found`. | Conformance Architect | `closed` 2026-09-26 — MyndHyve's v2 webhook 404s answer `not_found`, chosen from the request's negotiated major (its v1 unregister keeps `subscription_not_found` for the frozen v1 scenario). Its certified production cut on 2.42.0 (openwop#1631; revision `workflow-runtime-00790-zib`, build `commit:e609c6372`) records `0217.dead-letter-read-after-unregister` `executed-pass`. | — |
| G2 | §Compatibility | `subscription_not_found` is asserted by the major-1 scenario `webhook-negative` but appears in no v1 or v2 registry. | Spec Architect | `transferred:spec/v1` — v1 is frozen through the overlap (end of support 2026-12-04); correcting the v1 scenario is churn with no v1 reader left to protect. | Nothing in this RFC. |

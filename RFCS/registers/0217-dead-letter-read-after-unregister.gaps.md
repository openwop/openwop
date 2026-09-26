# RFC 0217 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Compatibility | MyndHyve's not-found branch answers the unregistered code `subscription_not_found`. | Conformance Architect | `externally-gated:myndhyve-not-found-code` — MyndHyve is changing its v2 dead-letter 404 to `not_found` (its v1 unregister route keeps `subscription_not_found`, which the frozen v1 scenario `webhook-negative` asserts). | Nothing in this RFC; MyndHyve fails the row until its fix deploys. |
| G2 | §Compatibility | `subscription_not_found` is asserted by the major-1 scenario `webhook-negative` but appears in no v1 or v2 registry. | Spec Architect | `transferred:spec/v1` — v1 is frozen through the overlap (end of support 2026-12-04); correcting the v1 scenario is churn with no v1 reader left to protect. | Nothing in this RFC. |

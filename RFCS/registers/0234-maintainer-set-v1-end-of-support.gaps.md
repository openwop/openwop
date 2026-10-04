# RFC 0234 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.1 | Header-less major-1 requests on unversioned paths are not measurable from request logs, so the traffic evidence cannot rule them out. | Compatibility Architect | `externally-gated:host-logs-capture-openwop-version` A host that logs the `OpenWOP-Version` header can measure them. | Nothing in this RFC. |
| G2 | §A.2 | MyndHyve still serves first-party clients on 10 `/v1` roots with no major-2 twin. | Host (MyndHyve) | `externally-gated:myndhyve-v1-only-roots-migrated` Its maintainer decides when to drop `1.x`. | Nothing in this RFC. |

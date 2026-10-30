# RFC 0234 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A.1 | Header-less major-1 requests on unversioned paths are not measurable from request logs, so the traffic evidence cannot rule them out. | Compatibility Architect | `externally-gated:host-logs-capture-openwop-version` A host that logs the `OpenWOP-Version` header can measure them. | Nothing in this RFC. |
| G2 | §A.2 | MyndHyve still serves first-party clients on 10 `/v1` roots with no major-2 twin. | Host (MyndHyve) | `closed` 2026-10-29 — MyndHyve's legacy `workflow-runtime` (`api.myndhyve.ai`) retired 2026-10-29; MyndHyve now runs on the openwop-app white-label (tier 1). The ten `/v1`-only roots went with it; the white-label serves `protocolVersions: ["2.0"]`. | Nothing in this RFC. |

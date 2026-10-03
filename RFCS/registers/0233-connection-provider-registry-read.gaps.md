# RFC 0233 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B.2 | Which scope reads the host-global provider registry: none beyond authentication, `packs:read`, or a new `connections:read`. Unresolved question 1. | Security Architect | `closed` 2026-10-03 — `manifest:read` (`/architect` ruling under the maintainer's directive; §Decisions 1). | Nothing. |
| G2 | §F | The disposition for a host with `packsSupported` that serves neither the seams nor `providerRead` plus the fixture: keep `blocked`, or `inapplicable`. Unresolved question 2. | Conformance Architect | `closed` 2026-10-03 — `inapplicable` without the `providerRead` gate, as `witnessable-gated` is defined; a host advertising `packsSupported` SHOULD advertise `providerRead` (§Decisions 2, risk R4). | Nothing. |
| G3 | §B, §C | No host serves the reads or installs the fixture pair, so none of the §F rows has a witness. | Reference Implementation Architect | `externally-gated:openwop-app-serves-provider-registry-read` openwop-app serves both reads, installs the §D pair and cuts on a suite carrying the §F path. | `Accepted` |
| G4 | Alternatives | A dry-run validate endpoint would let the suite cause a conflict unaided. Unresolved question 3. | Spec Architect | `externally-gated:provider-dry-run-validate-rfc` A later RFC, if wanted. | Nothing in this RFC. |
| G5 | §B.5 | Whether `refusals` covers a connector (not a pack) that references an undefined provider. Unresolved question 4. | Spec Architect | `closed` 2026-10-03 — pack registrations only; connectors register through RFC 0045 (§Decisions 4). | Nothing. |

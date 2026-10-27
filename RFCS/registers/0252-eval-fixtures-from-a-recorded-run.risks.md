# RFC 0252 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A foreign source run is accepted, and another tenant's tool results reach the caller's agent and output | M | H | High | §C: only a run the caller's owner triple can read; one refusal for every unusable source; `0252.source-uniform` uses a second tenant's real run; invariant `eval-fixture-run-tenant-scoped` | Security Architect | at `Active` | `mitigated` — by the §C rule; `0252.source-uniform` `executed-pass` on openwop-app's certified cut `2c8bc27d6`, with tenant B's real run. |
| R2 | The refusal distinguishes "another tenant's run" from "no such run" | M | H | High | One status and code, no details, no echoed id | Security Architect | at `Active` | `mitigated` — by §C's single refusal; `0252.source-uniform` `executed-pass` on cut `2c8bc27d6`. |
| R3 | A host derives entries from its egress requests, so injected credentials enter fixtures | L | H | Med | §D: the derivation reads the agent-side boundary; entries never reach the wire | Security Architect | at `Active` | `accepted` — unwitnessable from outside; the invariant's reference-impl tier covers it. |
| R4 | A replay of a production run repeats its effects | L | H | Med | §D forces `onMiss: "fail"` on every named task; `0252.drift-fails-closed` | Security Architect | at `Active` | `mitigated` — by §D; `0252.drift-fails-closed` `executed-pass` on cut `2c8bc27d6`. |
| R5 | A client sends `fixtureRuns` to a host without the member | L | L | Low | Advertise-first (§A) | Compatibility Architect | at `Active` | `mitigated` — by §A. |

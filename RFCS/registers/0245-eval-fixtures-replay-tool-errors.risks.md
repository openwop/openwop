# RFC 0245 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host that ignores unknown suite fields serves an `isError` entry as a success, the exact bug this RFC fixes. | M | M | Med | §C capability member plus the §G-style refusal; the item schema is `additionalProperties: false` for strict validators. | Compatibility Architect | `mitigated` — by design (§C). |
| R2 | An error payload copied from a real run carries customer content onto the wire via `agent.tool-returned.error.message`. | L | M | Low | §D: a host SHOULD put a short fixed message on the event; RFC 0244's suite-content rule already keeps `response` off the wire. | Security Architect | `accepted` — the SHOULD stands; a host that echoes the payload leaks only suite content the author put there. |
| R3 | Hosts emit different `error.code` values for the same served failure, so cross-host suites cannot compare codes. | M | L | Low | The leg asserts only a non-empty `code`; UQ 1 / G2 weigh a registered code. | Spec Architect | `accepted` — the leg compares presence, not the code, until G2 decides. |

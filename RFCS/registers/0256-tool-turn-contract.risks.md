# RFC 0256 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The taint bit over-restricts approvals and blocks ordinary work | M | M | Med | Approval stays possible; shadow-count first | Security Architect | before enforce | `transferred:rfc-0256-implementation` |
| R2 | Recorded tool results hold sensitive data | M | H | High | Same redaction and retention as the invocation log | Security Architect | before `Active` | `transferred:rfc-0256-implementation` |
| R3 | Recovery fails real runs that used to re-run silently | M | M | Med | Shadow-count `tool_outcome_unknown` first | Reference host | before enforce | `transferred:rfc-0256-implementation` |
| R4 | Fail-fast on record errors reduces availability | L | M | Low | Only for tools not declared read-only | Reference host | before enforce | `transferred:rfc-0256-implementation` |

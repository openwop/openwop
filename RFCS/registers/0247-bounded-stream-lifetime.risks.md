# RFC 0247 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A consumer sends `resumable=true` but stops at a clean close, so it silently loses the rest of the run. | M | M | Med | §C makes resume a MUST for any consumer that opts in; the opt-in is the consumer's own claim, and the reference SDKs implement it. | Compatibility Architect | `accepted` — the consumer asked for the behaviour. |
| R2 | A reconnect storm: many consumers reconnect at the same instant after a deploy or a shared bound. | L | M | Low | §B's SHOULD `retry:` and §C's SHOULD back off; hosts may jitter their bound inside the 15 s … `maxStreamAgeSec` window. | Security Architect | `mitigated` — by design. |
| R3 | A host bounds streams without advertising, breaking consumers that did not plan for it. | L | L | Low | §B: a non-advertising host MUST NOT bound; a consumer MUST handle a close anyway (§C). | Spec Architect | `mitigated` — by design. |

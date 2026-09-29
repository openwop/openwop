# RFC 0229 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host implements §A.2 loosely: its resolver chain lets a `run:` ref fall through to a stored or environment secret, recreating the oracle this RFC removes. | M | H | High | §A.2 and §A.3 are MUSTs, and §F.3 probes them: an unsupplied `run:` ref, an earlier run's ref, and a non-`run:` ref must all fail, never resolve. | Security Architect | `open` — mitigated once the §F.3 leg ships with its negative control. |
| R2 | A host's request-body logging captures `runSecrets` values. | M | M | Med | §A.6 forbids it. It is unwitnessable (G3), and it is the same exposure the host's existing secret-upload route already carries. | Host operators | `accepted` — operator-audited. |
| R3 | A client sends a real credential through `runSecrets` for ordinary BYOK and a host mishandles it. | L | H | Med | Every existing run-scope redaction rule binds the value (§A.5), and the witness outputs only `matched` (§B.3). | Spec Architect | `accepted` — the same exposure as any run-scoped BYOK secret, under the same rules. |
| R4 | A regex secret-scrubber masks the suite's canary, so a host with a broken value-based redaction layer still passes the redaction row. | M | L | Low | The canary has no fixed prefix and is base64url (§F). The row witnesses the observable property the spec states: the value is absent, whatever the mechanism. | Conformance Architect | `accepted` |

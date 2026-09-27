# RFC 0218 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A verifier implements the tree but skips the leaf-count rule, and accepts interior nodes presented as leaves (no domain separation). | M | M | Med | The rule is a MUST in §A.5 and a refusal vector (`interior-nodes-as-leaves`) that a verifier without it accepts; the suite's lib enforces it. | Security Architect | `accepted` — mitigated by the §A.5 MUST and its refusal vector; the construction's lack of domain separation stays recorded as Unresolved 1. |
| R2 | A future host signs the checkpoint object's canonical JSON, the reading the schema description once gave. | L | M | Low | The black-box row fails such a host, and the `signed-canonical-json` signature refusal vector names the mistake. | Conformance Architect | `accepted` — the row failing is the rule working. |

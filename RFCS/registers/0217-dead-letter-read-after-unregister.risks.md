# RFC 0217 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host deletes the subscription row asynchronously, so for a moment after the `204` the read still answers `200`. | L | L | Low | The rule binds after the `204`; a host that answers `204` before its delete completes is already wrong under RFC 0215 §B. The leg reads immediately after the `204`, which is where that host fails. | Conformance Architect | `accepted` — the row failing is the rule working. |

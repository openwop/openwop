# RFC 0242 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host that serves A2A or MCP inbound but not `hostEvents` measures non-conformant on the first suite that ships B.3. | M | L | Low | B.3 gives an existing MUST a home rather than adding one; it applies by suite release (COMPATIBILITY.md §2.3); no host in `INTEROP-MATRIX.md` advertises an inbound A2A or MCP surface in production today. | Spec Architect | `accepted` — measured by suite release. |
| R2 | An unauthenticated exchange's record reaches no one, so its obligation cannot be checked. | H | L | Low | Such an exchange cannot lower the version below `preferredVersion` (`interop.md` §Authentication), so there is no downgrade to hide. | Security Architect | `accepted` — unwitnessable by construction (row B.4). |

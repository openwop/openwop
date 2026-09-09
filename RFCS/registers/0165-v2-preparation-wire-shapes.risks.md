# RFC 0165 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A v2-aware client selects v2 from `protocolVersions` against a v1.x host that listed a major it does not serve | L | H | High | §A.2 MUST NOT name an unserved major; the scenario asserts containment of the scalar; v2's negotiation is defined by the v2 RFC, not here | Spec Architect | Open |
| R2 | A host emits `owner.subject` on new runs but re-owns forks to the forking principal, breaking the same-key invariant the leaver contract depends on | M | H | High | §B.4 MUST copy `subject` verbatim on fork; `owner-subject-echo.test.ts` fork leg (gated on emission) | Conformance Architect | Open |
| R3 | A host synthesizes a legacy subject with a guessed real issuer and creates an identity that never existed | L | H | High | §B.3 fixes `issuer: urn:openwop:legacy` and forbids linking; invariant `subject-legacy-not-linkable` | Spec Architect | Open |
| R4 | Dual-emitted headers double the delivery header bytes and a subscriber verifies the wrong family's signature against the other's timestamp | L | M | Medium | §C.1 values MUST be identical; the scenario checks each pair and re-verifies the signature | Conformance Architect | Open |
| R5 | The SDKs keep rejecting the spec's `sha256=` form, so a host that dual-emits still fails SDK verification | H | M | High | §C.3 names the defect; openwop-sdks fix lands in the same wave (acceptance G5) | SDK maintainer | Open |

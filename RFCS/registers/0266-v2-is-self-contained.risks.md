# RFC 0266 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A rule changes meaning while it moves from a v1 document to its v2 home. | M | H | High | Each move is a verbatim or tighter restatement reviewed against the v1 text in the same PR; the PR cites the v1 section it replaces. | Spec Architect | each §B.2 PR | `transferred:RFC 0266 Acceptance criteria` |
| R2 | An outside consumer of `@openwop/spec-artifacts` 2.x reads v1 files and breaks when §D ships. | L | M | Low | CHANGELOG names the last release that ships v1; earlier releases are never unpublished. No non-steward consumer is known. | Release | §D release | `accepted` |
| R3 | Retiring the v1→v2 generators loses a correction that only the derivation applied. | M | M | Med | Cut over once: diff the derived output against the committed v2 files before deleting the derivation, and commit any difference as an explicit v2 edit. | Spec Architect | §C | `transferred:RFC 0266 Acceptance criteria` |
| R4 | A client that still resolves the flat v1 registry keys breaks after the 2027-09-05 floor. | L | L | Low | The keys carry a deprecation row with the floor as removal trigger; nothing changes before it. | Registry operator | 2027-09-05 | `accepted` |

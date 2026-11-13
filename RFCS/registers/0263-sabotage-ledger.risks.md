# RFC 0263 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A ledger row is invented: no sabotage ran, and the gate accepts the row. | L | M | Low | Each row names the scenario, the sabotage and the subject build, so anyone can re-run it; an invented row is a false public statement, which a signature would not prevent (Security considerations). | Conformance Architect | at `Active` | `accepted` 2026-11-13 — residual; the row is reproducible, not attested. |
| R2 | A certified passing bundle is cited as the red run. | L | H | Med | §B: `witnessSha256` MUST NOT be a certified committed bundle's digest; `ledgerShapeFailures` refuses it and the coherence leg sabotages that check. | Conformance Architect | at `Active` | `mitigated` 2026-11-13 |
| R3 | A sabotage was run on an older leg than the one cited, so the red run shows nothing about the leg that passed. | M | M | Med | UQ 2 asks whether rule 5 should compare suite versions; until then the row records `suiteVersion` so a reviewer can see the gap. | Conformance Architect | at the first §C flip | `accepted` 2026-11-13 — recorded, not yet enforced. |
| R4 | §A adds work to every RFC from 0258 and an author drops ids to get past it. | L | L | Low | Rule 6 runs on `Active` as well as `Accepted`, so the table is checked at filing; a row with no id must say `planned`, which blocks `Accepted` from 0260. | Spec Architect | at `Active` | `mitigated` 2026-11-13 |

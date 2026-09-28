# RFC 0227 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | `spec/v2/generated/` becomes a place to file rules out of the budget. | L | H | Med | Only files registered against a generator may exist there; each generator's `--check` fails on any byte it did not write; `check-core-budget` fails on an unregistered file (sabotage-checked). | Spec Architect | `mitigated` — enforced by two gates. |

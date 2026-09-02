# RFC 0156 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Independent maintainers do not volunteer. | H | H | Critical | Freeze expansion and keep claims qualified; funded outreach. | Lead Maintainer | Open — **Sweep 2026-08-16:** **Open, Critical** — unchanged. |
| R2 | Audit is delayed or underfunded. | M | H | High | Approve budget, solicit multiple firms, staged design/retest. | Lead Maintainer | Open — **Sweep 2026-08-16:** **Open** — unchanged. |
| R3 | Sponsored Tier-3 host is effectively steward-controlled. | M | H | High | Independent control criteria and funding disclosure. | Governance Maintainer | Open — **Sweep 2026-08-16:** **Open** — moot until a Tier-3 candidate exists. |
| R4 | Retrospective review destabilizes v1. | M | H | High | Risk-rank, additive/safety fixes in v1, other breaks in v2. | Compatibility Architect | `open` — queue published 2026-09-02 (`docs/RETROSPECTIVE-QUEUE.md`); review itself needs a second organization; the five entries are `provisional` until then. Open — **Sweep 2026-08-16:** **Open** — not started. |
| R5 | Claim gate is bypassed on an unscanned public surface. | M | M | Medium | Central claim tokens and public-surface inventory. | Docs Maintainer | Open — **Sweep 2026-08-16:** **Partially mitigated** — corpus scanned; other surfaces not (G6). |
| R6 | Governance becomes performative while lead retains de facto control. | M | H | Critical | Cross-org quorum, public decisions, conflicts, no unilateral waiver. | Governance Maintainer | Open — **Sweep 2026-08-16:** **Open, Critical** — single maintainer; every 2026-08 decision was unilateral by construction, recorded publicly in PRs/CHANGELOG. |


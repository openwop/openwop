# RFC 0149 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A client depends on the erroneous doubled path. | M | M | Medium | Survey, warning, optional temporary redirect. | SDK Maintainer | Open — **Sweep 2026-08-16:** **Closed** — no such client existed (UQ1). |
| R2 | Typo lint rejects legitimate vendor fields. | M | M | Medium | Namespace exemption and reviewed reserved-name ledger. | Schema Architect | Open — **Sweep 2026-08-16:** **Open** — lint unbuilt (G2). |
| R3 | Runtime closure accidentally breaks additive v1 clients. | L | H | High | Keep server-emitted schemas open; lint authoring only. | Compatibility Architect | Open — **Sweep 2026-08-16:** **Mitigated by design** — runtime schemas open; only authoring lints; `discovery-canonical-family-no-shadow` binds consumers not hosts. |
| R4 | Example extraction changes Markdown semantics. | M | L | Low | Explicit fenced-block metadata and source-linked snapshots. | Spec Architect | Open — **Sweep 2026-08-16:** **Closed** — extraction uses HTML-comment markers (`<!-- normative-example: … -->`) that render as nothing (S7, #1020); no fence metadata, no snapshots. |
| R5 | Version normalization hides a true incompatible host. | L | H | High | Warn only for exact patch-zero legacy form; never normalize different major. | Compatibility Architect | Open — **Sweep 2026-08-16:** **Closed** — no normalization is performed; `1.0.0` is rejected outright and no deployed host uses it (G3). |


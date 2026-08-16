# RFC 0148 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Historic claims are materially invalid. | H | H | Critical | Inventory, invalidate precisely, reissue, avoid blanket accusations. | Release Maintainer | Open — **Sweep 2026-08-16:** **Realised, precisely scoped, remediated:** Bundle 1 invalidated; four v2 reissues (`docs/CERTIFICATION-BUNDLE-INVENTORY.md`). No blanket accusation was made — the failing claims are named per host. |
| R2 | Witnesses leak response or tenant content. | M | H | High | Hash content-free reporter records; canary tests and external audit. | Security Architect | Open — **Sweep 2026-08-16:** **Mitigated:** `--certify` scrubs the finished document with the handed credential + `OPENWOP_*` secrets + the SR-1 canary and self-verifies; `verifyBundleV2` rejects the canary anywhere (`certification-bundle-redaction.test.ts`, #1019). External audit still unscheduled. |
| R3 | Requirement IDs churn and make evidence unverifiable. | M | M | Medium | Stable registry and alias/deprecation rules. | Spec Architect | Open — **Sweep 2026-08-16:** **Open** — ids are stable at file/floor granularity; there is no alias/deprecation rule for requirement ids yet (0148 G3). |
| R4 | Explicit skips make suite output noisy or brittle. | M | M | Medium | Structured dispositions and profile-aware summaries. | Conformance Architect | Open — **Sweep 2026-08-16:** **Mitigated:** dispositions are structured; `--certify` prints per-profile certifiable/rejected summaries; noise is now signal (zero-assertion passes visible, not hidden). |
| R5 | A malicious generator fabricates witnesses. | M | H | High | Independent generation, reproducible runs, provenance/signing in RFC 0154. | Security Architect | Open — **Sweep 2026-08-16:** **Open** — bundles are reproducible and consumer-verifiable but unsigned; provenance depends on RFC 0154 G4. |


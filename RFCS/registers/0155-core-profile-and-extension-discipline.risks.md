# RFC 0155 — Risk Register

> **Acceptance sweep 2026-08-16 (RFC 0147 criterion 12, S11).** Every row below carries a `Sweep 2026-08-16` disposition against the evidence on `main` at that date — closed / carried (with the pointer) / externally gated. Rows without one were already struck through as closed. This is a sweep, not a rewrite: original text is preserved.


| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Alias increases rather than reduces profile confusion. | M | M | Medium | Canonical output only; alias input/deprecation warnings. | SDK Maintainer | Open — **Sweep 2026-08-16:** **Mitigated** — `--certify` v2 emits canonical only + `aliases`; both-or-neither derivation tested; SDK deprecation warnings not yet emitted (`openwop-sdks`). |
| R2 | Extension budget becomes arbitrary gatekeeping. | M | H | High | Public capacity rationale, review cadence, appeal path. | Governance Maintainer | Open — **Sweep 2026-08-16:** **Open** — budget uncalibrated (G1). |
| R3 | Registry maturity is self-awarded without evidence. | H | H | Critical | Machine gates and Tier-3/external-audit requirements. | Conformance Architect | Open — **Sweep 2026-08-16:** **Mitigated by gates** — coverage generator + `--check`; maturity flips still need Tier-3/audit evidence that does not exist. |
| R4 | Stable core manifest drifts from prose. | M | H | High | Single generated source and bidirectional parity test. | Spec Architect | Open — **Sweep 2026-08-16:** **Mitigated** — generated manifest + bidirectional parity leg; the 2026-08-16 phantom-floor finding (`audit-log-verification.test.ts`) shows the drift risk was real *before* the ledger and is now caught. |
| R5 | Existing extensions are unfairly demoted. | M | M | Medium | Transparent backfill rubric and comment window. | Governance Maintainer | Open — **Sweep 2026-08-16:** **Open** — backfill rubric not published; 81 uncovered families are a tracked count, not a demotion. **Mitigated 2026-08-16:** the rubric is now stated in `spec/v1/extensions.json` `$comment` (grandfathering: `Active`/`Accepted` RFC or v1 base doc → `draft`; `Draft`/`Parked` RFC → `experimental`; nothing → `stable` without a Tier-3 host) and applied to all 66 backfilled families + `production`; no family was placed below `draft` except by its own RFC's status, so nothing was demoted. The comment-window half is unexercised (steward waiver regime). |


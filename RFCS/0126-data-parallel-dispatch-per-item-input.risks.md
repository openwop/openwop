# RFC 0126 — Risk Register

Companion to `0126-data-parallel-dispatch-per-item-input.md`. Likelihood × Impact (H/M/L). Critical/High risks carry a named mitigation owner.

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | **Silent-drop on a naive host** — a host adds `nextWorkerInputs` support incompletely (or ignores the field) and dispatches N children with identical inputs, mailing/processing one item N times and skipping the rest. This is the exact motivating bug, now potentially reintroduced by a partial implementation. | M | H | **High** | The spec makes silent-drop a `MUST NOT`: a host either advertises `capabilities.dispatch.perItemInput` and honors per-index projection, or fails closed with `validation_error`. Conformance scenario assertions 1 + 5 enforce both arms. | Conformance Architect | Open |
| R2 | **Resource exhaustion via per-item payloads** — a supervisor emits N items each carrying a large `nextWorkerInputs[i]` object; N × payload can blow memory or child-run storage even within `maxFanOut` (which bounds child *count*, not per-item *size*). | L | H | **Med** | Gap G3: document a per-item size/depth expectation and rely on the existing decision-event size limits; `maxFanOut` + `iterationCap` bound count. Revisit at `Active`. | Security Architect | Open |
| R3 | **Fan-out scale on the consumer** — the first consumer (ADR 0255 segment-winback) dispatches up to the segment cap (5000) child runs per sweep; at scale this pressures the run store + the DB connection budget (poolMax × maxInstances ≤ tier) on the reference host. | M | M | **Med** | Not a wire risk — bounded by `maxFanOut`/`maxConcurrency`/segment cap + `truncated` flag. Flag for the consumer's impl review; the RFC only permits the fan-out, hosts advertise their own `maxFanOut`. | (host) Impl reviewer | Open |
| R4 | **INTEROP-MATRIX drift** — third-party hosts adopt the additive field but stay on an older conformance suite, so the `dispatch.perItemInput` column never populates and interop claims lag reality. | M | M | **Med** | Gate the scenario on `capabilities.dispatch.perItemInput`; add the matrix column in the same PR; remind in RFC §Conformance. | Conformance Architect | Open |
| R5 | **Replay divergence if items are recomputed** — a host that (incorrectly) re-derives per-item inputs at replay instead of re-reading the recorded decision produces different children on `:fork`, breaking replay determinism. | L | H | **Med** | Normative MUST: re-read the recorded `runOrchestrator.decided` decision verbatim; never recompute. Conformance assertion 4 (replay-freeze) enforces it. Mirrors the RFC 0118 `mergeOrder` clause. | Spec Architect | Open |
| R6 | **Capability-name churn** — shipping `Draft` with `perItemInput` then renaming to `dataParallel` at `Active` forces a schema + host re-spin. | L | L | **Low** | Resolve G2 before any reference-host code lands; keep `Draft` schema changes behind the capability flag so a rename is contained. | Schema Architect | Open |

## Sweep at `Accepted` (2026-07-04)

Single-witness graduation (openwop-app PR #1278) under the bootstrap steward waiver. No Critical/High risk is left un-mitigated at graduation; the two carried-forward residuals are both Medium and named as open gaps.

| ID | Disposition | Evidence / carry-forward home |
|---|---|---|
| R1 | **MITIGATED — VERIFIED** | Silent-drop is a `MUST NOT`; the fail-closed gate is enforced by conformance assertions + the openwop-app witness (tests 3–4: unadvertised ⇒ `validation_error`, 0 children; length-mismatch ⇒ `validation_error`, 0 children). The exact motivating bug cannot recur on a conformant host. |
| R2 | **CARRIED FORWARD** | Resource exhaustion via large per-item payloads (L×H). No hard cap; bounded by decision-event size limits + count bounds. Named in RFC §Unresolved Q3 / gap G3. Revisit if a real signal appears; a cap is additive. |
| R3 | **CARRIED FORWARD (host impl)** | Consumer fan-out scale (segment cap ≤5000 child runs/sweep) — not a wire risk. Transferred to the openwop-app ADR 0255 segment-winback *consumer* impl review; bounded by `maxFanOut`/`maxConcurrency`/segment cap + `truncated`. The RFC only permits the fan-out. |
| R4 | **CARRIED FORWARD** | INTEROP-MATRIX drift — the scenario is capability-gated; openwop-app is honest-off until the post-graduation advertisement flip, so the matrix cell populates when it advertises. Other hosts `—` until they implement (= gap G6). |
| R5 | **MITIGATED — VERIFIED** | Replay divergence — normative MUST to re-read the recorded `runOrchestrator.decided` decision verbatim, never recompute; the openwop-app witness is replay-safe (CP-2 preserved, rides the recorded decision). |
| R6 | **RESOLVED** | Capability name settled at `perItemInput` before any host code landed (G2); no rename, no churn. |

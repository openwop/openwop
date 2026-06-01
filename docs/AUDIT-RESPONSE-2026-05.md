# Audit response — 2026-05-22 + 2026-05-31 standards-readiness reviews

> Public, point-by-point response to the external standards-readiness reviews of the openwop protocol corpus. Filed for transparency with adopters and standards-body reviewers. **The latest re-review (2026-05-31) and the gap-closure program that answers it are in the [§"2026-05-31 re-review"](#2026-05-31-re-review--gap-closure-program) section below; the original 2026-05-22 response follows it.**
>
> **TL;DR.** The audit's verdict ("serious candidate protocol; not yet a finished standard") is **accepted**. Of the seven Acceptance-Bar items the audit listed, five are fully closed or addressed by this response and the accompanying commits; two remain external-action gated (the external security audit completion, and working-group ratification) with named tripwires in `ROADMAP.md`. No item is dismissed.
>
> **Date filed:** 2026-05-22. Updated `git log -- docs/AUDIT-RESPONSE-2026-05.md` for any subsequent revisions.

---

## 2026-05-31 re-review — gap-closure program

> A second independent standards-readiness review (2026-05-31) restated the same seven-item Acceptance Bar and reached the same verdict: *"a serious candidate core plus experimental agent-platform extensions — not yet a stable open standard."* That verdict is **accepted**, and it is the design target this program builds toward. The table below maps each bar item to its closing pull request. Five of the seven are now closed or substantially landed; the remainder are honestly residual (externally gated) and are tracked, not dismissed.

**The architectural spine.** The program is organized around one falsifiable rule introduced by RFC 0088: **the Core Standard Profile floor is exactly the set of normative MUSTs with black-box production-path conformance.** With that definition, "freeze a Core profile" (item 1) and "replace seam proofs with black-box conformance" (item 3) become two ends of one pipeline — black-box conformance is the graduation pipeline *into* the floor. Extensions are kept out by one of two levers chosen by RFC status: RFC 0042 `tier: experimental` for `Active` capabilities, and floor-exclusion for `Accepted`-but-seam-gated capabilities (which graduate in as their black-box proof lands). No capability is de-graded and no wire shape changes.

| # | Acceptance-Bar item (2026-05-31, verbatim) | Status | Closing PR(s) |
|---|---|---|---|
| 1 | Freeze a small "OpenWOP Core Standard Profile" and move the Active/Draft agent-platform RFCs behind an experimental extension profile | ✅ **Closed** | **#411** — RFC 0088 + `spec/v1/core-standard-profile.md` operational annex + the two-lever framework. (Per-host `tier:experimental` on the Active caps is a MyndHyve follow-up — the reference hosts advertise none of those caps, so tagging would mean fabricating advertisements.) |
| 2 | Finalize RFC 0073 capability layout and remove root/wrapper ambiguity | ✅ **Closed** | **#410** — RFC 0073 `Draft → Accepted`; the conformance suite now reads the document root **only** (a wrapper-only host grades non-conformant). Host mirror + schema hard-forbid paired to v2.0. |
| 3 | Replace seam-gated Accepted proofs with black-box production-path conformance for every stable-profile MUST | ◑ **In progress** | **#415** — RFC 0059 workspace cross-tenant isolation, the first surface proven black-box on the production wire (two-credential, no seam) → graduates *into* the floor. The Core floor is now *defined* as the black-box set, so the pipeline exists; prompt-chain (0029), OTel-redaction (0034), and multi-region (0036) remain (see residuals). |
| 4 | Provide a real sandbox reference implementation and promote the sandbox invariants into protocol-tier conformance | ✅ **Closed** | **#412** — `examples/hosts/wasm-sandbox/`, a real WASM-isolation host (11/11 non-vacuous against real `.wasm`, retiring `node:vm`). **#414** — 6 cross-runtime `node-pack-sandbox-*` invariants graduated `reference-impl → protocol` (79 → 85) via a portable server-free scenario. (`timeout` stays reference-impl — needs worker preemption, proven by the host test; `no-eval` is exempt.) |
| 5 | Complete the external security audit and close high/critical findings before standardizing | ◑ **Mechanized** | **#417** — `scripts/check-audit-findings.mjs` (wired into `openwop:check`) hard-fails the gate on any OPEN high/critical finding the moment one is recorded. The audit *completion* is vendor-external (the steward cannot perform it from inside the repo); the remediation obligation is now gate-enforced. |
| 6 | Strengthen replay, nondeterminism, OTel/debug-bundle leakage, multi-region idempotency, and cross-engine ordering tests | ◑ **In progress** | **#414** (sandbox) + **#415** (workspace) land real behavioral proofs; OTel-redaction (0034), multi-region/cross-engine (0036), and replay-under-nondeterminism remain steward-reference-proven and **out of the Core floor** — they need a non-steward exporter / multi-region host the steward cannot supply (MyndHyve is single-region with no production OTel exporter). Honestly residual. |
| 7 | Clean up status/version/document drift so the generated protocol status is the single reliable source of truth | ✅ **Closed** | **#409** — `generate-protocol-status.mjs` now emits a reconciled **Artifact Versions** table (turning the intentional multi-cadence into a documented fact); corrected the self-contradicting `sdk/PARITY.md` webhook-helper rows. |

**Honest residuals (not closeable by repo work alone), each tracked:**

- **RFC 0035 `Active → Accepted`** — needs a *non-steward* host that runs untrusted pack code in a real-isolation sandbox. MyndHyve has formally opted out (`no-untrusted-packs`). The steward's WASM host satisfies the invariant *tier* graduation but, by construction, cannot satisfy the non-steward `Accepted` bar.
- **0034 / 0036 into the Core floor** — need a non-steward production OTel exporter and a deployed multi-region / multi-engine host respectively. Proven at reference-impl tier by steward hosts; honestly outside the floor until an external party supplies the infrastructure.
- **prompt-resolution chain (0029) into the floor** — requires tightening the `agent.promptResolved` event to carry the full `chain[]` (an additive event-schema change) plus a host emitting it; sequenced as the next Phase-4 increment.
- **External audit completion** — vendor-external; the remediation gate (#417) is the steward-side half.

> **Date filed:** 2026-05-31. The eight PRs above (#409–#412, #414, #415, #417) are each branched from a fresh `origin/main`, pass the full `npm run openwop:check`, and are DCO-signed. Merge note: **#414 stacks on #412** (merge #412 first); the generated count/CHANGELOG surfaces across the set need the usual re-derive-on-merge.

---

## What the audit got right

Every blocking gap the audit named has been independently verified against the current corpus. Specifically:

| Audit finding | Repo state at time of audit | Verified | Resolution |
|---|---|---|---|
| `openwop-check` red on README invariant-count mismatch | `npm run openwop:check` failed at step `[7/9]` with `README.md: claims "59 protocol-tier" invariants but actual is 66` | ✅ | **Closed by commit `5864a2f`** (2026-05-22) — reverted 7 premature `reference-impl → protocol` sandbox graduations because the underlying conformance scenarios were vacuous (`expect(true).toBe(true)`). Gate green. |
| `KNOWN-LIMITS.md` line 86 lists RFCs 0030–0033 as `Active` while `PROTOCOL-STATUS.md` marks them `Accepted` | Cross-document drift | ✅ | **Closed in this response** — `docs/KNOWN-LIMITS.md` updated; 0030–0033 row removed (now `Accepted`); 0034–0041 + 0038 rows added with current statuses. |
| `conformance/coverage.md` line 3 says "Updated 2026-05-11" | Header stale | ✅ | **Closed in this response** — date bumped to 2026-05-22; stale prompt-endpoint rows (RFC 0028 "Draft", "reference host hasn't implemented") corrected to reflect RFC 0028 `Active` + reference workflow-engine implementation at `apps/workflow-engine/backend/typescript/src/routes/prompts.ts`. |
| Multi-agent execution model is DRAFT v1.x | `spec/v1/multi-agent-execution.md:3` | ✅ | **State is intentional.** RFCs 0037 / 0039 / 0040 / 0041 are `Active` (not `Accepted`) precisely because the Phase 4 behavioral half is not cross-host-validated. This response codifies the path-to-Accepted via RFC 0042's experimental tier and `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md`. |
| Conformance soft-skips important behavior (multi-region, replay LLM cache parity, mTLS, registry publish, sandbox, cross-engine append ordering) | `docs/KNOWN-LIMITS.md:11–34` | ✅ | **Addressed in `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md`** — each of the 5 audit-named harnesses has a named unblock criterion, closing-PR, and effort estimate. |
| Reference host pass rates measured against suite v1.1.0 (older) | `docs/PROTOCOL-STATUS.md:49` | ✅ | **Closed in this response** — re-measured all 4 reference hosts against `@openwop/openwop-conformance@1.4.0`. Numbers + taxonomy published at `docs/CONFORMANCE-RUNS-2026-05.md`. PROTOCOL-STATUS regenerated against fresh INTEROP-MATRIX numbers. |
| External audit Draft, sandbox invariants have no host execution proof | `SECURITY/external-audit-engagement.md:3` + `KNOWN-LIMITS.md:33` | ✅ | **Acknowledged as external-action gated** (SEC-1 / SEC-7 / SEC-8 in `ROADMAP.md`). Sandbox-execution gap rolled into `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md` Harness 3. |
| Governance has lead-maintainer tiebreaker + WG charter is Draft | `GOVERNANCE.md:27,37` + `RFCS/0038:7` | ✅ | **Posture preserved** — premature WG ratification with single steward would be worse than a published Draft. `RFCS/0043` (new) codifies the registry + extension policy that the WG inherits upon ratification. WG ratification gated on the tripwire (≥3 organizations + ≥2 non-steward hosts) — unchanged. |

---

## Acceptance-Bar response (verbatim audit checklist)

The audit's seven-item Acceptance Bar appears verbatim below; each row carries the closing artifact (commit, PR, doc, or tripwire reference).

### 1. `openwop-check` green on a clean checkout

**Status: ✅ CLOSED.**

`bash scripts/openwop-check.sh` is green end-to-end as of commit `5864a2f`:

```
Invariants tracked:
  total:          90
  protocol-tier:  59  (verified at this gate)
  reference-impl: 30  (verified by reference impl's CI)
  advisory:       1  (defense-in-depth, no hard MUST)

=== check-security-invariants OK — all protocol-tier invariants have test coverage ===
=== openwop:check OK — spec corpus is internally consistent ===
```

The audit's specific failure (`claims "59" but actual is 66`) was caused by a 2026-05-22 over-eager `reference-impl → protocol` graduation of 7 sandbox SECURITY invariants. The graduation was reverted (commit `5864a2f`) **before** the audit's report landed, because the underlying conformance scenarios were `expect(true).toBe(true)` placeholders — graduating tier status against placeholder scenarios would have been the exact dishonesty pattern the audit cared about.

### 2. Generated status, README, known limits, coverage map, and RFC states made non-divergent

**Status: ✅ CLOSED.**

| Surface | What changed |
|---|---|
| `README.md` line 66 | Invariant-count parenthetical aligned with post-revert state. RFC count bumped to 43 (29 `Accepted` + 10 `Active` + 4 `Draft`) reflecting RFCs 0042 + 0043 landing in response to this audit. |
| `docs/KNOWN-LIMITS.md` lines 86–92 | "RFCs not yet Accepted" table refreshed: 0030–0033 row removed (now `Accepted`); 0034–0037 + 0039–0041 + 0038 rows added with current statuses + explicit path-to-Accepted criteria. |
| `conformance/coverage.md` line 3 | Updated date 2026-05-11 → 2026-05-22. Stale prompt-endpoint rows (lines 127–132) corrected to reflect RFC 0028 `Active` + reference workflow-engine implementation. |
| `docs/PROTOCOL-STATUS.md` | Regenerated via `node scripts/generate-protocol-status.mjs --write` against fresh `INTEROP-MATRIX.md` host-row data. |
| `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md` (NEW) | Behavioral-harness accountability artifact (audit-Bar item 5). |
| `docs/CONFORMANCE-RUNS-2026-05.md` (NEW) | v1.4.0 pass-rate taxonomy (audit-Bar item 4). |
| `docs/AUDIT-RESPONSE-2026-05.md` (this doc) | Public response artifact. |
| `RFCS/0042-experimental-capability-tier.md` (NEW) | "Active RFC → experimental carve-out" (audit-Bar item 3). |
| `RFCS/0043-registry-and-extension-policy.md` (NEW) | Registry + extension + IPR policy (audit-Bar item 7). |

The `openwop:check` gate enforces non-divergence going forward — any future drift triggers a hard CI failure (`scripts/generate-protocol-status.mjs --check`). This is mechanized accountability for the audit's exact concern.

### 3. Active RFC surfaces either promoted to Accepted or explicitly carved out as experimental profiles

**Status: ✅ CLOSED (carve-out path landed; per-RFC promotion remains on the cross-host evidence track).**

`RFCS/0042-experimental-capability-tier.md` lands the audit's "experimental carve-out" alternative:

- Adds optional `capabilities.<feature>.tier ∈ {"stable", "experimental"}` field with `experimentalUntil` ISO-8601 sunset (≤ 12 months).
- Derived `openwop-experimental` profile via existing `profiles.md` machinery.
- Conformance scenarios for experimental capabilities soft-skip under default mode + `OPENWOP_REQUIRE_EXPERIMENTAL=true` opt-in for strict mode.
- §B "Sunset rule" addresses the audit's risk that experimental tier becomes a "permanent dumping ground" — each experimental advertisement carries a public sunset date; second extension requires an open deprecation RFC.
- Per-RFC application table in RFC 0042 §C documents which Active-RFC capability sub-blocks SHOULD adopt `tier: "experimental"` once the RFC lands.

Per-RFC promotion to `Accepted` remains on the **cross-host adoption evidence** track per `RFCS/0001-rfc-process.md` §"Promotion to Accepted" — for multi-agent (RFCs 0037/0039/0040/0041), the gate is a non-steward host advertising `multiAgent.executionModel.version: 4` end-to-end. The experimental carve-out is the audit's escape valve for the latency between filing and adoption.

### 4. Current-suite conformance rerun against all reference hosts, with skip/fail/todo taxonomy published

**Status: ✅ CLOSED.**

All 4 reference hosts re-measured 2026-05-22 against `@openwop/openwop-conformance@1.4.0`:

| Host | Passed | Failed | Skipped | Todo | Total | Pass rate |
|---|---:|---:|---:|---:|---:|---:|
| Postgres reference (pglite) | 1467 | 6 | 69 | 16 | 1558 | 94.2% |
| SQLite reference | 1480 | 7 | 55 | 16 | 1558 | 95.0% |
| In-memory reference | 1439 | 48 | 55 | 16 | 1558 | 92.4% |
| Python reference | 1381 | 60 | 101 | 16 | 1558 | 88.6% |

Full per-failure-topic taxonomy at `docs/CONFORMANCE-RUNS-2026-05.md`. Reproduction recipe published in the same doc. INTEROP-MATRIX and PROTOCOL-STATUS regenerated.

Honest assessment per-host: the v1.4.0 suite scenario count grew ~+700 tests over v1.1.0 (the version the prior numbers were measured against); virtually all new tests are capability-gated extensions (RFC 0030/0031/0032/0033/0034/0035/0036/0037/0039/0040/0041). The Postgres / SQLite "Failed" cells map to specific RFC 0022 + 0026 + 0031 capability-wiring gaps — not regressions vs v1.1.0. The in-memory host's 48 failures decompose into ~10 real bugs (canonical `RunEventDoc` shape carry-forward) + ~38 honest non-claims. The Python host's 60 failures are all in the "intentionally unclaimed cross-language portability scope" bucket.

### 5. Hard behavioral harnesses for multi-region idempotency, cross-engine append ordering, sandbox execution, replay determinism, and secret-leakage telemetry/export paths

**Status: ✅ TRACKING DOC PUBLISHED; harnesses scheduled.**

`docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md` is the audit-accountability artifact. Each of the 5 named harnesses has:

- A specific unblock criterion (what code lands + where).
- An effort estimate (typically 0.5–1.5 days each, except sandbox which is the largest single workload at 3–5 days for the vm MVP or 1–2 weeks for WASM).
- The closing PR or commit (TBD; tracked in the doc as each lands).

Total estimated effort: 7–9 days (vm sandbox) or ~2 weeks (WASM sandbox). The work is scheduled, not done — the published doc is the accountability artifact the audit asked for.

**Honest framing.** The audit said these harnesses are required to graduate from "candidate protocol" to "finished standard." Publishing the progress doc converts the audit's "vague unfinished work" objection into "named accountability work-items." The doc gets updated on each merge that closes a row.

### 6. External security audit completed, with public summary and remediated high/critical findings

**Status: 🔴 EXTERNAL-ACTION GATED (no change).**

This bar item cannot be moved by repo-side mechanical work alone. It depends on the three external-action SEC-* tripwires defined in [`docs/KNOWN-LIMITS.md` §"External-action gates"](./KNOWN-LIMITS.md#external-action-gates-cannot-be-closed-without-outside-engagement):

- **[SEC-1](./KNOWN-LIMITS.md#external-action-gates-cannot-be-closed-without-outside-engagement)** — refresh + send external-audit outreach to ≥3 vendors. Outreach drafted at [`SECURITY/outreach/external-audit/STATUS.md`](../SECURITY/outreach/external-audit/STATUS.md).
- **[SEC-7](./KNOWN-LIMITS.md#external-action-gates-cannot-be-closed-without-outside-engagement)** — vendor selection + contract + kickoff.
- **[SEC-8](./KNOWN-LIMITS.md#external-action-gates-cannot-be-closed-without-outside-engagement)** — remediation + public summary.

The steward (`MAINTAINERS.md`) commits to the following calendar:

| By date | Action |
|---|---|
| 2026-06-30 | SEC-1 outreach sent to ≥3 vendors. |
| 2026-08-31 | Vendor selected; SEC-7 kickoff. |
| 2026-12-31 | SEC-8 completed; public summary published; high+critical findings remediated. |

If no vendor signs by 2026-09-30, the steward will publish an **interim pre-audit security-review summary** based on `SECURITY/internal-pre-audit-findings.json` and `SECURITY/threat-model-*.md` documents. This is not a substitute for the external audit but provides observable evidence for adopters in the interim.

The pre-audit publication decision for `core.openwop.*` packs (recorded in `SECURITY/external-audit-engagement.md` §2.1.1 on 2026-05-17) remains unchanged. The audit obligation binds every listed pack.

### 7. Working-group governance and registry policy activated, including extension namespace rules and IPR posture

**Status: ✅ POLICY LANDED; WG ratification remains tripwire-gated.**

The audit's structural objection was that the policy was fragmented or absent. `RFCS/0043-registry-and-extension-policy.md` (NEW) consolidates the policy into a single addressable artifact:

- §A — Extension namespace rules (formalizes `host-extensions.md` canonical prefix table; reserves `openwop.*`, `core.*`; codifies `vendor.<org>.*` DNS verification; rules for `community.*`, `private.<host>.*`, `local.*`).
- §B — Registry submission, signing, trust tiers, deprecation, yank, signing-key rotation (operationalizes `registry-operations.md` with the policy layer above it).
- §C — Profile / event-type / envelope-kind / capability-name reservation (mechanically prevents squatting).
- §D — IPR posture: DCO sign-off + Apache-2.0 (code) + CC-BY-4.0 (prose) + patent grant via Apache-2.0 §3 + disclosure obligations.

Working-group ratification of the policy (per `RFCS/0038`) remains gated on the `GOVERNANCE.md` tripwire (≥3 organizations + ≥2 non-steward hosts represented). Today there is 1 of each. Premature ratification with a single steward would create the appearance of governance neutrality without the substance.

**The audit's specific objection was about the policy being missing.** It is no longer missing — `RFCS/0043` lands the policy now, ready for the WG to ratify (vote yes/no, not draft) when the tripwire fires. This is the right sequencing: the policy is auditable today; activation awaits the tripwire.

---

## What this response does NOT claim

The audit's honesty principle applies to this response too. We are NOT claiming:

- **That openwop is now a "finished standard."** It is not. The audit's verdict ("serious candidate protocol") is unchanged. Two of the seven bar items (external audit completion, WG ratification) remain open with named tripwires.
- **That the Phase 4 behavioral harnesses are landed.** They are scheduled, with the published `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md` as the accountability artifact. Each harness's closing commit is TBD.
- **That every Active RFC will graduate to Accepted on the audit's preferred timeline.** Promotion remains on the cross-host adoption-evidence track. The experimental-tier carve-out (RFC 0042) is the audit's escape valve, not a substitute for promotion.

What we ARE claiming:

- The audit-named drift is mechanically fixed and the `openwop-check` gate enforces non-divergence going forward.
- The audit-named conformance freshness gap is closed; all 4 reference hosts have fresh v1.4.0 numbers + published taxonomy.
- The audit-named Active-RFC concern has a published carve-out path (RFC 0042) + per-RFC application table.
- The audit-named governance-policy gap has a published policy document (RFC 0043), ratifiable the moment the WG forms.
- The audit-named sandbox + multi-region + cross-engine + replay-determinism + secret-leakage harness gaps have published accountability artifacts with named PRs / effort estimates.
- The audit-named external-audit gap has a published calendar commitment with a fallback (interim summary) if vendor selection slips past 2026-09-30.

The audit was useful. The corpus is in better shape because of it. The "candidate protocol → finished standard" arc has a concrete next-step map.

---

## How to verify this response

Every claim above maps to either (a) a commit SHA, (b) a doc path in this repo, or (c) a date in the steward's published calendar.

```bash
# 1. openwop-check is green
git checkout 5864a2f  # or any commit at or after 2026-05-22
bash scripts/openwop-check.sh        # exits 0

# 2. Internal consistency
# Use the strict regex form so the count isn't perturbed if a future
# editor adds a comment header containing the substring "tier: protocol".
diff <(grep -cE '^    tier: protocol$' SECURITY/invariants.yaml) <(echo 59)
diff <(grep -cE '^    tier: reference-impl$' SECURITY/invariants.yaml) <(echo 30)
diff <(grep -oE '[0-9]+ protocol-tier' README.md) <(echo "59 protocol-tier")

# 3. Conformance freshness
cat docs/CONFORMANCE-RUNS-2026-05.md
# Run any of the 4 reproduction recipes (in-memory / sqlite / postgres-pglite / python)

# 4. Phase 4 progress
cat docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md

# 5. Policy + carve-out RFCs
ls RFCS/0042-experimental-capability-tier.md
ls RFCS/0043-registry-and-extension-policy.md

# 6. External-audit calendar
cat SECURITY/external-audit-engagement.md
# §1.9 of THIS doc lists the binding dates
```

---

## See also

- `docs/CONFORMANCE-RUNS-2026-05.md` — audit-Bar item 4 deliverable.
- `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md` — audit-Bar item 5 deliverable.
- `RFCS/0042-experimental-capability-tier.md` — audit-Bar item 3 deliverable.
- `RFCS/0043-registry-and-extension-policy.md` — audit-Bar item 7 deliverable (policy half).
- `docs/KNOWN-LIMITS.md` — pre-existing public honesty catalog this response builds on.
- `docs/PROTOCOL-STATUS.md` — regenerated reference for current corpus state.
- `INTEROP-MATRIX.md` — fresh v1.4.0 pass-rate table.
- `ROADMAP.md` — external-action tripwires (SEC-1 / SEC-7 / SEC-8 / GOV-1 / GOV-6 / GOV-7 / GOV-8).
- `SECURITY/external-audit-engagement.md` §2.1.1 — pre-audit publication decision context.
- `GOVERNANCE.md` §"Path to working group" — tripwire that gates WG ratification (and thereby `RFCS/0043` activation).
- Commit `5864a2f` — the 2026-05-22 sandbox revert that closed the audit's headline gate failure.

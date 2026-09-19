# RFC 0189: the normative home of a v2 core family — and the gate that was measuring nothing

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0189                                                            |
| **Title**         | `normativeText` as a checkable declaration field: legal homes, a content predicate, a ratchet that does not punish honesty, and a deadline that can actually fire |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-18                                                      |
| **Updated**       | 2026-09-18 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: no wire surface, no identity or auth surface, no MUST strength changes — this RFC governs a gate over a source artifact.) |
| **Affects**       | `scripts/check-v2-normative-home.mjs` · `docs/normative-home-baseline.json` · `spec/v2/declaration.json` (`normativeText` populated for four families) · `.github/workflows/pending-suite-release.yml` (the daily clock) |
| **Compatibility** | `editorial + gate` (COMPATIBILITY.md): no wire artifact, no schema shape, no endpoint contract, no error meaning, no MUST relaxed |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

> **Amended 2026-09-19 (G6, G7).** §B.4's facet-coverage predicate tolerates a dotted prefix on the family key (`Capabilities.limits.maxBudgetTokens` names the facet); §D's fallback compares a carried target's `Status:` banner against the one recorded when it was carried, rather than testing whether it currently reads `Stable`/`FINAL` — §D says "changes", and the state test was already failing on a banner that never changed. Both in place while `Active` (RFC 0174 §A.4).

> **Amended 2026-09-18 by RFC 0190** (in place, legal while `Active` — RFC 0174 §A.4 restricts the new-RFC requirement to `Accepted` RFCs). Two changes: **§A** — `spec/v2/ext/**` is a CO-POINTER that contributes facet coverage only; it may no longer satisfy §B(b)/(c), because an ext-only home resolved a core family with zero words in `core/` and resolved `authorization` against thirteen unrelated ext READMEs. **§D** — the fallback this RFC named is now APPLIED rather than printed; the gate previously described it and exited 1 regardless, with `v1Carried` read and never used. That is the defect this RFC's own Motivation exists to end, committed by this RFC.

## Summary

`check-v2-normative-home.mjs` asks whether every v2 core family's behaviour survives v1 end-of-support. It shipped four days before this RFC with no RFC of its own, a content check that accepted any file that exists, a ratchet that failed on the first honest declaration, and a deadline it printed but never compared. This RFC gives it a contract and fixes all four.

## Motivation

**The deadline could not fire, for two independent reasons.** The script computed `days` remaining and never compared it to anything; and nothing scheduled the gate — `openwop:check` runs on push and pull request only. Its own output said the count *"becomes one on the date, silently, unless this number reaches zero first."* That sentence described a check the code did not perform. This corpus has been burned by exactly that shape twice, and both times wrote the lesson into the workflow header that caught it.

**The ratchet rewarded silence.** It failed when `v1Dependent` rose — which is precisely what the first *honest* declaration does. Recording that a family's behaviour genuinely lives in `spec/v1/` moves it out of `undeclared` and into `v1-dependent`: information gained, total debt unchanged, gate exits 1. The cheapest way to keep it green was to declare nothing, on 70 of 72 rows.

**`existsSync` was the entire content check.** `normativeText: ["README.md"]` on all 72 families would have printed `72 resolved` and exited 0.

**And the gate had no RFC**, so `check-falsifiability.mjs` and `check-accepted-predicate.mjs` — both strict for RFC ≥ 0167 — could not see it. A gate invisible to the corpus's own acceptance predicate is the same class of artifact this gate exists to catch.

## Proposal

### §A The legal home classes

| Class | Path | Verdict |
| --- | --- | --- |
| core | `spec/v2/core/<doc>.md` | **resolved** |
| ext | `spec/v2/ext/<family>/<doc>.md` | **resolved** |
| schema | `schemas/v2/*.json`, `spec/v2/facets/*.json` | **co-pointer only** — MUST NOT be a family's sole home |
| v1 | `spec/v1/**` | **v1-dependent** — declared, counted, honest |
| RFC | `RFCS/NNNN-*.md` | **refused** |
| other | anything else | **refused** |

A schema may co-point but never stand alone: RFC 0174 §E.2a parks rationale in schema `description`/`$comment` precisely because the word budget does not count them, and a schema-only home turns that escape hatch into a licence to have no prose. An RFC is refused because `owningRfc` already records it, and because §A.4 makes the RFC set history rather than operative text.

**A declaration site cannot be its own behaviour home.** Every core family's `section` is already `core/capabilities.md#<key>`, and every one of those bodies is a one-line stub naming the witness class and owner. Accepting `spec/v2/core/capabilities.md` would resolve all 72 families for free and make the gate `section` spelled twice.

### §B The content predicate

A declared home MUST:

1. **exist** — a pointer to a missing file reads as resolved and is not (this rule predates the RFC and is kept unchanged);
2. **name the family** as a token in at least one non-schema target;
3. **carry an obligation about it** — an RFC 2119 keyword in a paragraph that also names the family. Paragraph scope, not document scope: document scope passes on almost any `spec/v2/core/*.md`.

Rules 2 and 3 are hard failures, because they are authoring errors rather than debt.

**Facet completeness (§B.4) is counted, not failed.** Every facet in a family's `facets[]` should appear in the union of its targets; the count of those that do not is the third ratchet, `facetsUncovered`. Counting rather than failing keeps a family whose base contract is fully v2-resident from being blocked by one orphaned facet — while still making facet orphaning a number that may only fall.

The predicate's shape follows `check-declaration.mjs`, which already requires an `ext/<key>/README.md` to contain the literal tokens `witness:`, `technical:` and `adoption:`. This is the house style, not a new invention.

### §C The ratchet

Let `Δu` be the change in `undeclared` and `Δv` the change in `v1Dependent`.

> **FAIL if `Δu > 0`, or if `Δu + Δv > 0`, or if `facetsUncovered` rises.**

`v1Dependent` alone is **unconstrained upward**. Converting an undeclared family into an honestly v1-dependent one gives `Δu = −1, Δv = +1`, sum zero — it passes, which is the whole point. A genuinely new family declared straight into `spec/v1/` gives `Δu = 0, Δv = +1`, sum `+1` — it fails, correctly.

### §D The deadline

The comparison is implemented, and three things make it honest:

1. **It is opt-in (`--deadline`)** and runs daily on `main`, not on pull requests. Reding a contributor's unrelated PR because a date passed punishes the wrong person and teaches everyone that red means nothing.
2. **It is a burn-down, not a cliff.** `docs/normative-home-baseline.json` records `t0` and `openAtT0`; the allowed open count decays linearly to zero at the end-of-support date. A schedule that only fails on the last day is a statistic, not a deadline.
3. **The fallback is named rather than discovered.** This RFC cannot move the date — `evidence/v1-end-of-support.json` is generated from the INTEROP-MATRIX and bundle history, and nothing else may set it. So: at end-of-support, `spec/v1/**` is **frozen-but-operative** for exactly the families listed in `v1Carried`. End-of-support ends *new v1 wire support*; it does not de-normativize prose a v2 family still points at. After the date the gate fails only if one of those targets is **deleted or its `Status:` banner changes** — which is the real hazard the original sentence was reaching for.

## Compatibility

`editorial + gate`. No wire artifact, schema shape, endpoint contract, error meaning or MUST strength changes. `normativeText` is an existing optional field in `declaration.schema.json`; this RFC populates it and makes it checkable. Per RFC 0174 §C.2 the first bite is recorded rather than hidden: this PR re-seeds the baseline, and the three sabotage checks below are the evidence that each rule bites.

## Conformance

Corpus-gate only. Sabotage-proved at filing:

- `normativeText: ["README.md"]` → refused as not a normative home (before: `resolved`).
- `normativeText: ["spec/v2/core/capabilities.md"]` → refused as the declaration site (before: `resolved`).
- an honest `spec/v1/` declaration → **passes** (before: `FAIL — a ratchet grew`).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A a refused class is refused | `openwop.requirement.0189.home-class` — a declaration naming `README.md`, an RFC, or the declaration site fails the gate by name | a corpus PR | witnessable — unaided (corpus) |
| §B a home names its family and carries an obligation | `openwop.requirement.0189.content-predicate` — a target that mentions the family with no RFC 2119 keyword in the same paragraph fails | a corpus PR | witnessable — unaided (corpus) |
| §C the ratchet does not punish honesty | `openwop.requirement.0189.ratchet-monotone` — moving a family from `undeclared` to `v1-dependent` passes; raising the sum fails | a corpus PR | witnessable — unaided (corpus) |
| §D the deadline can fire | `openwop.requirement.0189.deadline-live` — with `--deadline` and a date past end-of-support, the gate exits 1; the daily workflow step runs it | the steward's daily job | witnessable — unaided (corpus) |

## Alternatives considered

**Delete the deadline entirely.** Tempting, since it could never fire and a false claim is worse than no claim. Rejected: the clock is real even though the cliff was not, and 72 families with no v2 home is a fact someone should learn about while it can still be acted on. Delete the cliff, keep the clock — and delete the sentence that lied about it, which this RFC does regardless.

**Derive `normativeText` instead of declaring it.** Rejected, and the gate's own author already argued this: the family key's textual references do not identify the document that carries its rule. Hand-declaration is what makes the field worth checking.

**Assert the target contains the family's `§` heading.** Rejected as too narrow — `spec/v2/core/webhooks.md` carries the `webhooks` family's whole contract without a `§ webhooks` heading anywhere in it.

## Unresolved

**68 families remain.** Four are declared here; the review that scoped this RFC verified that five more have their base contract in v2 but at least one facet written only in `spec/v1/`, and that `eventLog` — which `openwop-core-standard` **requires** — has no v2 normative text at all. That last one is a live profile-honesty problem independent of the end-of-support date, and it is the next tranche's first item.

## Acceptance criteria

- [x] `Draft → Active`: the four rules implemented, the baseline re-seeded with `t0`/`openAtT0`/`facetsUncovered`/`v1Carried`, the daily `--deadline` step, four families declared, and each rule sabotage-proved. (This PR.)
- [ ] `Active → Accepted`: `facetsUncovered` has NOT RISEN, and `undeclared + v1Dependent` is strictly below its filing value, demonstrating the ratchet admits real progress and not only paperwork. (Amended 2026-09-18: the original said BOTH strictly below their filing values. `facetsUncovered` filed at **0** and §C forbids it rising, so "strictly below 0" was unsatisfiable — this RFC could never have flipped, however many families landed. Amended in place while `Active`, which RFC 0174 §A.4 permits.)

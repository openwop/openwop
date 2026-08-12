# RFC 0147 — self-audit against its own program invariants

**Status: living record. Updated 2026-08-12.**

RFC 0147 §A states ten invariants that "apply to every workstream." This document
records, for each, whether the program currently satisfies it — including where it
does not.

It exists because §A.10 forbids using the RFC's existence or partial implementation
as evidence its gaps are closed. A program that audits everything except itself has
the same defect it was written to fix, one level up. The uncomfortable rows are the
reason to keep the file.

Dispositions use RFC 0148 §A's vocabulary deliberately: **silence is not compliance**.
An invariant with no row is uncovered, not satisfied.

---

## A.1 — Freeze non-essential optional wire growth

**Disposition: satisfied, and narrower than it first reads.**

The freeze runs "until Workstreams 1–3 are Accepted **and** every Critical risk in the
companion register is Closed or transferred." Workstreams 1–3 (RFCs 0148/0149/0150)
are `Accepted`; the Critical risks are **not** all closed — R14 in particular
("no independent maintainers volunteer") is open, and its own mitigation says to
"pause standards claims and optional RFC growth."

So the freeze still binds. It does **not** block RFCs 0151–0154: §Summary frames it as
freezing non-essential growth *"while nine named workstreams repair"* the corpus, and
0151–0154 **are** workstreams 4–6. The freeze protects the program from surface
expanding underneath it; it is not a bar on the program's own repairs.

It does mean **no optional wire capability outside the nine workstreams may land** until
R14 and its peers close — and R14 closes by someone volunteering, which this repository
cannot deliver.

## A.2 — Five reviews before `Draft → Active`

**Disposition: not satisfied, and not recoverable retroactively.**

All ten RFCs went `Draft → Accepted` in a single change (#951) without a recorded
Spec/Schema/Security/Conformance/Compatibility review per RFC. For 0151–0154 the Schema
and Conformance reviews could not have been completed in any case: there are no schemas
and no conformance to review.

## A.3 — Non-vacuous execution witness for every normative behavioral requirement

**Disposition: partially satisfied, and this is the invariant the program has served best.**

Landed with real witnesses: the certification floor (0148 §C), the requirement ledger
(0148 §A), strict behavior (0148 §B), the OpenAPI resolution fix and wrapper lint
(0149 §A/§B), version grammar (0149 §C), lifecycle coherence (0149 §D), family
shadowing (0149 §E), effect identity and cross-scope identity (0150 §B), multi-region
vocabulary (0150 §D), the digest and its golden vectors (0150 §C), and the core
manifest and extension registry (0155 §B/§C).

**Where the witness is corpus-structural rather than host-observed, it is labelled as
such** — gaps G8, G9, G10 record exactly which claims a wire probe cannot reach and why.
That labelling is the invariant working, not a shortfall against it.

0151–0154 have no witnesses because they have no implementation.

## A.4 — Every claim names version, profile, suite version, date, counts

**Disposition: partially satisfied.**

The certification bundle carries suite version, host identity, discovery digest, and
pass/fail lists. It does **not** yet carry executed-assertion or skip/inapplicable
counts — that is bundle v2 (0148 §C), which is carried.

## A.5 — No `Accepted` on shape-only evidence for a behavioral requirement

**Disposition: VIOLATED.**

RFCs 0151, 0152, 0153, and 0154 are `Accepted` with **no evidence at all** — not
shape-only evidence, none. No spec prose, no schema, no conformance. §A.5 additionally
requires that "at least one host MUST execute every normative behavioral path in strict
mode," and no host executes any path for these four.

Their acceptance criteria now say so inline (#956), so the RFCs no longer imply
otherwise. That makes the record honest; it does not make the invariant satisfied.

## A.6 — High-risk RFCs complete the full public comment window; bootstrap waivers MUST NOT shorten it

**Disposition: VIOLATED.**

§A.6 names the high-risk surfaces explicitly: identity, authorization, isolation,
idempotency, replay, external effects, certification.

| RFC | High-risk surface | Window |
| --- | --- | --- |
| 0148 | certification | waived |
| 0150 | idempotency, replay, external effects | waived |
| 0152 | identity/authorization in A2A composition | waived |
| 0153 | identity/authorization in MCP composition | waived |
| 0154 | identity, authorization, provenance | waived |

All five were waived under `MAINTAINERS.md` §"Bootstrap-phase RFC waivers" — **the exact
mechanism §A.6 says must not shorten these windows.**

The available technicality is that RFC 0147 was itself `Draft` at the instant of the
flip and became `Accepted` in the same change, so §A.6 arguably was not yet in force.
**That argument is recorded and not relied upon.** It is the shape §A.10 exists to
forbid: reading the program's own partial state in whichever direction is convenient.

The steward waived knowingly and holds that authority. What §A.6 costs is not the
decision but the claim — these five RFCs cannot be cited as having cleared a high-risk
review window, because they did not.

## A.7 — Safety-fix migration package

**Disposition: satisfied for every safety-fix that landed.**

0150 §B and §D and 0149 §C each shipped detection (conformance scenarios covering the
old and corrected shapes), a `version-negotiation.md` runbook section, and a CHANGELOG
entry stating the correctness argument. Migration tooling was not required: the §E
inventory established that no host implements the retired recipes.

## A.8 — Machine-readable examples extracted and validated

**Disposition: not satisfied.**

0149 §B lints discovery-example layout and 0150 §D catches unparseable ```json fences,
but normative examples are still not extracted into fixtures and validated against the
canonical schemas. A fenced example remains prose to most of the corpus.

## A.9 — Update INTEROP-MATRIX, KNOWN-LIMITS, PROTOCOL-STATUS when evidence changes

**Disposition: partially satisfied.**

`docs/PROTOCOL-STATUS.md` is regenerated on every change and gated. `INTEROP-MATRIX.md`
and `docs/KNOWN-LIMITS.md` have **not** been swept against the evidence this program
produced.

## A.10 — MUST NOT cite this RFC's existence or partial implementation as evidence

**Disposition: satisfied, and this document is part of how.**

Each landed section states what it did **and did not** prove. Corpus-structural
witnesses are labelled rather than described as host evidence. The two VIOLATED rows
above are recorded here rather than left to be discovered.

---

## Summary

| Invariant | Disposition |
| --- | --- |
| A.1 freeze | satisfied (still binding; R14 open) |
| A.2 five reviews | not satisfied |
| A.3 non-vacuous witness | partially satisfied |
| A.4 claim completeness | partially satisfied |
| **A.5 no shape-only Accepted** | **VIOLATED** |
| **A.6 high-risk window** | **VIOLATED** |
| A.7 safety-fix package | satisfied |
| A.8 example extraction | not satisfied |
| A.9 doc sweep | partially satisfied |
| A.10 no self-citation | satisfied |

Two violations, three partial, two unsatisfied, three satisfied.

**The exit criteria in RFC 0147 are not met**, and nothing in this corpus should be read
as claiming otherwise. Three of the remaining gates — an external audit, a second
maintainer, and a Tier-3 host — cannot be closed by work in this repository at all.

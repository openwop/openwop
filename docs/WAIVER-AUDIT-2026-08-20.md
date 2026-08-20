# Bootstrap-waiver audit — 2026-08-20

> **Why this exists.** The RFC 0147 §A.1 wire freeze was found to be binding the
> project without the steward's knowledge, and to have been accepted outside the
> authority it cited. The obvious next question was whether §A.1 was unusual or
> typical. **It is typical.** This is the sweep.
>
> **Nothing here reverses an RFC.** The findings are recorded; the remedy is the
> steward's, and the corpus already specifies what it is (§4).

## 1. What the waiver actually grants

`MAINTAINERS.md` §"Bootstrap-phase RFC waivers", verbatim:

> Per `CONTRIBUTING.md` §"Bootstrap-phase notes," **additive** RFCs MAY be promoted
> **Draft → Active** by steward decision when the comment window would only serve as a
> delay against zero external reviewers.

Two constraints: the RFC must be **additive**, and the promotion is **Draft → Active**.
Neither is decorative — `Active` locks a wire shape, `Accepted` asserts deployed evidence,
and a `safety-fix` by definition changes behaviour a conforming host was entitled to rely on.

## 2. What the waiver was used for

**41 RFCs** reached `Accepted` under a waived comment window (derived from the tree by
`generate-assurance-status.mjs`).

**Five are confirmed outside both constraints** — non-additive *and* promoted to `Accepted`:

| RFC | Compatibility class | Status |
| --- | --- | --- |
| **0147** Protocol Integrity and Standards-Readiness Program | Umbrella **`safety-fix`** | `Accepted` |
| **0148** Non-Vacuous Conformance and Certification Evidence | **`safety-fix`** | `Accepted` |
| **0149** Machine-Contract and Version Reconciliation | **`safety-fix`** | `Accepted` |
| **0150** Effect Identity, Replay, and Split-Brain Safety | **`safety-fix`** | `Accepted` |
| **0156** Governance, Independent Assurance, and Claims Policy | Governance/process | `Accepted` |

That is **the entire RFC 0147 program spine**: the umbrella, all three of Workstreams 1–3,
and the governance RFC that defines the claims policy.

**Six more could not be classified** by the header parse used here — 0106, 0108, 0109,
0110, 0121, 0124 — because their `Compatibility` field is laid out differently. They are
listed as *unclassified*, not as violations. Someone should read them.

## 3. Two compounding problems

### 3.1 RFC 0147 exempted itself from its own rule

§A.6 of RFC 0147:

> A high-risk RFC affecting identity, authorization, isolation, idempotency, replay,
> external effects, or certification **MUST** complete the full public comment window.
> **Bootstrap waiver language MUST NOT shorten that window.**

RFC 0147's own `Affects` field names `idempotency.md`, `replay.md`, `auth.md`, and
`capabilities.md`. It was created 2026-08-11 13:42 and accepted 2026-08-12 12:50 — **23
hours** — under waived review. **It is the exact class its own §A.6 forbids waiving, and it
forbade it while being waived.**

### 3.2 The ledger that exists to make waivers auditable is missing half of them

`MAINTAINERS.md` says the section *"tracks every RFC that has used the waiver so future
maintainers can audit the velocity of bootstrap-phase decisions."*

**It holds 26 rows. The tree derives 41.** Twenty-one waived RFCs are absent from the ledger,
including every one of the five above:

`0043, 0101, 0103, 0105, 0106, 0108, 0109, 0110, 0121, 0124, 0147, 0148, 0149, 0150, 0151,
0152, 0153, 0154, 0155, 0156, 0157`

A hand-kept audit surface that drifts from the tree is the same defect class as everything
else this corpus has been repairing: **the artifact reports, but not on what its reader
assumes it measured.** The durable fix is to generate it, not to type twenty-one rows.

## 4. The remedy is already written down, and has never been applied to its author

RFC 0147 §I, line 193:

> high-risk RFC cohorts accepted under waived review **MUST** receive retrospective
> cross-organization review **or be explicitly reclassified as provisional**;

And its own unresolved question 7 asks *"Which already-Accepted high-risk RFC cohorts require
retrospective ratification?"*

**The answer includes RFC 0147's own cohort, and the rule has never been applied to it.**
The five RFCs in §2 are precisely "a high-risk cohort accepted under waived review."

Note what §I does *not* require: reversal. It offers cross-organization review **or**
reclassification as provisional. Cross-organization review is unavailable — there is one
maintainer in one organization, which is RFC 0147 R14, itself open and externally gated. So
**the only currently reachable branch is reclassification as provisional**, and that is a
steward decision.

## 5. What is not being claimed

- **Not that the work is wrong.** RFC 0148's disposition vocabulary, 0149's contract
  reconciliation and 0150's effect identity are implemented, witnessed, and load-bearing.
  The defect is in how they were *ratified*, not in what they say.
- **Not that the waiver was abused.** Every use is recorded in the RFC headers with a stated
  rationale. Nothing was concealed. The gap is that the granted authority was narrower than
  the practice, and nobody reconciled the two.
- **Not that this is the whole picture.** Six RFCs remain unclassified (§2), and this sweep
  read headers rather than diffs.

## 5b. One lesson worth keeping from how the freeze ended

An earlier proposal (`docs/proposals/0147-freeze-exit.md`, now removed) argued for rewriting
§A.1's exit condition because it looked self-blocking: the exit was gated on evidence the
freeze restricted the surface for producing. **That reading was wrong about which clause** —
Workstreams 1–3 were already `Accepted` — but the *shape* it described is real and will recur:

> **An exit condition expressed in internal statuses can be gated on evidence the condition
> itself restricts.** RFC 0158 §E declined to mint a capability because of the freeze, so no
> host could declare a rung, so rung claims accumulated no evidence — which is what would have
> moved a workstream toward the status the exit required.

The general form is worth carrying into any future gate: **prefer an exit stated in evidence
over one stated in statuses.** A status can be waived — 41 were. A non-vacuous witness on a
deployed host cannot.

## 6. Recommended, in order

1. **Generate the waiver ledger** from the tree instead of hand-keeping it, so §3.2 cannot
   recur. `generate-assurance-status.mjs` already derives the list.
2. **Widen or narrow the grant deliberately.** Either `MAINTAINERS.md` should permit what the
   project actually does — non-additive RFCs, to `Accepted` — with the risks stated, or the
   practice should stop. Today the text and the practice disagree, and the text loses silently.
3. **Apply §I to the 0147 cohort.** Reclassify the five as provisional pending retrospective
   review, or record a decision not to. Either is defensible; the current state — a rule that
   names this exact case and has never been applied to it — is not.
4. **Classify the six unclassified RFCs** by reading their headers.

# Proposal: give the RFC 0147 §A.1 freeze an exit expressed in evidence

> **Status: PROPOSAL — not adopted, not normative.** RFC 0147 is `Accepted`, its
> §A.1 freeze is in force, and changing it is the steward's decision. This
> document exists so that decision can be made against a written argument rather
> than reconstructed from a thread. **Nothing here changes the freeze.**
>
> Written 2026-08-19, prompted by an external protocol review.

## What §A.1 says

> The project **MUST** freeze new non-essential optional wire capabilities until
> Workstreams 1–3 are Accepted and every Critical risk in the companion register
> is Closed or transferred to an embargoed advisory.

The freeze is doing real work. It has held back at least four capability
proposals, and the corpus is measurably better for not having grown them.

## The structural problem

**The exit is expressed in RFC statuses, and the statuses are gated on evidence
the freeze prevents collecting.**

The clearest instance is RFC 0158 (durable execution and DR qualification). Its
§E declines to mint `capabilities.durability.rung` *because of the freeze* —
correctly, and the RFC says so. But the consequence is:

1. No host can advertise a durability rung, because there is no field.
2. Rung claims therefore accumulate no wire evidence.
3. Evidence is what moves a workstream toward `Accepted`.
4. `Accepted` is what lifts the freeze.

The RFC handled this well — it defers the advert and keeps the ladder useful
without one. But the loop is real, and it will recur for every capability whose
value is *measurement*.

The second half of the exit condition has the same shape from the other side.
**14 Critical risk rows are currently open**, and several are open specifically
because nothing witnesses them — RFC 0150 R1 (split-brain), RFC 0154 R1–R3
(proof format), RFC 0153 R1/R3. A risk that can only be closed by evidence, in a
program whose freeze restricts the surface on which evidence is produced, is not
converging.

## What this proposal does *not* argue

- **Not that the freeze was wrong.** It was right, and the corpus's own review
  found it "mitigated" the risk it targets.
- **Not for an "essential" carve-out.** That is a separate question, repeatedly
  raised and repeatedly declined, and this proposal is deliberately independent
  of it. If the carve-out is ever granted it should be granted on its own
  argument, not smuggled in through an exit criterion.
- **Not for lifting the freeze now.** The proposal is about *how the exit is
  expressed*, not about when it fires.

## Proposal: state the exit in evidence, not in statuses

Replace the status-shaped condition with an evidence-shaped one. Illustrative
form — the numbers are the steward's to set:

| Current condition | Proposed condition |
| --- | --- |
| Workstreams 1–3 `Accepted` | Every WS1–3 normative behavioural requirement has a **non-vacuous witness on at least one host**, or a recorded reason it is unwitnessable |
| Every Critical risk Closed or transferred | Every Critical risk Closed, transferred, **or carrying a named witness that would close it and the reason it has not run** |
| — *(no equivalent)* | **At least one conforming host outside this project** has published a bundle |

The third row is the substantive addition, and it is the one worth arguing about.
The freeze exists to stop the corpus growing faster than it can be validated.
**The most direct measure of whether validation has caught up is not an internal
status — it is whether anyone outside the project can implement what is already
there.** An exit that includes it makes the freeze self-limiting in the right
direction: the way out is adoption, which is also the outcome the program wants.

## Why "evidence-shaped" is not a loosening

An evidence-shaped exit is **harder** to satisfy than a status-shaped one, not
easier. A status can be flipped by a maintainer with a waiver — 41 RFCs reached
`Accepted` under a waived comment window. A non-vacuous witness on a deployed
host cannot be waived; it either ran or it did not.

## A narrower alternative, if the above is too much

Keep §A.1 unchanged and add one sentence: **a capability whose sole purpose is to
make an existing normative requirement witnessable is not "new wire growth" for
the purposes of the freeze, provided the requirement predates it.**

This is narrower than an essential carve-out — it licenses nothing an
implementer can *use*, only something a verifier can *read* — and it breaks the
specific loop above without touching the general rule. It would need its own
review; the risk is that "makes a requirement witnessable" is arguable about
almost any advert, and the corpus would need a test for it sharper than good
intentions.

## What the steward is being asked to decide

1. Should the exit be expressed in evidence rather than in RFC statuses?
2. If yes, should an independent implementation be part of it?
3. If not the full change, is the narrower witnessability sentence worth taking
   on its own?

**No action follows from this document.** If none of the three is adopted, the
freeze stands exactly as written, and this file should be retired with a line
saying it was considered and declined — which is a better record than deleting
it.

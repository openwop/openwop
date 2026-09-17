# `spec/v2/ext/` — extension families

> **Status: Stable · 2026-09-17 · RFC 0177 §E (this file), RFC 0174 §E.2.** This README is the one place the extension tail's *maturity* rule lives. It is not counted against the `spec/v2/core/` word budget.

## Why this exists

Seventeen extension documents shipped `Status: Draft` on the day v2 was tagged, and nothing in the corpus said what moves one. RFC 0177 owns *declaring* an extension family; the step after "declared" was unwritten, so every family stayed Draft by default rather than by decision. A status that can only go one way is not a status.

## The rule

An extension document under `spec/v2/ext/<name>/` carries a `Status:` header with one of three values. Movement between them is a **predicate over evidence**, checked by `scripts/check-ext-status-coherence.mjs` in the corpus gate:

| Status | Meaning | Predicate |
| --- | --- | --- |
| `Draft` | Declared. A host MAY advertise it; the corpus makes no claim about it. | The family is declared in `spec/v2/declaration.json` with `anchor: ext`. |
| `Stable` | Witnessed. At least one host at evidence tier 2 or better serves it, and a **certified** bundle in `evidence/v2-host-bundles/` records the family's declared witness class satisfied. | Every `Stable` doc's family has ≥ 1 `executed-pass` row under its witness id in a bundle whose relevant profile claim is `certified: true`, **and** the 7-day comment window has run since the promotion PR. |
| `Retired` | Withdrawn. The family is removed from the declaration and the document names its replacement or the RFC that retired it. | The family is absent from the declaration; the doc carries a `Superseded by:` or `Retired by:` line. |

Two consequences the gate enforces, both directions:

- A `Stable` document whose family **no longer** has a certified passing row is a defect — the gate goes red, and the honest move is to demote to `Draft` with the date, not to find a bundle.
- A `Draft` document whose family **does** have a certified passing row is reported as **graduable** (a warning, not a failure): the evidence exists and the steward has not acted on it. That is the state this README was written to end.

A family with no directory here (the four `ext/` directories with no declared family — `grpc-transport`, `portability`, `provider-idempotency`, `sandbox-runtime-notes` — are notes, not families) is outside this rule and MUST say so in its own header.

## What this does not decide

Whether an `ext` family should ever become `core`. That is an RFC 0167-family question (a core family costs budget and needs a codemap row); this file only governs the tail.

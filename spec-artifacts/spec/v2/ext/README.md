# OpenWOP v2 extensions

> **Status: Stable.**

This page defines the maturity labels that extension documents carry.
Extensions are outside the core profile unless a core document explicitly
incorporates them.

Each declared extension has a page at `spec/v2/ext/<name>/README.md` and a row
in [`../declaration.json`](../declaration.json). A row reserves the identifier;
it does not make the extension interoperable. Read the individual page to see
whether it defines portable behavior or only a discovery claim.

## Maturity labels

`scripts/check-ext-status-coherence.mjs` checks these labels against committed
conformance evidence.

### `Draft`

Declared, but without qualifying interoperability evidence.

**Predicate:** The family is declared in `spec/v2/declaration.json` with
`anchor: ext`.

### `Stable`

Witnessed: at least one host at evidence tier 2 or better serves it, and a
**certified** bundle in `evidence/v2-host-bundles/` records the family's
declared witness class as satisfied.

**Predicate:** The family has at least one `executed-pass` row under its
witness id, in a bundle whose relevant profile claim is `certified: true`, and
the seven-day comment window has run since the promotion PR.

### `Retired`

Withdrawn: the family is removed from the declaration, and the document names
its replacement or the RFC that retired it.

**Predicate:** The family is absent from the declaration, and the document
carries a `Superseded by:` or `Retired by:` line.

The check works both ways:

- A `Stable` document without qualifying evidence fails validation.
- A `Draft` document with qualifying evidence is reported as eligible for
  review and promotion.

A directory with no declared family is an implementation or migration note and
MUST identify itself as outside this maturity rule. Today that is
`grpc-transport`, `portability`, `provider-idempotency`, and
`sandbox-runtime-notes`.

## What this does not decide

Whether an extension should become core. That takes a separate RFC, normative
text, machine-readable contracts, and a behavioral witness.

*Sources: RFC 0174, RFC 0177.*

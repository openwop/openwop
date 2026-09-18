# RFC 0191: a home declares the family, and the family declares the home

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0191                                                            |
| **Title**         | the reciprocal normative-home marker: why no regex over prose can decide a semantic claim, and what to do instead |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-18                                                      |
| **Updated**       | 2026-09-18 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: no wire surface, no identity or auth surface, no MUST strength changes — this RFC governs a gate over source artifacts.) |
| **Affects**       | `scripts/check-v2-normative-home.mjs` · `spec/v2/core/*.md` (nine documents gain a marker line) |
| **Compatibility** | `editorial + gate` (COMPATIBILITY.md): no wire artifact, no schema shape, no endpoint contract, no error meaning, no MUST relaxed |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0189 §B decides whether a declared home really carries a family's behaviour by looking for the family's key and an RFC 2119 keyword in one paragraph. A family key that is a common English noun is satisfied by prose that merely uses the word. This RFC adds the reciprocal half — the document must itself claim the family — and states plainly that the result makes a false declaration explicit rather than impossible.

## Motivation

`normativeText` is a **semantic claim**: this document is where a reader learns what this family obliges. The gate's own docblock already says derivation gets it wrong, which is why the field is hand-declared. The §B predicate then tried to decide that semantic claim syntactically, and a common noun defeats it.

Measured at corpus 2.11.0 with the gate's own predicate over `spec/v2/core/*.md`, counting documents with an obligation paragraph naming the family:

| family | documents |
| --- | --- |
| `replay` | 9 — including `security-defaults.md`, `webhooks.md`, `idempotency.md` |
| `interrupt` | 9 — including `security-defaults.md`, `errors.md`, `identity.md` |
| `idempotency` | 8 |
| `content` | 8 — undeclared, and a common noun |
| `packs` | 7 — including `security-defaults.md` and `versioning.md` |

Resolving `packs` in 2.10.0 did not move its number. A contributor under the RFC 0189 §D burn-down can resolve `packs` against `security-defaults.md` — a document that says nothing about the packs family's contract — and the gate applauds.

**Four syntactic candidates were measured against all eleven declared families and a 24-case known-bad set. All four failed.**

| predicate | declared families kept | known-bad accepted |
| --- | --- | --- |
| current (§B as shipped) | 11 / 11 | 24 / 24 |
| key in backticks, in the obligation paragraph | 7 / 11 | 7 / 24 |
| backticked anywhere + named in the paragraph | 8 / 11 | 7 / 24 |
| key token in any heading + current | 5 / 11 | 0 / 24 |
| key token in the H1 + current | 0 / 11 | 0 / 24 |

The backtick variants fail because honest prose names a family **in words**: a document about `connections` is titled "Connection Packs", one about `forms` is "Form Content Packs", one about `replay` is "Replay and Fork". The heading variants fail for the same reason. Word-normalising the heading matcher fixes those false negatives and immediately admits `replay` ← `webhooks.md` §"Replay" and `idempotency` ← `headers.md` §"`Idempotency-Key`". A concentration ratchet — the home must carry at least as many obligation paragraphs as any other document — is satisfiable today only with ties allowed, and makes editing `runs.md` break `interrupt`'s home.

No syntactic predicate over prose satisfies both constraints. That is the finding, and it is why this RFC does something else.

## Proposal

### §A The reciprocal marker

A declared `spec/v2/**` home MUST itself claim the family. In a core document, a line under the Status banner:

```
> **Normative home:** `packs`.
```

In an ext README, a row in the existing header table:

```
| **homes:** | `packs` |
```

The ext form matches the `witness:` / `technical:` / `adoption:` rows `check-declaration.mjs` already requires. RFC 0189 §B named this shape as the house style; this RFC applies it in the other direction.

§B(b) and §B(c) are unchanged. A home now has three parts: the document **claims** the family, **names** it, and **obligates** it.

`spec/v1/**` targets are exempt. v1 prose is frozen-but-operative (RFC 0189 §D) and must not be edited for v2 bookkeeping. This is not a hatch: a v1-dependent family still counts in `open = v1Dependent + undeclared`, so routing through v1 buys nothing against the burn-down.

### §B What this does and does not achieve

It does **not** make a false declaration impossible. A contributor can edit `security-defaults.md`'s header to claim it homes `packs`.

**That is the intended shape.** The cheapest green path becomes writing an explicit false statement into a document whose own prose contradicts it — in the pull-request diff, in a file CODEOWNERS routes to the lead maintainer. A check's job here is not to make the claim undeniable; it is to make it **explicit, local and reviewable**. Claiming mechanical soundness for a marker would be the exact defect RFC 0189's Motivation exists to end: a sentence describing a guarantee the code does not provide.

## Compatibility

`editorial + gate`. No wire artifact, schema shape, endpoint contract, error meaning or MUST strength changes. Nine core documents gain one line each; the seeding edit lands in the filing PR, because a predicate whose corpus does not satisfy it is not yet a rule.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A a home claims its family | `openwop.requirement.0191.home-marker` — declaring a family against a document with no matching `Normative home:` marker fails by name, with the line to add | any contributor, by declaring a home | witnessable — unaided (corpus) |
| §A the known-bad cases are rejected | `openwop.requirement.0191.home-marker` — `packs` against `security-defaults.md`, and `idempotency` against `versioning.md`, are refused | any contributor | witnessable — unaided (corpus) |
| §A every honestly declared family still resolves | `openwop.requirement.0191.home-marker` — the eleven families declared at filing remain resolved with the seeded markers | the steward, by removing a marker | witnessable — unaided (corpus) |

## Alternatives considered

**Tighten the regex.** Four variants measured; all four either break honest declarations or keep the loophole. The table is in Motivation.

**A curated allow-list of (family, document) pairs.** Rejected: that is `normativeText` itself, stored twice, and the second copy would drift.

**Accept the weakness with no control.** Rejected: 61 families remain and the burn-down makes the cheap resolution attractive at exactly the moment the corpus can least afford it.

## Unresolved questions

**Q1.** RFC 0190 G3 — a facet name appearing incidentally in an unrelated ext page still counts as facet coverage. The marker constrains which ext documents a family may cite, which narrows this; it does not close it, because coverage is still a bare token match within a claimed document.

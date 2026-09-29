# RFC 0190: the kernel budget measures what the home gate accepts

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0190                                                            |
| **Title**         | the kernel budget's denominator follows the home gate's acceptance, and its cap grows only as debt is retired |
| **Status**        | `Accepted`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-18                                                      |
| **Updated**       | 2026-09-18 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: no wire surface, no identity or auth surface, no MUST strength changes — this RFC governs a gate over source artifacts.) · **Active → Accepted 2026-09-19.** Evidence tier: corpus gate — every requirement id in the falsifiability table carries a row in `evidence/corpus-ledger.json`, minted by `conformance/src/coherence/`. No host bundle is involved: these RFCs govern gates over source artifacts, and their witnesses are `witnessable — unaided (corpus)`. The cap has been exercised: families landed against it across 2.13.0–2.19.0 and the printed cap tracked `25,000 + 200 × (resolved − 9)` at each step. |
| **Affects**       | `scripts/check-core-budget.mjs` · `scripts/check-v2-normative-home.mjs` · `docs/normative-home-baseline.json` |
| **Compatibility** | `editorial + gate` (COMPATIBILITY.md): no wire artifact, no schema shape, no endpoint contract, no error meaning, no MUST relaxed |
| **Supersedes**    | RFC 0174 §E.2 and §E.2a — amends those two sections only; RFC 0174 otherwise stands as the v2 governance RFC |
| **Superseded by** | —                                                               |

## Summary

The kernel budget counted `spec/v2/core/*.md` non-recursively against a flat 25,000 words. RFC 0189 then required all 72 core families to declare a normative home before v1 end-of-support, and the two rules turned out to be in arithmetic contradiction: 61 families needing roughly 9,170 words, with 164 left. Worse, the cheapest way to satisfy the home gate was to file the prose somewhere the budget did not look. This RFC makes the budget measure exactly what the home gate accepts, and lets the cap grow only as families are actually homed.

## Motivation

**The denominator did not follow the gate's acceptance.** `check-v2-normative-home.mjs` accepts `spec/v2/ext/**` as a home for a **core** family. `check-core-budget.mjs` never counted it. So a family's entire contract could move to `ext/` and resolve at **zero budget cost, with no stub left in `core/` at all** — sabotage-proved: a 242-word `spec/v2/ext/agentsX/README.md` resolved `agents` (19 facets), advanced the burn-down, and left the budget unmoved. `readdirSync` rather than a recursive walk made `spec/v2/core/<sub>/x.md` the same hole one directory shallower. Nobody had to intend this; it was simply the cheapest way to satisfy the gate, and the first author under burn-down pressure would have found it.

**The number was set against the wrong denominator.** §E.2a rejected raising the ceiling on 2026-09-17: *"16 core RFCs have landed against it, and the near-miss came from hurry, not from the number."* RFC 0189 was created the next day and converted 61 undeclared families into dated work. Measured against the four families actually written — `forms` 101, `idempotency` 107, `eventLog` 214 across two documents, `packs` 141; **563 words, mean 140.75** — the remainder needs on the order of **9,170** words. The ceiling had **164**. The rejection's stated basis is a claim about a denominator of 16 RFCs, not 61 families against a dated clock; it was falsified by information that did not exist when it was made. That is the only reason needed to reopen it, and reopening it is honest supersession rather than routing around a decision.

**A third rule was describing a check it did not perform.** RFC 0189 §D names a fallback — at end-of-support `spec/v1/**` is frozen-but-operative for the families in `v1Carried`, and the gate then fails only if one of those targets is deleted or its `Status:` banner changes. The gate **printed that paragraph and exited 1 regardless**. `v1Carried` was read into the baseline object and never used. So on 2026-12-04 the daily job would have gone permanently red even in the world §D calls acceptable. This is precisely the defect RFC 0189's own Motivation exists to end, committed by the RFC that named it.

## Proposal

### §A The measured set and the cap

**The measured set** is every document a `core`-anchored family's `normativeText[]` points at: `spec/v2/core/**` walked **recursively**, plus any `spec/v2/ext/**` document **cited by a core family**. Where a family's prose is filed is an editorial decision with no budget consequence.

This dissolves the question "is this the base contract or a facet detail?" rather than answering it — no gate could check that distinction, and any prose rule expressing it would be unenforceable. An ext document that no core family cites stays unbudgeted, correctly: it is the unwitnessed tail (RFC 0174 §E.2), not kernel.

**The cap** is `25,000 + 200 × (core families with a resolved v2 home − 9)`, where 9 is the count at this RFC. v1-dependent families are **not** counted — they still owe v2 text, and counting them would grant words for work not yet done.

The cap is **self-funding**: a family grants 200 and costs ~141, so declaring one leaves ~59 more headroom than before. That is what makes a 164-word starting position sufficient to bootstrap, and it forces cheap-first ordering — an expensive family waits until cheaper ones have funded it. At 72/72 the cap freezes at **37,600** and the forcing function returns permanently. It cannot be gamed to buy room: words arrive only when a family passes the §B predicate **and** the `facetsUncovered` ratchet, so a cheap declaration is not cheap.

A whole-kernel word cap remains the right instrument. It protects a reading-burden invariant — an implementer can read the entire front door in one sitting — that a per-document cap destroys (20 documents × 3,000 = 60,000) and a per-family allowance alone does not express.

### §B `spec/v2/ext/` is a co-pointer, never a sole home

An ext document contributes **facet coverage** (RFC 0189 §B(d)) and nothing else. The §B(b) naming predicate and the §B(c) obligation predicate are computed over `spec/v2/core/**` and `spec/v1/**` targets only.

This closes the zero-word resolution structurally rather than by incentive alone, and it closes a second hole the sabotage found: every declared ext README carries the boilerplate *"clients MUST NOT infer portable operations, payloads, or authorization semantics from its presence"*, which resolved the core `authorization` family against **thirteen** unrelated ext pages. Eight core families carry zero facets and would have had no `facetsUncovered` backstop at all.

### §C The RFC 0189 §D fallback is applied, not printed

At end-of-support the gate fails on exactly two things: a family with no declared home, or a `v1Carried` target that has been deleted or whose `Status:` banner is no longer `Stable`/`FINAL`. Otherwise it reports that the §D fallback applies and exits 0.

`docs/normative-home-baseline.json` `v1Carried` MUST equal the computed v1-dependent set. §C leaves `v1Dependent` unconstrained upward on purpose, so a family may become v1-dependent at any time; nothing checked that it also entered `v1Carried`, and `v1Carried` is what the fallback covers. A family could have been v1-dependent, uncovered, and green until the day the fallback ran.

`open` continues to count `v1Dependent + undeclared`. Excluding `v1Carried` was considered and rejected: `v1Carried` is a hand-written array edited by the same PR that declares, so excluding it would make "add your family to `v1Carried`" a zero-work way to lower `open`. Deriving it instead (`open = undeclared`) is the same hole with better manners — §C permits declaring an undeclared family *into* `spec/v1/`, so the burn-down could reach zero with 61 families pointed at v1 and no v2 words written. A fallback is what happens when you miss the target; it is not an exemption from the target.

## Compatibility

`editorial + gate`. No wire artifact, schema shape, endpoint contract, error meaning or MUST strength changes. What moves is a number in a corpus gate and the set of files it measures. Per RFC 0174 §C.2 the first bite is recorded rather than hidden: the denominator change raises the measured total the moment any core family cites an ext document, which is the point.

**Retroactive cost: zero.** No core family points at `spec/v2/ext/**` today, so nothing already declared has to be revisited under either §A or §B. That window closes the first time someone declares an ext home, which is why this lands before the next tranche rather than alongside it.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A the measured set follows the home gate | `openwop.requirement.0190.budget-denominator` — a document under `spec/v2/core/<sub>/`, or an ext document a core family declares, counts against the cap; an ext document no core family cites does not | any contributor, by filing prose in a subdirectory or declaring an ext home | witnessable — unaided (corpus) |
| §A the cap grows only as families are homed | `openwop.requirement.0190.budget-cap` — the printed cap equals `25,000 + 200 × (resolved − 9)`, and raising it requires a family that passes both the §B predicate and the facet ratchet | any contributor, by declaring a family | witnessable — unaided (corpus) |
| §B ext is a co-pointer, never a sole home | `openwop.requirement.0189.home-class` — a family whose only home is under `spec/v2/ext/` is refused by name | any contributor, by declaring an ext-only home | witnessable — unaided (corpus) |
| §C the §D fallback is applied rather than printed | `openwop.requirement.0190.fallback-applied` — past end-of-support the gate names an undeclared family, a deleted `v1Carried` target, or a changed `Status:` banner, and otherwise exits 0 | the steward, by moving the clock or editing a carried target | witnessable — unaided (corpus) |
| §C `v1Carried` matches the computed set | `openwop.requirement.0190.v1carried-matches` — a v1-dependent family absent from `v1Carried`, or a listed family that is no longer v1-dependent, fails by name | any contributor, by declaring a v1 home without updating the baseline | witnessable — unaided (corpus) |


## Acceptance criteria

- [x] `Draft → Active`: the measured set follows the home gate (`spec/v2/core/**` recursive plus ext documents a core family cites), the cap is `25,000 + 200 × (resolved − 9)`, `spec/v2/ext/**` is demoted to a co-pointer, and RFC 0189 §D's fallback is applied rather than printed — each sabotage-proved.
- [x] `Active → Accepted`: every requirement id in the falsifiability table carries a row in `evidence/corpus-ledger.json`, and the cap has been exercised by at least one family landing against it (a grant that is never spent is not a demonstrated instrument).

## Alternatives considered

**Adopt the granularity rule** — *"a core family's base contract lives in `core/`; facet-level detail MAY live in `ext/`"*. Rejected, and it was the working proposal until it was stress-tested. `spec/v2/ext/` is already defined by **witness class**, not by level of detail: RFC 0174 §E.2 makes it the tail for MUSTs that cannot be witnessed, and all 72 core families are witnessable or claims-check. Adding granularity as a second, orthogonal axis onto that directory is unenforceable as prose — no gate can distinguish a base contract from a facet detail — and under §E.2's existing meaning, moving a witnessed core family's MUSTs into `ext/` is already a violation. The rule would have codified the thing §E.2 forbids.

**Raise the flat cap.** Rejected: a one-time raise restores the same cliff at a higher number and grants words for work not yet done. The per-family term ties headroom to retired debt.

**Per-document caps.** Rejected: 20 documents × any plausible per-document cap far exceeds the whole-kernel figure, and the invariant being protected is the total reading burden.

**Leave the budget and let families resolve against existing prose.** Measured: 26 of 61 families would satisfy §B(b)+(c) today against prose that says nothing about them — `content` matches 8 core documents, `memory` 5, `cache` 5. Only 6 are genuinely free of uncovered facets. This is RFC 0189 gap G1, and the budget as it stood made the dishonest resolution the cheap one. Closing G2 in a way that increases pressure on G1 is not closing it.

## Unresolved questions

**Q1.** G1 remains open: `namesKey` is a bare token match, so a family key that is a common English noun is satisfied by prose that merely uses the word. Both obvious tightenings were measured and both misfire — requiring backticks fails 4 of the 7 families resolved at the time of filing. It is a soundness ceiling on every resolution after it and should land before the bulk tranche.

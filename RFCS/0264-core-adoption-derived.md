# RFC 0264: core-family adoption is derived from bundles, and an unwitnessed family has a review date

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0264                                                            |
| **Title**         | core-family adoption is derived from bundles, and an unwitnessed family has a review date |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-13                                                      |
| **Updated**       | 2026-11-13 — **`Draft` → `Active`, comment window waived by the maintainer** (David, 2026-11-13: "yes, skip the comment window, proceed with implementation"). STEWARD OVERRIDE of RFC 0147 §A.6, recorded in `MAINTAINERS.md`. Lands `scripts/derive-core-adoption.mjs`, `evidence/core-adoption-review.json`, the derived `maturity.adoption` values on core rows, the `capabilities.md` §8 cell, and the coherence scenario `v2-core-adoption-derived` (3 ids). Unresolved questions settled with the draft's answers (UQ 1: a retired host's last bundle keeps counting; UQ 2: three minors; UQ 3: shared code). Addresses finding P-015 of the August 2026 assessment. |
| **Affects**       | `spec/v2/declaration.json` (`maturity.adoption` on core rows), `spec/v2/core/capabilities.md` §8, new `scripts/derive-core-adoption.mjs`, new `evidence/core-adoption-review.json`, `scripts/openwop-check.sh` step 10, the regen chain |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (no wire shape changes; a generated schema `description` string changes) |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`spec/v2/core/capabilities.md` §8 says a family's `adoption` axis is "derived from INTEROP-MATRIX bundle evidence". For core families nothing derives it. All 69 experimental core rows in `spec/v2/declaration.json` read `adoption: none`. Yet the committed bundles show executed-pass rows for most of those families on one host or more. This RFC makes the derivation a script whose output the gate checks (§A). A core family that the script finds `none` then carries a review row with a date; when the date passes, the family is either re-dated with a reason or retired (§B). This closes finding P-015 of the 2026-08 assessment: surface outruns witnesses, and nothing in the corpus says so per family.

## Motivation

- **The declared axis is wrong, and nobody can see it.** A reader of the declaration, or of the generated `capabilities.schema.json` descriptions ("maturity experimental/none"), learns that no host serves 69 families. `derive-core-adoption.mjs`, run on 2026-11-13 over the three hosts with committed certified bundles (the reference host and openwop-app at tier 1, MyndHyve's legacy runtime at tier 2), gives these counts. None derives `independent`.

  | Hosts with an executed-pass gating row | Core families |
  | --- | --- |
  | 0 | 18 |
  | 1 | 24 |
  | 2 or 3 | 28 |

  The 18 at zero are the real finding. The 52 others are understated.
- **A hand-kept axis drifts.** RFC 0220 made the ext `Stable` predicate a script over bundles for this reason. Core adoption never got the same treatment, because core families have no `Stable` predicate to hang it on.
- **"Experimental, no adopter" has no exit.** A family can sit at `experimental/none` for the life of the major. Then nothing forces the question of whether the protocol should keep it. RFC 0255 §D (steward deletion) and COMPATIBILITY.md §3a (retirement) give a way to remove a surface. Nothing tells the steward when to consider it.

## Proposal

### §A. Adoption for core families is derived

1. For every declaration row with `anchor: core`, `maturity.adoption` MUST equal the value `scripts/derive-core-adoption.mjs` computes from the committed tree. `--check` fails on any difference. `--write` sets the rows, and it runs in the regen chain before `generate-from-declaration`.
2. **Eligible bundles.** Under `evidence/v2-host-bundles/`, take for each `host.name` the newest bundle that `scripts/check-accepted-predicate.mjs` treats as certified. A host counts only if `evidence/host-tiers.json` lists its discovery origin.
   - A colocated companion counts nothing here: RFC 0216 §C limits it to harness-trust-anchor rows.
   - A retired host's last certified bundle still counts (GOVERNANCE.md: its bundles "stay tier-2 evidence"). The derived row is the same either way. The review file (§B) records retirement when it is the only witness.
3. **A host witnesses family F** when all three hold:
   - its bundle's discovery document carries F's record;
   - at least one scenario that gates on F is `executed-pass` in that bundle;
   - no scenario that gates on F is `executed-fail` in it.

   "Gates on F" is the `gate` signal that `scripts/report-v2-witness-coverage.mjs` computes from scenario code. Citations and RFC mentions do not count.
4. **Value.**
   - `none`: no witnessing host.
   - `single-witness`: exactly one.
   - `multi-witness`: two or more.
   - `independent`: at least one witnessing host is tier 3.

   The axis is a count of hosts, not of bundles: two bundles from one host are one witness.
5. Ext rows keep their declared adoption. RFC 0220 and `check-ext-status-coherence.mjs` govern them.
6. `technical` is unchanged. A count of hosts never promotes a family to `stable`; that stays a decision (Alternatives 2).

Proposed `capabilities.md` §8 table cell (the core text; +11 words):

```
| `adoption` | `none \| single-witness \| multi-witness \| independent` | Derived from committed bundles; for core rows, by `scripts/derive-core-adoption.mjs` |
```

### §B. A core family at `none` carries a review row

1. `evidence/core-adoption-review.json` holds one row per core family whose derived adoption is `none`:
   ```json
   { "family": "heartbeat", "reviewBy": "2.50", "decision": "keep", "reason": "one sentence", "plan": "the host or scenario expected to witness it" }
   ```
   `decision` is `keep` or `retire`. `reviewBy` is a corpus minor.
2. The gate (`--check`) MUST fail when any of the following holds:
   - a core family at `none` has no row;
   - a row names a family that is not at `none`. The row is stale and is deleted.
   - a `keep` row's `reviewBy` is below the minor in `spec/v2/release.json`. The review is overdue.
3. Renewing a `keep` row MUST change `reason` or `plan`. The script compares against the row at the last published tag. A renewal that changes only the date fails, so silence cannot extend a family indefinitely.
4. A `retire` row MUST name the `spec/v2/corrections.json` row that removes the family. That is a `steward-deletion` row under RFC 0255 §D while it applies, or a §3a retirement otherwise. The family then leaves the declaration through that row's own gates, and the review row goes with it.
5. A family whose witness class is `claims-check` is reviewed the same way. Its witness is a claims scenario, and an executed-pass row of one still counts under §A.3.
6. At the flip to `Active`, every family then at `none` gets a `keep` row with `reviewBy` three minors ahead and a stated plan. No family is retired by this RFC itself.

## Compatibility

`additive`.

- No wire shape changes. `adoption` does not appear in discovery, in any schema's validation keywords or in `profiles.json`.
- The generated `capabilities.schema.json` changes only in `description` strings ("maturity experimental/none" becomes, for example, "experimental/multi-witness"). That reaches `@openwop/spec-artifacts`, so the first release that carries §A is a suite release.
- `check-bundle-maturity.mjs` (RFC 0197 §C.7) reads `technical` only and is unaffected.
- No host's conformance result changes.

## Conformance

All requirements here are properties of the corpus. They are checked by a script in `npm run openwop:check` and by a coherence scenario, `conformance/src/coherence/v2-core-adoption-derived.test.ts`. That scenario drives the script on fixture trees:
- a positive control;
- a hand-edited adoption value, which fails;
- a missing review row, which fails;
- an overdue `keep` row, which fails;
- a date-only renewal, which fails.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 adoption equals the derivation | `derive-core-adoption.mjs --check` exit and reason on fixture trees: a derived value, and a hand-edited one — `v2-core-adoption-derived.test.ts` (planned), `openwop.requirement.0264.adoption-derived` (corpus) | the suite, unaided | witnessable — unaided (corpus) |
| §B.2 a `none` family has a current review row | the gate on fixture trees with no row, a stale row and an overdue `keep` row — `v2-core-adoption-derived.test.ts` (planned), `openwop.requirement.0264.review-row-present` (corpus) | the suite, unaided | witnessable — unaided (corpus) |
| §B.3 a renewal states a new reason | the gate on a fixture whose only change since the baseline is `reviewBy` — `v2-core-adoption-derived.test.ts` (planned), `openwop.requirement.0264.renewal-not-date-only` (corpus) | the suite, unaided | witnessable — unaided (corpus) |

## Alternatives considered

1. **Leave adoption hand-declared and correct it once.** The fix would be stale at the next bundle, and nothing would say so. RFC 0220 rejected the same option for ext families.
2. **Promote `technical` to `stable` at `multi-witness`.** `stable` is a commitment: COMPATIBILITY.md binds it, and `check-bundle-maturity` caps hosts by it. Two steward hosts passing a scenario do not make that commitment. A count can inform the decision but should not make it.
3. **Expire on calendar dates.** Dates in the corpus have proven hard to keep honest (v1 EOS slipped; `until` belongs to hosts, not the corpus). A corpus minor is checkable against `release.json` and moves only when the steward releases.
4. **Retire every `none` family now.** Several are new, such as `telemetry` from RFC 0262, or wait on a host feature that is planned. Retiring them would remove surface a host is about to serve. §B forces the question per family instead.
5. **Do nothing.** P-015 stays open. The declaration keeps telling readers no host serves 69 families. The real list of 18 stays invisible.

## Unresolved questions

1. Should a retired host's last bundle keep counting for adoption indefinitely, or only until a serving host re-witnesses the family? The draft keeps it, citing GOVERNANCE.md. A reviewer may prefer adoption to describe serving hosts only.
2. Is three minors the right review horizon for the initial rows? The draft picks it because minors have been about monthly in 2026-10/11.
3. Should `report-v2-witness-coverage.mjs` and the new script share the gate-signal code through a library? Implementation detail; the draft assumes yes.

## Implementation notes (non-normative)

- The gate-signal computation needs `typescript` from `conformance/node_modules`, as the coverage report already does. The script therefore runs after `npm ci` in the gate.
- The 2026-11-13 estimate used a string match on discovery documents. The script must read the record from the discovery document's family map, not search text.

## Acceptance criteria

- [x] Before `Active`: the 7-day comment window has run from filing, or a maintainer waiver is recorded in `MAINTAINERS.md` (waived 2026-11-13). The script's own counts replace the 2026-11-13 estimate in Motivation.
- [ ] `scripts/derive-core-adoption.mjs` with `--check` and `--write`, in `openwop:check` step 10 and the regen chain.
- [ ] `evidence/core-adoption-review.json` with a `keep` row for every family then at `none`.
- [ ] `capabilities.md` §8 cell as proposed; core budget re-checked.
- [ ] Coherence scenario `v2-core-adoption-derived` with the five controls, each shown able to fail. For this RFC the sabotage rows go in `evidence/sabotage-ledger.json` (RFC 0263 §C).
- [ ] CHANGELOG entry; suite release carrying the regenerated schema descriptions.

## References

- `spec/v2/core/capabilities.md` §8 (Maturity axes)
- RFC 0197 §C.7 (`check-bundle-maturity`), RFC 0216 §C (colocated companion), RFC 0220 (ext graduation on evidence), RFC 0255 §D (steward deletion), RFC 0263 (sabotage ledger)
- GOVERNANCE.md §"Acceptance evidence tiers"; `evidence/host-tiers.json`
- `docs/V2-WITNESS-COVERAGE.md` (the gate signal)
- Assessment finding P-015 (2026-08), re-measured 2026-11-13

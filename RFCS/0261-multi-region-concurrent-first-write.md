# RFC 0261: under `idempotency.multiRegion`, concurrent first writes have one winner

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0261                                                            |
| **Title**         | Under `idempotency.multiRegion`, two regions' concurrent first writes for one record key have exactly one winner, and a claimed effect is not performed in a second region |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-13                                                      |
| **Updated**       | 2026-11-13 — filed at **`Active`, comment window waived by the maintainer** (user instruction to openwop-be, 2026-11-13: the Phase 2 RFCs' windows are "waived"). STEWARD OVERRIDE of RFC 0147 §A.6 (idempotency and external effects), recorded in `MAINTAINERS.md`. Closes assessment finding P-005 (August 2026 industry assessment). No host advertises `idempotency.multiRegion` today, so every requirement here is `claims-check` until one does. |
| **Affects**       | `spec/v2/facets/idempotency.schema.json` (new: the decided `multiRegion` and `crossRegion` facet shapes, replacing the copies seeded from the frozen v1 schema; the `multiRegion` description is the normative home of §A–§C) · `spec/v2/declaration.json` (`idempotency.facetsFrom`) · `schemas/v2/capabilities.schema.json` (regenerated) · CHANGELOG. `spec/v2/core/idempotency.md` is not changed. No scenario. v1 is frozen and not touched. |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4. It adds obligations only to a host that advertises `idempotency.multiRegion`, which no host does. Facet shapes are unchanged; only descriptions move to a v2-decided file. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`idempotency.md` §Multi-region says an `Idempotency-Key` replayed into a second region MUST resolve to "the first region's response". It does not say which region is first when two regions receive the first write for one record key at the same moment. This RFC gives that case one winner: a host advertising `multiRegion` decides the record-key claim linearizably across regions before either region starts work, and the loser answers as the single-region concurrency rule already requires. It also says what a region does when it cannot see the other region's claim. It MUST NOT start work under that key, and a Layer-2 effect claimed elsewhere MUST NOT be performed there. Finally it separates two things the corpus runs together: collapsing a duplicate *record*, which `multiRegion` promises, and issuing an effect at most once, which only `crossRegion: fenced-effects` promises.

## Motivation

The August 2026 assessment (finding P-005) found the split-brain rules in conflict. v2 fixed half of that. RFC 0150 §D removed the time-ordered winner values, and v2 has one single-region concurrency rule: exactly one of two concurrent same-key requests is processed to completion. Two gaps remain:

1. **Truly concurrent first writes across regions.** "The first region's response" assumes an order the protocol never establishes. Two regions that each insert-if-absent into their own replica both succeed, both start a run, and each believes it was first. `partitionRecoveryStrategy: lexicographic-min-run-id` picks a survivor *after a partition heals*. It says nothing about two connected regions racing, and by the time it runs both runs have done work.
2. **"Collapse a duplicate effect" reads as an effect guarantee it is not.** `idempotency.md` says effect identity "MUST collapse a duplicate effect wherever it is observed". `crossRegion: reconciled-records` says external effects "MAY remain at-least-once". Read together, the first means the ledger shows one effect identity, not that the provider saw one call. A reader of the core document alone takes the stronger meaning.

No host advertises `multiRegion` today (openwop-app advertises `crossRegion: single-region`), so this is the moment to settle the rule: before a host builds against the ambiguous text.

## Proposal

The normative text below is the description of the `multiRegion` facet in a new `spec/v2/facets/idempotency.schema.json`. That file replaces the facet shapes seeded from the frozen v1 schema. The shapes do not change; only their descriptions become v2 decisions.

### §A. One winner for concurrent first writes

When a host advertises `idempotency.multiRegion`:

1. The Layer-1 record claim for a record key `(authenticatedTenantId, canonicalEndpointId, callerIdempotencyKey)` MUST be decided linearizably across every region that serves the endpoint, before any region starts work under that key. A single home region per record key, or a consensus-backed store, satisfies this. A per-region insert-if-absent that replicates afterwards does not.
2. Of two concurrent first writes for one record key received in different regions, exactly one MUST win. The other region MUST then follow `idempotency.md` §Concurrency as if both requests had reached one region: it returns the winner's final response, marked `OpenWOP-Idempotent-Replay: true`, or `409 idempotency_in_flight`. It MUST NOT start work.
3. "The first region's response" in `idempotency.md` §Multi-region means the response recorded by the winner of this claim.

### §B. A region that cannot see the claim fails closed

1. A region that cannot complete or read the cross-region claim for a record key, because of a partition or lost quorum, MUST NOT start work under that key. It MUST answer `409 idempotency_in_flight` and SHOULD set `Retry-After`.
2. `partitionRecoveryStrategy` keeps its meaning. It decides which record survives when a host's records diverged anyway, and a host whose claim is linearizable per §A.1 never produces such a divergence for a key it answered.

### §C. A claimed effect is not performed in a second region

1. When a host advertises `idempotency.multiRegion`, a Layer-2 effect identity claimed in one region MUST NOT be performed in another. A region that cannot read whether the identity is already claimed MUST NOT perform the effect. The node stays not-performed and is retried under the host's retry policy; it MUST NOT be recorded as completed.
2. Collapsing a duplicate effect record (`idempotency.md` §Multi-region) means the ledger shows one effect identity. It does not mean the provider received one call. Only `crossRegion: fenced-effects` promises at-most-once issuance across regions. A host advertising `crossRegion: reconciled-records` MUST NOT describe its cross-region effects as exactly-once.

### Examples

Positive. Region `us` and region `eu` both receive `POST /runs` with key `k1` for tenant `acme` within 5 ms. The record key's home region is `us`. `us` wins the claim and creates run `acme/r1`. `eu` cannot win, waits up to its request timeout, and returns `us`'s `201` body with `OpenWOP-Idempotent-Replay: true`. One run exists.

Negative (non-conformant). Each region inserts `k1` into its own replica, both succeed, and two runs start. After replication `lexicographic-min-run-id` keeps the lower run id, but both runs have already called the payment provider. §A.1 is violated; §C.1 is violated for the second call.

## Compatibility

`additive` per `COMPATIBILITY.md` §2.4.

- No schema shape changes. The `multiRegion` and `crossRegion` facets keep their properties, types and enums; the new facet file copies them and adds descriptions.
- The obligations bind only a host advertising `multiRegion`. No host does today.
- No existing MUST is relaxed. §C.2 narrows a reading of `idempotency.md`, not its text: the text already said "collapse a duplicate effect", which a ledger satisfies, and `crossRegion` already said effects MAY be at-least-once under `reconciled-records`.

## Conformance

No existing scenario drives two regions at major 2. The major-1 simulators (`multi-region-idempotency-behavior`, `cross-engine-append-behavior`) are listed in `docs/KNOWN-LIMITS.md` §"Shape-only conformance coverage". No new scenario ships: a black-box suite cannot make two regions race, and no host advertises the facet. The requirements are `claims-check`, and a host that advertises `multiRegion` states them in its `conformance.md`. Gap G2 tracks a scenario for when a host advertises the facet.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1–§A.2 one winner for concurrent first writes (`openwop.requirement.0261.concurrent-first-write-one-winner`) | two near-simultaneous same-key `POST /runs` sent to two regions' endpoints yield one `runId`, the other response marked replay or `409` | the suite can send to two regional origins, but cannot make the requests concurrent at the claim, only near-simultaneous at the edge | claims-check — no host advertises `multiRegion`; a scenario is planned (G2) |
| §B.1 a region that cannot see the claim answers `409` | `409 idempotency_in_flight` from the partitioned region | operator (needs a partition between regions) | claims-check — needs an operator-induced partition |
| §C.1 a claimed effect is not performed in a second region (`openwop.requirement.0261.effect-not-performed-twice`) | one arrival at a suite-owned effect receiver for one effect identity, whichever region retried it | operator (needs a cross-region retry of one node) | claims-check — needs operator control of placement |
| §C.2 `reconciled-records` is not described as exactly-once | the host's published claims | — | claims-check |

## Alternatives considered

1. **Time-ordered winner (first-writer-wins by wall clock).** Rejected for the reason RFC 0150 §D removed it: there is no shared clock, so two regions can each believe they wrote first.
2. **Allow both, reconcile after (`lexicographic-min-run-id` for every conflict).** Rejected for the connected case: it picks a surviving record after both runs did work, which is exactly the duplicate effect `multiRegion` exists to prevent. It stays the rule for records that diverged anyway.
3. **Do nothing.** The core sentence "the first region's response" stays undefined, and the first host to advertise `multiRegion` decides what it means alone.

## Unresolved questions

1. Under `reconciled-records`, what happens to the losing run when a partition heals and its record is replaced: is it cancelled, left to finish, or reported? This RFC does not decide it, because §A–§B prevent the divergence for a host whose claim is linearizable.
2. Should §A.1 name an observable home-region hint (for example a response header naming the deciding region) so a scenario can witness §A without operator help?

## Implementation notes (non-normative)

- A home region per record key, derived from a stable hash of the record key, is the simplest way to meet §A.1: every region forwards the claim to the home region. A consensus store (for example Spanner or a Raft-backed key-value store) also works.
- openwop-app advertises `crossRegion: single-region` and is not affected. ADR 0551 P4 (cross-region qualification) is where a future multi-region posture would meet this RFC.
- The integrator creates `spec/v2/facets/idempotency.schema.json` from the seeded shapes, adds `facetsFrom` to the `idempotency` declaration row, and regenerates `schemas/v2/capabilities.schema.json`.

## Acceptance criteria

- [x] Normative text merged in its schema-description home (`spec/v2/facets/idempotency.schema.json`). *(2026-11-13.)*
- [x] CHANGELOG entry. *(2026-11-13.)*
- [ ] A host advertises `idempotency.multiRegion`, states §A–§C in its `conformance.md`, and its certified bundle records `0261.*` as `claims-check` rows with a stated reason. deferred: no host advertises the facet; this box is the `Accepted` gate.
- [ ] Register sweep (`RFCS/registers/0261-*.gaps.md`, `.risks.md`).

## References

- Assessment finding P-005, August 2026 (split-brain winner rules).
- `spec/v2/core/idempotency.md` §Concurrency, §Multi-region.
- RFC 0036 (multi-region idempotency), RFC 0150 §D (removal of time-ordered winners; the `crossRegion` ladder), RFC 0213 (in-flight `409`).
- `docs/KNOWN-LIMITS.md` §"Shape-only conformance coverage" (the major-1 multi-region simulators).

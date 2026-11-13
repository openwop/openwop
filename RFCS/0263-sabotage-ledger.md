# RFC 0263: A cited conformance leg must be shown able to fail

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0263                                                            |
| **Title**         | A cited conformance leg must be shown able to fail: the sabotage ledger, and requirement ids on every witnessable Falsifiability row |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-13                                                      |
| **Updated**       | 2026-11-13 — filed directly at **`Active`, comment window waived by the maintainer** (David, 2026-11-13, on the protocol-gap plan's Phase 2: "waived"). STEWARD OVERRIDE of RFC 0147 §A.6 (conformance and certification), recorded in `MAINTAINERS.md`. Lands `evidence/sabotage-ledger.json` (empty), `scripts/lib/sabotage-ledger.mjs`, rules 5 and 6 in `scripts/check-accepted-predicate.mjs`, `scripts/check-sabotage-ledger.mjs`, the coherence scenario `v2-sabotage-ledger` (3 ids), and requirement ids on the witnessable Falsifiability rows of RFCs 0258 and 0259. Addresses finding P-001 of the August 2026 assessment ("certification can pass vacuous behavior"), which RFC 0148 narrowed. |
| **Affects**       | `scripts/check-accepted-predicate.mjs` (rules 5 and 6) · `scripts/lib/sabotage-ledger.mjs` (new; the rules' one implementation) · `scripts/check-sabotage-ledger.mjs` (new; the rules on a chosen directory) · `evidence/sabotage-ledger.json` (new) · `conformance/src/coherence/v2-sabotage-ledger.test.ts` (new) · `RFCS/0258-bounded-refine-loopback.md` and `RFCS/0259-interrupt-resolved-via.md` (ids added to their Falsifiability tables; no normative change) · CHANGELOG. No wire, schema, discovery or spec text changes. v1 is frozen and is not touched. |
| **Compatibility** | `additive` per `COMPATIBILITY.md`. It adds a governance gate on the `Active → Accepted` transition. No host, bundle or published suite behaviour changes, and no RFC already `Accepted` is invalidated. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

A conformance leg that cannot fail passes every gate the corpus has. RFC 0148 stopped vacuous passes: a pass with no assertions, a soft-skip counted as a pass. It cannot catch a leg whose assertions are real but can never be false, such as a judge comparing a value with itself or a count that is zero on every host. This RFC makes the ability to fail a recorded fact. A new ledger records a red run for each cited requirement: what was broken, on which subject, under which suite. From RFC 0260, an RFC goes `Accepted` only when each id its Falsifiability table cites has such a row.

It also closes a hole in the predicate itself. Rule 4 of `check-accepted-predicate.mjs` checks the ids a Falsifiability table names, so a table that names none passes rule 4 with nothing to check. RFCs 0258 and 0259 were filed that way. From RFC 0258, every witnessable row names its id, or says it is `planned`.

## Motivation

- **Vacuous legs are found by reading, not by gates.** Five RFC 0158 rows were vacuous or wrong, and every one was found by a host reading the scenario. Two examples: a durability leg that passed on an empty ledger (`0 <= 0`), and an oracle that read the host's own ledger to witness exactly-once delivery. Each one passed `req()` discipline, the RFC 0148 dispositions and the bundle signature. The only check that catches this class is to break the thing under test and watch the leg go red, and until now that was a habit, not a record.
- **The habit is uneven.** Some scenarios list their sabotages in the docstring (`v2-colocated-companion`), and most do not. Nothing ties a sabotage to the requirement id an `Accepted` RFC cites, so a reader cannot tell which cited legs were ever shown able to fail.
- **Rule 4 can be vacuous.** It iterates the ids in the table. The 2.46.44 filing of RFCs 0258 and 0259 used `§`-labelled rows with no ids, and rule 4 would have passed their `Accepted` flips on any bundle.

## Proposal

### §A Requirement ids on every witnessable row

From RFC 0258, the Falsifiability table of an RFC whose Status is `Active` or `Accepted` **MUST** name at least one requirement id (`openwop.requirement.NNNN.<slug>`) on every row whose verdict is witnessable or seam-gated.

- A row with no leg yet **MUST** say `planned` in its verdict instead.
- From RFC 0260, an RFC with a `planned` witnessable row **MUST NOT** be `Accepted`: the row has no leg, so nothing witnessed it.
- Rows whose verdict is `unwitnessable`, `claims-check` or `negative-existence` are exempt; they declare why no id can witness them.

### §B The sabotage ledger

`evidence/sabotage-ledger.json` is `{ "$comment", "rows": [ … ] }`. Each row is closed and has exactly these members:

- `requirementId`: the cited id, or a leg under it (`<id>.<leg>`).
- `scenario`: the `.test.ts` file that ran.
- `sabotage`: one sentence naming what was broken.
- `subject`: `{ host, build }`, the build the sabotage ran on.
- `suiteVersion`: the suite that ran it.
- `result`: always `executed-fail`. A sabotage that passed showed nothing.
- `date`: `YYYY-MM-DD`.
- `witnessSha256` (optional): the red bundle's digest, when one was cut. It **MUST NOT** be the digest of a certified committed bundle, because that bundle recorded the pass.

A row is a record that a red run happened. It is not a bundle, and it is not signed: anyone may add a row by PR, and anyone may re-run the sabotage it names. A row the steward adds is steward evidence, like the steward's bundles. For a corpus-gate leg, `subject.host` is `corpus` and `subject.build` the commit.

### §C A red run before `Accepted`

From RFC 0260, for an RFC to be `Accepted`, every id its Falsifiability table names on a witnessable row **MUST** have at least one §B row with `result: executed-fail`. A row for a leg under the id counts.

- This adds to rule 4. Rule 4 still requires an `executed-pass` row in a cited certified bundle or the corpus ledger; §C requires that the same leg was once made to fail.
- RFCs numbered below 0260 are not retroactively invalidated. Backfilling their rows is invited and tracked (gap G3).

### Mechanism

`scripts/lib/sabotage-ledger.mjs` is the one implementation of §A, §B and §C. `check-accepted-predicate.mjs` runs it as rule 6 (§A, over every in-scope RFC), rule 5 (§C, at the `Accepted` check) and a ledger shape check (§B). `check-sabotage-ledger.mjs` runs the same code on a chosen RFC directory, ledger and bundle directory, which is how the coherence scenario drives it on fixtures.

## Compatibility

- No wire, schema, discovery or event change. No host is judged differently, and no bundle changes.
- No `Accepted` RFC changes status: §A starts at RFC 0258 and binds `Active`, and §C starts at RFC 0260.
- RFCs 0258 and 0259 gain ids on their witnessable rows. The ids are the ones their scenarios already mint, so their `Accepted` bars do not move. Two RFC 0258 rows (§C.4 size cap, §C.5 limits) have no leg and are marked `planned`; below RFC 0260 a `planned` row does not block `Accepted`, as before.
- An RFC author from 0260 on writes ids into the table and records sabotages before the flip. That is new work on the flip, by design.

## Security considerations

- The ledger is not signed, so a row could be invented. Its claims are reproducible: it names the scenario, the sabotage and the subject build. An invented row is a false statement in a public file, as an invented `Accepted` claim would be. It is not a hole that a signature closes, because the steward would sign it.
- §B forbids a certified bundle's digest in `witnessSha256`. This stops a passing bundle being presented as the red run.
- This RFC makes no claim about hosts. It cannot weaken a host's security obligation.

## Conformance

The rules are a corpus gate, witnessed by the coherence scenario `v2-sabotage-ledger.test.ts` on fixture directories and by `check-accepted-predicate.mjs` on the live tree. No host bundle is involved.

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §A ids on every witnessable row; `planned` blocks `Accepted` from 0260 | `check-sabotage-ledger.mjs` exit and reason on fixture tables with an id, a bare row, a `planned` row at `Active` and at `Accepted` — `v2-sabotage-ledger.test.ts`, `openwop.requirement.0263.falsifiability-names-ids` (corpus) | the suite, unaided | witnessable — unaided (corpus) |
| §B the ledger's closed shape; no certified bundle as the red run | the gate on fixture ledgers: a well-formed row, an `executed-pass` row, an unknown member, a certified bundle's digest — `v2-sabotage-ledger.test.ts`, `openwop.requirement.0263.ledger-shape` (corpus) | the suite, unaided | witnessable — unaided (corpus) |
| §C a red row for every cited id before `Accepted`, from 0260 | the gate on an `Accepted` fixture RFC with and without a matching `executed-fail` row — `v2-sabotage-ledger.test.ts`, `openwop.requirement.0263.sabotage-recorded-before-accepted` (corpus) | the suite, unaided | witnessable — unaided (corpus) |
| A recorded sabotage actually ran | — | the person who adds the row | claims-check — the row names the scenario, sabotage and build so anyone can re-run it; the gate cannot replay it |

## Alternatives considered

1. **Mutation testing of the suite.** Run a mutation tool over each host and keep the legs that go red. This is the general form of the idea, but a host is a black box to the suite: the mutations that matter (break the replay suppression, drop the binding check) are host-internal and differ per host. A named sabotage against one host's build is what we can do today.
2. **Put the sabotage in the bundle.** A bundle records a run; a sabotage is a second run on a different build. Mixing them would make a certified bundle carry red rows, which RFC 0168 refuses. A separate ledger keeps the bundle's meaning intact.
3. **Make §C retroactive.** It would re-open about 90 `Accepted` RFCs at once. Most of their legs were in fact sabotaged when written, but the records are in docstrings and commit messages, not in a form the gate can read. A prospective rule with an invited backfill (G3) is the honest version.
4. **Require ids in the table but not `planned`.** Then an RFC whose table has a row with no leg yet could not be written honestly. `planned` names the state and blocks `Accepted` from 0260.

## Unresolved questions

1. Should a sabotage row be required to name the commit that reverts the sabotage, so the red build is reproducible from history? Today `subject.build` names the sabotaged build, which may exist only locally.
2. Should rule 5 also require the red run's `suiteVersion` to be no older than the pass it backs? A leg can change between a sabotage and the cited pass.

## Implementation notes (non-normative)

- `v2-sabotage-ledger.test.ts` lists its own sabotages in its docstring, as the ledger asks of everyone. One planned sabotage, accepting any `result` in §C, turned nothing red: §B's shape check refuses an `executed-pass` row first. The docstring records that, and a sabotage the §C leg does see (dropping the id match).
- The rule caught a real row on its first run: a draft of RFC 0260 in the same branch had a witnessable row with no id.

## Acceptance criteria

- [x] Comment window run (`Draft → Active`; RFC 0147 §A.6). *(Waived by the maintainer, 2026-11-13.)*
- [x] `scripts/lib/sabotage-ledger.mjs`, rules 5 and 6, `check-sabotage-ledger.mjs` and an empty `evidence/sabotage-ledger.json`. *(2026-11-13.)*
- [x] Coherence scenario `v2-sabotage-ledger.test.ts` (3 ids), with its sabotages recorded in the docstring. *(2026-11-13.)*
- [x] RFCs 0258 and 0259 name ids on their witnessable rows. *(2026-11-13.)*
- [ ] The three `0263.*` ids record `executed-pass` in `evidence/corpus-ledger.json` (the corpus gate, run by `check-spec-coherence.mjs`).
- [ ] Register sweep (`RFCS/registers/0263-*.gaps.md`, `.risks.md`).

## References

- RFC 0148 (non-vacuous certification), RFC 0174 §B.1 (the `Accepted` predicate), RFC 0216 (a gate whose fixtures run the gate's own code).
- `docs/EVIDENCE-DISCIPLINE.md`, and the August 2026 assessment finding P-001.

# RFC 0265: compensation behavior is witnessed at v2 through a failing fixture

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0265                                                            |
| **Title**         | compensation behavior is witnessed at v2 through a failing fixture |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-13                                                      |
| **Updated**       | 2026-11-13 — **`Draft` → `Active`, comment window waived by the maintainer** (David, 2026-11-13: "yes, skip the comment window, proceed with implementation"). STEWARD OVERRIDE of RFC 0147 §A.6, recorded in `MAINTAINERS.md`. Lands the fixture `conformance-compensate-unwind`, the scenario `v2-compensation-unwind` (5 ids), the `security-defaults.md` pointer and the invariant `tests:` rows. Unresolved questions settled with the draft's answers (UQ 1: the two registration refusals stay MUST, recorded unwitnessable; UQ 2: no `manualIntervention` leg yet; UQ 3: no `branch`-fork leg). Addresses finding P-006 of the August 2026 assessment. |
| **Affects**       | new fixture `conformance/fixtures/conformance-compensate-unwind.json` + `fixtures.md` row, new scenario `conformance/src/scenarios/v2-compensation-unwind.test.ts`, `spec/v2/core/security-defaults.md` §Compensation (one pointer sentence), `SECURITY/invariants.yaml` (`tests:` of two rows) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (no wire shape changes; new legs are gated on the family and the fixture) |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

At v2, the only compensation evidence is `v2-compensation-read-projection`. All three canonical hosts pass it, on a fresh run with nothing to compensate (`status: "none"`). No v2 scenario makes a host unwind anything. The behavioral legs are v1 scenarios driven through sample seams, and the seams report their own counts (`refiredEffects`, `compensatedOrder`). This RFC adds a conformance-reserved fixture whose effects succeed and whose last node fails deterministically, so the suite can cause an unwind unaided. The suite then reads the result through normative paths only: the run's event log, `GET /runs/{runId}/compensation` and `GET /runs/{runId}/effects`. It closes the behavioral half of finding P-006 (2026-08 assessment).

## Motivation

- **Read shape is not behavior.** `security-defaults.md` §Compensation, the `compensation.*` events in `api/v2/asyncapi.yaml` and the projection schema define what an unwind looks like. No v2 leg checks that one happens.
- **The v1 legs read the host's report of itself.** `compensation-behavior.test.ts` asks `/v1/host/sample/test/compensation/replay` how many effects re-fired, and the host answers. A host that never compensates can answer `0`. The protocol-tier invariants `compensation-replay-no-refire` and `compensation-effect-id-retry-stable` cite those v1 files as their tests.
- **The condition is causable from outside.** "An effect succeeded, then a later node failed" needs no operator. A fixture can fail on purpose, as `conformance-failure` already does. The seam was needed only because v1 had no reserved effect node to compensate.

## Proposal

### §A. The fixture

`conformance-compensate-unwind`: three nodes of the conformance-reserved type `core.conformance.compensable-effect`, in sequence (`e1 → e2 → e3`), then `core.fail` (the failing node `conformance-failure` already uses).

- Each effect node declares a node-level `compensation` whose `nodeTypeId` is the same reserved type, with `inputMapping: { inverse: true }`. Node-level `compensation` is a closed object, so the inverse flag travels as an input.
- `settings.compensation` names `orderingModel: "reverse-completion"` and a `triggers` entry for node failure.
- A host that advertises `compensation` and serves the fixture MUST map `core.conformance.compensable-effect` to a node it records on the effect ledger (`GET /runs/{runId}/effects`) as one effect per execution, forward and inverse alike.
- Serving the fixture is OPTIONAL. A host that does not serve it is `inapplicable` for §B, exactly as for every other fixture-gated leg.
- The effect ledger is owed under `idempotency` (idempotency.md), not under `compensation`. Legs 3 and 5 are therefore also gated on `idempotency`, and leg 5 on `replay.modes` containing `replay`.

### §B. What the suite checks

The suite starts the fixture and waits for a terminal run. Each leg reads normative paths only.

1. **Plan before first inverse** (`openwop.requirement.0265.plan-before-inverse`). In the run's event log, `compensation.requested` precedes the first `compensation.started` (asyncapi: "MUST follow `compensation.requested`").
2. **Reverse-completion order** (`openwop.requirement.0265.reverse-completion`). The projection's `attempts[]` names `e3, e2, e1` in that order. That is the reverse of the order of the three forward `node.completed` events. `attempts[]` is in the order the host made the attempts; this RFC adds that sentence to the projection schema's description, which before gave the array no order.
3. **One inverse per forward effect** (`openwop.requirement.0265.inverse-once`). The ledger has no field that marks a record as an inverse, so the suite tells them apart by elimination:
   - each effect node's earliest record is its forward record;
   - records of `fail` are ignored;
   - every other record is an inverse.

   The leg requires exactly three inverse records with three distinct `effectId`s. If the forward records are missing too, the host has not mapped the reserved node to a ledgered effect, and the leg is `blocked`, not failed.
4. **Projection agrees with events** (`openwop.requirement.0265.projection-agrees`). The projection's `status` is `completed` exactly when the log holds `compensation.completed`, and `plan[]` names the three effect nodes.
5. **Replay does not re-fire** (`openwop.requirement.0265.replay-no-refire`). A `mode: "replay"` fork of the run, from the source run's first event sequence, records no effect the source run did not make. A ledger keyed per run cannot tell a re-fired inverse from a re-fired forward effect, and replay.md §"Side-effect suppression" forbids both, so the leg fails on either. It is `blocked` when the source run recorded no inverse, so it cannot pass by comparing nothing with nothing. This is the black-box form of invariant `compensation-replay-no-refire`.

### §C. Pointer in core

`security-defaults.md` §Compensation gains one sentence: "The `conformance-compensate-unwind` fixture is how a host shows an unwind (RFC 0265)." That is about 12 words, and its RFC reference belongs on the *Sources:* line. The obligations themselves already exist in the events contract and the projection schema. §B only measures them.

### §D. The two invariants point at the new scenario

In `SECURITY/invariants.yaml`, `compensation-replay-no-refire` adds `v2-compensation-unwind.test.ts` to `tests:`. `compensation-effect-id-retry-stable` does not: the fixture's inverses never fail, so no retry happens and leg 3 cannot show an identity staying stable across retries.

## Compatibility

`additive`.

- No schema, path or event changes.
- The legs are gated twice. A host that does not advertise `compensation` sees nothing new. A host that advertises it but does not serve the fixture is `inapplicable`.
- No committed bundle changes verdict until the host is re-cut on the suite that carries the scenario.

## Conformance

New scenario `v2-compensation-unwind` (major 2), gated on the `compensation` record and the fixture.

Sabotage plan, recorded in `evidence/sabotage-ledger.json` before `Accepted` (RFC 0263 §C):
- the reference host compensates in forward order, which fails leg 2;
- it emits `started` before `requested`, which fails leg 1;
- it re-executes inverses on replay, which fails leg 5.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B.1 plan before first inverse | event order in `GET /runs/{runId}/events` — `v2-compensation-unwind.test.ts` (planned), `openwop.requirement.0265.plan-before-inverse` | the suite, unaided (the fixture fails on purpose) | witnessable — gated (on `compensation` + the fixture) |
| §B.2 reverse-completion order | `attempts[]` against forward `node.completed` order — `v2-compensation-unwind.test.ts` (planned), `openwop.requirement.0265.reverse-completion` | the suite, unaided | witnessable — gated |
| §B.3 one inverse per forward effect | effect-ledger record count — `v2-compensation-unwind.test.ts` (planned), `openwop.requirement.0265.inverse-once` | the suite, unaided | witnessable — gated |
| §B.4 projection agrees with events | projection `status`/`plan[]` against the log — `v2-compensation-unwind.test.ts` (planned), `openwop.requirement.0265.projection-agrees` | the suite, unaided | witnessable — gated |
| §B.5 replay does not re-fire | the fork's effect ledger — `v2-compensation-unwind.test.ts` (planned), `openwop.requirement.0265.replay-no-refire` | the suite, unaided (fork is a client call) | witnessable — gated |
| existing: a policy naming an unlisted ordering model, or another `profileVersion`, is refused at registration | — | only whoever registers a definition; v2 has no client-submitted definition | unwitnessable — at v2 no black-box client can register a definition; see Unresolved questions 1 |

## Alternatives considered

1. **Keep the v1 seams and port them to v2.** The seams report the host's own count, and a row that reads the host's ledger of itself cannot witness the thing it counts. A seam is justified only when the condition cannot be caused. Here it can.
2. **Demote the behavioral rules to SHOULD.** That relaxes an obligation the events contract states as MUST. COMPATIBILITY.md forbids relaxing a MUST within the major without a safety-fix justification, and none applies.
3. **Do nothing.** P-006 stays "narrowed". The family keeps its read shape witnessed and its behavior asserted.

## Unresolved questions

1. The two registration refusals in `security-defaults.md` §Compensation have no v2 observable: a client cannot submit a definition. Should they stay MUST and be recorded unwitnessable (this draft), or be restated as a constraint on the fixtures and workflows a host serves, which would make them `claims-check`?
2. Should `manualIntervention` get a fourth leg, an inverse that fails and exhausts its retries? It needs a second reserved behavior (an inverse that always fails). The draft leaves it out to keep the first fixture small.
3. Does a `mode: "branch"` fork also need leg 5? The draft says no: `branch` re-executes by design, and replay.md governs it.

## Implementation notes (non-normative)

- Reference host (openwop-examples): it already serves `compensation` and seams. It needs the reserved node type and the fixture.
- openwop-app: the same. Its train, owned by the openwop-app sessions, decides when.
- After both hosts land this, the read-projection rows plus these five give `compensation` a behavioral witness. RFC 0264's derivation would then count it on each host that passes.

## Acceptance criteria

- [x] Before `Active`: the 7-day comment window has run from filing, or a maintainer waiver is recorded in `MAINTAINERS.md` (waived 2026-11-13).
- [ ] Fixture, `fixtures.md` row and `v2-compensation-unwind` scenario shipped in a suite release.
- [ ] `security-defaults.md` pointer sentence; core budget re-checked.
- [ ] `SECURITY/invariants.yaml` `tests:` updated for `compensation-replay-no-refire`.
- [ ] The three sabotage rows in `evidence/sabotage-ledger.json`.
- [ ] A certified bundle with the five `0265.*` rows `executed-pass` (tier named in `Updated`).

## References

- `spec/v2/core/security-defaults.md` §Compensation; `api/v2/asyncapi.yaml` `compensation.*`; `schemas/v2/compensation-projection.schema.json`, `compensation-policy.schema.json`
- RFC 0151 (compensation), RFC 0173 §B (C6.6), RFC 0263 (sabotage ledger), RFC 0264 (derived adoption)
- `conformance/src/scenarios/compensation-behavior.test.ts`, `compensation-recovery.test.ts` (v1, seam-driven)
- Assessment finding P-006 (2026-08), re-measured 2026-11-13

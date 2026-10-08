# RFC 0237: Declared nondeterminism names its sources; `false` is not a v2 state

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0237                                                            |
| **Title**         | Declared nondeterminism names its sources; `false` is not a v2 state |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-06                                                      |
| **Updated**       | 2026-10-08 — **`Active → Accepted`, provisional pending the RFC 0156 §B retrospective review** (STEWARD OVERRIDE of RFC 0147 §A.6, register row `not-reviewed`). Evidence tier: tier-1 — the v2 reference host (openwop-examples), a reference example and not a production host: its certified public cut on published suite 2.45.25 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`; build `commit:a8e6db64`, witness `3c4834409163`, signed `v2-reference-4`, 517 pass / 0 fail / 0 blocked, every claimed profile certified, egress guard closed, nothing relaxed; openwop-examples #161–#162) records both `openwop.requirement.0237.*` ids `executed-pass`, with `clock`, `random` and `id` listed. Gaps G1 and G2 are closed on that cut; G3 stays for 3.0. · 2026-10-06 — `Draft` → `Active`, comment window waived by the maintainer (2026-10-06, in this session: "yes to both", answering whether to waive 0237's window and move it to Active), recorded as a STEWARD OVERRIDE of RFC 0147 §A.6 in MAINTAINERS.md. §A–§D are merged; `v2-nondeterminism-sources` and the §C legs ship in suite 2.45.23, each failing on its sabotage against a double. · 2026-10-06 — filed `Draft` after an `/architect` ruling (2026-10-06). The 7-day comment window opens with the pull request. |
| **Affects**       | `spec/v2/core/replay.md` §Declared nondeterminism · `spec/v2/core/events.md` §Envelope contracts · `spec/v2/declaration.json` (`nondeterminismPolicy` facets and witness class) · `schemas/v2/capabilities.schema.json` (generated) · `spec/v1/deprecations.json` (a 3.0 row) · `conformance/fixtures/` (`conformance-nondeterminism`) · new `v2-nondeterminism-sources.test.ts` |
| **Compatibility** | `additive` per COMPATIBILITY.md §2.4: an optional facet, a fixture and a gated leg, plus a prose statement of `capabilities.md` §2 for two families. No schema narrows. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`nondeterminismPolicy` says a host declares some nondeterministic sources instead of suppressing them, and `replay.md` requires every declared source to be recorded so a fork replays it. But the record is a bare boolean, `declared`, and names no source, so the rule binds nothing a client can check. This RFC adds an optional `sources[]` facet from a small closed vocabulary (`clock`, `random`, `id`, `env`, plus `x-*`), defines the observable (a `replay` fork reproduces each declared source's value), and adds a fixture-gated witness. It also states that `declared: false` and `envelopeContracts.advertised: false` are not v2 states: under `capabilities.md` §2, a host that does not offer a family omits it. The two required booleans cannot leave inside v2 (§0a), so their removal is recorded for 3.0.

## Motivation

**The rule has no object.** `replay.md` §Declared nondeterminism: "A host advertising `nondeterminismPolicy.declared` MUST record every declared source in the run's event log at the point it is read, so a fork replays the recorded value rather than re-drawing it." The record is `{ declared: boolean }`. Which sources? None are named, so no client can tell what to expect from a fork, and no suite can test it. RFC 0085 chose the bare flag deliberately for v1.x (its UQ2) and named "a structured per-source policy" as the refinement; this is that refinement.

**Two booleans bring back `supported: false`.** v2 removed `supported` because presence is the claim (`capabilities.md` §2). `nondeterminismPolicy.declared` and `envelopeContracts.advertised` are required booleans, so a host can advertise either family with `false`: present, yet denying the behaviour. Nothing conforming needs that state.

**Why they stay for now.** `overview.md` §0a lets a 2.x minor retire only an optional surface, and forbids reshaping a surface in place. Both booleans are required, so removing them, or making them optional, waits for 3.0.

## Proposal

### §A The `sources[]` facet

`nondeterminismPolicy` gains an optional facet `sources`: an array of unique strings, each one of:

| Source | What the host draws |
| --- | --- |
| `clock` | the current time, read by a node or by the host on a node's behalf |
| `random` | random numbers or bytes |
| `id` | identifiers the host mints during a run (not the run's own `runId`) |
| `env` | host configuration or environment values read during a run |
| `x-<name>` | a vendor source, named in the host's documentation |

LLM output and the results of side-effecting nodes are not sources here: `replay.md` already governs them through the invocation log and recorded outcomes.

### §B The rule

A host advertising `nondeterminismPolicy` with `sources`:

- MUST record each value it draws from a listed source during a run, at the point it is read;
- MUST, on a `replay` fork, reproduce the recorded value rather than draw again.

A source the host neither lists nor suppresses remains a replay defect (`replay.md`, unchanged).

### §C `false` is not a v2 state

`capabilities.md` §2 already says a host that does not support a family MUST omit it. Stated for these two families:

- a host that does not declare its nondeterminism MUST omit `nondeterminismPolicy`, and MUST NOT advertise `declared: false`;
- a host that does not enforce envelope contracts MUST omit `envelopeContracts`, and MUST NOT advertise `advertised: false`.

The schemas keep both booleans required. A `spec/v1/deprecations.json` row records their removal at 3.0.

### §D The witness fixture

`conformance-nondeterminism` is a host-installed fixture workflow. Its run's `outputs` carry one string per source the host lists, keyed by source name, each drawn during the run (for `clock`, an RFC 3339 time; for `random` and `id`, the drawn value; for `env`, a value of the host's choosing). A host lists the fixture in its advertised fixtures.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B a declared source replays its recorded value — `openwop.requirement.0237.declared-source-replays` | the fixture's run outputs, then a `replay` fork from sequence 0: each listed source's output is byte-equal | the suite, with the host-installed fixture | witnessable — executed-pass required on a host bundle |
| §B recorded at the point it is read | only through the fork equality above; the log entry itself is host-internal | — | unwitnessable beyond the fork — the row above is its witness |
| §C `false` is not a v2 state — `openwop.requirement.0237.no-false-advertisement` | a discovery document advertising `nondeterminismPolicy.declared: false` or `envelopeContracts.advertised: false` | the suite, unaided | witnessable — executed-pass required on a host bundle (inapplicable when neither family is advertised) |

## Compatibility

`additive`.

- `sources` is optional, so a record without it validates unchanged. A host that does not list it keeps today's behaviour.
- §C restates `capabilities.md` §2 for two families and changes no schema. Census: no committed v2 host bundle advertises either family.
- The fixture is opt-in. A host that does not install it records `inapplicable` for the §B leg.
- The removal of the two booleans waits for 3.0 (`overview.md` §0a predicate 4).
- `conformance/src/lib/profiles.ts` reads `nondeterminismPolicy.declared` for a v1 profile predicate; v1 is frozen and unaffected.

## Conformance

**Existing:** `v2-nondeterminism-policy-advertisement` and `v2-envelope-contracts-advertisement` validate the records against their schema seats.

**New:** `v2-nondeterminism-sources`, gated on `nondeterminismPolicy.sources` and the fixture. It runs `conformance-nondeterminism`, forks the run in `replay` mode from sequence 0, and requires each listed source's output to match. A scratch double that draws again on replay must fail it. The §C leg joins the two advertisement scenarios. The family's witness class moves from `claims-check` to `witnessable-gated`.

## Alternatives considered

1. **Read the recorded value from the event log.** It needs a new event type for a nondeterministic read and a rule for where it sits in the log. The fork equality observes the same obligation through surfaces that already exist.
2. **An open vocabulary.** It cannot be tested: a suite cannot know what an unknown source should reproduce. The closed list covers what a host draws on its own; `x-*` covers the rest without a promise of testing.
3. **Make the booleans optional now.** §0a forbids reshaping a v2 surface in place, and making a required field optional is such a reshape.
4. **Do nothing.** The replay rule stays unfalsifiable, and two families keep a state v2 removed everywhere else.

## Unresolved questions

None. Two were decided at `Active` (2026-10-06, steward):

1. **`env`** is listed: a run that branches on configuration must replay the branch it took.
2. **Fork origin** is sequence 0 only; a mid-run fork tests the same mechanism with more fixture coupling.

## Implementation notes (non-normative)

- **v2 reference host:** a fixture node that draws `clock`, `random` and `id` into its output and records them; on a `replay` fork it serves the recorded values. It then lists `sources: ["clock", "random", "id"]`.
- **Sequencing:** Draft → Active (prose, declaration facet, fixture contract, deprecation row, legs), then the reference host adopts it and cuts, then `Accepted`.

## Acceptance criteria

- [x] `Active`: §A–§D merged; `sources` in `spec/v2/declaration.json`; the fixture in `conformance/fixtures.md`; the 3.0 deprecation row; `CHANGELOG.md`.
- [x] `v2-nondeterminism-sources` and the §C legs ship in suite 2.45.23, each failing on its sabotage against a double: a fork that draws again fails the replay leg, and `declared: false` fails the §C leg.
- [x] `Accepted`: a certified major-2 bundle records `openwop.requirement.0237.declared-source-replays` and `openwop.requirement.0237.no-false-advertisement` `executed-pass`. *(2026-10-08: the v2 reference host's certified public cut on published suite 2.45.25, build `commit:a8e6db64`; both `executed-pass`.)*

## References

- `spec/v2/core/replay.md` §Declared nondeterminism; `spec/v2/core/capabilities.md` §2; `spec/v2/core/overview.md` §0a; `spec/v2/core/events.md` §Envelope contracts; `COMPATIBILITY.md` §2.4, §3a.
- RFC 0085 (the `nondeterminismPolicy` flag, its UQ2); RFC 0197 (v2 retirement).
- Prior art: Temporal's deterministic side-effect recording (`workflow.SideEffect`, `workflow.Now`); Restate's journaled side effects.
- Registers: [`gaps`](./registers/0237-nondeterminism-sources.gaps.md), [`risks`](./registers/0237-nondeterminism-sources.risks.md).

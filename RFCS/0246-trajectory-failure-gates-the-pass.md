# RFC 0246: A trial that fails its trajectory cannot carry a task or a suite to a pass

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0246                                                            |
| **Title**         | A trial that fails its trajectory cannot carry a task or a suite to a pass |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-15                                                      |
| **Updated**       | 2026-10-15 — filed as a **safety-fix** on the steward's decision (2026-10-15). 90-day public window (`COMPATIBILITY.md` §3), not waived. UQ 1 resolved in the window: `gatedScore` is always present on a trajectory task. |
| **Affects**       | `RFCS/0244` §A grading rule and §B task-level `passed` (corrected, not amended) · `schemas/v2/eval-summary.schema.json` (suite `passed` description; optional per-task `gatedScore`, optional suite `gatedAggregateScore`) · `schemas/v2/agent-eval-suite.schema.json` (`trials.passRule` description) · conformance: `v2-eval-trajectory-trials.test.ts` (two legs) · `docs/COMPATIBILITY-CORRECTIONS-LOG.md` |
| **Compatibility** | `safety-fix` per `COMPATIBILITY.md` §3. It changes when a task and a suite report `passed`, so a host that conformed to RFC 0244 yesterday can be non-conforming today. The two new summary fields are additive. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0244 §A says a golden or rubric trial with a `trajectory` **MUST NOT** pass unless its trajectory matched, but its `score` "stays the output score". Two pass decisions read scores, not trial verdicts, so a trial that took the wrong tool path still counts toward passing:

- **The task**, under `passRule: "mean"`: `passed` ⇔ `meanScore ≥ passScore`. Every trial can fail its trajectory and the task still passes.
- **The suite**, under any `passRule` and any trial count: `EvalSummary.passed` requires `aggregateScore ≥ passScore`. Every task can fail its trajectory and the suite still passes.

`EvalSummary.passed` is the flag an RFC 0082 deployment gate reads (`requiredEval`). So today an agent that calls the wrong tools, or a forbidden one, can be promoted to production on an eval suite written to stop exactly that.

This RFC fixes both decisions without changing any reported score. A trial that failed its trajectory contributes `0` to the pass decision, the way RFC 0244 §D already makes a fail-closed fixture miss score `0`.

## Motivation

Reported by openwop-app's eval remediation (2026-10-15), after its grade pass on RFC 0244.

RFC 0244 §D was amended in place on 2026-10-14 to close the same trap for fixture misses: a fail-closed trial now reports `score: 0`, because otherwise "`passRule: "mean"` or the aggregate `passScore` could pass a suite in which every trial failed closed". §A has the identical shape and was not changed, because §A deliberately keeps the output score: a reader wants to know how good the answer was even when the path was wrong.

Both are true. The score is a measurement, and it should stay one. The pass decision is a gate, and a gate must not open on a measurement of a trial the RFC already says cannot pass.

**Why this cannot wait for the next major.** The flag in question gates promotion to production. A protocol whose eval gate passes forbidden tool calls cannot be used safely for that purpose (`COMPATIBILITY.md` §3, first condition).

**Why it cannot be additive.** A new opt-in pass rule would leave `passRule: "mean"` and the suite-level `passed` wrong for every suite that does not opt in, including every suite written before the fix (`COMPATIBILITY.md` §3, second condition).

## Proposal

### §A — The gating score

For each trial, its **gating score** is:
- `0` when the trial failed a trajectory constraint: the task has `expected.trajectory` and the trajectory did not match (RFC 0244 §A, including a `forbidden` hit);
- `0` when the trial failed closed on a fixture miss (RFC 0244 §D, unchanged: its score is already `0`);
- otherwise, the trial's `score`.

A task's **gating score** is the arithmetic mean of its trials' gating scores. With `count` = 1, it is the single trial's gating score.

The suite's **gating aggregate** is the aggregation the host uses for `aggregateScore`, applied to the per-task gating scores instead of the per-task scores.

### §B — The two pass decisions

A host **MUST** decide:
- a task's `passed` under `passRule: "mean"` as **task gating score ≥ `thresholds.passScore`**, replacing RFC 0244 §B's `meanScore ≥ thresholds.passScore`;
- `EvalSummary.passed` with **gating aggregate ≥ `thresholds.passScore`** in place of `aggregateScore ≥ passScore`. The cost and latency conditions are unchanged.

`passRule: "all"` and `"any"` are unchanged: they count trial verdicts, and a trial that failed its trajectory already did not pass.

### §C — Scores stay measurements

Nothing reported changes:
- a trial's `score` and `eval.scored.score` stay the output score (RFC 0244 §A);
- `meanScore`, the task `score`, `aggregateScore`, `passAtK`, `passHatK` and `trialStats` are computed exactly as RFC 0244 §B defines them.

So a reader can still see "the answer was good, the path was wrong".

### §D — Making the gate readable

Because `passed` can now disagree with `aggregateScore ≥ passScore`, the summary says why:
- a per-task entry for a task with `expected.trajectory` **MUST** carry `gatedScore` (the task gating score), whether or not it differs from the task's `score`;
- the summary **MUST** carry `gatedAggregateScore` (the gating aggregate) whenever any task has `expected.trajectory`;
- for a task without `expected.trajectory`, `gatedScore` **MAY** be carried when it differs from `score` (a fixture miss), and is otherwise omitted.

Both are numbers in 0–1 and content-free. They are always present where a trajectory can gate, so a consumer reads one field and never infers "absent ⇒ ungated" (resolved in the window, 2026-10-15: that inference is exactly where a reader falls back to the ungated value, the bug this RFC closes).

### Examples

**Task, `passRule: "mean"`, `passScore: 0.7`, `count: 3`.** All three trials answer well (score `0.9`) but call a `forbidden` tool. RFC 0244 reports `meanScore: 0.9` and `passed: true`. Under this RFC: `meanScore: 0.9` (unchanged), `gatedScore: 0`, `passed: false`.

**Suite, `count: 1`, two tasks, `passScore: 0.7`.** Task 1 scores `0.9` and its trajectory matches. Task 2 scores `0.9` and takes the wrong path. RFC 0244 reports `aggregateScore: 0.9` and suite `passed: true`. Under this RFC: `aggregateScore: 0.9` (unchanged), task 2 `gatedScore: 0`, `gatedAggregateScore: 0.45`, suite `passed: false`.

**No trajectory.** A suite with no `expected.trajectory` and no fixture misses is decided exactly as today, and carries neither new field.

**Trajectory matched.** A trajectory task whose every trial matched still carries `gatedScore`, equal to its `score`.

## Compatibility

**`safety-fix`** (`COMPATIBILITY.md` §3).

**What breaks, and for whom.** Only suites that use `expected.trajectory` on a golden or rubric task are affected. A host conforming to RFC 0244 reports `passed: true` where this RFC requires `false` in two cases:
- under `passRule: "mean"`, when trajectory-failed trials carry the task's mean;
- at suite level, when trajectory-failed tasks carry the aggregate.

Every other suite, and every reported score, is unchanged.

**Who implements RFC 0244 today.** MyndHyve (tier-2) and openwop-app (tier-1) advertise `agents.evalSuite.trajectory`. openwop-app already applies this gate as host policy.

**Detection.** A consumer detects a corrected host by the presence of `gatedScore` / `gatedAggregateScore` on a summary where they differ, or by the suite version its bundle certifies (the leg below). A host that has not migrated reports `passed: true` on the fixture task the leg drives.

**Migration.**
- Hosts compute the gating score alongside the score (§A) and switch the two comparisons (§B). No stored data changes, and no event shape changes.
- A deployment gate that read `passed` gets the stricter answer automatically.
- No codemod applies: the change is in host grading code, not in suites.

**Version negotiation.** No wire shape is removed or retyped; the two fields are optional additions. No `eventLogSchemaVersion` bump. The spec minor bumps, the major does not (`COMPATIBILITY.md` §3).

**Old and new behaviour in the suite.** The suite minor that carries the legs detects both: the old host fails `0246.mean-gated` and `0246.suite-gated`, and the corrected host passes them.

## Conformance

New legs in `v2-eval-trajectory-trials.test.ts`, gated on `agents.evalSuite.trajectory` and a new fixture `conformance-eval-trajectory-gate` (scripted agent, golden output scoring `1`, `passScore: 0.6`):

- **`openwop.requirement.0246.mean-gated`.** One task with `passRule: "mean"`, `count: 2`. The scripted agent produces the golden output (score `1`) and calls a `forbidden` tool in both trials. Asserted:
  - both `eval.scored` events carry `score: 1` and `passed: false`;
  - the task entry has `trials.meanScore: 1`, `gatedScore: 0` and `passed: false`, and the summary carries `gatedAggregateScore`.
- **`openwop.requirement.0246.suite-gated`.** Two tasks, `count: 1`. Task 1 matches its trajectory, and task 2 produces the golden output but takes the wrong path. Asserted:
  - `aggregateScore` equals the mean of the task scores, so it is unchanged;
  - both tasks carry `gatedScore`: task 1 equal to its `score`, task 2 `0`;
  - `gatedAggregateScore` equals the mean of the gating scores;
  - suite `passed` is `false`: `aggregateScore` is `1` and clears `0.6`, but `gatedAggregateScore` is `0.5`. An unmigrated host reports `true` here, so the leg can fail.
- **Server-free.** `gatedScore` and `gatedAggregateScore` validate; a value outside 0–1 fails.

Like the RFC 0244 host legs, these drive the scripted conformance agent, so they are `inapplicable` on a host that does not list the fixture.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B task `passed` under `mean` uses the gating score | `passed: false` with `meanScore ≥ passScore` when every trial failed its trajectory | the suite, via the scripted agent (`openwop.requirement.0246.mean-gated`) | witnessable (seam-gated: the scripted agent) |
| §B suite `passed` uses the gating aggregate | suite `passed` vs `gatedAggregateScore ≥ passScore` while `aggregateScore` clears it | the suite (`openwop.requirement.0246.suite-gated`) | witnessable (seam-gated) |
| §A which trials gate to 0 | recomputable: RFC 0244 §A trajectory grading over each trial's `agent.tool-called` events | anyone reading the run's events | witnessable |
| §C reported scores unchanged | `score`, `meanScore`, `aggregateScore` equal the RFC 0244 formulas | the suite (both legs) | witnessable |
| §D `gatedScore` on every trajectory task, `gatedAggregateScore` on any suite with one | presence and value on every fixture task, including the matched one | the suite (both legs) | witnessable |

## Alternatives considered

1. **Score a trajectory-failed trial `0`, as §D does for a miss.** Rejected. RFC 0244 §A chose to keep the output score, and that choice was considered in its window. Zeroing it loses "the answer was right, the path was wrong", which is the most useful thing a trajectory eval says. The gate needs the 0, and the report does not.
2. **A new opt-in pass rule** (for example `"mean-gated"`). Rejected: it leaves `mean` and the suite-level `passed` unsafe for every suite that does not opt in (`COMPATIBILITY.md` §3, second condition).
3. **Fix only `passRule: "mean"`.** Rejected: the suite-level `passed` has the same defect at `count: 1`, and it is the flag a deployment gate reads.
4. **Leave it as host policy.** Rejected: one host's policy does not protect a gate that reads another host's `passed`.

## Unresolved questions

1. ~~Should `gatedScore` be required whenever a task has `expected.trajectory`, rather than only when it differs?~~ **Resolved 2026-10-15: always present** on a trajectory task, and `gatedAggregateScore` on any suite with one (§D). openwop-app's consumer-side argument: one field to read, no inference rule to get wrong, and a leg can assert presence as well as value.
2. **Should a rubric `passScore` per task (if one is added later) follow the same gate?** None exists today. This RFC binds the two decisions that exist.

## Implementation notes (non-normative)

**openwop-app** already makes suite pass/fail ignore the score of constraint-failed trials (2026-10-15 eval remediation), so it needs only the two summary fields. **MyndHyve** implements RFC 0244 §A and §B and needs the gate.

## Acceptance criteria

- [ ] `schemas/v2/eval-summary.schema.json` carries optional per-task `gatedScore` and suite `gatedAggregateScore` (0–1), and the suite `passed` description names the gating aggregate.
- [ ] `schemas/v2/agent-eval-suite.schema.json` `trials.passRule` description names the gating score for `mean`.
- [ ] RFC 0244's §A grading rule and §B task-level line carry a dated pointer to this RFC.
- [ ] The fixture `conformance-eval-trajectory-gate`, the two gated legs and the server-free shape legs.
- [ ] `docs/COMPATIBILITY-CORRECTIONS-LOG.md` records the safety-fix classification.
- [ ] A `CHANGELOG.md` entry under `### Security`, citing the advisory ID per `SECURITY.md`.
- [ ] A host passes both legs non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`.

## References

- `RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md` §A (grading rule), §B (task-level fields), §D (the 2026-10-14 in-place amendment closing the same trap for misses).
- `RFCS/0081-agent-evaluation-and-scorecards.md` §A (thresholds); `RFCS/0082` (`requiredEval` deployment gate).
- `COMPATIBILITY.md` §3 (safety-fix exception); `RFCS/README.md` §"When a correction needs a new number".
- Reported by openwop-app's eval remediation (2026-10-15).

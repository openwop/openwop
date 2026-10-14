# RFC 0244: Eval suites grade the tool path, run repeated trials, and fail closed on a fixture miss

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0244                                                            |
| **Title**         | Eval suites grade the tool path, run repeated trials, and fail closed on a fixture miss |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-14                                                      |
| **Updated**       | 2026-10-14 — **`Draft` → `Active` in the filing PR, comment window waived by the maintainer (user instruction 2026-10-14)**; STEWARD OVERRIDE of RFC 0147 §A.6 recorded in `MAINTAINERS.md`. Wire surface: the v2 `agent-eval-suite`, `eval-summary` and `run-event-payloads` fields and four `agents.evalSuite` members; suite 2.46.8 adds `v2-eval-trajectory-trials` and three eval-suite fixtures. `Accepted` waits on a host advertising `trajectory` and `trials` and passing the gated legs (G9). All seven Unresolved questions resolved. |
| **Affects**       | `schemas/v2/agent-eval-suite.schema.json` (optional `expected.trajectory`, `kind: "trajectory"`, `trials`, `fixtures.onMiss`, `toolResponses[].args`/`argsMatch`) · `schemas/v2/eval-summary.schema.json` (optional per-task `trajectory`, `trials`, `efficiency`, `fixtureMissCount`; optional suite `trialStats`; optional `regression.verdict`/`method`/`pairedTaskCount`) · `schemas/v2/run-event-payloads.schema.json` (optional `trialIndex`, `scoreLabel`, `evaluatorType` on `eval.scored`; optional `trialCount` on `eval.started`) · `spec/v2/facets/agents.schema.json` (optional `evalSuite.trajectory`, `evalSuite.trials`, `evalSuite.fixtureMatching`, `evalSuite.regressionVerdict`) · `spec/v2/core/execution.md` §agents · `SECURITY/invariants.yaml` (`eval-summary-no-content-leak` scope note) · fixture `conformance-eval-trajectory` · new `conformance/src/scenarios/v2-eval-trajectory-trials.test.ts` · extended `agent-eval-suite-shape.test.ts` · new non-normative `docs/eval-otel-mapping.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4. Every new field is optional and every new capability facet is optional. A suite that uses none of them is graded exactly as RFC 0081 grades it today. No field is renamed, removed or narrowed, and no MUST relaxes. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0081 can only grade the final output of an agent task (a golden match or a judge's rubric) and runs each task once. Agent evaluation practice has moved past both limits. Graders now check the tool calls an agent made, run each case several times because agents are nondeterministic, and report steps and tokens next to the score. This RFC adds those three things to the existing `AgentEvalSuite` and `EvalSummary`, with no new endpoint and no new event type:

- an optional **trajectory expectation** on a task, using the four match modes the market has settled on;
- optional **repeated trials**, with pass@k and pass^k defined by formula so two hosts report the same number;
- **efficiency scalars**, reported and never gated.

It also closes a hole in RFC 0081's fixtures: a suite can declare that a tool call matching no fixture **fails the task** instead of reaching a live tool. Finally, it aligns `eval.scored` with the OpenTelemetry `gen_ai.evaluation.result` vocabulary.

## Motivation

**What practitioners do now (October 2026).** A three-part survey of vendors, methods and standards found broad agreement across Google Vertex/ADK, Azure AI Foundry, LangSmith `agentevals`, Promptfoo, Ragas, UK AISI Inspect, and Anthropic's published guidance:

1. **Grade the outcome first, then check the path.** Exact-sequence checks are brittle. The usual design is that a trajectory is a constraint: required tools, forbidden tools, and order where order matters.
2. **One vocabulary of match modes:** `exact`, `in-order` (extra calls allowed), `any-order`, and `subset` (no tools beyond the expected ones). Argument matching is a separate axis.
3. **Repeated trials.** pass@k means at least one of k trials passed. pass^k means all k passed. pass^k is the consistency measure that customer-facing agents need: at 75% per-trial success, pass^3 ≈ 42% (τ-bench).
4. **Efficiency is reported, not gated.** Turns, tool calls and tokens appear next to quality.

**Why RFC 0081 cannot express this today:**

- **No trajectory.** `expected.kind` is `golden` or `rubric`, and both read only the output. A support agent that answers correctly but issues an unrequested refund passes. The `agent.tool-called` events that would catch it are already in the run, but the suite has nowhere to say what to look for.
- **One trial.** `eval.scored` is emitted "once per task", so a suite cannot ask how often the agent gets a task right. A 60% agent and a 100% agent can return identical scorecards.
- **Undefined fixture miss.** §A says a host MUST inject `fixtures.toolResponses` "in place of live tool calls". It does not say what happens when the agent calls a tool with arguments no fixture covers. A host that falls through to the live tool turns a reproducible `golden` eval into a live one without saying so. This is the "cassette trap" practitioners warn about.
- **No portable comparison.** `regression.scoreDelta` is a single number. Without a pairing rule or a named method, two hosts can report the same delta and mean different things.

**Why this belongs in the spec.** RFC 0081's whole premise is that *two hosts can run the same evaluation of the same agent pack and compare results* (its Motivation, gap 1). That premise fails if each host invents its own trajectory semantics and its own pass@k estimator. The survey found that **no standard owns trials or trajectory grading on any wire**: OpenTelemetry's `gen_ai.evaluation.result` (Development stability) has neither, and MCP and A2A define nothing about evals. The grading *implementation* (judge prompts, statistical method internals) stays a host choice, as in RFC 0081.

**What is deliberately not new.** OpenWOP's run event log already *is* the trajectory, so this RFC defines no trajectory container format. It grades the `agent.tool-called` events a run already emits.

## Proposal

All rules below apply only to a host advertising `agents.evalSuite`, and each section only when the named facet (§G) is advertised.

### §A — Trajectory expectations

A task's `expected` block gains an optional `trajectory` object, and `expected.kind` gains a third value, `"trajectory"`, for tasks graded on the path alone:

```jsonc
"expected": {
  "kind": "golden",                         // or "rubric", or the new "trajectory"
  "match": { "strategy": "contains", "value": "refund approved" },
  "trajectory": {
    "match": "in-order",                    // exact | in-order | any-order | subset
    "calls": [
      { "tool": "crm:lookup-order", "argsMatch": "ignore" },
      { "tool": "billing:refund", "args": { "amountMinor": 4200 }, "argsMatch": "subset" }
    ],
    "forbidden": ["billing:refund-all"],    // MAY; any call to one fails the trajectory
    "includeDelegates": false               // MAY; default false — only the target agent's own calls
  }
}
```

**The observed trajectory** of a trial is the ordered list of `agent.tool-called` events (`toolName`, `inputs`) recorded inside that trial's `agent.invocation-*` bracket whose `agentId` is the task's target agent. With `includeDelegates: true`, it is every `agent.tool-called` event in the bracket, delegates and fan-out children included, in log order.

**Call matching.** An expected call matches an observed call when `tool` equals `toolName` and the arguments match under `argsMatch`:
- `ignore` (the default): arguments are not compared.
- `exact`: `inputs` JSON-deep-equals `args`.
- `subset`: every key path in `args` is present in `inputs` with a JSON-deep-equal value.

**Match modes.** The host **MUST** evaluate the mode with exactly these semantics:

| Mode | Matches when | Equivalent elsewhere |
|---|---|---|
| `exact` | the observed list has the same length as `calls`, and the i-th observed call matches the i-th expected call | Vertex/ADK/Azure `exact_match`; agentevals `strict` |
| `in-order` | `calls` matches a subsequence of the observed list, in order; extra calls are allowed | Vertex/Azure `in_order_match`; Promptfoo `tool-sequence: in_order` |
| `any-order` | each expected call is matched by a distinct observed call, in any order; extra calls are allowed | Vertex/Azure `any_order_match`; agentevals `superset` and `unordered` |
| `subset` | every observed call matches some expected call (repeats allowed); no tool outside `calls` was called | agentevals `subset` |

A call to any tool listed in `forbidden` **MUST** make the trajectory unmatched, whatever the mode.

**Grading rule.**
- For `kind: "golden"` or `"rubric"` with a `trajectory`, the trial **MUST NOT** pass unless the trajectory matched. The trial's `score` stays the output score.
- For `kind: "trajectory"`, `score` is `1` when matched and `0` otherwise, and `match`/`rubric` **MUST** be absent.

**Reporting.** The per-task summary entry carries a content-free `trajectory` block:

```jsonc
"trajectory": { "mode": "in-order", "matched": false, "expectedCount": 2, "observedCount": 3, "matchedCount": 1, "forbiddenCount": 1 }
```

Counts only. `matchedCount` is mode-independent: the size of a maximum one-to-one matching between expected and observed calls under each call's `argsMatch`, ignoring order (added at `Active`, so two hosts count the same thing). Precision (`matchedCount/observedCount`) and recall (`matchedCount/expectedCount`) are derivable, so they are not carried. It **MUST NOT** carry tool names, arguments or results (§H). With trials (§B), the block describes the **last** trial, and `trials` carries the pass counts.

**Recomputable by design.** Because the trajectory grade is a pure function of the suite and of `agent.tool-called` events in the run's own log, any party that can read the run's events can recompute it. That is the falsifiability lever in §Conformance.

### §B — Repeated trials

The suite gains an optional `trials` block:

```jsonc
"trials": { "count": 5, "k": 3, "passRule": "all" }
```

- `count` is an integer ≥ 1 (absent ⇒ 1).
- `k` is an integer with 1 ≤ k ≤ `count` (absent ⇒ `count`).
- `passRule` is `"all"`, `"any"` or `"mean"` (absent ⇒ `"all"`).

**Execution.** A host **MUST** execute each task `count` times, each as its own child agent invocation.

**Isolation.**
- Each trial **MUST** start from the same fixtures and the same `memorySeed` snapshot.
- Memory written by one trial **MUST NOT** be visible to another trial of the same eval run.
- An `onMiss`/fixture cursor (§D) **MUST** reset per trial.

**Events.**
- `eval.scored` is emitted once per task **per trial** and carries `trialIndex`: 0-based, contiguous, unique per `(taskId, trialIndex)`.
- `eval.started` carries `trialCount` (= `count`) whenever `count` > 1.
- With `count` = 1 the event stream is unchanged from RFC 0081, and `trialIndex` MAY be omitted.

**Per-task summary.** Let `n` = `count` and `c` = trials that passed. The per-task summary entry carries `trials: { n, passedCount: c, meanScore, passAtK, passHatK }`, where `meanScore` is the arithmetic mean of the trial scores. The host **MUST** compute:

- `passAtK = 1 − C(n−c, k) / C(n, k)` (the unbiased pass@k estimator; `0` when `c = 0`);
- `passHatK = C(c, k) / C(n, k)` (τ-bench pass^k; `0` when `c < k`).

**Task-level fields.**
- The task's `score` is `meanScore`.
- The task's `passed` follows `passRule`: `all` ⇔ `c = n`; `any` ⇔ `c ≥ 1`; `mean` ⇔ `meanScore ≥ thresholds.passScore`.

**Suite level.** `EvalSummary.trialStats` carries:
- `k`;
- `passAtK` and `passHatK`, the means of the per-task values;
- `scoreStderr`, the standard error of `aggregateScore` clustered by task: the sample standard deviation of the per-task `meanScore` values divided by √(taskCount). It is omitted when taskCount < 2.

The formulas are normative so that two hosts' numbers are comparable. A host **MUST** agree with each formula to within `|host − formula| ≤ 1e-9 · max(1, |formula|)`; it need not reproduce any particular float evaluation order (added at `Active`: a host computing the binomials exactly can differ from a float product in the last bit). The suite's reference computes `C(a,k)/C(b,k)` as an exact rational. How trials are scheduled stays host-internal.

**Cost.** `thresholds.maxCostUsd` and the host's `maxCostUsdPerSuite` **MUST** count every trial.

### §C — Efficiency scalars (reported, never gated)

Each per-task summary entry gains an optional `efficiency` object with these fields:
- `toolCallCount`: count of `agent.tool-called` events;
- `modelCallCount`: count of `provider.usage` events;
- `inputTokens` and `outputTokens`: sums of the same-named `provider.usage` fields.

Each is a mean over the task's trials, and each is counted inside the task's invocation brackets. Judge calls (RFC 0081 UQ 5) are **excluded**, so that efficiency measures the agent under test. The fields are informational: a host **MUST NOT** fail a task or a suite on them. Gating thresholds are deferred (UQ 3).

### §D — Fixture matching and the fail-closed miss

`fixtures.toolResponses[]` entries gain optional `args` and `argsMatch` (the §A semantics; absent ⇒ `ignore`), and `fixtures` gains an optional `onMiss`: `"fail"` or `"live"`.

**Selection.** For each tool call in a fixtured trial, the host **MUST** serve the first *unconsumed* `toolResponses` entry whose `tool` and `args` match. Each entry is consumed once, so repeated calls walk a scripted sequence.

**`onMiss: "fail"`.** A call that matches no unconsumed entry **MUST NOT** reach a live tool or any external side effect. The host **MUST**:
- return a tool error to the agent;
- count the miss in the per-task `fixtureMissCount`;
- report the trial `passed: false`.

**`onMiss: "live"`.** A miss **MAY** call the live tool. The task's summary entry **MUST** then carry `fixtureMissCount` > 0, so a reader can see that the eval was not fully fixtured.

**Absent `onMiss`.** The host's RFC 0081 behaviour is unchanged. A host **SHOULD** treat it as `"fail"`.

`live-shadow` still ignores fixtures entirely.

### §E — Score labels and evaluator type (OpenTelemetry-aligned)

`eval.scored` gains three optional fields:
- `scoreLabel`: low-cardinality, pattern `^[a-z0-9][a-z0-9_-]{0,63}$`, for example `pass`, `fail`, `partial`;
- `evaluatorType`: `"deterministic"`, `"llm_judge"` or `"human"`;
- `trialIndex` (§B).

These map onto `gen_ai.evaluation.score.label` and the provisional `gen_ai.evaluation.evaluator.type`. The mapping is published in the non-normative `docs/eval-otel-mapping.md`. `evaluatorType` is **provisional** until OpenTelemetry semantic-conventions-genai PR #359 merges (UQ 4). A free-text `explanation` is deliberately **not** added, because it is content (§H).

### §F — The paired regression verdict

For `regression` mode, `EvalSummary.regression` gains optional `verdict` (`"improved"` | `"regressed"` | `"unchanged"` | `"inconclusive"`), `method` (pattern `^[a-z0-9][a-z0-9-]{0,63}$`; RECOMMENDED values `paired-bootstrap`, `mcnemar`, `sign-test`, `paired-t`), `alpha` (number, 0–1) and `pairedTaskCount`.

A host emitting `verdict`:
- **MUST** compare only tasks present in both runs, paired by `taskId`;
- **MUST** report how many it paired;
- **MUST** report `inconclusive` rather than `improved` or `regressed` when its method cannot distinguish the runs at `alpha`.

`scoreDelta` is unchanged. A deployment gate (RFC 0082) MAY require `verdict ≠ "regressed"`. The statistical method itself stays host-internal; naming it is what makes two verdicts comparable.

### §G — Capability facets

`agents.evalSuite` gains four optional members. A host **MUST** advertise each only if it implements the matching section (RFC 0031):

```jsonc
"agents": { "evalSuite": {
  "modes": ["golden", "rubric", "regression"],
  "trajectory": true,                    // §A
  "trials": { "maxTrials": 10 },         // §B
  "fixtureMatching": true,               // §D (args matching + onMiss)
  "regressionVerdict": true              // §F
}}
```

At run create, a suite that uses one of these features on a host that does not advertise its facet **MUST** be rejected with `400 validation_error`, naming the field. The features are: `expected.trajectory` or `kind: "trajectory"`; `trials.count` > 1, or a count above `maxTrials`; `onMiss` or `toolResponses[].args`. This is the same rule RFC 0081 applies to an unadvertised mode. A host **MUST NOT** silently grade such a suite as if the field were absent.

### §H — Safety

- **Content-free, extended.** Every field this RFC adds to `eval.*` events and to `EvalSummary` is an id, an enum, a count, a score or a scalar. The `trajectory` block carries **counts only**: no tool names, arguments or results. `scoreLabel` is pattern-bound so it cannot carry prose. The `eval-summary-no-content-leak` invariant's scope note is extended to name these fields.
- **Fixtures are untrusted tool output.** A host **MUST** apply to an injected fixture response the same untrusted-content handling it applies to a live tool result (`threat-model-prompt-injection.md`). A fixture is authored content that reaches the model.
- **Suite args are suite content.** `trajectory.calls[].args` and `toolResponses[].args` live in the suite, which RFC 0081 already says carries no secret material. They are never echoed onto the wire.
- **Cost amplification.** Trials multiply spend. The ceilings in §B and the `maxTrials` advertisement bound it.
- **Replay.** `trialIndex` and every new summary field are recorded facts (`replay.md` §Recorded-fact events). A replay or fork re-reads them and never re-runs a trial or re-judges.
- **Cross-tenant.** Unchanged from RFC 0081: everything is scoped to the run's owner triple.

### Examples

**Positive.** On a host advertising `trajectory` and `trials.maxTrials ≥ 5`, a suite with one task (`count: 5`, `k: 3`, `passRule: "all"`, `trajectory.match: "in-order"`) emits:
- `eval.started{taskCount:1, trialCount:5}`;
- five `eval.scored{taskId, trialIndex:0..4, score, passed}`;
- `eval.completed`.

If four trials match, the task entry is `trials:{n:5, passedCount:4, meanScore:0.8, passAtK:1.0, passHatK:0.4}` with `passed:false` (`all` requires 5/5). Here `passAtK` = 1 − C(1,3)/C(5,3) = 1, and `passHatK` = C(4,3)/C(5,3) = 4/10.

**Negative (capability).** The same suite on a host that advertises `evalSuite` without `trials` → `400 validation_error` naming `trials.count`.

**Negative (schema).**
- `trajectory.match: "superset"` fails the enum (use `any-order`).
- `trials.k: 6` with `count: 5` fails.
- `scoreLabel: "Looks good to me"` fails the pattern.
- A summary `trajectory` block carrying `"tools": ["billing:refund"]` fails (`additionalProperties: false`).

**Negative (behaviour).** In an `onMiss: "fail"` trial, the agent calls `billing:refund` with arguments matching no fixture. The live `billing:refund` is never invoked, `fixtureMissCount` is 1, and the trial reports `passed:false`.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.4).

**Every addition is optional:**
- On the suite: `trajectory`, the `kind: "trajectory"` value, `trials`, `onMiss`, and `toolResponses[].args` / `argsMatch`.
- On the summary: `trajectory`, `trials`, `efficiency`, `fixtureMissCount`, `trialStats`, and the four new `regression` fields.
- On events: `trialIndex`, `scoreLabel`, `evaluatorType` and `trialCount`.
- On the capability: the four facets.

**Old suites are unaffected.** A suite that uses none of these produces exactly the RFC 0081 stream and scorecard. A host that advertises none of the facets stays exactly as conformant as it is today.

**Three points need care:**

1. **"Once per task" becomes "once per task per trial", but only for suites that opt into `count` > 1.** A consumer that counts `eval.scored` events to infer `taskCount` would miscount on such a suite. `eval.started.trialCount` is how a consumer detects it, and RFC 0081 already tells consumers to read `taskCount` from `eval.started` / `eval.completed`. Recorded as risk R1.
2. **A new enum value on `expected.kind`.** A host validating suites against the RFC 0081 schema rejects a `kind: "trajectory"` suite with `400`. That is the correct refusal for a feature it does not implement (§G), not a break.
3. **`onMiss` does not tighten RFC 0081.** Absent `onMiss`, behaviour is unchanged. The fail-closed rule binds only suites that ask for it, so no host that conformed yesterday stops conforming today. The SHOULD-default-fail is advice.

**Event-log version.** No `eventLogSchemaVersion` bump: these are additive optional payload fields (the RFC 0008 §K / RFC 0058 precedent).

## Conformance

**Existing coverage:**
- `agent-eval-suite-shape.test.ts` (always on, server-free);
- `agent-eval-run.test.ts` (gated on `agents.evalSuite`);
- `v2-eval-mode-unadvertised-refused.test.ts`.

**New scenarios (suite 2.46.8).** The v1 `agent-eval-suite-shape.test.ts` stays as it is: it runs at major 1 against the frozen v1 schemas, and this RFC changes only v2.

- **`v2-eval-trajectory-trials.test.ts`, server-free legs (always on).**
  - The new suite, summary and payload fields validate.
  - Negatives: a `superset` mode, `trials.count: 0`, an unknown trajectory member, an unknown `evaluatorType`.
  - Content-free negatives, the v2 public test for `eval-summary-no-content-leak`: a trajectory block naming tools, a prose `scoreLabel`.
  - The three eval-suite fixtures validate.
- **`lib/eval-trajectory.ts` + self-tests.** The suite's reference grader: the four modes, `forbidden`, `argsMatch`, the mode-independent `matchedCount`, and the §B formulas checked over a fixed `(n, c, k)` table. The host legs compare the host's grade with this one, never with itself.
- **`v2-eval-trajectory-trials.test.ts`, host legs.** Each leg is gated on its `agents.evalSuite` member and its fixture in discovery `fixtures`. Every task targets the suite-defined scripted agent `core.conformance.agents.scripted` (contract in `fixtures.md`), so each trajectory is known in advance and no test key is needed.
  - **Trajectory** (`conformance-eval-trajectory`). Five tasks cover a match under `in-order` with an args `subset`, a wrong order, a `forbidden` hit, a trajectory-only `subset` with repeats, and an `exact` args mismatch. For each task, the summary's `trajectory` block must equal the reference grade; an unmatched task must not pass; a trajectory-only task must score 1 or 0. The log must carry one `agent.tool-called` per scripted call.
  - **Trials** (`conformance-eval-trials`, `count: 3`, `k: 2`). The leg checks `eval.started.trialCount`, `trialIndex` 0..2 once each per task, and the per-task `passedCount` / `meanScore` / `passAtK` / `passHatK`. It checks `trialStats.scoreStderr` against the formula over the observed per-trial events.
  - **Fail-closed miss** (`conformance-eval-fixture-miss`). The missed task reports `fixtureMissCount: 1` and `passed: false`; the served task passes. That no live tool ran is not asserted: the scripted agent never reaches a live tool by contract, and a suite-owned effect counter is still owed (G2).
  - **Refusal.** On a host advertising `evalSuite` without `trials` but listing `conformance-eval-trials`, `createRun` → `400 validation_error`.

**INTEROP-MATRIX.** Four new sub-columns under `agents.evalSuite`. No host advertises them yet.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A match-mode semantics | the summary's `trajectory` block and `passed` vs the reference grade of the scripted calls; the log's `agent.tool-called` count | the suite, via the scripted agent and a seeded eval-suite fixture | witnessable where the host seeds `conformance-eval-trajectory` |
| §A `argsMatch: exact`/`subset` | same, with arguments compared | the suite | witnessable **only if** the host's `agent.tool-called` carries `inputs` unredacted; a host emitting only `argsHash` makes arg matching seam-gated (UQ 6) |
| §A `forbidden` fails the trajectory | `passed:false`, `forbiddenCount ≥ 1` | the suite (scripted forbidden call) | witnessable |
| §A summary carries counts only | schema validation of the summary | the suite, unaided | witnessable |
| §B `count` trials, contiguous `trialIndex` | number and indices of `eval.scored` per task | the suite, unaided | witnessable |
| §B pass@k / pass^k / stderr formulas | summary values vs the formula over observed per-trial `passed` / `score`, within 1e-9 relative | the suite, unaided | witnessable |
| §B trial isolation (no memory bleed) | a trial reading memory a prior trial wrote | needs an agent that writes, then reads, memory across trials | seam-gated: causable only with a scripted memory-writing agent; deferred (G3) |
| §B cost counts every trial | `totalCostUsd` vs summed `provider.usage` | the suite (mock `usage-only` provider) | witnessable when that mock is advertised |
| §C efficiency counts | summary vs counted events inside the brackets | the suite, unaided | witnessable |
| §C MUST NOT gate on efficiency | a task with high counts still passes | the suite (scripted many-call agent) | witnessable |
| §D first-unconsumed selection | which fixture response was served to each repeated call | needs an agent that really calls tools and exposes what it received; the mock agent's results are scripted, not served | **seam-gated** (G2) |
| §D `onMiss: "fail"` blocks live side effects | `fixtureMissCount = 1` and `passed:false` (witnessable); "the live tool was never invoked" needs an effect counter | the suite for the report; a conformance tool with an observable counter for the no-live-call half | **seam-gated** until that tool exists (G2) |
| §D `onMiss: "live"` reports the miss | `fixtureMissCount > 0` | the suite | witnessable |
| §E `scoreLabel` pattern | schema | the suite | witnessable |
| §F pairing by `taskId` and `pairedTaskCount` | `pairedTaskCount` = shared task count between baseline and candidate | the suite (two eval runs with overlapping task sets) | witnessable |
| §F `inconclusive` when indistinguishable | — | depends on the host's own method and `alpha`; the suite cannot know its power | **unwitnessable in general.** Only the degenerate case is witnessable: identical runs MUST NOT report `improved` or `regressed`. Recorded as UQ 5. |
| §G refusal of unadvertised features | `400 validation_error` naming the field | the suite, unaided | witnessable |
| §H fixtures handled as untrusted content | — | — | **unwitnessable from outside.** It is a host-internal handling rule; covered by the threat model, not the suite. |

## Alternatives considered

1. **Do nothing; leave trajectories and trials to host extensions.** Rejected. Each host would invent its own match semantics and pass@k estimator, which defeats RFC 0081's stated purpose: two hosts running the same suite and comparing results. The survey found no other standard filling the gap.
2. **A portable trajectory format** (adopting Harbor ATIF, or Inspect's `EvalLog` events). Rejected. OpenWOP's event log already records every tool call with `toolName`, `inputs` and `argsHash`. A second trajectory container would duplicate it and drift from it. An export mapping (non-normative) gets the interop benefit without that cost.
3. **Adopt the OpenTelemetry `gen_ai.evaluation.result` event as the wire event.** Rejected for now. It is Development stability, its repository has no tagged release, and it has no trial, aggregate or trajectory fields. This RFC aligns the *names* (§E) and publishes a mapping, so adoption later is a rename, not a redesign.
4. **Make the trajectory part of the score** (a weighted blend with the output score). Rejected. Mixing path and outcome into one number hides which one failed. The market treats the trajectory as a constraint, and the summary still reports matched counts for diagnosis.
5. **Gate on efficiency thresholds now.** Deferred (UQ 3). Practice is to report efficiency, not gate on it (ADK states its efficiency metrics never fail a case), and a threshold invites tuning to the counter.
6. **Make `onMiss: "fail"` the unconditional rule.** Rejected. It would narrow RFC 0081 and could break a host that conformed yesterday, which requires a breaking classification. Opt-in plus a SHOULD gets the safety for suites that ask for it.

## Unresolved questions

**All seven resolved 2026-10-14 for `Active`.** The maintainer waived the comment window. Each answer below is locked into §A–§G.

1. **Default `passRule`.** Resolved: `all`, whatever the mode. A default that depends on the mode is a rule a reader has to look up. A capability suite sets `passRule: "mean"` explicitly.
2. **Trajectory scope across sub-agents.** Resolved: by default, only the target agent's own calls count. The observed trajectory is the `agent.tool-called` events in the trial's bracket whose `agentId` equals the task's target agent. An optional `trajectory.includeDelegates: true` widens it to every `agent.tool-called` in the bracket, including RFC 0077 / 0243 delegates and fan-out children. Added to §A.
3. **Efficiency thresholds.** Resolved: out of scope. §C stays reported-only; a gating threshold would be a follow-up RFC with its own facet.
4. **`evaluatorType` stability.** Resolved: this RFC locks its own enum (`deterministic`, `llm_judge`, `human`). OpenTelemetry PR #359 was still unmerged on 2026-10-14 (`state: open`, last updated 2026-10-12). Following an OpenTelemetry rename is the job of the non-normative mapping doc, never of a wire change.
5. **Regression method registry.** Resolved: open, but bounded. `method` matches `^[a-z0-9][a-z0-9-]{0,63}$`, and the spec RECOMMENDS the registered names `paired-bootstrap`, `mcnemar`, `sign-test` and `paired-t`. A host using another method MUST still name it.
6. **Arguments under redaction.** Resolved: `argsMatch` is evaluated by the host against the call as executed, before any wire redaction. External recomputation of argument matching is possible only where `agent.tool-called.inputs` reaches the wire unredacted. Otherwise that leg is seam-gated, as the Falsifiability row already records. No `argsHash` matching is added: the hash recipe is not pinned across hosts.
7. **Recorded-run fixtures.** Resolved: out of scope for this RFC. A host MAY export a recorded run's tool boundary as `toolResponses` with `args` and run it under `onMiss: "fail"`; §D already carries everything that needs. A portable "fixtures = run X" reference is left to a follow-up RFC (G5).

## Implementation notes (non-normative)

**Reference host.** openwop-app (the steward production host) does **not** advertise `agents.evalSuite` today: `mode: eval` answers `422`. Its eval work is host extension:
- workflow eval sets with output/path assertions and an LLM judge (app ADR 0477);
- online scoring (ADR 0480);
- a deterministic workforce eval.

The realistic path is an app ADR that implements RFC 0081 (golden and regression first) on the ADR 0477 machinery, followed by this RFC's trajectory and trials. The app's chat-dispatch mock provider cannot script tool calls today. Its workflow-lane `core.conformance.mock-agent` can, and that is the seam the conformance scenario uses.

**Recorded fixtures (UQ 7).** Replay-to-checkpoint-then-fork (Chronicle, arXiv 2609.20625) maps directly onto `:fork`. A host can offer it today as a host extension: export a run's tool boundary as a `toolResponses` list with `args`, then run it with `onMiss: "fail"`. That needs nothing beyond §D.

**Export.** `docs/eval-otel-mapping.md` should map:
- `eval.scored` → `gen_ai.evaluation.result`, with `name` = `<suiteId>/<taskId>`, `score.value`, `score.label`, and `evaluator.type`;
- `EvalSummary` → Every Eval Ever's aggregate and instance records.

**Effort.** S for schemas, prose and the shape scenario; M for the behavioural scenario and fixture; M–L for a host, the trial isolation being the largest part.

## Acceptance criteria

- [x] `spec/v2/facets/agents.schema.json` carries the four `evalSuite` members with their rules in the descriptions (`execution.md` §agents already points facet rules there, so the core budget is unchanged).
- [x] `agent-eval-suite`, `eval-summary` and `run-event-payloads` (v2) carry the optional fields, all objects `additionalProperties: false`. The two cross-field rules (`kind: "trajectory"` carries no `match`/`rubric`; `k` ≤ `count`) are suite rules, not schema conditionals (COMPATIBILITY.md §2.4).
- [x] `eval-summary-no-content-leak` scope note names the new fields; the v2 shape negatives cover them.
- [x] `v2-eval-trajectory-trials.test.ts` (server-free shape + four gated host legs) and the reference grader `lib/eval-trajectory.ts` with self-tests. The v1 `agent-eval-suite-shape.test.ts` is left alone: it runs at major 1 against the frozen v1 schemas. Three eval-suite fixtures under `fixtures/eval-suites/` with the scripted-agent contract in `fixtures.md`.
- [x] `docs/integrations/eval-otel-mapping.md` (non-normative) published.
- [x] CHANGELOG entry (2.46.8 cycle).
- [ ] A host advertises at least `trajectory` and `trials` and passes the gated scenario non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`, OR this RFC records why reference-host implementation is deferred.

## References

- `RFCS/0081-agent-evaluation-and-scorecards.md` — the surface this extends; `spec/v2/core/execution.md` §agents, `spec/v2/core/runs.md` §Refusals.
- `RFCS/0077` (invocation bracket), `RFCS/0026` (`provider.usage`), `RFCS/0054` (`:diff`), `RFCS/0082` (promotion gate), `RFCS/0237` (declared nondeterminism sources).
- Research write-up: openwop-app `docs/research/deep-research-agent-evals.md` (2026-10-14).
- Anthropic, "Demystifying evals for AI agents" — <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>.
- τ-bench (pass^k) — <https://export.arxiv.org/pdf/2406.12045>; τ²-bench — <https://arxiv.org/abs/2506.07982>.
- Chen et al., unbiased pass@k estimator — <https://arxiv.org/abs/2107.03374>.
- Miller, "Adding error bars to evals" — <https://arxiv.org/abs/2411.00640>.
- Vertex AI agent evaluation — <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-agents>; Azure agent evaluators — <https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/evaluation-evaluators/agent-evaluators>; LangChain agentevals — <https://github.com/langchain-ai/agentevals>; Inspect metrics — <https://inspect.aisi.org.uk/metrics.html>.
- OpenTelemetry GenAI events — <https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-events.md>; PR #359 — <https://github.com/open-telemetry/semantic-conventions-genai/pull/359>.
- Chronicle (record and cut-point replay) — <https://arxiv.org/abs/2609.20625>.

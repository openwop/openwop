# RFC 0081: Agent Evaluation, Scorecards, and Promotion Gates

| Field | Value |
|---|---|
| **RFC** | 0081 |
| **Title** | Define a portable `AgentEvalSuite` artifact, an eval-run projection over the existing run surface (an `eval.*` event family + an `EvalSummary` schema), a host-advertised `agents.evalSuite` capability with a closed `modes[]` vocabulary (golden / rubric / adversarial / regression / live-shadow), and the composition seam by which an eval result MAY gate an agent deployment promotion — all additive |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-29 |
| **Updated** | 2026-05-29 |
| **Affects** | NEW `schemas/agent-eval-suite.schema.json` (portable eval-suite artifact, pack-distributed like `systemPromptRef` / handoff schemas) · NEW `schemas/eval-summary.schema.json` (the terminal scorecard) · `schemas/run-event.schema.json` (additive `RunEventType` enum: `eval.started` / `eval.scored` / `eval.completed`) · `schemas/run-event-payloads.schema.json` (the three content-free eval payloads) · `schemas/capabilities.schema.json` (additive optional `agents.evalSuite` block) · `spec/v1/agent-evaluation.md` (NEW normative doc) · `api/openapi.yaml` (additive `GET /v1/runs/{runId}/eval-summary`; eval run-mode reuses `POST /v1/runs`) · `api/asyncapi.yaml` (eval channels) · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop can run an agent (RFC 0070/0072/0077) and observe its reasoning, tool calls, cost (RFC 0026), and human feedback (RFC 0056) — but it has **no portable way to answer "is this agent good enough to deploy?"**. Feedback (RFC 0056) is a post-hoc human quality signal, not a repeatable benchmark; run-diff (RFC 0054) compares two runs structurally but carries no notion of *score* or *threshold*. A platform that wants to gate a model swap, a prompt change, or a pack publish on measurable quality has nowhere to put the eval suite, the scorecard, or the pass/fail bar. This RFC adds that surface **additively**: a portable **`AgentEvalSuite`** artifact (tasks + expected outputs or rubrics + tool/memory fixtures + allowed models + pass/fail thresholds, distributed in a pack tarball exactly like a `systemPromptRef`), an **eval run** that is a *projection over the existing run surface* (`POST /v1/runs` with `mode: "eval"` against a suite — no bespoke executor), a content-free **`eval.{started,scored,completed}`** event family bracketing the existing `agent.*` / `provider.usage` events, an **`EvalSummary`** scorecard schema (score / cost / latency / regressions-vs-baseline / safety-findings / schema-validity), and a host-advertised **`agents.evalSuite`** capability naming which of five eval **modes** (golden / rubric / adversarial / regression / live-shadow) it supports. It composes — not duplicates — RFC 0054 (regression baseline), RFC 0026 (per-task cost), and RFC 0056 (human override of an auto-score), and defines the seam by which RFC 0082 deployment promotion MAY require an eval pass. No existing field, event, or endpoint changes.

## Motivation

`docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0081" frames it: *a best-in-class agent platform needs a way to answer "is this agent good enough to deploy?" — the protocol has feedback and annotations, but not eval suites or deployment scorecards.* Three concrete gaps:

1. **No portable eval artifact.** An agent's quality bar (its golden tasks, its rubric, the tool/memory fixtures the tasks run against, the models it's allowed to use, the score it must clear) lives nowhere on the wire. Two hosts cannot run *the same* evaluation of *the same* agent pack and compare results, and a pack author cannot ship "here is how you tell if this agent works" alongside the agent. This is exactly the portability gap openwop exists to close, applied to evaluation.
2. **No scorecard or threshold.** A run terminates `completed` or `failed` (run lifecycle), and a human can attach a `rating` after the fact (RFC 0056) — but there is no *score* (did it clear 0.8?), no *cost/latency budget for the eval*, and no *regression signal* ("this model swap dropped the score 12 points"). Run-diff (RFC 0054) tells you *where* two runs diverged structurally, not *whether the newer one is worse*.
3. **No promotion seam.** RFC 0051 gates a deployment on a human approval (role/scope); nothing lets that gate say "approve only if the eval suite passes." Without a portable eval result, deployment promotion (RFC 0082) can only ever be a human judgment call, never an evidence-backed one.

The spec is the right place because *eval-suite portability*, *scorecard shape*, and the *eval→promotion seam* are cross-host interop concerns: a registry that runs a pack's eval before publishing, an operator comparing two model choices, and a deployment gate that wants evidence all depend on one agreed shape. The *scoring implementation* (how a rubric is judged, which judge model is used) stays a host choice; this RFC fixes the portable artifact, the observable event family, the scorecard, and the capability advertisement — all additively.

## Proposal

### §A — The `AgentEvalSuite` portable artifact (NEW `agent-eval-suite.schema.json`)

An `AgentEvalSuite` is a standalone JSON artifact, distributed **in a pack tarball and referenced by URI** the same way `systemPromptRef` and handoff schemas are (RFC 0003 §"refs resolved at install"; RFC 0070 §C/§D). It is **not** embedded in `AgentManifest` — an agent MAY carry an optional `evalSuiteRef` (additive optional field on `agent-manifest.schema.json`), and a suite MAY also be authored independently and pointed at any `agentId`.

```jsonc
{
  "suiteId": "core.openwop.evals.support-resolver",   // <scope>.<org>.evals.<name>
  "version": "1.0.0",
  "targetAgentId": "core.openwop.agents.support-resolver", // optional; a suite MAY be agent-agnostic
  "modes": ["golden", "regression"],          // §D vocabulary; the modes this suite exercises
  "allowedModels": ["reasoning", "general"],  // modelClass values (RFC 0002) the suite is valid for
  "thresholds": { "passScore": 0.8, "maxCostUsd": 0.50, "maxP95LatencyMs": 8000 },
  "tasks": [
    {
      "taskId": "refund-policy-q",
      "input": { /* run input, validated against the agent's input schema */ },
      "expected": {                            // golden: exact/contains/json-match; rubric: criteria
        "kind": "rubric",                      // "golden" | "rubric"
        "rubric": [{ "criterion": "cites the 30-day window", "weight": 0.5 }, ...]
      },
      "fixtures": { "toolResponses": [...], "memorySeed": [...] }  // deterministic tool/memory inputs
    }
  ]
}
```

Normative shape rules: `additionalProperties: false`; `suiteId` matches `^[a-z0-9.-]+\.evals\.[a-z0-9-]+$`; `expected.kind` is `golden` or `rubric`; `thresholds.passScore` is `0.0–1.0`. Fixtures are the deterministic substitute for live tool/memory I/O so a golden/regression eval is reproducible (the eval host MUST inject `fixtures.toolResponses` in place of live tool calls when present; live-shadow mode, §D, is the explicit exception).

### §B — Eval run = a projection over the existing run surface (no bespoke executor)

An eval **is a run**. A client starts one via the existing `POST /v1/runs` with an additive `mode: "eval"` discriminator and an `evalSuiteRef` (mirroring RFC 0072's "dispatch is `WorkflowNode.agent` + `POST /v1/runs`, not a bespoke endpoint"):

```jsonc
POST /v1/runs  { "mode": "eval", "evalSuiteRef": "...", "agentId": "...", "configurable": { "evalModes": ["golden"] } }
```

The host executes each `task` as a child agent invocation (reusing the RFC 0077 `agent.invocation.*` bracket + the existing `agent.reasoned` / `agent.toolCalled` / `agent.decided` / `provider.usage` events per task), scores it, and terminates the run with an `EvalSummary` (§C) as its output. A new run-mode is additive: hosts that don't advertise `agents.evalSuite.supported` reject `mode: "eval"` with `501 capability_not_provided` (the RFC 0056 precedent). The only **new** read surface is `GET /v1/runs/{runId}/eval-summary` returning the `EvalSummary` for a terminal eval run (additive sibling endpoint).

### §C — The `eval.*` event family + `EvalSummary` scorecard

Three **content-free** event types (added to `run-event.schema.json` `RunEventType`; payloads in `run-event-payloads.schema.json`), bracketing the per-task `agent.*` events:

| Event | Emitted | Payload (content-free) |
|---|---|---|
| `eval.started` | once, at eval-run start | `{ suiteId, suiteVersion, taskCount, modes[], baselineRunId? }` |
| `eval.scored` | once **per task**, after that task's `agent.decided` | `{ taskId, score (0–1), passed (bool), costUsd?, latencyMs?, schemaValid?, safetyFindingCount? }` |
| `eval.completed` | once, before `run.completed`, after all tasks | `{ aggregateScore, passed, taskCount, passedCount, regressionVsBaseline? }` |

`eval.scored` is **per-task** so a streaming consumer (the Agents-tab scorecard) sees results land incrementally. None of the three carries task output, rubric text, model prose, or credential material — only counts, scores, and ids (SR-1; the §F invariant). The terminal **`EvalSummary`** (NEW `eval-summary.schema.json`, returned by `GET …/eval-summary` and set as the eval run's output) carries the full scorecard: `aggregateScore`, `passed`, per-task `{taskId, score, passed, costUsd, latencyMs, schemaValid, safetyFindings[]}`, `totalCostUsd` (summed from RFC 0026 `provider.usage`), `regression` (§D `regression` mode — score delta + a pointer to the RFC 0054 `:diff` against `baselineRunId`), and `suiteId`/`suiteVersion`/`evaluatedModelClass` provenance. `safetyFindings[]` entries are redaction-safe descriptors (kind + severity, no excerpted content), per §F.

### §D — Host-advertised eval modes (`agents.evalSuite` capability)

```jsonc
"agents": { "evalSuite": {
  "supported": true,
  "modes": ["golden", "rubric", "regression"],   // closed vocabulary; host advertises only what it gates on
  "maxTasksPerSuite": 200, "maxCostUsdPerSuite": 5.0   // optional ceilings (RFC 0058 clamp precedent)
}}
```

The five modes (closed vocabulary): **golden** (exact/contains/json-match against `expected`), **rubric** (a judge scores against weighted criteria — host-chosen judge; nondeterministic, §F), **adversarial** (the suite's tasks probe for unsafe/jailbreak behavior; `safetyFindings` is the primary output), **regression** (re-run a prior suite against a new agent/model/prompt version and diff scores vs `baselineRunId`, composing RFC 0054), **live-shadow** (run the suite against *live* tools/memory instead of `fixtures` — explicitly nondeterministic and the only mode that bypasses fixture injection). A host MUST advertise only the modes it actually implements (the RFC 0031 "truthful advertisement" rule); a suite requesting an unadvertised mode is rejected at run-create with `400 validation_error`.

### §E — The promotion seam (composes RFC 0082 / RFC 0051)

This RFC defines *how an eval result is referenced by a deployment gate*, not the gate itself (that is RFC 0082). The seam: a terminal eval run has a stable `runId` and an `EvalSummary.passed`; RFC 0082's promotion request MAY carry an `evalRunId`, and RFC 0051's `approvalGate` config MAY require `evalSummary.passed === true` for a given `agentId@version` before `deployment.promoted` is emitted. RFC 0081 reserves the reference shape (`{ evalRunId, requiredPassScore? }`) and defers the enforcement contract to RFC 0082 §"eval-gated promotion". A human MAY still override via RFC 0056 annotation (record a `correction` on an `eval.scored` event) — the auto-score is advisory evidence, not an immutable verdict.

### Examples

**Positive.** `POST /v1/runs {mode:"eval", evalSuiteRef:"…support-resolver@1.0.0", agentId:"…support-resolver"}` on a host advertising `agents.evalSuite.modes:["golden","regression"]` → emits `eval.started{taskCount:12}`, twelve `agent.invocation.*`-bracketed task runs each followed by `eval.scored{taskId,score,passed}`, then `eval.completed{aggregateScore:0.86,passed:true}` before `run.completed`; `GET /v1/runs/{id}/eval-summary` returns the scorecard with `totalCostUsd` summed from the per-task `provider.usage` events and (regression mode) a `regression.scoreDelta:+0.04` plus a `:diff` pointer to the baseline.

**Negative (capability).** Same request on a host that omits `agents.evalSuite` → `501 capability_not_provided`. **Negative (mode).** A suite with `modes:["adversarial"]` against a host advertising only `["golden"]` → `400 validation_error`. **Negative (schema).** `thresholds.passScore: 1.5` fails validation (`0.0–1.0`); an `eval.scored` payload carrying a `taskOutput` string fails validation (`additionalProperties:false`, content-free).

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). Two new schema artifacts (`agent-eval-suite`, `eval-summary`); an optional `evalSuiteRef` on `agent-manifest.schema.json` (absent ⇒ no suite, unchanged); a new optional `agents.evalSuite` capability block (absent ⇒ `mode:"eval"` 501s, exactly as an unsupported feature does today); three additive content-free `RunEventType` values (consumers tolerate unknown types per §2.1); one additive optional `mode` discriminator on `POST /v1/runs` (absent ⇒ today's behavior); one additive sibling endpoint. **No existing field is moved, renamed, removed, or type-changed; no existing event shape changes; no existing endpoint contract changes; no `MUST` is relaxed.** No conformance pass is invalidated — a host that ignores all of this stays exactly as conformant as it is today. Adding the three event types does not bump `eventLogSchemaVersion` (the RFC 0008 §K / RFC 0058 precedent for additive types).

## Conformance

- **New scenarios:**
  - **`agent-eval-suite-shape.test.ts`** (always-on, server-free): the `AgentEvalSuite` + `EvalSummary` schemas + the three `eval.*` payloads validate; the `modes` vocabulary is the closed five; negatives (`passScore` out of range, content-bearing `eval.scored`).
  - **`agent-eval-run.test.ts`** (gated on `agents.evalSuite.supported`): a `mode:"eval"` run emits `eval.started` → per-task `eval.scored` → `eval.completed` in order, terminates with a schema-valid `EvalSummary`, and `GET …/eval-summary` returns it; an unadvertised mode is rejected at create. Soft-skips when unadvertised.
- **Capability gating** per `conformance/coverage.md` (shape always-on; the run scenario gated on `agents.evalSuite`). New eval fixture (a 2-task golden suite) + `fixtures.md` catalog row.
- **Reference host.** Deferred (files at `Draft`). The schemas + event family + capability shape ship at `Draft → Active`; the behavioral eval-run scenario soft-skips until a reference host implements the eval projection.

## Alternatives considered

1. **A bespoke `POST /v1/agents/{id}:eval` executor endpoint.** Rejected — eval is a run (it has reasoning, tool calls, cost, a terminal output); a separate executor would duplicate the run lifecycle, the event stream, and the replay/observability surface. The `mode:"eval"` projection reuses all of it (the RFC 0072 "dispatch is a run, not a bespoke endpoint" precedent).
2. **Embed the eval suite inside `AgentManifest`.** Rejected — a suite is large, evolves on its own cadence, and is often authored by someone other than the agent author (a QA/ops role). A pack-distributed artifact + an optional `evalSuiteRef` mirrors `systemPromptRef` and keeps the manifest small.
3. **Reuse RFC 0056 feedback/annotations as the scorecard.** Rejected — annotations are post-hoc *human* signals on a *terminal* run and explicitly non-replayable side-store data; an eval is a *repeatable, machine-scored, threshold-bearing* artifact. They compose (a human MAY annotate an `eval.scored`) but they are not the same surface.
4. **Reuse RFC 0054 run-diff alone for "is it worse?".** Rejected — run-diff is structural divergence, not a score. Regression mode (§D) *composes* `:diff` for the structural part but adds the score delta + threshold that diff has no concept of.
5. **Do nothing.** Rejected — the recommendation flags eval/scorecards as the gate for "deployable" (Wave 3); RFC 0082 deployment promotion is far weaker without portable evidence to gate on.

## Unresolved questions

To decide before `Active`:

1. **Rubric/adversarial determinism + replay.** A rubric/adversarial/live-shadow eval is nondeterministic (judge model, live tools). Proposed: `eval.scored` / `eval.completed` are **recorded-fact events** per `replay.md` §"Recorded-fact events" (the RFC 0026 / RFC 0077 `invocationId` precedent — a replay re-reads the recorded score, never re-judges). Golden/regression-with-fixtures ARE reproducible. Confirm the recorded-fact classification covers all five modes.
2. **`mode:"eval"` vs a `RunOptions.eval` sub-object.** Is `mode:"eval"` the right discriminator, or should eval be an option overlay on a normal run (`configurable.eval`)? Proposed: `mode` (it's a distinct terminal projection, not a tweak). Confirm against `run-options.md`.
3. **Suite signing / trust.** An eval suite ships in a pack tarball — does it inherit the RFC 0003 signature/trust-tier, or need its own? Proposed: inherits the pack signature (it's a pack artifact). Confirm against `node-packs.md` §signing.
4. **`evalRunId` reference shape (§E).** Final shape of the deployment-gate reference — owned here or in RFC 0082? Proposed: RFC 0081 reserves `{evalRunId, requiredPassScore?}`; RFC 0082 owns enforcement. Confirm the split with the RFC 0082 author.
5. **Judge-model cost attribution.** A rubric judge call is itself a `provider.usage`-emitting model call — is its cost in `totalCostUsd` or broken out? Proposed: included, with an optional `judgeCostUsd` breakout. Confirm.

## Implementation notes (non-normative)

- **Sequencing.** Composes RFC 0070/0072/0077 (the agent-run surface eval projects over), RFC 0026 (per-task cost), RFC 0054 (regression baseline diff), RFC 0056 (human override), RFC 0003 (pack-distributed suite). Chain head of Wave 3 — unblocks RFC 0082 (eval-gated promotion). Adds two schemas + three content-free events + one capability block + one run-mode + one sibling endpoint; no change to any existing surface.
- **Reference host.** The reference workflow-engine already runs manifest agents + emits `provider.usage`; wiring eval is: a suite loader (resolve `evalSuiteRef` from the tarball like `systemPromptRef`), a per-task dispatcher injecting `fixtures.toolResponses`, a golden/regression scorer (deterministic), and the `EvalSummary` assembler. Rubric/adversarial judges are a later milestone.
- **Demo impact** (out of scope): the Agents tab scorecard + regression history; "run this pack's eval before publishing"; model/provider A/B with measurable quality/cost tradeoffs.
- **Expected effort:** M for the schemas + prose + shape conformance (lands the surface); M–L for the reference eval-run implementation (golden+regression first, rubric/adversarial later).

## Acceptance criteria

Checklist for `Active → Accepted` (files at `Draft`):

- [ ] `spec/v1/agent-evaluation.md` normative doc: §A suite artifact, §B eval-run projection, §C event family + summary, §D modes capability, §E promotion seam, §F safety (SR-1 + cross-tenant + recorded-fact).
- [ ] `agent-eval-suite.schema.json` + `eval-summary.schema.json`; additive optional `evalSuiteRef` on `agent-manifest.schema.json`; additive optional `agents.evalSuite` on `capabilities.schema.json`; three `eval.*` RunEventTypes + payloads; `mode:"eval"` + `GET /v1/runs/{runId}/eval-summary` in `openapi.yaml`; eval channels in `asyncapi.yaml`.
- [ ] SECURITY invariant `eval-summary-no-content-leak` (content-free events + redaction-safe `safetyFindings`) + cross-tenant isolation reuse, with public tests.
- [ ] Conformance: `agent-eval-suite-shape.test.ts` (always-on) + `agent-eval-run.test.ts` (gated) + eval fixture + `fixtures.md` row + `coverage.md`.
- [ ] CHANGELOG entry + INTEROP-MATRIX row.
- [ ] All five Unresolved questions resolved (recorded in `Updated:`).
- [ ] Reference host implements the golden+regression eval projection + passes the gated scenario, OR the RFC explicitly defers reference-host implementation.

## References

- `docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0081" — the source recommendation.
- [`RFCS/0070-agent-manifest-runtime.md`](./0070-agent-manifest-runtime.md) + [`RFCS/0072-agent-inventory-and-dispatch.md`](./0072-agent-inventory-and-dispatch.md) + [`RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md`](./0077-agent-run-lifecycle-and-live-manifest-dispatch.md) — the agent-run surface an eval run projects over (the `agent.invocation.*` bracket + `agent.*` events per task).
- [`RFCS/0026-provider-usage-event.md`](./0026-provider-usage-event.md) — per-task cost the `EvalSummary` sums.
- [`RFCS/0054-run-diff-and-execution-comparison.md`](./0054-run-diff-and-execution-comparison.md) — the `:diff` regression mode composes for the structural delta.
- [`RFCS/0056-run-feedback-and-annotation-event.md`](./0056-run-feedback-and-annotation-event.md) — human override of an auto-score (composed, not duplicated).
- [`RFCS/0003-agent-packs.md`](./0003-agent-packs.md) — pack-distributed artifact + `…Ref` resolution the suite reuses; signing/trust (UQ #3).
- [`RFCS/0082-agent-deployment-lifecycle.md`](./0082-agent-deployment-lifecycle.md) — the eval-gated promotion seam (§E) this RFC reserves and 0082 enforces.
- [`spec/v1/replay.md`](../spec/v1/replay.md) §"Recorded-fact events" — the determinism posture for rubric/adversarial/live-shadow scores (UQ #1).
- [`COMPATIBILITY.md`](../COMPATIBILITY.md) §2.1 — additive-change discipline.

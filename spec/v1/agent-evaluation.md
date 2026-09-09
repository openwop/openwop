# OpenWOP Spec v1 — Agent Evaluation

> **Status: Stable · v1.x — reached `Accepted` via [RFC 0081](../../RFCS/0081-agent-evaluation-and-scorecards.md) (2026-06-01).** Additive v1.x extension — not part of the v1.0 conformance gate. Lands the portable `AgentEvalSuite` artifact, the `mode: "eval"` run projection, the `eval.*` event family + `EvalSummary` scorecard, the `capabilities.agents.evalSuite` advertisement, and the deployment-promotion seam. The behavioral eval-run scenario, the `GET /v1/runs/{runId}/eval-summary` endpoint, the SDK helpers, and the reference-host eval projection land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

openwop can run a manifest agent (`agent-memory.md`, `multi-agent-execution.md`; RFC 0070/0072/0077) and observe its reasoning, tool calls, cost (RFC 0026 `provider.usage`), and human feedback (RFC 0056 annotations) — but it has no portable way to answer **"is this agent good enough to deploy?"**. Feedback is a post-hoc human signal, not a repeatable benchmark; run-diff (RFC 0054) compares two runs structurally but carries no notion of _score_ or _threshold_. A platform that wants to gate a model swap, a prompt change, or a pack publish on measurable quality has nowhere to put the eval suite, the scorecard, or the pass/fail bar — and two hosts cannot run _the same_ evaluation of _the same_ agent pack and compare results.

This document adds that surface **additively**. An [`AgentEvalSuite`](../../schemas/agent-eval-suite.schema.json) is a portable artifact (tasks + expected outputs or rubrics + deterministic tool/memory fixtures + allowed model classes + pass/fail thresholds), distributed in a pack tarball exactly like a `systemPromptRef`. An **eval run** is a projection over the existing run surface — `POST /v1/runs` with `mode: "eval"` — reusing the entire reasoning / tool-call / cost / observability machinery rather than a bespoke executor. It emits a content-free [`eval.{started,scored,completed}`](../../schemas/run-event-payloads.schema.json) family and terminates with an [`EvalSummary`](../../schemas/eval-summary.schema.json) scorecard. It **composes — does not duplicate** RFC 0054 (regression baseline), RFC 0026 (per-task cost), and RFC 0056 (human override of an auto-score), and defines the seam by which an RFC 0082 deployment promotion MAY require an eval pass.

## §A — The `AgentEvalSuite` artifact

An `AgentEvalSuite` ([`agent-eval-suite.schema.json`](../../schemas/agent-eval-suite.schema.json)) is a standalone JSON artifact distributed **in a pack tarball and referenced by URI**, the same way `systemPromptRef` and `handoff.*SchemaRef` are (RFC 0003 §C/§D). It MUST NOT be embedded in `AgentManifest`; an agent MAY carry an optional [`evalSuiteRef`](../../schemas/agent-manifest.schema.json), and a suite MAY also be authored independently and pointed at any `agentId` at run time.

A suite declares a `suiteId` (the `<scope>.<org>.evals.<name>` convention), a `version` (SemVer), the `modes` it exercises (§D), an optional `allowedModels` (the `modelClass` values it is valid for), pass/fail `thresholds` (`passScore` / `maxCostUsd` / `maxP95LatencyMs`), and an array of `tasks`. Each task carries a `taskId`, an `input` (validated against the agent's input schema), an `expected` block (`kind: "golden"` with a deterministic `match`, or `kind: "rubric"` with weighted criteria), and optional `fixtures`.

When a task carries `fixtures`, the eval host **MUST** inject `fixtures.toolResponses` in place of live tool calls and seed `fixtures.memorySeed` into the agent's read snapshot before the invocation, so a `golden`/`regression` eval is reproducible. The `live-shadow` mode (§D) is the explicit exception: it ignores `fixtures` and runs against live tools/memory. Seeded memory is tenant-scoped and SR-1-redacted on the host side exactly like any memory write (`agent-memory.md`).

## §B — The eval run (`mode: "eval"` projection)

An eval **is a run**. A client starts one via the existing `POST /v1/runs` with an additive `mode: "eval"` discriminator and an `evalSuiteRef`, mirroring the RFC 0072 principle that agent dispatch is `WorkflowNode.agent` + `POST /v1/runs`, not a bespoke endpoint:

```jsonc
POST /v1/runs  { "mode": "eval", "evalSuiteRef": "…support-resolver@1.0.0", "agentId": "…support-resolver",
                 "configurable": { "evalModes": ["golden"] } }
```

The host **MUST** execute each `task` as a child agent invocation — reusing the RFC 0077 `agent.invocation.*` bracket plus the existing `agent.reasoned` / `agent.toolCalled` / `agent.decided` / `provider.usage` events per task — score it, and terminate the run with an `EvalSummary` (§C) as its output. A host that does not advertise `capabilities.agents.evalSuite.supported: true` **MUST** reject `mode: "eval"` with `501 capability_not_provided` (the RFC 0056 precedent). A run requesting a `mode` that the suite does not declare, or that the host does not advertise (`capabilities.agents.evalSuite.modes`), **MUST** be rejected at run-create with `400 validation_error`.

The only new read surface is `GET /v1/runs/{runId}/eval-summary`, returning the `EvalSummary` for a terminal eval run (an additive sibling endpoint; the endpoint + its SDK helper land at `Active → Accepted`).

## §C — Events and the `EvalSummary` scorecard

A host advertising `capabilities.agents.evalSuite.supported: true` **MUST** emit, on an eval run, exactly this content-free bracket:

| Event                                                            | Emitted                                                       | Carries                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`eval.started`](../../schemas/run-event-payloads.schema.json)   | once, at eval-run start                                       | `suiteId`, `suiteVersion`, `taskCount`, `modes[]`, optional `baselineRunId`                          |
| [`eval.scored`](../../schemas/run-event-payloads.schema.json)    | once **per task**, after that task's terminal `agent.decided` | `taskId`, `score`, `passed`, optional `costUsd` / `latencyMs` / `schemaValid` / `safetyFindingCount` |
| [`eval.completed`](../../schemas/run-event-payloads.schema.json) | once, before `run.completed`, after all tasks                 | `aggregateScore`, `passed`, `taskCount`, `passedCount`, optional `regressionVsBaseline`              |

`eval.scored` is **per-task** so a streaming consumer sees results land incrementally. None of the three events carries task output, rubric prose, model completions, or credential material — only scores, scalars, and ids (§F).

The terminal [`EvalSummary`](../../schemas/eval-summary.schema.json) is set as the eval run's output and served by `GET /v1/runs/{runId}/eval-summary`. It carries `aggregateScore`, `passed`, per-task `{taskId, score, passed, costUsd, latencyMs, schemaValid, safetyFindings[]}`, optional `totalCostUsd` (summed from the per-task RFC 0026 `provider.usage` events), the `suiteId` / `suiteVersion` / `evaluatedModelClass` provenance, and — for `regression` mode — a `regression` block (a `scoreDelta` vs `baselineRunId` plus an optional `diffRef` pointer to the RFC 0054 `:diff`). `safetyFindings[]` entries are redaction-safe `{kind, severity}` descriptors (§F).

## §D — Eval modes

`capabilities.agents.evalSuite.modes` advertises which of five modes (the closed vocabulary) the host implements; a host **MUST** advertise only the modes it actually gates on (the RFC 0031 truthful-advertisement rule):

- **golden** — exact / contains / json-match against each task's `expected.match`. Deterministic.
- **rubric** — a host-chosen judge scores the output against weighted criteria. Nondeterministic; the score is a recorded fact (§F).
- **adversarial** — tasks probe for unsafe / jailbreak behavior; `safetyFindings` is the primary output.
- **regression** — re-run a suite against a new agent/model/prompt version and diff scores vs a `baselineRunId`, composing the RFC 0054 `:diff` for the structural delta.
- **live-shadow** — run the suite against live tools/memory instead of `fixtures` — the only mode that bypasses fixture injection; explicitly nondeterministic.

## §E — The promotion seam

This document defines _how an eval result is referenced by a deployment gate_, not the gate itself (that is [RFC 0082](../../RFCS/0082-agent-deployment-lifecycle.md)). A terminal eval run has a stable `runId` and an `EvalSummary.passed`. RFC 0082's promotion request MAY carry an `evalRunId`, and an RFC 0051 `approvalGate` MAY be configured to require `EvalSummary.passed === true` (or `aggregateScore >= requiredPassScore`) for a given `agentId@version` before `deployment.promoted` is emitted. This document reserves the reference shape `{ evalRunId, requiredPassScore? }` and defers the enforcement contract to RFC 0082 §E. A human MAY override an auto-score via an RFC 0056 annotation on an `eval.scored` event — the auto-score is advisory evidence, not an immutable verdict.

## §F — Safety

- **Content-free events + summary (`eval-summary-no-content-leak`).** The `eval.*` events and the `EvalSummary` carry scores, scalars, ids, counts, and redaction-safe `{kind, severity}` safety descriptors **only**. They **MUST NOT** carry task output bodies, rubric prose, model completions, prompts, pricing breakdowns / rate cards, or credential material (SR-1). A consumer reads the run's normal projection for any body. This is a protocol-tier SECURITY invariant; its public test is the always-on `agent-eval-suite-shape.test.ts` content-free negatives.
- **Cross-tenant isolation.** An eval run, its suite, its fixtures, and its summary are scoped to the authenticated principal's owner triple (RFC 0048/0074) exactly like any run. A suite or summary **MUST NOT** be readable across tenants.
- **Determinism / replay.** `eval.started` / `eval.scored` / `eval.completed` are **recorded-fact events** per `replay.md` §"Recorded-fact events" (the RFC 0026 / RFC 0077 `invocationId` precedent): a replay re-reads the recorded score and never re-judges. `golden`/`regression`-with-fixtures runs are reproducible; `rubric`/`adversarial`/`live-shadow` are nondeterministic, and the recorded-fact classification is what makes their replay deterministic.

## Capability advertisement

```jsonc
"agents": { "evalSuite": {
  "supported": true,
  "modes": ["golden", "rubric", "regression"],
  "maxTasksPerSuite": 200,
  "maxCostUsdPerSuite": 5.0
}}
```

A host that omits the block does not run evals; `mode: "eval"` 501s and the behavioral conformance scenario soft-skips. See [`capabilities.md`](./capabilities.md) §`agents` and [`host-capabilities.md`](./host-capabilities.md).

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 4 row(s) this table carried are now `openwop.gap.spec.agent-evaluation.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

## References

- [`RFCS/0081-agent-evaluation-and-scorecards.md`](../../RFCS/0081-agent-evaluation-and-scorecards.md) — the filing RFC.
- [`schemas/agent-eval-suite.schema.json`](../../schemas/agent-eval-suite.schema.json) + [`schemas/eval-summary.schema.json`](../../schemas/eval-summary.schema.json) — the two artifacts.
- [`multi-agent-execution.md`](./multi-agent-execution.md) §"Live manifest dispatch" — the `agent.invocation.*` bracket each eval task reuses.
- [`replay.md`](./replay.md) §"Recorded-fact events" — the determinism posture for eval scores.
- `RFCS/0026` (per-task cost), `RFCS/0054` (regression diff), `RFCS/0056` (human override), `RFCS/0082` (the promotion seam).
  </content>

# Mapping OpenWOP Eval Results to OpenTelemetry and Eval Exports

> Informative. A mapping guide for hosts that export RFC 0081 / RFC 0244 eval results to OpenTelemetry or to an eval-results store. It adds no obligation; the rules are in [`spec/v2/facets/agents.schema.json`](../../spec/v2/facets/agents.schema.json) §evalSuite and the schemas it names.

OpenTelemetry's GenAI semantic conventions define one evaluation record, the `gen_ai.evaluation.result` event. Its stability is Development, and the conventions live in [`open-telemetry/semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-events.md). OpenWOP's eval events are recorded facts on a run log, so the mapping below is an export, not a second source of truth. Re-check the OpenTelemetry names before relying on them: evaluator provenance (PR #359) was unmerged on 2026-10-14.

## `eval.scored` → `gen_ai.evaluation.result`

| OpenWOP | OpenTelemetry | Notes |
| --- | --- | --- |
| `<suiteId>/<taskId>` | `gen_ai.evaluation.name` | Add `#<trialIndex>` when the suite runs trials. |
| `score` | `gen_ai.evaluation.score.value` | 0.0–1.0. |
| `scoreLabel` | `gen_ai.evaluation.score.label` | Pattern-bound, low cardinality. |
| `evaluatorType` | `gen_ai.evaluation.evaluator.type` (proposed) | Same values: `deterministic`, `llm_judge`, `human`. |
| — | `gen_ai.evaluation.explanation` | Not exported: an explanation is content (`eval-summary-no-content-leak`). |
| the task's `agent.invocation-*` bracket | parent span | Parent the event to the exported `invoke_agent` span of the trial. |

`agent.tool-called` maps to an `execute_tool` span (`gen_ai.tool.name` = `toolName`, `gen_ai.tool.call.id` = `callId`), and `provider.usage` maps to `gen_ai.usage.input_tokens` / `output_tokens`. With those spans exported, a trace backend can recompute the RFC 0244 §A trajectory grade from the same calls the host graded.

## `EvalSummary` → aggregate and instance records

Every Eval Ever ([`evaleval/every_eval_ever`](https://github.com/evaleval/every_eval_ever)) separates an aggregate record from instance records. A summary exports as one aggregate (`aggregateScore`, `passed`, `trialStats`) plus one instance per task (`score`, `passed`, `trajectory`, `trials`, `efficiency`). Inspect AI's reducer names line up with RFC 0244 §B: `pass_at_k` ↔ `passAtK`, `pass_k_k` ↔ `passHatK`.

No OpenWOP field carries task output, so an export that needs transcripts reads the run's normal projection behind the run's own authorization.

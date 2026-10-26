# RFC 0251: A client names an eval run's modes and its regression baseline

| Field | Value |
| --- | --- |
| **RFC** | 0251 |
| **Title** | A client names an eval run's modes and its regression baseline |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-10-26 |
| **Updated** | 2026-10-26 — filed **`Active`, comment window waived by the maintainer** (user instruction 2026-10-25, choosing "Waive it" for RFC 0251); STEWARD OVERRIDE of RFC 0147 §A.6 recorded in `MAINTAINERS.md`. Design by the steward's `/architect` ruling, with openwop-app-6a's read of the host code at `c0f991494`. |
| **Affects** | `api/openapi.yaml` `createRun` (two optional body properties; derived `api/v2/openapi.yaml`) · `spec/v2/facets/agents.schema.json` (optional `agents.evalSuite.baselineSelection`; derived `schemas/v2/capabilities.schema.json`) · conformance (`v2-eval-regression-baseline`, two eval-suite fixtures) · v2 SDKs · hosts advertising `agents.evalSuite` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

An eval run on the v2 wire cannot be told which RFC 0081 modes to run or which prior run is its `regression` baseline: the `createRun` eval body carries only `mode`, `evalSuiteRef` and `agentId`. So RFC 0244 §F's paired verdict, which both production hosts advertise, cannot be caused by any client, and its rows cannot be witnessed. This RFC adds two optional `createRun` properties, `evalModes` and `baselineRunId`, and an optional facet member, `agents.evalSuite.baselineSelection`, that says a host accepts them. A baseline the caller cannot use is refused with one uniform `400 validation_error`, so the refusal never tells a caller whether another tenant's run exists. Nothing changes for a client that sends neither property.

## Motivation

RFC 0081 §D defines `regression` mode as "re-run … and diff scores vs a `baselineRunId`", and the suite schema already says "a run MUST request only modes the suite declares AND the host advertises". Neither rule has a request carrier. The baseline appears only in what the host emits: `eval.started.baselineRunId` and `EvalSummary.regression.baselineRunId`.

Both production hosts advertise `agents.evalSuite.modes` containing `regression` and `regressionVerdict: true` (MyndHyve's certified 2.46.13 cut; openwop-app's 2.46.23 cut). openwop-app fills the gap with a host-local extension: it reads `configurable.evalModes` and `configurable.baselineRunId`, validates the baseline (same tenant, an eval run, the same `suiteId`, completed with a summary) and computes the paired verdict. Its eval branch returns before the RFC 0171 §D.1 closed-`configurable` check, so it accepts keys the v2 wire does not sanction, and no other host or client can rely on them. A portable carrier turns RFC 0244 §F from "not probed" into witnessable-gated, and lets openwop-app drop the extension.

## Proposal

### §A — The facet member

`spec/v2/facets/agents.schema.json` `evalSuite` gains an optional boolean:

```jsonc
"baselineSelection": true
```

`true` means the host accepts `evalModes` and `baselineRunId` on an eval `createRun` as this RFC defines. A client MUST NOT send either property to a host that does not advertise it; such a host MAY refuse the request with `400 validation_error` (the v2 body is closed).

### §B — The request

The `createRun` body gains two optional properties, meaningful only with `mode: "eval"`:

- `evalModes`: a non-empty array of distinct RFC 0081 §D modes. It MUST be a subset of the suite's `modes` and of the host's advertised `agents.evalSuite.modes`. Absent ⇒ the host's default, as today.
- `baselineRunId`: a `runId`, the prior eval run this run is compared against.

A host advertising `baselineSelection` MUST refuse with `400 validation_error`, before the run starts:
- either property without `mode: "eval"`;
- `evalModes` outside the suite's or the host's modes;
- `baselineRunId` without `regression` in `evalModes`, or `regression` in `evalModes` without `baselineRunId`;
- a baseline it cannot use, per §C.

### §C — The baseline

A usable baseline is an eval run that the caller's owner triple can read, that ran a suite with the same `suiteId` as this run's suite, and that completed with a served `EvalSummary`. Every other value is refused with the same status and the same error code, whether the run does not exist, belongs to another tenant, is not an eval run, ran another suite or has not completed. The refusal MUST NOT echo the supplied id. A caller learns no more about a foreign run than about an id that never existed: accepting a foreign baseline would expose its `aggregateScore` through `scoreDelta`, which the evalSuite rule "a suite or summary MUST NOT be readable across tenants" forbids.

The baseline may run another `version` of the suite, so the two runs may hold different tasks. That is what RFC 0244 §F pairing by `taskId` is for.

### §D — What the run reports

For an accepted baseline, the host MUST put the same id on `eval.started.baselineRunId` and on `EvalSummary.regression.baselineRunId`, and `regression.scoreDelta` MUST be this run's `aggregateScore` minus the baseline's. With `regressionVerdict` advertised, RFC 0244 §F applies unchanged. The rules live in the `baselineSelection` and `createRun` property descriptions; no core prose changes.

### Examples

| Request (host advertises `baselineSelection`) | Result |
| --- | --- |
| `evalModes: ["golden","regression"]`, `baselineRunId` = a completed run of the same suite | `201`; `eval.started.baselineRunId` and `regression.baselineRunId` echo it |
| the same with an unknown id, another tenant's run, or a run of another suite | `400 validation_error`, identical in each case, without the id |
| `baselineRunId` with `evalModes: ["golden"]` | `400 validation_error` |
| `evalModes: ["rubric"]` against a suite declaring only `golden` | `400 validation_error` |
| `baselineRunId` on a workflow run (no `mode`) | `400 validation_error` |

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.4): two optional properties on the closed `createRun` body and one optional boolean on a closed facet. A request without them is handled exactly as today. A host that does not advertise `baselineSelection` is unaffected, and a client that reads the facet never sends the properties to it. No event, summary field, error code or MUST changes. openwop-app's `configurable` keys are a host-local extension this RFC replaces; retiring them is the host's own change.

## Conformance

New scenario `v2-eval-regression-baseline`, gated on `agents.evalSuite.baselineSelection`, `regression` in `modes`, and both fixtures in discovery `fixtures`. The fixtures `conformance-eval-regression-base` (version 1.0.0, tasks `base-only`, `shared-a`, `shared-b`) and `conformance-eval-regression-candidate` (version 1.1.0, tasks `shared-a`, `shared-b`, `candidate-only`) share one `suiteId`. `base-only` fails, the rest pass, and the two shared tasks are identical, so the aggregates differ by 1/3 while every paired score is equal. A host that compares aggregates instead of pairing tasks would call the candidate `improved`.

| Id | Case | Expect |
| --- | --- | --- |
| `0251.shape` | (server-free) the `createRun` properties and the facet member | validate / refuse |
| `0251.baseline-echoed` | run base, then candidate with `evalModes: [golden, regression]` and base as baseline | `201`; both carriers name base; `scoreDelta` = 1/3 within 1e-9 |
| `0244.regression-paired` | the same candidate run, with `regressionVerdict` | `pairedTaskCount` 2 |
| `0244.regression-no-false-verdict` | the same | `verdict` is neither `improved` nor `regressed` |
| `0251.baseline-refused` | baseline = an unknown id; = a run of `conformance-eval-trajectory` | `400 validation_error` each, without the id |
| `0251.baseline-uniform` | baseline = tenant B's completed base run (`OPENWOP_TEST_TENANT_B_API_KEY`) | the same status and code as the unknown id, without the id |
| `0251.fields-refused` | `baselineRunId` with `evalModes: [golden]`; `regression` without a baseline | `400 validation_error` each |

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A, §B shapes | schema vectors | the suite, server-free | witnessable-unaided |
| §B request-rule refusals | `400 validation_error` on each bad combination | the suite | witnessable-gated: not probed by a host yet |
| §C unusable baseline refused, uniformly | the refusal for an unknown, another-suite and another tenant's run | the suite, with a second tenant | witnessable-gated: not probed by a host yet |
| §D baseline echoed and `scoreDelta` | `eval.started`, the summary | the suite, through the two fixtures | witnessable-gated: not probed by a host yet |
| RFC 0244 §F pairing and no false verdict | `pairedTaskCount`, `verdict` | the suite, through the two fixtures | witnessable-gated: not probed by a host yet |
| §B a client never sends the properties to a host without the member | the request on the wire | only a client | claims-check: a client obligation, not a host behaviour |

## Alternatives considered

1. **Do nothing.** §F stays unwitnessable and openwop-app keeps an unsanctioned `configurable` extension.
2. **An RFC 0171 `configurable` section for eval.** Rejected: `configurable` is workflow input, persisted and carried by a fork; the baseline is a run-selection parameter, like `evalSuiteRef`, so it sits beside it at the root.
3. **The host picks the latest prior run of the suite.** Rejected: neither host does it, it races concurrent runs, and the result would not be reproducible.
4. **Distinct error codes per refusal reason.** Rejected: a reason that separates "another tenant's run" from "no such run" is an oracle. One code for every case.
5. **Fold `baselineSelection` into `regressionVerdict`.** Rejected: MyndHyve advertises `regressionVerdict` without the request properties; reusing the flag would make its advertisement false.

## Unresolved questions

All were resolved on 2026-10-26 by `/architect`:

1. **Placement:** root properties beside `evalSuiteRef`, not `configurable` (alternative 2).
2. **Signal:** a new boolean `baselineSelection`, so no current advertisement becomes false (alternative 5).
3. **Refusal:** `400 validation_error`, one answer for every unusable baseline, no details (the registry row has none).
4. **Suite identity across versions:** the baseline matches on `suiteId`; versions may differ (§C).

## Implementation notes (non-normative)

openwop-app already validates and pairs as §C and §D require (`createEvalRun.ts`, `buildSummary`); it maps the two root properties onto that path, advertises `baselineSelection`, and lists the two fixtures. Its suite store must hold two documents with one `suiteId` and different versions, resolved by fixture id. MyndHyve is unaffected until it opts in. The SDK follow-up is G3.

## Acceptance criteria

- [ ] The two `createRun` properties (derived `api/v2/openapi.yaml`) and the facet member (derived capabilities schema), with the rules in their descriptions.
- [ ] `v2-eval-regression-baseline`, its two fixtures in `fixtures.md`, judges with self-tests.
- [ ] A host advertises `baselineSelection`, and a certified major-2 bundle records the `0251.*` host legs and the two `0244.regression-*` legs `executed-pass`.
- [ ] openwop-sdks issue filed for the two properties (G3).

## References

- [RFC 0081](0081-agent-evaluation-and-scorecards.md) §D, [RFC 0244](0244-eval-trajectories-trials-and-recorded-fixtures.md) §F, [RFC 0171](0171-v2-wire-envelope.md) §D.1.
- [Runs](../spec/v2/core/runs.md), [Compatibility](../COMPATIBILITY.md).
- [Gap register](registers/0251-eval-run-mode-and-baseline-selection.gaps.md), [risk register](registers/0251-eval-run-mode-and-baseline-selection.risks.md).

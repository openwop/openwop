# RFC 0090: Shadow-prove migration gate — composing the eval surface to authorize a workflow cut-over

| Field | Value |
|---|---|
| **RFC** | 0090 |
| **Title** | Shadow-prove migration gate — composing the eval surface to authorize a workflow cut-over |
| **Status** | `Withdrawn` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-06 |
| **Updated** | 2026-06-06 |
| **Withdrawal note** | **WITHDRAWN 2026-06-06 (Q1 resolved: no net-new surface).** The first draft (briefly `Active` on a steward waiver) invented a `capabilities.shadow` block, a `shadow` run-creation field, three `shadow.*` events, and a `ShadowComparison` — which code review found **duplicated Accepted RFC 0081** (Agent Evaluation — `live-shadow` mode, `baselineRunId`, `regression`, content-free `EvalSummary`, `agents.evalSuite`) and **RFC 0082** (deployment promotion gate). On reconciliation, "shadow → prove → cut over" is **fully covered** by RFC 0081 (`live-shadow` eval → `EvalSummary`) + RFC 0082 §E (promotion gate keyed on `EvalSummary.passed`) + RFC 0054 (run-diff); the candidate workflow-level binding added nothing those don't already express. This RFC is therefore withdrawn with no wire surface. The demo "Shadow & Prove"/"Cut Over" stages consume RFC 0081 / 0082 (host-ext pilot of the `live-shadow` `EvalSummary`). |
| **Affects** | Nothing — withdrawn with no normative surface. References only: `spec/v1/agent-evaluation.md` (RFC 0081), `RFCS/0082-agent-deployment-lifecycle.md`, `spec/v1/replay.md` (RFC 0054). |
| **Compatibility** | n/a (withdrawn — no wire change ever landed) |
| **Supersedes** | — |
| **Superseded by** | RFC 0081 §D (`live-shadow` eval + `EvalSummary`) + RFC 0082 §E (promotion gate) + RFC 0054 (run-diff) — these predate and fully cover this proposal. |

## Summary

**Withdrawn.** The "prove an agentic workflow against a baseline before cut-over" mechanism already exists in the corpus and this RFC was a redundant re-invention. RFC 0081 provides `live-shadow`/`regression` eval modes, an optional `baselineRunId`, a content-free `EvalSummary`, and an `agents.evalSuite` capability; RFC 0082 §E provides the deployment-promotion gate keyed on `EvalSummary.passed`; RFC 0054 provides the structural run-diff. Together they cover shadow → prove → cut over with no gap, so RFC 0090 introduces no net-new surface and is withdrawn. The text below is retained for history; the original `capabilities.shadow` / `shadow.*` / `ShadowComparison` invention (duplicating RFC 0081) was never implemented.

## Motivation

Migrating a human/legacy process to an agentic workflow needs a **prove-it step** between "built" and "in production." The first draft of this RFC asserted the protocol had "no surface for run-alongside-and-compare." **That was wrong** — it overlooked:

- **RFC 0081 (Agent Evaluation, `Accepted`)** — `spec/v1/agent-evaluation.md`. A `live-shadow` eval mode runs a suite against live tools/memory (the run-alongside primitive); `regression` mode diffs scores against a `baselineRunId`; the terminal `EvalSummary` (`aggregateScore`, `passed`, per-task scores, `regression.scoreDelta`) is the portable, content-free comparison result (`eval-summary-no-content-leak` invariant). Discoverable via `capabilities.agents.evalSuite.modes[]`.
- **RFC 0082 (Agent Deployment Lifecycle)** — `RFCS/0082-agent-deployment-lifecycle.md` §E. The promotion gate: a promotion request MAY carry `evalRunId`, and an RFC 0051 `approvalGate` MAY require `EvalSummary.passed === true` before `deployment.promoted`.
- **RFC 0054 (run-diff)** — the structural delta between two runs.

So "shadow → prove → cut over" is **RFC 0081 (live-shadow eval) → `EvalSummary` → RFC 0082 (promotion gate)**. The genuine, narrow gap this RFC might still address: RFC 0081/0082 are framed at the **agent / agent-pack** level, whereas a migration cuts over an entire **workflow** (a cluster of agents + nodes) against a **non-agent legacy baseline**. If that workflow-level framing needs any wire surface beyond composing the three RFCs above, this RFC defines it; if not, this RFC documents the composition and is withdrawn.

## Proposal

**No new `capabilities.shadow`, no `shadow.*` events, no `ShadowComparison` — all removed.** The shadow comparison is an RFC 0081 `live-shadow` eval producing an `EvalSummary`; the cut-over is an RFC 0082 promotion gate keyed on `EvalSummary.passed`.

Candidate net-new surface (to be confirmed in the comment window — see Q1), kept minimal and `Draft`:

- A **workflow-migration cut-over** MAY reference a passing `EvalSummary` (via RFC 0082's reserved `{ evalRunId, requiredPassScore? }` shape) as the authorization to migrate production responsibility for a workflow. This is expressed at the workflow level, reusing RFC 0082's gate verbatim.
- A workflow's `live-shadow` eval MAY use a **non-agent baseline** (a legacy-process outcome supplied as the suite's `expected`/baseline) — confirming RFC 0081 already permits this rather than extending it.

If the comment window finds no surface beyond composition, this RFC is **withdrawn** with a pointer to RFC 0081 §D + RFC 0082 §E as the canonical home (Q1).

### Open spec gaps

| Gap | Disposition |
|---|---|
| Workflow-level (vs agent-pack-level) eval framing | Confirm whether RFC 0081's `AgentEvalSuite` already covers a workflow's output, or needs a thin `WorkflowEvalSuite` sibling. Likely covered. |
| Non-agent legacy baseline | Confirm RFC 0081 `expected`/`live-shadow` already accepts an externally-supplied baseline. Likely covered. |
| Fleet/workforce-level proof roll-up | Out of scope — a host-extension/telemetry concern (the demo app's workforce telemetry). |

## Compatibility

**Additive** per `COMPATIBILITY.md §2.2` — and now *smaller*: the reconciled RFC removes the duplicate wire surface, so it adds at most a thin composition binding (or nothing). It introduces no required-field/contract/`MUST`/error change. Existing RFC 0081/0082/0054 surfaces are referenced, not modified.

## Conformance

No new shadow scenarios. The comparison + gate are already covered by RFC 0081's eval scenarios (`agent-eval-suite-shape.test.ts`, the gated `agent-eval-run.test.ts`) and RFC 0082's promotion-gate scenarios. If a workflow-level binding is confirmed (Q1), it adds at most one capability-gated composition scenario.

## Alternatives considered

1. **(Original draft) Invent a parallel `capabilities.shadow` + `shadow.*` events + `ShadowComparison`.** **Rejected** — duplicates RFC 0081 (`live-shadow`, `baselineRunId`, `regression`, content-free `EvalSummary`) and RFC 0082 (promotion gate). This was the first draft's mistake, caught in code review.
2. **Withdraw RFC 0090 entirely.** Viable and currently the leading option: RFC 0081 §D + RFC 0082 §E + RFC 0054 may fully cover shadow → prove → cut over. Pending Q1.
3. **This RFC (thin workflow-level binding).** Keep only if the workflow-vs-agent-pack framing needs surface beyond composition.
4. **Do nothing.** The demo "Shadow & Prove" would compose RFC 0081 + 0082 directly without a documenting RFC — acceptable, but a short composition note aids implementers.

## Unresolved questions

1. **[RESOLVED 2026-06-06 → WITHDRAWN]** Is there ANY net-new wire surface here, or is "shadow → prove → cut over" fully covered by RFC 0081 (live-shadow + EvalSummary) + RFC 0082 (promotion gate) + RFC 0054 (diff)? **Answer: fully covered.** No net-new surface; RFC withdrawn in favor of those. Q2/Q3 (workflow-vs-agent-pack framing, non-agent baseline) are likewise answered by RFC 0081's existing `AgentEvalSuite` + `live-shadow`.
2. Does RFC 0081's `AgentEvalSuite` cleanly express a *workflow*'s output (not just an agent pack's), or is a sibling artifact warranted?
3. Can an RFC 0081 `live-shadow` baseline be a non-agent legacy outcome without extension?

## Implementation notes (non-normative)

- The openwop demo app's "Shadow & Prove" migration stage (MG-5) and "Cut Over" stage (MG-6) should consume **RFC 0081 `EvalSummary`** (live-shadow) and **RFC 0082**'s gate, not a bespoke shape. The demo's host-extension pilot is being re-pointed accordingly (companion app PR).
- No spec/schema implementation should land for this RFC until Q1 resolves — there may be nothing to implement.

## Acceptance criteria

- [ ] Q1 resolved: confirm net-new surface, or withdraw with a pointer to RFC 0081 §D + RFC 0082 §E
- [ ] If kept: the workflow-level binding lands as an additive composition of RFC 0081/0082 (no duplicate shadow surface)
- [ ] Demo "Shadow & Prove"/"Cut Over" re-pointed at `EvalSummary` + the RFC 0082 gate (companion app PR)
- [ ] CHANGELOG entry reflects the reconciliation

## References

- **RFC 0081** `spec/v1/agent-evaluation.md` — `live-shadow`/`regression` modes, `baselineRunId`, `EvalSummary`, `agents.evalSuite` (the comparison mechanism this RFC was duplicating)
- **RFC 0082** `RFCS/0082-agent-deployment-lifecycle.md` §E — the promotion gate keyed on `EvalSummary.passed`
- **RFC 0054** — structural run-diff
- `spec/v1/replay.md` — replay/fork (baseline-via-replay; §C observable-output determinism)
- Demo app: "Shadow & Prove" (MG-5) + "Cut Over" (MG-6) stages (consumer, being re-pointed)

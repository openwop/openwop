# RFC 0061: Stateful agent-loop lifecycle (`multiAgent.executionModel.version: 5`)

| Field | Value |
|---|---|
| **RFC** | 0061 |
| **Title** | Promote the RFC 0037 execution loop to a *stateful* lifecycle at `multiAgent.executionModel.version: 5` — per-iteration workspace snapshot (RFC 0059) as a deterministic input, an observable iteration counter on `runOrchestrator.decided` that `maxLoopIterations` (RFC 0058) bounds, and a stateful-resume guarantee across HITL suspends — without inventing a parallel loop surface |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-26 (Active → **Accepted** — non-steward host advertising `version: 5`, openwop-side curl-verified. MyndHyve `workflow-runtime` (revision `workflow-runtime-00390-vuh`) advertises `capabilities.multiAgent.executionModel.version: 5` + `statefulResume: true` live on `https://workflow-runtime-gjw5bcse7a-uc.a.run.app/.well-known/openwop`; it sets the additive `runOrchestrator.decided.iteration` counter (1-based, monotonic, incremented per `core.orchestrator.supervisor` turn, surviving suspend/resume via persisted `state.variables`) and wires the `POST /v1/host/sample/agentloop/run` seam. **Independently verified via the seam:** a `{turns:3, suspendAtTurn:2, resume}` drive returns iterations `[1,2,3]` (§B monotonic) with `resumedIteration: 2` === suspendAtTurn (§D stateful resume preserves the counter). The four conformance scenarios resolve PASS / PASS / PASS / honest-soft-skip: `-version5-shape` (always-on), `-iteration-monotonic` (gated `version >= 5`), `-stateful-resume` (gated `statefulResume`), and `-workspace-snapshot` (gated `host.workspace.supported` — soft-skips; MyndHyve doesn't ship RFC 0059, which §C input 2 explicitly permits). `transcriptWindow` honestly omitted (Phase-0-allowed host-advertised value, unpinned). MyndHyve commits `41dc13cce`/`ba8a85387`/`039976086`/`cddc87946`/`099c7f530`. Co-graduates with RFC 0058's loop-iterations arm (this v5 counter is the bound `maxLoopIterations` clamps). 2026-05-25 (Draft → Active — wire surface landed atomically).) |
| **Affects** | `spec/v1/multi-agent-execution.md` (version-5 section + iteration counter + stateful resume) · `schemas/capabilities.schema.json` (`multiAgent.executionModel.version` ceiling + optional `statefulResume`) · `schemas/run-event-payloads.schema.json` (additive optional `iteration` on `runOrchestratorDecided`) · `RFCS/0037` (the loop this extends) · `RFCS/0058` (`maxLoopIterations` — corrects its gating reference) · `RFCS/0059` (workspace snapshot) · `RFCS/0039` (memory snapshot, MAE-3) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0037 already defines a re-entrant, replay-deterministic execution loop (`multi-agent-execution.md` §"Execution loop"): the supervisor emits one `OrchestratorDecision` per turn, the engine appends `runOrchestrator.decided`, and a `terminate` decision exits the loop. What it does *not* pin is (a) what *persistent* state each iteration reloads, (b) a bounded iteration count, and (c) that a HITL suspend resumes mid-loop without losing progress. This RFC lands those three as `multiAgent.executionModel.version: 5` — reusing the existing loop, the existing `runOrchestrator.decided` per-turn event (gaining an additive optional `iteration` counter), and the existing `terminate` exit — rather than a parallel `agents.loop` capability or `agent.loop.iterated` event. It composes the autonomous-agent durable layer (RFC 0059 workspace) and transactional layer (RFC 0004/0039 memory) into one bounded, stateful, portable loop.

## Motivation

The autonomous-agent feature set asks for a "repeated execution cycle where an agent loads state, runs reasoning, optionally acts… preserves/merges memory, produces deterministic logs," with the Claude Code `/loop` pattern ("run tests, read failures, edit, re-run… stop when acceptance criteria met or max iterations reached"). Most of that already exists: RFC 0037's loop is the cycle, it is re-entrant + replay-deterministic (`multi-agent-execution.md` line 46), `runOrchestrator.decided` is the deterministic per-iteration record, the `terminate` decision is "acceptance criteria met," and RFC 0039 (MAE-3) already snapshots *memory* per event-log index for replay carry-forward.

Three gaps remain, and they are interop guarantees, not implementation detail: (1) an agent's **workspace** ground-truth (RFC 0059) is not yet declared a per-iteration input, so two hosts could disagree on what an iteration "sees"; (2) there is no bounded **iteration count** an operator can rely on across hosts — `recursionLimit` counts nodes, not orchestrator turns (closed by RFC 0058, which needs an observable counter to bound); (3) nothing pins that a `clarify`/`escalate` suspend (which the loop already does, `multi-agent-execution.md` lines 35–38) **resumes at the same iteration with the same snapshot lineage**. A workflow moved between hosts, or replayed, must reload the same per-iteration state and reach the same iteration count.

## Proposal

### §A — version ladder: `version: 5` (additive)

`multiAgent.executionModel.version` is the established ladder (1=RFC 0037, 2=0039, 3=0040, 4=0041; "a host advertising `version: N` MUST implement all versions 1..N"). This RFC is **`version: 5`**. The `capabilities.schema.json` `multiAgent.executionModel` block gains one optional field:

```diff
   "executionModel": {
     "properties": {
       "supported": { "type": "boolean" },
       "version":   { "type": "integer", "minimum": 1 },
+      "statefulResume": {
+        "type": "boolean",
+        "description": "RFC 0061 (version >= 5). A clarify/escalate suspend resumes the loop at the same iteration with the workspace+memory snapshot lineage and iteration counter intact."
+      }
     }
   }
```

No new `agents.loop` block. The version-5 contract is gated by `version >= 5`; `statefulResume` is an explicit sub-claim a host advertises when it honors §D.

### §B — iteration counter on `runOrchestrator.decided` (additive)

The loop iteration is **already** marked by `runOrchestrator.decided` (one per orchestrator turn, `multi-agent-execution.md` line 31). This RFC adds one optional field to that payload — no new event type:

```diff
   "runOrchestratorDecided": {
     "required": ["agentId", "decision"],
     "properties": {
       "agentId":  { "...": "unchanged" },
       "decision": { "$ref": "orchestrator-decision.schema.json" },
+      "iteration": {
+        "type": "integer", "minimum": 1,
+        "description": "RFC 0061 (version >= 5). 1-based count of orchestrator turns in this run. The quantity `maxLoopIterations` (RFC 0058) bounds; a breach emits cap.breached{kind:'loop-iterations', observed: <this+1>}."
+      }
     },
     "additionalProperties": false
   }
```

A host advertising `version >= 5` MUST set `iteration` on every `runOrchestrator.decided`, monotonic from 1. Hosts on `version < 5` omit it (consumers ignore the unknown field per the forward-compat contract).

### §C — per-iteration state inputs (normative, `version >= 5`)

On entering orchestrator turn *i*, a `version >= 5` host MUST treat the following as the iteration's deterministic inputs, reproducible on replay:

1. **Memory snapshot** — as-of the iteration's event-log index, per RFC 0039 §MAE-3 (already required at `version >= 2` + `memory.supported`). Unchanged; restated as a loop input.
2. **Workspace snapshot** — when `host.workspace.supported` (RFC 0059), the workspace read snapshot as-of turn *i* per RFC 0059 §D. A host advertising `version >= 5` WITHOUT `host.workspace` simply has no workspace input (the workspace is optional; the loop still runs).
3. **Recent transcript** — the event-log tail (a host-advertised window).

Writes a turn produces (memory writes, RFC 0059 workspace `PUT`s) become visible to turn *i+1*, never retroactively to *i* (snapshot immutability — the existing replay-determinism rule, `multi-agent-execution.md` line 46).

### §D — stateful resume (normative, when `statefulResume: true`)

The loop already suspends on `clarify`/`escalate` (`multi-agent-execution.md` lines 35–38). A host advertising `statefulResume: true` MUST, on resume, continue at the **same iteration** (the counter does not reset or skip) with the same memory + workspace snapshot lineage, so a human-in-the-loop interrupt mid-loop does not lose progress.

### §E — acceptance + bound (already-existing surfaces, restated)

- **"Run until acceptance criteria met"** is the existing `terminate` decision (`multi-agent-execution.md` line 34) — the supervisor evaluates the criteria and returns `terminate`, which exits to `run.completed`. This RFC does not add a mechanism; it names the pattern.
- **"≤ N iterations"** is RFC 0058's `maxLoopIterations`, bounding the §B counter. On breach: `cap.breached { kind: 'loop-iterations', limit: N, observed: N+1 }` + `loop_limit_exceeded`. **Correction to RFC 0058:** that bound gates on `capabilities.multiAgent.executionModel.supported` (orchestrator turns exist at `version >= 1`), NOT a nonexistent `capabilities.agents.loop.supported` — RFC 0058's run-options row + shape scenario must be updated to this reference (tracked in this RFC's gap register, G1).

**Positive example.** Test-fix loop, `maxLoopIterations: 20`, `version: 5`. Turns 1–3 each emit `runOrchestrator.decided { iteration: N }`; turn 3's supervisor sees tests green, returns `terminate` → `run.completed`. Each turn reloaded the same workspace+memory snapshot deterministically.
**Negative example.** Same loop, never green → turn 20 runs, turn 21 refused: `cap.breached { kind: 'loop-iterations', limit: 20, observed: 21 }` + `loop_limit_exceeded` (RFC 0058) + terminal `failed`.

## Compatibility

**Additive.** Per `COMPATIBILITY.md` §2.2: one new optional `executionModel.statefulResume` field; one new optional `iteration` field on `runOrchestrator.decided` (its `required` array and `additionalProperties:false` unchanged — an optional property addition is additive, and `version < 5` consumers ignore it); a new `version` rung (the ladder is explicitly extensible). No new event type, no new capability block, no change to the existing loop, the `terminate` exit, or RFC 0039's memory-snapshot rule. No existing field/type/`MUST`/error meaning changes. No existing v1 conformance pass is invalidated.

## Conformance

Existing coverage: `multi-agent-handoff-state-machine.test.ts` (RFC 0037 loop + handoff), the RFC 0039 memory-lifecycle scenarios. New scenarios:

- **`agent-loop-version5-shape.test.ts`** — `executionModel.statefulResume` validates as boolean when present; `runOrchestrator.decided.iteration` is an integer ≥ 1 when the host advertises `version >= 5`. (Always-on shape.)
- **`agent-loop-iteration-monotonic.test.ts`** — across a multi-turn loop, `iteration` increments 1,2,3… exactly once per `runOrchestrator.decided`. (Gated on `executionModel.version >= 5`.)
- **`agent-loop-workspace-snapshot.test.ts`** — a workspace `PUT` during turn *i* is invisible to turn *i*'s snapshot, visible to turn *i+1*. (Gated on `version >= 5` AND `host.workspace.supported`.)
- **`agent-loop-stateful-resume.test.ts`** — a loop suspended on `clarify` resumes at the same iteration with snapshot lineage intact. (Gated on `statefulResume`.)
- The loop-bound breach itself is covered by RFC 0058's `run-execution-bounds-shape.test.ts` (re-pointed to the `executionModel` gate per §E / G1).

The three gated scenarios drive the **agent-loop seam** `POST /v1/host/sample/agentloop/run` (request `{ turns, workspaceWriteAtTurn?, suspendAtTurn?, resume? }` → `{ decisions, workspaceVisible?, resumedIteration? }`), specified in [`host-sample-test-seams.md`](../spec/v1/host-sample-test-seams.md) §"Open seams". A host advertising `multiAgent.executionModel.version >= 5` wires it to light them up; they soft-skip on `404` until then. **G1 status:** the `maxLoopIterations` gating reference is already `capabilities.multiAgent.executionModel.supported` in `run-options.md`, the RFC 0058 text, and `run-execution-bounds-shape.test.ts` — no `agents.loop.supported` reference exists in the corpus, so the §E correction is already satisfied (no RFC 0058 change needed).

No new fixture beyond the existing `conformance-multi-agent-handoff` family + RFC 0058's `conformance-run-duration-breach` sibling for the loop bound.

## Alternatives considered

1. **A parallel `agents.loop` capability block + `agent.loop.iterated` event** (the author's first draft). Rejected — it duplicates the `multiAgent.executionModel` version ladder and the per-turn `runOrchestrator.decided` event. The execution loop, its versioning, and its per-iteration event already exist; adding a second surface fragments the contract and the conformance gating. Reusing the ladder + the existing event (plus one additive `iteration` field) is the lower-surface-area path, exactly as RFC 0039/0040/0041 extended the same loop.
2. **Model the loop as recursive `core.subWorkflow` dispatch (RFC 0007).** Rejected — recursion via dispatch loses single-run identity + event-log continuity; the `/loop` pattern is one run re-entering, which RFC 0037's loop already is. (Sub-dispatch fan-out remains governed by RFC 0063.)
3. **A separate long-lived `Agent` entity distinct from `Run`.** Deferred — a stateful loop is expressible as a `Run` under the existing execution model; a second long-lived entity is a v2-scale change.

## Unresolved questions

1. **Transcript window.** Is "recent transcript" a fixed event count, a token budget, or host-advertised? Proposed host-advertised `executionModel.transcriptWindow`. Resolve before Active.
2. **Workspace write visibility vs. memory write visibility.** RFC 0039 already pins memory write/read ordering across turns; confirm RFC 0059 workspace writes follow the identical "visible next turn, never retroactively" rule with no new race window when both are written in one turn. Confirm with 0059.
3. **`statefulResume` vs. plain re-entrancy.** RFC 0037's loop is already re-entrant for replay; is `statefulResume` a *distinct* claim, or implied? Proposed distinct — re-entrancy is about deterministic replay of a completed prefix; stateful resume is about a *live* HITL suspend preserving the counter. Confirm the two are separable in conformance.

## Phase-0 resolution (architect ruling, 2026-05-25)

Per `docs/autonomous-agent-runtime-plan.md` §8 — Unresolved questions resolved (wire shape pinned; Active-ready pending schema + prose):

1. **Transcript window** → host-advertised `executionModel.transcriptWindow` (event count); advertise-and-honor, not a fixed wire constant.
2. **Memory-merge semantics** → full reload of the as-of-iteration-start snapshot (deterministic); incremental merge is a host storage detail, not wire-visible.
3. **Loop + heartbeat advance** → a heartbeat (RFC 0060) MAY only enqueue a fresh loop run; it MUST NOT advance a suspended loop. The additive `iteration` field on `runOrchestrator.decided` is confirmed non-breaking (Phase-0 ruling A; `additionalProperties:false` → declared in `properties`, no `eventLogSchemaVersion` bump).

## Implementation notes (non-normative)

- Sequence after RFC 0058 (bound — landed) and alongside RFC 0059 (workspace — landed). The v5 work is: add the `iteration` counter to `runOrchestrator.decided`, load the workspace snapshot at turn start (RFC 0059), and preserve the counter across the existing suspend/resume path. **See the 2026-05-26 architect finding below — the `apps/workflow-engine` executor is single-pass `core.dispatch`, not a re-entrant loop, so this is larger than "medium" on a steward host.**
- **Companion fix to RFC 0058 (G1):** re-point `maxLoopIterations`'s gate from `capabilities.agents.loop.supported` to `capabilities.multiAgent.executionModel.supported` in `run-options.md`, the RFC, and `run-execution-bounds-shape.test.ts`. Small; do it when this RFC's framing is accepted.
- No new SECURITY invariant (the loop's BYOK/CTI/SR-1 invariants are inherited from RFC 0037/0039/0059, unchanged).
- **Reference-host enforcement (`Active → Accepted`) requires an execution-model host, NOT the in-memory reference host.** `version: 5` is the top of the RFC 0037→0041 ladder, and a host advertising it MUST implement all phases 1..5 additively (per `capabilities.schema.json §multiAgent.executionModel.version`). Advertising `executionModel.supported` therefore activates the ~15 conformance scenarios that gate on it (handoff state machine, dispatch, confidence escalation, cross-host causation, replay determinism). The in-memory reference host is a linear node walk with no orchestrator/dispatch runtime, so it cannot honestly advertise the ladder — unlike the standalone RFC 0058/0059/0060/0063/0064 capabilities (each advertised independently and exercised via its own `/v1/host/sample/*` seam). The v5 loop + the `POST /v1/host/sample/agentloop/run` seam belong on `apps/workflow-engine` (which already runs the orchestrator at `version: 1`/`2`) or a non-steward host already on the ladder (e.g. MyndHyve at `version: 4`). The agent-loop conformance scenarios soft-skip on `404` until such a host wires the seam at `version: 5`.

- **2026-05-26 architect finding — the M2 path is narrower than first scoped; `version: 5` requires a genuine *re-entrant* agent-loop host, which no steward host is.** A deeper read of `apps/workflow-engine`'s executor refined the picture:
  - **Phase 0 (the version-3 rung) is now done on the reference app.** RFC 0040 cross-host causation — the `crossHostCausation` advertisement (gated on `OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_3`, additively implied by `phase4`) + the `GET /v1/runs/{runId}/ancestry` endpoint — is implemented + behavior-verified on `apps/workflow-engine`, so a `version: 4` advertisement is no longer dishonest about Phase 3 (the ladder rung that was being skipped). This was the prerequisite for any honest `version: 5`.
  - **But the workflow-engine executor is single-pass `core.dispatch`, NOT a re-entrant loop.** It consumes a supervisor's `decisions[]` array in **one** node execution (`bootstrap/nodes.ts`), emitting one `runOrchestrator.decided` per decision — it does not re-enter the supervisor. RFC 0061's core model (per-iteration memory+workspace snapshot *inputs* with next-turn write visibility §C, suspend mid-loop and resume at the *same* iteration §D) is a **re-entrant** loop the dispatch node does not implement. Advertising `version: 5` + `statefulResume` on a single-pass-dispatch host would be the same class of overclaim the in-memory host has — one rung higher.
  - **Therefore `version: 5` honestly requires either (a) a major executor rearchitecture** turning single-pass `core.dispatch` into a re-entrant supervisor loop on `apps/workflow-engine`, **or (b) a non-steward host that genuinely runs re-entrant agent loops in production** (e.g. MyndHyve at `version: 4` → `5`). The reference hosts (in-memory linear-walk, workflow-engine single-pass-dispatch) are structurally not re-entrant-loop runtimes. RFC 0061 stays `Active`; M2 (`Active → Accepted`) awaits one of those two. The §C-workspace input also needs a host co-advertising `host.workspace`, which `apps/workflow-engine` does not.

## Acceptance criteria

- [ ] `multi-agent-execution.md` gains a `version >= 5` section (per-iteration inputs + iteration counter + stateful resume), retaining its `Status` header.
- [ ] `multiAgent.executionModel.statefulResume` (schema) + optional `iteration` on `runOrchestratorDecided` (schema).
- [ ] Conformance: shape always-on; iteration/workspace-snapshot/stateful-resume capability-gated.
- [ ] RFC 0058 gating reference corrected to `multiAgent.executionModel.supported` (G1).
- [ ] CHANGELOG entry under `[1.1.4 — unreleased]`.
- [ ] Composes cleanly with RFC 0058 bound + RFC 0059 workspace + RFC 0039 memory snapshot + RFC 0041 replay determinism (cross-checked).

## References

- [`spec/v1/multi-agent-execution.md`](../spec/v1/multi-agent-execution.md) §"Execution loop" — the loop this promotes to stateful (lines 20–46).
- [`RFCS/0037-multi-agent-execution-model.md`](./0037-multi-agent-execution-model.md) — the version ladder (`Accepted`).
- [`RFCS/0058-run-execution-bounds.md`](./0058-run-execution-bounds.md) — `maxLoopIterations`, bounding the §B counter.
- [`RFCS/0059-agent-workspace.md`](./0059-agent-workspace.md) / [`RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md`](./0039-multi-agent-confidence-and-memory-lifecycle.md) — the per-iteration workspace + memory snapshots.
- Claude Code `/loop`, agentic test-repair loops (prior art).

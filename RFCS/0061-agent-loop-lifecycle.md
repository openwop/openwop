# RFC 0061: Autonomous agent loop lifecycle (`agents.loop`)

| Field | Value |
|---|---|
| **RFC** | 0061 |
| **Title** | An `agents.loop` capability formalizing a re-entrant, stateful agent loop — each iteration loads workspace + memory + recent transcript, runs the orchestrator turn, persists deltas, appends a deterministic `agent.loop.iterated` event, and continues until an acceptance predicate, `maxLoopIterations`, or a suspend; the keystone tying RFC 0037 / 0058 / 0059 / 0004 into a portable autonomous-runtime contract |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `schemas/capabilities.schema.json` (`agents.loop` sub-block) · `spec/v1/multi-agent-execution.md` (promote loop to a named, bounded, stateful lifecycle) · `api/asyncapi.yaml` (`agent.loop.iterated` event) · `RFCS/0058` (`maxLoopIterations` + the `cap.breached` exit) · `RFCS/0059` (workspace snapshot) · `RFCS/0004` (memory snapshot) · `RFCS/0037` (orchestrator turn) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0037's execution loop is a *framework* — it defines the orchestrator turn and handoff state machine but leaves "what state is reloaded each iteration," "when does the loop stop on its own," and "how is an iteration observable" undefined (its own "Open spec gaps"). This RFC promotes that framework into a named, bounded, **stateful** lifecycle: `agents.loop`. Each iteration deterministically (1) loads the workspace snapshot (RFC 0059) + memory snapshot (RFC 0004) + recent transcript, (2) runs the orchestrator turn, (3) persists workspace/memory deltas, (4) appends `agent.loop.iterated { iteration, runId, ts }`, and (5) continues until the supervisor returns `terminate` (acceptance met), `maxLoopIterations` is hit (RFC 0058), or the run suspends. It is the keystone of the autonomous-agent-runtime cohort: scheduling (0052) starts loops, heartbeats (0060) can advance them, workspace (0059) + memory (0004) are the state they carry, and bounds (0058) keep them safe.

## Motivation

The feature set's core ask is a "repeated execution cycle where an agent loads state, runs reasoning/code, optionally performs actions… preserves/merge memory, produces deterministic logs, includes run id + timestamp," with the Claude Code `/loop` pattern: "run tests, read failures, propose edits, run tests again… loop stops when acceptance criteria met or max iterations reached." Today the `apps/workflow-engine` executor has the *mechanics* (a drain loop, suspend/resume, an event log with run id + timestamp) and RFC 0037 has the *handoff*, but there is no protocol-level contract that says: this is a loop, here is what it reloads each turn, here is the deterministic per-iteration record, and here is the bounded stop condition. A workflow author cannot portably express "iterate until green, ≤ 20 times."

The spec is the right place because per-iteration state-reload and the iteration record are replay-determinism guarantees: a loop replayed on another host MUST reload the same snapshots and reach the same iteration count, or cross-host replay (the multi-agent roadmap's whole thesis) breaks.

## Proposal

### §A — `capabilities.schema.json`: `agents.loop` sub-block (additive, nested under `agents`)

```diff
   "agents": {
     "properties": {
       "supported": { "type": "boolean" },
+      "loop": {
+        "type": "object",
+        "description": "RFC 0061. Re-entrant stateful agent-loop lifecycle.",
+        "additionalProperties": false,
+        "properties": {
+          "supported": { "type": "boolean" },
+          "statefulResume": { "type": "boolean", "description": "A suspended loop resumes preserving its iteration counter + state snapshots." },
+          "maxIterationsCeiling": { "type": "integer", "minimum": 1, "description": "Non-normative discovery echo of Capabilities.limits.maxLoopIterations (RFC 0058), advertised here for agent-capability discovery. When both are advertised they MUST be equal; on conflict limits.maxLoopIterations is authoritative and this field is ignored." }
+        }
+      }
     }
   }
```

### §B — loop lifecycle contract (normative, when `agents.loop.supported: true`)

An agent-loop run executes the RFC 0037 orchestrator loop with these added guarantees. On entering iteration *i* the host MUST:

1. **Load state deterministically** — the workspace read snapshot (RFC 0059, as-of iteration start), the memory read snapshot (RFC 0004), and the recent run transcript (the event log tail, bounded by a host-advertised window). These three are the iteration's inputs; they MUST be reproducible on replay.
2. **Run the orchestrator turn** per `multi-agent-execution.md` (the supervisor emits one `OrchestratorDecision`).
3. **Persist deltas** — any workspace `PUT` (0059) or memory write (0004) the turn produced becomes visible to iteration *i+1*, never retroactively to *i* (snapshot immutability).
4. **Append `agent.loop.iterated { iteration: i, runId, ts, decision }`** — a deterministic per-iteration record (closes the RFC 0037 gap that no loop-iteration event exists).
5. **Evaluate the stop condition, in this order:** (a) supervisor returned `terminate` ⇒ acceptance met, exit to `run.completed`; (b) `i == effective maxLoopIterations` ⇒ exit via RFC 0058 `cap.breached { kind: 'loop-iterations' }` + `loop_limit_exceeded`; (c) the turn suspended (interrupt) ⇒ pause, preserving the iteration counter and snapshots when `statefulResume: true`.

**Acceptance-criteria semantics.** "Run until acceptance criteria met" is expressed as the supervisor's `terminate` decision — the supervisor evaluates the criteria (tests green, artifact approved) and returns `terminate`. The protocol does not prescribe *what* the criteria are; it guarantees that `terminate` deterministically ends the loop and `maxLoopIterations` deterministically bounds it.

**Stateful resume.** When `statefulResume: true`, a loop suspended at iteration *i* MUST resume at iteration *i+1* with the same workspace/memory snapshot lineage and the counter intact, so a human-in-the-loop interrupt (RFC 0005) mid-loop does not reset progress.

**Positive example.** Test-fix loop, `maxLoopIterations: 20`. Iterations 1–3 emit `agent.loop.iterated`; iteration 3's supervisor sees tests green and returns `terminate` → `run.completed`. Three iteration events, deterministic.
**Negative example.** Same loop, tests never green → iteration 20 runs, iteration 21 is refused: `cap.breached { kind: 'loop-iterations', limit: 20, observed: 21 }` + `loop_limit_exceeded` (RFC 0058) + terminal `failed`.

### §C — relationship to the cohort

- **RFC 0058** supplies `maxLoopIterations` (the bound this enforces) and the `cap.breached { kind: 'loop-iterations' }` + `loop_limit_exceeded` exit surface. The ceiling's authoritative home is `Capabilities.limits.maxLoopIterations` (RFC 0058); `agents.loop.maxIterationsCeiling` is a discovery echo that MUST match it, and `limits` wins on any conflict.
- **RFC 0059 / 0004** supply the workspace / memory snapshots loaded in step 1.
- **RFC 0052 / 0060** can *start* or *advance* a loop run (a scheduled tick or heartbeat enqueues the loop run); they are orthogonal to the loop's internal contract.
- **RFC 0037** supplies the orchestrator turn this wraps; this RFC closes 0037's "no loop-iteration semantics" gap without changing the handoff state machine.

## Compatibility

**Additive.** New optional `agents.loop` sub-block; new `agent.loop.iterated` event consumers MAY ignore. RFC 0037's existing loop behavior is unchanged for hosts that don't advertise `agents.loop` — they keep running the framework loop without the iteration record or stateful-resume guarantee. No existing field, event, or `MUST` changes. No conformance pass invalidated.

## Conformance

- **`agent-loop-shape.test.ts`** — `agents.loop` block validates. (Always runs.)
- **`agent-loop-iteration-events.test.ts`** — a loop emits one `agent.loop.iterated` per orchestrator turn, monotonic `iteration`. (Gated on `agents.loop.supported`.)
- **`agent-loop-terminate.test.ts`** — a supervisor `terminate` exits the loop to `run.completed` with no further iterations. (Gated.)
- **`agent-loop-stateful-resume.test.ts`** — a loop suspended mid-iteration resumes at *i+1* with counter + snapshot intact. (Gated on `agents.loop.statefulResume`.)
- **`agent-loop-state-snapshot-determinism.test.ts`** — replaying a loop reloads identical workspace/memory snapshots per iteration. (Gated; composes with the RFC 0041 replay-determinism suite.)

## Alternatives considered

1. **Leave it to RFC 0037 + a host convention.** Rejected — 0037 explicitly defers iteration semantics; without a wire contract, "iterate until X, ≤ N times" is non-portable and unobservable, and replay can't verify iteration parity.
2. **Model the loop as recursive sub-workflows (RFC 0007).** Rejected — recursion via dispatch loses a single run's identity and event log continuity; the `/loop` pattern is one run that re-enters, not N child runs. (Sub-dispatch remains available for *fan-out*, governed by RFC 0063.)
3. **A separate `Agent` top-level entity distinct from `Run`.** Considered as the larger architectural move; deferred — a loop is expressible as a `Run` with a re-entrant lifecycle, and introducing a second long-lived entity is a v2-scale change. This RFC keeps the loop inside the run abstraction.

## Unresolved questions

1. **Transcript window.** How much event-log tail is "recent transcript" — a fixed event count, a token budget, or host-advertised? Proposed host-advertised `loop.transcriptWindow`. Resolve before Active.
2. **Memory-merge semantics.** When iteration *i* writes memory and *i+1* reads, is it a full reload or an incremental merge? Proposed full reload of the as-of snapshot (deterministic); the merge is the host's storage detail. Confirm against RFC 0039 memory-lifecycle.
3. **Loop + heartbeat advance.** Should a heartbeat (0060) be able to advance a *suspended* loop, or only enqueue a fresh loop run? Proposed: enqueue only. Decide with 0060.

## Implementation notes (non-normative)

- `apps/workflow-engine`: the executor drain loop already re-enters; add the per-iteration counter, the three-snapshot reload at iteration start, and the `agent.loop.iterated` append. Depends on RFC 0058 (counter/bound) and RFC 0059 (workspace) landing first. Effort: medium.

## Acceptance criteria

- [ ] `multi-agent-execution.md` promotes the loop to the named bounded stateful lifecycle (retains `Status` header, bumps date).
- [ ] `agents.loop` block + `agent.loop.iterated` (AsyncAPI + payload schema).
- [ ] Conformance: shape always-on; iteration/terminate/resume/determinism capability-gated.
- [ ] CHANGELOG entry under `[1.1.4 — unreleased]`.
- [ ] Composes cleanly with RFC 0058 bounds + RFC 0059 workspace + RFC 0041 replay determinism (cross-checked in review).

## References

- [`RFCS/0037`](./0037-multi-agent-execution-model.md) (multi-agent execution) — the orchestrator turn this wraps; closes its loop-iteration gap.
- [`RFCS/0058-run-execution-bounds.md`](./0058-run-execution-bounds.md) — `maxLoopIterations` + the `cap.breached { kind: 'loop-iterations' }` exit surface.
- [`RFCS/0059-agent-workspace.md`](./0059-agent-workspace.md) / [`RFCS/0004-memory-layer.md`](./0004-memory-layer.md) — per-iteration state snapshots.
- Claude Code `/loop`, agentic test-repair loops (prior art).

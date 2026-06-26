# OpenWOP Spec v1 — Multi-Agent Execution Model

> **Status: Draft v1.x (filed via [RFC 0037](../../RFCS/0037-multi-agent-execution-model.md), 2026-05-21).** First installment of a five-version execution-model formalization. This document lands the **execution-loop framework + planner→worker handoff state machine** at `multiAgent.executionModel.version: 1`. Subsequent versions land as additive RFCs: [RFC 0039](../../RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md) at `version: 2` (confidence escalation + agent-memory lifecycle), [RFC 0040](../../RFCS/0040-multi-agent-cross-host-causation.md) at `version: 3` (cross-host causation), [RFC 0041](../../RFCS/0041-multi-agent-replay-under-nondeterminism.md) at `version: 4` (replay determinism under nondeterministic models), and [RFC 0061](../../RFCS/0061-agent-loop-lifecycle.md) at `version: 5` (stateful agent-loop lifecycle — per-iteration snapshot inputs, the observable `iteration` counter, stateful HITL resume). The open-gaps table at the bottom tracks each version's follow-ups. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

Per the external standards-readiness review of 2026-05-21, finding (3): _"OpenWOP defines identities, dispatch, memory, reasoning events, envelopes, prompts, MCP/A2A composition, and host capabilities, but it does not yet give a sufficiently formal interoperable execution model for planner/worker handoff, confidence semantics, agent memory lifecycle, cross-host causality, and replay under nondeterministic model behavior."_

The existing RFCs cover slices but no single doc states the **execution model** as a portable contract:

- **RFC 0002** (`AgentRef` + reasoning events) — the identity vocabulary.
- **RFC 0006** (`core.orchestrator.supervisor`) — the supervisor primitive that emits `OrchestratorDecision`.
- **RFC 0007** (`core.dispatch`) — the dispatcher primitive that materializes the decision as a child run.
- **RFC 0022** (`inputMapping` / `outputMapping`) — the variable-projection contract across the parent/child boundary.
- **RFC 0024** (reasoning streaming) — the wire shape for `agent.reasoning.delta` events.
- **RFC 0026** (provider usage events) — the cost-attribution surface.

This document **integrates** those slices into a single normative execution loop + a 4-state handoff state machine. The design goal is portability: two non-steward hosts implementing this `version: 1` surface against the same supervisor-driven workflow input produce identical transition-event sequences (same phases, same causation chain) — the §"Cross-region replay" claim in `replay.md` extends this guarantee across regions on hosts that also advertise the RFC 0036 capabilities.

## Execution loop (normative)

A host that advertises `capabilities.multiAgent.executionModel.version >= 1` MUST implement the following loop on any workflow whose graph contains a `core.orchestrator.supervisor` node feeding into a `core.dispatch` node:

```text
LOOP:
  1. Orchestrator turn:
     - Run the supervisor node per its config (`mockDispatchPlan` in conformance,
       `prompt` + `model` in production).
     - The supervisor emits exactly one `OrchestratorDecision` per turn:
         next-worker  | terminate | clarify | escalate
     - Engine appends `runOrchestrator.decided` event with the decision payload.

  2. Decision routing:
     - `terminate` → exit LOOP; engine emits `run.completed` per spec/v1/replay.md.
     - `clarify` → emit `interrupt` per spec/v1/interrupt.md `kind: "clarification"`;
       LOOP suspends until resume.
     - `escalate` → emit `interrupt` per spec/v1/interrupt.md `kind: "approval"`;
       LOOP suspends until resume.
     - `next-worker` → enter HANDOFF STATE MACHINE below for each worker
       in `decision.nextWorkerIds[]`.

  3. After all dispatched workers reach `harvested` (or `failed` / `cancelled`),
     return to step 1.
```

The loop MUST be re-entrant per `spec/v1/replay.md` §"Replay determinism under nondeterministic models" — replaying from `fromSeq` after the Nth iteration MUST produce identical state at that index regardless of cross-region engine handoff (when `capabilities.eventLog.crossEngineOrdering.supported: true` per RFC 0036) or worker dispatch timing (when `capabilities.agents.dispatchMapping: true` per RFC 0022).

## Handoff state machine (normative)

When a supervisor's decision is `next-worker` and the engine begins dispatching, each dispatched worker MUST traverse the following 4-state machine:

| State         | Trigger                                                                                                          | Allowed exits                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pending`     | Supervisor's `OrchestratorDecision` named the worker; dispatch hasn't yet fired the child-run create             | → `dispatching` (engine begins child-run creation)                                                                                   |
| `dispatching` | Engine called `POST /v1/runs` (or sub-workflow equivalent) for the child                                         | → `running` (`201 Created` returned + `inputMapping` projection emitted) <br> → `failed` (creation failed before child ran any node) |
| `running`     | Child run is in progress                                                                                         | → `completed` (terminal status) <br> → `failed` (terminal status) <br> → `cancelled` (terminal status)                               |
| `harvested`   | Child reached terminal `completed` AND non-empty `outputMapping` projection completed back into parent variables | (terminal — parent's next supervisor turn observes the new state)                                                                    |

### Transition events (normative)

Each transition MUST emit a `core.workflowChain.event` (NEW event type — see §"Event-payload addition" below) with `causationId` linking to the prior transition's `eventId`. The chain is REQUIRED so replay-determinism gates per `spec/v1/replay.md` §"Replay determinism under nondeterministic models" can walk the causation chain backward through handoff sequences.

| Transition              | Event payload `phase`  | `causationId`                                                                              |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `pending → dispatching` | `"dispatch.began"`     | The `runOrchestrator.decided` event's `eventId`                                            |
| `dispatching → running` | `"dispatch.succeeded"` | The `dispatch.began` `eventId`                                                             |
| `dispatching → failed`  | `"dispatch.failed"`    | The `dispatch.began` `eventId`                                                             |
| `running → completed`   | `"child.completed"`    | The `dispatch.succeeded` `eventId`                                                         |
| `running → failed`      | `"child.failed"`       | The `dispatch.succeeded` `eventId`                                                         |
| `running → cancelled`   | `"child.cancelled"`    | The `dispatch.succeeded` `eventId`                                                         |
| `completed → harvested` | `"output.harvested"`   | The `child.completed` `eventId`; payload SHOULD include the `outputMapping` keys harvested |

The transition `running → harvested` MUST happen exactly when the child reaches a terminal `completed` AND the dispatch config's `outputMapping` is non-empty. Failed/cancelled children MUST skip the harvest per RFC 0022 §B (the `output.harvested` event MUST NOT fire for those terminal states).

**Conditional emission (normative).** Each row in the table above is conditional on the transition actually occurring on the host. If the host's dispatch primitive does not surface a particular terminal state — most commonly `cancelled` (some hosts collapse cancellation into `failed` with a distinct `error.code`) — the host MUST NOT synthesize the matching event. Phases the host's dispatch surfaces MUST emit per the table; phases the host's dispatch never produces MUST be absent from the event log. The `phase` enum in `schemas/run-event-payloads.schema.json` §`coreWorkflowChainEvent.phase` carries every possible transition for forward-compatibility; emission tracks the host's actual transitions. A host that later gains explicit cancellation semantics begins emitting `child.cancelled` additively at that point.

## Confidence escalation (RFC 0039, normative — `version >= 2`)

Per [RFC 0039](../../RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md) §A. Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 2`.

An `OrchestratorDecision` MAY carry an optional `confidence: number` field in `[0, 1]` where `0` is uncertain and `1` is fully confident. When `confidence < floor` (where `floor = capabilities.multiAgent.executionModel.confidenceEscalationFloor` if advertised; otherwise the spec floor `0.5`) AND the decision kind is `next-worker` or `terminate`, the host SHALL **either**:

- (a) escalate the decision via a `clarify` interrupt per `spec/v1/interrupt.md` `kind: "clarification"` (preferred — gives the user an in-the-loop chance to confirm or adjust); **OR**
- (b) escalate via an `escalate` interrupt requesting approval per `spec/v1/interrupt-profiles.md` §"Approval profile" (sufficient when the host doesn't expose a clarification UI).

Hosts MUST NOT silently execute a `confidence < floor` decision without first recording the escalation event AND firing the matching interrupt. The escalation event is `core.workflowChain.confidence-escalated` (see §"Event-payload addition" below) and MUST appear in the run event log BEFORE the interrupt fires AND BEFORE any `core.workflowChain.event` with `phase: "dispatch.began"` for the escalated decision's intended next-worker.

**Floor rationale (normative).** 0.5 is the maximum-entropy threshold — the value where a Bayesian observer with no prior has no preference between accept and clarify. Below it, silent execution would commit the workflow to an outcome the supervisor itself rates as less-than-arbitrary. Operator policy stricter than 0.5 advertises via `confidenceEscalationFloor`; the spec floor of 0.5 is non-configurable across hosts so cross-host workflows have a portable lower bound. See `RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md` §A "Why 0.5" for the full rationale. This 0.5 floor applies to `OrchestratorDecision.confidence` only — it is a distinct field from the `agent.decided.confidence` threshold (default 0.7, RFC 0077) used by the `liveRuntime` escalation rule in §"Live manifest dispatch" step 7 below.

**`confidence` field absence.** When the decision's `confidence` is absent (`undefined` / not emitted), the host MUST NOT escalate on this rule alone — `confidence === undefined` means "no opinion stated," not "low confidence." Operators wanting opt-in always-escalate behavior advertise a separate host-extension flag; this is not normated here.

**Interrupt-kind advertisement (RFC 0044).** Hosts MAY advertise `capabilities.multiAgent.executionModel.confidenceEscalationInterruptKind` to commit to a specific `interrupt.kind` for confidence-escalation events. Canonical values are `clarification` (matching the clarify-kind escalation in §A above) and `approval` (matching the escalate-kind path). Vendor kinds use the canonical host-extension namespace `x-host-<host>-<kind>` per `host-extensions.md` §"Canonical prefixes". When advertised, the host MUST emit an interrupt of the advertised kind on every confidence-escalation event; conformance reads the advertised value and accepts the host's specific kind. Hosts advertising a vendor kind MUST also publish a non-normative kind-mapping document per RFC 0044 §C identifying which canonical escalation kind it semantically corresponds to + the host's `interrupt.md` mapping to a `waiting-*` status. The `confidence-escalated` event payload's `escalationKind` field remains normated to `{clarify, escalate}` independent of the interrupt-kind name; that separates wire-shape (escalation kind in the event payload) from operator-visible naming (interrupt kind on the suspend).

## Agent memory lifecycle across sub-runs (RFC 0039, normative — `version >= 2`)

Per [RFC 0039](../../RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md) §B. Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 2` AND `capabilities.memory.supported: true`.

### Cross-run memory inheritance (MAE-2)

When a parent run dispatches a child run via `core.dispatch` or `core.subWorkflow`, the child's `MemoryAdapter` MUST be scoped per-(tenantId, scopeId) per `agent-memory.md` §CTI-1 (cross-tenant invariant). Child runs MAY share the parent's `scopeId` (default — inherit) or declare a fresh `scopeId` (opt-in via the dispatch config's `memoryScopeIsolation: "isolated"` field, additive). When the child shares the parent's `scopeId`:

1. `MemoryEntry` records the child writes are visible to the parent on the child's terminal `completed` AND any subsequent parent supervisor turn — the same single-host visibility contract as intra-run memory operations.
2. `MemoryEntry.ttl` MUST be anchored at the child's wall-clock write time, NOT the parent's start time. A child writing `MemoryEntry { ttl: 3600 }` at parent-clock T+10s expires at T+3610s (child write time + ttl), NOT T+3600s. **Why child-write-time wins:** TTL is an absolute freshness contract on the datum ("this value is valid for N seconds after I wrote it"), not a budget against an enclosing run lifetime. Parent runs that need longer-lived shared memory write directly to the shared scope under their own clock.
3. The parent's subsequent supervisor turn observing the child's MemoryEntry MUST NOT race a still-running sibling dispatch's writes — host MUST serialize cross-child writes per parent-run, OR advertise `capabilities.multiAgent.executionModel.crossChildMemoryConcurrency: "advisory"` to opt out of the serialization MUST (advisory hosts SHOULD document last-write-wins semantics out-of-band).

### Replay carry-forward (MAE-3)

When a `POST /v1/runs/{runId}:fork` invocation forks from a past event-log index N, the forked run's `MemoryAdapter.get(key)` calls before reaching index N MUST return the value that was in memory **AT THE ORIGINAL RUN'S TIME OF INDEX N** — NOT the current memory state.

Hosts MUST persist memory snapshots tied to event-log indices when `capabilities.multiAgent.executionModel.version >= 2` AND `capabilities.memory.supported: true` are both advertised. The snapshot mechanism is host-internal (e.g., periodic copy-on-write checkpoints, append-only journal with reverse-projection on memory-write operations, per-write snapshot rows). Hosts that cannot satisfy the snapshot at the requested `fromSeq` MUST refuse the fork with `error.code: "replay_memory_snapshot_unavailable"` per `spec/v1/rest-endpoints.md` §"Common error codes". `error.details.fromSeq` SHOULD identify the requested index; `error.details.oldestAvailableIdx` MAY identify the oldest index for which a snapshot exists (lets clients pick a valid fork point).

### Conformance gating

Scenarios verifying §"Cross-run memory inheritance" + §"Replay carry-forward" gate on the conjunction `capabilities.multiAgent.executionModel.version >= 2 && capabilities.memory.supported: true`. Hosts that advertise either alone skip cleanly.

## Cross-host causation (RFC 0040, normative — `version >= 3`)

Per [RFC 0040](../../RFCS/0040-multi-agent-cross-host-causation.md). Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 3` AND `capabilities.multiAgent.executionModel.crossHostCausation.supported: true`.

### `causationHostId` payload field (normative)

Hosts MUST emit an optional `causationHostId: string` field on event payloads whose top-level `causationId` points at an event on a DIFFERENT host than the emitting host. The field's value MUST equal the originating host's `capabilities.multiAgent.executionModel.crossHostCausation.hostId` advertisement.

When the `causationId` points at an event on the SAME host, `causationHostId` MUST be absent (preserves existing single-host semantics; consumers on hosts advertising `version < 3` ignore the unknown field per the forward-compat contract).

Affected payload types (additive): `coreWorkflowChainEvent`, `coreWorkflowChainConfidenceEscalated`, `agentReasoned`, `agentToolCalled`, `agentToolReturned`, `agentHandoff`, `agentDecided`, `runOrchestratorDecided`, `promptComposed`, `agentPromptResolved`. The field is OPTIONAL on every shape.

### W3C tracecontext across MCP + A2A composition (normative)

Hosts that dispatch MCP tool calls AND advertise `multiAgent.executionModel.version >= 3` MUST inject the parent run's W3C `traceparent` header into the outbound MCP request envelope. The MCP tool's host MUST honor the inbound `traceparent` as the parent trace for any spans it emits.

The same rule applies symmetrically to A2A composition (`spec/v1/a2a-integration.md`): outbound A2A messages MUST carry the parent run's `traceparent`; inbound A2A handlers MUST adopt it as the trace parent.

This extends the per-host trace propagation already covered by RFC 0023 (`otel-trace-propagation-subworkflow.test.ts`) to cross-host composition.

### `GET /v1/runs/{runId}/ancestry` endpoint (normative)

Hosts advertising `crossHostCausation.ancestryEndpointSupported: true` MUST serve `GET /v1/runs/{runId}/ancestry` returning `RunAncestryResponse` per `schemas/run-ancestry-response.schema.json`. The endpoint surfaces the run's immediate parent (NOT the full chain — clients walk the chain by following `parent.wellKnownUrl` per response, one hop at a time). Top-level runs return `parent: null`.

Hosts that advertise `crossHostCausation.supported: true` but NOT the ancestry endpoint return `404 not_found` from the endpoint; clients reconstruct chains by walking `causationHostId` fields on individual events instead.

## Replay determinism under nondeterminism (RFC 0041, normative — `version >= 4`)

Per [RFC 0041](../../RFCS/0041-multi-agent-replay-under-nondeterminism.md). Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 4` AND `capabilities.multiAgent.executionModel.replayDeterminism.supported: true`. Closes RFC 0037 §"Open spec gaps" MAE-7 + MAE-8 + MAE-9.

The normative contracts live in [`replay.md`](./replay.md) §"Replay determinism under nondeterministic models (RFC 0041, normative — `version >= 4`)":

- §A — LLM cache-key recipe strengthening. The recipe in `replay.md` §"LLM cache-key recipe" §A + §B is already a conditional MUST for hosts using Layer-2 idempotency for LLM nodes. RFC 0041 makes the MUST unconditional (applies to ALL LLM-calling nodes) AND requires hosts to advertise the recipe they honor via `replayDeterminism.llmCacheKeyRecipe` for observable cross-host parity.
- §B — Envelope-refusal recovery: replay-time refusal-divergence MUST emit `replay.divergedAtRefusal` and fail with `error.code: "replay_diverged_at_refusal"`. Silent substitution is non-conformant.
- §C — Observable-output-sequence determinism: the contract is byte-equivalence at the event-log + RunSnapshot boundary, NOT bit-equivalent execution of underlying tool calls. Hosts cache the observable result, not just the tool-call bytes.

## Stateful agent-loop lifecycle (RFC 0061, normative — `version >= 5`)

Per [RFC 0061](../../RFCS/0061-agent-loop-lifecycle.md). Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 5`. This promotes the §"Execution loop" framework (already re-entrant + replay-deterministic) to a _stateful_ lifecycle — it adds no new loop, event type, or `terminate` exit; it pins what each iteration reloads, makes the iteration count observable + bounded, and guarantees a HITL suspend resumes mid-loop without losing progress.

**Iteration counter (normative).** A `version >= 5` host MUST set `runOrchestrator.decided.iteration` (additive optional field, `run-event-payloads.schema.json`) on every orchestrator turn — 1-based, monotonic, incrementing by exactly 1 per turn. This is the observable quantity `maxLoopIterations` (RFC 0058) bounds; a breach emits `cap.breached { kind: 'loop-iterations', limit: N, observed: N+1 }` + `loop_limit_exceeded`. Hosts on `version < 5` omit the field; consumers ignore it per the forward-compatibility contract.

**Per-iteration state inputs (normative).** On entering orchestrator turn _i_, a `version >= 5` host MUST treat the following as the iteration's deterministic inputs, reproducible on replay:

1. **Memory snapshot** — as-of the iteration's event-log index, per §"Replay carry-forward (MAE-3)" (already required at `version >= 2` + `memory.supported`). Restated here as a loop input; unchanged.
2. **Workspace snapshot** — when `host.workspace.supported` ([RFC 0059](../../RFCS/0059-agent-workspace.md)), the workspace read snapshot as-of turn _i_ per RFC 0059 §D. A `version >= 5` host WITHOUT `host.workspace` simply has no workspace input — the workspace is optional and the loop still runs.
3. **Recent transcript** — the event-log tail, bounded by the host-advertised `executionModel.transcriptWindow` (event count) when present.

Writes a turn produces (memory writes, RFC 0059 workspace `PUT`s) MUST become visible to turn _i+1_, never retroactively to turn _i_ — the existing snapshot-immutability rule from §"Execution loop". This holds identically for memory and workspace writes made in the same turn.

**Stateful resume (normative, when `executionModel.statefulResume: true`).** The loop already suspends on `clarify`/`escalate` (§"Execution loop"). A host advertising `statefulResume: true` MUST, on resume, continue at the **same iteration** — the `iteration` counter MUST NOT reset or skip — with the same memory + workspace snapshot lineage, so a human-in-the-loop interrupt mid-loop does not lose progress. This is a distinct claim from replay re-entrancy (deterministic replay of a completed prefix); stateful resume concerns a _live_ suspend preserving the counter. A heartbeat (RFC 0060) MAY only enqueue a fresh loop run; it MUST NOT advance a suspended loop.

**Acceptance + bound (existing surfaces, restated).** "Run until acceptance criteria met" is the existing `terminate` decision (§"Execution loop") — the supervisor evaluates the criteria and returns `terminate`, exiting to `run.completed`; RFC 0061 adds no mechanism, it names the pattern. "≤ N iterations" is RFC 0058's `maxLoopIterations`, bounding the iteration counter above; that bound gates on `capabilities.multiAgent.executionModel.supported` (orchestrator turns exist at `version >= 1`).

## Context economy (RFC 0111, normative — `version >= 5`)

Per [RFC 0111](../../RFCS/0111-context-economy.md). Applies only when the host advertises the OPTIONAL `capabilities.multiAgent.executionModel.contextBudget` block (`version >= 5`). The §"Per-iteration state inputs" §3 transcript input (the event-log tail) is bounded today only by the event-count `transcriptWindow` — which does NOT bound **tokens**: a single large tool result can blow any per-turn budget regardless of event count. `contextBudget` adds an OPT-IN, token-denominated bound on the transcript plus a declared contract for turns evicted beyond it. It is **purely additive**: a host that omits the block behaves exactly as today, and `transcriptWindow`'s `absent ⇒ unbounded` default is **NOT** changed by this RFC.

**Scope (normative).** `contextBudget` governs the **RFC 0061 per-iteration orchestrator-loop transcript** — the §"Per-iteration state inputs" input 3, the SAME transcript `transcriptWindow` bounds — NOT a general chat-conversation history (RFC 0005) or any other prompt. A host whose multi-agent orchestrator loop does not run real model turns (e.g. a mock supervisor with no live inference) MUST NOT advertise `contextBudget`, exactly as it MUST NOT dishonestly advertise `transcriptWindow`. Budget-only advertisement — `transcriptTokenBudget` + `tokenCounter` WITHOUT `summarization.supported` — is valid for a host that HAS a real orchestrator loop but does not summarize; such a host bounds the transcript (e.g. by dropping the oldest in-window turns) and emits no `context.summarized` events.

**Token bound (normative).** A host advertising `contextBudget.transcriptTokenBudget` MUST NOT feed more than that many tokens of transcript to any single orchestrator turn, measured in the unit named by `contextBudget.tokenCounter`. A host advertising `transcriptTokenBudget` MUST also advertise `tokenCounter` (the budget is otherwise uninterpretable; enforced by the schema `if/then`). `transcriptTokenBudget` and `transcriptWindow` MAY both be advertised; when both bound a given turn the host MUST honor whichever bound is **tighter** for that turn.

**Verbatim floor (normative).** A host advertising `contextBudget.summarization.supported: true` MUST keep the most recent `keepLastTurns` turns verbatim and MAY replace older in-window turns with a host-produced summary. The active (most recent) turn MUST NOT be summarized.

**Replay determinism (normative).** Per §"Per-iteration state inputs", the transcript is a deterministic, replay-reproducible iteration input — today a pure projection of the event-log tail. A host-produced summary is **nondeterministic host output** that breaks that purity, so it is governed exactly like a nondeterministic LLM envelope under [RFC 0041](../../RFCS/0041-multi-agent-replay-under-nondeterminism.md) (`version >= 5` implies the `version >= 4` replay-determinism contract). Therefore:

- Each substitution MUST be recorded as a `context.summarized` event (§"Event-payload addition") whose `summaryRef` points at the persisted summary artifact.
- On a `POST /v1/runs/{runId}:fork mode: replay`, when a summarization point falls at sequence ≥ `fromSeq`, the host MUST reuse the recorded summary (resolved via `summaryRef`) and MUST NOT re-summarize. A host that re-summarizes and produces a different model-facing transcript is non-conformant — the direct analogue of `replay.md` §"Envelope-refusal recovery in replay".
- `summaryRef` is an **artifactId** (a run-produced artifact read via `GET /v1/runs/{runId}/artifacts/{artifactId}`), keeping the event content-free. By direct analogy to the MAE-3 memory carry-forward (§"Replay carry-forward (MAE-3)"), the summary artifact MUST be persisted and readable as-of the iteration's event-log index; a host that cannot serve it at the requested `fromSeq` MUST refuse the fork (mirroring `replay_memory_snapshot_unavailable`).
- Summarization that is not recorded this way breaks replay and MUST NOT be advertised under this capability.

**Conformance seam (non-vacuity ceiling).** The assembled transcript is host-internal and never crosses the wire, so conformance observes it via the OPTIONAL `GET /v1/host/sample/agent/transcript-window` seam (`host-sample-test-seams.md`): the host reports its own per-iteration accounting (`tokenCounter`, `tokenCount`, `eventIds`, `summarizedRanges`). The harness independently re-counts the events named in `eventIds` and asserts internal consistency + `tokenCount ≤ transcriptTokenBudget` + recent-tail. This proves the host's **declared** transcript accounting is consistent and bounded; it cannot black-box-prove the host feeds nothing additional off-seam — the inherent ceiling of governing host-internal assembly. The capability is advertise-and-attest.

## Verifier and convergence (RFC 0090, normative — `version >= 6`)

Per [RFC 0090](../../RFCS/0090-agent-verifier-and-convergence.md). Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 6` + the `verifier` sub-block. This adds the missing **critic** to the planner (orchestrator) + actor (worker) the loop already models: an independent agent that checks a result before it is committed, plus an observable record of _why_ a run converged. It adds no new loop — it composes the existing execution loop, the RFC 0063 merge gate, and the RFC 0058 iteration bound.

**The `agent.verified` event (normative, when `verifier.supported: true`).** A critic agent MUST emit `agent.verified { agentId, target, verdict, criteria?, confidence? }` (`run-event-payloads.schema.json`) over a prior result — a worker's `agent.decided` (by its `eventId`), a child `runId`, or a tool `callId` (the `target`). It is **content-free** (SECURITY invariant `verifier-no-content-leak`): it carries the verdict and the criteria _keys_, never the verified content. `verdict` ∈ `pass | fail | revise`. The critic SHOULD differ from the actor; a host MAY allow self-verification but MUST keep verifier identity inspectable. The verifier's own `confidence` is distinct from the actor's `agent.decided.confidence` and MAY drive the §"Confidence escalation" contract.

**Verdict gating (normative, when `verifier.gating: true`).** A host advertising `verifier.gating: true` MUST treat the verdict as a commit gate: a `fail` over a sub-run output MUST NOT be merged (composing the RFC 0063 fail-closed merge gate) and MUST NOT silently `terminate` as success; a `revise` SHOULD route back to another actor turn, bounded by `maxLoopIterations` (RFC 0058); a `pass` MAY proceed. Absence of any `agent.verified` over a result is NOT a failure — verification is opt-in; only an emitted `fail`/`revise` gates. A host advertising `verifier.supported` but not `gating` emits the verdict for observability only.

**Convergence criteria (additive, on `terminate`).** The orchestrator's `terminate` decision (RFC 0006) gains an additive optional `successCriteria: [{ key, met }]` (`orchestrator-decision.schema.json`) — a structured, content-free record of the conditions the supervisor judged satisfied. When present, a `terminate` carrying any `met: false` entry signals a give-up, not a success; consumers MUST NOT treat such a run as goal-satisfied. Absent ⇒ today's free-text `reason` semantics, unchanged.

## Live manifest dispatch (RFC 0077, normative — `capabilities.agents.liveRuntime`)

Per [RFC 0077](../../RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md). RFC 0070 (`agents.manifestRuntime`) makes a pack-declared `AgentManifest` loadable + dispatchable on a deterministic floor; RFC 0072 pins its inventory (`GET /v1/agents`) + dispatch path (`WorkflowNode.agent` + `POST /v1/runs`). **Live manifest dispatch** is the execution layer that runs a manifest agent against a _live_ model + its real tools, gated behind the additive optional `capabilities.agents.liveRuntime` — a **strict superset of `agents.manifestRuntime`** (`liveRuntime.supported: true` REQUIRES `manifestRuntime.supported: true`). Hosts that advertise only the floor are unchanged.

### Manifest → live-run mapping (normative, when `agents.liveRuntime.supported: true`)

A live manifest invocation MUST perform these steps; each composes an existing surface — this section pins which are MUST and their ordering, not the internal algorithm:

1. **Model/provider selection.** The host resolves the manifest's abstract `modelClass` to a concrete model + provider. The mapping is host-defined; the host MUST keep it stable within a run for replay (the resolved model participates in the RFC 0041 LLM cache-key recipe). A run-time override MAY be supplied via `RunOptions.configurable.ai.*`, taking precedence. Resolution MAY occur downstream (e.g. at the prompt-call node, with capability-gated fallback-model substitution), so `agent.invocation.started` MAY omit the resolved model.
2. **Prompt resolution.** Resolve the system prompt from `systemPrompt` | `systemPromptRef` (intrinsic, wins) with `promptOverrides` / `promptLibraryRef` fallback per `prompts.md` (RFC 0028/0029). The host MUST emit `agent.promptResolved` recording the resolved PromptRef identifiers (content-free per RFC 0028).
3. **Tool-surface construction.** Construct the callable tool surface by filtering against `toolAllowlist` (RFC 0002 §A14). A tool NOT in the allowlist MUST NOT be callable. When `capabilities.toolHooks` (RFC 0064) is advertised, per-tool authorization MUST fail closed (`forbidden`) and tool calls MUST emit `agent.toolCalled` / `agent.toolReturned`.
4. **Memory binding.** Bind the backends declared in `memoryShape` (RFC 0004). When `memoryShape.longTerm: true`, the host MUST apply the SR-1 redaction harness on writes and MAY emit `memory.written` (RFC 0057) / participate in consolidation (RFC 0068). Memory is tenant-scoped (CTI-1).
5. **Reasoning + tool loop.** Run the agent turn(s): live inference + tool calls through the step-3 surface, emitting the existing `agent.reasoned` / `agent.reasoning.delta` / `agent.toolCalled` / `agent.toolReturned` events. **Single-shot is the `liveRuntime` floor** — a `liveRuntime` host MAY run one turn; the multi-turn agent loop composes _above_ via the orchestrator + RFC 0061 (`executionModel.version >= 5`) and MUST NOT be folded into the `liveRuntime` floor (loop infrastructure is not required to advertise `liveRuntime`).
6. **Handoff + structured-output validation.** When `handoff.taskSchemaRef` is present, the host MUST validate the inbound task against it before step 5 and reject a non-conforming task. When `handoff.returnSchemaRef` is present AND `liveRuntime.structuredOutput: true` is advertised, the host MUST validate the terminal result against it and fail the run rather than ship a non-conforming result. Cross-agent handoffs emit `agent.handoff`.
7. **Confidence escalation.** When `liveRuntime.confidenceEscalation: true`, an `agent.decided` whose `confidence` falls below the effective threshold (`confidence.defaultThreshold`, or the run-resolved threshold per RFC 0002 §F, default 0.7) MUST trigger the §"Confidence escalation" contract rather than silently accept. This `agent.decided` threshold (default 0.7, RFC 0077) is a distinct field from the non-configurable 0.5 `OrchestratorDecision.confidence` floor in §"Confidence escalation" above (RFC 0039); the two are not interchangeable.
8. **Terminal result projection.** On termination, project the agent's terminal result onto the run's normal result surface. When the agent ran as a sub-run with `capabilities.agents.subRunAttestation` (RFC 0063), the attestation composes unchanged and follows the agent-scoped terminal. The host MUST emit `agent.invocation.completed` as the final agent-scoped event.

### Invocation bracket events (normative)

A `liveRuntime` host MUST emit `agent.invocation.started` as the FIRST agent-scoped event of a live invocation and `agent.invocation.completed` as the LAST, bracketing the existing `agent.*` family. Both are **content-free** (identifiers + metadata only — no prompt text, no result body) and are **recorded-fact events** per `replay.md` §"Recorded-fact events": on replay they are re-emitted from the event log and the host MUST NOT regenerate their identifiers (notably `invocationId`) or timestamps.

- **`invocationId`** correlates `started`↔`completed`. It is **host-defined and unique-within-run** — NOT a mandated global id-space. It is distinct from `runId` (one run MAY host several invocations — multiple agent nodes, or a handoff chain), but a host MAY derive it from an existing per-node-execution receipt id (e.g. `runId:nodeId:seq`) or mint a UUID, and a single-invocation run MAY reuse `runId`.
- **`source`** ∈ `workflow-node` | `run-api` | `chat-mention` records the entry point (below). `agent.invocation.started` MAY also carry `modelClass`, the optional `resolvedModel`/`resolvedProvider`, `toolSurfaceCount`, `memoryBound`. `agent.invocation.completed` carries `outcome` ∈ `completed` | `handed-off` | `escalated` | `refused` | `failed`, plus optional `schemaValidated` / `confidence` / `enqueuedRunId`.

**Event ordering (normative).** For a single live invocation the agent-scoped events MUST appear as: `agent.invocation.started` → `agent.promptResolved` → (`agent.reasoning.delta`_→ `agent.reasoned`)+ → (`agent.toolCalled` → `agent.toolReturned`)_ → `agent.decided`+ → `agent.handoff`? → `agent.invocation.completed`. `started` MUST precede every other agent-scoped event of the invocation; `completed` MUST follow them (and, for a sub-run, precedes the run-scoped RFC 0063 `output.harvested`).

### Composition: three entry points (normative)

A live manifest agent is invocable three ways; all MUST resolve to the same mapping above and emit the identical bracket + family — **one agent, one observable event family, three entry points**:

1. **`workflow-node`** — a `WorkflowNode.agent` step (RFC 0072 §B); the invocation is a node execution inheriting the run's replay/fork/observability envelope. Default `sources` value.
2. **`run-api`** — an agent as the root of `POST /v1/runs`; the run lifecycle wraps it. A host advertising `run-api` MUST accept a run whose root references a manifest `agentId`.
3. **`chat-mention`** — a chat `@agent` invocation. The chat surface is host UX (non-normative), but a host advertising `chat-mention` MUST map it onto the same run surface + emit the identical family. `sources` is per-host; **no enum member is mandatory** — a host with no chat surface advertises `["workflow-node", "run-api"]` and is fully compliant.

### Safety carry-forward (normative)

Live execution MUST NOT relax any RFC 0072 §D mandatory floor guarantee: (1) `toolAllowlist` enforcement is mandatory (a tool outside the allowlist MUST NOT be callable even under `liveRuntime`); (2) handoff inbound validation (`taskSchemaRef`) is mandatory when present; (3) tenant scoping (CTI-1) on memory + any enqueued run is mandatory; (4) live model output is untrusted — the host MUST treat it per the RFC 0031/0032 envelope contract (a refusal terminates with `outcome: "refused"`, never a silent substitution); (5) per-tool authorization (when `toolHooks` advertised) fails closed. `structuredOutput` + `confidenceEscalation` are advertised _quality_ sub-flags (a host MAY run live without them); the five guarantees above are unconditional under `liveRuntime`.

## Capability advertisement (normative)

```jsonc
{
  "capabilities": {
    "multiAgent": {
      "executionModel": {
        "supported": true,
        "version": 1
      }
    }
  }
}
```

| Field              | Type          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supported`        | `boolean`     | When `true`, the host implements the execution loop + handoff state machine above. Conformance scenarios gating on this flag run unconditionally on advertising hosts.                                                                                                                                                                                                                                                                                                                                                                                  |
| `version`          | `integer 1–6` | Profile version. `1` = handoff state machine (this document — RFC 0037, execution-loop framework + planner→worker handoff). `2` = RFC 0039 (confidence escalation + agent-memory lifecycle), `3` = RFC 0040 (cross-host causation), `4` = RFC 0041 (replay determinism under nondeterminism), `5` = RFC 0061 (stateful agent-loop lifecycle — per-iteration snapshot inputs, the `iteration` counter, stateful resume), `6` = RFC 0090 (verifier/critic turn + convergence criteria). A host advertising `version: N` MUST implement all versions 1..N. |
| `statefulResume`   | `boolean`     | RFC 0061 (`version >= 5`). When `true`, a `clarify`/`escalate` HITL suspend resumes the loop at the same iteration with the snapshot lineage + counter intact. See §"Stateful agent-loop lifecycle".                                                                                                                                                                                                                                                                                                                                                    |
| `transcriptWindow` | `integer ≥ 1` | RFC 0061 (`version >= 5`). Host-advertised count of recent event-log entries fed each orchestrator turn as the transcript input. Absent ⇒ unbounded on the wire.                                                                                                                                                                                                                                                                                                                                                                                        |
| `contextBudget`    | `object`      | RFC 0111 (`version >= 5`). `{ transcriptTokenBudget?, tokenCounter?, summarization? { supported, strategy?, keepLastTurns? } }`. Opt-in token-denominated transcript bound + declared summarization contract. `tokenCounter` REQUIRED when `transcriptTokenBudget` present. Purely additive — does NOT flip `transcriptWindow`'s `absent ⇒ unbounded`. Summarization is RFC 0041-governed: each eviction records a `context.summarized` event whose `summaryRef` replay reuses (never re-summarizes). See §"Context economy".                              |
| `verifier`         | `object`      | RFC 0090 (`version >= 6`). `{ supported, gating? }`. When `supported`, the host emits `agent.verified` over results per §"Verifier and convergence". When `gating: true`, a `fail` verdict blocks merge/terminate (fail-closed) and `revise` routes back to an actor turn. Absent ⇒ no verifier turn.                                                                                                                                                                                                                                                   |

Hosts that do NOT advertise this capability MAY implement RFCs 0006/0007/0022 individually with implementation flexibility on the integration semantics; conformance scenarios gating on this flag soft-skip on absence per the existing capability-gating convention.

## Event-payload addition

`schemas/run-event-payloads.schema.json` gains a new event type entry `core.workflowChain.event` with payload shape:

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["phase", "workerId", "parentRunId"],
  "properties": {
    "phase": {
      "type": "string",
      "enum": [
        "dispatch.began",
        "dispatch.succeeded",
        "dispatch.failed",
        "child.completed",
        "child.failed",
        "child.cancelled",
        "output.harvested"
      ],
      "description": "Which handoff-state-machine transition this event records. See spec/v1/multi-agent-execution.md §'Handoff state machine'."
    },
    "workerId": {
      "type": "string",
      "minLength": 1,
      "description": "The dispatched worker's workflowId — matches the entry in the supervisor's OrchestratorDecision.nextWorkerIds[]."
    },
    "parentRunId": {
      "type": "string",
      "minLength": 1,
      "description": "The orchestrator-driven parent run's runId."
    },
    "childRunId": {
      "type": "string",
      "minLength": 1,
      "description": "The dispatched child run's runId. REQUIRED on phases `dispatch.succeeded` and beyond; absent on `dispatch.began` and `dispatch.failed` (child wasn't created)."
    },
    "harvestedKeys": {
      "type": "array",
      "items": { "type": "string" },
      "description": "On phase `output.harvested`: which parent-variable keys were populated by the dispatch config's outputMapping per RFC 0022 §A. SHOULD be present; conformance asserts presence when outputMapping is non-empty."
    },
    "error": {
      "type": "object",
      "description": "On phases `dispatch.failed` / `child.failed` / `child.cancelled`: the canonical error envelope per spec/v1/auth.md §'Error response shape'.",
      "additionalProperties": true
    }
  }
}
```

Hosts that do NOT advertise `capabilities.multiAgent.executionModel.supported: true` MUST NOT emit this event (the event is the wire signature of the contract being advertised).

`schemas/run-event-payloads.schema.json` ALSO gains `context.summarized` (RFC 0111, §"Context economy") — emitted when the host replaces older in-window transcript turns with a summary to honor `contextBudget.transcriptTokenBudget`. Payload `{ iteration, replacedTurns: string[], summaryRef, tokenCounter, tokensBefore, tokensAfter }`. **Content-free**: `summaryRef` is an artifactId (the summary text never rides the wire); `replacedTurns` lists the event ids the summary stands in for so a replay engine reconstructs the exact transcript. A host MUST NOT emit it unless it advertises `contextBudget.summarization.supported: true`.

## Open spec gaps

| #     | Gap                                                                                                                                                                                                             | Land-in version (RFC)   | Owner      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| MAE-1 | **`version: 2`:** Confidence-threshold semantics — at what `OrchestratorDecision.confidence` value MUST the supervisor escalate to clarification or approval, versus MAY escalate? Today: host policy.          | RFC 0039 (`version: 2`) | OpenWOP WG |
| MAE-2 | **`version: 2`:** Agent memory lifecycle across sub-runs — `MemoryEntry.ttl` semantics when a parent run dispatches a child whose memory operations the parent inherits. Today: implicit; needs normative MUST. | RFC 0039 (`version: 2`) | OpenWOP WG |
| MAE-3 | **`version: 2`:** Memory carry-forward when a sub-run is replayed from past event-log index — does the replay re-read the original memory snapshot, or the current memory state?                                | RFC 0039 (`version: 2`) | OpenWOP WG |
| MAE-4 | **`version: 3`:** Extending `causationId` to span hosts (currently single-host scope per `spec/v1/replay.md` §"Determinism guarantees").                                                                        | RFC 0040 (`version: 3`) | OpenWOP WG |
| MAE-5 | **`version: 3`:** W3C tracecontext propagation across MCP/A2A composition boundaries — partial coverage in `RFC 0023` for OTel; needs normative cross-host case.                                                | RFC 0040 (`version: 3`) | OpenWOP WG |
| MAE-6 | **`version: 3`:** Cross-host run-ID resolution — when host A's run dispatches to host B, what's the discoverable identifier chain?                                                                              | RFC 0040 (`version: 3`) | OpenWOP WG |
| MAE-7 | **`version: 4`:** LLM cache-key recipe — `replay.md` §"LLM cache-key recipe" already exists but `replay-llm-cache-key.test.ts` is shape-only per `docs/KNOWN-LIMITS.md:18`.                                     | RFC 0041 (`version: 4`) | OpenWOP WG |
| MAE-8 | **`version: 4`:** Recovery from envelope refusal in replay context — original run got envelope, replay gets refusal.                                                                                            | RFC 0041 (`version: 4`) | OpenWOP WG |
| MAE-9 | **`version: 4`:** Determinism vs idempotency — replay produces the same observable output sequence even when underlying tool calls differ.                                                                      | RFC 0041 (`version: 4`) | OpenWOP WG |

## References

- [`RFCS/0037-multi-agent-execution-model.md`](../../RFCS/0037-multi-agent-execution-model.md) — the source RFC.
- [`RFCS/0002-agent-identity-and-reasoning-events.md`](../../RFCS/0002-agent-identity-and-reasoning-events.md) — `AgentRef` + reasoning event vocabulary.
- [`RFCS/0006-orchestrator.md`](../../RFCS/0006-orchestrator.md) — `core.orchestrator.supervisor` primitive.
- [`RFCS/0007-dispatch.md`](../../RFCS/0007-dispatch.md) — `core.dispatch` primitive.
- [`RFCS/0022-dispatch-input-output-mapping.md`](../../RFCS/0022-dispatch-input-output-mapping.md) — `inputMapping` / `outputMapping` contract.
- [`RFCS/0024-agent-reasoning-streaming.md`](../../RFCS/0024-agent-reasoning-streaming.md) — `agent.reasoning.delta` event vocabulary.
- [`RFCS/0026-provider-usage-event.md`](../../RFCS/0026-provider-usage-event.md) — cost-attribution surface.
- [`spec/v1/replay.md`](./replay.md) §"Determinism guarantees" + §"Replay determinism under nondeterministic models" — the replay contract this execution model preserves.
- [`spec/v1/positioning.md`](./positioning.md) — "we don't standardize orchestration topology" — the principle this RFC's `executionModel.version` flag respects (the framework is opt-in; non-advertising hosts retain full implementation flexibility).
- External standards-readiness review 2026-05-21 — finding (3).

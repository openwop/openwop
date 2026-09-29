# Execution

> **Status: Stable.**
> **Normative home:** `selfHostedRunner`, `subWorkflow`, `multiAgent`.

## Why this exists

A step can run on a user's machine, in a child run, or under a supervisor loop; the host stays the orchestration, persistence and replay authority.

## `selfHostedRunner`

A runner is a user-operated process that dials out, holds credentials the host cannot reach, and executes single model or tool steps. It receives dispatch frames over SSE and POSTs result frames, on host-defined paths. A host MUST NOT advertise `selfHostedRunner` unless it accepts registrations, routes matching dispatch and delivers results.

- **Records.** A registration (`schemas/v2/self-hosted-runner-registration.schema.json`) MUST NOT appear in discovery. `dispatchKinds` lists `model`, `tool` or both.
- **Subject isolation.** A host MUST NOT route a step to a runner its run's subject does not own, and MUST match on subject before capability.
- **Credentials.** A runner credential MUST NOT transit the host or appear in any frame, event, result, debug bundle or log. The runner bearer MUST NOT be a provider credential.
- **Untrusted output.** Runner output re-entering an agent loop MUST be fenced as untrusted.
- **At most once.** A frame's `seq` is a per-runner cursor, resumed by `Last-Event-ID`, and MUST NOT be conflated with event `sequence`. The host MUST drop, not re-dispatch, a `{runId, stepId}` already persisted; the runner MUST answer under the pair it received.
- **Liveness.** Dispatch to a departed runner MUST fail with retriable `runner_unavailable`, never hang.
- **Replay and fork.** Replay MUST NOT re-dispatch. A fork MUST NOT pin later dispatch to the original `runnerId`.

## `subWorkflow`

`core.subWorkflow` starts a child run of another workflow and waits for its terminal status.

- **`workflowId`.** A host MUST refuse the parent run when that workflow is not loaded.
- **`waitForCompletion`** defaults to `true`; a host MAY refuse `false` with `validation_error`.
- **`onChildFailure`.** `fail-parent` (default) fails the node and the run; `absorb` records the failure and continues.
- **Output.** `node.completed` MUST carry `outputs.childRunId` and `outputs.childStatus` (`completed | failed | cancelled`), and MAY add fields.
- **`inputMapping`** (`childVar → parentVar`) seeds the child once, at creation, after and over its `variables[].defaultValue`, which MUST seed first. An unset parent variable MUST arrive undefined, never an error or `null`. A host not advertising `subWorkflow.inputMapping` MUST refuse a non-empty `inputMapping` at registration with `validation_error`, naming it in `details.requiredCapability`.
- **`outputMapping`** (`parentVar → childVar`). After the child completes, the host MUST copy each mapped variable into the parent, without throwing on or copying an undefined one.
- **`propagateCancellation`** (default `true`) cancels the child with its parent.

## `multiAgent`

`multiAgent.executionModel.version` is cumulative: a host advertising `N` MUST implement levels 1 through `N`.

| Level | Adds |
| --- | --- |
| 1 | the supervisor loop and worker handoff |
| 2 | confidence escalation; memory across sub-runs |
| 3 | cross-host causation |
| 4 | replay determinism under nondeterministic models |
| 5 | stateful loop lifecycle and context budget |
| 6 | verifier turn and convergence |

At level 1, a workflow whose `core.orchestrator.supervisor` feeds `core.dispatch` runs this loop:

- Each turn records one decision as `runOrchestrator.decided`. `terminate` completes the run; `clarify` and `escalate` suspend on a `clarification` or `approval` interrupt; `next-worker` dispatches each of `nextWorkerIds[]` as a child run, and the next turn waits for all of them.
- The loop MUST be re-entrant: replay from any iteration MUST reproduce its state.
- A worker moves `pending → dispatching → running → harvested`, or ends `failed` or `cancelled`. Each transition that occurs MUST emit `core.workflowChain.event` whose `causationId` names the prior transition, first `runOrchestrator.decided`. A host MUST NOT synthesize a phase it never produces.
- `output.harvested` fires exactly when a child completes with a non-empty `outputMapping`.
- A host not advertising `executionModel` MUST NOT emit `core.workflowChain.event`.

At level 2:

- A `next-worker` or `terminate` decision whose `confidence` is below the floor (`confidenceEscalationFloor`, else `0.5`) MUST NOT execute silently. The host MUST record `core.workflowChain.confidence-escalated`, then fire a `clarification` interrupt (preferred) or an `approval` interrupt, both before any `dispatch.began` for that decision. An absent `confidence` MUST NOT trigger escalation.
- With `memory` also advertised, a child of `core.dispatch` or `core.subWorkflow` MUST keep memory scoped per `(tenantId, scopeId)` ([host-services.md](host-services.md)). When it shares its parent's scope, its writes are visible to the parent from its completion and on later supervisor turns, and an entry's `ttl` MUST run from the child's write time.
- The host MUST serialize sibling children's writes to the shared scope per parent run, unless it advertises `crossChildMemoryConcurrency: "advisory"`, and then SHOULD document last-write-wins.
- The host MUST persist memory snapshots by log index: before `fromSeq`, a fork's memory reads MUST return the source run's memory as of `fromSeq`, or the fork is refused ([replay.md](replay.md)).

At level 3, with `crossHostCausation` advertised:

- An event whose `causationId` names an event on another host MUST carry `causationHostId`, equal to that host's `crossHostCausation.hostId`; a same-host one MUST NOT.
- The host MUST propagate the run's trace context into every outbound MCP request and A2A message, and adopt an inbound one, per [interop.md](interop.md).
- Under `ancestryEndpointSupported` the host MUST serve `getRunAncestry` ([runs.md](runs.md)); otherwise it returns `404` and clients walk `causationHostId`.

At level 4, every LLM-calling node MUST meet [replay.md](replay.md)'s invocation key, refusal-divergence and observable-result rules.

At level 5:

- Every `runOrchestrator.decided` MUST carry `iteration`, 1-based and incremented by exactly 1 per turn; `maxLoopIterations` bounds it ([runs.md](runs.md)).
- Turn *i*'s inputs MUST be reproducible on replay: memory as of its log index, the workspace snapshot when `workspace` is advertised, and the log tail bounded by `transcriptWindow`. A turn's writes MUST become visible to turn *i+1*, never to turn *i*.
- Under `statefulResume`, a resumed loop MUST continue at the same `iteration` with the same snapshot lineage. A heartbeat MAY enqueue a fresh loop run and MUST NOT advance a suspended one.
- `contextBudget` bounds that transcript in tokens, under the rules in its `schemas/v2/capabilities.schema.json` descriptions and on `context.summarized`. A replay MUST reuse a recorded summary, never re-summarize.

At level 6, with `verifier` advertised:

- A critic MUST emit content-free `agent.verified` over a prior result: an `agent.decided` event, a child run or a tool call.
- Under `verifier.gating`, a `fail` MUST NOT be merged or `terminate` as success, and a `revise` SHOULD route back to an actor turn within `maxLoopIterations`. A missing verdict is not a failure. Without `gating`, verdicts are observational.
- A consumer MUST NOT treat a `terminate` whose `successCriteria` has a `met: false` entry as goal-satisfied.

*Sources: RFCs 0007, 0022, 0037, 0039, 0040, 0041, 0061, 0090, 0111, 0122.*

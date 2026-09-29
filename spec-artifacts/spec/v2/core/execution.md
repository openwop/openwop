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
- **Parent link.** The child's `getRunAncestry` `parent` MUST be the parent run, with `cause: "core.subWorkflow"`. It does not name the dispatching node; that node's `node.completed` carries `outputs.childRunId`. `parentRunId` is fork lineage, not this link.

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

Levels 2–6 are not yet restated in v2 prose. Their rules are those of their owning RFCs: level 2 [RFC 0039](https://github.com/openwop/openwop/blob/main/RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md), level 3 [RFC 0040](https://github.com/openwop/openwop/blob/main/RFCS/0040-multi-agent-cross-host-causation.md), level 4 [RFC 0041](https://github.com/openwop/openwop/blob/main/RFCS/0041-multi-agent-replay-under-nondeterminism.md), level 5 [RFC 0061](https://github.com/openwop/openwop/blob/main/RFCS/0061-agent-loop-lifecycle.md) and [RFC 0111](https://github.com/openwop/openwop/blob/main/RFCS/0111-context-economy.md), level 6 [RFC 0090](https://github.com/openwop/openwop/blob/main/RFCS/0090-agent-verifier-and-convergence.md).


At level 1, a workflow whose `core.orchestrator.supervisor` feeds `core.dispatch` runs this loop:

- Each turn records one decision as `runOrchestrator.decided`. `terminate` completes the run; `clarify` and `escalate` suspend on a `clarification` or `approval` interrupt; `next-worker` dispatches each of `nextWorkerIds[]` as a child run, and the next turn waits for all of them.
- The loop MUST be re-entrant: replay from any iteration MUST reproduce its state.
- A worker moves `pending → dispatching → running → harvested`, or ends `failed` or `cancelled`. Each transition that occurs MUST emit `core.workflowChain.event` whose `causationId` names the prior transition, first `runOrchestrator.decided`. A host MUST NOT synthesize a phase it never produces.
- `output.harvested` fires exactly when a child completes with a non-empty `outputMapping`.
- A host not advertising `executionModel` MUST NOT emit `core.workflowChain.event`.

*Sources: RFCs 0007, 0022, 0037, 0122.*

# OpenWOP ↔ Serverless Workflow + BPMN

> STD-5 from `plans/openwop-protocol-gap-closure-plan.md`. Non-normative implementation guidance for adopters bridging OpenWOP to / from CNCF Serverless Workflow and OMG BPMN. Honest about what round-trips and what stays host-specific.

OpenWOP composes with workflow standards rather than replacing them — see [`spec/v1/positioning.md`](../../spec/v1/positioning.md) §"Standards composition matrix" for the broader stance. This page is the operational mapping for the two big enterprise workflow standards.

**Bottom line.** OpenWOP can export its workflow definitions into Serverless Workflow and BPMN representations, and can import a constrained subset of each. Round-trip fidelity is limited where AI / HITL semantics don't have clean analogues in either source standard. We document the gaps explicitly so adopters don't overpromise interoperability.

---

## OpenWOP → Serverless Workflow (CNCF Serverless Workflow Specification)

[Serverless Workflow](https://serverlessworkflow.io/) is a CNCF-graduated DSL for declarative workflow definitions, with implementations in OpenAPI-described servers (e.g., SonataFlow, Synapse).

### What maps cleanly

| OpenWOP                        | Serverless Workflow                                          | Notes                                                |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| `WorkflowDefinition`           | `Workflow` document                                          | Both are JSON-shaped declarative DAGs.               |
| `WorkflowNode` with `typeId`   | `OperationState` action                                      | OpenWOP's typeId becomes the action's `functionRef`. |
| `WorkflowEdge` (source/target) | State transitions                                            | One transition per outbound edge.                    |
| `core.subWorkflow` node        | `CallbackState` or `OperationState` with `subFlowRef`        | Both standards support sub-workflow invocation.      |
| `core.delay` node              | `SleepState`                                                 | Both support time-driven waits.                      |
| `core.approvalGate` interrupt  | `CallbackState` with `eventRef`                              | The callback completes the interrupt.                |
| Run inputs / outputs           | Workflow data input + data output                            | Both are JSON-typed.                                 |
| Idempotency-Key                | Workflow `id` per Serverless Workflow §"Workflow Definition" | Both standards' run identifiers serve the same role. |

### What does NOT map

| OpenWOP feature                                                        | Why no Serverless Workflow analogue                                                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `core.orchestrator.supervisor` + `core.dispatch` (RFC 0006/0007)       | Serverless Workflow has no concept of an LLM orchestrator emitting typed decisions with confidence scores + escalation thresholds. |
| `agent.reasoned` + `agent.toolCalled` + reasoning verbosity governance | No agent-event vocabulary in Serverless Workflow.                                                                                  |
| `RunOptions.configurable.reasoningVerbosity`                           | No reasoning-tier governance.                                                                                                      |
| `AgentRef` + `agentMemory` (RFC 0002/0004)                             | No agent-identity primitive.                                                                                                       |
| BYOK secret resolution (`credentialRef` + 4-mode policy)               | Serverless Workflow has `auth` definitions but not the BYOK + 4-mode policy enforcement model.                                     |
| Signed audit log with Ed25519 checkpoints                              | Not in Serverless Workflow's surface.                                                                                              |
| Memory compaction events (RFC 0012)                                    | No analogue.                                                                                                                       |

### Recommended export shape

OpenWOP → Serverless Workflow is a **lossy projection**. The recommended pattern:

1. Drop or shim agent-specific nodes (`core.orchestrator.supervisor` etc.) — emit a `functionRef` with a vendor-prefixed name (e.g., `vendor.openwop.orchestrator.supervisor`) that Serverless Workflow runtimes can't natively execute but preserves the OpenWOP shape for round-trip back.
2. Map OpenWOP interrupts to `CallbackState` + `eventRef`; record the interrupt token in the callback's `data` filter.
3. Carry OpenWOP-specific metadata (capability requirements, agent refs, reasoning settings) under the Serverless Workflow `metadata` block with `openwop.*` keys.
4. Document the projection's lossy fields in the workflow's `description` so consumers know what's lost.

### Recommended import shape

Serverless Workflow → OpenWOP is **mostly clean** for the subset OpenWOP supports:

1. Map each `OperationState.action` to an OpenWOP `WorkflowNode` with `typeId: 'core.openwop.<action>'` (or a vendor namespace if the action doesn't have a `core.openwop.*` analogue).
2. Map transitions to edges.
3. `SleepState` → `core.delay`.
4. `CallbackState` → `core.approvalGate` (or `core.clarificationGate` if a typed input shape is declared).
5. `SwitchState` → multi-edge fan-out with `condition` expressions.
6. Reject (with a clear error) any state type OpenWOP doesn't support — don't fake it.

---

## OpenWOP ↔ BPMN (OMG BPMN 2.0)

[BPMN 2.0](https://www.omg.org/spec/BPMN/2.0/) is the enterprise-process-modeling standard. The notation is XML-serialized; tooling is widely available (Camunda, Activiti, Flowable, jBPM).

### What maps cleanly

| OpenWOP                            | BPMN                                             | Notes                                                                              |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `WorkflowDefinition`               | `<process>` element                              | Both are declarative DAGs with named tasks + transitions.                          |
| Service-task-shaped `WorkflowNode` | `<serviceTask>`                                  | OpenWOP typeId becomes the service task's `implementation` or extension attribute. |
| `WorkflowEdge`                     | `<sequenceFlow>`                                 | One sequence flow per edge.                                                        |
| `core.subWorkflow`                 | `<callActivity>`                                 | Both standards support sub-process invocation.                                     |
| `core.delay`                       | `<intermediateCatchEvent><timerEventDefinition>` | Time-based catch event.                                                            |
| `core.approvalGate`                | `<userTask>`                                     | Both model HITL approval.                                                          |
| `core.clarificationGate`           | `<userTask>` with typed data                     | BPMN's user-task data inputs cover the typed-input case.                           |
| Run start                          | `<startEvent>`                                   | One per workflow.                                                                  |
| Run completion                     | `<endEvent>`                                     | Multiple acceptable.                                                               |

### What does NOT map

The same set as Serverless Workflow plus:

| OpenWOP feature                                                   | Why no BPMN analogue                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Replay / fork (`POST /v1/runs/{id}:fork`)                         | BPMN has no run-replay primitive — re-execution is engine-specific.                             |
| Suspend tokens + signed callbacks (`POST /v1/interrupts/{token}`) | BPMN's message-event correlation is similar but lacks signed-token replay-resistance semantics. |
| Strict event-log + canonical event-type vocabulary                | BPMN engines emit vendor-specific audit trails; no shared event vocabulary.                     |
| Stream modes (`values` / `updates` / `messages` / `debug`)        | BPMN's runtime observation surface is engine-specific.                                          |

### Recommended export shape

OpenWOP → BPMN is **best-effort visualization**:

1. Map service-task-shaped nodes to `<serviceTask>`; map approval gates to `<userTask>`; map sub-workflows to `<callActivity>`.
2. Use BPMN extension attributes (`<extensionElements>` with `openwop:*` namespace) to carry OpenWOP-specific fields the modeler doesn't understand.
3. Document that the exported BPMN is **diagrammatic only** — re-importing the BPMN into a different engine won't reproduce OpenWOP run semantics.
4. Don't include OpenWOP-specific runtime behavior (replay, signed tokens, audit-log integrity) in the BPMN export — those live above the model layer.

### Recommended import shape

BPMN → OpenWOP is **constrained subset**. Accept:

- `<serviceTask>` with a recognizable `implementation` value or `openwop:typeId` extension.
- `<userTask>` → `core.approvalGate`.
- `<callActivity>` → `core.subWorkflow`.
- `<intermediateCatchEvent><timerEventDefinition>` → `core.delay`.
- `<exclusiveGateway>` / `<parallelGateway>` → multi-edge fan-out (exclusive uses edge conditions).

Reject (with a clear error) BPMN constructs OpenWOP doesn't support:

- `<eventSubProcess>` (interrupt boundaries don't map).
- `<businessRuleTask>` (rule engines are not in scope).
- Pools / lanes (multi-actor process modeling is out of scope; OpenWOP runs are single-actor + HITL).
- Compensation events (OpenWOP's reverse-of-an-event is out of scope per v1).

---

## When NOT to use either standard

If your application is **AI / HITL-native** (multi-agent orchestration, reasoning-event observability, BYOK redaction, signed audit log), neither Serverless Workflow nor BPMN was designed for your workload. Use OpenWOP directly; export to BPMN only for diagrammatic communication with enterprise stakeholders.

If your application is **already on Serverless Workflow or BPMN** and you want to add AI / HITL features, treat OpenWOP as a complementary surface: keep your existing workflow engine for the non-AI workflows; deploy an OpenWOP host alongside for the AI-native subset; bridge them via `core.subWorkflow` (OpenWOP dispatches to your existing engine's run) or `core.http.request` (your existing engine calls OpenWOP REST).

---

## Non-normative gate

This document is **non-normative**. Promote to a normative profile when:

1. An OpenWOP host ships a Serverless Workflow exporter AND an importer AND a roundtrip test fixture.
2. An adopter independently produces the same mapping (BPMN tooling or Serverless Workflow tooling) using this doc as input.
3. The lossy boundaries (agent semantics, reasoning events, audit-log integrity) survive a real cross-tool roundtrip without silent corruption.

Until then, this doc captures the intended shape so adopters don't fragment on per-host conventions.

---

## See also

- [`spec/v1/positioning.md`](../../spec/v1/positioning.md) §"Standards composition matrix" — broader stance.
- [`docs/integrations/durable-runtimes.md`](./durable-runtimes.md) — implementation guide for OpenWOP on Temporal / Restate / DBOS / Inngest.
- [`spec/v1/cloudevents-mapping.md`](../../spec/v1/cloudevents-mapping.md) — CloudEvents export mapping (STD-2).
- [Serverless Workflow Specification](https://github.com/serverlessworkflow/specification)
- [BPMN 2.0 OMG Specification](https://www.omg.org/spec/BPMN/2.0/)

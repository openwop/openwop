# OpenWOP Conformance Suite — Fixture Workflow Contract

> **Status: FINAL v1 (2026-05-10).** Defines the standardized fixture workflows every OpenWOP-compliant server MUST seed before the conformance suite can exercise run-lifecycle, idempotency, stream-mode, interrupt, and replay scenarios. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `../spec/v1/auth.md`.

---

## Why this exists

Run-lifecycle conformance tests need a stable target — a workflow whose `workflowId`, expected events, and terminal status are agreed in advance. Without this, every implementation defines its own test workflows and the conformance suite can't run cross-implementation.

This document defines a small set of fixture workflows whose canonical definitions live alongside the conformance suite (`fixtures/*.json`). An OpenWOP-compliant server MUST seed these fixtures into its workflow store before running the conformance suite against itself.

---

## Seeding contract

An OpenWOP-compliant server MUST:

1. Accept the canonical JSON fixture definitions in `fixtures/*.json` verbatim (they validate against `../schemas/workflow-definition.schema.json`).
2. Persist each fixture under its declared `id` so that subsequent `GET /v1/workflows/{id}` returns the seeded definition.
3. Treat seeding as idempotent — running the seeder repeatedly MUST NOT produce duplicate runs, error states, or version drift.
4. Expose the seeded fixtures to runs created with the conformance suite's API key.

How a server seeds is implementation-specific. Servers MAY:

- Auto-seed at startup when `OPENWOP_CONFORMANCE_SEED=true` env var is set.
- Provide a CLI command (e.g., `openwop-server seed --conformance`).
- Document a manual upload procedure.

Servers MUST NOT require fixtures to be re-uploaded on every conformance run — the suite assumes they are already present.

---

## Fixture catalog

All fixtures MUST advertise:

- **`workflowId`** — exact string clients use to start runs
- **Trigger** — must be `manual` so the conformance suite can call `POST /v1/runs` without channel-specific setup
- **Inputs** — schema declared via `variables[]`
- **Expected behavior** — terminal status, expected event types, timing bounds

| Fixture                                   | `workflowId`                                                                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Terminal status                                                                     | Bounded duration             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| Noop                                      | `conformance-noop`                                                                              | Cheapest possible run-lifecycle test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `completed`                                                                         | ≤ 5s                         |
| Identity                                  | `conformance-identity`                                                                          | Verifies input/output passthrough                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `completed`                                                                         | ≤ 5s                         |
| Delay                                     | `conformance-delay`                                                                             | Verifies poll/SSE behavior over time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `completed`                                                                         | ≤ 30s (input-controlled)     |
| Failure                                   | `conformance-failure`                                                                           | Verifies error-event surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `failed`                                                                            | ≤ 5s                         |
| Approval                                  | `conformance-approval`                                                                          | Verifies HITL approval interrupt + resume                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `completed` after resolve                                                           | unbounded (suspends)         |
| Clarification                             | `conformance-clarification`                                                                     | Verifies HITL clarification interrupt + resume                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `completed` after resolve                                                           | unbounded (suspends)         |
| Multi-node                                | `conformance-multi-node`                                                                        | Verifies edge ordering + per-node events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `completed`                                                                         | ≤ 10s                        |
| Idempotent                                | `conformance-idempotent`                                                                        | Verifies `Idempotency-Key` cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `completed`                                                                         | ≤ 5s                         |
| Cancellable                               | `conformance-cancellable`                                                                       | Verifies `:cancel` endpoint mid-run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `cancelled` after cancel                                                            | ≤ 60s (input-controlled)     |
| Capability Missing                        | `conformance-capability-missing`                                                                | Verifies dispatch refusal on unsatisfied `requires`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `failed` (`error.code='capability_not_provided'`)                                   | ≤ 5s                         |
| Prompt End-to-End                         | `conformance-prompt-end-to-end`                                                                 | RFC 0027 + RFC 0029 end-to-end. Single `mock-ai` node with `config.systemPromptRef` set; host MUST emit `agent.promptResolved` + `prompt.composed` events during dispatch, then complete. Capability-gated on `capabilities.prompts.supported`.                                                                                                                                                                                                                                                                                                                                                                                                           | `completed`                                                                         | ≤ 10s                        |
| Prompt All Four Kinds                     | `conformance-prompt-all-four-kinds`                                                             | RFC 0027 §A four-kind dispatch coverage with a MULTI-ENTRY `fewShotPromptRefs[]` array. Single `mock-ai` node with one ref per singular-kind slot (`systemPromptRef`, `userPromptRef`, `schemaHintPromptRef`) + two distinct templateIds in `fewShotPromptRefs[]`; host MUST emit 5 `agent.promptResolved` events (one per slot) AND 5 `prompt.composed` events. Multi-entry few-shot is the regression pin for `fewShotPromptRefs[slotIndex]` per-index resolution — a host that hard-codes `[0]` would emit the same template twice in the few-shot events and fail the per-templateId assertion. Capability-gated on `capabilities.prompts.supported`. | `completed`                                                                         | ≤ 10s                        |
| Dispatch Loop                             | `conformance-dispatch-loop`                                                                     | Verifies `core.dispatch` loop mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `completed`                                                                         | ≤ 30s                        |
| Interrupt — Quorum                        | `conformance-interrupt-quorum`                                                                  | Verifies `openwop-interrupt-quorum` profile (multi-approver, majority rejection)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `completed` after 3 accepts, `failed` after quorum reject                           | unbounded (suspends)         |
| Interrupt — External Event                | `conformance-interrupt-external-event`                                                          | Verifies `openwop-interrupt-external-event` profile (correlation-matched callback)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `completed` after matching POST, `failed` on timeout                                | ≤ 60s (timeoutMs configured) |
| Interrupt — Auth Required                 | `conformance-interrupt-auth-required`                                                           | Verifies `openwop-interrupt-auth-required` profile (bearer-token resume only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `completed` after bearer resolve                                                    | unbounded (suspends)         |
| Interrupt — Parent/Child Cancel           | `conformance-interrupt-parent-child-cancel` + `conformance-interrupt-parent-child-cancel-child` | Verifies `openwop-interrupt-parent-child` cancel cascade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `cancelled` (both runs)                                                             | ≤ 30s                        |
| Agent Identity                            | `conformance-agent-identity`                                                                    | Phase 1 — `RunSnapshot.agent` / `runOrchestrator` AgentRef wire-shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `completed`                                                                         | ≤ 10s                        |
| Agent Reasoning                           | `conformance-agent-reasoning`                                                                   | Phase 1 / RFC 0023 — `agent.*` event family emission + `callId` pairing on `core.conformance.mock-agent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `completed`                                                                         | ≤ 15s                        |
| Agent Reasoning Streaming                 | `conformance-agent-reasoning-streaming`                                                         | RFC 0024 — `core.conformance.mock-agent` with `mockReasoning.streamChunks` drives incremental `agent.reasoning.delta` events (sequence 0..N-1) followed by exactly one closing `agent.reasoned` whose `reasoning` equals the concatenation. Gated on `capabilities.agents.reasoning.streaming: true`.                                                                                                                                                                                                                                                                                                                                                     | `completed`                                                                         | ≤ 15s                        |
| Agent Low-Confidence                      | `conformance-agent-low-confidence`                                                              | Phase 1 / CP-1 / RFC 0023 — `core.conformance.mock-agent` emits `agent.decided` with confidence < threshold; host MUST follow with `node.suspended { reason: 'low-confidence' }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `waiting-approval` (suspends)                                                       | unbounded (suspends)         |
| Message Reducer                           | `conformance-message-reducer`                                                                   | Phase 1 — `message` reducer idempotency on duplicate `messageId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `completed`                                                                         | ≤ 10s                        |
| Agent Pack Install                        | `conformance-agent-pack-install`                                                                | Phase 2 — pack `agents[]` surface as AgentManifest at `GET /v1/packs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `completed`                                                                         | ≤ 5s                         |
| Agent Pack Export                         | `conformance-agent-pack-export`                                                                 | Phase 2 — workspace agents project to AgentManifest at `GET /v1/packs/export`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `completed`                                                                         | ≤ 5s                         |
| Agent Pack Provenance                     | `conformance-agent-pack-provenance`                                                             | Phase 2 — `sourceManifestId` provenance round-trip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `completed`                                                                         | ≤ 10s                        |
| Agent Pack Handoff Schema Validation      | `conformance-agent-pack-handoff-schema-validation`                                              | Phase 2 / HV-1 — host validates dispatch payloads against `handoff.taskSchemaRef` AND return payloads against `handoff.returnSchemaRef` per RFC 0003 §D. Three branches: valid-task → `completed`; invalid-task → `failed` with structured violation; mock-return-violation → violation surfaced before persistence.                                                                                                                                                                                                                                                                                                                                      | varies by scenario                                                                  | ≤ 5s                         |
| Dispatch Input Mapping                    | `conformance-dispatch-input-mapping`                                                            | RFC 0022 §A / HVMAP-1a — host honors `inputMapping` on `core.dispatch`. Capability-gated on `capabilities.agents.dispatchMapping`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `completed`                                                                         | ≤ 5s                         |
| Dispatch Output Mapping                   | `conformance-dispatch-output-mapping`                                                           | RFC 0022 §A / HVMAP-1b — host harvests child variables via `outputMapping` on `core.dispatch`. Capability-gated on `capabilities.agents.dispatchMapping`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `completed`                                                                         | ≤ 5s                         |
| Dispatch Cross-Worker Handoff             | `conformance-dispatch-cross-worker-handoff`                                                     | RFC 0022 §A / HVMAP-1c — sequential fan-out: child-a writes via `perWorkerOutputMappings`, child-b reads via `perWorkerInputMappings`. Capability-gated on `capabilities.agents.dispatchMapping`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `completed`                                                                         | ≤ 10s                        |
| subWorkflow Input Mapping                 | `conformance-subworkflow-input-mapping`                                                         | RFC 0022 §B / HVMAP-2 — host honors `inputMapping` on `core.subWorkflow`; overrides matching `defaultValue` declarations on the child. Capability-gated on `capabilities.subWorkflow.inputMapping`.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `completed`                                                                         | ≤ 10s                        |
| subWorkflow Input Mapping (child)         | `conformance-subworkflow-input-mapping-child`                                                   | RFC 0022 §B / HVMAP-2 — child workflow for the input-mapping scenario. Declares `receivedPrdId.defaultValue='baked-in'`; parent's `inputMapping` MUST override that default. Single noop node; final variables read via `GET /v1/runs/{runId}` for the assertion.                                                                                                                                                                                                                                                                                                                                                                                         | `completed`                                                                         | ≤ 5s                         |
| Dispatch Input Mapping (child)            | `conformance-dispatch-input-mapping-child`                                                      | RFC 0022 §A / HVMAP-1a — child workflow for the dispatch input-mapping scenario. Single noop node; the scenario reads this child's `inputs_json` via `GET /v1/runs/{childRunId}` and asserts `inputs.childGreeting === 'Alice'`.                                                                                                                                                                                                                                                                                                                                                                                                                          | `completed`                                                                         | ≤ 5s                         |
| Dispatch Output Mapping (child)           | `conformance-dispatch-output-mapping-child`                                                     | RFC 0022 §A / HVMAP-1b — child workflow for the dispatch output-mapping scenario. Declares `childOutcome.defaultValue='done'`; on terminal, parent's `outputMapping` harvests `childOutcome → parentResult`.                                                                                                                                                                                                                                                                                                                                                                                                                                              | `completed`                                                                         | ≤ 5s                         |
| Dispatch Cross-Worker Handoff (child-a)   | `conformance-dispatch-cross-worker-handoff-child-a`                                             | RFC 0022 §A / HVMAP-1c — first child of the cross-worker-handoff scenario. Declares `output.defaultValue='hello'`; on terminal, parent's `perWorkerOutputMappings.child-a` harvests `output → sharedVar`.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `completed`                                                                         | ≤ 5s                         |
| Dispatch Cross-Worker Handoff (child-b)   | `conformance-dispatch-cross-worker-handoff-child-b`                                             | RFC 0022 §A + §D / HVMAP-1c — second child of the cross-worker-handoff scenario. Sequential fan-out — runs after child-a; receives parent's `sharedVar` via `perWorkerInputMappings.child-b` onto its `input` input. Scenario reads child-b's `inputs_json` to assert `inputs.input === 'hello'`.                                                                                                                                                                                                                                                                                                                                                         | `completed`                                                                         | ≤ 5s                         |
| Dispatch Input Mapping — unset variant    | `conformance-dispatch-input-mapping-no-default`                                                 | RFC 0022 §A / HVMAP-1a-null — parent variant that DECLARES `parentName` but OMITS its `defaultValue`. The dispatch's `inputMapping` projects an unset parent variable; per §A normative bullet, child `inputs.childGreeting` MUST surface as `undefined` (NOT `null`, NOT omitted). Reuses `conformance-dispatch-input-mapping-child`.                                                                                                                                                                                                                                                                                                                    | `completed`                                                                         | ≤ 30s                        |
| subWorkflow Input Mapping — unset variant | `conformance-subworkflow-input-mapping-no-default`                                              | RFC 0022 §B / HVMAP-2-unset — parent variant that DECLARES `currentPrdId` but OMITS its `defaultValue`. Per §B, the unset projection MUST surface as `undefined` (NOT `null`) — distinct from the child's own `defaultValue` fold. Reuses `conformance-subworkflow-input-mapping-child`.                                                                                                                                                                                                                                                                                                                                                                  | `completed`                                                                         | ≤ 10s                        |
| subWorkflow Mid-Run Mutation (parent)     | `conformance-subworkflow-mid-run-mutation`                                                      | RFC 0022 §B / HVMAP-2-no-midrun-propagation — `inputMapping` is a one-shot fold at child-dispatch time. Parent declares `currentPrdId='seeded-id'`, dispatches child with `inputMapping`, then test mutates the parent variable via `POST /v1/host/sample/test/runs/:parentRunId/variables` WHILE the child is suspended. The child's `receivedPrdId` MUST remain at the dispatch-time fold (`seeded-id`), proving mid-run parent mutations do NOT propagate.                                                                                                                                                                                             | `completed`                                                                         | ≤ 30s                        |
| subWorkflow Mid-Run Mutation (child)      | `conformance-subworkflow-mid-run-mutation-child`                                                | RFC 0022 §B / HVMAP-2-no-midrun-propagation — child workflow with a `core.approvalGate` that suspends so the parent can mutate its variable bag mid-run. Declares `receivedPrdId.defaultValue='baked-in'` (overridden at dispatch by inputMapping).                                                                                                                                                                                                                                                                                                                                                                                                       | `completed`                                                                         | ≤ 30s                        |
| Dispatch Per-Worker Mapping Override      | `conformance-dispatch-per-worker-override`                                                      | RFC 0022 §A / HVMAP-1c-override — parent with BOTH a default `inputMapping` (`{ input: 'defaultX' }`) AND `perWorkerInputMappings.child-b: { input: 'sharedVar' }`. Verifies `effectiveInputMapping` precedence per §A: child-a receives the default, child-b receives the override. Reuses `conformance-dispatch-cross-worker-handoff-child-a` + `-child-b`.                                                                                                                                                                                                                                                                                             | `completed`                                                                         | ≤ 30s                        |
| Dispatch deterministic-fail child         | `conformance-dispatch-deterministic-fail-child`                                                 | RFC 0022 §B / HVMAP-1b-failed — child workflow that ALWAYS terminates `failed` via `core.fail`. Used by `conformance-dispatch-output-mapping` to verify the parent's `outputMapping` is SKIPPED when the child fails terminally.                                                                                                                                                                                                                                                                                                                                                                                                                          | `failed`                                                                            | ≤ 5s                         |
| Dispatch cancellable child                | `conformance-dispatch-cancellable-child`                                                        | RFC 0022 §B / HVMAP-1b-cancelled — child workflow with a long `core.delay` so the test cancels it externally via `POST /v1/runs/{childRunId}/cancel`. Verifies the parent's `outputMapping` is SKIPPED when the child terminates `cancelled`.                                                                                                                                                                                                                                                                                                                                                                                                             | `cancelled`                                                                         | ≤ 60s                        |
| Multi-Agent Handoff (parent)              | `conformance-multi-agent-handoff`                                                               | RFC 0037 (`version: 1`) — exercises the planner→worker handoff state machine. Supervisor decides one `next-worker`, dispatch spawns the child, harvests outputMapping. Conformance reads the event log for the 4 `core.workflowChain.event` transition records in causation-chained order (`dispatch.began → dispatch.succeeded → child.completed → output.harvested`). Capability-gated on `capabilities.multiAgent.executionModel.supported`.                                                                                                                                                                                                           | `completed`                                                                         | ≤ 30s                        |
| Multi-Agent Handoff (child)               | `conformance-multi-agent-handoff-child`                                                         | RFC 0037 (`version: 1`) — child for `conformance-multi-agent-handoff`. Declares `childOutcome.defaultValue='handoff-complete'`; the parent's outputMapping harvests it onto `parentResult`, triggering the `output.harvested` transition event.                                                                                                                                                                                                                                                                                                                                                                                                           | `completed`                                                                         | ≤ 5s                         |
| Multi-Agent Confidence Escalation         | `conformance-multi-agent-confidence-escalation`                                                 | RFC 0039 §A (`version: 2`) — exercises the confidence-floor escalation contract. Supervisor's `mockDispatchPlan` carries ONE decision with `confidence: 0.3` (below the 0.5 spec floor). The host MUST emit `core.workflowChain.confidence-escalated` AND suspend with a clarification interrupt BEFORE any dispatch.began fires; conformance asserts zero `core.workflowChain.event` records (no dispatch). Capability-gated on `capabilities.multiAgent.executionModel.version >= 2`.                                                                                                                                                                   | `waiting-clarification`                                                             | ≤ 30s                        |
| Agent Memory Round-Trip                   | `conformance-agent-memory-roundtrip`                                                            | Phase 3 — `MemoryAdapter.list/get` write → read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `completed`                                                                         | ≤ 15s                        |
| Agent Memory Cross-Tenant                 | `conformance-agent-memory-cross-tenant`                                                         | Phase 3 / CTI-1 — cross-tenant probe MUST return `[]` / `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `completed`                                                                         | ≤ 10s                        |
| Agent Memory Redaction                    | `conformance-agent-memory-redaction`                                                            | Phase 3 / SR-1 — BYOK plaintext surfaces as `[REDACTED:<id>]` on read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `completed`                                                                         | ≤ 15s                        |
| Agent Memory TTL                          | `conformance-agent-memory-ttl`                                                                  | Phase 3 — `expiresAt` excludes expired entries from list/get                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `completed`                                                                         | ≤ 10s                        |
| Agent Memory Injection Budget             | `conformance-agent-memory-injection-budget`                                                     | RFC 0113 — token-budgeted `MemoryAdapter.list` (`tokenBudget`/`rank`/`query`): cumulative tokens ≤ budget, over-budget single entry omitted, SR-1 + CTI-1 re-asserted on the budgeted path; `rank:'relevance'` delegates to `memory.search` semantic                                                                                                                                                                                                                                                                                                                                                                                                       | `completed`                                                                         | ≤ 15s                        |
| Context-Budget Multi-Turn                 | `conformance-context-budget-multiturn`                                                          | RFC 0111 — multi-iteration `core.orchestrator.supervisor` loop whose per-turn transcript grows; a host bounding it exposes `{ tokenCounter, tokenCount, eventIds, summarizedRanges }` via the `GET /v1/host/sample/agent/transcript-window` seam (`tokenCount ≤ transcriptTokenBudget`, internally consistent, keepLastTurns verbatim); the summarization leg replays and asserts `context.summarized` → `summaryRef` reuse. Reference hosts that do not advertise `contextBudget` soft-skip                                                                                                                                              | `completed`                                                                         | ≤ 60s                        |
| Conversation Lifecycle                    | `conformance-conversation-lifecycle`                                                            | Phase 4 — open → exchange → close event ordering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `completed`                                                                         | ≤ 20s                        |
| Conversation vs Clarification             | `conformance-conversation-vs-clarification`                                                     | Phase 4 — conversation suspend emits `conversation.*`, NOT `clarification.*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `completed`                                                                         | ≤ 15s                        |
| Conversation Replay                       | `conformance-conversation-replay`                                                               | Phase 4 — `:fork` preserves conversation channel projection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `completed`                                                                         | ≤ 30s                        |
| Conversation Capability Negotiation       | `conformance-conversation-capability-negotiation`                                               | Phase 4 — INVERTED gate: hosts without `conversationPrimitive: true` MUST refuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `failed` / refusal                                                                  | ≤ 5s                         |
| Orchestrator Dispatch                     | `conformance-orchestrator-dispatch`                                                             | Phase 5 — supervisor → `next-worker` → dispatch round-trip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `completed`                                                                         | ≤ 60s                        |
| Orchestrator Terminate                    | `conformance-orchestrator-terminate`                                                            | Phase 5 / CO-3 — terminate decision is final                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `completed`                                                                         | ≤ 30s                        |
| Orchestrator Low-Confidence               | `conformance-orchestrator-low-confidence`                                                       | Phase 5 / CP-1 — supervisor low-confidence suspend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `waiting-approval` (suspends)                                                       | unbounded (suspends)         |
| MCP Tool Roundtrip                        | `conformance-mcp-tool-roundtrip`                                                                | Track 6 — host invokes a tool on the conformance suite's synthetic MCP server; trust-boundary visibility in the event log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `completed`                                                                         | ≤ 30s                        |
| A2A Task Roundtrip                        | `conformance-a2a-task-roundtrip`                                                                | Track 6 — host consumes the conformance suite's synthetic A2A peer; covers drift points #3 (`AUTH_REQUIRED`) and #4 (`REJECTED`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `failed` or `waiting-input` (per `driftScenario` input)                             | ≤ 30s                        |
| WASM Pack Roundtrip                       | `conformance-wasm-pack-roundtrip`                                                               | RFC 0008 — invokes `vendor.openwop.rust-hello.greet` (loaded WASM pack); exercises required exports + at least one import                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `completed`                                                                         | ≤ 10s                        |
| WASM Pack Memory-Cap Breach               | `conformance-wasm-pack-memory-cap-breach`                                                       | RFC 0008 §K — invokes the deliberately-misbehaving `vendor.openwop.misbehaving.memory-bomb` pack (allocates 1 GiB beyond the host's `memoryPagesMax`). Host MUST emit `cap.breached` with `kind: "wasm-memory"` and drive the run to terminal `failed`. Misbehaving pack lives at `openwop-examples:examples/packs/rust-misbehaving-memory/` (repo-qualified per the 2026-06 monorepo split — the `openwop-examples` sibling repo) and is fixture-only (NOT signed for registry publication).                                                                                                                                                             | `failed` (with `cap.breached`)                                                      | ≤ 10s                        |
| Configurable Schema                       | `conformance-configurable-schema`                                                               | Track 13 — workflow declares `configurableSchema` (`additionalProperties: false`, `recursionLimit: integer ≥ 1`). Suite verifies `GET /v1/workflows/{id}` surfaces the schema AND `POST /v1/runs` with a mismatched `configurable` returns `validation_error`.                                                                                                                                                                                                                                                                                                                                                                                            | `completed` (with accepted overlay)                                                 | ≤ 5s                         |
| Smoke — BYOK Roundtrip                    | `openwop-smoke-byok-roundtrip`                                                                  | End-to-end BYOK secret-resolution smoke. Single `conformance.secret.echo` node fetches the host-provisioned canary secret `openwop-conformance-canary-secret`, emits SHA-256 hex + byte length to variables — never the raw value. Spec: `run-options.md` §"Credential references" + `auth.md` §"Secret resolution" + `observability.md` §"Redaction".                                                                                                                                                                                                                                                                                                    | `completed`                                                                         | ≤ 10s                        |
| Smoke — Cost Emit (G6 allowlist)          | `openwop-smoke-cost-emit`                                                                       | End-to-end cost-attribute allowlist smoke (G6 / O4). Single `conformance.cost.emit` node configured with a mix of allowlisted `openwop.cost.*` attributes + one non-allowlisted key + one credential-shaped canary under a non-allowlisted name. Scenario reads the live OTel span (when `OPENWOP_OTEL_COLLECTOR=true`) and asserts the cost-namespace attrs ⊆ `OPENWOP_COST_ATTRIBUTE_NAMES` AND that no canary plaintext leaks. Pairs with the `cost-attribution-allowlist-redaction` SECURITY invariant. Spec: `observability.md §"Cost attribution attributes"`.                                                                                      | `completed`                                                                         | ≤ 10s                        |
| Model Capability Insufficient             | `conformance-model-capability-insufficient`                                                     | RFC 0031 §B step 4 + §D — single `conformance.modelCapability.insufficient` node whose NodeModule declares `requiredModelCapabilities: ['nonexistent-capability-9b3f']`. Executor's gate MUST refuse at dispatch with `error.code = "capability_not_provided"` and emit `model.capability.insufficient` BEFORE `node.failed`. Capability-gated on `capabilities.modelCapabilities.supported: true`.                                                                                                                                                                                                                                                       | `failed` (`error.code='capability_not_provided'`)                                   | ≤ 5s                         |
| Envelope Retry Attempted                  | `conformance-envelope-retry-attempted`                                                          | RFC 0032 §B.1 — single `core.ai.structuredOutput` node calls the conformance mock provider with a pre-seeded `MockProgram[]` (POSTed to `/v1/host/sample/test/mock-ai/program` by nodeId BEFORE run start). Attempt 1 returns invalid JSON; attempt 2 returns a valid envelope. Host's `dispatchStructured()` retry loop MUST emit exactly one `envelope.retry.attempted` event between the two attempts. Pairs with `envelope-retry-attempted.test.ts`. Capability-gated on `capabilities.envelopes.reliability.supported: true` AND `capabilities.testing.mockProviders` advertised.                                                                    | `completed`                                                                         | ≤ 10s                        |
| Envelope Retry Exhausted                  | `conformance-envelope-retry-exhausted`                                                          | RFC 0032 §B.2 + RFC 0033 §C — single `core.ai.structuredOutput` node against the mock provider with a program returning invalid JSON on EVERY attempt. Host MUST exhaust its retry budget and emit exactly one `envelope.retry.exhausted` BEFORE `node.failed`. RunSnapshot.error.code MUST be `envelope_payload_invalid` (schema-violation-exhaustion per RFC 0033 §C).                                                                                                                                                                                                                                                                                  | `failed` (`error.code='envelope_payload_invalid'`)                                  | ≤ 10s                        |
| Envelope Truncated                        | `conformance-envelope-truncated`                                                                | RFC 0032 §B.4 + RFC 0033 §B — single `core.ai.structuredOutput` node against the mock provider with a 2-entry program: attempt 1 returns `stopReason: 'max_tokens'`; attempt 2 returns a valid envelope. Host MUST emit exactly one `envelope.truncated` event and retry with `maxTokens` strictly greater than the initial budget per `truncationBudgetMultiplier`.                                                                                                                                                                                                                                                                                      | `completed` (after truncation-retry succeeds)                                       | ≤ 10s                        |
| Envelope Truncation Cap Exhaustion        | `conformance-envelope-truncation-cap-exhaustion`                                                | RFC 0033 §B + §F DoS-bound assertion — mock provider returns `stopReason: 'max_tokens'` on EVERY attempt. Host MUST emit `envelope.retry.exhausted { finalReason: 'truncation' }`, fail with `error.code: 'envelope_truncation_unrecoverable'`, AND bound the total LLM call count to the advertised `maxRetryAttempts` (no infinite-budget-doubling loop).                                                                                                                                                                                                                                                                                               | `failed` (`error.code='envelope_truncation_unrecoverable'`)                         | ≤ 10s                        |
| Envelope Refusal                          | `conformance-envelope-refusal`                                                                  | RFC 0032 §B.3 + RFC 0033 §D + §F end-to-end refusal — mock provider returns `stopReason: 'safety'` with `refusalText`. Host MUST emit exactly one `envelope.refusal` event, NOT retry (RFC 0033 §D), fail with `error.code: 'envelope_refused_by_provider'`, AND keep refusalText off `RunSnapshot.error.message` (SECURITY invariant `envelope-refusal-no-prompt-leak`).                                                                                                                                                                                                                                                                                 | `failed` (`error.code='envelope_refused_by_provider'`)                              | ≤ 10s                        |
| Envelope Recovery Applied                 | `conformance-envelope-recovery-applied`                                                         | RFC 0032 §B.6 lenient-parse — mock returns a markdown-fenced JSON envelope (`json\\n...\\n`). Host's `dispatchStructured()` lenient-parse fallback (`tryLenientParse()`) strips the fence, emits exactly one `envelope.recovery.applied` with `path: 'markdown-fence'`, and accepts the parsed value WITHOUT counting against the retry budget per RFC 0033 §D.                                                                                                                                                                                                                                                                                           | `completed`                                                                         | ≤ 10s                        |
| Envelope NL-to-Format Engaged             | `conformance-envelope-nl-to-format-engaged`                                                     | RFC 0032 §B.5 NL-to-Format fallback — mock returns natural-language prose on the first 3 attempts (exhausting the retry budget); the host detects the NL shape after exhaustion, emits exactly one `envelope.nlToFormat.engaged { originalEnvelopeType, fallbackCalls: 1 }`, then fires ONE additional dispatch with a corrective coercion fragment. The 4th program entry returns valid JSON; the schema validates; the run terminates `completed`.                                                                                                                                                                                                      | `completed`                                                                         | ≤ 10s                        |
| Phase 4 Replay Divergence                 | `conformance-phase4-replay-divergence`                                                          | RFC 0041 §B — single `core.ai.structuredOutput` node against mock provider. Conformance scenario pre-seeds a 2-entry program via the existing mock-AI program seam: entry [0] returns a valid envelope (original run consumes); entry [1] returns `stopReason: 'safety'` + `refusalText` (`:fork mode: replay` consumes). Phase 4 hosts advertising `multiAgent.executionModel.replayDeterminism.refusalDivergenceEmission: true` MUST emit `replay.divergedAtRefusal` + fail replay with `error.code: 'replay_diverged_at_refusal'`. Silent substitution is non-conformant. Pairs with `replay-divergence-at-refusal.test.ts`.                           | original: `completed`; replay: `failed` (`error.code='replay_diverged_at_refusal'`) | ≤ 10s                        |
| Replay Effect                             | `conformance-replay-effect`                                                                     | RFC 0140 — `core.noop` → `conformance.effect.emit`. The terminal node performs ONE host-observable external side effect, counted at the host's effect seam (`GET /v1/host/sample/replay/effect-count`). `replay-side-effect-suppression.test.ts` runs it, forks `mode:"replay"`, and asserts the count did NOT move. The event log alone cannot witness this: a node that fires and records identically is byte-indistinguishable from one correctly suppressed.                                                                                                                | `completed`                                                                         | ≤ 10s                        |
| Replay Effect Unreached                   | `conformance-replay-effect-unreached`                                                           | RFC 0140 rule 3 — `core.delay` → `conformance.effect.emit`. The suite cancels the run mid-delay so the source terminates with NO recorded outcome for `effect`. Replaying it re-executes the pure delay live (rule 4), reaches `effect`, and MUST fail closed with `replay_source_missing` while firing nothing. Also the non-vacuity pin for the counter: a seam returning a constant reds here.                                                                                                                                                              | source: `cancelled`; replay: `failed` (`node.failed error.code='replay_source_missing'`) | ≤ 60s (input-controlled)     |
| Phase 4 Nondeterministic Tool             | `conformance-phase4-nondet-tool`                                                                | RFC 0041 §C — two-node workflow (`core.noop` proxied as a nondeterministic tool → `core.ai.structuredOutput`). Used by `replay-observable-sequence-determinism.test.ts` to verify that across original + replay runs, the observable `RunEventDoc` sequence prefix is identical up to and including the nondeterministic-tool node's `node.completed` event. The host's replay path MUST replay the original event log entries (rather than re-executing the tool) for nodes whose `core.tool.*` config carries `nondeterministic: true`. Phase 4 hosts advertising `multiAgent.executionModel.replayDeterminism.supported: true` honor this contract.    | original + replay: `completed`; observable prefixes equal up to the nondet boundary | ≤ 10s                        |

The `messages`-mode stream fixture (AI token streaming) is covered by the deterministic mock-provider surface in `spec/v1/run-options.md`. Hosts that do not advertise `Capabilities.testing.mockProviders` skip-equivalent on those scenarios.

---

## Per-fixture contracts

### `conformance-noop`

- **Purpose**: cheapest run-lifecycle test. Used by the conformance suite's `runs.test.ts` to verify create/read/terminal-event/cleanup work end-to-end.
- **Inputs**: none.
- **Expected events** (in order, `updates` mode):
  1. `run.started`
  2. `node.completed` (single node, typeId `core.noop`)
  3. `run.completed`
- **Terminal status**: `completed`.
- **Duration bound**: server MUST reach terminal state within 5s of accepting the run.

### `conformance-identity`

- **Purpose**: verify input → output passthrough.
- **Inputs**:
  - `payload` (object, required) — arbitrary JSON.
- **Expected behavior**: terminal `RunSnapshot.variables.payload` MUST deep-equal the input `payload`.
- **Terminal status**: `completed`.

### `conformance-delay`

- **Purpose**: verify the engine handles in-flight runs (status transitions over time, SSE keep-alives, poll fallback).
- **Inputs**:
  - `delayMs` (integer, required, 0 ≤ value ≤ 30000) — server MUST sleep for this duration before completing.
- **Expected behavior**: `GET /v1/runs/{runId}` MUST return `status: "running"` while the delay is in flight; `status: "completed"` after.
- **Terminal status**: `completed`.

### `conformance-failure`

- **Purpose**: verify the failure path (error event shape, terminal `failed` state).
- **Inputs**: none.
- **Expected events**:
  1. `run.started`
  2. `node.failed`
  3. `run.failed`
- **Terminal `RunSnapshot.error`**: MUST be a `{code, message}` object with both fields as strings.
- **Terminal status**: `failed`.

### `conformance-approval`

- **Purpose**: verify HITL approval interrupt + resume.
- **Inputs**: none.
- **Behavior**:
  1. Run starts and reaches an `approvalGate` node that calls `ctx.interrupt({kind: 'approval', ...})`.
  2. Server emits `interrupt.requested` (and SHOULD also emit `approval.requested` for back-compat).
  3. Run status MUST be `waiting-approval`.
  4. After client POSTs `{action: 'accept'}` to `/v1/runs/{runId}/interrupt`, server emits `approval.received` and resumes.
  5. Run reaches `completed`.
- **Terminal status (after accept)**: `completed`.
- **Resolve schema**: `{action: "accept" | "reject"}`. Server MUST reject any other shape with 400.

### `conformance-clarification`

- **Purpose**: verify HITL clarification interrupt + resume.
- **Inputs**: none.
- **Behavior**:
  1. Run starts and reaches a `clarificationGate` node.
  2. Server emits `clarification.requested` carrying `questions: [{id: "q1", question: "What is your favorite color?"}]`.
  3. After client POSTs `{answers: {q1: "blue"}}`, server emits `clarification.resolved`.
  4. Run reaches `completed`.
- **Terminal status (after resolve)**: `completed`.

### `conformance-multi-node`

- **Purpose**: verify multi-node DAG ordering + per-node events.
- **Inputs**: none.
- **Topology**: three nodes A → B → C, all `core.noop`.
- **Expected behavior**: `node.completed` events MUST arrive in the order A, B, C (assertable via `event.sequence` ordering).
- **Terminal status**: `completed`.

### `conformance-idempotent`

- **Purpose**: verify `Idempotency-Key` cache (rest-endpoints.md §6 + `idempotency.md`).
- **Inputs**:
  - `nonce` (string, required) — caller-supplied; server MUST NOT use this for any side effect, only for de-duplication semantics tests.
- **Expected behavior**:
  - `POST /v1/runs` with the same `Idempotency-Key` and same body twice → second response MUST replay the first (`openwop-Idempotent-Replay: true` header) and MUST NOT create a second run.
  - Same `Idempotency-Key` with a different body → 409.
- **Terminal status**: `completed`.

### `conformance-cancellable`

- **Purpose**: verify `:cancel` mid-run.
- **Inputs**:
  - `delayMs` (integer, required, 1 ≤ value ≤ 60000) — wait long enough for the conformance test to issue cancel.
- **Expected behavior**:
  1. Run reaches `running`.
  2. Client posts `POST /v1/runs/{runId}:cancel`.
  3. Server emits `run.cancelled` within 5s.
  4. Subsequent `GET /v1/runs/{runId}` MUST return `status: "cancelled"`.
- **Terminal status**: `cancelled`.

### `conformance-replay-effect`

- **Purpose**: RFC 0140 — witness that a `mode: "replay"` fork does not re-fire an external side effect (`replay.md` §"Side-effect suppression in replay" rule 1).
- **Inputs**: none.
- **Topology**: `core.noop` (`start`) → `conformance.effect.emit` (`effect`). `conformance.effect.emit` is a node type reserved for the conformance suite, whose only job is to perform exactly one host-observable external effect and have the host count it at the effect seam — the same seam rule 5(b) requires the default-deny guard to sit on.
- **Expected behavior**:
  1. Run reaches `completed`; `GET /v1/host/sample/replay/effect-count?runId=<source>` returns `effectCount: 1`.
  2. `POST /v1/runs/{runId}:fork { fromSeq: 0, mode: "replay" }` returns `201` and the new run reaches terminal.
  3. The replay run's `effectCount` MUST be `0`, and the source's MUST still be `1`.
- **Terminal status**: `completed` (both source and replay).
- **Duration bound**: ≤ 10s.
- **Why the event log is insufficient**: a side-effecting node that fires during a replay and records its outcome identically to the source produces an event log byte-indistinguishable from correct suppression. The count is the only discriminator.

### `conformance-replay-effect-unreached`

- **Purpose**: RFC 0140 rule 3 — witness the fail-closed path when the source run has no recorded outcome for a side-effecting node.
- **Inputs**:
  - `delayMs` (integer, required, 1 ≤ value ≤ 60000) — long enough for the conformance test to cancel before `effect` is reached.
- **Topology**: `core.delay` (`wait`) → `conformance.effect.emit` (`effect`).
- **Expected behavior**:
  1. Run starts; the client cancels mid-delay; the run reaches `cancelled` with `effectCount: 0` — `effect` was never reached, so the source recorded no outcome for it.
  2. `POST /v1/runs/{runId}:fork { fromSeq: 0, mode: "replay" }` returns `201` — `replay_source_missing` is a NODE failure, not a fork rejection.
  3. The replay re-executes the pure `core.delay` live (rule 4) and reaches `effect`, which MUST emit `node.failed` with `error.code: "replay_source_missing"`.
  4. The replay's `effectCount` MUST be `0` — failing closed MUST NOT execute the effect.
- **Terminal status**: source `cancelled`; replay `failed`.
- **Duration bound**: ≤ 60s (input-controlled).
- **Non-vacuity role**: this fixture pins the counter from the opposite end to `conformance-replay-effect`. Together they make a constant-valued seam impossible — a constant `0` reds leg 1 there, a constant `1` reds step 4 here.

### `conformance-capability-missing`

- **Purpose**: verify runtime-capability dispatch refusal — when a node declares `requires: ['<unsupported>']`, the engine MUST refuse to call its executor and terminate the run with the structured error.
- **Inputs**: none.
- **Topology**: single `conformance.requiresMissing` node. The fixture node declares `requires: ['conformance.never-provided']` — a sentinel capability id reserved by spec; production hosts MUST NOT register a provider for it.
- **Expected behavior**:
  1. Run starts and the engine reaches the single node.
  2. Pre-dispatch capability check fails because no host provider satisfies `conformance.never-provided`.
  3. Server emits `node.failed` with the underlying error, then `run.failed`.
  4. Run reaches terminal `failed`.
- **Terminal `RunSnapshot.error`**: `error.code === 'capability_not_provided'`. `error.message` MUST name the missing capability id (`conformance.never-provided`) verbatim so operators can act without grepping logs.
- **Terminal status**: `failed`.
- **Server prerequisites**: the host MUST have registered the `conformance.requiresMissing` NodeModule before seeding the fixture. Hosts that don't register this fixture node MAY mark this scenario optional in their conformance manifest.

---

### `conformance-dispatch-loop`

- **Purpose**: verify the `core.dispatch` loop mechanism (Phase 6 / RFC 0007). Tests that `runOrchestrator.decided` events correctly trigger delegation to child runs and loop termination.
- **Topology**: two nodes: `core.orchestrator.supervisor` and `core.dispatch`, looping back to each other.
- **Inputs**: none.
- **Conformance test driver**:
  1. POST `/v1/runs` with `{workflowId: "conformance-dispatch-loop"}`.
  2. The orchestrator node must emit `runOrchestrator.decided` with `next-worker` then `terminate`.
  3. Poll until terminal.
  4. **Assert** terminal status is `completed`.
  5. **Assert** event log contains `next-worker` and `terminate` decisions.
- **Terminal status**: `completed`.
- **Server prerequisites**: The host MUST advertise `capabilities.agents.dispatch: true`. Since the test does not mock the orchestrator prompt logic, the host's `core.orchestrator.supervisor` implementation (or fixture override) must deterministically emit a `next-worker` followed by `terminate`.

---

## `conformance-version-fold` (closes F5)

- **Consuming scenario**: `conformance/src/scenarios/version-fold.test.ts` (added 2026-06-11; previously this fixture had no consuming scenario).
- **Purpose**: verify forward-compat fold-best-effort tolerance across the spec's engine-version cross-version interop matrix (`version-negotiation.md` §Cross-version interop matrix). Uses the test-keys-only `X-Force-Engine-Version` header to drive the same workflow at three different engine versions from a single deployed server — no multi-version fleet needed.
- **Fixture topology**: a single `core.noop` node. The workflow itself is trivial; the test exercises the server's READ path (projection, event-log fold) under each forced engine version.
- **Inputs**: none.
- **Conformance test driver**:
  1. Read the server's `Capabilities.testing.forceEngineVersionRange = { min, max }`.
  2. For each version `v` in `[min, current, max]` (deduped):
     - POST `/v1/runs` with body `{workflowId: "conformance-version-fold"}` AND header `X-Force-Engine-Version: v`. Use a test API key.
     - Poll until terminal.
     - **Assert** terminal status is `completed`.
     - **Assert** `GET /v1/runs/{runId}` returns a valid `RunSnapshot` (the projection tolerates the version mismatch via fold-best-effort).
     - **Assert** `GET /v1/runs/{runId}/events/poll?lastSequence=0&timeout=1` returns a non-empty `events[]` array (event log is readable).
- **Negative paths**:
  - Same fixture with a production API key returns `403 force_engine_version_forbidden`.
  - Same fixture with `X-Force-Engine-Version: <out-of-range>` returns `400 unsupported_force_engine_version`.
- **Cross-link**: see `version-negotiation.md` §Conformance via X-Force-Engine-Version for the underlying matrix. The fixture is intentionally minimal (single noop) so the test isolates version-fold tolerance from any node-specific behavior.

This fixture closes F5 without requiring any new server-side test infrastructure beyond the `X-Force-Engine-Version` header. Servers that don't advertise `forceEngineVersionRange` in Capabilities can mark this fixture optional in their conformance manifest.

---

## `conformance-stream-text` (closes F1)

- **Consuming scenario**: `conformance/src/scenarios/stream-text-fixture.test.ts` (added 2026-06-11; previously this fixture had no consuming scenario).
- **Purpose**: verify the `messages` SSE stream mode end-to-end through a deterministic AI mock. Without a mock provider, conformance suites can't exercise streaming AI without burning real API budget; with one, the test is fully reproducible.
- **Fixture topology**: a single `core.ai.callPrompt` (or similar AI-bearing typeId) node. The node's actual prompt content is irrelevant — the conformance driver intercepts the AI dispatch via `configurable.mockProvider`.
- **Inputs**: none.
- **Conformance test driver**:
  1. POST `/v1/runs` with body:

     ```jsonc
     {
       "workflowId": "conformance-stream-text",
       "configurable": {
         "mockProvider": {
           "id": "stream-text",
           "config": {
             "tokens": ["Hello", " ", "world", "!"],
             "delayMsPerToken": 10,
             "finishReason": "stop",
             "usage": { "promptTokens": 5, "completionTokens": 4, "totalTokens": 9 }
           }
         }
       }
     }
     ```

     Use a test API key (server returns 403 on production keys per `run-options.md` §Authorization).

  2. Subscribe to `/v1/runs/{runId}/events?streamMode=messages`.
  3. **Assert** chunk arrival order: `["Hello", " ", "world", "!"]` — same order as `tokens`.
  4. **Assert** the final chunk has `isLast: true`, `meta.finishReason === "stop"`, `meta.usage.completionTokens === 4`.
  5. **Assert** SSE stream closes on terminal — server-closed, not timeout.
  6. **Assert** terminal status is `completed`.

- **Negative paths**:
  - Same fixture with a production API key returns `403 mock_provider_forbidden`.
  - Same fixture with `mockProvider.id: "does-not-exist"` returns `400 unsupported_mock_provider`.
- **Replay assertion**: forking the run with `mode: replay` produces a byte-identical event log (mock providers are inherently replay-deterministic — no Layer-2 invocation log needed).

This fixture is the canonical `messages`-mode test, wired into the suite via `stream-text-fixture.test.ts` (2026-06-11). Servers that don't yet support the mock-provider extension can mark this fixture optional in their conformance manifest until they do.

---

## `conformance-subworkflow-parent` + `conformance-subworkflow-child` (closes F2)

> **Status: included in the v1.0 conformance baseline.** The canonical sub-workflow node typeId is `core.subWorkflow` per `node-packs.md` §"Reserved Core OpenWOP typeIds." A host MUST register that node module before advertising the sub-workflow fixture IDs.

- **Purpose**: verify child-run lifecycle when a parent workflow invokes a child via `core.subWorkflow`. Specifically: child `run.started` and `run.completed` events fire; child outputs flow back into the parent's variables; cancelling the parent cancels the child.
- **Topology**:
  - **Child (`conformance-subworkflow-child`)**: single `core.identity` node that echoes its `payload` input. Reuses the existing identity contract.
  - **Parent (`conformance-subworkflow-parent`)**: one `core.subWorkflow` node configured with `workflowId = "conformance-subworkflow-child"` and `inputs = {payload: {fromParent: true}}`. The node's output port `result` carries the child's terminal `RunSnapshot.variables.payload`.
- **Inputs (parent)**: none.
- **Conformance test driver assertions**:
  1. Parent run reaches terminal `completed`.
  2. Two distinct `runId`s appear in the event log query — one for the parent, one for the child.
  3. Parent's `RunSnapshot.variables` contains `result.payload === {fromParent: true}` (the round-trip from invoke + identity echo).
  4. Cancelling the parent mid-flight cancels the child (`run.cancelled` events on both within 5s).

Spec design choices:

- Canonical sub-workflow node typeId — `core.subWorkflow`. It uses the same `core.<conceptName>` flat-camelCase pattern as the other reserved core nodes (`core.start`, `core.delay`, `core.loop`, `core.parallel`, `core.interrupt`, etc.). Sub-workflow invocation is a workflow primitive expressed as a node — same shape as `core.interrupt`.
- Child run's RunSnapshot is owned by the same workspace/tenant as the parent — sub-workflow doesn't cross authorization boundaries.
- Child's events are NOT inlined into the parent's event log; they live in the child's own subcollection. The parent emits a single `node.started` / `node.completed` pair around the invoke node, not all of the child's events.
- Cancellation cascade: parent cancel MUST cancel the child within 5s (suite's existing cancellation timing bound).
- Trace correlation (already specced — see `observability.md` §Sub-workflow attributes / O2): child's `openwop.run` is a parent-child span of the invoke-node's `openwop.node.<typeId>`, with required attributes `openwop.parent.{run_id, workflow_id, node_id}`. Conformance assertion: the child run's first event-log entry's `engineVersion` field SHOULD be on the same trace as the parent's invoke-node — verifiable post-run via the OTel exporter if available.

The fixture JSONs and matching `subworkflow.test.ts` are part of the current conformance suite.

---

## `conformance-cap-breach` (closes F4 spec-side; runtime impl pending)

> **Status: spec firm — closed via the unified `cap.breached` design in `capabilities.md` §Engine-enforced limits.** Runtime counter implementation does not require an `eventLogSchemaVersion` bump because `cap.breached` already exists with `kind: 'node-executions'` in its enum. Add the fixture JSON when a host exposes the per-run counter fixture.

- **Purpose**: verify the `Capabilities.limits.maxNodeExecutions` ceiling clamps `RunOptions.configurable.recursionLimit` at run-start, and that the engine emits `cap.breached` + transitions to `failed` when the per-run counter exceeds the resolved limit.
- **Topology**: 10 sequential `core.noop` nodes (`a → b → c → … → j`). A run completes naturally if no per-run override is supplied. With `configurable.recursionLimit = 5`, the run MUST trip after the 5th node.
- **Inputs**: none.
- **Conformance test driver**:
  1. POST `/v1/runs` with `{workflowId: "conformance-cap-breach", configurable: {recursionLimit: 5}}`.
  2. Server SHOULD validate `recursionLimit ≤ Capabilities.limits.maxNodeExecutions`. If `maxNodeExecutions` is `100` (default), `5` is fine.
  3. Poll until terminal.
  4. **Assert** terminal status is `failed`.
  5. **Assert** `RunSnapshot.error.code === "recursion_limit_exceeded"`.
  6. **Assert** the event log contains a `cap.breached` event with `payload: {kind: "node-executions", limit: 5, observed: 6}` (or whichever `observed > limit` value the engine recorded).
- **Negative path**: same fixture without the override completes normally (10 `node.completed` events, terminal `completed`).

This fixture is unblocked when:

1. A host exposes CC-1's hard invariant (per-run `nodeExecutionCount` counter; `RunEvent` schema support for `cap.breached` payload's `kind: "node-executions"` value; run transition to `failed` on exceedance).
2. The conformance suite's `openwop-conformance` driver gains the matching scenario file `cap-breach.test.ts`.

Both items are tracked as v1.x conformance expansion work.

---

## `conformance-run-duration-breach` (RFC 0058 — wall-clock run timeout)

> **Status: RFC 0058 `Draft`.** Exercises the `run-duration` `cap.breached` kind. Soft-skips until a host advertises `capabilities.limits.maxRunDurationMs` AND enforces the wall-clock bound; gated in `run-execution-bounds-shape.test.ts` via `isFixtureAdvertised`.

- **Purpose**: verify that `RunOptions.configurable.runTimeoutMs` (clamped to `Capabilities.limits.maxRunDurationMs`) terminates a run that overruns its deadline, emitting `cap.breached {kind: 'run-duration'}` + terminal `failed` with `error.code = 'run_timeout'` per `run-options.md` §runTimeoutMs + `capabilities.md` §"Engine-enforced limits".
- **Topology**: single `core.delay` node that sleeps `input.delayMs` (default `30000`) — far longer than the small `runTimeoutMs` the test supplies.
- **Inputs**: `delayMs` (number, default `30000`).
- **Conformance test driver**:
  1. POST `/v1/runs` with `{workflowId: "conformance-run-duration-breach", configurable: {runTimeoutMs: 1000}}`.
  2. Poll until terminal.
  3. **Assert** terminal status is `failed`.
  4. **Assert** `RunSnapshot.error.code === "run_timeout"`.
  5. **Assert** the event log contains a `cap.breached` event with `payload: {kind: "run-duration", limit: 1000, observed: <elapsedMs > 1000>}` — `observed` recorded in the event, not recomputed at replay (`replay.md`).
- **Negative path**: same fixture with `runTimeoutMs` above the (short) `delayMs`, or no override, completes normally.

This fixture is unblocked when a host exposes a wall-clock deadline enforcer advertising `capabilities.limits.maxRunDurationMs`. Tracked as v1.x conformance expansion work (RFC 0058 acceptance criteria).

---

## `openwop-smoke-byok-roundtrip` (BYOK end-to-end smoke fixture)

> **Status: included in the v1.0 conformance baseline.** Server-side `conformance.secret.echo` support is exercised by `src/scenarios/byok-roundtrip.test.ts`.

- **Purpose**: verify the BYOK secret-resolution roundtrip end-to-end. A host that advertises `capabilities.secrets.supported: true` MUST resolve the canary `openwop-conformance-canary-secret` via its `SecretResolver` and surface only the SHA-256 hex + byte length on every observable channel (variables, events, debug bundle, logs). The raw value MUST NOT leak per `observability.md` §"Redaction" + `threat-model-secret-leakage.md` §SR-1.
- **Topology**: single node `resolve-secret` with `typeId: conformance.secret.echo`, `config.secretId: "openwop-conformance-canary-secret"`. Resolves the canary, hashes it, and writes `{secretSha256, secretLength}` to the run's `variables.resolve-secret`.
- **Conformance test driver**:
  1. POST `/v1/runs` with `{workflowId: "openwop-smoke-byok-roundtrip"}`.
  2. Poll until terminal.
  3. **Assert** terminal status is `completed`.
  4. **Assert** `variables['resolve-secret'].secretSha256` matches `^[0-9a-f]{64}$`.
  5. **Assert** `variables['resolve-secret'].secretLength > 0`.
  6. **Assert** event log does NOT contain a suspicious payload echoing the raw secret (regex check across `value`/`password`/`plaintext`/`raw_secret` adjacent to `secretSha256`).

Hosts that don't ship a BYOK SecretResolver MAY return `404` / `422` on the start-run call; the scenario soft-skips in that case.

---

## `conformance-channel-ttl` (closes C3 — channel TTL reducer fold)

> **Status: included in the v1.0 conformance baseline.** Server-side `core.channelWrite` support is exercised by `src/scenarios/channel-ttl.test.ts`.

- **Purpose**: verify the `append` reducer applies `ttlMs` filter at write time, dropping entries older than the cutoff.
- **Topology**: 4 sequential `core.channelWrite` nodes targeting channel `events` with `ttlMs: 200`, separated by a `core.delay` of 300ms between writes 3 and 4. The 4th write fires after the TTL window has elapsed.
- **Inputs**: none. Each node carries a static `value` in its `config` (`a`, `b`, `c`, `d` respectively).
- **Conformance test driver**:
  1. POST `/v1/runs` with `{workflowId: "conformance-channel-ttl"}`.
  2. Poll until terminal.
  3. **Assert** terminal status is `completed`.
  4. **Assert** `RunSnapshot.variables.events.length === 1` — the 3 priors aged out at the 4th write.
  5. **Assert** `RunSnapshot.variables.events[0].value === "d"` — the surviving entry is the post-delay write.
  6. **Assert** `typeof RunSnapshot.variables.events[0]._ts === "number"` — entries carry numeric write timestamps.

---

## `conformance-agent-channel-dispatch` (RFC 0082 §B — production-path channel pin)

> **Status: capability-gated (RFC 0082 `agents.deployment`).** Only a host advertising `agents.deployment.supported:true` can seed this fixture — a host that omits `agents.deployment` MUST reject the channel-bearing `agent` ref with `validation_error` (`agent-ref.schema.json`). Exercised by `src/scenarios/agent-channel-dispatch.test.ts`.

- **Purpose**: prove the RFC 0082 §B channel resolve-and-pin contract from a real run graph (complementing `agent-deployment-lifecycle.test.ts` Leg 4, which uses the host-sample seam). A node binds a deployment CHANNEL (`agent.channel: "stable"`) instead of an exact `version`.
- **Topology**: a single `core.identity` node whose `agent` binding is `{ "agentId": "core.conformance.channel-agent", "channel": "stable" }` (no `version`). The host MUST have an active deployment of `core.conformance.channel-agent` on the `stable` channel.
- **Inputs**: none. Trigger `manual`.
- **Conformance test driver**:
  1. POST `/v1/runs` with `{workflowId: "conformance-agent-channel-dispatch"}`; poll until terminal.
  2. **Assert** the first `agent.invocation.started` carries `resolvedChannel: "stable"` and a concrete non-empty `resolvedAgentVersion` (the recorded fact, RFC 0077).
  3. **Replay** via `POST /v1/runs/{runId}:fork {mode:"replay"}`; **assert** the fork's `agent.invocation.started` re-reads the SAME `resolvedAgentVersion`.
  4. **(Seam-guarded)** Move the `stable` channel via the deployment seam; **assert** a replay of the original run STILL carries the original pin — never re-resolving the moved channel.

---

## NodeModule registration

The fixtures reference these typeIds:

| typeId                        | Required by                                            | Behavior                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.noop`                   | noop, multi-node, approval, clarification, cancellable | Immediate completion, no output                                                                                                                                                          |
| `core.identity`               | identity                                               | Echo `input.payload` to `output.payload`                                                                                                                                                 |
| `core.delay`                  | delay, cancellable                                     | Sleep `config.delayMs` ms                                                                                                                                                                |
| `core.fail`                   | failure                                                | Throw with `code: "conformance_test_failure"`, message: "Intentional conformance failure"                                                                                                |
| `core.approvalGate`           | approval                                               | Call `ctx.interrupt({kind: 'approval', ...})`                                                                                                                                            |
| `core.clarificationGate`      | clarification                                          | Call `ctx.interrupt({kind: 'clarification', ...})`                                                                                                                                       |
| `conformance.requiresMissing` | capability-missing                                     | Declares `requires: ['conformance.never-provided']`; engine MUST refuse dispatch. Opt-in fixture registration is recommended so production deployments don't expose the fixture surface. |

An OpenWOP-compliant server's NodeModule registry MUST include implementations for all six core typeIds before seeding fixtures. The `conformance.requiresMissing` fixture node is opt-in — see the row above.

---

## Versioning

Each fixture's JSON has its own `version` field. The OpenWOP v1.0 conformance suite targets fixture version 1.0. Fixture spec breaking changes MUST bump the major; the suite MUST refuse to run against an unrecognized fixture version with a clear error message.

---

## File layout

```text
conformance/
  fixtures.md                — this file
  fixtures/
    conformance-noop.json
    conformance-identity.json
    conformance-delay.json
    conformance-failure.json
    conformance-approval.json
    conformance-clarification.json
    conformance-multi-node.json
    conformance-idempotent.json
    conformance-cancellable.json
    conformance-replay-effect.json
    conformance-replay-effect-unreached.json
```

Each JSON is a valid `WorkflowDefinition` per `../schemas/workflow-definition.schema.json`. Servers MUST treat them as opaque blobs to seed verbatim — do not transform field names or strip fields.

---

## Pack-manifest fixtures

The `fixtures/pack-manifests/` sub-directory holds canonical pack manifests used as schema-level proof points (validated server-free against `../schemas/node-pack-manifest.schema.json`, or `../schemas/workflow-chain-pack-manifest.schema.json` for `kind: "workflow-chain"`). Most are NOT seeded into a server — they assert the canonical schema accepts each documented pack-name scope. The `workflow-chain-sample.pack` fixture is the exception: it is the **bundled, host-syncable** `vendor.openwop.workflow-chain-sample` pack that `workflow-chain-host-expansion.test.ts` loads (and that a live host serving the RFC 0013 `/v1/host/sample/workflow-chain:expand` seam vendors) — so the published pack is the single contract source for that live-host witness.

| Fixture                     | `name`                                 | Purpose                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pack-private-example`      | `private.example-host.example-tools`   | Asserts the v1.0 pack-name pattern accepts the `private.<host>.*` scope reserved for host-internal registries.                                                                                                                                                                       |
| `workflow-chain-sample.pack` | `vendor.openwop.workflow-chain-sample` | RFC 0013 `kind: "workflow-chain"` reference pack (2 chains: 1-node `summarize-text` + 2-node `fetch-and-summarize`). **Bundled + host-syncable** (2026-07-05 erratum A-lite): `workflow-chain-host-expansion.test.ts` loads it and derives the expected expansion from the `expandChain()` reference library, so a serving host's `/v1/host/sample/workflow-chain:expand` output is checked against the spec algorithm for the identical published pack — no hardcoded expansion. |

Pack-manifest fixtures are exercised by the server-free `fixtures-valid.test.ts` scenarios — adding one runs the schema validator against it automatically.

---

## Connection pack fixtures

The `fixtures/connection-packs/` sub-directory holds canonical connection-pack manifests (RFC 0095, `kind: "connection"`) used as schema-level proof points (validated server-free against `../schemas/connection-pack-manifest.schema.json`) AND as the install payloads the capability-gated behavioral scenarios POST to the `POST /v1/host/sample/connection-packs/install` seam. They are NOT seeded into a server.

| Fixture                  | `provider.id` | Purpose                                                                                                                                                                |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection-pack-github` | `github`      | Canonical positive manifest (oauth2 + pkce, read/write scope groups, MCP reach, the exempt `provider.auth.endpoints.token` endpoint URL). Drives manifest-valid, no-credential-material, reach-exclusive, provider-resolution, and write-reconsent scenarios. |
| `connection-pack-apihosts-valid` | `meta-ads` | Canonical positive `openapi`-reach manifest declaring a `provider.apiHosts` credential-egress allow-list (`["facebook.com"]`) — RFC 0120. Drives `connection-pack-apihosts` (the `apiHosts` schema + conditional-MUST + egress allow-list scenario). Negatives (IP/wildcard/port/single-label/uppercase entries, openapi-without-apiHosts) are inline mutations per suite convention. |

Negative manifests (credential material, mixed kinds, dual reach) are inline test data in the scenario files per suite convention — a deliberately-invalid fixture file would fail the automatic `fixtures-valid.test.ts` sweep.

---

## Trigger-event fixtures

The `fixtures/trigger-events/` sub-directory holds canonical external-event ingestion documents (RFC 0099) used as schema-level proof points — validated server-free against `../schemas/trigger-event.schema.json` (`trigger-event-*`) and `../schemas/trigger-subscription-registration.schema.json` (`trigger-subscription-registration-*`) by the `fixtures-valid.test.ts` sweep + the `trigger-ingestion.test.ts` scenario. They are NOT seeded into a server.

| Fixture                                      | Schema                                        | Purpose                                                                                                                            |
| -------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `trigger-event-email`                        | `trigger-event.schema.json`                   | Canonical positive `source:"email"` TriggerEvent — `verified`, `contentTrust:"untrusted"`, an `AttachmentRef` with a host-internal `ref`. Drives the §F.1 one-of, AttachmentRef, and contentTrust shape assertions. |
| `trigger-event-stream`                       | `trigger-event.schema.json`                   | Canonical positive `source:"stream"` TriggerEvent (RFC 0127) — broker coordinates (`topic`/`partition`/`offset`/`key`) + `message` body, dedup key composed from the coordinates. Drives the stream-side schema assertions in `trigger-stream-cdc-sources.test.ts`. |
| `trigger-event-change`                       | `trigger-event.schema.json`                   | Canonical positive `source:"change"` TriggerEvent (RFC 0127) — REQUIRED `op:"update"` + `table`/`changelogId`/`before`/`after` row images, plus a `permittedPurposes` label (RFC 0128). Drives the op-REQUIRED negative + the label shape assertions in `trigger-stream-cdc-sources.test.ts` / `purpose-propagation.test.ts`. |
| `trigger-subscription-registration-email`    | `trigger-subscription-registration.schema.json` | Canonical positive registration (`source:"email"`, `workflowId`, `verification.mode:"required"`). Drives the registration shape assertions. |

Negative cases (cross-source sub-objects, raw attachment URLs, `Authorization` headers) are inline test data in `trigger-ingestion.test.ts` per suite convention — a deliberately-invalid fixture file would fail the automatic sweep.

---

## OAuth provider fixtures

The `fixtures/oauth-providers/` sub-directory holds synthetic OAuth provider definitions used to prove the RFC 0047 `host.oauth` authorization-code roundtrip end-to-end **without a live IdP**. They are NOT `WorkflowDefinition`s and are NOT seeded as workflows — they parameterize the behavioral roundtrip scenario, which drives the host's `POST /v1/host/sample/oauth/authorize-code-roundtrip` seam against the provider's `authUrl`/`tokenUrl` (served by a conformance test double).

| Fixture     | `provider.id` | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `synthetic` | `synthetic`   | The ONE canonical synthetic provider. Real providers differ only in `authUrl`/`tokenUrl` with no provider-specific grant/exchange quirks on the wire, so a single parameterizable provider exercises the whole authorization-code dance. Carries a canned `exchange` (authorization code, state, PKCE verifier, redirect URI, and a canary `tokenResponse`) so the paired `oauth-authorization-code-roundtrip.test.ts` can assert RFC 0047 §C + §C.2 redaction — none of those values may appear on a run-visible surface. A provider-specific quirk fixture is added only if one ever materializes. |

---

## Prompt-template fixtures

The `fixtures/prompt-templates/` sub-directory holds canonical PromptTemplate documents (per RFC 0027 §A) used as schema-level proof points (validated server-free against `../schemas/prompt-template.schema.json`). They are NOT seeded into a workflow store. They exist so the `prompt-template-shape` scenario has stable positive fixtures, the secret-redaction + trust-marker conformance scenarios have known fixture templateIds to compose against (when a host advertises `capabilities.prompts.supported: true` + `observability: "full"`), and follow-up RFCs (RFC 0028 prompt packs, RFC 0029 resolution chain) can reference a stable shared fixture set.

| Fixture                               | `templateId`                          | Purpose                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conformance-prompt-writer-system`    | `conformance.prompt.writer-system`    | Minimal `kind: "system"` template with no variables. Asserts positive round-trip against the canonical schema.                                                                                                                                                                                                                                                                                    |
| `conformance-prompt-secret-redaction` | `conformance.prompt.secret-redaction` | `kind: "user"` template carrying a `source: "secret"` variable. Drives `prompt-composed-secret-redaction` scenario; the host's compose seam binds `apiKey` to a canary-marker secret and the scenario asserts the `[REDACTED:<secretId>]` marker appears in `prompt.composed` payload.                                                                                                            |
| `conformance-prompt-trust-marker`     | `conformance.prompt.trust-marker`     | `kind: "user"` template with a `source: "input"` variable. The conformance compose seam tags the binding `meta.contentTrust: "untrusted"` so the `prompt-composed-trust-marker` scenario asserts `<UNTRUSTED>...</UNTRUSTED>` wrapping + `contentTrust: "untrusted"` propagation.                                                                                                                 |
| `conformance-prompt-schema-hint`      | `conformance.prompt.schema-hint`      | `kind: "schema-hint"` template — structured-output directive instructing the model to emit a specific JSON shape. Variable-free. Used by the `prompt-all-four-kinds-events` scenario to exercise the schema-hint dispatch slot on the reference workflow-engine's `local.sample.demo.mock-ai` node.                                                                                               |
| `conformance-prompt-few-shot`         | `conformance.prompt.few-shot`         | `kind: "few-shot"` template carrying two Q/A exemplar pairs (coffee + tea). Variable-free. Used by the `prompt-all-four-kinds-events` scenario as the FIRST entry of the multi-entry `fewShotPromptRefs[]` array — exercises `slotIndex: 0` of the resolver's per-index lookup.                                                                                                                   |
| `conformance-prompt-few-shot-2`       | `conformance.prompt.few-shot-2`       | Second `kind: "few-shot"` template carrying two Q/A exemplar pairs (chocolate + cheese). Variable-free. Used by the `prompt-all-four-kinds-events` scenario as the SECOND entry of the multi-entry `fewShotPromptRefs[]` array — exercises `slotIndex: 1`. The regression pin for `fewShotPromptRefs[slotIndex]` per-index resolution; a host that hard-codes `[0]` silently drops this template. |
| `conformance-prompt-writer-user`      | `conformance.prompt.writer-user`      | Minimal `kind: "user"` template paired with `conformance.prompt.writer-system` to give the four-kinds fixture a kind-accurate user slot. Variable-free; renders verbatim.                                                                                                                                                                                                                         |

Fixture invariants enforced by `fixtures-valid.test.ts`:

1. Every file under `prompt-templates/` validates against `prompt-template.schema.json`.
2. Every file declares a non-empty `templateId`.
3. Any fixture declaring a `source: "secret"` variable MUST carry the `secret-redaction` tag — the prompt-composed-secret-redaction scenario discovers fixtures by tag, so an untagged fixture would silently bypass redaction assertions.

Prompt-template fixtures are exercised by the server-free `fixtures-valid.test.ts` scenarios — adding one runs the schema validator against it automatically. Capability-gated behavioral scenarios (`prompt-composed-secret-redaction`, `prompt-composed-trust-marker`) skip cleanly when the host doesn't advertise `capabilities.prompts.supported: true` + `observability: "full"`.

---

## References

- `README.md` — conformance suite operator docs
- `../schemas/workflow-definition.schema.json` — every fixture validates against this
- `../rest-endpoints.md` — endpoint contracts the fixtures exercise
- `../interrupt.md` — HITL primitive used by approval + clarification fixtures
- `../idempotency.md` — semantics the idempotent fixture exercises

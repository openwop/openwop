# Multi-Agent Integration Gaps — openwop v1.0

**Status:** ARCHIVED — every gap row in this audit is closed as of 2026-05-11.
**Authored:** 2026-05-10.
**Archived:** 2026-05-11 (reconciliation pass against `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 10).

## Why this doc exists (historical)

The v1 reset (commit `4adde95`, 2026-05-09) folded the Multi-Agent Shift RFCs (Phases 1–6) into v1 FINAL. The README + CHANGELOG advertised "Multi-Agent Shift (Phases 1-6) complete," and the eight per-phase schemas (`agent-manifest`, `memory-entry`, `memory-list-options`, `conversation-turn`, `conversation-event`, `orchestrator-decision`, `run-orchestrator-decided-event`, `dispatch-config`) shipped as files — but the *integration seams* wiring those schemas into the canonical spec corpus were lost in the reset.

This document was the audit + closure plan listing every per-phase surface that was missing as of 2026-05-10. The 2026-05-11 reconciliation confirmed all rows are now closed; below records the landing path for each so an auditor can reproduce the verification.

## Source material (unchanged)

The wire-shape contracts originated in 6 RFCs in the predecessor repo (`myndhyve/wop`), now landed as `RFCS/0002-0007` in this repo:

| Phase | New RFC | Subject |
|---|---|---|
| 1 | `RFCS/0002-agent-identity-and-reasoning-events.md` | Agent identity, reasoning events, confidence escalation, message reducer |
| 2 | `RFCS/0003-agent-packs.md` | Agent packs / capability discovery |
| 3 | `RFCS/0004-memory-layer.md` | Memory layer |
| 4 | `RFCS/0005-conversation.md` | Conversation primitive |
| 5 | `RFCS/0006-orchestrator.md` | Orchestrator-supervisor role |
| 6 | `RFCS/0007-dispatch.md` | `core.dispatch` / conservative dynamic graph mutation |

## Audit closure matrix

### What survived the v1 reset (8 schemas + 1 conformance scenario)

| Surface | Status |
|---|---|
| `schemas/agent-manifest.schema.json` | ✅ present |
| `schemas/memory-entry.schema.json` | ✅ present |
| `schemas/memory-list-options.schema.json` | ✅ present |
| `schemas/conversation-turn.schema.json` | ✅ present |
| `schemas/conversation-event.schema.json` | ✅ present |
| `schemas/orchestrator-decision.schema.json` | ✅ present |
| `schemas/run-orchestrator-decided-event.schema.json` | ✅ present |
| `schemas/dispatch-config.schema.json` | ✅ present |
| `conformance/src/scenarios/dispatchLoop.test.ts` | ✅ present (Phase 6) |

### Phase 1 (Agent Identity) — closed

| Surface | Landing path |
|---|---|
| `schemas/agent-ref.schema.json` | ✅ `schemas/agent-ref.schema.json` (chunk A) |
| `RunSnapshot.agent: AgentRef` field | ✅ `schemas/run-snapshot.schema.json` §`agent` (chunk B) |
| `agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided` events | ✅ in `RunEventType` enum (`schemas/run-event.schema.json`) (chunk C) |
| Per-event payload schemas for `agent.*` | ✅ `schemas/run-event-payloads.schema.json` `$defs.{agentReasoned,agentToolCalled,agentToolReturned,agentHandoff,agentDecided}` (chunk C) |
| `WorkflowNode.agent?` field | ✅ `schemas/workflow-definition.schema.json` §`agent` (chunk D) |
| `message` reducer | ✅ `spec/v1/channels-and-reducers.md` §"`message` (Multi-Agent Shift Phase 1)" (chunk H) |
| `'low-confidence'` suspend reason | ✅ `schemas/suspend-request.schema.json` enum + `spec/v1/interrupt.md` §"`kind: \"low-confidence\"`" (chunk F) |
| `RunOptions.configurable.escalationThreshold` | ✅ `spec/v1/run-options.md` configurable-key table (chunk I) |
| `RunOptions.configurable.reasoningVerbosity` | ✅ `spec/v1/run-options.md` configurable-key table (chunk I) |
| Conformance: `agentMetadata.test.ts` | ✅ `conformance/src/scenarios/agentMetadata.test.ts` (chunk J) |
| Conformance: `agentReasoningEvents.test.ts` | ✅ `conformance/src/scenarios/agentReasoningEvents.test.ts` (chunk J) |
| Conformance: `agentConfidenceEscalation.test.ts` | ✅ `conformance/src/scenarios/agentConfidenceEscalation.test.ts` (chunk J) |
| Conformance: `agentMessageReducer.test.ts` | ✅ `conformance/src/scenarios/agentMessageReducer.test.ts` (chunk J) |

### Phase 2 (Agent Packs) — closed

| Surface | Landing path |
|---|---|
| `capabilities.agents` block | ✅ `schemas/capabilities.schema.json` §`agents` + `spec/v1/capabilities.md` §"agents" (chunk E) |
| `capabilities.agents.modelClasses` enum | ✅ `schemas/capabilities.schema.json` §`agents.modelClasses` (chunk E) |
| `capabilities.agents.orchestratorPattern` field | ✅ `schemas/capabilities.schema.json` §`agents.orchestratorPattern` (chunk E) |
| `capabilities.agents.memoryBackends` enum | ✅ `schemas/capabilities.schema.json` §`agents.memoryBackends` (chunk E) |
| `pack.json` `agents[]` array | ✅ `schemas/node-pack-manifest.schema.json` — verified by `agentPackInstall.test.ts` / `agentPackExport.test.ts` |
| Conformance: `agentPackInstall.test.ts` | ✅ `conformance/src/scenarios/agentPackInstall.test.ts` (chunk J) |
| Conformance: `agentPackExport.test.ts` | ✅ `conformance/src/scenarios/agentPackExport.test.ts` (chunk J) |
| Conformance: `agentPackProvenance.test.ts` | ✅ `conformance/src/scenarios/agentPackProvenance.test.ts` (chunk J) |

### Phase 3 (Memory Layer) — closed

| Surface | Landing path |
|---|---|
| Prose spec for `MemoryAdapter` contract | ✅ `spec/v1/agent-memory.md` (chunk K) |
| `capabilities.agents.memoryBackends: ['long-term']` | ✅ `schemas/capabilities.schema.json` + `spec/v1/capabilities.md` §"memoryBackends" (chunk E) |
| Cross-tenant isolation invariant (CTI-1) | ✅ `spec/v1/agent-memory.md` + `RFCS/0004-memory-layer.md` |
| Secret-redaction invariant (SR-1) | ✅ `spec/v1/agent-memory.md` + `RFCS/0004-memory-layer.md`; verified by `redactionAdversarial.test.ts` + `agentMemoryRedactionContract.test.ts` |
| Conformance: `agentMemoryRoundTrip.test.ts` | ✅ `conformance/src/scenarios/agentMemoryRoundTrip.test.ts` (chunk J) |
| Conformance: `agentMemoryCrossTenantIsolation.test.ts` | ✅ `conformance/src/scenarios/agentMemoryCrossTenantIsolation.test.ts` (chunk J) |
| Conformance: `agentMemoryRedactionContract.test.ts` | ✅ `conformance/src/scenarios/agentMemoryRedactionContract.test.ts` (chunk J) |
| Conformance: `agentMemoryTtlExpiry.test.ts` | ✅ `conformance/src/scenarios/agentMemoryTtlExpiry.test.ts` (chunk J) |

### Phase 4 (Conversation Primitive) — closed

| Surface | Landing path |
|---|---|
| `conversation.start` / `conversation.exchange` / `conversation.close` suspend variants | ✅ `schemas/suspend-request.schema.json` enum + per-variant payload `$defs` (chunk F) |
| `conversation.opened` / `conversation.exchanged` / `conversation.closed` events | ✅ in `RunEventType` enum + `run-event-payloads.schema.json` `$defs.{conversationOpened,conversationExchanged,conversationClosed}` (chunk C) |
| `capabilities.conversationPrimitive: true` | ✅ `schemas/capabilities.schema.json` §`conversationPrimitive` (chunk E) |
| `core.conversationGate` typeId | ✅ `spec/v1/node-packs.md` core-typeId table (chunk G) |
| Conformance: `conversationLifecycle.test.ts` | ✅ `conformance/src/scenarios/conversationLifecycle.test.ts` (chunk J) |
| Conformance: `conversationVsLegacySuspend.test.ts` | ✅ `conformance/src/scenarios/conversationVsLegacySuspend.test.ts` (chunk J) |
| Conformance: `conversationReplayDeterminism.test.ts` | ✅ `conformance/src/scenarios/conversationReplayDeterminism.test.ts` (chunk J) |
| Conformance: `conversationCapabilityNegotiation.test.ts` | ✅ `conformance/src/scenarios/conversationCapabilityNegotiation.test.ts` (chunk J) |

### Phase 5 (Orchestrator Role) — closed

| Surface | Landing path |
|---|---|
| `RunSnapshot.runOrchestrator: AgentRef` field | ✅ `schemas/run-snapshot.schema.json` §`runOrchestrator` (chunk B) |
| `runOrchestrator.decided` event | ✅ in `RunEventType` enum + `run-event-payloads.schema.json` `$defs.runOrchestratorDecided` (chunk C) |
| `core.orchestrator.supervisor` typeId | ✅ `spec/v1/node-packs.md` core-typeId table (chunk G) |
| `capabilities.agents.orchestrator: true` | ✅ `schemas/capabilities.schema.json` §`agents.orchestrator` (chunk E) |
| Conservative-path suspend semantics (CP-1) | ✅ `spec/v1/interrupt.md` §"`kind: \"low-confidence\"`" + `RFCS/0006-orchestrator.md` |
| Conformance: `orchestratorDispatch.test.ts` | ✅ `conformance/src/scenarios/orchestratorDispatch.test.ts` (chunk J) |
| Conformance: `orchestratorTermination.test.ts` | ✅ `conformance/src/scenarios/orchestratorTermination.test.ts` (chunk J) |
| Conformance: `orchestratorConservativePath.test.ts` | ✅ `conformance/src/scenarios/orchestratorConservativePath.test.ts` (chunk J) |

### Phase 6 (Dispatch Loop) — closed

| Surface | Landing path |
|---|---|
| `dispatch-config.schema.json` | ✅ present (survived the reset) |
| `conformance/src/scenarios/dispatchLoop.test.ts` | ✅ present (survived the reset) |
| `core.dispatch` typeId | ✅ `spec/v1/node-packs.md` core-typeId table (chunk G) |
| `capabilities.agents.dispatch: true` | ✅ `schemas/capabilities.schema.json` §`agents.dispatch` (chunk E) |

## Headline metrics — closed snapshot (2026-05-11)

- **8 / 8 multi-agent schemas** present AND wired into the canonical schemas (`run-snapshot`, `run-event`, `run-event-payloads`, `workflow-definition`, `capabilities`, `suspend-request`).
- **9 / 9 multi-agent event types** in the `RunEventType` enum with payload schemas.
- **All multi-agent capability flags** (`agents.supported`, `agents.modelClasses`, `agents.orchestratorPattern`, `agents.memoryBackends`, `agents.orchestrator`, `agents.dispatch`, `conversationPrimitive`) present in `capabilities.schema.json` and documented in `spec/v1/capabilities.md`.
- **All 4 multi-agent suspend variants** (`conversation.start` / `conversation.exchange` / `conversation.close` / `low-confidence`) in `interrupt.md` and `suspend-request.schema.json`.
- **All 3 multi-agent core typeIds** (`core.dispatch`, `core.orchestrator.supervisor`, `core.conversationGate`) in `node-packs.md`.
- **18 / 18 multi-agent conformance scenarios** present in `conformance/src/scenarios/`.
- **README + CHANGELOG** advertise "Multi-Agent Shift (Phases 1-6) complete" — claim is now defensible from the spec corpus alone.

## Integration plan — chunks A–K

All 11 chunks landed.

| # | Chunk | Files touched | Status |
|---|---|---|---|
| A | Author `schemas/agent-ref.schema.json` | `schemas/agent-ref.schema.json` | ✅ |
| B | Extend `RunSnapshot` with `agent` + `runOrchestrator` fields | `schemas/run-snapshot.schema.json` | ✅ |
| C | Extend `RunEventType` enum + add per-event payload schemas | `schemas/run-event.schema.json` + `schemas/run-event-payloads.schema.json` | ✅ |
| D | Add `WorkflowNode.agent?` field | `schemas/workflow-definition.schema.json` | ✅ |
| E | Extend `capabilities` with `agents` block + `conversationPrimitive` | `schemas/capabilities.schema.json` + `spec/v1/capabilities.md` | ✅ |
| F | Add `conversation.*` suspend variants + `'low-confidence'` reason | `schemas/suspend-request.schema.json` + `spec/v1/interrupt.md` | ✅ |
| G | Add `core.dispatch`, `core.orchestrator.supervisor`, `core.conversationGate` to core typeId table | `spec/v1/node-packs.md` | ✅ |
| H | Document `message` reducer in canonical reducer table | `spec/v1/channels-and-reducers.md` | ✅ |
| I | Add `escalationThreshold` + `reasoningVerbosity` to RunOptions configurable | `spec/v1/run-options.md` | ✅ |
| J | Backport conformance scenarios (18 stubs) | `conformance/src/scenarios/*.test.ts` | ✅ |
| K | Document MemoryAdapter contract + CTI-1 + SR-1 prose | `spec/v1/agent-memory.md` | ✅ |

## Implementation notes (historical)

- **Scope discipline.** This was a spec-corpus integration pass, not a behavior change. Wire-shape contracts already existed in the predecessor RFCs; the work was mechanical re-integration into the new openwop file layout.
- **Schema $id URLs.** All new + updated schemas use the `https://openwop.dev/spec/v1/...` $id pattern.
- **Forward-compat.** All new event types extend the `RunEventType` enum under the existing forward-compat rule (readers MUST NOT throw on unknown types). All new RunSnapshot fields are optional. All new capability flags are optional.
- **Conformance stubs.** The 18 landed scenarios exercise the wire-shape contract end-to-end, not full feature coverage. Each scenario gates on the relevant capability advertisement so pre-MAS hosts skip cleanly per the existing fixture-gating pattern.

## What this doc is NOT

- Not a normative spec. Normative spec for Phases 1–6 lives in `RFCS/0002-0007` and the corresponding sections of `spec/v1/*.md` listed above.
- Not a behavior change. The pass re-integrated wire-shape contracts that existed in the predecessor repo's RFCs.
- Not a roadmap for Phase 7+. Aggressive path / mid-run graph mutation remains deferred to v1.3+; only Phases 1–6 were in scope.

## Follow-up: promote RFCs 0002–0007 from Active to Accepted

With every integration seam closed, RFCs 0002–0007 are eligible for promotion from `Active` to `Accepted` per `RFCS/0001-rfc-process.md`. That promotion is tracked separately in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 10 acceptance criteria; this document does not gate it further.

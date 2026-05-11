# Multi-Agent Integration Gaps — openwop v1.0

**Status:** Planning doc + audit log for the multi-agent functionality integration pass.
**Authored:** 2026-05-10.

## Why this exists

The v1 reset (commit `4adde95`, 2026-05-09) folded the Multi-Agent Shift RFCs (Phases 1–6) into v1 FINAL. The README + CHANGELOG advertise "Multi-Agent Shift (Phases 1-6) complete," and the eight per-phase schemas (`agent-manifest`, `memory-entry`, `memory-list-options`, `conversation-turn`, `conversation-event`, `orchestrator-decision`, `run-orchestrator-decided-event`, `dispatch-config`) shipped as files.

**But the integration seams that wire those schemas into the canonical spec corpus were lost in the v1 reset.** The standalone schemas exist; the seams that make them part of the normative contract — extensions to `RunEventType`, `RunSnapshot`, `Capabilities`, `SuspendRequest`, core typeId tables, reducer tables, RunOptions configurable keys, and conformance scenarios — were not carried forward.

This document is the audit + closure plan. Chunks A–K below are the integration work needed to make the "Multi-Agent Shift (Phases 1-6) complete" claim true in the spec corpus, not just on paper.

## Source material

The wire-shape contracts originated in 6 RFCs in the predecessor repo (`myndhyve/wop`):

| Phase | Old RFC | Subject |
|---|---|---|
| 1 | 0007 | Agent identity, reasoning events, confidence escalation, message reducer |
| 2 | 0008 | Agent packs / capability discovery |
| 3 | 0009 | Memory layer |
| 4 | 0010 | Conversation primitive |
| 5 | 0011 | Orchestrator-supervisor role |
| 6 | 0012 | `core.dispatch` / conservative dynamic graph mutation |

The substantive draft text + decisions are preserved in:

- `~/dev/myndhyve/docs/plans/WOP-MULTI-AGENT-SHIFT.md` (steward plan-doc, still on disk; 53 inbound code refs)
- `~/dev/wop/RFCS/0007-agent-identity-and-reasoning.md` through `0012-dispatch-loop.md` (archived predecessor repo)
- Reference impl: `~/dev/myndhyve/packages/workflow-engine/src/nodes/core/dispatch.node.ts` + sibling tests
- Capability advertisement reference: `~/dev/myndhyve/services/workflow-runtime/src/routes/discovery.ts` (`agents.dispatch`, `agents.memoryBackends`, etc.)

## Audit matrix

### What survived the v1 reset (8 schemas + 1 conformance scenario)

| Surface | Status |
|---|---|
| `schemas/agent-manifest.schema.json` | present |
| `schemas/memory-entry.schema.json` | present |
| `schemas/memory-list-options.schema.json` | present |
| `schemas/conversation-turn.schema.json` | present |
| `schemas/conversation-event.schema.json` | present |
| `schemas/orchestrator-decision.schema.json` | present |
| `schemas/run-orchestrator-decided-event.schema.json` | present |
| `schemas/dispatch-config.schema.json` | present |
| `conformance/src/scenarios/dispatchLoop.test.ts` | present (Phase 6) |

### Phase 1 (Agent Identity) — gaps

| Surface | Gap |
|---|---|
| `schemas/agent-ref.schema.json` | MISSING — base type referenced by `agent-manifest` + `run-orchestrator-decided-event`, undefined |
| `RunSnapshot.agent: AgentRef` field | NOT in `run-snapshot.schema.json` (relies on `additionalProperties: true`) |
| `agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided` events | NOT in `RunEventType` enum |
| Per-event payload schemas for `agent.*` | NOT in `run-event-payloads.schema.json` |
| `WorkflowNode.agent?` field | NOT in `workflow-definition.schema.json` |
| `message` reducer | NOT documented in `channels-and-reducers.md` |
| `'low-confidence'` suspend reason | NOT in `interrupt.md` or `suspend-request.schema.json` |
| `RunOptions.configurable.escalationThreshold` | NOT in `run-options.md` |
| `RunOptions.configurable.reasoningVerbosity` | NOT in `run-options.md` |
| Conformance: `agentMetadata.test.ts` | missing |
| Conformance: `agentReasoningEvents.test.ts` | missing |
| Conformance: `agentConfidenceEscalation.test.ts` | missing |
| Conformance: `agentMessageReducer.test.ts` | missing |

### Phase 2 (Agent Packs) — gaps

| Surface | Gap |
|---|---|
| `capabilities.agents` block | NOT in `capabilities.schema.json` or `capabilities.md` |
| `capabilities.agents.modelClasses` enum | NOT in capabilities |
| `capabilities.agents.orchestratorPattern` field | NOT in capabilities |
| `capabilities.agents.memoryBackends` enum | NOT in capabilities |
| `pack.json` `agents[]` array | not verified — needs check against `node-pack-manifest.schema.json` |
| Conformance: `agentPackInstall.test.ts` | missing |
| Conformance: `agentPackExport.test.ts` | missing |
| Conformance: `agentPackProvenance.test.ts` | missing |

### Phase 3 (Memory Layer) — gaps

| Surface | Gap |
|---|---|
| Prose spec for `MemoryAdapter` contract | no dedicated doc; `memory-entry` + `memory-list-options` schemas are orphaned |
| `capabilities.agents.memoryBackends: ['long-term']` | NOT in capabilities |
| Cross-tenant isolation invariant (CTI-1) | NOT documented |
| Secret-redaction invariant (SR-1) | NOT documented (check SECURITY/) |
| Conformance: `agentMemoryRoundTrip.test.ts` | missing |
| Conformance: `agentMemoryCrossTenantIsolation.test.ts` | missing |
| Conformance: `agentMemoryRedactionContract.test.ts` | missing |
| Conformance: `agentMemoryTtlExpiry.test.ts` | missing |

### Phase 4 (Conversation Primitive) — gaps

| Surface | Gap |
|---|---|
| `conversation.start` / `conversation.exchange` / `conversation.close` suspend variants | NOT in `interrupt.md` or `suspend-request.schema.json` |
| `conversation.opened` / `conversation.exchanged` / `conversation.closed` events | NOT in `RunEventType` enum |
| `capabilities.conversationPrimitive: true` | NOT in capabilities |
| Conformance: `conversationLifecycle.test.ts` | missing |
| Conformance: `conversationVsLegacySuspend.test.ts` | missing |
| Conformance: `conversationReplayDeterminism.test.ts` | missing |
| Conformance: `conversationCapabilityNegotiation.test.ts` | missing |

### Phase 5 (Orchestrator Role) — gaps

| Surface | Gap |
|---|---|
| `RunSnapshot.runOrchestrator: AgentRef` field | NOT in `run-snapshot.schema.json` |
| `runOrchestrator.decided` event | NOT in `RunEventType` enum |
| `core.orchestrator.supervisor` typeId | NOT in `node-packs.md` core typeId table |
| `capabilities.agents.orchestrator: true` | NOT in capabilities |
| Conservative-path suspend semantics (CP-1) | NOT in `interrupt.md` |
| Conformance: `orchestratorDispatch.test.ts` | missing |
| Conformance: `orchestratorTermination.test.ts` | missing |
| Conformance: `orchestratorConservativePath.test.ts` | missing |

### Phase 6 (Dispatch Loop) — gaps

| Surface | Gap |
|---|---|
| `dispatch-config.schema.json` | ✅ present |
| `conformance/src/scenarios/dispatchLoop.test.ts` | ✅ present |
| `core.dispatch` typeId | NOT in `node-packs.md` core typeId table |
| `capabilities.agents.dispatch: true` | NOT in capabilities |

## Headline metrics

- **8 / 8 multi-agent schemas** exist as files, but they are **orphans** — not `$ref`'d from canonical schemas.
- **0 / ~9 multi-agent event types** are in the `RunEventType` enum.
- **0 / ~6 multi-agent capability flags** are in `capabilities.schema.json` or `capabilities.md`.
- **0 / 4 multi-agent suspend variants** (`conversation.*`) are in `interrupt.md` or `suspend-request.schema.json`.
- **0 / 3 multi-agent core typeIds** (`core.dispatch`, `core.orchestrator.supervisor`, `core.conversationGate`) are in `node-packs.md`.
- **1 / ~19 multi-agent conformance scenarios** is present (only `dispatchLoop.test.ts`).
- **README + CHANGELOG advertise "Multi-Agent Shift (Phases 1-6) complete"** — claim and spec-corpus state are out of alignment.

## Integration plan — chunks A–K

Each chunk is a self-contained logical unit; expected to commit independently.

| # | Chunk | Files touched | Phase deps closed |
|---|---|---|---|
| A | Author `schemas/agent-ref.schema.json` | `schemas/agent-ref.schema.json` (new) | foundation for B, C, D, E |
| B | Extend `RunSnapshot` with `agent` + `runOrchestrator` fields | `schemas/run-snapshot.schema.json` | Phase 1 + Phase 5 |
| C | Extend `RunEventType` enum + add per-event payload schemas | `schemas/run-event.schema.json` + `schemas/run-event-payloads.schema.json` | Phase 1 + 4 + 5 |
| D | Add `WorkflowNode.agent?` field | `schemas/workflow-definition.schema.json` | Phase 1 |
| E | Extend `capabilities` with `agents` block + `conversationPrimitive` | `schemas/capabilities.schema.json` + `spec/v1/capabilities.md` | Phase 2 + 3 + 4 + 5 + 6 |
| F | Add `conversation.*` suspend variants + `'low-confidence'` reason | `schemas/suspend-request.schema.json` + `spec/v1/interrupt.md` | Phase 1 + 4 |
| G | Add `core.dispatch`, `core.orchestrator.supervisor`, `core.conversationGate` to core typeId table | `spec/v1/node-packs.md` | Phase 4 + 5 + 6 |
| H | Document `message` reducer in canonical reducer table | `spec/v1/channels-and-reducers.md` | Phase 1 |
| I | Add `escalationThreshold` + `reasoningVerbosity` to RunOptions configurable | `spec/v1/run-options.md` | Phase 1 |
| J | Backport conformance scenarios (~18 stubs) | `conformance/src/scenarios/*.test.ts` (new) | Phase 1 + 2 + 3 + 4 + 5 |
| K | Document MemoryAdapter contract + CTI-1 + SR-1 prose | new `spec/v1/agent-memory.md` (or fold into existing) | Phase 3 |

## Implementation notes

- **Scope discipline.** This is a spec-corpus integration pass, not a behavior change. Wire-shape contracts already existed in the predecessor RFCs; the work is mechanical re-integration into the new openwop file layout.
- **Schema $id URLs.** All new + updated schemas use `https://openwop.dev/spec/v1/...` $id pattern (the rebrand-canonical domain).
- **Forward-compat.** All new event types extend the `RunEventType` enum under the existing forward-compat rule (readers MUST NOT throw on unknown types). All new RunSnapshot fields are optional. All new capability flags are optional.
- **Reference impl coordination.** The steward host (`~/dev/myndhyve`) already implements + advertises most of these surfaces (`packages/workflow-engine/src/nodes/core/dispatch.node.ts`, `services/workflow-runtime/src/routes/discovery.ts`); the spec corpus is catching up to what's already wired.
- **Conformance stubs.** The 18 missing scenarios will land as minimum-viable stubs that exercise the wire-shape contract end-to-end, not full feature coverage. Each scenario gates on the relevant capability advertisement so pre-Multi-Agent hosts skip cleanly per the existing fixture-gating pattern.

## What this doc is NOT

- Not a normative spec. The chunks A–K below ARE normative once landed.
- Not a behavior change. No new wire-shape contracts are introduced; only re-integration of contracts that existed in the predecessor repo's RFCs.
- Not a roadmap for Phase 7+. RFC 0013 (aggressive path / mid-run graph mutation) remains deferred to v1.3+ per the predecessor plan; only Phases 1–6 are in scope here.

## Coordination across the rebrand

The steward repo (`~/dev/myndhyve`) has a parallel rebrand pass in flight:
- Chunks 1A/1B/1C/2/3 already landed (GitHub URL refs, schema $id URL refs, discovery endpoint alias).
- Chunk 4 (npm dep rename `@myndhyve/wop-conformance` → `@openwop/openwop-conformance`) is blocked on npm publish.

The integration work here (chunks A–K) is **independent** of the steward rebrand and can proceed in parallel. Once both are complete, the steward CI + steward conformance run can validate against openwop's canonical spec corpus.

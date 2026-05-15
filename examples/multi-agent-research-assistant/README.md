# Multi-Agent Research Assistant — Reference Composition

> MA-1 from `plans/openwop-protocol-gap-closure-plan.md` Workstream 6. End-to-end reference walkthrough of the OpenWOP multi-agent surface: how `core.orchestrator.supervisor` + `core.dispatch` + `AgentRef` + reasoning events + HITL approval + memory compose into one workflow.

This example is **documentation-first** — it doesn't ship a runnable host; it composes existing reference fixtures (`conformance/fixtures/conformance-orchestrator-*.json` + `conformance-agent-*.json`) into a single narrative an adopter can read end-to-end. The runnable bits live in the conformance suite + the Postgres reference host.

If you want the runnable surface, see [`examples/hosts/postgres/`](../hosts/postgres/) — it implements every multi-agent capability shape this composition exercises.

---

## The shape

A research-assistant workflow is the canonical multi-agent worked example. A user submits a query; an orchestrator agent decides how to route it across one or more worker agents; workers reason + call tools; the orchestrator gates the final answer through HITL approval before completing.

```
              ┌──────────────────────────┐
              │ run.started              │
              └──────────┬───────────────┘
                         ▼
              ┌──────────────────────────┐
              │ core.orchestrator        │
              │   .supervisor            │   AgentRef:
              │ (RFC 0006)               │   { agentId: "core.research.supervisor",
              │                          │     modelClass: "reasoning" }
              │ Emits:                   │
              │   runOrchestrator.       │
              │     decided              │
              │     { kind: "next-worker"│
              │       nextWorkerIds: ["worker-research"] }
              └──────────┬───────────────┘
                         ▼
              ┌──────────────────────────┐
              │ core.dispatch            │
              │ (RFC 0007)               │
              │                          │   Routes to the named worker
              │ Emits:                   │   workflow ID; child run inherits
              │   node.started for       │   parent's trace context
              │     child run            │
              └──────────┬───────────────┘
                         ▼
              ┌──────────────────────────┐
              │ Worker workflow          │   AgentRef:
              │   (conformance-noop or   │   { agentId: "vendor.example.research-worker",
              │    custom)               │     modelClass: "tool-using",
              │                          │     memoryRef: "mem_<tenant>_<agent>_longTerm" }
              │ Emits:                   │
              │   agent.reasoned         │   ← verbosity-gated per
              │   agent.toolCalled       │     RunOptions.configurable
              │   agent.toolReturned     │     .reasoningVerbosity
              │   agent.decided          │
              └──────────┬───────────────┘
                         ▼
              ┌──────────────────────────┐
              │ core.approvalGate        │
              │                          │
              │ Emits:                   │
              │   approval.requested     │
              │ Suspends:                │
              │   waiting-approval       │
              └──────────┬───────────────┘
                         ▼
              ┌──────────────────────────┐
              │ (HITL resolution via     │
              │  POST /v1/interrupts/   │
              │  {token})                │
              │                          │
              │ Emits:                   │
              │   approval.received      │
              └──────────┬───────────────┘
                         ▼
              ┌──────────────────────────┐
              │ run.completed            │
              └──────────────────────────┘
```

Every event in the boxes above is canonical per [`observability.md`](../../spec/v1/observability.md) §"Canonical run lifecycle event names". Every `AgentRef` shape is normative per [`schemas/agent-ref.schema.json`](../../schemas/agent-ref.schema.json) + RFC 0002.

---

## Reference fixtures this composition uses

| Fixture | Role | Spec doc / RFC |
|---|---|---|
| [`conformance-orchestrator-dispatch`](../../conformance/fixtures/conformance-orchestrator-dispatch.json) | Orchestrator + dispatch topology with mock supervisor decisions | RFC 0006 + RFC 0007 |
| [`conformance-orchestrator-low-confidence`](../../conformance/fixtures/conformance-orchestrator-low-confidence.json) | CP-1 escalation contract — low-confidence supervisor decision suspends with `reason: 'low-confidence'` | RFC 0006 §"Confidence escalation" |
| [`conformance-dispatch-loop`](../../conformance/fixtures/conformance-dispatch-loop.json) | Multi-tick dispatch loop (supervisor → worker → supervisor → terminate) | RFC 0007 §C |
| [`conformance-agent-reasoning`](../../conformance/fixtures/conformance-agent-reasoning.json) | Worker emits `agent.reasoned` + `agent.toolCalled` + `agent.handoff` + `agent.decided` | RFC 0002 + `capabilities.md` §`agents.reasoning` |
| [`conformance-agent-memory-roundtrip`](../../conformance/fixtures/conformance-agent-memory-roundtrip.json) | MemoryAdapter read-side via `list` / `get` with `AgentRef.memoryRef` | RFC 0004 §A |
| [`conformance-agent-memory-redaction`](../../conformance/fixtures/conformance-agent-memory-redaction.json) | SR-1 invariant — BYOK plaintext NEVER lands on memory entries | RFC 0004 §D + SR-1 |
| [`conformance-approval`](../../conformance/fixtures/conformance-approval.json) | HITL approval gate with signed-token callback | `interrupt.md` + `interrupt-profiles.md` |

Each fixture is independently runnable against any host that advertises the relevant capability — see [`docs/PROFILE-DECISION-GUIDE.md`](../../docs/PROFILE-DECISION-GUIDE.md) for which fixtures gate on which `capabilities.*` advertisements.

---

## End-to-end run (against the Postgres reference host)

The Postgres host advertises every capability this composition exercises. Boot it with the full feature set:

```bash
cd examples/hosts/postgres
OPENWOP_MEMORY_COMPACTION=true \
OPENWOP_OAUTH2_ISSUER_URL=https://your-idp/ \
OPENWOP_OAUTH2_AUDIENCE=https://your-host/ \
npm start
```

Run the canonical multi-agent dispatch loop:

```bash
# 1. Discovery should show all 4 multi-agent capabilities advertised.
curl https://your-host/.well-known/openwop | jq '.capabilities | {agents, memory, orchestrator, dispatch}'

# 2. Create a run.
curl -X POST https://your-host/v1/runs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"conformance-orchestrator-dispatch","configurable":{"reasoningVerbosity":"summary"}}'

# 3. Stream events (canonical multi-agent vocabulary).
curl -N "https://your-host/v1/runs/$RUN_ID/events?streamMode=updates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream"
```

The event stream will carry, in order:

1. `run.started`
2. `node.started` (supervisor)
3. `runOrchestrator.decided` — typed `{kind: 'next-worker', nextWorkerIds: [...]}`
4. `agent.reasoned` (verbosity-gated; redacted per RFC 0012 §D if compaction is active)
5. `node.started` (dispatch)
6. `node.started` (child run worker)
7. `agent.toolCalled` + `agent.toolReturned` (paired via shared `callId`; MCP-1 + SR-1 redacted)
8. `agent.decided` (with `confidence ∈ [0, 1]`)
9. `runOrchestrator.decided` — typed `{kind: 'terminate', reason: '...'}`
10. `node.completed` (dispatch)
11. `node.completed` (supervisor)
12. `run.completed`

For a HITL-gated variant, replace `conformance-orchestrator-dispatch` with a fixture that chains an `core.approvalGate` after the dispatch — the run pauses with `waiting-approval` until a `POST /v1/interrupts/{token}` resolves it.

---

## What this composition does NOT do

- **Define agent reasoning internals.** How an agent decides what tool to call, what the prompt looks like, what model serves the call — all host / pack territory. The protocol only normates the events emitted.
- **Specify agent-to-agent transport.** Multi-agent inside one OpenWOP run uses `core.dispatch` (in-host). Cross-host agent messaging composes with [A2A](../../spec/v1/a2a-integration.md) — distinct surface.
- **Mandate memory backends.** The MemoryAdapter contract is wire-level; implementations choose Postgres / Redis / vector DB / etc.
- **Define a planning algorithm.** RFC 0006 supports `single` / `delegate` / `delegate.smart` patterns; hosts choose. The protocol normates the decision-event shape, not the algorithm that produces it.

---

## Cross-host composition (A2A bridge)

When a worker is an external A2A peer rather than an in-host workflow:

1. The orchestrator's `runOrchestrator.decided` emits `kind: 'next-worker'` with the external worker's `AgentRef` referencing an A2A AgentCard.
2. `core.dispatch` routes to an A2A bridge node (host-implementation; not normated) that issues an A2A `message/send` task.
3. The bridge node maps A2A `Task.status` back to OpenWOP run state per [`spec/v1/a2a-integration.md`](../../spec/v1/a2a-integration.md) §"State projection".
4. On the A2A peer's `completed` state, the bridge resumes the local run with the A2A `Task.result`.

The protocol-level boundaries — `AgentRef`, the runOrchestrator decision envelope, the dispatch contract — stay identical regardless of whether the worker is local or remote. The A2A bridge is the only host-implementation surface that differs.

See [`spec/v1/a2a-integration.md`](../../spec/v1/a2a-integration.md) §"Operational mapping table" for the 10 cross-protocol edge cases.

→ Runnable form at [`examples/multi-agent-cross-host/`](../multi-agent-cross-host/README.md). That example boots the conformance suite's `A2AFakePeer`, walks 6 scenarios end-to-end (happy path + drift points #3/#4 + plain failure + cancellation + replay determinism), and exports the canonical projection + bridge functions future hosts can adopt.

---

## Memory compaction (RFC 0012)

When the host advertises `capabilities.memory.compaction.supported: true` (Postgres reference host with `OPENWOP_MEMORY_COMPACTION=true`):

- The orchestrator's `agentRef.memoryRef` points at a long-lived memory scope.
- Host-managed background compaction periodically distills old MemoryEntry rows into newer ones.
- Each compaction emits a canonical `memory.compacted` event per `run-event-payloads.schema.json` §`memoryCompacted`.
- SR-1 carry-forward (RFC 0012 §D) MUST be enforced — derived content passes the BYOK redaction harness.

This is independent of the dispatch loop above; compaction runs on the host schedule. The conformance suite's 3 RFC 0012 scenarios ([`memory-compaction-event-emitted`](../../conformance/src/scenarios/memory-compaction-event-emitted.test.ts) + [`memory-compaction-sr1-carry-forward`](../../conformance/src/scenarios/memory-compaction-sr1-carry-forward.test.ts) + [`memory-compaction-provenance-tag`](../../conformance/src/scenarios/memory-compaction-provenance-tag.test.ts)) verify the surface end-to-end against the Postgres reference.

---

## See also

- [`spec/v1/agent-ref-positioning.md`](../../spec/v1/agent-ref-positioning.md) — `AgentRef` vs W3C DID vs A2A AgentCard vs AGNTCY composition.
- [`RFCS/0002-agent-identity-and-reasoning-events.md`](../../RFCS/0002-agent-identity-and-reasoning-events.md) — canonical `AgentRef` + agent-event vocabulary.
- [`RFCS/0004-memory-layer.md`](../../RFCS/0004-memory-layer.md) — MemoryAdapter + SR-1 secret-redaction invariant.
- [`RFCS/0006-orchestrator.md`](../../RFCS/0006-orchestrator.md) — orchestrator decision shape + CP-1 escalation.
- [`RFCS/0007-dispatch.md`](../../RFCS/0007-dispatch.md) — `core.dispatch` contract.
- [`RFCS/0012-memory-compaction-profile.md`](../../RFCS/0012-memory-compaction-profile.md) — memory compaction + SR-1 carry-forward.
- [`spec/v1/observability.md`](../../spec/v1/observability.md) §"Canonical run lifecycle event names" — the canonical event vocabulary.
- [`docs/PROFILE-DECISION-GUIDE.md`](../../docs/PROFILE-DECISION-GUIDE.md) — which `capabilities.*` advertisements gate which scenarios.
- [`examples/hosts/postgres/README.md`](../hosts/postgres/README.md) — runnable reference host that advertises every capability this composition exercises.

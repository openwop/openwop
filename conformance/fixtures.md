# openwop Conformance Suite — Fixture Workflow Contract

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

| Fixture | `workflowId` | Purpose | Terminal status | Bounded duration |
|---|---|---|---|---|
| Noop | `conformance-noop` | Cheapest possible run-lifecycle test | `completed` | ≤ 5s |
| Identity | `conformance-identity` | Verifies input/output passthrough | `completed` | ≤ 5s |
| Delay | `conformance-delay` | Verifies poll/SSE behavior over time | `completed` | ≤ 30s (input-controlled) |
| Failure | `conformance-failure` | Verifies error-event surface | `failed` | ≤ 5s |
| Approval | `conformance-approval` | Verifies HITL approval interrupt + resume | `completed` after resolve | unbounded (suspends) |
| Clarification | `conformance-clarification` | Verifies HITL clarification interrupt + resume | `completed` after resolve | unbounded (suspends) |
| Multi-node | `conformance-multi-node` | Verifies edge ordering + per-node events | `completed` | ≤ 10s |
| Idempotent | `conformance-idempotent` | Verifies `Idempotency-Key` cache | `completed` | ≤ 5s |
| Cancellable | `conformance-cancellable` | Verifies `:cancel` endpoint mid-run | `cancelled` after cancel | ≤ 60s (input-controlled) |
| Capability Missing | `conformance-capability-missing` | Verifies dispatch refusal on unsatisfied `requires` | `failed` (`error.code='capability_not_provided'`) | ≤ 5s |
| Prompt End-to-End | `conformance-prompt-end-to-end` | RFC 0027 + RFC 0029 end-to-end. Single `mock-ai` node with `config.systemPromptRef` set; host MUST emit `agent.promptResolved` + `prompt.composed` events during dispatch, then complete. Capability-gated on `capabilities.prompts.supported`. | `completed` | ≤ 10s |
| Dispatch Loop | `conformance-dispatch-loop` | Verifies `core.dispatch` loop mechanism | `completed` | ≤ 30s |
| Interrupt — Quorum | `conformance-interrupt-quorum` | Verifies `openwop-interrupt-quorum` profile (multi-approver, majority rejection) | `completed` after 3 accepts, `failed` after quorum reject | unbounded (suspends) |
| Interrupt — External Event | `conformance-interrupt-external-event` | Verifies `openwop-interrupt-external-event` profile (correlation-matched callback) | `completed` after matching POST, `failed` on timeout | ≤ 60s (timeoutMs configured) |
| Interrupt — Auth Required | `conformance-interrupt-auth-required` | Verifies `openwop-interrupt-auth-required` profile (bearer-token resume only) | `completed` after bearer resolve | unbounded (suspends) |
| Interrupt — Parent/Child Cancel | `conformance-interrupt-parent-child-cancel` + `conformance-interrupt-parent-child-cancel-child` | Verifies `openwop-interrupt-parent-child` cancel cascade | `cancelled` (both runs) | ≤ 30s |
| Agent Identity | `conformance-agent-identity` | Phase 1 — `RunSnapshot.agent` / `runOrchestrator` AgentRef wire-shape | `completed` | ≤ 10s |
| Agent Reasoning | `conformance-agent-reasoning` | Phase 1 / RFC 0023 — `agent.*` event family emission + `callId` pairing on `core.conformance.mock-agent` | `completed` | ≤ 15s |
| Agent Reasoning Streaming | `conformance-agent-reasoning-streaming` | RFC 0024 — `core.conformance.mock-agent` with `mockReasoning.streamChunks` drives incremental `agent.reasoning.delta` events (sequence 0..N-1) followed by exactly one closing `agent.reasoned` whose `reasoning` equals the concatenation. Gated on `capabilities.agents.reasoning.streaming: true`. | `completed` | ≤ 15s |
| Agent Low-Confidence | `conformance-agent-low-confidence` | Phase 1 / CP-1 / RFC 0023 — `core.conformance.mock-agent` emits `agent.decided` with confidence < threshold; host MUST follow with `node.suspended { reason: 'low-confidence' }` | `waiting-approval` (suspends) | unbounded (suspends) |
| Message Reducer | `conformance-message-reducer` | Phase 1 — `message` reducer idempotency on duplicate `messageId` | `completed` | ≤ 10s |
| Agent Pack Install | `conformance-agent-pack-install` | Phase 2 — pack `agents[]` surface as AgentManifest at `GET /v1/packs` | `completed` | ≤ 5s |
| Agent Pack Export | `conformance-agent-pack-export` | Phase 2 — workspace agents project to AgentManifest at `GET /v1/packs/export` | `completed` | ≤ 5s |
| Agent Pack Provenance | `conformance-agent-pack-provenance` | Phase 2 — `sourceManifestId` provenance round-trip | `completed` | ≤ 10s |
| Agent Pack Handoff Schema Validation | `conformance-agent-pack-handoff-schema-validation` | Phase 2 / HV-1 — host validates dispatch payloads against `handoff.taskSchemaRef` AND return payloads against `handoff.returnSchemaRef` per RFC 0003 §D. Three branches: valid-task → `completed`; invalid-task → `failed` with structured violation; mock-return-violation → violation surfaced before persistence. | varies by scenario | ≤ 5s |
| Dispatch Input Mapping | `conformance-dispatch-input-mapping` | RFC 0022 §A / HVMAP-1a — host honors `inputMapping` on `core.dispatch`. Capability-gated on `capabilities.agents.dispatchMapping`. | `completed` | ≤ 5s |
| Dispatch Output Mapping | `conformance-dispatch-output-mapping` | RFC 0022 §A / HVMAP-1b — host harvests child variables via `outputMapping` on `core.dispatch`. Capability-gated on `capabilities.agents.dispatchMapping`. | `completed` | ≤ 5s |
| Dispatch Cross-Worker Handoff | `conformance-dispatch-cross-worker-handoff` | RFC 0022 §A / HVMAP-1c — sequential fan-out: child-a writes via `perWorkerOutputMappings`, child-b reads via `perWorkerInputMappings`. Capability-gated on `capabilities.agents.dispatchMapping`. | `completed` | ≤ 10s |
| subWorkflow Input Mapping | `conformance-subworkflow-input-mapping` | RFC 0022 §B / HVMAP-2 — host honors `inputMapping` on `core.subWorkflow`; overrides matching `defaultValue` declarations on the child. Capability-gated on `capabilities.subWorkflow.inputMapping`. | `completed` | ≤ 10s |
| subWorkflow Input Mapping (child) | `conformance-subworkflow-input-mapping-child` | RFC 0022 §B / HVMAP-2 — child workflow for the input-mapping scenario. Declares `receivedPrdId.defaultValue='baked-in'`; parent's `inputMapping` MUST override that default. Single noop node; final variables read via `GET /v1/runs/{runId}` for the assertion. | `completed` | ≤ 5s |
| Dispatch Input Mapping (child) | `conformance-dispatch-input-mapping-child` | RFC 0022 §A / HVMAP-1a — child workflow for the dispatch input-mapping scenario. Single noop node; the scenario reads this child's `inputs_json` via `GET /v1/runs/{childRunId}` and asserts `inputs.childGreeting === 'Alice'`. | `completed` | ≤ 5s |
| Dispatch Output Mapping (child) | `conformance-dispatch-output-mapping-child` | RFC 0022 §A / HVMAP-1b — child workflow for the dispatch output-mapping scenario. Declares `childOutcome.defaultValue='done'`; on terminal, parent's `outputMapping` harvests `childOutcome → parentResult`. | `completed` | ≤ 5s |
| Dispatch Cross-Worker Handoff (child-a) | `conformance-dispatch-cross-worker-handoff-child-a` | RFC 0022 §A / HVMAP-1c — first child of the cross-worker-handoff scenario. Declares `output.defaultValue='hello'`; on terminal, parent's `perWorkerOutputMappings.child-a` harvests `output → sharedVar`. | `completed` | ≤ 5s |
| Dispatch Cross-Worker Handoff (child-b) | `conformance-dispatch-cross-worker-handoff-child-b` | RFC 0022 §A + §D / HVMAP-1c — second child of the cross-worker-handoff scenario. Sequential fan-out — runs after child-a; receives parent's `sharedVar` via `perWorkerInputMappings.child-b` onto its `input` input. Scenario reads child-b's `inputs_json` to assert `inputs.input === 'hello'`. | `completed` | ≤ 5s |
| Dispatch Input Mapping — unset variant | `conformance-dispatch-input-mapping-no-default` | RFC 0022 §A / HVMAP-1a-null — parent variant that DECLARES `parentName` but OMITS its `defaultValue`. The dispatch's `inputMapping` projects an unset parent variable; per §A normative bullet, child `inputs.childGreeting` MUST surface as `undefined` (NOT `null`, NOT omitted). Reuses `conformance-dispatch-input-mapping-child`. | `completed` | ≤ 30s |
| subWorkflow Input Mapping — unset variant | `conformance-subworkflow-input-mapping-no-default` | RFC 0022 §B / HVMAP-2-unset — parent variant that DECLARES `currentPrdId` but OMITS its `defaultValue`. Per §B, the unset projection MUST surface as `undefined` (NOT `null`) — distinct from the child's own `defaultValue` fold. Reuses `conformance-subworkflow-input-mapping-child`. | `completed` | ≤ 10s |
| subWorkflow Mid-Run Mutation (parent) | `conformance-subworkflow-mid-run-mutation` | RFC 0022 §B / HVMAP-2-no-midrun-propagation — `inputMapping` is a one-shot fold at child-dispatch time. Parent declares `currentPrdId='seeded-id'`, dispatches child with `inputMapping`, then test mutates the parent variable via `POST /v1/host/sample/test/runs/:parentRunId/variables` WHILE the child is suspended. The child's `receivedPrdId` MUST remain at the dispatch-time fold (`seeded-id`), proving mid-run parent mutations do NOT propagate. | `completed` | ≤ 30s |
| subWorkflow Mid-Run Mutation (child) | `conformance-subworkflow-mid-run-mutation-child` | RFC 0022 §B / HVMAP-2-no-midrun-propagation — child workflow with a `core.approvalGate` that suspends so the parent can mutate its variable bag mid-run. Declares `receivedPrdId.defaultValue='baked-in'` (overridden at dispatch by inputMapping). | `completed` | ≤ 30s |
| Dispatch Per-Worker Mapping Override | `conformance-dispatch-per-worker-override` | RFC 0022 §A / HVMAP-1c-override — parent with BOTH a default `inputMapping` (`{ input: 'defaultX' }`) AND `perWorkerInputMappings.child-b: { input: 'sharedVar' }`. Verifies `effectiveInputMapping` precedence per §A: child-a receives the default, child-b receives the override. Reuses `conformance-dispatch-cross-worker-handoff-child-a` + `-child-b`. | `completed` | ≤ 30s |
| Dispatch deterministic-fail child | `conformance-dispatch-deterministic-fail-child` | RFC 0022 §B / HVMAP-1b-failed — child workflow that ALWAYS terminates `failed` via `core.fail`. Used by `conformance-dispatch-output-mapping` to verify the parent's `outputMapping` is SKIPPED when the child fails terminally. | `failed` | ≤ 5s |
| Dispatch cancellable child | `conformance-dispatch-cancellable-child` | RFC 0022 §B / HVMAP-1b-cancelled — child workflow with a long `core.delay` so the test cancels it externally via `POST /v1/runs/{childRunId}/cancel`. Verifies the parent's `outputMapping` is SKIPPED when the child terminates `cancelled`. | `cancelled` | ≤ 60s |
| Agent Memory Round-Trip | `conformance-agent-memory-roundtrip` | Phase 3 — `MemoryAdapter.list/get` write → read | `completed` | ≤ 15s |
| Agent Memory Cross-Tenant | `conformance-agent-memory-cross-tenant` | Phase 3 / CTI-1 — cross-tenant probe MUST return `[]` / `null` | `completed` | ≤ 10s |
| Agent Memory Redaction | `conformance-agent-memory-redaction` | Phase 3 / SR-1 — BYOK plaintext surfaces as `[REDACTED:<id>]` on read | `completed` | ≤ 15s |
| Agent Memory TTL | `conformance-agent-memory-ttl` | Phase 3 — `expiresAt` excludes expired entries from list/get | `completed` | ≤ 10s |
| Conversation Lifecycle | `conformance-conversation-lifecycle` | Phase 4 — open → exchange → close event ordering | `completed` | ≤ 20s |
| Conversation vs Clarification | `conformance-conversation-vs-clarification` | Phase 4 — conversation suspend emits `conversation.*`, NOT `clarification.*` | `completed` | ≤ 15s |
| Conversation Replay | `conformance-conversation-replay` | Phase 4 — `:fork` preserves conversation channel projection | `completed` | ≤ 30s |
| Conversation Capability Negotiation | `conformance-conversation-capability-negotiation` | Phase 4 — INVERTED gate: hosts without `conversationPrimitive: true` MUST refuse | `failed` / refusal | ≤ 5s |
| Orchestrator Dispatch | `conformance-orchestrator-dispatch` | Phase 5 — supervisor → `next-worker` → dispatch round-trip | `completed` | ≤ 60s |
| Orchestrator Terminate | `conformance-orchestrator-terminate` | Phase 5 / CO-3 — terminate decision is final | `completed` | ≤ 30s |
| Orchestrator Low-Confidence | `conformance-orchestrator-low-confidence` | Phase 5 / CP-1 — supervisor low-confidence suspend | `waiting-approval` (suspends) | unbounded (suspends) |
| MCP Tool Roundtrip | `conformance-mcp-tool-roundtrip` | Track 6 — host invokes a tool on the conformance suite's synthetic MCP server; trust-boundary visibility in the event log | `completed` | ≤ 30s |
| A2A Task Roundtrip | `conformance-a2a-task-roundtrip` | Track 6 — host consumes the conformance suite's synthetic A2A peer; covers drift points #3 (`AUTH_REQUIRED`) and #4 (`REJECTED`) | `failed` or `waiting-input` (per `driftScenario` input) | ≤ 30s |
| WASM Pack Roundtrip | `conformance-wasm-pack-roundtrip` | RFC 0008 — invokes `vendor.openwop.rust-hello.greet` (loaded WASM pack); exercises required exports + at least one import | `completed` | ≤ 10s |
| WASM Pack Memory-Cap Breach | `conformance-wasm-pack-memory-cap-breach` | RFC 0008 §K — invokes the deliberately-misbehaving `vendor.openwop.misbehaving.memory-bomb` pack (allocates 1 GiB beyond the host's `memoryPagesMax`). Host MUST emit `cap.breached` with `kind: "wasm-memory"` and drive the run to terminal `failed`. Misbehaving pack lives at `examples/packs/rust-misbehaving-memory/` and is fixture-only (NOT signed for registry publication). | `failed` (with `cap.breached`) | ≤ 10s |
| Configurable Schema | `conformance-configurable-schema` | Track 13 — workflow declares `configurableSchema` (`additionalProperties: false`, `recursionLimit: integer ≥ 1`). Suite verifies `GET /v1/workflows/{id}` surfaces the schema AND `POST /v1/runs` with a mismatched `configurable` returns `validation_error`. | `completed` (with accepted overlay) | ≤ 5s |
| Smoke — BYOK Roundtrip | `openwop-smoke-byok-roundtrip` | End-to-end BYOK secret-resolution smoke. Single `conformance.secret.echo` node fetches the host-provisioned canary secret `openwop-conformance-canary-secret`, emits SHA-256 hex + byte length to variables — never the raw value. Spec: `run-options.md` §"Credential references" + `auth.md` §"Secret resolution" + `observability.md` §"Redaction". | `completed` | ≤ 10s |
| Smoke — Cost Emit (G6 allowlist) | `openwop-smoke-cost-emit` | End-to-end cost-attribute allowlist smoke (G6 / O4). Single `conformance.cost.emit` node configured with a mix of allowlisted `openwop.cost.*` attributes + one non-allowlisted key + one credential-shaped canary under a non-allowlisted name. Scenario reads the live OTel span (when `OPENWOP_OTEL_COLLECTOR=true`) and asserts the cost-namespace attrs ⊆ `OPENWOP_COST_ATTRIBUTE_NAMES` AND that no canary plaintext leaks. Pairs with the `cost-attribution-allowlist-redaction` SECURITY invariant. Spec: `observability.md §"Cost attribution attributes"`. | `completed` | ≤ 10s |

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

This fixture is the canonical `messages`-mode test. Once it's wired into the conformance suite, the suite gains 5+ new server-required scenarios. Servers that don't yet support the mock-provider extension can mark this fixture optional in their conformance manifest until they do.

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

## NodeModule registration

The fixtures reference these typeIds:

| typeId | Required by | Behavior |
|---|---|---|
| `core.noop` | noop, multi-node, approval, clarification, cancellable | Immediate completion, no output |
| `core.identity` | identity | Echo `input.payload` to `output.payload` |
| `core.delay` | delay, cancellable | Sleep `config.delayMs` ms |
| `core.fail` | failure | Throw with `code: "conformance_test_failure"`, message: "Intentional conformance failure" |
| `core.approvalGate` | approval | Call `ctx.interrupt({kind: 'approval', ...})` |
| `core.clarificationGate` | clarification | Call `ctx.interrupt({kind: 'clarification', ...})` |
| `conformance.requiresMissing` | capability-missing | Declares `requires: ['conformance.never-provided']`; engine MUST refuse dispatch. Opt-in fixture registration is recommended so production deployments don't expose the fixture surface. |

An OpenWOP-compliant server's NodeModule registry MUST include implementations for all six core typeIds before seeding fixtures. The `conformance.requiresMissing` fixture node is opt-in — see the row above.

---

## Versioning

Each fixture's JSON has its own `version` field. The OpenWOP v1.0 conformance suite targets fixture version 1.0. Fixture spec breaking changes MUST bump the major; the suite MUST refuse to run against an unrecognized fixture version with a clear error message.

---

## File layout

```
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
```

Each JSON is a valid `WorkflowDefinition` per `../schemas/workflow-definition.schema.json`. Servers MUST treat them as opaque blobs to seed verbatim — do not transform field names or strip fields.

---

## Pack-manifest fixtures

The `fixtures/pack-manifests/` sub-directory holds canonical pack manifests used as schema-level proof points (validated server-free against `../schemas/node-pack-manifest.schema.json`). They are NOT seeded into a server — they exist to assert the canonical schema accepts each documented pack-name scope.

| Fixture | `name` | Purpose |
|---|---|---|
| `pack-private-example` | `private.example-host.example-tools` | Asserts the v1.0 pack-name pattern accepts the `private.<host>.*` scope reserved for host-internal registries. |

Pack-manifest fixtures are exercised by the server-free `fixtures-valid.test.ts` scenarios — adding one runs the schema validator against it automatically.

---

## Prompt-template fixtures

The `fixtures/prompt-templates/` sub-directory holds canonical PromptTemplate documents (per RFC 0027 §A) used as schema-level proof points (validated server-free against `../schemas/prompt-template.schema.json`). They are NOT seeded into a workflow store. They exist so the `prompt-template-shape` scenario has stable positive fixtures, the secret-redaction + trust-marker conformance scenarios have known fixture templateIds to compose against (when a host advertises `capabilities.prompts.supported: true` + `observability: "full"`), and follow-up RFCs (RFC 0028 prompt packs, RFC 0029 resolution chain) can reference a stable shared fixture set.

| Fixture | `templateId` | Purpose |
|---|---|---|
| `conformance-prompt-writer-system` | `conformance.prompt.writer-system` | Minimal `kind: "system"` template with no variables. Asserts positive round-trip against the canonical schema. |
| `conformance-prompt-secret-redaction` | `conformance.prompt.secret-redaction` | `kind: "user"` template carrying a `source: "secret"` variable. Drives `prompt-composed-secret-redaction` scenario; the host's compose seam binds `apiKey` to a canary-marker secret and the scenario asserts the `[REDACTED:<secretId>]` marker appears in `prompt.composed` payload. |
| `conformance-prompt-trust-marker` | `conformance.prompt.trust-marker` | `kind: "user"` template with a `source: "input"` variable. The conformance compose seam tags the binding `meta.contentTrust: "untrusted"` so the `prompt-composed-trust-marker` scenario asserts `<UNTRUSTED>...</UNTRUSTED>` wrapping + `contentTrust: "untrusted"` propagation. |

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

# `@openwop/openwop-conformance` Changelog

## [1.2.0] — 2026-05-18

Minor bump per `PUBLISHING.md` §"Versioning alignment" — conformance scenario additions land on a minor. Captures the RFC 0022 + RFC 0023 fixture/scenario surface that landed across `cf7df05`, `02a84e1`, `a8a8594`, `f94d2e1`, `87c5de7`, `22d9f92`, `a025a85`, and `a65ea0e`.

### Added

- **RFC 0023 — Conformance agent-event emitters.** New conformance-only `core.conformance.mock-agent` typeId schema (`schemas/core-conformance-mock-agent-config.schema.json`) carrying five test hooks (`mockReasoning`, `mockToolCalls`, `mockHandoff`, `mockDecision`, `mockConfidence`) that drive deterministic `agent.*` event emission. New `capabilities.conformance.mockAgent: boolean` advertisement (RFC 0023 §B.2). The two affected fixtures (`conformance-agent-reasoning`, `conformance-agent-low-confidence`) re-pinned from `core.identity` (a passthrough primitive) to the new conformance-only typeId — removes the prior undocumented host-side `emitReasoningTrace` / `mockConfidence` hooks on `core.identity` that downstream hosts adopted by reading existing implementations. Authorized-Emitters table for the `agent.*` family added to `spec/v1/node-packs.md` (normative pointer to RFC 0023 §A).
- **RFC 0022 — `core.dispatch` + `core.subWorkflow` runtime variable mapping.** Four new behavioral scenarios graduated from `it.todo()`: HVMAP-1a (`dispatch.inputMapping` projection), HVMAP-1b (`dispatch.outputMapping` harvest with skip-on-failure semantics), HVMAP-1c (sequential cross-worker handoff via `perWorker{Input,Output}Mappings`), HVMAP-2 (`subWorkflow.inputMapping` seeding overriding `defaultValue`). Capability flags `capabilities.agents.dispatchMapping` + `capabilities.subWorkflow.inputMapping` added with normative refusal-at-registration semantics.
- **New fixtures.** `conformance-dispatch-{input,output,cross-worker-handoff}-mapping` (3 supervisor + dispatch parent topologies), `conformance-dispatch-{input,output}-mapping-child` (2 child fixtures), `conformance-dispatch-cross-worker-handoff-child-{a,b}` (2 child fixtures), `conformance-subworkflow-input-mapping{,-child}` (parent + child). Catalog in `conformance/fixtures.md` reflects all rows.
- **Supervisor conformance hooks.** `spec/v1/node-packs.md` §`core.orchestrator.supervisor` row documents three test-only config keys: `mockConfidence` (existing, normalized), `mockPendingDecision` (existing, normalized), `mockDispatchPlan` (new — `OrchestratorDecision[]` indexed by prior decision count; lets fixtures script multi-worker dispatch sequences without an LLM). All three are conformance-only and gated by `capabilities.conformance.mockAgent` when used outside conformance-prefixed workflow ids.

### Tightened

- **`agentReasoningEvents.test.ts` causationId chain.** Now asserts `agent.toolReturned.causationId === paired agent.toolCalled.eventId` per the normative MUST in RFC 0002 §B (`agentToolReturned`). Previously the scenario only validated callId pairing, masking impl deviations on the strict event-log identity chain that `spec/v1/replay.md` §"Determinism with non-deterministic agents" depends on. Gated on the matched `agent.toolCalled.eventId` actually surfacing in the host's `/events` projection — hosts that omit eventId from their projection skip-equivalent (and SHOULD add it).
- **`agentReasoningEvents.test.ts` per-event-type identity check.** Per-event-type branching in the `payload.agentId` assertion: `agent.handoff` is now checked against the canonical `fromAgentId` + `toAgentId` shape (per `run-event-payloads.schema.json` §`agentHandoff`); the other four events stay on the `agentId` field. Previously the blanket `payload.agentId` check was over-strict against the canonical handoff schema.

### Compatibility

Strictly additive at the scenario level; the causationId tightening is a behavioral assertion against a normative MUST that was previously under-tested. Hosts that already honor RFC 0002 §B (`causationId` MUST equal the paired `agent.toolCalled.eventId`) continue to pass. Hosts using callId-only pairing without setting `causationId` were previously passing despite a normative-MUST deviation; they now fail and need to ship the executor extension that returns eventId synchronously from `appendEvent` (the Postgres reference host pattern is the recommended migration path — see `examples/hosts/postgres/src/server.ts` `makeEventId(runId, calledEv.seq)`).

### Notes

- `@openwop/openwop@1.1.x` SDK + spec corpus surface are unchanged by this conformance bump — only the conformance package re-publishes per the `openwop-conformance/v*` tag → `publish-conformance` job in `PUBLISHING.md` §"Tag conventions."
- A handful of `it.todo()` cases remain in the dispatch + subWorkflow scenarios (unset-variable projection, capability-refusal, child-failed/cancelled outputMapping skip, per-worker override precedence, mid-run no-propagation). These are tracked as future work and require conformance-harness extensions (capability-toggle hook, deterministic-fail child fixture, cancellable child fixture, fixture variants omitting defaultValues) outside the scope of this release.

## [1.0.0] — 2026-05-10

Reset to the OpenWOP v1.0 production-release baseline.

### What's covered

- Server-free spec-corpus validation across JSON Schemas, OpenAPI, AsyncAPI, REST endpoint docs, fixture docs, SDK helper surfaces, and TypeScript publish artifacts.
- Black-box scenarios for discovery, workflow listing, run lifecycle, events, interrupts, cancellation, replay/fork behavior, idempotency, concurrency, malicious manifests, and route coverage.
- Packaged API contracts (`api/`, `schemas/`, fixtures, and coverage docs) so installed conformance runs do not depend on a repository checkout.
- Production metadata gates for package names, licenses, repository URLs, stale import paths, and v1.0 release posture.

### v1.x additions

- Reference deployment compatibility matrix automation.
- Optional server-required scenario bundles for deployment-specific auth and credential profile checks.

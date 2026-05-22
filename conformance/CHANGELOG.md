# `@openwop/openwop-conformance` Changelog

## [1.5.0] — 2026-05-22

Minor bump per `PUBLISHING.md` §"Versioning alignment" — unblocks MyndHyve's RFC 0044 + RFC 0039 Half A co-graduation by shipping the relaxed + RFC-0044-routing assertion logic in `multi-agent-confidence-escalation.test.ts`. No new scenario files; no new fixtures. Behavioral honesty pass on 8 sandbox scenarios + schema additions for the new RFC 0044 capability advertisement.

### Changed — RFC 0044 interrupt-kind routing in `multi-agent-confidence-escalation.test.ts`

Previously the scenario asserted `expect(terminal.status).toBe('waiting-clarification')` — strict equality on the clarify-kind escalation path, which rejected even RFC 0039 §A's own escalate-approval path (→ `waiting-approval`). v1.5.0 ships the relaxed + RFC-0044-routing logic landed in upstream commits `f03d01d` (relaxation to accept both canonical statuses) + `641d088` (RFC 0044 vendor-kind routing):

- **Canonical kind advertised** (`clarification` / `approval`) → strict `expect(terminal.status).toBe('waiting-clarification' | 'waiting-approval')`.
- **Vendor kind advertised** (`x-host-<host>-<kind>` per `host-extensions.md` §"Canonical prefixes") → `expect(terminal.status.startsWith('waiting-')).toBe(true)`; the host's `interrupt.md` mapping determines the suffix.
- **No advertisement** → fall back to the canonical either-status check (preserves the `f03d01d` relaxation).

This unblocks MyndHyve's `confidenceEscalationInterruptKind: 'x-host-myndhyve-low-confidence'` advertisement (their entrenched `interrupt.kind: 'low-confidence'` → `waiting-approval` mapping) without forcing a cross-cutting rename of `LOW_CONFIDENCE_SUSPEND_REASON` + `mockAgent.node` + `escalationThreshold.ts` + downstream UI consumers. See RFC 0044 §B (`RFCS/0044-confidence-escalation-interrupt-kind-advertisement.md`) for the normative contract.

### Changed — Sandbox scenarios converted vacuous `expect(true).toBe(true)` to `it.todo` (honesty pass)

The 8 `sandbox-*.test.ts` scenarios in v1.4.0 carried `expect(true).toBe(true)` tautology assertions for their behavioral legs. v1.5.0 converts them to `it.todo()` per upstream commit `5864a2f`:

- `sandbox-no-host-process-escape.test.ts`
- `sandbox-no-network-escape.test.ts`
- `sandbox-no-host-fs-escape.test.ts`
- `sandbox-no-host-env-leak.test.ts`
- `sandbox-timeout-cap.test.ts`
- `sandbox-memory-cap.test.ts`
- `sandbox-no-cross-pack-mutation.test.ts`
- `sandbox-capability-gate-respected.test.ts`

Test reporters now surface 8 todos instead of 8 vacuous passes. The advertisement-shape probes (in `sandbox-no-host-fs-escape`, `sandbox-memory-cap`, `sandbox-timeout-cap`) still run real discovery-doc assertions when capabilities are advertised. Behavioral assertions light up when a sandbox-executing reference host wires the seam.

### Changed — `schemas/capabilities.schema.json` (vendored): adds `multiAgent.executionModel.confidenceEscalationInterruptKind`

Per RFC 0044 §A. The optional field accepts the canonical literal `"clarification"` / `"approval"` OR a vendor extension matching `^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$` per `host-extensions.md` §"Canonical prefixes". Required for the routing logic above; absent advertisement falls back to the canonical-status check.

### No new scenario files

Scenario file count unchanged at 205 (the v1.4.0 baseline). All changes are behavior modifications to existing files.

### Known limits — unchanged from v1.4.0

The 6 `it.todo` behavioral assertions across RFC 0034 OTel-seam-gated, RFC 0040 traceparent-propagation, RFC 0041 refusal-divergence + observable-sequence scenarios remain. The 8 sandbox `it.todo` assertions are new in v1.5.0 (replacing the v1.4.0 vacuous-pass shapes).

## [1.4.0] — 2026-05-22

Minor bump per `PUBLISHING.md` §"Versioning alignment" — bundles 45 new conformance scenarios + 23 new fixtures landing since the 1.3.0 publish (2026-05-19). Unblocks non-steward host adoption of RFCs 0027 + 0028 + 0029 + 0030 + 0031 + 0032 + 0033 + 0034 + 0035 + 0036 + 0037 + 0039 + 0040 + 0041 against a single suite version.

### Added — RFC 0030-0033 envelope LLM-contract-hardening (Accepted 2026-05-21)

12 new scenarios + 7 new fixtures covering the envelope-reliability surface:
- **Reasoning** — `envelope-reasoning-shape.test.ts` (always-on; OPTIONAL `reasoning` property on the 3 universal-kind schemas), `envelope-reasoning-secret-redaction.test.ts` (RFC 0034 OTel-seam-gated; SR-1 redaction probe).
- **Tier-1 subset** — `envelope-tier-one-subset-static.test.ts` (always-on for the no-`oneOf`/`allOf`/`not`/`prefixItems`/`propertyNames` rule; strict-mode gated for OpenAI-only constraints).
- **Variant discriminator** — `envelope-variant-discriminator-static.test.ts` (always-on; every `anyOf` branch declares a single-string-enum discriminator in `required`).
- **Model capability gating** — `model-capability-substituted.test.ts` (advertisement-shape probe on `capabilities.modelCapabilities.advertised[]`), `model-capability-insufficient.test.ts`, `node-module-required-capabilities-shape.test.ts`.
- **Envelope reliability events** — `envelope-retry-attempted.test.ts` (shared advertisement-shape probe for both MUST-tier events per RFC 0032 §C), `envelope-retry-exhausted.test.ts`, `envelope-refusal-shape.test.ts`, `envelope-truncated.test.ts`, `envelope-nl-to-format-engaged.test.ts`, `envelope-recovery-applied.test.ts`. Paired with SECURITY invariants `envelope-refusal-no-prompt-leak` + `envelope-recovery-no-content-leak`.
- **RFC 0033 truncation-vs-schema-violation** — `envelope-completion-distinguishes-truncation.test.ts`, `envelope-truncation-cap-exhaustion.test.ts`.

Fixtures: `conformance-envelope-{retry-attempted, retry-exhausted, refusal, truncated, truncation-cap-exhaustion, nl-to-format-engaged, recovery-applied}.json`.

### Added — RFC 0027 + 0028 + 0029 prompts track (Active; path-to-Accepted is non-steward adoption)

11 new scenarios + 9 new fixtures covering the prompts surface:
- **Wire shape (RFC 0027)** — `prompt-template-shape.test.ts` (always-on Ajv compile + round-trip), `prompt-composed-secret-redaction.test.ts` (capability-gated SR-1 probe), `prompt-composed-trust-marker.test.ts` (RFC 0020 §D `<UNTRUSTED>...</UNTRUSTED>` propagation), `prompt-all-four-kinds-events.test.ts` (system/user/schema-hint/few-shot end-to-end), `prompt-end-to-end-events.test.ts` (full prompt lifecycle through `core.openwop.local.sample.demo.mock-ai`).
- **Library endpoints (RFC 0028)** — `prompt-list-and-fetch.test.ts` (`GET /v1/prompts` + `GET /v1/prompts/:templateId`), `prompt-mutable-lifecycle.test.ts` (`POST`/`PATCH`/`DELETE`), `prompt-render-deterministic.test.ts` (`POST /v1/prompts/:templateId:render` deterministic output), `prompt-pack-install.test.ts` (`kind: "prompt"` pack boot-time install + `?source=pack` filter).
- **Resolution chain (RFC 0029)** — `prompt-resolution-chain-node-wins.test.ts` (layer 1 supersedes 2-4), `prompt-resolution-chain-agent-intrinsic.test.ts` (layer 2 wins when no layer 1), `prompt-resolution-chain-fallback-cascade.test.ts` (layer 3 → 4 → null cascade; chain[] always lists every attempted layer).

Fixtures: `conformance-prompt-{all-four-kinds, end-to-end}.json` plus the per-template directory at `fixtures/prompt-templates/` (`conformance-prompt-{writer-system, writer-user, schema-hint, few-shot, few-shot-2, secret-redaction, trust-marker}.json`).

### Added — RFC 0035 sandbox execution contract (Active; reference-impl-tier today, protocol-tier on first sandbox host)

8 new scenarios — one per failure-mode invariant in `host-capabilities.md` §"Sandbox execution contract (RFC 0035)":
- `sandbox-capability-gate-respected.test.ts` — `sandbox_capability_denied` envelope when a sandbox call hits a capability not in `allowedHostCalls`.
- `sandbox-memory-cap.test.ts` — `sandbox_memory_exceeded` envelope when memory cap breached.
- `sandbox-timeout-cap.test.ts` — `sandbox_timeout` envelope when wall-clock cap breached.
- `sandbox-no-cross-pack-mutation.test.ts` — sandboxed pack A cannot mutate state owned by sandboxed pack B.
- `sandbox-no-host-env-leak.test.ts` — host environment variables MUST NOT be visible inside the sandbox.
- `sandbox-no-host-fs-escape.test.ts` — `sandbox_escape_attempt` with `escapeKind: "host-fs-escape"` envelope.
- `sandbox-no-host-process-escape.test.ts` — `sandbox_escape_attempt` with `escapeKind: "host-process-escape"` envelope.
- `sandbox-no-network-escape.test.ts` — sandboxed code MUST NOT egress to networks not in `allowedHostCalls`.

(Canonical scenario naming is `sandbox-*`; RFC 0035 prose that names them `node-pack-sandbox-*` will reconcile in a follow-up edit.)

### Added — RFC 0036 multi-region + cross-engine ordering (Active; path-to-Accepted is Postgres-host simulator + non-steward host)

1 new scenario:
- `cross-engine-append-ordering.test.ts` — capability-gated on `eventLog.crossEngineOrdering.supported: true`; asserts append-ordering invariants across `core.engine.append` calls from concurrent engines.

(`multi-region-idempotency.test.ts` remains shape-only pending multi-region simulator or deployment; tracked in `docs/KNOWN-LIMITS.md`.)

### Added — RFC 0037 multi-agent execution model Phase 1 (Active; reference workflow-engine advertises)

1 new scenario + 2 fixtures:
- `multi-agent-handoff-state-machine.test.ts` — advertisement-shape probe (always-on) + behavioral assertion (capability-gated on `multiAgent.executionModel.supported: true`) covering the 7 handoff state-machine transition events with chained `causationId`.

Fixtures: `conformance-multi-agent-handoff.json` (parent workflow) + `conformance-multi-agent-handoff-child.json` (child workflow). Reference workflow-engine advertises under `OPENWOP_MULTI_AGENT_EXECUTION_MODEL=true`.

### Added — RFC 0039 multi-agent Phase 2 (confidence + memory lifecycle; Active)

2 new scenarios + 1 fixture:
- `multi-agent-confidence-escalation.test.ts` — gated on `multiAgent.executionModel.version >= 2`; asserts decisions with `confidence < confidenceEscalationFloor` MUST emit `core.workflowChain.confidence-escalated` event + suspend with `interrupt.kind: 'clarification'` + NOT execute the worker dispatch.
- `multi-agent-memory-lifecycle.test.ts` — advertisement-shape probe + 2 `it.todo` behavioral assertions for MAE-2 cross-run TTL + MAE-3 replay snapshot (lights up when a memory-advertising Phase 2 host wires the test seam).

Fixture: `conformance-multi-agent-confidence-escalation.json`.

### Added — RFC 0040 multi-agent Phase 3 (cross-host causation; Active)

3 new scenarios:
- `cross-host-causation-shape.test.ts` — always-on when discovery reachable; asserts the shape of `multiAgent.executionModel.crossHostCausation.{supported, hostId, ancestryEndpointSupported}` + `version >= 3` when advertised.
- `cross-host-ancestry-endpoint.test.ts` — capability-gated on `crossHostCausation.ancestryEndpointSupported: true`; covers `GET /v1/runs/{runId}/ancestry` top-level-run path (`parent: null`) + the 404 contract when the capability is not advertised.
- `cross-host-traceparent-propagation.test.ts` — capability-gated behavioral; 2 `it.todo` assertions for outbound MCP + A2A `traceparent` injection (lights up when `OPENWOP_MCP_REAL_SERVER_URL` / `OPENWOP_A2A_REAL_PEER_URL` env harness ships).

### Added — RFC 0041 multi-agent Phase 4 (replay determinism; Active)

3 new scenarios:
- `replay-llm-cache-key-portable.test.ts` — RFC 0041 §E SECURITY-invariant probe (intra-host reproducibility + non-recipe-field invariance + Phase 4 advertisement alignment). Reuses the existing `POST /v1/host/sample/test/llm-cache-key` seam from `replay-llm-cache-key.test.ts`.
- `replay-divergence-at-refusal.test.ts` — advertisement-shape probe + 2 `it.todo` for the dual-direction refusal-divergence case (original=valid + replay=refusal AND original=refusal + replay=valid).
- `replay-observable-sequence-determinism.test.ts` — 2 `it.todo` for §C boundary byte-equivalence + observable-result caching (lights up when a `conformance-phase4-nondet-tool` fixture ships).

### Changed

- `conformance/coverage.md` updated with the 45 new scenarios mapped to RFC + invariant tier.
- `conformance/fixtures.md` catalog updated with the 23 new fixture rows + per-fixture contracts.
- Shared helper extraction: `conformance/src/lib/llm-cache-key-recipe.ts` exports `canonicalize`, `projectRecipe`, `expectedCacheKey`, `callCacheKeySeam` — consumed by both `replay-llm-cache-key.test.ts` (existing) and `replay-llm-cache-key-portable.test.ts` (new).

### Fixed

- `replay-llm-cache-key-portable.test.ts` Phase 4 advertisement-alignment test guards against `undefined < 4 === false` fall-through (`typeof version !== 'number'` check before comparison).
- Soft-skip patterns across the new Phase 4 + RFC 0040 scenarios converted from bare `return` to `ctx.skip()` so test reporters surface skipped capability gates as `skipped` rather than vacuous `passed`.

### Known limits (light up when host wires the matching test seam)

- 6 `it.todo` behavioral assertions across the RFC 0034 OTel-seam-gated, RFC 0040 traceparent-propagation, RFC 0041 refusal-divergence + observable-sequence scenarios. All scenarios soft-skip cleanly when their gating capability is unset.

## [1.3.0] — 2026-05-19

Minor bump per `PUBLISHING.md` §"Versioning alignment" — conformance scenario + fixture additions land on a minor. Closes the conformance-republish acceptance gate on RFC 0024 (§"Active → Accepted" criterion b) and bundles the wider behavioral-coverage push that converted ~50 `it.todo()` placeholders into live behavioral assertions across the RFC 0013 / 0016 / 0017 / 0022 / 0023 / 0024 surface.

### Added — RFC 0024 streaming reasoning (headline)

- **`conformance/fixtures/conformance-agent-reasoning-streaming.json`** — new RFC 0024 fixture. Drives the `core.conformance.mock-agent` typeId via `mockReasoning.streamChunks` (extended schema entry per RFC 0024 §"Conformance") to emit a deterministic sequence of `agent.reasoning.delta` events followed by exactly one closing `agent.reasoned`. The closing event's `reasoning` field MUST equal the concatenation of all chunks; deltas MUST carry monotonically-increasing `sequence` starting at 0 and MUST all precede the closing event in the event log.
- **`conformance/src/scenarios/agentReasoningStreaming.test.ts`** — new scenario gating on `capabilities.agents.supported: true` AND `capabilities.agents.reasoning.streaming: true` AND `getReasoningVerbosity() !== 'off'`. Asserts: (a) at least one `agent.reasoning.delta` event surfaces; (b) deltas appear in monotonic sequence order; (c) concatenated deltas equal the closing `agent.reasoned.reasoning` byte-for-byte; (d) the last delta's `eventLogIdx` strictly precedes the closing event's `eventLogIdx`; (e) the closing `agent.reasoned.causationId` chains correctly per `replay.md` §"Determinism with non-deterministic agents". Hosts without the streaming flag skip cleanly.
- **`schemas/core-conformance-mock-agent-config.schema.json`** updated with the `streamChunks` field on `mockReasoning` per RFC 0024 §"Conformance".
- **`spec/v1/node-packs.md`** Authorized-Emitters table for the `agent.*` family extended with `agent.reasoning.delta` (RFC 0024 addendum).
- **`spec/v1/capabilities.md`** §`agents.reasoning` documents the `streaming: boolean` field (default `false`); spec text + JSON Schema additions in `schemas/capabilities.schema.json`.

### Added — RFC 0022 §C variable-mapping refusal contract

- **3 new fixture variants** for the unset-default + per-worker-override + subWorkflow-unset edges: `conformance-dispatch-input-mapping-no-default.json`, `conformance-dispatch-per-worker-override.json`, `conformance-subworkflow-input-mapping-no-default.json`. Catalog rows added to `conformance/fixtures.md`.
- **`dispatch-input-mapping.test.ts`** + **`subworkflow-input-mapping.test.ts`** + **`dispatch-cross-worker-handoff.test.ts`** behavioral assertions for HVMAP-1a-null + HVMAP-1a-refusal + HVMAP-1c-override + HVMAP-2-unset + HVMAP-2-refusal — exercising both the projection paths and the `validation_error` refusal contract from RFC 0022 §C when a host does NOT advertise the gating capability.

### Added — Thread C: child-lifecycle fixtures

- **`conformance-dispatch-cancellable-child.json`** + **`conformance-dispatch-deterministic-fail-child.json`** support `dispatch-cross-worker-handoff` outputMapping skip-on-failure semantics and child-cancellation propagation tests. 2 new behavioral assertions in `dispatch-output-mapping.test.ts`.

### Added — Threads E.1 / E.2 / E.3: event-log query + OTel + debug-bundle seams

- **`event-log-query.test.ts`** — `eventLogQuery({fromSeq, toSeq, types[], causationId})` projection seam exercised via 12 behavioral assertions previously `it.todo()`. Gates on the host's advertisement of `host.eventLog.query.supported: true`.
- **`otel-trace-propagation-subworkflow.test.ts`** — W3C traceparent propagation across the dispatch boundary; reads context from the closing `runOrchestrator.decided`'s tracecontext and asserts the child `core.subWorkflow` inherits the parent trace.
- **`debug-bundle.test.ts`** + **`debug-bundle-redaction.test.ts`** — assert the host's debug-bundle endpoint surfaces the redacted event projection per SR-1 (no BYOK credential material in the bundle's event-log slice).

### Added — Thread F: stream/search/blob/queue/table/cache

- **`stream.test.ts`** + **`search-knn.test.ts`** + **`blob-presign.test.ts`** — 3 todos converted to behavioral via the `/v1/host/sample/test/surface` seam.
- **`queue-publish-consume-roundtrip.test.ts`** + **`queue-ack-nack-dlq.test.ts`** — full RFC 0017 §B point 2 ack/nack/DLQ state machine asserted end-to-end (consume → ack drop, consume → nack(requeue=true) re-queues at head with incremented deliveryCount, consume → deadLetter routes to `<subject>.dlq` with `{ original, deadLetterReason }` wrapper).
- **`table-cursor-pagination.test.ts`** + **`table-schema-enforcement.test.ts`** — RFC 0016 §B points 2+3: first-insert declares per-column types, divergent-type insert throws `table_schema_violation`; opaque base64 cursor pagination with `nextCursor: null` on the final page.
- **`cache-ttl-expiry.test.ts`** + **`kv-ttl-expiry.test.ts`** — TTL expiry assertions via the host-side test seam.
- **`sql-transaction-atomicity.test.ts`** + **`vector-knn-roundtrip.test.ts`** — round-trip + atomicity assertions on the SQL + vector surfaces.
- **`replay-llm-cache-key.test.ts`** — `replay.md` §"LLM cache-key recipe" §B asserted via the new `llm-cache-key` host seam (`POST /v1/host/sample/test/llm-cache-key`). Cross-host parity (B-suffixed runs against `OPENWOP_BASE_URL_B`) stays deferred awaiting cross-host plumbing.

### Added — AI envelope behavioral assertions

- **`aiEnvelope.{schemaDrift,redaction,correlationReplay}.test.ts`** — 9 todos converted to behavioral via the extended `host/envelopeAcceptor.ts` seam: (1) `schemaVersionFloor` + `envelopeStrictness` for below-floor refusal under `strict`; (2) `priorCorrelations` for same-correlationId re-emission returning the cached outcome AND same-correlationId-different-type refusing with `envelope_correlation_conflict`; (3) `byokCanaries` for recursive deep substitution of canary values with the canonical SR-1 `[REDACTED:<secretId>]` marker per `agent-memory.md:66`.

### Added — Driver helpers + opt-out axes

- **`conformance/src/lib/host-toggle.ts`** (NEW) — driver helpers `setHostCapability(name, value)`, `resetHostCapabilities()`, `isToggleAvailable()`. All operations soft-skip on HTTP 404 so non-seam hosts keep advertisement-shape coverage intact; scenarios MUST reset in `finally{}`. Backed by `POST /v1/host/sample/test/capability-toggle` on the reference workflow-engine.
- **`OPENWOP_OPTED_OUT_FIXTURES`** + **`OPENWOP_OPTED_OUT_SCENARIOS`** — two new operator-side env axes (CSV + trailing-`*` glob support) for hosts that auto-load every `conformance-*.json` on disk but do NOT implement the gated feature for some of them. Symmetric to the existing `OPENWOP_OPTED_OUT_PROFILES`. `conformance/src/lib/env.ts` + `conformance/src/lib/fixtures.ts` carry the helpers; `fixtures-gating.test.ts` adds 12 parser-edge-case tests covering CSV + glob semantics.

### Added — RFC 0013 Phase 3 reference host expansion

- **`host-in-memory`** gains the Phase 3 surface; new scenarios assert the in-memory host now passes the same Phase 3 advertisement-shape suite as the SQLite host. Per `INTEROP-MATRIX.md`, both reference hosts now advertise Phase 3.

### Tightened

- **Persisted envelope-correlation dedup seam** (`be89f4d`) — `priorCorrelations` now reads from a real persisted store on the reference workflow-engine, not just an in-flight map. Scenario assertions strengthened to survive a process restart between the original `accept` and the replay.
- **`apps/workflow-engine/.../host/capabilityOverlay.ts`** (NEW reference-host file) — process-local overlay over advertised capability flags, consulted by `validateDefinition` at workflow-register time. Defaults `agents.dispatchMapping` and `subWorkflow.inputMapping` to `false` per the honest-advertisement principle (the reference workflow-engine implements the RFC 0022 §C refusal contract but does NOT yet execute the mapping itself).
- **`examples/hosts/sqlite/src/server.ts` artifact-route stub** — `checkAuth` now runs BEFORE any 404 across HEAD/POST/PUT/DELETE; non-GET → 405 method_not_allowed (per `rest-endpoints.md §getArtifact` advertising GET only); GET → 404 not_found. Closes an unauthenticated runId/artifactId probe surface that the prior catch-all 404 left open.

### Compatibility

**Additive** per `COMPATIBILITY.md §2.1`. New fixtures, new scenarios, new driver helpers, new env axes — no existing scenario was relaxed; no existing fixture was renamed or its semantics changed; no existing host-side contract changed. RFC 0024's new event type `agent.reasoning.delta` is gated on `capabilities.agents.reasoning.streaming: true` (default `false`); hosts that omit it advertise the existing non-streaming contract and skip the new scenario cleanly. The capability-overlay toggle endpoint and the new sample-namespaced test seams live under the sample-namespaced test-seam prefix per `host-extensions.md` §"Canonical prefixes" — explicitly not part of the v1 wire contract.

### Notes

- This bump does NOT change the v1.0 spec corpus surface; `@openwop/openwop@1.1.x`, `openwop-client@1.1.x`, and the Go SDK stay locked to their current versions per `PUBLISHING.md` §"Versioning alignment" ("Conformance scenario addition | @openwop/openwop-conformance minor bump; other artifacts unaffected").
- Trigger: push `openwop-conformance/v1.3.0` per `.github/workflows/openwop-publish.yml` (only the `publish-conformance` job runs).
- RFC 0024 §"Active → Accepted" — this republish resolves criterion (b) ("next `@openwop/openwop-conformance` republish carrying the new fixture+scenario to downstream consumers"). Criterion (a) (external host advertisement evidence) remains open.

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
- A handful of `it.todo()` cases remain in the dispatch + subWorkflow scenarios (unset-variable projection, capability-refusal, child-failed/cancelled outputMapping skip, per-worker override precedence, mid-run no-propagation). These are tracked as future work and require conformance-harness extensions (capability-toggle hook, deterministic-fail child fixture, cancellable child fixture, fixture variants omitting defaultValues) outside the scope of this release. (**Closed in 1.3.0 (2026-05-19)** — all deferred cases promoted to live behavioral tests; see the 1.3.0 entries for "RFC 0022 §C variable-mapping refusal contract", "Thread C: child-lifecycle fixtures", and "Driver helpers + opt-out axes" above.)

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

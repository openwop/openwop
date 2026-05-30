# OpenWOP â Multi-Agent Workflow Orchestration Protocol

**OpenWOP is an open, wire-level protocol for multi-agent workflow orchestration.** It defines how multiple AI agents, deterministic tools, sub-workflows, and human reviewers collaborate inside a single durably-suspendable, replayable run â and how independent hosts (workflow engines, SDKs, debuggers, agent runtimes) interoperate over the same contract.

If you're building agentic systems, AI workflow engines, multi-agent applications, agent orchestration platforms, or human-in-the-loop pipelines and want a protocol layer instead of vendor lock-in, OpenWOP is the contract.

> **Try it live: [app.openwop.dev](https://app.openwop.dev/)** â anonymous demo of the reference workflow-engine app. Build a workflow visually, run it against 44 published `core.openwop.*` packs, see the SSE event stream + interrupt cards + capabilities advertisement. Sign in with Google or GitHub for persistent runs + workflows + BYOK secrets (KMS-encrypted at rest). Anonymous sessions reset every 24h; BYOK keys you paste are session-only and never persisted. [Privacy & cookies](https://app.openwop.dev/privacy).

## Multi-Agent Architecture (v1+)

OpenWOP v1 introduces first-class support for **orchestrator-driven multi-agent workflows**:

- **Orchestrator agent** â A supervisor agent that owns the conversation context, drives workflow execution decisions, and dynamically constructs node stacks based on user intent
- **Worker agents** â Each node defaults to its own isolated agent context with specialist capabilities, with optional shared-agent modes for tightly-coupled state
- **Agent identity** â Protocol-level `AgentRef` wire shape for agent discovery, provenance, and cross-host interoperability
- **Reasoning events** â New event types (`agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided`, `runOrchestrator.decided`) for observability into agent decision-making
- **Agent packs** â Extension of node packs to distribute agent manifests alongside node implementations
- **Memory layer** â Host-adapter interface for agent memory persistence with BYOK redaction guarantees
- **Multi-turn conversation** â Generalized suspend/resume for orchestrator-driven HITL flows

## What is multi-agent workflow orchestration?

A **workflow** is a directed graph of steps that drives state from an input to a result. **Multi-agent** means each step can be taken by a different kind of actor â an LLM, a tool, a person, or another workflow â sharing typed state across the graph. **Orchestration** means a single layer (the protocol, not any one host) owns the cross-cutting guarantees those agents need to collaborate safely: durability, suspend / resume, replay, version negotiation, and observability.

In OpenWOP, an "agent" is anything that takes a turn inside a run:

- an **LLM agent** â an AI model node that calls a foundation model (Anthropic, OpenAI, Google, local) and emits a typed envelope;
- a **tool agent** â a deterministic node that runs a function, queries a database, transforms state, or invokes an MCP tool;
- a **human agent** â a reviewer participating through a canonical [interrupt](./spec/v1/interrupt.md): approve / reject / clarify / refine / cancel;
- a **sub-workflow agent** â another OpenWOP run, possibly executed on a different host or organization, invoked over the same protocol;
- an **orchestrator agent** â a supervisor agent that drives workflow execution decisions (v1+).

An OpenWOP-compliant **host** is any server that implements the REST + SSE surface defined in [`api/openapi.yaml`](./api/openapi.yaml). An OpenWOP-compliant **client** is any SDK, tool, or agent that consumes those endpoints. The [conformance suite](./conformance/) decides compliance mechanically â `npx @openwop/openwop-conformance` against `OPENWOP_BASE_URL` returns pass/fail.

## What OpenWOP Gives You

| Concern | Protocol guarantee | Spec |
|---|---|---|
| **Durable suspend / resume** | Long-running or human-gated steps don't pin a process; runs persist, hand off across workers, and resume against the same state. | [`interrupt.md`](./spec/v1/interrupt.md), [`storage-adapters.md`](./spec/v1/storage-adapters.md) |
| **Typed channels + reducers** | Shared state between agents is contractual, not convention. Each channel declares a type and an explicit reducer for concurrent writes. | [`channels-and-reducers.md`](./spec/v1/channels-and-reducers.md) |
| **Replay + fork** | Any historical checkpoint can be forked into a new run for time-travel debugging without rewriting the workflow. | [`replay.md`](./spec/v1/replay.md) |
| **Version negotiation** | Per-`(run, change-id)` version pinning â borrowed from Temporal â means a deploy never breaks an in-flight run. | [`version-negotiation.md`](./spec/v1/version-negotiation.md) |
| **Observability** | Canonical `openwop.*` OpenTelemetry namespace. Any host emits the same span, event, and metric vocabulary; any consumer reads it. | [`observability.md`](./spec/v1/observability.md) |
| **HITL primitives** | One canonical `interrupt` shape covers approval, clarification, refinement, and cancellation across REST, SSE, and webhooks. | [`interrupt.md`](./spec/v1/interrupt.md) |
| **Stream modes** | Four SSE consumption modes (`values`, `updates`, `messages`, `debug`) â borrowed from LangGraph â so dashboards, debuggers, and chat UIs read the right slice. | [`stream-modes.md`](./spec/v1/stream-modes.md) |
| **Idempotent runs** | Two-layer contract â HTTP `Idempotency-Key` for retries, engine `invocationId` for replays â collapses duplicates safely. | [`idempotency.md`](./spec/v1/idempotency.md) |
| **BYOK secrets + provider policy** | Per-tenant credential resolution and per-run provider routing without leaking either into the workflow definition. | [`auth.md`](./spec/v1/auth.md), [`run-options.md`](./spec/v1/run-options.md) |
| **Node packs** | Distributable, signed bundles of node implementations â the agent equivalent of language packages. | [`node-packs.md`](./spec/v1/node-packs.md), [`registry-operations.md`](./spec/v1/registry-operations.md) |
| **Agent packs** | Extension of node packs to distribute agent manifests alongside node implementations (v1+). | [`node-packs.md`](./spec/v1/node-packs.md) |
| **Agent identity** | Protocol-level `AgentRef` wire shape for agent discovery, provenance, and cross-host interoperability (v1+). | [`RFCS/0002`](./RFCS/0002-agent-identity-and-reasoning-events.md) |
| **Agent reasoning events** | Observability into agent decision-making via `agent.reasoned`, `agent.toolCalled`, `agent.handoff`, etc. (v1+). | [`RFCS/0002`](./RFCS/0002-agent-identity-and-reasoning-events.md) |
| **Agent memory** | Host-adapter interface for agent memory persistence with BYOK redaction guarantees (v1+). | [`RFCS/0004`](./RFCS/0004-memory-layer.md) |
| **Webhooks** | HMAC-signed delivery of run events to subscribers; replay-attack-resistant verification recipe; circuit-breaker semantics. | [`webhooks.md`](./spec/v1/webhooks.md) |

## What OpenWOP is not (and what it composes with)

OpenWOP intentionally does not standardize:

- **model-call shape** â an LLM agent inside a node calls whatever it wants (OpenAI, Anthropic, Bedrock, Vertex, Ollama, local);
- **orchestration topology** â DAGs, state machines, planner-executor loops, ReAct, supervisor-worker, hierarchical agents, all run inside a single OpenWOP node graph;
- **tool-exposure protocol** â use [MCP](./spec/v1/mcp-integration.md). OpenWOP runs the workflow; MCP exposes tools to the LLM nodes inside it;
- **inter-agent messaging across processes** â use [A2A](./spec/v1/a2a-integration.md). A2A handles the message exchange between agents on different hosts; OpenWOP runs the workflow inside one of them.

For an honest comparison of OpenWOP vs **Temporal, Airflow, Argo Workflows, AWS Step Functions, BPMN, LangGraph, and MCP** â when to choose OpenWOP and when not â see [`positioning.md`](./spec/v1/positioning.md). For the standards-composition matrix (MCP, A2A, OpenAPI, AsyncAPI, OpenTelemetry, CloudEvents, DID, Serverless Workflow, BPMN, Temporal/Restate/DBOS) â what OpenWOP composes with vs. what it deliberately doesn't duplicate â see [`positioning.md`](./spec/v1/positioning.md) Â§"Standards composition matrix".

> **Status: v1.0 core locked (2026-05-12); v1.x extension surfaces in motion.** The **v1.0 core spec corpus** is locked: 36 of 41 `spec/v1/*.md` documents are at `FINAL v1` (or `FINAL v1.1`). **Six documents remain `DRAFT`** and are explicitly additive v1.x extensions, not part of the v1.0 conformance gate: [`workflow-chain-packs.md`](./spec/v1/workflow-chain-packs.md) (RFC 0013 Phase 1), [`prompts.md`](./spec/v1/prompts.md) (RFC 0027 Phase A), [`cloudevents-mapping.md`](./spec/v1/cloudevents-mapping.md) (non-normative export mapping), [`multi-agent-execution.md`](./spec/v1/multi-agent-execution.md) (RFC 0037 Phase 1), [`agent-evaluation.md`](./spec/v1/agent-evaluation.md) (RFC 0081), [`tool-catalog.md`](./spec/v1/tool-catalog.md) (RFC 0078). (`artifact-type-packs.md` graduated DRAFT → FINAL 2026-05-27 on MyndHyve production adoption — RFC 0071 Phase 1 Accepted.) **RFC status (85 RFCs excluding template):** RFCs that are `Accepted` (64), that are `Active` (13), and that are `Draft` (8). The full per-RFC status list is the generated table in [`docs/PROTOCOL-STATUS.md`](./docs/PROTOCOL-STATUS.md) (run `node scripts/generate-protocol-status.mjs --write` to refresh); per-RFC graduation history lives in each RFC’s `Updated` field + [`CHANGELOG.md`](./CHANGELOG.md). Conformance gates `Active`-RFC scenarios behind capability advertisements so v1.0-only hosts pass the locked-core suite. **Reference hosts:** four â `examples/hosts/{in-memory,sqlite,postgres,python}/`. The Postgres reference host satisfies the production-profile predicate per [`examples/hosts/postgres/conformance-full.md`](./examples/hosts/postgres/conformance-full.md) and is positioned as the first non-steward-deployable reference for credible multi-tenant workloads. **Conformance trajectory (re-measured 2026-05-22 against suite v1.5.0; see [`docs/CONFORMANCE-RUNS-2026-05.md`](./docs/CONFORMANCE-RUNS-2026-05.md) for the per-failure-topic taxonomy):** Postgres 94.2% total (1473/1564); SQLite 95.0% (1486/1564); Python 88.7% total / 100% of applicable when scoped to the host's claimed `openwop-core` + `openwop-stream-poll` + `openwop-stream-sse` profile set (1387/1564); in-memory 92.4% (1445/1564). v1.4.0 â v1.5.0 delta: total scenario tests 1558 â 1564 (+6, from the RFC 0044 vendor-kind routing branch splitting `multi-agent-confidence-escalation.test.ts` into discrete sub-blocks); each host's pass count rose +6 in the no-advertisement default branch; 8 sandbox `expect(true).toBe(true)` placeholders also converted to `it.todo` per upstream commit `5864a2f` â same numeric outcome (the placeholders weren't earning real signal anyway). The 2026-05-22 re-measurement was triggered by an external standards-readiness review (see [`docs/AUDIT-RESPONSE-2026-05.md`](./docs/AUDIT-RESPONSE-2026-05.md)). Suite scenario count grew ~+700 tests v1.1.0 â v1.5.0 â non-zero failure counts above are predominantly capability gaps in surfaces introduced post-v1.1.0 (RFC 0022 dispatch mapping, RFC 0026 cost-attribution seam, RFC 0031 model-capability executor, multi-agent Phase 2â4), not regressions. **SECURITY surface:** 108 invariants in [`SECURITY/invariants.yaml`](./SECURITY/invariants.yaml) â 75 protocol-tier (verified at the spec gate; every one has at least one public test in [`conformance/src/scenarios/`](./conformance/src/scenarios/)), 31 reference-impl-tier (verified by reference impls' CI), 2 advisory. (2 invariants graduated reference-impl â protocol on 2026-05-21 via RFC 0034; +1 protocol invariant added 2026-05-22 via RFC 0041 â `replay-llm-cache-key-portable`; +1 protocol invariant added 2026-05-24 via RFC 0046 â `credential-payload-redaction`; +1 protocol invariant added 2026-05-25 via RFC 0049 â `authorization-fail-closed`; +2 protocol invariants added 2026-05-25 via RFC 0028 Tier-2 post-promotion strengthening â `prompt-mutation-workspace-membership-enforced` (write path) + `prompt-read-workspace-membership-enforced` (read path), both filed in response to a self-disclosed adopter Admin-SDK-bypasses-DB-rules vulnerability; T1 + T2 also canonicalized `workspace_membership_required` as the 403 envelope error code; +2 protocol invariants added 2026-05-25 via RFC 0057 â `memory-attribution-no-content` + `memory-attribution-tenant-scoped`, the content-free / tenant-scoped guarantees on the new `memory.written` event; +1 protocol invariant added 2026-05-25 via RFC 0059 M2 â `workspace-cross-tenant-isolation`, the WCT-1 cross-owner isolation guarantee on `host.workspace`; +1 protocol invariant added 2026-05-25 via RFC 0063 M2 â `subrun-merge-approval-fail-closed`, the fail-closed sub-workflow output-merge approval gate; +1 protocol invariant added 2026-05-26 via RFC 0069 â `exec-must-not-be-protocol-tier`, the structural carve-out that arbitrary-command execution is host-extension-only, verified by the always-on server-free `exec-not-protocol-tier.test.ts`; +2 protocol invariants added 2026-05-26 via RFC 0071 â `artifact-schema-compile-bounded` (bounded compilation of third-party artifact-type-pack schemas; always-on server-free floor) + `chat-card-input-trust-boundary` (card-input-derived prompt segments carry `contentTrust:"untrusted"`; host-pending, Phase-2 `Active` gate); +1 protocol invariant added 2026-05-30 via RFC 0081 â `eval-summary-no-content-leak`, the content-free guarantee on the `EvalSummary` + `eval.*` events, verified by the always-on `agent-eval-suite-shape.test.ts`.) Strict-mode conformance available via `OPENWOP_REQUIRE_BEHAVIOR=true` â see [`conformance/coverage.md`](./conformance/coverage.md) Â§"Capability-gated scenarios". **For the deliberately-disagreeable catalog of what the protocol does NOT yet prove** â shape-only conformance, reference-impl-tier invariants pending sandbox/OTel-collector implementation, profile claims pending non-steward adoption, external-action-gated work (audit engagement, vendor-neutral org migration), and in-flight Active-RFC wire surfaces â **see [`docs/KNOWN-LIMITS.md`](./docs/KNOWN-LIMITS.md).**
> **v1.x published artifacts.** [`@openwop/openwop`](https://www.npmjs.com/package/@openwop/openwop) (npm, **v1.1.0** â close-out additive release) Â· [`@openwop/openwop-conformance`](https://www.npmjs.com/package/@openwop/openwop-conformance) (npm, **v1.1.0**) Â· [`openwop-client`](https://pypi.org/project/openwop-client/) (PyPI, **v1.1.0**) Â· [`github.com/openwop/openwop/sdk/go`](https://pkg.go.dev/github.com/openwop/openwop/sdk/go) (Go modules, **v1.1.0**). All three SDKs at feature parity per [`sdk/PARITY.md`](./sdk/PARITY.md); package names are stable through any v1.x release per [`PUBLISHING.md`](./PUBLISHING.md). The initial v1.0.0 publication happened 2026-05-11; v1.1.0 adds the Phase H + Phase I capability surfaces (BYOK, MCP, HTTP, agent memory, OAuth2-CC, OIDC, etc.) â additive per [`COMPATIBILITY.md`](./COMPATIBILITY.md) Â§2.1. A Rust SDK is demand-gated and not in v1.x; the conformance suite is language-agnostic black-box, so any future Rust client tests against the same wire contract. Future moves to a vendor-neutral org are tripwire-gated per [`ROADMAP.md`](./ROADMAP.md) on â¥1 non-steward maintainer.

> **What remains v1.x work (external-action-gated).** External security audit engagement, first non-steward INTEROP-MATRIX row, first third-party node-pack on `packs.openwop.dev`, vendor-neutral org migration. None of these are controllable by the single-steward authoring this protocol; each is tracked with a named tripwire in [`ROADMAP.md`](./ROADMAP.md) Â§Phase 4. The corpus is **ready for first non-steward adoption** â the four reference hosts + 35 SECURITY invariants + 730 conformance scenarios + 3 SDKs + 1 spec-closure RFC umbrella close every gap a non-steward maintainer can be expected to discover on day one.

This repository is the canonical source for the protocol itself; reference implementations live under [`examples/hosts/`](./examples/hosts/) and in third-party host repos listed in [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md).

## Document index

| Doc | Status | Words | Covers |
|---|---|---|---|
| [`auth.md`](./spec/v1/auth.md) | FINAL v1 | ~1,000 | API keys, scopes, tenant isolation, rate limits, audit |
| [`auth-profiles.md`](./spec/v1/auth-profiles.md) | FINAL v1 | ~900 | Optional production auth profiles: API-key rotation, OAuth2 client credentials, mTLS |
| [`rest-endpoints.md`](./spec/v1/rest-endpoints.md) | FINAL v1 | ~1,150 | Endpoint catalog with per-route auth/scope; canonical headers; error codes |
| [`idempotency.md`](./spec/v1/idempotency.md) | FINAL v1 | ~1,300 | Two-layer contract: HTTP `Idempotency-Key` + engine `invocationId` |
| [`version-negotiation.md`](./spec/v1/version-negotiation.md) | FINAL v1 | ~2,060 | Four version axes (engine, per-run event-log, per-event, runtime pinning); deploy-skew safety |
| [`capabilities.md`](./spec/v1/capabilities.md) | FINAL v1 | ~1,480 | `/.well-known/openwop` handshake; in-package vs network-superset shapes |
| [`capabilities-change-detection.md`](./spec/v1/capabilities-change-detection.md) | FINAL v1 | ~900 | `Capabilities-Etag`, scoped capability views, and non-HTTP discovery handoff |
| [`observability.md`](./spec/v1/observability.md) | FINAL v1 | ~1,260 | Canonical `openwop.*` OTel namespace; span names; metric kinds |
| [`stream-modes.md`](./spec/v1/stream-modes.md) | FINAL v1 | ~1,150 | Four SSE consumption modes: `values`/`updates`/`messages`/`debug` |
| [`run-options.md`](./spec/v1/run-options.md) | FINAL v1 | ~1,180 | Per-run `configurable` overlay + `tags` + `metadata` (decoupled from versioning) |
| [`interrupt.md`](./spec/v1/interrupt.md) | FINAL v1 | ~1,500 | Canonical HITL primitive: 4 `kind`s, 5-action approval vocabulary, signed-token callback |
| [`interrupt-profiles.md`](./spec/v1/interrupt-profiles.md) | FINAL v1 | ~850 | Optional HITL profiles: quorum approval, auth-required resume, external events, parent/child cancel cascade |
| [`replay.md`](./spec/v1/replay.md) | FINAL v1 | ~1,320 | `POST /v1/runs/{runId}:fork` for time-travel debugging |
| [`channels-and-reducers.md`](./spec/v1/channels-and-reducers.md) | FINAL v1 | ~1,500 | Typed state channels with explicit reducers (replaces variable-prefix conventions) |
| [`node-packs.md`](./spec/v1/node-packs.md) | FINAL v1 | ~1,750 | Pack manifest format + distribution + signing + registry HTTP API (P2-F5) |
| [`artifact-type-packs.md`](./spec/v1/artifact-type-packs.md) | FINAL v1.1 | ~1,150 | RFC 0071 Phase 1 â `kind: "artifact-type"` packs: distributable typed artifact definitions (schema + rendering hint + lifecycle); `host.artifactTypes` store/render/export negotiation |
| [`chat-card-packs.md`](./spec/v1/chat-card-packs.md) | FINAL v1.1 | ~1,200 | RFC 0071 Phase 2 â `kind: "card"` packs: AI chat cards (prompt template + typed input subset) bound to a typed `outputArtifactType`; `host.chat.cardPacks` execution + untrusted-input trust boundary |
| [`workflow-chain-packs.md`](./spec/v1/workflow-chain-packs.md) | DRAFT | ~600 | Workflow-chain pack format â registry-distributed pre-configured DAG fragments expanded inline at workflow-author time. Closes [RFC 0013](./RFCS/0013-workflow-chain-packs.md) Phase 1 |
| [`webhooks.md`](./spec/v1/webhooks.md) | FINAL v1 | ~1,400 | Subscription register/unregister; HMAC `{timestamp}.{rawBody}` signing; replay-attack-resistant verification recipe; best-effort delivery semantics + circuit breaker (post-v1 addition, 2026-04-29) |
| [`storage-adapters.md`](./spec/v1/storage-adapters.md) | FINAL v1 | ~1,150 | Normative `RunEventLogIO` + `SuspendIO` contracts for storage backends; in-memory reference impls; compliance checklist for third-party adapter authors (post-v1 addition, 2026-04-29) |
| [`registry-operations.md`](./spec/v1/registry-operations.md) | FINAL v1 | ~3,000 | Operator-side normative reference for node-pack registries: submission, validation, deprecation, yank, signing-key rotation, marketplace boundary (post-v1 addition, 2026-04-29 â closes NP4 + NP5 from `node-packs.md`) |
| [`profiles.md`](./spec/v1/profiles.md) | FINAL v1 | ~1,200 | Compatibility profiles derived from existing capabilities (no wire-shape change): `openwop-core`, `openwop-interrupts`, `openwop-stream-sse`, `openwop-stream-poll`, `openwop-secrets`, `openwop-provider-policy`, `openwop-node-packs` |
| [`scale-profiles.md`](./spec/v1/scale-profiles.md) | FINAL v1 | ~900 | Three normative scale tiers (`minimal` / `production` / `high-throughput`) with floors for concurrency, latency, retry, fan-out, replay |
| [`production-profile.md`](./spec/v1/production-profile.md) | FINAL v1 | ~950 | Public-release operational profile: durability, backpressure, retry, event retention, debug bundles, observability. **First satisfying host:** `examples/hosts/postgres/` since 2026-05-11 â see [`examples/hosts/postgres/conformance-full.md`](./examples/hosts/postgres/conformance-full.md). |
| [`debug-bundle.md`](./spec/v1/debug-bundle.md) | FINAL v1 | ~900 | Portable JSON export of a single run's diagnostic state: `GET /v1/runs/{runId}/debug-bundle`. Profile-gated on `capabilities.debugBundle.supported: true` |
| [`positioning.md`](./spec/v1/positioning.md) | FINAL v1 | ~1,100 | Honest comparison of OpenWOP vs Temporal / Airflow / Argo / Step Functions / BPMN / LangGraph / MCP. When to choose OpenWOP and when not. |
| [`mcp-integration.md`](./spec/v1/mcp-integration.md) | FINAL v1 | ~700 | Worked example of OpenWOP + MCP composition. OpenWOP runs the workflow; MCP exposes tools to the LLM nodes inside that workflow. |
| [`a2a-integration.md`](./spec/v1/a2a-integration.md) | FINAL v1 | ~1,400 | Worked example of OpenWOP + A2A composition. A2A handles inter-agent message exchange; OpenWOP runs the workflow inside one agent. Includes OpenWOPâA2A state-projection table with documented drift points. |
| [`host-extensions.md`](./spec/v1/host-extensions.md) | FINAL v1 | ~900 | What's in the protocol vs what's a host extension. Canonical-prefix table; `openwop.*` and other vendor namespaces are host-extensions. |
| [`host-capabilities.md`](./spec/v1/host-capabilities.md) | FINAL v1 | ~2,800 | Normative contracts for the 14 `host.*` capabilities that node-pack `peerDependencies` may declare (canvas, kanban, brand, mcp, et al.). Hosts that advertise `host.X: supported` MUST honor the Â§host.X contract. |
| [`host-sample-test-seams.md`](./spec/v1/host-sample-test-seams.md) | FINAL v1 | ~1,700 | Consolidated normative reference for conformance-only test seams under `/v1/host/sample/*` (prompt resolver, OTel span scrape, debug-bundle export, LLM cache-key recipe, staged-refusal). Capability gates + request/response shapes for each seam in one place. Production hosts SHOULD return 404/403 unless an env-gate is set. |
| [`agent-memory.md`](./spec/v1/agent-memory.md) | FINAL v1 | ~120 | Multi-Agent Shift Phase 3 â `memoryRef` resolution, `MemoryAdapter` host-interface contract, CTI-1 cross-tenant invariant, SR-1 secret-redaction invariant, TTL semantics. |
| [`agent-ref-positioning.md`](./spec/v1/agent-ref-positioning.md) | FINAL v1 | ~900 | Non-normative addendum to RFC 0002 â compares `AgentRef` to W3C DIDs, A2A `AgentCard`, and AGNTCY agent identity. |
| [`agent-workspace.md`](./spec/v1/agent-workspace.md) | DRAFT v1.x | ~250 | RFC 0059 (`Active`) â `host.workspace`: a versioned, atomic, tenantÂ·workspace-scoped ground-truth file store (`/v1/host/workspace/files` endpoints + `workspace.updated`), loaded as a read snapshot at run start; complements the transactional `MemoryAdapter` with a durable file layer. |
| [`ai-envelope.md`](./spec/v1/ai-envelope.md) | FINAL v1.1 | ~530 | Inbound LLM-emission envelope (`type` / `schemaVersion` / `envelopeId` / `correlationId` / `payload` / `meta` / `partial`). Closes the documented gap where 8 v1 surfaces (`capabilities.md`, `host-capabilities.md` Â§host.aiEnvelope, `workflow-chain-packs.md`, `profiles.md`, `host-extensions.md`, `positioning.md`, `capabilities.schema.json`, reference host discovery) already advertise the envelope concept but its own wire shape, universal kinds, schema discipline, and Envelope Contract gate were never specified. Distinct from `RunEventDoc` (outbound) and `error-envelope.schema.json` (host HTTP errors). |
| [`structured-output-subset.md`](./spec/v1/structured-output-subset.md) | FINAL v1.1 (informative) | ~180 | Informative companion to `ai-envelope.md` introduced by [RFC 0030](./RFCS/0030-envelope-reasoning-and-tier-one-subset.md) (`Active` 2026-05-20). Documents the intersection of JSON-Schema features supported by OpenAI strict mode â© Anthropic strict tool use â© Google Gemini `responseSchema` as of 2026-05, so vendor-namespaced envelope-kind authors have a single reference for "what schema features are safe for cross-vendor portability." Includes the strict-mode optional-field emulation pattern. Non-normative â vendor behavior evolves, and substantive subset changes require a follow-up RFC. |
| [`prompts.md`](./spec/v1/prompts.md) | DRAFT v1.x | ~600 | Phase A wire shape for named, versioned, variable-bound prompt templates (RFC 0027). PromptTemplate + PromptRef + shared `prompt-kind.schema.json` enum + `capabilities.prompts` advertisement + `prompt.composed` RunEvent for cross-host multi-agent debuggability. Distinct from `AIEnvelope` (LLM emission) and `RunEventDoc` (outbound event); the three form a complementary observability taxonomy (host-composed prompt / LLM-emitted reasoning / thinking-token stream). Phases B/C land via [`RFCS/0028`](./RFCS/0028-prompt-library-endpoints.md) (endpoints + pack kind) and [`RFCS/0029`](./RFCS/0029-prompt-override-hierarchy.md) (resolution chain + `agent.promptResolved`). |
| [`i18n.md`](./spec/v1/i18n.md) | FINAL v1 | ~1,200 | Optional locale-negotiation annex â `Accept-Language` semantics, `locale` field on InterruptPayload + ErrorEnvelope, capability advertisement, fallback rules. Additive to `interrupt.md`. |
| [`compliance.md`](./spec/v1/compliance.md) | FINAL v1 | ~1,500 | Non-normative compliance-vocabulary mapping â protocol surfaces â SOC 2 / GDPR / HIPAA / ISO 27001 controls. Operator reference; does not prescribe certification. |
| [`grpc-transport.md`](./spec/v1/grpc-transport.md) | FINAL v1 | ~1,400 | Optional alternative transport â `openwop.v1.Engine` gRPC service mirroring the REST surface. REST + SSE remains required; gRPC is opt-in. Canonical `.proto` at `api/grpc/openwop.proto`. |
| [`cloudevents-mapping.md`](./spec/v1/cloudevents-mapping.md) | DRAFT (non-normative) | ~900 | STD-2 â non-normative export mapping from OpenWOP `RunEvent` records onto the CloudEvents 1.0 envelope. Per-attribute table, 4 extension attributes, worked example, round-trip note. |
| [`multi-agent-execution.md`](./spec/v1/multi-agent-execution.md) | DRAFT v1.x | ~250 | Phase 1 of the RFC 0037 multi-agent execution model â execution-loop framework + plannerâworker handoff state machine (4 states, 7 transition events via new `core.workflowChain.event` RunEventType). Gates conformance on `capabilities.multiAgent.executionModel.{supported, version}`. Phases 2-4 (confidence semantics / cross-host causation / replay-under-nondeterminism) are explicit follow-up RFCs. |
| [`agent-evaluation.md`](./spec/v1/agent-evaluation.md) | DRAFT v1.x | ~110 | RFC 0081 (`Active`) — portable `AgentEvalSuite` artifact + `mode:"eval"` run projection + content-free `eval.{started,scored,completed}` events + `EvalSummary` scorecard + `capabilities.agents.evalSuite` (golden/rubric/adversarial/regression/live-shadow). Answers "is this agent good enough to deploy?" — composes RFC 0054 (regression `:diff`) / 0026 (cost) / 0056 (override); reserves the RFC 0082 promotion seam; SECURITY invariant `eval-summary-no-content-leak`. Behavioral run + endpoint + SDK deferred to Accepted. |
| [`tool-catalog.md`](./spec/v1/tool-catalog.md) | DRAFT v1.x | ~110 | RFC 0078 (`Active`) — read-only `GET /v1/tools` + `GET /v1/tools/{toolId}` projection returning the portable `ToolDescriptor` (stable `toolId`, source, I/O schemas, auth/egress/approval requirements, replay policy, `safetyTier`) unifying the five tool surfaces (node-pack/workflow/mcp/connector/host-extension) + `capabilities.toolCatalog` + optional content-free `tool.session.{opened,closed}` lifecycle. `safetyTier:"exec"` ⇒ `source:"host-extension"` (RFC 0069); authorization-scoped + secret-free (SR-1). Behavioral projection + endpoint + SDK deferred to Accepted. |

**Adopter guides:**
- [`docs/IMPLEMENTER-PATH.md`](./docs/IMPLEMENTER-PATH.md) â one-page path from "what is OpenWOP" to "my host has a published row in `INTEROP-MATRIX.md`". Start here if you're building a new host.
- [`docs/PROFILE-DECISION-GUIDE.md`](./docs/PROFILE-DECISION-GUIDE.md) â decision tree for which OpenWOP capability profiles to claim (and which to honestly opt out of).
- [`docs/IMPLEMENTATION-CERTIFICATION.md`](./docs/IMPLEMENTATION-CERTIFICATION.md) â how a host author publishes a conformance claim that third parties can audit + reproduce + pin to a commit.
- [`docs/PRODUCTION-RUNBOOK.md`](./docs/PRODUCTION-RUNBOOK.md) â operator playbook for booting an OpenWOP host that honors `openwop-production` per RFC 0009.
- [`docs/SECURITY-OPERATOR-GUIDE.md`](./docs/SECURITY-OPERATOR-GUIDE.md) â operator-side configuration for auth profiles, BYOK redaction, webhook signing, audit-log integrity, mTLS, MCP trust boundary, and node-pack supply-chain.
- [`docs/PACK-AUTHOR-QUICKSTART.md`](./docs/PACK-AUTHOR-QUICKSTART.md) â end-to-end path for third-party pack authors: skeleton â signing key â tarball + signature + SBOM â schema validation â local-host smoke â publish PR â lifecycle (versioning, deprecate, yank, key rotation).
- [`docs/integrations/durable-runtimes.md`](./docs/integrations/durable-runtimes.md) â implementation guide for hosts built on Temporal / Restate / DBOS / Inngest.
- [`docs/integrations/serverless-workflow-and-bpmn.md`](./docs/integrations/serverless-workflow-and-bpmn.md) â bridging OpenWOP to / from CNCF Serverless Workflow and OMG BPMN. Honest about what round-trips and what stays host-specific.
- [`docs/KNOWN-LIMITS.md`](./docs/KNOWN-LIMITS.md) â honest catalog of shape-only coverage, external-gated work, profile claims awaiting non-steward adoption, and surfaces deliberately NOT standardized.
- [`docs/AUDIT-RESPONSE-2026-05.md`](./docs/AUDIT-RESPONSE-2026-05.md) â public point-by-point response to the 2026-05-22 external standards-readiness review. Each Acceptance-Bar item maps to a closed commit, an in-flight PR, or a named external-action tripwire with calendar commitment.
- [`docs/CONFORMANCE-RUNS-2026-05.md`](./docs/CONFORMANCE-RUNS-2026-05.md) â current-suite (v1.4.0) conformance pass rates against all 4 reference hosts + per-failure-topic taxonomy + reproduction recipes.
- [`docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md`](./docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md) â accountability tracking for the 5 behavioral-harness work-items (multi-region simulator, cross-engine append ordering, sandbox execution, RFC 0041 replay determinism under nondeterminism, secret-leakage telemetry).
- [`docs/migration/v1.0-to-v1.1.md`](./docs/migration/v1.0-to-v1.1.md) â what's new in v1.1 (additive only; no migration steps required for v1.0 implementations).

**Total**: 44 docs. The 12 v1 launch docs were finalized on 2026-04-27; `webhooks.md`, `storage-adapters.md`, and `registry-operations.md` extend the registry, storage, and webhook surfaces; `profiles.md`, `scale-profiles.md`, `debug-bundle.md`, `positioning.md`, `mcp-integration.md`, `a2a-integration.md`, and `host-extensions.md` graduated to FINAL v1 on 2026-05-05; `auth-profiles.md`, `interrupt-profiles.md`, `production-profile.md`, and `capabilities-change-detection.md` close the 2026-05-10 public-release profile and discovery gaps; `agent-memory.md` documents Phase 3 of the Multi-Agent Shift (2026-05-10); `agent-ref-positioning.md` adds the non-normative `AgentRef` positioning addendum. Multi-agent extensions [`RFCS/0002`](./RFCS/0002-agent-identity-and-reasoning-events.md)â[`RFCS/0007`](./RFCS/0007-dispatch.md) add agent identity, reasoning events, agent packs, memory layer, conversation, orchestrator routing, and dispatch.

## Quickstart

New to OpenWOP? Two paths:

- **[`QUICKSTART-10MIN.md`](./QUICKSTART-10MIN.md)** â fastest possible "what is OpenWOP and how do I run one?" Boots the in-memory reference host on your laptop, runs a workflow via curl + SDK + SSE. No vendor SDK, no managed-service setup. Just Node 20+ and a clone of this repo.
- **[`QUICKSTART.md`](./QUICKSTART.md)** â end-to-end walkthrough against any OpenWOP-compliant host: auth + create run + read snapshot, SSE + webhooks, fork + replay, node packs, conformance.

For the full workflow-engine demo app, use the repo-local CLI (a TypeScript package — build it once, then run the bundle):

```bash
npm --prefix cli install && npm --prefix cli run build
node cli/dist/openwop.js doctor
node cli/dist/openwop.js demo start
node cli/dist/openwop.js demo status
```

See [`cli/README.md`](./cli/README.md) and [`docs/OPENWOP-CLI-RESEARCH-AND-PLAN.md`](./docs/OPENWOP-CLI-RESEARCH-AND-PLAN.md).

## Examples

Runnable example projects under [`examples/`](./examples/):

- **[`tiny-workflow/`](./examples/tiny-workflow/)** â smallest possible OpenWOP run lifecycle (~80 lines, zero deps).
- **[`streaming-client/`](./examples/streaming-client/)** â SSE event-stream consumer with hand-written frame parser (~110 lines, zero deps).
- **[`idempotent-runs/`](./examples/idempotent-runs/)** â Layer-1 HTTP idempotency: retries collapse, body conflicts get 409 (~80 lines, zero deps).
- **[`hosts/in-memory/`](./examples/hosts/in-memory/)** â reference OpenWOP server (~1,250 LOC, Node stdlib only). The host the other examples run against. Started as a single-file ~570-LOC reference; grew as the audit / interrupts / webhooks / observability modules landed.
- **[`hosts/sqlite/`](./examples/hosts/sqlite/)** â durable reference OpenWOP server (~3,600 LOC across `server.ts` + `audit.ts` + `interrupts.ts` + `webhooks.ts` + `observability.ts`, single runtime dep `better-sqlite3`). Runs + events persist across process restart. The README doubles as the **"Build Your Own Host" walkthrough**.

Examples run end-to-end in CI via [`.github/workflows/examples.yml`](./.github/workflows/examples.yml) so they don't go stale.

## Reference applications

End-to-end deployable templates under [`apps/`](./apps/) â a tier above `examples/`. Where `examples/` are single-file demos and `examples/hosts/` are conformance-test targets, `apps/` are full vertical-slice templates with backend + frontend + Dockerfile + auth + storage + observability wired together.

- **[`apps/workflow-engine/`](./apps/workflow-engine/)** â single-container TypeScript backend + React frontend. Implements run lifecycle, all 4 interrupt kinds, SSE streams (4 modes + Last-Event-ID resume), BYOK with strip-on-persist, OTel under `openwop.*`, pack consumption with SRI + Ed25519. Sample / template code; not production-hardened. Targets ~70% conformance â see the README for the honest skip-equivalent matrix.

## Operational references

- **[`PUBLISHING.md`](./PUBLISHING.md)** â operational plan for publishing the 4 spec-corpus artifacts (TS SDK, TS conformance, Python SDK, Go SDK). Cadence, release manager, pre-publish checklist, CI sketch.
- **[`registry-operations.md`](./spec/v1/registry-operations.md)** â operator-side reference for node-pack registries: submission / validation / deprecation / yank / signing-key rotation flows.
- **[`storage-adapters.md`](./spec/v1/storage-adapters.md)** â `RunEventLogIO` + `SuspendIO` contracts for storage backends; in-memory references.

## Design standards

- **[`DESIGN.md`](./DESIGN.md)** â marketing-site standards + shared editorial palette (`--paper` / `--ink` / `--clay` / `--star-glow`) + Instrument Serif + Geist + Geist Mono type triple. Source of truth for `public/styles.css` and the warm-dark token override that any future surface adopts.
- **[`DESIGN.app.md`](./DESIGN.app.md)** â reference-app standards for `apps/workflow-engine/frontend/react/`. App-specific components, functional status tokens, xyflow canvas theming, Firebase-Auth vendor-mark policy, inline-style policy. Mirrors shared tokens from `DESIGN.md` per the SYNC RULE in `apps/workflow-engine/frontend/react/src/styles/global.css :root`.
- Reviewed by `/ux-review`.

## Status legend

| Tag | Meaning |
|---|---|
| **STUB** | Minimal coverage of stable surfaces only. Implementers SHOULD pin only to what's documented; assume gaps. |
| **DRAFT** | Comprehensive coverage of stable + in-flight surfaces, but not yet reviewed by spec committee. |
| **OUTLINE** | Sketched but not detailed. Section headings lock; field schemas may shift. |
| **FINAL** | Frozen. Breaking changes go to v2. |

Within DRAFT/OUTLINE specs, individual fields and section subgroups carry inline tags:
- **(stable)** â shape locked
- **(in-flight)** â driven by active implementation work and subject to compatible adjustment before a future minor
- **(future)** â deferred to v1.x or v2

## Reading order

For implementers building an OpenWOP-compliant **server**:

1. **`auth.md`** â auth model + scope vocabulary
2. **`rest-endpoints.md`** â endpoint catalog
3. **`idempotency.md`** â two-layer contract (REQUIRED for safe retries)
4. **`version-negotiation.md`** â version stamping + deploy-skew rules
5. **`capabilities.md`** â `/.well-known/openwop` handshake
6. **`stream-modes.md`** â SSE delivery modes
7. **`interrupt.md`** â HITL primitive
8. **`run-options.md`** â `configurable`/`tags`/`metadata`
9. **`observability.md`** â `openwop.*` OTel taxonomy
10. **`replay.md`** â time-travel debug surface
11. **`channels-and-reducers.md`** â typed state model (largest, depends on others)

For implementers building an OpenWOP-compliant **client (CLI, SDK, agent)**:

1. **`auth.md`**
2. **`rest-endpoints.md`** â request shapes
3. **`stream-modes.md`** â `?streamMode=` selection
4. **`capabilities.md`** â pre-flight handshake (advisory)
5. **`version-negotiation.md`** â `minClientVersion` + version pinning
6. **`run-options.md`** â `configurable` knobs the server accepts
7. **`interrupt.md`** â HITL UX patterns
8. **`replay.md`** â time-travel for end-user debug

## Spec foundations

Six items are **borrowed idioms** from adjacent ecosystems. Cited where used:

| Idiom | Borrowed from | Where in spec |
|---|---|---|
| Per-(run, changeId) version pinning | [Temporal `getVersion`](https://docs.temporal.io/dev-guide/typescript/versioning) | `version-negotiation.md` |
| Stream mode taxonomy (`values`/`updates`/`messages`/`debug`) | [LangGraph streaming](https://langchain-ai.github.io/langgraph/concepts/streaming/) | `stream-modes.md` |
| `interrupt(payload)` HITL primitive | [LangGraph human-in-the-loop](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/) | `interrupt.md` |
| `configurable` per-run overlay | [LangChain `RunnableConfig.configurable`](https://python.langchain.com/docs/concepts/runnables/#configurable-runnables) | `run-options.md` |
| Typed channels + reducers | [LangGraph `Annotated[T, reducer]`](https://langchain-ai.github.io/langgraph/concepts/low_level/#state) | `channels-and-reducers.md` |
| Replay / fork-from-checkpoint | [LangGraph `update_state(checkpoint, ...)`](https://langchain-ai.github.io/langgraph/concepts/persistence/#update-state) | `replay.md` |

Borrowing is for **ecosystem familiarity**, not vendor lock-in â none of these implementations are normative dependencies. OpenWOP-compliant implementations are free to ignore the borrowed source and follow the spec text alone.

## Machine-readable artifacts

| Artifact | Path | Version | Tooling |
|---|---|---|---|
| JSON Schemas | `schemas/*.schema.json` | 1 | Ajv2020 (JSON Schema 2020-12) |
| OpenAPI 3.1 spec | `api/openapi.yaml` | 1 | `redocly lint` / `redocly bundle` |
| AsyncAPI 3.1 spec | `api/asyncapi.yaml` | 1 | `asyncapi validate` / `asyncapi bundle` |
| Conformance suite | [`conformance/`](./conformance/) | 1.0 | `vitest` / `openwop-conformance` CLI |
| TS reference SDK | [`sdk/typescript/`](./sdk/typescript/) | 1.0 | `tsc` |
| Python reference SDK | [`sdk/python/`](./sdk/python/) | 1.0 | `python3 -m ast` + import |
| Go reference SDK | [`sdk/go/`](./sdk/go/) | 1.0 | `go vet` |

The two API specs reference the JSON Schemas via cross-file `$ref`; bundlers inline them on demand. The conformance suite is a self-contained driver-style harness â point it at any OpenWOP-compliant server with `OPENWOP_BASE_URL` + `OPENWOP_API_KEY` env vars and run `npx vitest run` (or use the `openwop-conformance` CLI for friendlier output). At v1 the suite covers discovery, auth, errors, run lifecycle, idempotency, cancellation, HITL approval/clarification, failure paths, identity passthrough, multi-node ordering, SSE stream modes, replay/fork, and version negotiation. See [`conformance/README.md`](./conformance/README.md).

## What's NOT in v1

These are deliberately deferred:

- **External security audit + vendor-neutral org migration** â both ecosystem milestones gated on a â¥1-non-steward maintainer tripwire per [`ROADMAP.md`](./ROADMAP.md) Â§Phase 4.

The reference node-pack registry at [`packs.openwop.dev`](https://packs.openwop.dev) **is live** (Stage 1â4 deployed 2026-05-12, packCount 48 as of 2026-05-13 across `core.openwop.*` / `community.openwop-team.*` / `vendor.openwop.*` / `vendor.myndhyve.*` trust tiers). See [`docs/PACK-CATALOG.md`](./docs/PACK-CATALOG.md) for the categorized inventory and [`examples/market-intel-pipeline/`](./examples/market-intel-pipeline/) + [`examples/ads-publish-pipeline/`](./examples/ads-publish-pipeline/) for reference compositions. For the canonical multi-agent worked example (orchestrator + dispatch + AgentRef + reasoning events + HITL + memory + RFC 0012 compaction) see [`examples/multi-agent-research-assistant/`](./examples/multi-agent-research-assistant/); for the cross-host counterpart that drives an external A2A peer end-to-end see [`examples/multi-agent-cross-host/`](./examples/multi-agent-cross-host/).

## Reporting issues

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide. In short â file issues against the implementation repo with the label `openwop-spec`. Include:

- Doc filename + section heading
- Specific RFC 2119 requirement that's unclear or contradictory
- Implementation impact (what's blocked / what's ambiguous)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) â `[1] â 2026-05-08 â OpenWOP v1 FINAL (multi-agent extensions)` is the current top entry.

**v1 Multi-Agent Extensions (Accepted):**
- [**RFC 0002**](./RFCS/0002-agent-identity-and-reasoning-events.md) â Agent identity + reasoning events: `AgentRef` wire shape, `agent.reasoned`/`agent.toolCalled`/`agent.toolReturned`/`agent.handoff`/`agent.decided`/`runOrchestrator.decided` event types, confidence scoring, messaging reducer, replay determinism
- [**RFC 0003**](./RFCS/0003-agent-packs.md) â Agent packs: Extend `pack.json` with `agents[]` for agent manifest distribution alongside node implementations
- [**RFC 0004**](./RFCS/0004-memory-layer.md) â Memory layer: `MemoryAdapter` host interface for agent memory persistence with BYOK redaction guarantees
- [**RFC 0005**](./RFCS/0005-conversation.md) â Conversation: Generalize one-shot suspend â multi-turn `conversation` for orchestrator-driven HITL flows
- [**RFC 0006**](./RFCS/0006-orchestrator.md) â Orchestrator: New `runOrchestrator` field on `WorkflowRunDocument`, orchestrator-driven routing, replay cache-only determinism
- [**RFC 0007**](./RFCS/0007-dispatch.md) â Dispatch: New `core.dispatch` node pattern for sub-workflow invocation with fresh agent context

**v1.x Capability Profiles (all `Accepted`):**
- [**RFC 0012**](./RFCS/0012-memory-compaction-profile.md) â Memory compaction profile (`Accepted` 2026-05-15): optional `capabilities.memory.compaction` advertisement, `memory.compacted` event vocabulary, and an SR-1 carry-forward invariant that extends RFC 0004 Â§D through host-side memory distillation. Additive; no v1 contract change. Postgres reference host implements end-to-end when `OPENWOP_MEMORY_COMPACTION=true`.
- [**RFC 0013**](./RFCS/0013-workflow-chain-packs.md) â Workflow-chain packs (`Accepted` 2026-05-18): pack-kind distinguished manifest for workflow templates with host-side expansion semantics. Pairs with the n8n-style root+sub-node composition shipped in `core.openwop.agents`. Spec doc `workflow-chain-packs.md` lands as `DRAFT v1.x` pending Phase B/C closure.
- [**RFC 0014**](./RFCS/0014-host-fs-capability.md) â `host.fs` filesystem capability (`Accepted`): read/write/list/stat/delete inside a sandbox root with `fs-path-traversal` invariant. Unblocks `core.openwop.files`.
- [**RFC 0015**](./RFCS/0015-host-kv-storage-capability.md) â `host.kvStorage` key-value store (`Accepted`): TTL + atomic increment + CAS + cross-tenant isolation. Unblocks `core.openwop.storage` kv-* nodes.
- [**RFC 0016**](./RFCS/0016-host-table-storage-capability.md) â `host.tableStorage` structured records (`Accepted`): typed columns + cursor pagination. Make-Data-Store equivalent.
- [**RFC 0017**](./RFCS/0017-host-queue-bus-capability.md) â `host.queueBus` inbound queue + stream (`Accepted`): publish + consume (trigger) + ack/nack/dead-letter + stream subscribe with cross-tenant isolation. Unblocks `core.openwop.messaging`.
- [**RFC 0018**](./RFCS/0018-host-sql-vector-search-capability.md) â Database adapter capabilities (`Accepted`): `host.sql` (parametric-only) + `host.nosql` + `host.vectorStore` + `host.searchIndex`. Unblocks `core.openwop.db` + `core.openwop.rag`.
- [**RFC 0019**](./RFCS/0019-host-blob-cache-capability.md) â `host.blobStorage` + `host.cache` (`Accepted`): binary artifacts with presigned URLs + TTL cache. Unblocks `core.openwop.storage` blob/cache nodes.
- [**RFC 0020**](./RFCS/0020-host-mcp-server-composition.md) â Host-side MCP server composition (`Accepted`): extends `spec/v1/mcp-integration.md` with a Â§"OpenWOP host as MCP server" section + `capabilities.mcp.serverMount` block + bidirectional sampling/elicitation bridges. Unblocks the 8 server-side `core.openwop.mcp.*` nodes shipped in v1.1.0.

**v1.x Multi-agent + prompt + envelope hardening (all `Accepted`):**
- [**RFC 0021**](./RFCS/0021-ai-envelope-primitive.md) â AI Envelope primitive (`Accepted`): `POST /v1/host/sample/envelope/accept` outcome decision tree; foundation of the Â§B/Â§C envelope-reliability stack.
- [**RFC 0022**](./RFCS/0022-dispatch-input-output-mapping.md) â Dispatch input/output variable mapping (`Accepted`): parent â child variable projection via `inputMapping` + `outputMapping` on `core.dispatch`.
- [**RFC 0023**](./RFCS/0023-conformance-agent-event-emitters.md) â `agent.toolCalled` â `agent.toolReturned` strict causation pairing (`Accepted`).
- [**RFC 0024**](./RFCS/0024-agent-reasoning-streaming.md) â Streaming reasoning deltas (`Accepted`): `agent.reasoning.delta` event with verbosity-gated emission.
- [**RFC 0026**](./RFCS/0026-provider-usage-event.md) â Provider-usage / cost-attribution event vocabulary (`Accepted`).
- [**RFC 0027**](./RFCS/0027-prompt-templates.md) â Prompt templates (`Accepted` 2026-05-23 on MyndHyve compose-seam adoption): named, versioned, variable-bound prompts; produces `spec/v1/prompts.md`.
- [**RFC 0030**](./RFCS/0030-envelope-reasoning-and-tier-one-subset.md) â Envelope `reasoning` field + Tier-1 cross-vendor structured-output subset (`Accepted` 2026-05-21).
- [**RFC 0031**](./RFCS/0031-envelope-variants-and-model-capabilities.md) â Envelope variant payload discrimination + `NodeModule.requiredModelCapabilities` (`Accepted` 2026-05-21).
- [**RFC 0032**](./RFCS/0032-envelope-reliability-events.md) â Six envelope-reliability `RunEventType` entries (`Accepted` 2026-05-21).
- [**RFC 0033**](./RFCS/0033-envelope-completion-contract.md) â Envelope-completion criteria; truncation-vs-schema-violation retry routing (`Accepted` 2026-05-21).
- [**RFC 0034**](./RFCS/0034-otel-collector-test-seam.md) â OTel collector test seam (`Accepted` 2026-05-23 on MyndHyve OTel-seam adoption).
- [**RFC 0037**](./RFCS/0037-multi-agent-execution-model.md) â Multi-agent execution model Phase 1: handoff state machine (`Accepted` 2026-05-22).
- [**RFC 0039**](./RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md) â Multi-agent execution model Phase 2: confidence-floor escalation + memory lifecycle Half B (`Accepted` 2026-05-22).
- [**RFC 0040**](./RFCS/0040-multi-agent-cross-host-causation.md) â Multi-agent execution model Phase 3: cross-host causation + traceparent propagation (`Accepted` 2026-05-24 on MyndHyve `multiAgent.executionModel.version: 3` advertisement). 4 `it.todo` assertions in `cross-host-traceparent-propagation.test.ts` await an upstream cross-host harness driver.
- [**RFC 0041**](./RFCS/0041-multi-agent-replay-under-nondeterminism.md) â Multi-agent execution model Phase 4: replay determinism + observable-result caching (`Accepted` 2026-05-25 on MyndHyve `multiAgent.executionModel.version: 4` + `replayDeterminism.{supported: true, llmCacheKeyRecipe: "spec-rfc-0041", refusalDivergenceEmission: true}` advertise). The Â§B refusal-divergence BEHAVIORAL probe remains an upstream suite-side `it.todo` (cross-revision driver not yet authored on the openwop side); MyndHyve's `serverCallAI.ts:checkRefusalDivergence` wiring will exercise the driver when it lands.
- [**RFC 0028**](./RFCS/0028-prompt-library-endpoints.md) â Prompt library endpoints + pack kind (`Accepted` 2026-05-25 on MyndHyve's Tier-2 `capabilities.prompts.{packsSupported: true, mutableLibrary: true, library: {id: "myndhyve-system", renderEndpoint: "/v1/prompts:render", maxRenderRequestBytes: 65536}}` advertisement). A parallel MyndHyve session shipped the host-side `kind: "prompt"` pack ingest end-to-end during the same conformance window that closed RFC 0041.
- [**RFC 0044**](./RFCS/0044-confidence-escalation-interrupt-kind-advertisement.md) â Confidence-escalation interrupt-kind vendor-routing pattern (`x-host-<host>-<kind>`) for entrenched host semantics (`Accepted` 2026-05-22).

**v1.x MyndHyve protocol-extension cohort (all `Accepted` 2026-05-25 on a single verified conformance run â PR #148, commit `c9c6bfc`; MyndHyve workflow-runtime revision `workflow-runtime-00211-69w` against `@openwop/openwop-conformance@1.6.0`, 28 PASS / 0 FAIL):**
- [**RFC 0045**](./RFCS/0045-connector-pack-manifest-action-model.md) â Connector pack manifest & action model (`Accepted`). Optional `connector` manifest block (typed actions + idempotency/rate-limit metadata) binding to 0047 auth + 0046 credentials.
- [**RFC 0046**](./RFCS/0046-host-credentials-capability.md) â `host.credentials` capability (`Accepted`). Portable credential resolution + lifecycle (store-at-rest, workspace sharing, two-key-overlap rotation). New `credential-payload-redaction` SECURITY invariant.
- [**RFC 0047**](./RFCS/0047-host-oauth-connector-flows.md) â `host.oauth` connector flows (`Accepted`). Host-performed OAuth2 authorization-code + refresh; tokens stored as 0046 credentials. Closes the `auth.md` authorization-code "Open spec gap".
- [**RFC 0048**](./RFCS/0048-tenant-workspace-principal-identity-model.md) â TenantÂ·workspaceÂ·principal identity model (`Accepted`). Promotes RFC 0011's tenant dimension to an explicit `{tenant, workspace?, principal}` triple threading discovery + run ownership + events.
- [**RFC 0049**](./RFCS/0049-rbac-scopes-and-authorization-decisions.md) â RBAC scopes & authorization decisions (`Accepted`). Roleâscope binding + `authorization.decided` event + fail-closed `authorization-fail-closed` SECURITY invariant.
- [**RFC 0051**](./RFCS/0051-approval-deployment-gate-primitive.md) â Approval & deployment-gate primitive (`Accepted`). `core.openwop.governance.approvalGate` interrupt node â role-gated, audited approvals composing quorum + auth-required profiles with 0049 authorization.
- [**RFC 0052**](./RFCS/0052-scheduling-and-time-based-triggers.md) â Scheduling & time-based triggers (`Accepted`). `host.scheduling` (cron/delayed/calendar + horizon) wiring the `schedule` trigger to a durable, once-per-tick execution contract.
- [**RFC 0053**](./RFCS/0053-dead-letter-routing-and-failure-sinks.md) â Dead-letter routing & failure sinks (`Accepted`). `host.deadLetter` + `run.dead_lettered` event; terminally-failed runs land in a durable, fork-eligible sink.

**v1.x Autonomous-agent-runtime cohort (all `Accepted` 2026-05-25; M1 wire-surface + M2 reference-host enforcement landed atomically â see [`docs/autonomous-agent-runtime-plan.md`](./docs/autonomous-agent-runtime-plan.md)):**
- [**RFC 0059**](./RFCS/0059-agent-workspace.md) â Agent workspace (`Accepted` 2026-05-25). `capabilities.workspace` (`{supported, versioned, maxFileBytes, maxFiles, maxVersions}`) + four `/v1/host/workspace/files` endpoints (versioned CRUD with `If-Match` â `409 workspace_conflict`, `workspace_too_large`) + run-start read snapshot exposed on the run snapshot (replay-deterministic) + `workspace.updated` event. New protocol-tier `workspace-cross-tenant-isolation` SECURITY invariant (WCT-1). The in-memory reference host implements Â§C/Â§D/Â§E end-to-end via the `POST /v1/host/sample/workspace/op` seam.
- [**RFC 0060**](./RFCS/0060-host-heartbeat-capability.md) â `host.heartbeat` (`Accepted` 2026-05-25). Additive `capabilities.heartbeat` block + two heartbeat-scoped AsyncAPI events (`heartbeat.evaluated` / `heartbeat.stateChanged`). The Â§B.5 anti-spam contract â `stateChanged` + enqueue only on a state transition â is the keystone. In-memory host implements the `POST /v1/host/sample/heartbeat/tick` seam end-to-end.
- [**RFC 0062**](./RFCS/0062-scheduled-memory-distillation.md) â Scheduled memory distillation ("dreams") (`Accepted` 2026-05-25). Additive `capabilities.memory.distillation` sub-block + additive optional `distillation { tokenBudget, tokensUsed, indexUpdated }` sub-object on the existing `memory.compacted` event (RFC 0012 â no parallel event type) + `distillation.tokenBudget` reserved run-option key + `token_budget_exceeded` error code. Composes RFC 0012 + 0052 + 0059. In-memory host implements the `POST /v1/host/sample/memory/distill` seam end-to-end (byte-stable JCS+SHA-256 archive, content-free `MEMORY-INDEX.json`, SR-1 carry-forward, 422 on un-meetable budget with no partial archive).
- [**RFC 0063**](./RFCS/0063-subrun-output-attestation-and-merge-gating.md) â `core.subWorkflow` output attestation & merge gating (`Accepted` 2026-05-25). Additive `capabilities.agents.subRunAttestation` flag + additive optional `attestation { checksum, algorithm }` object on the existing `core.workflowChain.event { phase: 'output.harvested' }` (RFC 0037 â no new event type). New protocol-tier `subrun-merge-approval-fail-closed` SECURITY invariant. In-memory host implements the `POST /v1/host/sample/subrun/attest` seam end-to-end â merge proceeds only on `accept`/`edit-accept`; fails closed on `reject`/absent. Reuses RFC 0051 approval + RFC 0049 scopes.
- [**RFC 0064**](./RFCS/0064-tool-invocation-hooks-and-authorization.md) â `host.toolHooks` (tool-invocation hooks & authorization) (`Accepted` 2026-05-25). Additive flat `capabilities.toolHooks` block (`prePostEvents` / `perToolAuthorization` / `perToolRateLimit`) + optional content-free fields on the existing `agent.toolCalled` / `agent.toolReturned` run-event payloads (`argsHash` (RFC 8785 JCS + SHA-256, SR-1-redacted), `principal`, `transport`, `status`, `durationMs`). In-memory host implements the `POST /v1/host/sample/toolhooks/invoke` seam end-to-end â per-tool authz fails closed (per-tool application of RFC 0049's `authorization-fail-closed`); `rate_limited` on bucket exhaustion. No new event type, error code, or invariant.

**v1.x MyndHyve round-3 graduates (all `Accepted` 2026-05-26 on workflow-runtime revision `workflow-runtime-00217-q7c`; openwop-side curl-verified â see [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md) Â§"round 3"):**
- [**RFC 0029**](./RFCS/0029-prompt-override-hierarchy.md) â Prompt resolution chain across node / agent / workflow / host (`Accepted` 2026-05-26). MyndHyve advertises `capabilities.prompts.agentBindings: true` + emits `agent.promptResolved`. Closes its sole remaining acceptance box.
- [**RFC 0055**](./RFCS/0055-multimodal-envelope-variants-and-rendering-hints.md) â Multimodal envelope variants + `meta.rendering` hints + `media.*` reference payloads (`Accepted` 2026-05-26). MyndHyve advertises `aiProviders.maxInlineMediaBytes: 10485760` + `aiProviders.modelCapabilities.advertised: ['vision-input','image-output']`. `audio-*` honestly omitted (no audio pipeline) â correct reserved-identifier discipline.
- [**RFC 0057**](./RFCS/0057-memory-write-attribution-event.md) â Memory-write attribution event (`Accepted` 2026-05-26). Content-free `memory.written` RunEvent + `capabilities.memory.attribution.{supported, emitsWriteEvents}`. Two protocol-tier SECURITY invariants (`memory-attribution-no-content` + `memory-attribution-tenant-scoped`). MyndHyve advertises `capabilities.memory.attribution.{supported: true, emitsWriteEvents: true}` and dual-emits canonical + `x-host-myndhyve-memory-written` (MAE-3 reverse-projection); the in-memory + Postgres + SQLite reference hosts also emit on their run-summary write.

**Active RFCs (`Active` â wire-shape MAY shift compatibly within v1.x; awaiting cross-host adoption evidence per `RFCs/0001` Â§"Promotion to Accepted"):**
- [**RFC 0025**](./RFCS/0025-test-mode-registry-namespace.md) â Test-mode registry namespace `/v1/packs-test/*` (`Active` 2026-05-25). Capability flag `packs.testMode` + 4 mirror endpoints surfacing the 19-code publish-error catalog against an isolated catalog. Reference workflow-engine ships in-memory impl env-gated on `OPENWOP_PACKS_TEST_NAMESPACE_ENABLED=true`. Path-to-Accepted requires a second host advertising `packs.testMode.supported: true`.
- [**RFC 0035**](./RFCS/0035-sandbox-execution-contract.md) â Sandbox execution contract (`Active`). 8 advertisement-shape scenarios shipped + 10 behavioral assertions PASS against workflow-engine's `node:vm` MVP. Path-to-Accepted requires a non-steward sandbox-executing host.
- [**RFC 0036**](./RFCS/0036-multi-region-and-cross-engine-guarantees.md) â Multi-region idempotency + cross-engine append-ordering (`Active`). Behavioral close-out landed 2026-05-22 via workflow-engine test seams (10 PASS). Path-to-Accepted requires non-steward host advertising matching capabilities.
- [**RFC 0056**](./RFCS/0056-run-feedback-and-annotation-event.md) â Run feedback & annotation event (`Active` 2026-05-25). Surface landed atomically across schema (`capabilities.feedback` + `annotation.schema.json` + `annotation-create.schema.json`), OpenAPI/AsyncAPI (`POST/GET /v1/runs/{runId}/annotations` + the `run.annotated` SSE notification), 7 capability-gated conformance scenarios, all three reference SDKs, and the in-memory + Postgres + SQLite reference hosts (each advertises `capabilities.feedback`, implements the per-run annotation side-store with SR-1 content redaction). Path-to-Accepted awaits non-steward adoption.
- [**RFC 0058**](./RFCS/0058-run-execution-bounds.md) â Run execution bounds (`Active` 2026-05-25). Wire surface landed atomically (`capabilities.limits.{maxRunDurationMs,maxLoopIterations}` + `cap.breached{run-duration,loop-iterations}` payloads); the in-memory + Postgres + SQLite hosts now enforce the `runTimeoutMs` wall-clock arm end-to-end (emits `cap.breached{run-duration}` + `run_timeout`). The `maxLoopIterations` arm is gated on the RFC 0061 stateful agent-loop host. Path-to-Accepted requires non-steward `limits.maxRunDurationMs` advertisement (MyndHyve round-3 did NOT graduate â their `maxNodeExecutions` is the pre-existing recursionLimit bound, a different `cap.breached` kind).
- [**RFC 0061**](./RFCS/0061-agent-loop-lifecycle.md) â Stateful agent-loop lifecycle, `multiAgent.executionModel.version: 5` (`Active` 2026-05-25). The autonomous-agent-runtime cohort's keystone â promotes the RFC 0037 execution loop to a stateful per-iteration lifecycle: `executionModel.version` ceiling bumped 4 â 5; additive optional `statefulResume` / `transcriptWindow` fields; additive optional `iteration` counter on the existing `runOrchestrator.decided` payload (1-based, monotonic â the observable quantity `maxLoopIterations` bounds; no new event type); normative `## Stateful agent-loop lifecycle (version >= 5)` section in `multi-agent-execution.md` (per-iteration memory+workspace+transcript snapshot inputs, stateful HITL resume preserving the counter, acceptance via `terminate`). Composes RFC 0058 bound + RFC 0059 workspace + RFC 0039 memory snapshot + RFC 0041 replay determinism â no new event type, capability block, or SECURITY invariant. Path-to-Accepted requires a host wiring the v5 loop (genuine re-entrant agent-loop runtime, not a single-pass dispatcher).

**Draft RFCs (`Draft` â public comment window OR awaiting tripwire):**
- [**RFC 0038**](./RFCS/0038-working-group-charter.md) â Working Group charter (`Draft`). Charter is land-ready; activation gated on `GOVERNANCE.md` Â§"Path to working group" tripwire (â¥3 independent organizations + â¥2 non-steward hosts passing conformance).
- [**RFC 0042**](./RFCS/0042-experimental-capability-tier.md) â Experimental capability tier (`Draft`). Optional `tier â {stable, experimental}` field on capability advertisements + sunset rule + derived `openwop-experimental` profile. Schema + `experimentalGate()` helper landed; promotion to Active pending first host advertising `tier: 'experimental'`.
- [**RFC 0043**](./RFCS/0043-registry-and-extension-policy.md) â Registry + extension policy (`Draft`). IPR posture + vendor-extension namespace rules + neutral process for profile/event-type/capability/envelope-kind name reservations.
- [**RFC 0065**](./RFCS/0065-workflow-node-primary-output-annotation.md) â Workflow node primary-output annotation (`Draft` 2026-05-25). Additive optional `outputRole: "primary" | "secondary"` on `WorkflowNode` so tooling can disambiguate the canonical artifact on multi-terminal DAGs; advisory-only â engine behavior unchanged. Filed from the chat-surface architect-review pass.
- [**RFC 0066**](./RFCS/0066-x-openwop-form-vendor-extension.md) â `x-openwop-form` advisory annotation on pack-manifest `configSchema` properties (`Draft` 2026-05-25). Reserves the vendor-extension key so pack authors can opt their nodes into picker-grade UX (model/provider/credential/prompt pickers + cross-field cascades) that the reference-app catalog already provides for built-in nodes. Hosts MUST NOT read it; pure additive per `COMPATIBILITY.md Â§2.1`.
- [**RFC 0067**](./RFCS/0067-provider-catalog-conventions.md) â Provider-catalog conventions (`Active` 2026-05-29; promoted from `Draft` — full wire surface already on `main`, UQ3 resolved host-config-only). Additive optional `capabilities.aiProviders.authModes` map (`apiKey` / `oauth-pkce` / `oauth-device` / `none`) so clients can pre-flight how a host expects each provider's credential supplied, plus a non-normative provider-name vocabulary on `aiProviders.supported`. Default contract unchanged for hosts that omit `authModes`. Backs gap-analysis row 3 (catalog expansion).
- [**RFC 0068**](./RFCS/0068-memory-consolidation-and-standing-commitments.md) â Memory consolidation + standing commitments (`Active` 2026-05-29; promoted from `Draft` — full wire surface already on `main`, all four Unresolved questions resolved incl. consolidation replay-determinism per RFC 0041 §C). Two additive optional capabilities â `agents.memoryConsolidation` (background merge/dedup/strengthen of long-term memory, distinct from RFC 0062 distillation) + `agents.commitments` (inferred standing intentions firing a run later) â each with one content-free event (`agent.memory.consolidated`, `commitment.fired`). All four Unresolved questions resolved at `Active` (replay determinism: a consolidation pass is a host-managed mutation outside the replay envelope, per RFC 0041 §C). Backs gap-analysis row 4 (dreaming + inferred commitments).
- [**RFC 0069**](./RFCS/0069-exec-class-tool-host-extension-safety-contract.md) â Host-extension safety contract for `exec`-class tools (`Active` 2026-05-29; promoted from `Draft` — every acceptance artifact already on `main`, comment window waived per `GOVERNANCE.md` lazy consensus). Codifies the existing exclusion as a normative MUST-NOT: arbitrary-command execution MUST NOT be a protocol-tier capability â it lives only in `x-host-<vendor>-exec` host-extension scopes with host-owned sandboxing/allowlist/approval/audit. Adds the protocol-tier SECURITY invariant `exec-must-not-be-protocol-tier` + an always-on server-free conformance scenario. No host wire shape changes. Backs gap-analysis row 7.
- [**RFC 0073**](./RFCS/0073-capability-document-root-layout.md) — Capability families are document-root properties of `/.well-known/openwop` (`Draft` 2026-05-27, safety-fix/corrective). Makes the schema's existing root placement a normative `MUST` (`capabilities.schema.json` already roots `agents`/`secrets`/etc. with no wrapper) and marks a top-level `capabilities` wrapper a deprecated v1.x-window legacy shape. Lands a shared root-first/wrapper-fallback conformance accessor + migrates the agent-cohort readers + the primary reference host onto the root shape. Resolves the RFC 0070 discovery-layout caveat openwop-side (no MyndHyve mirror). No schema change.
- [**RFC 0077**](./RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md) — Agent Run Lifecycle + Live Manifest Dispatch (`Active` 2026-05-29; promoted from `Draft` — wire surface landed atomically + all 5 UQs resolved via MyndHyve T4 co-design). The Wave-1 keystone's live-execution layer: a normative `AgentManifest` → live-run mapping (modelClass→model/provider selection, prompt resolution, tool-surface construction, memory binding, handoff + structured-output validation, confidence escalation, terminal projection) + an additive optional `capabilities.agents.liveRuntime` (⊃ `manifestRuntime`) + an `agent.invocation.started`/`agent.invocation.completed` content-free event bracket around the existing `agent.*` family, so a manifest agent emits one identical observable family across all three entry points (workflow node, run API, chat mention). Composes RFC 0070 + 0072 + 0061 + 0002. Additive; all five Unresolved questions resolved (T4 co-design; `invocationId` recorded-fact per `replay.md`). `Active → Accepted` gated on a non-steward host (MyndHyve) advertising `liveRuntime` + emitting the invocation pair. Backs gap-analysis "Run agent" surface.
- [**RFC 0078**](./RFCS/0078-portable-tool-catalog-and-tool-session-contract.md) — Portable Tool Catalog + Tool Session Contract (`Draft` 2026-05-29). Wave-2 companion to 0077: an optional capability-gated read-only projection `GET /v1/tools` + `GET /v1/tools/{toolId}` returning a normative `ToolDescriptor` (stable `toolId`, source∈{node-pack|workflow|mcp|connector|host-extension}, I/O schemas, auth/egress/approval requirements, replay policy, **safety tier** — `pure`/`read`/`write`/`exec`, with `exec` ⇒ host-extension-only per RFC 0069) across all five tool surfaces, plus an optional tool-session lifecycle. Read-only; authorization-scoped + non-disclosing (RFC 0074 pattern); secret-free. Composes/reuses RFC 0064 (hooks), 0049/0046/0051 (auth/credential/approval), 0076 §B (egress), 0069 (exec tier), `host.mcp`/0045/node-packs (sources), 0077 (`toolAllowlist` consumer). Additive; carries four `Active`-gated Unresolved questions. Backs gap-analysis Tool Catalog UI + descriptor-based agent building.
- [**RFC 0080**](./RFCS/0080-agent-memory-capability-reconciliation.md) — Agent Memory Capability Reconciliation (`Draft` 2026-05-29). Wave-2 editorial/composable: reconciles the fragmented memory advertisement (`capabilities.memory.*` + `capabilities.agents.{memoryBackends,memoryConsolidation,commitments}` + `agent-memory.md` + `AgentManifest.memoryShape`) into one coherent **additive** model — eight named dimensions (read/write/search/long-term/compaction/attribution/replay-snapshot/retention-forget), adding the two missing optional ones (`memory.search`, `memory.retention`) + a derived `openwop-memory` profile; resolves the canonical-query-endpoint question (memory query stays host-internal at v1.x, no `GET /v1/memory`); and **requires `GET /v1/agents` to surface `memoryShape` degraded-status** (no silent degradation). No existing flag moved/renamed (a structural re-org would be breaking → deferred). Composes RFC 0004/0012/0057/0062/0068 + 0077 memoryShape + 0072/0074 inventory. Additive; four `Active`-gated Unresolved questions. Backs gap-analysis Memory console + agent memory-status.
- [**RFC 0079**](./RFCS/0079-credential-provenance-and-egress-policy.md) — Credential Provenance + Egress Policy (`Draft` 2026-05-29). Wave-2 security: answers the credential↔destination-binding question RFC 0076 §B safeFetch explicitly parked. A **credential-provenance descriptor** at the tool/egress boundary (host-issued credentials carry `{credentialId, issuer, audiences, scopes, expiresAt, redactionPolicy, auditCorrelationId}` — content-free of the secret value) + a content-free **`egress.decided`** event (`allowed`/`denied`/`downgraded`/`approval-required`) + the load-bearing MUST + new protocol-tier invariant **`egress-credential-audience-bound`**: a host-issued credential MUST NOT be attached to an egress destination outside its `audiences` (fail-closed) — the confused-deputy guard the URL-level SSRF check doesn't perform. Composes RFC 0076 §B (egress) + 0046/0047 (credential sources) + 0049 (scopes) + 0064 (tool boundary) + 0078 (`ToolDescriptor.egress` static advert) + 0051 (approval). Additive (gated on new `httpClient.egressPolicy`); four `Active`-gated Unresolved questions. Backs gap-analysis Keys-page credential-use view.

*MyndHyve protocol-extension batch â opted-out members (still `Draft`; see [`plans/myndhyve-protocol-extension-rfcs.md`](./plans/myndhyve-protocol-extension-rfcs.md)). The other 8 RFCs in this batch graduated Active â Accepted 2026-05-25 on the verified MyndHyve conformance run â see the cohort block above.*
- [**RFC 0050**](./RFCS/0050-saml-scim-enterprise-identity-profiles.md) â SAML / SCIM enterprise identity profiles (`Draft`). SAML assertion-validation (`alg:none` rejection mirroring OIDC) + SCIM provisioning profiles mapping IdP users/groups onto RFC 0048 principals + RFC 0049 roles. MyndHyve opted out; did not graduate with the cohort.
- [**RFC 0054**](./RFCS/0054-run-diff-and-execution-comparison.md) â Run diff & execution comparison (`Draft`). Read-only `GET /v1/runs/{runId}:diff?against={otherRunId}` returning a deterministic, replay-aware structured diff. MyndHyve opted out.

**v1 Foundation (2026-04-27):**
Current generated state: 44 prose specs (37 FINAL + 6 DRAFT) Â· 47 JSON Schemas Â· 39 OpenAPI operations Â· AsyncAPI 3.1 Â· 295 conformance scenario files Â· 3 reference SDKs. See [docs/PROTOCOL-STATUS.md](./docs/PROTOCOL-STATUS.md) for the machine-generated snapshot.

- **Protocol corpus** â Normative REST, SSE, discovery, auth, idempotency, replay/fork, interruption, observability, node-pack, host-extension, and version-negotiation contracts are frozen for v1.
- **Machine-readable contracts** â OpenAPI 3.1, AsyncAPI 3.1, and JSON Schemas are bundled and cross-validated by the conformance corpus.
- **Conformance** â The v1.0 package covers server-free corpus validity plus black-box host scenarios for discovery, auth, errors, lifecycle, idempotency, cancellation, HITL, failure paths, identity passthrough, multi-node ordering, stream modes, replay/fork, profile derivation, scale gates, and version negotiation.
- **Reference SDKs** â TypeScript, Python, and Go SDKs ship at v1.0 with aligned error helpers and release metadata.

## Where to go next

If you're new to OpenWOP:

- **[`QUICKSTART.md`](./QUICKSTART.md)** â five-minute hands-on tour: discovery, run creation, streaming.
- **[`spec/v1/`](./spec/v1/)** â 44 prose specs (35 `FINAL v1`/`v1.1`, 5 `DRAFT v1.x` extensions). Start with `rest-endpoints.md` and `auth.md`.
- **[`schemas/`](./schemas/)** â JSON Schemas (Draft 2020-12). Compile with Ajv2020.

If you're implementing a host:

- **[`api/openapi.yaml`](./api/openapi.yaml)** + **[`api/asyncapi.yaml`](./api/asyncapi.yaml)** â machine-readable contracts.
- **[`conformance/`](./conformance/)** â `@openwop/openwop-conformance` test suite. Run against your endpoint to verify spec compliance.

If you're consuming OpenWOP from an application:

- **[`sdk/typescript/`](./sdk/typescript/)** â `@openwop/openwop` (npm).
- **[`sdk/python/`](./sdk/python/)** â `openwop-client` (PyPI).
- **[`sdk/go/`](./sdk/go/)** â `github.com/openwop/openwop/sdk/go`.

Project meta:

- **[`ROADMAP.md`](./ROADMAP.md)** â v1 stable / v1.X minor / post-v1 ecosystem.
- **[`GOVERNANCE.md`](./GOVERNANCE.md)** â maintainer model, decision-making, and spec change process.
- **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** â how to propose changes, CI gates, change categories.
- **[`SECURITY.md`](./SECURITY.md)** â coordinated disclosure process.

Reference implementations:

- **[`examples/hosts/in-memory/`](./examples/hosts/in-memory/)** â Node-stdlib reference host (~1,250 LOC). Runs the conformance suite headless on your laptop.
- **[`examples/hosts/sqlite/`](./examples/hosts/sqlite/)** â durable reference host (~3,600 LOC, single runtime dep `better-sqlite3`). Runs persist across process restart.
- **Third-party hosts** are listed in [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md) as they pass conformance. The reference hosts under `examples/hosts/` are non-normative â they exist to prove the protocol cross-implements.

This repository's current steward is the original OpenWOP working group (see [`MAINTAINERS.md`](./MAINTAINERS.md)). The repo is hosted at `github.com/openwop/openwop` until the vendor-neutral org migration tripwire fires (see [`ROADMAP.md`](./ROADMAP.md) Â§ "Vendor-neutral org migration"); host name appearance in the URL is operational, not normative.

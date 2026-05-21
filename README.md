# OpenWOP — Multi-Agent Workflow Orchestration Protocol

**OpenWOP is an open, wire-level protocol for multi-agent workflow orchestration.** It defines how multiple AI agents, deterministic tools, sub-workflows, and human reviewers collaborate inside a single durably-suspendable, replayable run — and how independent hosts (workflow engines, SDKs, debuggers, agent runtimes) interoperate over the same contract.

If you're building agentic systems, AI workflow engines, multi-agent applications, agent orchestration platforms, or human-in-the-loop pipelines and want a protocol layer instead of vendor lock-in, OpenWOP is the contract.

> **Try it live: [app.openwop.dev](https://app.openwop.dev/)** — anonymous demo of the reference workflow-engine app. Build a workflow visually, run it against 44 published `core.openwop.*` packs, see the SSE event stream + interrupt cards + capabilities advertisement. Sign in with Google or GitHub for persistent runs + workflows + BYOK secrets (KMS-encrypted at rest). Anonymous sessions reset every 24h; BYOK keys you paste are session-only and never persisted. [Privacy & cookies](https://app.openwop.dev/privacy).

## Multi-Agent Architecture (v1+)

OpenWOP v1 introduces first-class support for **orchestrator-driven multi-agent workflows**:

- **Orchestrator agent** — A supervisor agent that owns the conversation context, drives workflow execution decisions, and dynamically constructs node stacks based on user intent
- **Worker agents** — Each node defaults to its own isolated agent context with specialist capabilities, with optional shared-agent modes for tightly-coupled state
- **Agent identity** — Protocol-level `AgentRef` wire shape for agent discovery, provenance, and cross-host interoperability
- **Reasoning events** — New event types (`agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided`, `runOrchestrator.decided`) for observability into agent decision-making
- **Agent packs** — Extension of node packs to distribute agent manifests alongside node implementations
- **Memory layer** — Host-adapter interface for agent memory persistence with BYOK redaction guarantees
- **Multi-turn conversation** — Generalized suspend/resume for orchestrator-driven HITL flows

## What is multi-agent workflow orchestration?

A **workflow** is a directed graph of steps that drives state from an input to a result. **Multi-agent** means each step can be taken by a different kind of actor — an LLM, a tool, a person, or another workflow — sharing typed state across the graph. **Orchestration** means a single layer (the protocol, not any one host) owns the cross-cutting guarantees those agents need to collaborate safely: durability, suspend / resume, replay, version negotiation, and observability.

In OpenWOP, an "agent" is anything that takes a turn inside a run:

- an **LLM agent** — an AI model node that calls a foundation model (Anthropic, OpenAI, Google, local) and emits a typed envelope;
- a **tool agent** — a deterministic node that runs a function, queries a database, transforms state, or invokes an MCP tool;
- a **human agent** — a reviewer participating through a canonical [interrupt](./spec/v1/interrupt.md): approve / reject / clarify / refine / cancel;
- a **sub-workflow agent** — another OpenWOP run, possibly executed on a different host or organization, invoked over the same protocol;
- an **orchestrator agent** — a supervisor agent that drives workflow execution decisions (v1+).

An OpenWOP-compliant **host** is any server that implements the REST + SSE surface defined in [`api/openapi.yaml`](./api/openapi.yaml). An OpenWOP-compliant **client** is any SDK, tool, or agent that consumes those endpoints. The [conformance suite](./conformance/) decides compliance mechanically — `npx @openwop/openwop-conformance` against `OPENWOP_BASE_URL` returns pass/fail.

## What OpenWOP Gives You

| Concern | Protocol guarantee | Spec |
|---|---|---|
| **Durable suspend / resume** | Long-running or human-gated steps don't pin a process; runs persist, hand off across workers, and resume against the same state. | [`interrupt.md`](./spec/v1/interrupt.md), [`storage-adapters.md`](./spec/v1/storage-adapters.md) |
| **Typed channels + reducers** | Shared state between agents is contractual, not convention. Each channel declares a type and an explicit reducer for concurrent writes. | [`channels-and-reducers.md`](./spec/v1/channels-and-reducers.md) |
| **Replay + fork** | Any historical checkpoint can be forked into a new run for time-travel debugging without rewriting the workflow. | [`replay.md`](./spec/v1/replay.md) |
| **Version negotiation** | Per-`(run, change-id)` version pinning — borrowed from Temporal — means a deploy never breaks an in-flight run. | [`version-negotiation.md`](./spec/v1/version-negotiation.md) |
| **Observability** | Canonical `openwop.*` OpenTelemetry namespace. Any host emits the same span, event, and metric vocabulary; any consumer reads it. | [`observability.md`](./spec/v1/observability.md) |
| **HITL primitives** | One canonical `interrupt` shape covers approval, clarification, refinement, and cancellation across REST, SSE, and webhooks. | [`interrupt.md`](./spec/v1/interrupt.md) |
| **Stream modes** | Four SSE consumption modes (`values`, `updates`, `messages`, `debug`) — borrowed from LangGraph — so dashboards, debuggers, and chat UIs read the right slice. | [`stream-modes.md`](./spec/v1/stream-modes.md) |
| **Idempotent runs** | Two-layer contract — HTTP `Idempotency-Key` for retries, engine `invocationId` for replays — collapses duplicates safely. | [`idempotency.md`](./spec/v1/idempotency.md) |
| **BYOK secrets + provider policy** | Per-tenant credential resolution and per-run provider routing without leaking either into the workflow definition. | [`auth.md`](./spec/v1/auth.md), [`run-options.md`](./spec/v1/run-options.md) |
| **Node packs** | Distributable, signed bundles of node implementations — the agent equivalent of language packages. | [`node-packs.md`](./spec/v1/node-packs.md), [`registry-operations.md`](./spec/v1/registry-operations.md) |
| **Agent packs** | Extension of node packs to distribute agent manifests alongside node implementations (v1+). | [`node-packs.md`](./spec/v1/node-packs.md) |
| **Agent identity** | Protocol-level `AgentRef` wire shape for agent discovery, provenance, and cross-host interoperability (v1+). | [`RFCS/0002`](./RFCS/0002-agent-identity-and-reasoning-events.md) |
| **Agent reasoning events** | Observability into agent decision-making via `agent.reasoned`, `agent.toolCalled`, `agent.handoff`, etc. (v1+). | [`RFCS/0002`](./RFCS/0002-agent-identity-and-reasoning-events.md) |
| **Agent memory** | Host-adapter interface for agent memory persistence with BYOK redaction guarantees (v1+). | [`RFCS/0004`](./RFCS/0004-memory-layer.md) |
| **Webhooks** | HMAC-signed delivery of run events to subscribers; replay-attack-resistant verification recipe; circuit-breaker semantics. | [`webhooks.md`](./spec/v1/webhooks.md) |

## What OpenWOP is not (and what it composes with)

OpenWOP intentionally does not standardize:

- **model-call shape** — an LLM agent inside a node calls whatever it wants (OpenAI, Anthropic, Bedrock, Vertex, Ollama, local);
- **orchestration topology** — DAGs, state machines, planner-executor loops, ReAct, supervisor-worker, hierarchical agents, all run inside a single OpenWOP node graph;
- **tool-exposure protocol** — use [MCP](./spec/v1/mcp-integration.md). OpenWOP runs the workflow; MCP exposes tools to the LLM nodes inside it;
- **inter-agent messaging across processes** — use [A2A](./spec/v1/a2a-integration.md). A2A handles the message exchange between agents on different hosts; OpenWOP runs the workflow inside one of them.

For an honest comparison of OpenWOP vs **Temporal, Airflow, Argo Workflows, AWS Step Functions, BPMN, LangGraph, and MCP** — when to choose OpenWOP and when not — see [`positioning.md`](./spec/v1/positioning.md). For the standards-composition matrix (MCP, A2A, OpenAPI, AsyncAPI, OpenTelemetry, CloudEvents, DID, Serverless Workflow, BPMN, Temporal/Restate/DBOS) — what OpenWOP composes with vs. what it deliberately doesn't duplicate — see [`positioning.md`](./spec/v1/positioning.md) §"Standards composition matrix".

> **Status: v1.0 core locked (2026-05-12); v1.x extension surfaces in motion.** The **v1.0 core spec corpus** is locked: 34 of 38 `spec/v1/*.md` documents are at `FINAL v1` (or `FINAL v1.1`). **Four documents remain `DRAFT`** and are explicitly additive v1.x extensions, not part of the v1.0 conformance gate: [`workflow-chain-packs.md`](./spec/v1/workflow-chain-packs.md) (RFC 0013 Phase 1), [`prompts.md`](./spec/v1/prompts.md) (RFC 0027 Phase A), [`cloudevents-mapping.md`](./spec/v1/cloudevents-mapping.md) (non-normative export mapping), and [`multi-agent-execution.md`](./spec/v1/multi-agent-execution.md) (RFC 0037 Phase 1). **RFC status (38 RFCs excluding template):** RFCs 0001–0024 + 0026 + 0030–0033 are `Accepted` (29). RFCs 0027–0029 + 0034 + 0035 + 0036 + 0037 are `Active` (7) — prompt templates / library endpoints / override hierarchy / OTel collector test seam / sandbox execution contract / multi-region + cross-engine guarantees / multi-agent execution model; their wire surfaces MAY shift compatibly within v1.x until promotion to `Accepted`. The envelope LLM-contract-hardening track (RFCs 0030/0031/0032/0033) promoted Active → Accepted 2026-05-21 (reference workflow-engine + MyndHyve workflow-runtime both advertising; conformance + adoption-feedback amendments folded). RFCs 0025 + 0038 are `Draft` (2) — test-mode registry namespace (0025), working-group charter (0038, ratifies when the GOVERNANCE.md tripwire fires). The 5 new RFCs (0034–0038) were filed 2026-05-21 in response to an external standards-readiness review; RFCs 0034 + 0035 + 0036 + 0037 graduated Draft → Active the same day after their schema additions + spec prose landed atomically — see `docs/KNOWN-LIMITS.md` for each gap they're paired with. Conformance gates `Active`-RFC scenarios behind capability advertisements so v1.0-only hosts pass the locked-core suite. **Reference hosts:** four — `examples/hosts/{in-memory,sqlite,postgres,python}/`. The Postgres reference host satisfies the production-profile predicate per [`examples/hosts/postgres/conformance-full.md`](./examples/hosts/postgres/conformance-full.md) and is positioned as the first non-steward-deployable reference for credible multi-tenant workloads. **Conformance trajectory (measured 2026-05-13 against suite v1.1.0):** Postgres 91.9% total / 96.4% of applicable on 850 scenarios; SQLite 91.5% on 731 (Phase A close-out, 2026-05-12); Python 100% of applicable on 788 (cross-language portability proof — opts out of interrupts/BYOK/agent/MCP/dispatch/subworkflows/channels/audit-log integrity); in-memory remains the educational reference. **SECURITY surface:** 89 invariants in [`SECURITY/invariants.yaml`](./SECURITY/invariants.yaml) — 58 protocol-tier (verified at the spec gate; every one has at least one public test in [`conformance/src/scenarios/`](./conformance/src/scenarios/)), 30 reference-impl-tier (verified by reference impls' CI), 1 advisory. (2 invariants graduated reference-impl → protocol on 2026-05-21 via RFC 0034.) Strict-mode conformance available via `OPENWOP_REQUIRE_BEHAVIOR=true` — see [`conformance/coverage.md`](./conformance/coverage.md) §"Capability-gated scenarios". **For the deliberately-disagreeable catalog of what the protocol does NOT yet prove** — shape-only conformance, reference-impl-tier invariants pending sandbox/OTel-collector implementation, profile claims pending non-steward adoption, external-action-gated work (audit engagement, vendor-neutral org migration), and in-flight Active-RFC wire surfaces — **see [`docs/KNOWN-LIMITS.md`](./docs/KNOWN-LIMITS.md).**

> **v1.x published artifacts.** [`@openwop/openwop`](https://www.npmjs.com/package/@openwop/openwop) (npm, **v1.1.0** — close-out additive release) · [`@openwop/openwop-conformance`](https://www.npmjs.com/package/@openwop/openwop-conformance) (npm, **v1.1.0**) · [`openwop-client`](https://pypi.org/project/openwop-client/) (PyPI, **v1.1.0**) · [`github.com/openwop/openwop/sdk/go`](https://pkg.go.dev/github.com/openwop/openwop/sdk/go) (Go modules, **v1.1.0**). All three SDKs at feature parity per [`sdk/PARITY.md`](./sdk/PARITY.md); package names are stable through any v1.x release per [`PUBLISHING.md`](./PUBLISHING.md). The initial v1.0.0 publication happened 2026-05-11; v1.1.0 adds the Phase H + Phase I capability surfaces (BYOK, MCP, HTTP, agent memory, OAuth2-CC, OIDC, etc.) — additive per [`COMPATIBILITY.md`](./COMPATIBILITY.md) §2.1. A Rust SDK is demand-gated and not in v1.x; the conformance suite is language-agnostic black-box, so any future Rust client tests against the same wire contract. Future moves to a vendor-neutral org are tripwire-gated per [`ROADMAP.md`](./ROADMAP.md) on ≥1 non-steward maintainer.

> **What remains v1.x work (external-action-gated).** External security audit engagement, first non-steward INTEROP-MATRIX row, first third-party node-pack on `packs.openwop.dev`, vendor-neutral org migration. None of these are controllable by the single-steward authoring this protocol; each is tracked with a named tripwire in [`ROADMAP.md`](./ROADMAP.md) §Phase 4. The corpus is **ready for first non-steward adoption** — the four reference hosts + 35 SECURITY invariants + 730 conformance scenarios + 3 SDKs + 1 spec-closure RFC umbrella close every gap a non-steward maintainer can be expected to discover on day one.

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
| [`workflow-chain-packs.md`](./spec/v1/workflow-chain-packs.md) | DRAFT | ~600 | Workflow-chain pack format — registry-distributed pre-configured DAG fragments expanded inline at workflow-author time. Closes [RFC 0013](./RFCS/0013-workflow-chain-packs.md) Phase 1 |
| [`webhooks.md`](./spec/v1/webhooks.md) | FINAL v1 | ~1,400 | Subscription register/unregister; HMAC `{timestamp}.{rawBody}` signing; replay-attack-resistant verification recipe; best-effort delivery semantics + circuit breaker (post-v1 addition, 2026-04-29) |
| [`storage-adapters.md`](./spec/v1/storage-adapters.md) | FINAL v1 | ~1,150 | Normative `RunEventLogIO` + `SuspendIO` contracts for storage backends; in-memory reference impls; compliance checklist for third-party adapter authors (post-v1 addition, 2026-04-29) |
| [`registry-operations.md`](./spec/v1/registry-operations.md) | FINAL v1 | ~3,000 | Operator-side normative reference for node-pack registries: submission, validation, deprecation, yank, signing-key rotation, marketplace boundary (post-v1 addition, 2026-04-29 — closes NP4 + NP5 from `node-packs.md`) |
| [`profiles.md`](./spec/v1/profiles.md) | FINAL v1 | ~1,200 | Compatibility profiles derived from existing capabilities (no wire-shape change): `openwop-core`, `openwop-interrupts`, `openwop-stream-sse`, `openwop-stream-poll`, `openwop-secrets`, `openwop-provider-policy`, `openwop-node-packs` |
| [`scale-profiles.md`](./spec/v1/scale-profiles.md) | FINAL v1 | ~900 | Three normative scale tiers (`minimal` / `production` / `high-throughput`) with floors for concurrency, latency, retry, fan-out, replay |
| [`production-profile.md`](./spec/v1/production-profile.md) | FINAL v1 | ~950 | Public-release operational profile: durability, backpressure, retry, event retention, debug bundles, observability. **First satisfying host:** `examples/hosts/postgres/` since 2026-05-11 — see [`examples/hosts/postgres/conformance-full.md`](./examples/hosts/postgres/conformance-full.md). |
| [`debug-bundle.md`](./spec/v1/debug-bundle.md) | FINAL v1 | ~900 | Portable JSON export of a single run's diagnostic state: `GET /v1/runs/{runId}/debug-bundle`. Profile-gated on `capabilities.debugBundle.supported: true` |
| [`positioning.md`](./spec/v1/positioning.md) | FINAL v1 | ~1,100 | Honest comparison of OpenWOP vs Temporal / Airflow / Argo / Step Functions / BPMN / LangGraph / MCP. When to choose OpenWOP and when not. |
| [`mcp-integration.md`](./spec/v1/mcp-integration.md) | FINAL v1 | ~700 | Worked example of OpenWOP + MCP composition. OpenWOP runs the workflow; MCP exposes tools to the LLM nodes inside that workflow. |
| [`a2a-integration.md`](./spec/v1/a2a-integration.md) | FINAL v1 | ~1,400 | Worked example of OpenWOP + A2A composition. A2A handles inter-agent message exchange; OpenWOP runs the workflow inside one agent. Includes OpenWOP↔A2A state-projection table with documented drift points. |
| [`host-extensions.md`](./spec/v1/host-extensions.md) | FINAL v1 | ~900 | What's in the protocol vs what's a host extension. Canonical-prefix table; `openwop.*` and other vendor namespaces are host-extensions. |
| [`host-capabilities.md`](./spec/v1/host-capabilities.md) | FINAL v1 | ~2,800 | Normative contracts for the 14 `host.*` capabilities that node-pack `peerDependencies` may declare (canvas, kanban, brand, mcp, et al.). Hosts that advertise `host.X: supported` MUST honor the §host.X contract. |
| [`agent-memory.md`](./spec/v1/agent-memory.md) | FINAL v1 | ~120 | Multi-Agent Shift Phase 3 — `memoryRef` resolution, `MemoryAdapter` host-interface contract, CTI-1 cross-tenant invariant, SR-1 secret-redaction invariant, TTL semantics. |
| [`agent-ref-positioning.md`](./spec/v1/agent-ref-positioning.md) | FINAL v1 | ~900 | Non-normative addendum to RFC 0002 — compares `AgentRef` to W3C DIDs, A2A `AgentCard`, and AGNTCY agent identity. |
| [`ai-envelope.md`](./spec/v1/ai-envelope.md) | FINAL v1.1 | ~530 | Inbound LLM-emission envelope (`type` / `schemaVersion` / `envelopeId` / `correlationId` / `payload` / `meta` / `partial`). Closes the documented gap where 8 v1 surfaces (`capabilities.md`, `host-capabilities.md` §host.aiEnvelope, `workflow-chain-packs.md`, `profiles.md`, `host-extensions.md`, `positioning.md`, `capabilities.schema.json`, reference host discovery) already advertise the envelope concept but its own wire shape, universal kinds, schema discipline, and Envelope Contract gate were never specified. Distinct from `RunEventDoc` (outbound) and `error-envelope.schema.json` (host HTTP errors). |
| [`structured-output-subset.md`](./spec/v1/structured-output-subset.md) | FINAL v1.1 (informative) | ~180 | Informative companion to `ai-envelope.md` introduced by [RFC 0030](./RFCS/0030-envelope-reasoning-and-tier-one-subset.md) (`Active` 2026-05-20). Documents the intersection of JSON-Schema features supported by OpenAI strict mode ∩ Anthropic strict tool use ∩ Google Gemini `responseSchema` as of 2026-05, so vendor-namespaced envelope-kind authors have a single reference for "what schema features are safe for cross-vendor portability." Includes the strict-mode optional-field emulation pattern. Non-normative — vendor behavior evolves, and substantive subset changes require a follow-up RFC. |
| [`prompts.md`](./spec/v1/prompts.md) | DRAFT v1.x | ~600 | Phase A wire shape for named, versioned, variable-bound prompt templates (RFC 0027). PromptTemplate + PromptRef + shared `prompt-kind.schema.json` enum + `capabilities.prompts` advertisement + `prompt.composed` RunEvent for cross-host multi-agent debuggability. Distinct from `AIEnvelope` (LLM emission) and `RunEventDoc` (outbound event); the three form a complementary observability taxonomy (host-composed prompt / LLM-emitted reasoning / thinking-token stream). Phases B/C land via [`RFCS/0028`](./RFCS/0028-prompt-library-endpoints.md) (endpoints + pack kind) and [`RFCS/0029`](./RFCS/0029-prompt-override-hierarchy.md) (resolution chain + `agent.promptResolved`). |
| [`i18n.md`](./spec/v1/i18n.md) | FINAL v1 | ~1,200 | Optional locale-negotiation annex — `Accept-Language` semantics, `locale` field on InterruptPayload + ErrorEnvelope, capability advertisement, fallback rules. Additive to `interrupt.md`. |
| [`compliance.md`](./spec/v1/compliance.md) | FINAL v1 | ~1,500 | Non-normative compliance-vocabulary mapping — protocol surfaces ↔ SOC 2 / GDPR / HIPAA / ISO 27001 controls. Operator reference; does not prescribe certification. |
| [`grpc-transport.md`](./spec/v1/grpc-transport.md) | FINAL v1 | ~1,400 | Optional alternative transport — `openwop.v1.Engine` gRPC service mirroring the REST surface. REST + SSE remains required; gRPC is opt-in. Canonical `.proto` at `api/grpc/openwop.proto`. |
| [`cloudevents-mapping.md`](./spec/v1/cloudevents-mapping.md) | DRAFT (non-normative) | ~900 | STD-2 — non-normative export mapping from OpenWOP `RunEvent` records onto the CloudEvents 1.0 envelope. Per-attribute table, 4 extension attributes, worked example, round-trip note. |
| [`multi-agent-execution.md`](./spec/v1/multi-agent-execution.md) | DRAFT v1.x | ~250 | Phase 1 of the RFC 0037 multi-agent execution model — execution-loop framework + planner→worker handoff state machine (4 states, 7 transition events via new `core.workflowChain.event` RunEventType). Gates conformance on `capabilities.multiAgent.executionModel.{supported, version}`. Phases 2-4 (confidence semantics / cross-host causation / replay-under-nondeterminism) are explicit follow-up RFCs. |

**Adopter guides:**
- [`docs/IMPLEMENTER-PATH.md`](./docs/IMPLEMENTER-PATH.md) — one-page path from "what is OpenWOP" to "my host has a published row in `INTEROP-MATRIX.md`". Start here if you're building a new host.
- [`docs/PROFILE-DECISION-GUIDE.md`](./docs/PROFILE-DECISION-GUIDE.md) — decision tree for which OpenWOP capability profiles to claim (and which to honestly opt out of).
- [`docs/IMPLEMENTATION-CERTIFICATION.md`](./docs/IMPLEMENTATION-CERTIFICATION.md) — how a host author publishes a conformance claim that third parties can audit + reproduce + pin to a commit.
- [`docs/PRODUCTION-RUNBOOK.md`](./docs/PRODUCTION-RUNBOOK.md) — operator playbook for booting an OpenWOP host that honors `openwop-production` per RFC 0009.
- [`docs/SECURITY-OPERATOR-GUIDE.md`](./docs/SECURITY-OPERATOR-GUIDE.md) — operator-side configuration for auth profiles, BYOK redaction, webhook signing, audit-log integrity, mTLS, MCP trust boundary, and node-pack supply-chain.
- [`docs/PACK-AUTHOR-QUICKSTART.md`](./docs/PACK-AUTHOR-QUICKSTART.md) — end-to-end path for third-party pack authors: skeleton → signing key → tarball + signature + SBOM → schema validation → local-host smoke → publish PR → lifecycle (versioning, deprecate, yank, key rotation).
- [`docs/integrations/durable-runtimes.md`](./docs/integrations/durable-runtimes.md) — implementation guide for hosts built on Temporal / Restate / DBOS / Inngest.
- [`docs/integrations/serverless-workflow-and-bpmn.md`](./docs/integrations/serverless-workflow-and-bpmn.md) — bridging OpenWOP to / from CNCF Serverless Workflow and OMG BPMN. Honest about what round-trips and what stays host-specific.
- [`docs/KNOWN-LIMITS.md`](./docs/KNOWN-LIMITS.md) — honest catalog of shape-only coverage, external-gated work, profile claims awaiting non-steward adoption, and surfaces deliberately NOT standardized.
- [`docs/migration/v1.0-to-v1.1.md`](./docs/migration/v1.0-to-v1.1.md) — what's new in v1.1 (additive only; no migration steps required for v1.0 implementations).

**Total**: 38 docs. The 12 v1 launch docs were finalized on 2026-04-27; `webhooks.md`, `storage-adapters.md`, and `registry-operations.md` extend the registry, storage, and webhook surfaces; `profiles.md`, `scale-profiles.md`, `debug-bundle.md`, `positioning.md`, `mcp-integration.md`, `a2a-integration.md`, and `host-extensions.md` graduated to FINAL v1 on 2026-05-05; `auth-profiles.md`, `interrupt-profiles.md`, `production-profile.md`, and `capabilities-change-detection.md` close the 2026-05-10 public-release profile and discovery gaps; `agent-memory.md` documents Phase 3 of the Multi-Agent Shift (2026-05-10); `agent-ref-positioning.md` adds the non-normative `AgentRef` positioning addendum. Multi-agent extensions [`RFCS/0002`](./RFCS/0002-agent-identity-and-reasoning-events.md)–[`RFCS/0007`](./RFCS/0007-dispatch.md) add agent identity, reasoning events, agent packs, memory layer, conversation, orchestrator routing, and dispatch.

## Quickstart

New to OpenWOP? Two paths:

- **[`QUICKSTART-10MIN.md`](./QUICKSTART-10MIN.md)** — fastest possible "what is OpenWOP and how do I run one?" Boots the in-memory reference host on your laptop, runs a workflow via curl + SDK + SSE. No vendor SDK, no managed-service setup. Just Node 20+ and a clone of this repo.
- **[`QUICKSTART.md`](./QUICKSTART.md)** — end-to-end walkthrough against any OpenWOP-compliant host: auth + create run + read snapshot, SSE + webhooks, fork + replay, node packs, conformance.

## Examples

Runnable example projects under [`examples/`](./examples/):

- **[`tiny-workflow/`](./examples/tiny-workflow/)** — smallest possible OpenWOP run lifecycle (~80 lines, zero deps).
- **[`streaming-client/`](./examples/streaming-client/)** — SSE event-stream consumer with hand-written frame parser (~110 lines, zero deps).
- **[`idempotent-runs/`](./examples/idempotent-runs/)** — Layer-1 HTTP idempotency: retries collapse, body conflicts get 409 (~80 lines, zero deps).
- **[`hosts/in-memory/`](./examples/hosts/in-memory/)** — reference OpenWOP server (~1,250 LOC, Node stdlib only). The host the other examples run against. Started as a single-file ~570-LOC reference; grew as the audit / interrupts / webhooks / observability modules landed.
- **[`hosts/sqlite/`](./examples/hosts/sqlite/)** — durable reference OpenWOP server (~3,600 LOC across `server.ts` + `audit.ts` + `interrupts.ts` + `webhooks.ts` + `observability.ts`, single runtime dep `better-sqlite3`). Runs + events persist across process restart. The README doubles as the **"Build Your Own Host" walkthrough**.

Examples run end-to-end in CI via [`.github/workflows/examples.yml`](./.github/workflows/examples.yml) so they don't go stale.

## Reference applications

End-to-end deployable templates under [`apps/`](./apps/) — a tier above `examples/`. Where `examples/` are single-file demos and `examples/hosts/` are conformance-test targets, `apps/` are full vertical-slice templates with backend + frontend + Dockerfile + auth + storage + observability wired together.

- **[`apps/workflow-engine/`](./apps/workflow-engine/)** — single-container TypeScript backend + React frontend. Implements run lifecycle, all 4 interrupt kinds, SSE streams (4 modes + Last-Event-ID resume), BYOK with strip-on-persist, OTel under `openwop.*`, pack consumption with SRI + Ed25519. Sample / template code; not production-hardened. Targets ~70% conformance — see the README for the honest skip-equivalent matrix.

## Operational references

- **[`PUBLISHING.md`](./PUBLISHING.md)** — operational plan for publishing the 4 spec-corpus artifacts (TS SDK, TS conformance, Python SDK, Go SDK). Cadence, release manager, pre-publish checklist, CI sketch.
- **[`registry-operations.md`](./spec/v1/registry-operations.md)** — operator-side reference for node-pack registries: submission / validation / deprecation / yank / signing-key rotation flows.
- **[`storage-adapters.md`](./spec/v1/storage-adapters.md)** — `RunEventLogIO` + `SuspendIO` contracts for storage backends; in-memory references.

## Design standards

- **[`DESIGN.md`](./DESIGN.md)** — marketing-site standards + shared editorial palette (`--paper` / `--ink` / `--clay` / `--star-glow`) + Instrument Serif + Geist + Geist Mono type triple. Source of truth for `public/styles.css` and the warm-dark token override that any future surface adopts.
- **[`DESIGN.app.md`](./DESIGN.app.md)** — reference-app standards for `apps/workflow-engine/frontend/react/`. App-specific components, functional status tokens, xyflow canvas theming, Firebase-Auth vendor-mark policy, inline-style policy. Mirrors shared tokens from `DESIGN.md` per the SYNC RULE in `apps/workflow-engine/frontend/react/src/styles/global.css :root`.
- Reviewed by `/ux-review`.

## Status legend

| Tag | Meaning |
|---|---|
| **STUB** | Minimal coverage of stable surfaces only. Implementers SHOULD pin only to what's documented; assume gaps. |
| **DRAFT** | Comprehensive coverage of stable + in-flight surfaces, but not yet reviewed by spec committee. |
| **OUTLINE** | Sketched but not detailed. Section headings lock; field schemas may shift. |
| **FINAL** | Frozen. Breaking changes go to v2. |

Within DRAFT/OUTLINE specs, individual fields and section subgroups carry inline tags:
- **(stable)** — shape locked
- **(in-flight)** — driven by active implementation work and subject to compatible adjustment before a future minor
- **(future)** — deferred to v1.x or v2

## Reading order

For implementers building an OpenWOP-compliant **server**:

1. **`auth.md`** — auth model + scope vocabulary
2. **`rest-endpoints.md`** — endpoint catalog
3. **`idempotency.md`** — two-layer contract (REQUIRED for safe retries)
4. **`version-negotiation.md`** — version stamping + deploy-skew rules
5. **`capabilities.md`** — `/.well-known/openwop` handshake
6. **`stream-modes.md`** — SSE delivery modes
7. **`interrupt.md`** — HITL primitive
8. **`run-options.md`** — `configurable`/`tags`/`metadata`
9. **`observability.md`** — `openwop.*` OTel taxonomy
10. **`replay.md`** — time-travel debug surface
11. **`channels-and-reducers.md`** — typed state model (largest, depends on others)

For implementers building an OpenWOP-compliant **client (CLI, SDK, agent)**:

1. **`auth.md`**
2. **`rest-endpoints.md`** — request shapes
3. **`stream-modes.md`** — `?streamMode=` selection
4. **`capabilities.md`** — pre-flight handshake (advisory)
5. **`version-negotiation.md`** — `minClientVersion` + version pinning
6. **`run-options.md`** — `configurable` knobs the server accepts
7. **`interrupt.md`** — HITL UX patterns
8. **`replay.md`** — time-travel for end-user debug

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

Borrowing is for **ecosystem familiarity**, not vendor lock-in — none of these implementations are normative dependencies. OpenWOP-compliant implementations are free to ignore the borrowed source and follow the spec text alone.

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

The two API specs reference the JSON Schemas via cross-file `$ref`; bundlers inline them on demand. The conformance suite is a self-contained driver-style harness — point it at any OpenWOP-compliant server with `OPENWOP_BASE_URL` + `OPENWOP_API_KEY` env vars and run `npx vitest run` (or use the `openwop-conformance` CLI for friendlier output). At v1 the suite covers discovery, auth, errors, run lifecycle, idempotency, cancellation, HITL approval/clarification, failure paths, identity passthrough, multi-node ordering, SSE stream modes, replay/fork, and version negotiation. See [`conformance/README.md`](./conformance/README.md).

## What's NOT in v1

These are deliberately deferred:

- **External security audit + vendor-neutral org migration** — both ecosystem milestones gated on a ≥1-non-steward maintainer tripwire per [`ROADMAP.md`](./ROADMAP.md) §Phase 4.

The reference node-pack registry at [`packs.openwop.dev`](https://packs.openwop.dev) **is live** (Stage 1–4 deployed 2026-05-12, packCount 48 as of 2026-05-13 across `core.openwop.*` / `community.openwop-team.*` / `vendor.openwop.*` / `vendor.myndhyve.*` trust tiers). See [`docs/PACK-CATALOG.md`](./docs/PACK-CATALOG.md) for the categorized inventory and [`examples/market-intel-pipeline/`](./examples/market-intel-pipeline/) + [`examples/ads-publish-pipeline/`](./examples/ads-publish-pipeline/) for reference compositions. For the canonical multi-agent worked example (orchestrator + dispatch + AgentRef + reasoning events + HITL + memory + RFC 0012 compaction) see [`examples/multi-agent-research-assistant/`](./examples/multi-agent-research-assistant/); for the cross-host counterpart that drives an external A2A peer end-to-end see [`examples/multi-agent-cross-host/`](./examples/multi-agent-cross-host/).

## Reporting issues

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide. In short — file issues against the implementation repo with the label `openwop-spec`. Include:

- Doc filename + section heading
- Specific RFC 2119 requirement that's unclear or contradictory
- Implementation impact (what's blocked / what's ambiguous)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) — `[1] — 2026-05-08 — OpenWOP v1 FINAL (multi-agent extensions)` is the current top entry.

**v1 Multi-Agent Extensions (Accepted):**
- [**RFC 0002**](./RFCS/0002-agent-identity-and-reasoning-events.md) — Agent identity + reasoning events: `AgentRef` wire shape, `agent.reasoned`/`agent.toolCalled`/`agent.toolReturned`/`agent.handoff`/`agent.decided`/`runOrchestrator.decided` event types, confidence scoring, messaging reducer, replay determinism
- [**RFC 0003**](./RFCS/0003-agent-packs.md) — Agent packs: Extend `pack.json` with `agents[]` for agent manifest distribution alongside node implementations
- [**RFC 0004**](./RFCS/0004-memory-layer.md) — Memory layer: `MemoryAdapter` host interface for agent memory persistence with BYOK redaction guarantees
- [**RFC 0005**](./RFCS/0005-conversation.md) — Conversation: Generalize one-shot suspend → multi-turn `conversation` for orchestrator-driven HITL flows
- [**RFC 0006**](./RFCS/0006-orchestrator.md) — Orchestrator: New `runOrchestrator` field on `WorkflowRunDocument`, orchestrator-driven routing, replay cache-only determinism
- [**RFC 0007**](./RFCS/0007-dispatch.md) — Dispatch: New `core.dispatch` node pattern for sub-workflow invocation with fresh agent context

**v1.x Capability Profiles (all `Accepted`):**
- [**RFC 0012**](./RFCS/0012-memory-compaction-profile.md) — Memory compaction profile (`Accepted` 2026-05-15): optional `capabilities.memory.compaction` advertisement, `memory.compacted` event vocabulary, and an SR-1 carry-forward invariant that extends RFC 0004 §D through host-side memory distillation. Additive; no v1 contract change. Postgres reference host implements end-to-end when `OPENWOP_MEMORY_COMPACTION=true`.
- [**RFC 0013**](./RFCS/0013-workflow-chain-packs.md) — Workflow-chain packs (`Accepted` 2026-05-18): pack-kind distinguished manifest for workflow templates with host-side expansion semantics. Pairs with the n8n-style root+sub-node composition shipped in `core.openwop.agents`. Spec doc `workflow-chain-packs.md` lands as `DRAFT v1.x` pending Phase B/C closure.
- [**RFC 0014**](./RFCS/0014-host-fs-capability.md) — `host.fs` filesystem capability (`Accepted`): read/write/list/stat/delete inside a sandbox root with `fs-path-traversal` invariant. Unblocks `core.openwop.files`.
- [**RFC 0015**](./RFCS/0015-host-kv-storage-capability.md) — `host.kvStorage` key-value store (`Accepted`): TTL + atomic increment + CAS + cross-tenant isolation. Unblocks `core.openwop.storage` kv-* nodes.
- [**RFC 0016**](./RFCS/0016-host-table-storage-capability.md) — `host.tableStorage` structured records (`Accepted`): typed columns + cursor pagination. Make-Data-Store equivalent.
- [**RFC 0017**](./RFCS/0017-host-queue-bus-capability.md) — `host.queueBus` inbound queue + stream (`Accepted`): publish + consume (trigger) + ack/nack/dead-letter + stream subscribe with cross-tenant isolation. Unblocks `core.openwop.messaging`.
- [**RFC 0018**](./RFCS/0018-host-sql-vector-search-capability.md) — Database adapter capabilities (`Accepted`): `host.sql` (parametric-only) + `host.nosql` + `host.vectorStore` + `host.searchIndex`. Unblocks `core.openwop.db` + `core.openwop.rag`.
- [**RFC 0019**](./RFCS/0019-host-blob-cache-capability.md) — `host.blobStorage` + `host.cache` (`Accepted`): binary artifacts with presigned URLs + TTL cache. Unblocks `core.openwop.storage` blob/cache nodes.
- [**RFC 0020**](./RFCS/0020-host-mcp-server-composition.md) — Host-side MCP server composition (`Accepted`): extends `spec/v1/mcp-integration.md` with a §"OpenWOP host as MCP server" section + `capabilities.mcp.serverMount` block + bidirectional sampling/elicitation bridges. Unblocks the 8 server-side `core.openwop.mcp.*` nodes shipped in v1.1.0.

**Active RFCs (`Active` — wire-shape MAY shift compatibly within v1.x):**
- [**RFC 0025**](./RFCS/0025-test-mode-registry-namespace.md) — Test-mode registry namespace (`Draft`). Conformance-only typeId namespace; non-production.
- [**RFC 0027**](./RFCS/0027-prompt-templates.md) — Prompt templates (`Active`). Wire shape for named, versioned, variable-bound prompts; produces `spec/v1/prompts.md` at `DRAFT v1.x`.
- [**RFC 0028**](./RFCS/0028-prompt-library-endpoints.md) — Prompt library endpoints + pack kind (`Active`).
- [**RFC 0029**](./RFCS/0029-prompt-override-hierarchy.md) — Prompt resolution chain across node / agent / workflow / host (`Active`); `agent.promptResolved` event.
- [**RFC 0030**](./RFCS/0030-envelope-reasoning-and-tier-one-subset.md) — Envelope `reasoning` field + Tier-1 cross-vendor structured-output subset (`Active`).
- [**RFC 0031**](./RFCS/0031-envelope-variants-and-model-capabilities.md) — Envelope variant payload discrimination + `NodeModule.requiredModelCapabilities` (`Active`).
- [**RFC 0032**](./RFCS/0032-envelope-reliability-events.md) — Six envelope-reliability `RunEventType` entries (`Active`).
- [**RFC 0033**](./RFCS/0033-envelope-completion-contract.md) — Envelope-completion criteria; truncation-vs-schema-violation retry routing (`Active`).

**v1 Foundation (2026-04-27):**
Current generated state: 38 prose specs (34 FINAL + 4 DRAFT) · 31 JSON Schemas · 25 OpenAPI operations · AsyncAPI 3.1 · 188 conformance scenario files · 3 reference SDKs. See [docs/PROTOCOL-STATUS.md](./docs/PROTOCOL-STATUS.md) for the machine-generated snapshot.

- **Protocol corpus** — Normative REST, SSE, discovery, auth, idempotency, replay/fork, interruption, observability, node-pack, host-extension, and version-negotiation contracts are frozen for v1.
- **Machine-readable contracts** — OpenAPI 3.1, AsyncAPI 3.1, and JSON Schemas are bundled and cross-validated by the conformance corpus.
- **Conformance** — The v1.0 package covers server-free corpus validity plus black-box host scenarios for discovery, auth, errors, lifecycle, idempotency, cancellation, HITL, failure paths, identity passthrough, multi-node ordering, stream modes, replay/fork, profile derivation, scale gates, and version negotiation.
- **Reference SDKs** — TypeScript, Python, and Go SDKs ship at v1.0 with aligned error helpers and release metadata.

## Where to go next

If you're new to OpenWOP:

- **[`QUICKSTART.md`](./QUICKSTART.md)** — five-minute hands-on tour: discovery, run creation, streaming.
- **[`spec/v1/`](./spec/v1/)** — 38 prose specs (34 `FINAL v1`/`v1.1`, 4 `DRAFT v1.x` extensions). Start with `rest-endpoints.md` and `auth.md`.
- **[`schemas/`](./schemas/)** — JSON Schemas (Draft 2020-12). Compile with Ajv2020.

If you're implementing a host:

- **[`api/openapi.yaml`](./api/openapi.yaml)** + **[`api/asyncapi.yaml`](./api/asyncapi.yaml)** — machine-readable contracts.
- **[`conformance/`](./conformance/)** — `@openwop/openwop-conformance` test suite. Run against your endpoint to verify spec compliance.

If you're consuming OpenWOP from an application:

- **[`sdk/typescript/`](./sdk/typescript/)** — `@openwop/openwop` (npm).
- **[`sdk/python/`](./sdk/python/)** — `openwop-client` (PyPI).
- **[`sdk/go/`](./sdk/go/)** — `github.com/openwop/openwop/sdk/go`.

Project meta:

- **[`ROADMAP.md`](./ROADMAP.md)** — v1 stable / v1.X minor / post-v1 ecosystem.
- **[`GOVERNANCE.md`](./GOVERNANCE.md)** — maintainer model, decision-making, and spec change process.
- **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — how to propose changes, CI gates, change categories.
- **[`SECURITY.md`](./SECURITY.md)** — coordinated disclosure process.

Reference implementations:

- **[`examples/hosts/in-memory/`](./examples/hosts/in-memory/)** — Node-stdlib reference host (~1,250 LOC). Runs the conformance suite headless on your laptop.
- **[`examples/hosts/sqlite/`](./examples/hosts/sqlite/)** — durable reference host (~3,600 LOC, single runtime dep `better-sqlite3`). Runs persist across process restart.
- **Third-party hosts** are listed in [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md) as they pass conformance. The reference hosts under `examples/hosts/` are non-normative — they exist to prove the protocol cross-implements.

This repository's current steward is the original OpenWOP working group (see [`MAINTAINERS.md`](./MAINTAINERS.md)). The repo is hosted at `github.com/openwop/openwop` until the vendor-neutral org migration tripwire fires (see [`ROADMAP.md`](./ROADMAP.md) § "Vendor-neutral org migration"); host name appearance in the URL is operational, not normative.

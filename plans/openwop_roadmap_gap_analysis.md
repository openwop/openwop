# OpenWOP Comprehensive Roadmap — Gap Analysis

**Source roadmap:** [`plans/openwop_comprehensive_roadmap.md`](./openwop_comprehensive_roadmap.md) (aspirational 8-phase product vision)
**Analysis date:** 2026-05-24
**Method:** Every roadmap feature classified `Protocol` vs `App` and status-verified against repo ground truth — RFCS/, conformance/ (fixtures + scenario tests), spec/, schemas/, packs/, registry/, INTEROP-MATRIX.md, ROADMAP.md, CHANGELOG.md, SDKs, and `apps/workflow-engine/`. Status reflects actual artifacts, **not** roadmap prose.

---

## How features were classified

- **`Protocol`** — changes the wire contract any independent host must honor: event types, JSON-RPC methods, conformance fixtures, capability advertisement, persisted shape, JSON Schemas, node-pack manifest schema, auth profiles.
- **`App`** — affects only the `app.openwop.dev` application (`apps/workflow-engine/`): builder UI/UX, product storage, admin screens. Deletable without other hosts changing.
- **`App (depends on Protocol: …)`** — an app feature whose function rests on an existing protocol surface (e.g. step-replay needs the fork endpoint).
- **Packs are a special case** — a connector/agent shipped as a node pack is *protocol-adjacent*: the pack itself is product content, but the **framework** that distributes it (manifest schema, registry, signing) is Protocol. "A pack exists" ⇒ that integration is `Done`.

---

## Executive summary

**Total features assessed: ~195** across 8 phases.

| Layer | Done | In progress | Open |
|---|---|---|---|
| Protocol | ~38 | ~14 | ~22 |
| App | ~30 | ~7 | ~38 |
| **Approx. totals** | **~68 (35%)** | **~21 (11%)** | **~60 (31%)** + canvas/marketplace gaps |

**The shape of the gap:** The **protocol/runtime moat is largely built.** Durable execution, replay, interrupt/resume, observability (OTel/Prometheus), agent identity + multi-agent orchestration, MCP/A2A interop, prompt management, and the pack/registry framework are all `Done` with conformance evidence. What's missing splits cleanly:

1. **Protocol gaps needing NEW RFCs** — Connector SDK framework, OAuth 2.0 flows, credential storage/rotation, SAML/LDAP/SCIM, dead-letter queues, cron/scheduling (RFC 0017 still Draft), LangGraph/Temporal compatibility bridges.
2. **App gaps with no product yet** — the visual builder is an early prototype (canvas basics done, but no minimap/grouping/multi-select/alignment), and the **entire marketplace + enterprise-admin surface** (org/workspace/RBAC UI, ratings, embedded/white-label) does not exist as an application.
3. **Genuinely out-of-scope for v1.x** — Redis cache, worker pools, queue partitioning, priority queues (host-internal; deliberately unspecified).

**New RFCs this analysis surfaces as needed:** Connector SDK framework · OAuth 2.0 authorization flows · Credential encryption/storage/sharing/rotation · SAML auth profile · LDAP directory integration · SCIM provisioning · Multi-tenant org/workspace/team model · Workflow-approval & deployment-gate contracts · Execution diffing (two-run comparison) · Rust SDK · Plugin/runtime-extension dynamic-load contract · Marketplace social-metadata schema (ratings/reviews) · Embedded builder/runtime API. *(Cron/scheduling already has RFC 0017 in Draft.)*

**Couldn't cleanly classify / verify:** A handful of Phase 1/4 "scaling" items (worker pools, queue partitioning, horizontal scaling, dashboards, alerts, SLA monitoring) are deliberately **host-internal** in the spec — they have scale-profile *target numbers* but no wire surface, so they're neither a Protocol nor an App deliverable. Flagged inline as "host-internal / out of scope."

---

## Phase 1 — Core Runtime Stabilization

| Feature | Layer | RFC needed? | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Deterministic workflow execution | Protocol | RFC 0002, RFC 0037 §1 (Accepted) | Done | `spec/v1/multi-agent-execution.md`; `multi-agent-handoff-state-machine.test.ts`; INTEROP-MATRIX | causationId chains; 7 traceable transitions |
| Workflow state persistence | Protocol | RFC 0004, RFC 0009 (Accepted) | Done | `spec/v1/storage-adapters.md`; Postgres + SQLite reference hosts | Append-only event log |
| Replay engine | Protocol | RFC 0009 (Accepted), RFC 0041 §4 (Active) | Done | `replay.md`; `POST /v1/runs/{id}:fork`; `replay-fork.test.ts`, `replayDeterminism.test.ts` | Replay-under-nondeterminism still Active |
| Execution snapshots | Protocol | RFC 0004, RFC 0009 (Accepted) | Done | `RunEventLogIO.getLatest()`; Postgres `snapshotAtSeq()` | Reconstructed from event log |
| Interrupt/resume semantics | Protocol | RFC 0005 (Accepted) | Done | `interrupt.md` + `interrupt-profiles.md`; 4 interrupt conformance tests | Suspension persisted via `SuspendIO` |
| Durable checkpoints | Protocol | RFC 0009, RFC 0010 (Accepted) | Done | `auth-profiles.md` §periodic anchoring; `audit-log-checkpoint-signature.test.ts` | Merkle + Ed25519 |
| PostgreSQL persistence | App | N/A | Done | `examples/hosts/postgres/`; ~92% conformance pass | Reference host |
| Redis cache layer | Protocol | none filed | Open | no evidence | **Host-internal / out of v1 scope** |
| Workflow history retention | Protocol | RFC 0009 (Accepted) | Done | `production-profile.md` §event retention; `production-retention-expiry.test.ts` | ≥7-day floor; 410 on expiry |
| Retry policies | Protocol | RFC 0009 (Accepted) | Done | `scale-profiles.md`; `idempotency.test.ts`, `idempotencyRetry.test.ts` | ≥5 retries/24h |
| Exponential backoff | Protocol | not normalized | In progress | `scale-profiles.md` mentions backoff; no MUST/conformance | Honors `Retry-After`; algorithm unspecified |
| Timeout policies | Protocol | RFC 0004, RFC 0009 (Accepted) | Done | `run-options.md` `timeoutMs`; `timeout` interrupt kind | Per-workflow + per-node |
| Dead-letter queues | Protocol | NEW RFC NEEDED: DLQ surface | Open | no evidence | Error-code routing exists; no DLQ surface |
| Worker pools | Protocol | none filed | Open | `scale-profiles.md` only | **Host-internal / out of scope** |
| Queue-based execution | Protocol | none filed | Open | `scale-profiles.md` only | **Host-internal / out of scope** |
| Distributed execution | Protocol | RFC 0036, RFC 0040 (Active) | In progress | `idempotency.md` multi-region annex; `cross-engine-append-behavior.test.ts` | Gated on 2nd host |

## Phase 2 — Workflow Builder Foundation *(app: `apps/workflow-engine/frontend`, React Flow / @xyflow v12)*

| Feature | Layer | RFC needed? | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Infinite canvas | App | N/A | Done | `builder/canvas/BuilderCanvas.tsx` (ReactFlow) | |
| Zoom/pan | App | N/A | Done | `<Controls>` from `@xyflow/react` | |
| Minimap | App | N/A | Open | no evidence | `<Minimap>` not imported |
| Multi-select | App | N/A | In progress | `builderStore.ts` `selectedNodeId` (single) | Single-select only |
| Grouping | App | N/A | Open | no evidence | Flat node array; no subgraph |
| Sticky notes | App | N/A | Open | no evidence | No note schema |
| Alignment tools | App | N/A | Open | no evidence | |
| Grid snapping | App | N/A | Open | no evidence | Free-form positioning |
| Searchable node palettes | App | N/A | Done | `palette/NodePalette.tsx` `filterAndGroup()` | |
| Categorized nodes | App | N/A | Done | `NodePalette.tsx` `CATEGORY_ORDER` | flow/data/control/ai/integration |
| Reusable nodes | App | N/A | In progress | `duplicateSavedWorkflow()` | Workflow-level only, not node templates |
| Node validation | App | N/A | Done | `BuilderCanvas.tsx` `isValidConnection()` | Port-type compat check |
| Undo/redo | App | N/A | Done | `builderStore.ts` `past/future`, `HISTORY_MAX=30` | |
| Copy/paste | App | N/A | In progress | palette drag-drop only | No in-canvas node copy/paste |
| Keyboard shortcuts | App | N/A | Open | card-level only (`onCardKey`) | No canvas shortcuts |
| Inline editing | App | N/A | Open | no evidence | Fixed title spans |
| Workflow autosave | App | N/A | Done | `builderStore.ts` `persist()` on every mutation | localStorage |
| Live execution traces | App (dep: run event stream) | RFC 0002 §B | Done | backend `routes/streams.ts` SSE `/v1/runs/{id}/events` | |
| Timeline visualization | App (dep: event stream) | RFC 0002 §B | Done | `streams/EventStreamView.tsx` | Text list, not graphical |
| Streaming state updates | App (dep: SSE) | RFC 0002 stream-modes | Done | `client/streamsClient.ts` EventSource + Last-Event-ID | |
| Input/output inspectors | App (dep: event payloads) | RFC 0002 | In progress | `EventStreamView.tsx` raw-JSON details | No dedicated I/O inspector panel |
| Event inspection | App (dep: envelope events) | RFC 0030–0033 | Done | `chat/EnvelopeInspector.tsx` | Surfaces retry/refusal/truncation |
| Step replay | App (dep: fork endpoint) | RFC 0011 | Done | `RunDetailPage.tsx` `onForkFrom(seq)` → `POST /v1/runs/{id}:fork` | |
| Time-travel debugging | App (dep: fork + replay) | RFC 0011 | Done | `RunDetailPage.tsx` `?fromSeq=N` | |
| Execution diffing | App (dep: two-run compare) | NEW RFC NEEDED: run-diff surface | Open | no evidence | No side-by-side / diff endpoint |

## Phase 3 — Integration & Connector Platform

| Feature | Layer | RFC needed? | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Connector SDK | Protocol | **NEW RFC NEEDED: Connector SDK framework** | Open | no abstraction layer | HTTP/OpenAPI packs exist; no connector-authoring framework |
| OAuth framework | Protocol | **NEW RFC NEEDED: OAuth 2.0 flows** | Open | `auth.md` defers OAuth | API-key + OIDC done; OAuth 2.0 deferred |
| Credential management | Protocol | **NEW RFC NEEDED: credential storage** | Open | no credential pack | |
| Authentication abstraction | Protocol | RFC 0010 (Accepted) | Done | `auth-profiles.md`; `auth*.test.ts` | Bearer + API key |
| Trigger/action model | Protocol | RFC 0017 (Draft) | In progress | `packs/core.openwop.triggers` (16 triggers) | Triggers done; outbound "action model" gap |
| HTTP Request node | App (pack) | N/A | Done | `packs/core.openwop.http.fetch` | retry + SSRF guard |
| GraphQL node | App (pack) | N/A | Done | `core.openwop.http.graphql-{query,mutation,subscription}` | |
| Webhook node | App (pack) | N/A | Done | `triggers.webhook` + `http.webhook-verify` | |
| Database query node | App (pack) | RFC 0018 (Accepted) | Done | `packs/core.openwop.db.*` (12 nodes) | gated on host caps |
| File upload/download node | App (pack) | RFC 0014 (Accepted) | Done | `packs/core.openwop.files` (19) + `storage.blob-*` (3) | |
| OpenAI / Anthropic / Gemini | App (pack) | N/A | Done | `packs/core.openwop.ai.*` (provider-agnostic via `host.aiProviders`) | one pack, all providers |
| Slack | App (pack) | N/A | Done | `core.openwop.integration.slack-message` | |
| GitHub | App (pack) | N/A | Open | only `rag.loader-github` (read-only) | No GitHub API actions |
| Google Sheets / Airtable / Supabase / Salesforce / Notion / Jira / Stripe / Shopify | App (pack) | N/A | Open | no packs | Stripe has webhook-verify only |
| PostgreSQL | App (pack) | RFC 0018 (Accepted) | Done | `db.sql-*` + `examples/hosts/postgres` | generic SQL, no vendor pack |
| Encrypted credentials | Protocol | **NEW RFC NEEDED** | Open | API keys hashed-at-rest only | |
| OAuth token storage | Protocol | RFC 0010 (partial) | In progress | scopes mentioned; no storage schema | |
| Shared credentials | Protocol | **NEW RFC NEEDED** | Open | no spec | |
| Secrets rotation | Protocol | **NEW RFC NEEDED** | In progress | `auth-api-key-rotation.test.ts` exists; no pack abstraction | API-key rotation tested |

## Phase 4 — Durable Workflow Infrastructure

| Feature | Layer | RFC needed? | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Dedicated workers | Protocol | RFC 0037, RFC 0006 (Accepted) | Done | supervisor + dispatch primitives | |
| Worker scaling | — | n/a | Open | `scale-profiles.md` targets only | **Host-internal**; no advertisement surface |
| Queue partitioning | Protocol | none | Open | no conformance | **Host-internal** |
| Priority queues | Protocol | none | Open | no conformance | **Host-internal** |
| Retry queues | Protocol | RFC 0009 (Accepted) | Done | idempotency cache; `idempotencyRetry.test.ts` | |
| Cron scheduling | Protocol | RFC 0017 (Draft) | Open | RFC filed, not wired | |
| Delayed execution | Protocol | RFC 0017 (Draft) | Open | `core.control.delay` node exists; scheduling not wired | |
| Calendar triggers | Protocol | RFC 0017 (Draft) | Open | not wired | |
| Event scheduling | Protocol | RFC 0017 (Draft) | Open | not wired | |
| Multi-region execution | Protocol | RFC 0036 (Active) | In progress | `multi-region.ts` convergence rule; behavior test | |
| Horizontal scaling | — | n/a | Open | targets only | **Host-internal** |
| Execution sharding | Protocol | RFC 0036 (Active) | In progress | partition simulator seam | test seam only |
| Workflow failover | Protocol | RFC 0009 (Accepted) | Done | advisory-lock orphan recovery; `staleClaim.test.ts` | |
| Worker failover | Protocol | RFC 0009, RFC 0007 (Accepted) | Done | `restart-during-run.test.ts` | event-log replay |
| Prometheus | Protocol | RFC 0034 (Accepted) | Done | `observability.md`; `metric-emission.test.ts` | OTLP scrape-compatible |
| OpenTelemetry | Protocol | RFC 0009, RFC 0034 (Accepted) | Done | `observability.md`; `otel-emission-grpc.test.ts` | W3C traceparent |
| Execution metrics | Protocol | RFC 0009 (Accepted) | Done | canonical `openwop.run.*` metrics | |
| Queue metrics | Protocol | RFC 0009 (Accepted) | Done | `openwop.queue.depth` | |
| Dashboards | App | N/A | Open | sample Grafana only | operator concern |
| Alerts | App | N/A | Open | no surface | **Out of scope** |
| SLA monitoring | App | N/A | Open | SLA floors documented; no surface | **Out of scope** |

## Phase 5 — AI-Native Orchestration Layer

| Feature | Layer | RFC needed? | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Agent abstractions | Protocol | RFC 0002, RFC 0003 (Accepted) | Done | `agent-manifest.schema.json`; agent packs | |
| Tool calling | Protocol | RFC 0002, RFC 0007, RFC 0037 (Accepted) | Done | `agents.tool-{function,workflow,mcp,http}` | |
| Agent memory | Protocol | RFC 0004 (Accepted), RFC 0012 | Done | `agents.memory-{window,summary,kv-store}` | compaction = RFC 0012 |
| Conversation state | Protocol | RFC 0005 (Accepted) | Done | `conversation.schema.json` | |
| Multi-agent orchestration | Protocol | RFC 0006, RFC 0037 (Accepted) | Done | `agents.supervisor` + `core.dispatch` + `a2a` pack | |
| Supervisor agents | App (pack) | RFC 0006 | Done | `agents.supervisor` | |
| Worker agents | App (pack) | RFC 0003 | Done | 20+ vertical/horizontal skill packs | |
| Planner agents | App (pack) | N/A | Done | `agents.deep-research`, `research-crew` | |
| Evaluator agents | App (pack) | N/A | Done | `agents.policy-reviewer`, `structured-extractor` | |
| Human review agents | App (pack) | RFC 0044 | Done | `packs/core.openwop.hitl` | |
| Prompt management | Protocol | RFC 0027 (Accepted) | Done | `prompt-pack-manifest.schema.json`; `packs/core.openwop.prompts` | RFC 0027/0028/0029 |
| Prompt versioning | Protocol | RFC 0029 | Done | manifest version pinning | |
| Model routing | Protocol | RFC 0031 (Accepted) | Done | `agents.model-selector`; `Capabilities.models.*` | |
| Multi-model orchestration | App (pack) | RFC 0037, RFC 0031 | Done | multi-agent + model-selector | |
| Token tracking | Protocol | RFC 0026 (Accepted) | Done | `obs.metric`; provider-usage event | |
| Cost tracking | Protocol | RFC 0026 (Accepted) | Done | usage events w/ cost dims | |
| Vector DB integrations | App (pack) | RFC 0018 (Accepted) | Done | `db.vector-{upsert,query,delete}` | |
| Embeddings | App (pack) | N/A | Done | `ai.embeddings` | |
| Semantic search | App (pack) | N/A | Done | `rag.retriever-*` | |
| Retrieval pipelines | App (pack) | N/A | Done | `packs/core.openwop.rag` (13 nodes) | |
| Prompt tracing | App (pack) | N/A | Done | `obs.trace-span-{start,end}` | |
| Tool-call tracing | App (pack) | N/A | Done | agent run + obs pack | |
| Conversation replay | App (dep: replay) | RFC 0005, RFC 0041 | Done | `conversationVsLegacySuspend.test.ts` | |
| Hallucination tracking | App | N/A | Open | no pack | |
| Evaluation pipelines | App | N/A | In progress | 2 agent eval-loop packs; no generic framework | |

## Phase 6 — Enterprise & Governance

| Feature | Layer | RFC needed? | Status | Evidence | Notes |
|---|---|---|---|---|---|
| RBAC | App | **NEW RFC NEEDED: RBAC model** | Open | no impl | needs org/workspace foundation first |
| SSO (OAuth2/OIDC) | Protocol | RFC 0010, RFC 0011 (Accepted) | Done | `jwt-validator.ts`; `auth-oauth2-client-credentials.test.ts`, `auth-oidc-user-bearer.test.ts` | |
| SAML | Protocol | **NEW RFC NEEDED: SAML profile** | Open | not drafted | |
| LDAP | Protocol | **NEW RFC NEEDED: LDAP** | Open | not scoped | |
| SCIM | Protocol | **NEW RFC NEEDED: SCIM** | Open | not scoped | |
| Organizations | App | **NEW RFC NEEDED: multi-tenant org model** | Open | hosts hardcode single tenant | CTI-1 isolation proves protocol readiness; no admin UI |
| Workspaces | App | **NEW RFC NEEDED: workspace model** | Open | no isolation in hosts | |
| Team roles | App | **NEW RFC NEEDED: team/role model** | Open | aspirational in GOVERNANCE.md | |
| Environment separation | Protocol | RFC 0011, RFC 0013 (Accepted) | In progress | auth-scoped discovery (tenant2 subset) | full dev/staging/prod model unspecified |
| Audit logs | Protocol | RFC 0009, RFC 0010 (Accepted) | Done | `audit.test.ts`, `audit-tamper.test.ts`; SDK `verify()` | |
| Workflow approvals | App | **NEW RFC NEEDED: approval-workflow contract** | Open | HITL interrupts exist; approval-as-step not designed | |
| Change tracking | Protocol | RFC 0009 (baseline) | In progress | audit covers traceability; no change-set diff | |
| Deployment approvals | App | **NEW RFC NEEDED: deploy-gate** | Open | no deploy-slot model | |
| Secrets vault | Protocol | RFC 0019 (BYOK); NEW RFC for server-managed | In progress | BYOK roundtrip tested; Postgres host-managed resolver | server-side vault not formalized |
| Environment isolation | Protocol | RFC 0011 (Accepted) | In progress | tenant-scoped discovery | |
| Policy enforcement | Protocol | RFC 0031 (Accepted), RFC 0043 (Draft) | In progress | aiProviders 4-mode policy; `ai-policy.test.ts` | no general policy-as-code |
| IP restrictions | App | **NEW RFC NEEDED** | Open | no impl | |
| Kubernetes deployment | App | **NEW RFC NEEDED: K8s operator/helm** | Open | Docker only | |
| Air-gapped deployments | App | **NEW RFC NEEDED: offline registry** | Open | suite assumes connectivity | |
| On-prem support | App | **NEW RFC NEEDED: on-prem guide** | Open | DEPLOY.md is Cloud Run-specific | |
| Multi-cloud support | App | **NEW RFC NEEDED** | Open | storage abstraction exists; deploy single-cloud | |

## Phase 7 — Marketplace & Ecosystem

| Feature | Layer | RFC needed? | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Workflow marketplace | App | **NEW RFC NEEDED: marketplace schema** | Open | registry infra exists; no social UI | |
| Connector marketplace | App | **NEW RFC NEEDED: connector discovery** | Open | no UI | |
| Agent marketplace | App | **NEW RFC NEEDED: agent discovery** | Open | agent packs in registry; no discovery UI | |
| Prompt marketplace | App | **NEW RFC NEEDED: prompt sharing** | Open | RFC 0028 mutableLibrary endpoint exists; no shared catalog | |
| Shared templates | App | **NEW RFC NEEDED** | Open | no save-to-library/browse flows | |
| Ratings/reviews | App | **NEW RFC NEEDED: rating schema** | Open | not in registry schema | |
| Public workflows | App | **NEW RFC NEEDED: public sharing** | Open | no publish flow | |
| Community publishing | App | RFC 0043 (Draft) | In progress | trust tiers + signing in `registry-operations.md`; PUBLISHING.md | no self-service UI |
| TypeScript SDK | Protocol | RFC 0001 | Done | `@openwop/openwop` npm; PARITY.md (32 helpers) | |
| Python SDK | Protocol | RFC 0001 | Done | `openwop-client` PyPI | |
| Go SDK | Protocol | RFC 0001 | Done | `sdk/go` | |
| Rust SDK | Protocol | **NEW RFC NEEDED: Rust SDK** | Open | demand-gated per ROADMAP | |
| Plugin framework | Protocol | **NEW RFC NEEDED: plugin contract** | Open | `host-extensions.md` is declarative only | no dynamic load |
| Runtime extensions | Protocol | host-extensions.md | In progress | static extension surface | no dynamic module load |
| Community packages | App | RFC 0043 (Draft) | In progress | registry accepts `community.*` | no browse/install UI |
| Embedded builder | App | **NEW RFC NEEDED: embedded builder API** | Open | builder not embeddable | |
| Embedded runtime | App | **NEW RFC NEEDED: embedded runtime API** | Open | no in-app runtime lib | |
| White-label workflows | App | **NEW RFC NEEDED** | Open | openwop branding throughout | |
| API embedding | App | **NEW RFC NEEDED: embedding guide** | Open | REST API public; no embedding pattern | |

## Phase 8 — AI Workflow Standardization Platform

| Feature | Layer | RFC needed? | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Workflow portability | Protocol | RFC 0037, 0040, 0041 | In progress | portable handoff state machine; §1 Accepted, §2–4 Active | |
| Cross-runtime execution | Protocol | RFC 0036, 0040, 0041 (Active) | In progress | `cross-engine-append-behavior.test.ts` | |
| Open execution schemas | Protocol | RFC 0037 §1 (Accepted) | Done | `run-event-payloads.schema.json`, `orchestrator-decision.schema.json` | JSON Schema 2020-12 |
| Workflow packaging | Protocol | RFC 0003, RFC 0013 (Accepted) | Done | `node-packs.md`; signed `registry/v1/packs/...` | SRI + Ed25519 |
| LangGraph compatibility | Protocol | **NEW RFC NEEDED: LangGraph bridge** | Open | design alignment only | no formal bridge |
| Temporal compatibility | Protocol | **NEW RFC NEEDED: Temporal bridge** | Open | inspirational notes | |
| MCP integration | Protocol | RFC 0020 (Accepted), RFC 0040 | Done | `mcp-integration.md`; `mcp-tool-roundtrip.test.ts` | real interop vs MCP SDK 1.29 |
| Agent interoperability | Protocol | RFC 0002, 0003, 0006, 0007 (Accepted) | Done | `a2a-integration.md`; `a2a-task-roundtrip.test.ts` | real interop vs A2A SDK 0.3.13 |
| Multi-runtime orchestration | Protocol | RFC 0037, 0040 (Active) | In progress | gated on 2nd host | |
| Remote execution | Protocol | RFC 0036, 0040 (Active) | In progress | test seams; no prod multi-host | |
| Federated agents | Protocol | RFC 0040, RFC 0041 §4 (Active) | Open | RFCs Active not Accepted | needs 2nd non-steward host |
| Distributed AI systems | Protocol | RFC 0037 (§1–2 Accepted, §3–4 Active) | In progress | | |
| Conformance suites | App/infra | RFC 0009, 0010 (Accepted) | Done | `@openwop/openwop-conformance@1.5.0`; 160+ scenario files | |
| Certification | App/infra | RFC 0009 | In progress | INTEROP-MATRIX leaderboard; no formal cert authority | |
| Compliance tooling | App/infra | RFC 0010 (Accepted), RFC 0043 (Draft) | In progress | `SECURITY/invariants.yaml`; CI gate | |
| Reference implementations | App/infra | N/A | Done | 4 reference hosts (in-mem, SQLite, Python, Postgres) + workflow-engine app | |

---

## What to build next (derived from the gaps)

**Protocol track — file these RFCs to unblock connectors & enterprise:**
1. **Connector SDK framework** + **OAuth 2.0 flows** + **credential storage/sharing/rotation** — the single biggest cluster; unblocks every Phase 3 vendor integration (GitHub, Sheets, Salesforce, Notion, Jira, Stripe, Shopify, Supabase).
2. **SAML / LDAP / SCIM** auth profiles — enterprise identity (OAuth2/OIDC already done).
3. **Scheduling** — promote **RFC 0017** from Draft and wire cron/delayed/calendar/event triggers.
4. **Federation close-out** — RFC 0040 + RFC 0041 §4 need a 2nd non-steward host to flip Active → Accepted (also the GOVERNANCE.md working-group tripwire).

**App track — the application is the larger gap:**
1. **Builder polish** — minimap, multi-select, grouping, alignment, grid-snap, in-canvas copy/paste, keyboard shortcuts, inline editing.
2. **Multi-tenant foundation** (org / workspace / team / RBAC) — prerequisite for almost all of Phase 6 and the marketplace.
3. **Marketplace + community surface** — discovery, ratings/reviews, sharing, publishing UI on top of the *already-built* `packs.openwop.dev` registry.
4. **Embedded / white-label** — builder-as-library and headless runtime.

**Deliberately not building (host-internal / out of v1 scope):** Redis cache, worker pools, queue partitioning, priority queues, horizontal-scaling controls, dashboards/alerts/SLA surfaces — the spec leaves these to each host implementation by design.

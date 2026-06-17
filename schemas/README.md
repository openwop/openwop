# OpenWOP Spec v1 — JSON Schemas

> **Status: FINAL v1 (2026-05-10).** Hand-authored from prose specs. JSON Schema 2020-12. Validate with Ajv2020 (`require('ajv/dist/2020')`), `python-jsonschema`, or any other 2020-12 implementation. Implementations MAY pin to these schemas; servers MUST accept any JSON document that validates against them.

| Schema | Source spec | Coverage |
|---|---|---|
| `agent-inventory-response.schema.json` | `node-packs.md` + RFC 0072 | RFC 0072 §A — read projection of installed manifest agents (`GET /v1/agents` body + `$defs.AgentInventoryEntry`); no system prompt / handoff schemas / credentials (SR-1) |
| `agent-deployment.schema.json` | `agent-deployment.md` (RFC 0082) | Per-(agentId, version) deployment record — the seven-state lifecycle (draft/test/staged/active/paused/deprecated/rolled-back) + canaryPercent + rollbackPointer + channels[]; host-runtime state distinct from the immutable manifest and the registry's published tags |
| `agent-deployment-transition.schema.json` | `agent-deployment.md` §E (RFC 0082) | The `POST /v1/agents/{agentId}/deployments` request body — a state-transition request (promote/pause/deprecate/rollback/adjust-canary + toState/channel/canaryPercent/evalRunId), authorized fail-closed + gate-enforced before emitting the matching `deployment.*` event |
| `agent-eval-suite.schema.json` | `agent-evaluation.md` (RFC 0081) | Portable agent evaluation suite — tasks + golden/rubric `expected` + deterministic fixtures + allowed model classes + pass/fail thresholds, pack-distributed via `evalSuiteRef` |
| `agent-manifest.schema.json` | `node-packs.md` + agent-pack RFCs | Agent manifest entries distributed alongside node-pack manifests |
| `eval-summary.schema.json` | `agent-evaluation.md` (RFC 0081) | The content-free eval-run scorecard — aggregate + per-task scores/cost/latency/safety-findings + regression delta; served by `GET /v1/runs/{runId}/eval-summary` (SECURITY invariant `eval-summary-no-content-leak`) |
| `proposal.schema.json` | `agent-memory.md` §"Reviewable learning" (RFC 0096) | Reviewable-learning proposal — an INERT, draft-state reusable artifact (agent-pack/workflow-chain-pack/prompt-template/automation) synthesized from run traces; MUST NOT influence any run until `applied`; activation delegated to RFC 0051/0049 (SECURITY invariants `proposal-inert-until-applied`, `proposal-no-resynthesis`) |
| `goal.schema.json` | `agent-runtime.md` §"Standing goals" (RFC 0097) | Standing goal — a durable objective with judge-based (RFC 0090) completion + bounded (RFC 0058) continuation; completion is the judge's verdict, never client-set (SECURITY invariants `goal-continuation-bounded`, `goal-completion-judge-only`) |
| `localized-content-section.schema.json` | `localized-content.md` §B (RFC 0103) | One section record — base `data` + sparse `localizations` map (BCP-47 keys, never the base locale); resolved by the per-section field merge (exact→family→base, §C); body shapes open/host-defined |
| `localized-content-page.schema.json` | `localized-content.md` §B (RFC 0103) | Content page — `slug` + `sectionOrder` + `status` (atomic across locales for v1) + SEO hreflang/og:locale alternates |
| `localized-content-language-settings.schema.json` | `localized-content.md` §B (RFC 0103) | Per-tenant authoring config — `baseLocale` + `supportedLocales` (base ∉ supported) + `autoTranslateOnPublish`; source of truth for the advertised `content` capability |
| `localized-content-page-response.schema.json` | `localized-content.md` §D (RFC 0103) | Resolved delivery response for `GET /v1/content/pages/{slug}` — negotiated `locale` (= `Content-Language`) + already-merged, published-only sections in render order (SECURITY invariants `content-published-cache-no-draft`, `content-response-tenant-scoped`, `content-no-cross-tenant-enumeration`) |
| `export-bundle.schema.json` | `portability.md` (RFC 0098) | Portable agent-platform export bundle — a tenant's reusable estate (agents/packs/templates/connection-refs/schedules/roster/org-chart) for cross-host migration; carries NO credential values, only refs (SECURITY invariant `export-bundle-no-credential-material`) |
| `agent-ref.schema.json` | `agent-memory.md` + agent-identity RFC | Multi-Agent Shift Phase 1 — slim runtime AgentRef projection carried on `RunSnapshot.agent` / `runOrchestrator`, `WorkflowNode.agent?`, and `agent.*` event payloads |
| `agent-roster-entry.schema.json` | `agent-roster.md` (RFC 0086) | Standing agent INSTANCE — a named, tenant-scoped `host:<id>` agent (the "digital-twin employee") that references a manifest/deployment (`agentRef`) and owns a `workflows[]` portfolio; the discovery shape behind `GET /v1/agents/roster` + the `roster` inventory projection |
| `agent-org-chart.schema.json` | `agent-org-chart.md` (RFC 0087) | Tenant-scoped, DESCRIPTIVE grouping of roster members into departments + roles with acyclic `reportsTo` edges; carries NO authority field (every object `additionalProperties:false`) per the `org-position-no-authority-escalation` invariant; the discovery shape behind `GET /v1/agents/org-chart` |
| `agent-roster-response.schema.json` | `agent-roster.md` (RFC 0086 §B) | Response body for `GET /v1/agents/roster` — `{ roster: AgentRosterEntry[], total }`, tenant-scoped |
| `org-chart-responsibility-view.schema.json` | `agent-org-chart.md` (RFC 0087 §D) | Response body for `GET /v1/agents/org-chart/{departmentId}` — the department subtree + the responsibility roll-up (union of member portfolios) |
| `ai-envelope.schema.json` | `ai-envelope.md` | FINAL v1.1 — inbound LLM-emission envelope. Top-level shape (`type` / `schemaVersion` / `envelopeId` / `correlationId` / `payload` / `meta` / `partial`). Per-kind payload schemas under `envelopes/`. Distinct from `RunEventDoc` (outbound) and `error-envelope.schema.json` (host HTTP errors). |
| `artifact-type-pack-manifest.schema.json` | `artifact-type-packs.md` + RFC 0071 | DRAFT — manifest for `kind: "artifact-type"` registry packs. Peer to `node-pack-manifest.schema.json` (RFC 0003), `workflow-chain-pack-manifest.schema.json` (RFC 0013), and `prompt-pack-manifest.schema.json` (RFC 0028); disjoint via the `kind` discriminator. Distributes typed artifact definitions (schema + advisory rendering hint + lifecycle + export-format hints) via the same signed-tarball + Ed25519 + SRI pipeline. |
| `envelopes/clarification.request.schema.json` | `ai-envelope.md` §"Universal kinds" | FINAL v1.1 — payload for the universal `clarification.request` kind; engine lifts to `kind: "clarification"` `InterruptPayload`. |
| `envelopes/schema.request.schema.json` | `ai-envelope.md` §"Universal kinds" | FINAL v1.1 — LLM asks the engine for a kind's JSON Schema. Counts against `Capabilities.limits.schemaRounds`. |
| `envelopes/schema.response.schema.json` | `ai-envelope.md` §"Universal kinds" | FINAL v1.1 — side-channel ack for `schema.request`. Never surfaces to users. |
| `envelopes/error.schema.json` | `ai-envelope.md` §"Universal kinds" | FINAL v1.1 — LLM's deliberate error report. Distinct from `error-envelope.schema.json` (host HTTP errors). |
| `envelopes/media.image.schema.json` | `ai-envelope.md` §"Media reference payloads" | RFC 0055 §C — optional `media.image` payload; tenant-scoped URL ref or inline base64 below `maxInlineMediaBytes`. |
| `envelopes/media.audio.schema.json` | `ai-envelope.md` §"Media reference payloads" | RFC 0055 §C — optional `media.audio` payload; URL ref or inline base64 + optional `durationSeconds`. |
| `envelopes/media.file.schema.json` | `ai-envelope.md` §"Media reference payloads" | RFC 0055 §C — optional `media.file` payload; downloadable asset by URL ref or inline base64 + optional `name`. |
| `envelopes/ui.a2ui-surface.schema.json` | `ai-envelope.md` §"A2UI surfaces" | RFC 0102 — optional, advertised `ui.a2ui-surface` payload; closed A2UI component tree (`anyOf` + single-string-enum discriminator) + host-enumerated `catalogVersion`. Core `ui.*` content-primitive family beside `media.*`. |
| `annotation.schema.json` | `RFCS/0056` + `observability.md` | RFC 0056 (`Draft`) — a non-blocking human/agent quality signal (rating / correction / label / flag) attached to a run, event, or node. A side-resource (not a replayable run-event-log entry); response of `POST/GET /v1/runs/{runId}/annotations` + payload of the `run.annotated` SSE notification. |
| `annotation-create.schema.json` | `RFCS/0056` | RFC 0056 (`Draft`) — request body for `POST /v1/runs/{runId}/annotations` (host assigns `annotationId`/`createdAt`/`actor`; binds `target.runId` to the path). |
| `heartbeat-evaluated.schema.json` | `RFCS/0060` + `host-capabilities.md` | RFC 0060 (`Active`) — payload of the heartbeat-scoped `heartbeat.evaluated` AsyncAPI event (`{ heartbeatId, status, changed }`); emitted every tick by a host advertising `capabilities.heartbeat`. Not a run-event-log entry. |
| `heartbeat-state-changed.schema.json` | `RFCS/0060` + `host-capabilities.md` | RFC 0060 (`Active`) — payload of the `heartbeat.stateChanged` AsyncAPI event (`{ heartbeatId, from, to }`); emitted only on a predicate-state transition. Not a run-event-log entry. |
| `audit-verify-result.schema.json` | `auth-profiles.md` §`openwop-audit-log-integrity` | Response payload from `GET /v1/audit/verify` — chain-validity verdict + checkpoints + anomalies |
| `capabilities.schema.json` | `capabilities.md` | `/.well-known/openwop` response — protocolVersion + supportedEnvelopes + schemaVersions + limits + optional v1 discovery surface |
| `channel-written-payload.schema.json` | `channels-and-reducers.md` §Channel write event | Payload of the `channel.written` RunEvent — write input + reducer name |
| `chat-card-pack-manifest.schema.json` | `chat-card-packs.md` + RFC 0071 | DRAFT — manifest for `kind: "card"` registry packs (RFC 0071 Phase 2). Peer to the node/workflow-chain/prompt/artifact-type pack manifests; disjoint via the `kind` discriminator. Distributes AI chat cards: a prompt template + typed input subset bound to a typed `outputArtifactType`. |
| `connection-pack-manifest.schema.json` | `connection-packs.md` + RFC 0095 | DRAFT — manifest for `kind: "connection"` registry packs (RFC 0095). Peer to the node/workflow-chain/prompt/artifact-type/chat-card pack manifests; disjoint via the `kind` discriminator. Distributes a portable provider definition — auth endpoints, read/write scope groups, exactly-one reach (`mcp`/`openapi`/`integration`) — that the RFC 0045/0047 `provider` string resolves against. Carries NO credential material (`connection-pack-no-credential-material`). |
| `conformance-certification-bundle.schema.json` | `conformance-certification.md` + RFC 0089 | DRAFT — machine-readable attestation binding a host's claimed profiles to the reproducible run that substantiates them (suite version + per-scenario pass list + host identity/commit + captured discovery document). Out-of-band; a consumer re-derives each claim via the §B binding rule. |
| `conversation-event.schema.json` | `channels-and-reducers.md` + conversation RFC | Multi-turn conversation event shape for orchestrator-driven HITL flows |
| `conversation-turn.schema.json` | `channels-and-reducers.md` + conversation RFC | Conversation turn shape for user/agent/system messages |
| `core-conformance-mock-agent-config.schema.json` | `node-packs.md` + RFC 0023 | Config shape for the conformance-only `core.conformance.mock-agent` typeId — drives `agent.*` event emission on cue (`mockReasoning` / `mockToolCalls` / `mockHandoff` / `mockDecision` / `mockConfidence`). Hosts MUST refuse this typeId for production tenants unless `capabilities.conformance.mockAgent` is advertised. |
| `credential-reference.schema.json` | `host-capabilities.md` §host.credentials + RFC 0046 | Opaque `{ ref, scope }` handle to a host-stored credential — the only credential artifact on the wire; never carries key material |
| `debug-bundle.schema.json` | `debug-bundle.md` | Portable run diagnostic export from `GET /v1/runs/{runId}/debug-bundle` |
| `dispatch-config.schema.json` | `node-packs.md` + dispatch RFC | Configuration shape for `core.dispatch` / sub-workflow routing |
| `error-envelope.schema.json` | `rest-endpoints.md` + `auth.md` | Canonical `{error, message, details?}` shape returned on every non-2xx |
| `memory-entry.schema.json` | memory-layer RFC | Persisted agent memory entry shape |
| `memory-list-options.schema.json` | memory-layer RFC | Query options for listing agent memory entries |
| `node-pack-manifest.schema.json` | `node-packs.md` | Pack manifest (`pack.json`) — name, version, engines, nodes[], runtime, signing |
| `pack-lockfile.schema.json` | `node-packs.md` §"Dependency resolution + lockfile" | Reproducible-build lockfile pinning resolved pack versions + SHA-256 integrity + Ed25519 signature for the entire workspace dependency graph |
| `prompt-kind.schema.json` | `prompts.md` + RFC 0027 | Shared `string` enum (`system` / `user` / `few-shot` / `schema-hint`) `$ref`-ed by every schema that names a prompt kind. Single edit point when introducing a new kind. |
| `prompt-pack-manifest.schema.json` | `prompts.md` §"Discovery & distribution" + RFC 0028 | Manifest for `kind: "prompt"` registry packs. Peer to `node-pack-manifest.schema.json` (RFC 0003) and `workflow-chain-pack-manifest.schema.json` (RFC 0013); disjoint via the `kind` discriminator. Distributes curated PromptTemplate collections via the same signed-tarball + Ed25519 + SRI pipeline. |
| `prompt-ref.schema.json` | `prompts.md` + RFC 0027 | Reference to a PromptTemplate. `oneOf` accepts the stringy form (`prompt:templateId@version`) or a structured object with `libraryId` / `templateId` / `version` / `variableOverrides`. |
| `prompt-template.schema.json` | `prompts.md` + RFC 0027 | Named, versioned, variable-bound prompt body. Carries `templateId` + SemVer `version` + `kind` (via `prompt-kind.schema.json`) + Mustache `text` + typed `variables[]` + optional `modelHints` + `meta` provenance (incl. RFC 0028 `packName` + `packVersion` when pack-sourced). |
| `registry-version-manifest.schema.json` | `registry-operations.md` | Registry-augmented version manifest served at `GET /v1/packs/{name}/-/{version}.json`. Extends the bare pack-manifest contract with registry-side metadata (integrity hash, signing-block polymorphism, lifecycle flags). Enforced by the `Validate version manifests against registry-version-manifest schema` step in `.github/workflows/registry-publish.yml`. |
| `orchestrator-decision.schema.json` | `node-packs.md` + orchestrator RFC | Decision output shape for orchestrator routing nodes |
| `run-ancestry-response.schema.json` | `multi-agent-execution.md` + RFC 0040 | Response body for `GET /v1/runs/{runId}/ancestry` — names the run's immediate parent in the cross-host composition chain (or `parent: null` for top-level runs). Capability-gated on `capabilities.multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported`. |
| `run-diff-response.schema.json` | `rest-endpoints.md` + RFC 0054 | Response body for `GET /v1/runs/{runId}:diff?against={otherRunId}` — deterministic, replay-aware structured diff of two runs (`divergedAtSeq` + `eventDiffs[]` + `stateDiff`). |
| `run-event-payloads.schema.json` | `run-event.schema.json` §RunEventType | Per-RunEventType payload contracts, indexed by `$defs.<typeId>` for opt-in strict validation |
| `run-event.schema.json` | `version-negotiation.md` + `RunEventDoc` | Event log envelope + event type enum |
| `run-options.schema.json` | `run-options.md` | Per-run input overlay (configurable + tags + metadata) on `POST /v1/runs` |
| `run-orchestrator-decided-event.schema.json` | orchestrator RFC + `observability.md` | Event payload for orchestrator decisions |
| `run-snapshot.schema.json` | `rest-endpoints.md` §RunSnapshot | Projected run state from `GET /v1/runs/{runId}` |
| `credential-provenance.schema.json` | `host-capabilities.md` §"Credential provenance + egress policy" (RFC 0079) | Metadata about a host-issued credential at the tool/egress boundary — `credentialId`/`issuer`/`audiences`(+scopes/expiry/redaction/audit-correlation). Secret-free (SR-1); the §C audience-binding MUST is evaluated against `audiences`. |
| `security-advisory.schema.json` | `registry-operations.md` + INCIDENT-RESPONSE runbook | Registry-owned CVE advisory record at `registry/security/advisories.json`. One entry per disclosed vulnerability — id, severity, affected pack-name + SemVer range, optional fixedIn/advisoryUrl/credits. Enforced by `check-advisories.mjs` in `.github/workflows/registry-publish.yml`. |
| `trigger-subscription.schema.json` | `trigger-bridge.md` (RFC 0083) | Durable inbound-trigger subscription record — `subscriptionId`/`source`/`state` (active/paused/failed/dead-lettered) + `dedupEnabled`/`retryPolicy` + the webhooks.md register keys. Backs the `openwop-trigger-bridge` profile; content-free of inbound payloads (SR-1). |
| `trigger-event.schema.json` | `trigger-bridge.md` §F (RFC 0099) | The normalized external-event envelope handed to a started run as `ctx.triggerData` (webhook/email/form). In-run only — never event-logged; `trigger.delivery.attempted` stays content-free. Per-source one-of; `contentTrust: "untrusted"`; `AttachmentRef.ref` is a host-internal handle, never a fetchable URL (`trigger-ingestion-ssrf` / `trigger-ingestion-content-redaction`). |
| `trigger-subscription-registration.schema.json` | `trigger-bridge.md` §F (RFC 0099) | The `POST /v1/trigger-subscriptions` create request — binds an external `source` to a `workflowId` with a dedup config + a source-authenticity `verification` policy. The portable create surface RFC 0083 UQ1 left per-source. |
| `a2a-task-state.schema.json` | `a2a-integration.md` §"Async / durable Tasks" (RFC 0100) | The durable, persisted projection of an A2A `Task` an OpenWOP host keeps per backing run when `a2a.durableTasks: true` — `taskId == runId`, lowercase-hyphen `state`, `interruptKind`, optional SSRF-guarded `PushConfig`. Content-free of run inputs/outputs/artifacts (SR-1 / `a2a-push-egress-ssrf`). |
| `budget-policy.schema.json` | `budget-policy.md` (RFC 0084) | The reserved `budget` run-options shape — `maxTokens`/`maxCostUsd`/`maxToolCalls`/`maxRetries`/`modelAllow[]`/`modelDeny[]`/`thresholdPercent`/`onExhaustion`. Enforceable per-run spend governance; wall-time/iterations delegated to RFC 0058 (`additionalProperties:false`). Content-free events; no pricing on the wire (`budget-no-pricing-leak`). |
| `tool-descriptor.schema.json` | `tool-catalog.md` (RFC 0078) | Portable read-only description of one tool unifying the five tool surfaces (node-pack/workflow/mcp/connector/host-extension) — stable `toolId`, source, I/O schemas, auth/egress/approval requirements, replay policy, and `safetyTier` (`exec` ⇒ `host-extension`, RFC 0069). Returned by `GET /v1/tools`; secret-free (SR-1). |
| `suspend-request.schema.json` | `interrupt.md` | `InterruptPayload` with 8 `kind` discriminators (approval, clarification, external-event, custom, conversation.start, conversation.exchange, conversation.close, low-confidence) |
| `workflow-chain-pack-manifest.schema.json` | `workflow-chain-packs.md` + RFC 0013 | Manifest for workflow-chain packs (`kind: "workflow-chain"`) — pre-configured DAG fragments expanded inline at workflow-author time. Peer to `node-pack-manifest.schema.json`; disjoint via the `kind` discriminator. |
| `workflow-definition.schema.json` | `channels-and-reducers.md` + `node-packs.md` | DAG of nodes + edges + triggers + variables + channels |
| `workspace-file.schema.json` | `agent-workspace.md` + `RFCS/0059` | RFC 0059 — a versioned workspace file (`{path, content, version, etag, updatedAt}`); response of `GET/PUT /v1/host/workspace/files/{path}`. |
| `workspace-file-create.schema.json` | `agent-workspace.md` + `RFCS/0059` | RFC 0059 — `PUT /v1/host/workspace/files/{path}` request body (content + optional contentType; path from the URL, version/etag host-assigned). |

## Validating against the schemas

### TypeScript / Node

```typescript
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from './run-event.schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(myEvent)) {
  console.error(validate.errors);
}
```

### Python

```python
import json
import jsonschema

schema = json.load(open('run-event.schema.json'))
jsonschema.validate(my_event, schema)  # raises ValidationError on failure
```

## Cross-reference

- **Conformance test suite (P2-F4)** — black-box tests that fixture-validate against these schemas.
- **Reference SDKs (P2-F3)** — generate types via `quicktype` or `json-schema-to-typescript`.
- **OpenAPI 3.1 YAML** — references these schemas via `$ref` instead of inlining.

## Open gaps

| # | Gap | Owner |
|---|---|---|
| JS1 | Per-`RunEventType` payload schemas — done (2026-04-26: `run-event-payloads.schema.json` covers all 38 variants in ~15 shape families). Top-level `run-event.schema.json` `payload` stays permissive for forward-compat; consumers MAY pin strict validation via `$defs.<typeId>`. | ✅ |
| JS2 | `Capabilities` schema — done (2026-04-26: `capabilities.schema.json` lifted from `Capabilities.ts`) | ✅ |
| JS3 | `RunOptions` schema (configurable + tags + metadata) — done (2026-04-26: `run-options.schema.json` lifted from `run-options.md`) | ✅ |
| JS4 | Channel-write event payload schema — done (2026-04-26: `channel-written-payload.schema.json` lifted from channels-and-reducers.md §Channel write event) | ✅ |
| JS5 | Error-envelope schema — done (2026-04-26: `error-envelope.schema.json` hoisted from inline OpenAPI) | ✅ |
| JS6 | `RunSnapshot` schema — done (2026-04-26: `run-snapshot.schema.json` hoisted from inline OpenAPI) | ✅ |

## Versioning

Schemas are versioned via `$id` URL (`/spec/v1/`). Breaking changes go to `/spec/v2/`. Non-breaking additions stay on v1 with `$comment` notes documenting added fields.

# v2 witness coverage

> **Status:** generated report, not normative. Regenerate with `node scripts/report-v2-witness-coverage.mjs --write`; `--check` fails when this file is stale.

## Why this exists

Every v2 core family now has a v2 normative home (RFC 0189). Many of its rules are witnessed only by major-1 scenarios, or by nothing. At v1 end-of-support (not before the date in `evidence/v1-end-of-support.json`) a major-1 witness stops counting, and the rule is then checked by no test.

## Headline

- **Families (73 core):** 31 v2-witnessed, 38 v1-only, 4 unwitnessed. Of the 54 `witnessable-gated` families, 34 are v1-only; every unwitnessed family is `claims-check`.
- **At v1 end-of-support:** the 38 v1-only families, and the 157 obligation units attributed to them, lose their only witness.
- **Obligation units (873 in `spec/v2/core/`):** 497 (57%) sit in a section a major-2 scenario cites; 376 sit in 117 sections no major-2 scenario cites.
- **Declaration links:** 0 core families declare `floorScenarios`; 0 declare `requirementIds`. The family-to-test link exists only in scenario code and citations, although `overview.md` §What a MUST means says every core MUST has an id in `requirements.json`.
- **Scenarios:** 574 registered, 137 run at major 2. 33 major-2 citations name a v2 core section this script cannot match to a heading (see Citation gaps).

## How to read it

- **Obligation unit:** a paragraph, table row or list item in `spec/v2/core/` with MUST, MUST NOT, SHOULD, SHOULD NOT or REQUIRED. Fenced code is ignored.
- **Signals:** `gate` = the scenario code names the family key; `rfc` = an `it()` cites the family's owning RFC; `cite` = an `it()` cites a v2 section owned by the family.
- **Verdict:** `v2-witnessed` if a major-2 scenario carries a signal, `v1-only` if only major-1 scenarios do, else `unwitnessed`. It is necessary, not sufficient: one gated scenario can witness one rule of thirty.
- **Not measured:** which prose rule a given `it()` discharges. Citations name sections, not sentences, and no regex can decide it (RFC 0191). A cited section can still hold unwitnessed rules, so the cited-section count is an upper bound.
- **Attribution:** a section belongs to a family when its heading (or an ancestor's) is titled for it, when its document homes that family alone, or when the document is named for it (`replay.md`). Anything else is `shared`.

## Per-family coverage

| Family | Witness class | Verdict | Units (v2-cited) | Major-2 witnesses | Major-1-only witnesses |
| --- | --- | --- | --- | --- | --- |
| `nosql` | claims-check | **unwitnessed** | 3 (0) | – | – |
| `agentRuntime` | claims-check | **unwitnessed** | 1 (0) | – | – |
| `promptLibrary` | claims-check | **unwitnessed** | 1 (0) | – | – |
| `envelopeContracts` | claims-check | **unwitnessed** | 0 (0) | – | – |
| `i18n` | witnessable-gated | **v1-only** | 17 (0) | – | `i18n-negotiation` |
| `prompts` | witnessable-gated | **v1-only** | 16 (0) | – | `prompt-all-four-kinds-events`, `prompt-composed-secret-redaction`, `prompt-composed-trust-marker`, `prompt-end-to-end-events` +11 |
| `aiProviders` | witnessable-gated | **v1-only** | 15 (0) | – | `ai-envelope-shape`, `byok-auth-modes`, `media-url-inline-cap`, `node-module-required-capabilities-shape` |
| `envelopes` | claims-check | **v1-only** | 13 (0) | – | `envelope-reasoning-secret-redaction`, `envelope-reasoning-shape`, `envelope-tier-one-subset-static` |
| `artifactTypes` | witnessable-gated | **v1-only** | 10 (0) | – | `artifact-type-pack-install`, `artifact-type-registration-source`, `artifact-type-store-emission`, `artifact-type-store-without-render` +1 |
| `portability` | witnessable-gated | **v1-only** | 8 (0) | – | `export-bundle-portability` |
| `selfHostedRunner` | witnessable-gated | **v1-only** | 8 (0) | – | `self-hosted-runner` |
| `httpClient` | witnessable-gated | **v1-only** | 7 (0) | – | `http-client-ssrf`, `safefetch-behavior`, `safefetch-live-audit` |
| `secrets` | witnessable-gated | **v1-only** | 7 (0) | – | `envelope-reasoning-secret-redaction`, `secret-leakage-otel-attribute` |
| `workspace` | witnessable-gated | **v1-only** | 7 (0) | – | `workspace-behavior`, `workspace-capability-shape`, `workspace-cross-tenant-isolation-blackbox`, `workspace-cross-tenant-isolation` |
| `queueBus` | witnessable-gated | **v1-only** | 5 (0) | – | `queue-ack-nack-dlq`, `queue-cross-tenant-isolation`, `queue-publish-consume-roundtrip`, `stream-subscribe-from-beginning` |
| `subWorkflow` | claims-check | **v1-only** | 5 (0) | – | `dispatch-input-mapping`, `dispatchLoop` |
| `providerUsage` | witnessable-gated | **v1-only** | 4 (0) | – | `provider-usage` |
| `toolHooks` | witnessable-gated | **v1-only** | 4 (0) | – | `safefetch-behavior`, `safefetch-live-audit`, `tool-hooks-authorization-fail-closed`, `tool-hooks-content-free` +4 |
| `fs` | witnessable-gated | **v1-only** | 3 (0) | – | `fs-path-traversal` |
| `modelCapabilities` | witnessable-gated | **v1-only** | 3 (0) | – | `envelope-variant-discriminator-static`, `model-capability-insufficient`, `model-capability-substituted`, `node-module-required-capabilities-shape` |
| `multiPartyConversation` | witnessable-gated | **v1-only** | 3 (0) | – | `multi-party-conversation-behavioral`, `multi-party-conversation-shape` |
| `nodePackRuntimes` | claims-check | **v1-only** | 3 (0) | – | `otel-emission-grpc`, `wasm-pack-abi-version-rejection`, `wasm-pack-invoke-completed`, `wasm-pack-invoke-suspended` +3 |
| `sql` | witnessable-gated | **v1-only** | 3 (0) | – | `sql-injection-rejection`, `sql-transaction-atomicity` |
| `dataResidency` | witnessable-gated | **v1-only** | 2 (0) | – | `data-residency-admission` |
| `kvStorage` | witnessable-gated | **v1-only** | 2 (0) | – | `kv-atomic-increment`, `kv-cas`, `kv-cross-tenant-isolation`, `kv-ttl-expiry` |
| `scheduling` | witnessable-gated | **v1-only** | 2 (0) | – | `scheduling-capability-shape`, `scheduling-cron-fires-once` |
| `searchIndex` | witnessable-gated | **v1-only** | 2 (0) | – | `search-bm25-roundtrip` |
| `tableStorage` | witnessable-gated | **v1-only** | 2 (0) | – | `table-cross-tenant-isolation`, `table-cursor-pagination`, `table-schema-enforcement` |
| `vectorStore` | witnessable-gated | **v1-only** | 2 (0) | – | `vector-knn-roundtrip` |
| `aiEnvelope` | witnessable-gated | **v1-only** | 1 (0) | – | `aiEnvelope.universalKinds` |
| `blobStorage` | witnessable-gated | **v1-only** | 1 (0) | – | `blob-cross-tenant-isolation`, `blob-presign-expiry`, `blob-roundtrip` |
| `channelPresence` | witnessable-gated | **v1-only** | 1 (0) | – | `channel-presence-behavioral`, `channel-presence-shape` |
| `conversationTurnModelProvenance` | witnessable-gated | **v1-only** | 1 (0) | – | `conversation-turn-model-provenance-shape` |
| `authorization` | witnessable-gated | **v1-only** | 0 (0) | – | `authorization-fail-closed`, `authorization-roles-shape`, `compensation-recovery` |
| `cache` | witnessable-gated | **v1-only** | 0 (0) | – | `cache-cross-tenant-isolation`, `cache-ttl-expiry` |
| `credentials` | witnessable-gated | **v1-only** | 0 (0) | – | `credential-payload-redaction`, `credentials-capability-shape` |
| `deadLetter` | witnessable-gated | **v1-only** | 0 (0) | – | `deadletter-capability-shape`, `deadletter-retry-exhaustion` |
| `limits` | witnessable-gated | **v1-only** | 0 (0) | – | `aiEnvelope.capBreached`, `run-execution-bounds-shape` |
| `nondeterminismPolicy` | claims-check | **v1-only** | 0 (0) | – | `agent-platform-profile` |
| `purposePropagation` | witnessable-gated | **v1-only** | 0 (0) | – | `purpose-propagation` |
| `triggerBridge` | witnessable-gated | **v1-only** | 0 (0) | – | `agent-roster-attribution`, `trigger-bridge-delivery`, `trigger-ingestion`, `trigger-stream-cdc-sources` |
| `uiPlugins` | witnessable-gated | **v1-only** | 0 (0) | – | `frontend-plugin-packs` |
| `production` | witnessable-gated | **v2-witnessed** | 49 (26) | `jcs-vectors`, `v2-bundle-v3-signed`, `v2-coherence-not-in-bundle`, `v2-relaxation-recorded` | `grpc-transport`, `production-backpressure`, `production-retention-expiry` |
| `interrupt` | witnessable-gated | **v2-witnessed** | 46 (43) | `v2-approval-reject-disposition`, `v2-approver-enforced`, `v2-bound-id-kinds`, `v2-callback-url-guarded` +4 | `interrupt-approver-routing` |
| `replay` | witnessable-gated | **v2-witnessed** | 36 (19) | `v2-a2a-push-delivery`, `v2-approval-reject-disposition`, `v2-effect-seam-manifest`, `v2-effect-seam-no-refire` +7 | `replay-side-effect-suppression` |
| `eventLog` | claims-check | **v2-witnessed** | 35 (25) | `v2-era-2-append-vocabulary`, `v2-era-key`, `v2-era-stamp-universal`, `v2-fork-a-v1-run` +3 | `cross-engine-append-behavior`, `cross-engine-append-ordering`, `multi-region-idempotency` |
| `packs` | claims-check | **v2-witnessed** | 35 (20) | `v2-manifest-ceiling-refused`, `v2-manifest-hatch-carried`, `v2-peer-dependency-declared`, `v2-registry-lifecycle` | `pack-registry-isolation` |
| `webhooks` | witnessable-gated | **v2-witnessed** | 34 (26) | `inbound-credential-no-passthrough`, `v2-a2a-operation-map`, `v2-bound-id-kinds`, `v2-v1-signed-webhook-accepted` +10 | `webhook-negative`, `webhook-sig-algorithm`, `webhook-signed-delivery` |
| `idempotency` | witnessable-gated | **v2-witnessed** | 25 (20) | `v2-bound-id-kinds`, `v2-effect-identity-business-key`, `v2-idempotency-key-grammar` | `compensation-recovery`, `multi-region-idempotency-behavior`, `multi-region-idempotency`, `replay-llm-cache-key` +1 |
| `multiAgent` | claims-check | **v2-witnessed** | 19 (0) | `context-budget-transcript-bound`, `context-summarization-replay`, `v2-run-fork-ancestry` | `cross-host-traceparent-propagation`, `multi-agent-handoff-state-machine`, `replay-observable-sequence-determinism` |
| `toolCatalog` | witnessable-gated | **v2-witnessed** | 14 (11) | `auth-challenge-no-oracle`, `tool-catalog-compact-projection`, `tool-catalog-projection`, `tool-descriptor-shape` +1 | `tool-session-lifecycle` |
| `oauth` | witnessable-gated | **v2-witnessed** | 13 (11) | `v2-a2a-operation-map`, `v2-credential-interrupt`, `v2-mcp-mount-map`, `v2-oauth-client-pkce-state-iss` +1 | `byok-auth-modes`, `oauth-authorization-code-roundtrip`, `oauth-capability-shape`, `oauth-connector-redaction` |
| `memory` | witnessable-gated | **v2-witnessed** | 12 (0) | `context-budget-transcript-bound`, `context-summarization-replay`, `memory-attribution-replay-stable` | `agentMemoryRedactionContract`, `agentMemoryRoundTrip`, `memory-attribution-emits-on-write`, `memory-attribution-no-content` +7 |
| `forms` | claims-check | **v2-witnessed** | 11 (1) | `v2-form-when-reuses-edge-conditions` | `form-content-instantiation` |
| `connections` | witnessable-gated | **v2-witnessed** | 8 (5) | `fixtures-valid`, `v2-provider-conflict` | `connection-pack-apihosts`, `connection-pack-manifest-valid`, `connection-pack-no-credential-material`, `connection-pack-write-reconsent` +1 |
| `anonymousActor` | seam-gated | **v2-witnessed** | 7 (0) | `v2-mcp-mount-map` | `anonymous-actor-audit-opaque`, `anonymous-actor-default-deny`, `anonymous-actor-egress-guarded`, `anonymous-actor-no-secret-reach` +4 |
| `workflowChainPacks` | witnessable-gated | **v2-witnessed** | 5 (1) | `v2-chain-pin-exact` | `chain-subchain-fanout`, `workflow-chain-deferred-parameters`, `workflow-chain-expansion`, `workflow-chain-host-expansion` +2 |
| `mcp` | seam-gated | **v2-witnessed** | 4 (4) | `v2-interop-trace-context`, `v2-mcp-client-results`, `v2-mcp-mount-map`, `v2-mcp-tasks` +3 | `mcp-2026-07-28-discover`, `mcp-cache-tenant-scope`, `mcp-current-auth-boundary`, `mcp-extension-opacity` +9 |
| `budget` | witnessable-gated | **v2-witnessed** | 3 (3) | `v2-configurable-closed`, `v2-run-options-limits` | `budget-enforcement`, `budget-policy-shape` |
| `envelopeStrictness` | claims-check | **v2-witnessed** | 3 (3) | `v2-a2ui-v09-surface` | – |
| `heartbeat` | witnessable-gated | **v2-witnessed** | 3 (3) | `v2-stream-mode-refusal` | `heartbeat-capability-shape`, `heartbeat-fires-once-per-tick`, `heartbeat-idempotent-no-spam`, `heartbeat-runtime-bound` |
| `agents` | witnessable-gated | **v2-witnessed** | 2 (0) | `v2-a2a-agent-cards`, `v2-agent-org-chart-served-shape` | `agent-live-allowlist-enforced`, `agent-manifest-runtime`, `agentConfidenceEscalation`, `agentMessageReducer` +3 |
| `conversationPrimitive` | claims-check | **v2-witnessed** | 2 (0) | `v2-conversation-turn-parts` | `conversationCapabilityNegotiation`, `conversationLifecycle`, `conversationReplayDeterminism`, `conversationVsLegacySuspend` +1 |
| `feedback` | witnessable-gated | **v2-witnessed** | 2 (0) | `v2-run-annotation-not-event` | `feedback-capability-shape`, `feedback-correction-redaction`, `feedback-cross-tenant-isolation`, `feedback-fork-not-copied` +3 |
| `supportedEnvelopes` | witnessable-gated | **v2-witnessed** | 2 (2) | `v2-a2ui-v09-surface` | `ai-envelope-shape`, `envelope-tier-one-subset-static` |
| `schemaVersions` | witnessable-gated | **v2-witnessed** | 1 (1) | `v2-a2ui-v09-surface` | `aiEnvelope.schemaDrift` |
| `a2a` | seam-gated | **v2-witnessed** | 0 (0) | `v2-a2a-agent-cards`, `v2-a2a-client-error-details`, `v2-a2a-operation-map`, `v2-a2a-push-delivery` +3 | `a2a-1-0-agent-card`, `a2a-1-0-task-roundtrip`, `a2a-card-runtime-consistency`, `a2a-peer-authority` +2 |
| `auditLogIntegrity` | witnessable-gated | **v2-witnessed** | 0 (0) | `audit-checkpoint-signature`, `audit-log-integrity` | `strict-behavior-gate` |
| `auth` | seam-gated | **v2-witnessed** | 0 (0) | `audit-checkpoint-signature`, `audit-log-integrity`, `v2-assurance-downgrade-audited`, `v2-lane-exp-only-bound` +3 | `auth-api-key-rotation`, `auth-mtls`, `auth-oauth2-client-credentials`, `auth-oidc-user-bearer` +6 |
| `compensation` | seam-gated | **v2-witnessed** | 0 (0) | `v2-compensation-read-projection` | `chain-compensation-expansion`, `compensation-behavior`, `compensation-recovery`, `workflow-chain-host-expansion` |
| `content` | witnessable-gated | **v2-witnessed** | 0 (0) | `v2-content-locale-keys` | `localized-content-delivery` |
| `runList` | witnessable-gated | **v2-witnessed** | 0 (0) | `v2-mcp-mount-map`, `v2-mcp-tasks`, `v2-run-list` | – |
| `sandbox` | witnessable-gated | **v2-witnessed** | 0 (0) | `v2-pack-isolation` | `sandbox-memory-cap`, `sandbox-mvp-behavior`, `sandbox-no-host-fs-escape`, `sandbox-timeout-cap` +2 |

## Per-document coverage

| Document | Units | In v2-cited sections | Homes |
| --- | --- | --- | --- |
| `artifact-type-packs.md` | 10 | 0 (0%) | `artifactTypes` |
| `capabilities.md` | 25 | 21 (84%) | – |
| `conformance.md` | 49 | 26 (53%) | `production` |
| `connection-packs.md` | 8 | 5 (63%) | `connections` |
| `conversation.md` | 5 | 0 (0%) | `multiPartyConversation`, `conversationTurnModelProvenance`, `channelPresence` |
| `errors.md` | 18 | 14 (78%) | – |
| `events.md` | 63 | 37 (59%) | `supportedEnvelopes`, `schemaVersions`, `envelopeStrictness`, `envelopeContracts`, `envelopes`, `feedback`, `providerUsage`, `heartbeat` |
| `execution.md` | 34 | 0 (0%) | `selfHostedRunner`, `multiAgent`, `agents`, `subWorkflow` |
| `form-content-packs.md` | 11 | 1 (9%) | `forms` |
| `headers.md` | 6 | 0 (0%) | – |
| `host-services.md` | 85 | 4 (5%) | `prompts`, `secrets`, `modelCapabilities`, `aiProviders`, `memory`, `queueBus`, `scheduling`, `toolHooks`, `httpClient`, `aiEnvelope`, `promptLibrary`, `agentRuntime`, `workspace`, `mcp` |
| `i18n.md` | 17 | 0 (0%) | `i18n`, `content` |
| `idempotency.md` | 25 | 20 (80%) | `idempotency` |
| `identity.md` | 64 | 55 (86%) | `anonymousActor`, `authorization`, `auth` |
| `interop.md` | 54 | 41 (76%) | `a2a`, `mcp` |
| `interrupt.md` | 46 | 43 (93%) | `interrupt` |
| `node-pack-runtimes.md` | 3 | 0 (0%) | `nodePackRuntimes` |
| `oauth.md` | 13 | 11 (85%) | `credentials`, `oauth` |
| `overview.md` | 14 | 0 (0%) | – |
| `packs.md` | 35 | 20 (57%) | `uiPlugins`, `packs` |
| `persistence.md` | 35 | 25 (71%) | `eventLog` |
| `portability.md` | 8 | 0 (0%) | `portability` |
| `replay.md` | 36 | 19 (53%) | `replay`, `nondeterminismPolicy`, `eventLog` |
| `runs.md` | 70 | 65 (93%) | `limits`, `dataResidency`, `conversationPrimitive`, `deadLetter`, `budget`, `runList` |
| `security-defaults.md` | 27 | 19 (70%) | `purposePropagation`, `sandbox`, `compensation`, `auditLogIntegrity` |
| `storage.md` | 19 | 0 (0%) | `fs`, `kvStorage`, `tableStorage`, `sql`, `nosql`, `vectorStore`, `searchIndex`, `blobStorage`, `cache` |
| `tool-catalog.md` | 14 | 11 (79%) | `toolCatalog` |
| `versioning.md` | 40 | 33 (83%) | – |
| `webhooks.md` | 34 | 26 (76%) | `webhooks`, `triggerBridge` |
| `workflow-chain-packs.md` | 5 | 1 (20%) | `workflowChainPacks` |

## Largest uncited sections

Sections with the most obligation units and no major-2 citation. A doc-level citation (no §) does not count.

| Document § | Owner | Units |
| --- | --- | --- |
| `execution.md` § `multiAgent` | multiAgent | 19 |
| `host-services.md` § `aiProviders` | aiProviders | 15 |
| `events.md` § `envelopes` | envelopes | 13 |
| `host-services.md` § `memory` | memory | 12 |
| `packs.md` § Front-end plugin packs | packs | 9 |
| `conformance.md` § Production profile | production | 8 |
| `execution.md` § `selfHostedRunner` | selfHostedRunner | 8 |
| `webhooks.md` § Inbound triggers | webhooks | 8 |
| `host-services.md` § `secrets` | secrets | 7 |
| `host-services.md` § `httpClient` | httpClient | 7 |
| `host-services.md` § `workspace` | workspace | 7 |
| `identity.md` § 1.5 `anonymousActor` | anonymousActor | 7 |
| `interop.md` § MCP tasks and cancellation | shared | 7 |
| `host-services.md` § Library | prompts | 6 |
| `persistence.md` § Durable acceptance and recovery | eventLog | 6 |
| `portability.md` § Import rules | portability | 6 |
| `replay.md` § Determinism caveats (`replay` mode) | replay | 6 |
| `replay.md` § Divergence | replay | 6 |
| `artifact-type-packs.md` § Schema distribution | artifactTypes | 5 |
| `conformance.md` § Witness class | production | 5 |
| `events.md` § AI envelopes: E1–E5 | shared | 5 |
| `execution.md` § `subWorkflow` | subWorkflow | 5 |
| `form-content-packs.md` § Validation | forms | 5 |
| `host-services.md` § Composition | prompts | 5 |
| `host-services.md` § `queueBus` | queueBus | 5 |

## Citation gaps

These 19 major-2 scenarios cite no `spec/v2/core` document (only RFCs, schemas or the interop map). Whatever they witness is invisible to the section counts above; `v2-durability-recovery`, for one, witnesses `persistence.md` §Durable acceptance through RFC 0158 only.

`audit-anomaly-shape`, `audit-checkpoint-vectors`, `context-budget-transcript-bound`, `context-summarization-replay`, `otel-mcp-semconv-projection`, `v2-advertised-fixtures-exist`, `v2-agent-org-chart-served-shape`, `v2-auth-challenge`, `v2-content-locale-keys`, `v2-conversation-turn-parts`, `v2-durability-recovery`, `v2-ext-family-claims`, `v2-ext-rest-transport`, `v2-negotiation-authenticated`, `v2-negotiation-decided-emitted`, `v2-payload-seats-0186`, `v2-payload-vendor-hatch`, `v2-protected-resource-metadata`, `v2-webhook-message-id-stable`

33 major-2 citations name a v2 core section that matches no heading (most are `tool-catalog.md` §A–§F, RFC section letters):

- spec/v2/core/tool-catalog.md §B (6)
- spec/v2/core/tool-catalog.md §C (5)
- spec/v2/core/tool-catalog.md §compact (5)
- spec/v2/core/tool-catalog.md §D (5)
- spec/v2/core/interop.md §A2A multi-turn (3)
- spec/v2/core/interop.md §The floor (2)
- spec/v2/core/interop.md §The refresh SLA (2)
- spec/v2/core/replay.md §Determinism guarantees (1)
- spec/v2/core/tool-catalog.md §A (1)
- spec/v2/core/tool-catalog.md §C-1 (1)
- spec/v2/core/tool-catalog.md §C-1 / RFC 0069 (1)
- spec/v2/core/tool-catalog.md §F-2 (1)

## Top-20 risks

Ranked: security, tenant isolation, idempotency and replay first; then wire shape; then behaviour. Curated in `scripts/lib/v2-witness-risks.json`; the script re-checks each quote and section on every run.

| # | Family | Doc § | Class | Verdict | Proposed scenario |
| --- | --- | --- | --- | --- | --- |
| 1 | `kvStorage` | `storage.md` § Shared rules | tenant isolation | v1-only | `v2-storage-cross-tenant-isolation` |
| 2 | `memory` | `host-services.md` § `memory` | tenant isolation | v2-witnessed | `v2-memory-cross-tenant-isolation` |
| 3 | `workspace` | `host-services.md` § `workspace` | tenant isolation | v1-only | `v2-workspace-scope-from-identity` |
| 4 | `queueBus` | `host-services.md` § `queueBus` | tenant isolation | v1-only | `v2-queue-cross-tenant-isolation` |
| 5 | `secrets` | `host-services.md` § `secrets` | security | v1-only | `v2-secret-canary-absent` |
| 6 | `toolHooks` | `host-services.md` § `toolHooks` | security | v1-only | `v2-tool-authorization-fail-closed` |
| 7 | `anonymousActor` | `identity.md` § 1.5 `anonymousActor` | security | v2-witnessed | `v2-anonymous-actor-default-deny` |
| 8 | `selfHostedRunner` | `execution.md` § `selfHostedRunner` | security | v1-only | `v2-runner-subject-isolation` |
| 9 | `httpClient` | `host-services.md` § `httpClient` | security | v1-only | `v2-safefetch-ssrf-refused` |
| 10 | `fs` | `storage.md` § `fs` | security | v1-only | `v2-fs-sandbox-escape-refused` |
| 11 | `nosql` | `storage.md` § `sql` and `nosql` | security | unwitnessed | `v2-storage-injection-refused` |
| 12 | `portability` | `portability.md` § Import rules | security | v1-only | `v2-import-refuses-credential-literal` |
| 13 | `triggerBridge` | `webhooks.md` § Inbound triggers | security | v1-only | `v2-trigger-ingestion-verification` |
| 14 | `uiPlugins` | `packs.md` § Front-end plugin packs | security | v1-only | `v2-frontend-plugin-signature-required` |
| 15 | `replay` | `replay.md` § Determinism caveats (`replay` mode) | replay | v2-witnessed | `v2-replay-approver-eligibility-fixed` |
| 16 | `replay` | `replay.md` § Determinism caveats (`replay` mode) | replay | v2-witnessed | `v2-replay-interrupt-short-circuit` |
| 17 | `replay` | `replay.md` § Divergence | replay | v2-witnessed | `v2-replay-divergence-emitted` |
| 18 | `triggerBridge` | `webhooks.md` § Inbound triggers | idempotency | v1-only | `v2-trigger-dedup-prior-run` |
| 19 | – | `headers.md` § Request headers | wire shape | n/a | `v2-force-engine-version-production-refused` |
| 20 | `dataResidency` | `runs.md` § `dataResidency` | wire shape | v1-only | `v2-residency-honor-or-reject` |

### 1. Host storage leaks across tenants

- **Rule** (`storage.md` § Shared rules): "A read for one tenant MUST NOT return data another tenant wrote, even under an identical key or name"
- **Today:** Major 1 only: `kv-`, `table-`, `blob-` and `cache-cross-tenant-isolation` drive the v1 seam `POST /v1/host/sample/test/surface`. `vectorStore` and `searchIndex` have no isolation leg at any major. No v2 seam exists for host storage.
- **Why it matters:** One missing tenant prefix exposes every tenant's data. It covers six families and is the widest isolation rule in core.
- **Proposed:** `v2-storage-cross-tenant-isolation` (major 2; gate: each advertised storage family, plus a second-tenant credential (`OPENWOP_TEST_TENANT_B_API_KEY`) and a storage-probe fixture workflow). Asserts: per advertised family, a run under tenant A writes value V at key K, and a run under tenant B reading K on the run surface sees absent / `not_found`, never V.
- **Sabotage that must fail it:** key the store by name only (drop the tenant prefix): tenant B reads V and the leg fails.

### 2. Agent memory crosses tenants

- **Rule** (`host-services.md` § `memory`): "A ref MUST resolve to one tenant's entries, whatever the caller's permissions."
- **Today:** Major 1 only (`agentMemoryCrossTenantIsolation`, `memory-attribution-tenant-scoped`). The family is gated at major 2, but no major-2 scenario cites §`memory`.
- **Why it matters:** Memory holds conversation content and redacted secrets. A cross-tenant read is a direct data breach.
- **Proposed:** `v2-memory-cross-tenant-isolation` (major 2; gate: `memory` advertised, second-tenant credential, the cross-tenant memory fixture). Asserts: a run under tenant B given tenant A's `memoryRef` gets `[]` from `list` and `null` from `get`; a malformed ref (traversal, NUL, oversize) also gets `[]` / `null`.
- **Sabotage that must fail it:** resolve `memoryRef` without checking its tenant: B's run returns A's entry.

### 3. Workspace files cross scopes

- **Rule** (`host-services.md` § `workspace`): "MUST derive the scope from the authenticated identity and MUST NOT return or disclose another scope's file"
- **Today:** Major 1 only (`workspace-cross-tenant-isolation`, through the v1 seam `POST /v1/host/sample/workspace/op`). The v2 seams profile already mounts `/conformance/seams/workspace/files`.
- **Why it matters:** Agent workspace files are durable and shared across runs. Taking the scope from a request field instead of the identity lets any caller read any workspace.
- **Proposed:** `v2-workspace-scope-from-identity` (major 2; gate: `workspace` advertised, seams profile `openwop-conformance-seams-v2`, second-tenant credential). Asserts: a file written under tenant A through the v2 seam is `404` (or `403`) for tenant B by path and absent from B's list, even when B names A's workspace id in the request.
- **Sabotage that must fail it:** take `workspaceId` from the request body instead of the credential: B reads A's file.

### 4. Queue messages cross tenants

- **Rule** (`host-services.md` § `queueBus`): "A tenant's consumer MUST NOT receive another tenant's messages, even on the same topic."
- **Today:** Major 1 only (`queue-cross-tenant-isolation`, v1 seam).
- **Why it matters:** Topics are named by pack authors, so two tenants sharing a pack share topic names by default.
- **Proposed:** `v2-queue-cross-tenant-isolation` (major 2; gate: `queueBus` advertised, second-tenant credential, a queue-probe fixture workflow). Asserts: a message published under tenant A on topic T is never consumed by tenant B's consumer on T within the poll window, while A's own consumer receives it (the positive control).
- **Sabotage that must fail it:** name the physical queue by topic only: B consumes A's message.

### 5. Raw secrets reach events or logs

- **Rule** (`host-services.md` § `secrets`): "Raw key material MUST NOT appear in any event, log, trace, prompt, error, export or screenshot"
- **Today:** Major 1 only, and only on the envelope and OTel paths (`envelope-reasoning-secret-redaction`, `secret-leakage-otel-attribute`). Nothing at major 2 checks the event log, snapshot or error body.
- **Why it matters:** This is the BYOK boundary. One leaked provider key in an event log is replicated to every consumer and every fork.
- **Proposed:** `v2-secret-canary-absent` (major 2; gate: `secrets` advertised with `resolveInPack`, a canary-secret fixture workflow). Asserts: after a run that resolves a canary secret and then fails, the canary bytes appear nowhere in the event log, the snapshot, the SSE stream, the error envelope or a fork's log.
- **Sabotage that must fail it:** echo the resolved plaintext into `node.completed` outputs: the scan finds the canary.

### 6. A tool runs without its scopes

- **Rule** (`host-services.md` § `toolHooks`): "If one is missing or cannot be evaluated, it MUST NOT invoke, MUST emit `agent.toolReturned` with `status: forbidden`"
- **Today:** Major 1 only (`tool-hooks-authorization-fail-closed`, through the v1 tool-hooks seam).
- **Why it matters:** Per-tool authorization is the only check between an agent and an external side effect. Fail-open here turns a prompt injection into an action.
- **Proposed:** `v2-tool-authorization-fail-closed` (major 2; gate: `toolHooks.perToolAuthorization`, a fixture agent whose principal lacks one `requiredScopes` entry). Asserts: the tool is not invoked (the fixture receiver sees no call), the log carries `agent.toolReturned` `status: forbidden`, and the response is `403 forbidden` with `details.scope: "tool"`.
- **Sabotage that must fail it:** treat an unevaluable scope as granted: the receiver sees the call.

### 7. Anonymous callers gain a tool baseline

- **Rule** (`identity.md` § 1.5 `anonymousActor`): "A host MUST NOT resolve a role, scope or default tool baseline for it, or widen it within a session."
- **Today:** Six major-1 scenarios (`anonymous-actor-*`). The only major-2 gate is `v2-mcp-mount-map`, which skips when the family is advertised; no major-2 scenario cites §1.5.
- **Why it matters:** An anonymous subject reaches the public internet. Any default grant is a grant to everyone.
- **Proposed:** `v2-anonymous-actor-default-deny` (major 2; gate: `anonymousActor` advertised; seam-gated until a public-surface observation path is minted). Asserts: a call to a tool outside the surface allowlist is denied with `authorization.decided` `reason: anon-not-granted` and no dispatch; `listTools` for the subject equals the allowlist exactly.
- **Sabotage that must fail it:** merge the authenticated default toolset into the anonymous grant: the extra tool dispatches.

### 8. A step routes to another subject's runner

- **Rule** (`execution.md` § `selfHostedRunner`): "A host MUST NOT route a step to a runner its run's subject does not own, and MUST match on subject before capability."
- **Today:** Major 1 only (`self-hosted-runner`).
- **Why it matters:** A runner holds credentials the host cannot see. Mis-routing sends one user's prompt and tool arguments to another user's machine.
- **Proposed:** `v2-runner-subject-isolation` (major 2; gate: `selfHostedRunner` advertised, two harness runners registered under two subjects with identical `dispatchKinds`). Asserts: a run owned by subject A dispatches only to A's runner, and with A's runner gone fails `runner_unavailable` rather than using B's.
- **Sabotage that must fail it:** pick the first runner matching `dispatchKinds`: B's runner receives A's frame.

### 9. Egress reaches private addresses

- **Rule** (`host-services.md` § `httpClient`): "Before connecting it MUST resolve the target, reject loopback, RFC 1918, link-local and cloud-metadata addresses, and pin the resolved address for the connection"
- **Today:** Major 1 only, and only the advertisement (`http-client-ssrf` asserts `ssrfGuard: true`; the rejection is left to the host's own tests).
- **Why it matters:** SSRF to a cloud-metadata endpoint hands a pack the host's cloud credentials.
- **Proposed:** `v2-safefetch-ssrf-refused` (major 2; gate: `httpClient.safeFetch`, a fixture workflow that fetches a URL from its input). Asserts: fetches of `169.254.169.254`, `127.0.0.1`, `10.0.0.1` and a public hostname resolving to loopback each fail `egress_denied` with `reason: ssrf-blocked`, and no connection reaches a harness listener.
- **Sabotage that must fail it:** check the hostname string, not the resolved address: the loopback-resolving hostname connects.

### 10. Pack file access escapes the sandbox root

- **Rule** (`storage.md` § `fs`): "A path that escapes the root, whether absolute, through `..` segments or through a symlink, MUST be refused."
- **Today:** Major 1 only (`fs-path-traversal`, v1 seam `POST /v1/host/sample/fs/read`).
- **Why it matters:** Path traversal from pack code reads host configuration and credentials.
- **Proposed:** `v2-fs-sandbox-escape-refused` (major 2; gate: `fs` advertised, an fs-probe fixture workflow). Asserts: reads of an absolute path, a `../` path and a symlink out of `sandboxRoot` each fail `forbidden` with `details.reason: path-outside-sandbox`; a read inside the root succeeds.
- **Sabotage that must fail it:** normalise `..` but follow symlinks: the symlink read succeeds.

### 11. Query injection through host storage

- **Rule** (`storage.md` § `sql` and `nosql`): "`nosql` filter operators MUST NOT permit injection. Server-side script evaluation, such as MongoDB `$where`, MUST be refused unless an explicit allowlist is configured."
- **Today:** `sql` has a major-1 leg (`sql-injection-rejection`); `nosql` has no leg at any major.
- **Why it matters:** Operator injection bypasses tenant filters and reads every document in a collection.
- **Proposed:** `v2-storage-injection-refused` (major 2; gate: `sql` or `nosql` advertised, a query-probe fixture workflow). Asserts: a `nosql` filter carrying `$where` is refused `forbidden`; a `sql` query whose user value holds `' OR 1=1 --` returns only the bound row.
- **Sabotage that must fail it:** pass filter objects to the driver unvalidated: `$where` executes.

### 12. An import carries credential values

- **Rule** (`portability.md` § Import rules): "A host MUST reject with `422` an imported bundle whose payload carries a literal credential value."
- **Today:** Major 1 only (`export-bundle-portability`, v1 seam `/v1/host/sample/import`).
- **Why it matters:** An export bundle crosses tenants and hosts by design. Accepting literal credentials launders secrets across that boundary.
- **Proposed:** `v2-import-refuses-credential-literal` (major 2; gate: `portability.import`). Asserts: a dry-run and a real import of a bundle whose `connection-ref` carries a literal token each answer `422`, and the dry run writes nothing (a follow-up read finds no created entity).
- **Sabotage that must fail it:** strip unknown fields instead of refusing: the import returns `200`.

### 13. Unverified inbound events start runs

- **Rule** (`webhooks.md` § Inbound triggers): "MUST verify per `verification` before delivery; a failed `required` check dead-letters with reason `signature-invalid`"
- **Today:** Major 1 only (`trigger-ingestion`, `trigger-bridge-delivery`). The section is attributed to `webhooks` by document name; its obligations belong to `triggerBridge`.
- **Why it matters:** An unsigned inbound event that starts a run lets anyone on the internet trigger workflows with chosen input.
- **Proposed:** `v2-trigger-ingestion-verification` (major 2; gate: `triggerBridge.ingestion` with a `required` verification source). Asserts: an event with a bad signature starts no run and lands in dead-letter with `signature-invalid`; the same event correctly signed starts exactly one run.
- **Sabotage that must fail it:** log the verification failure and deliver anyway: a run starts.

### 14. Front-end plugins load unsigned

- **Rule** (`packs.md` § Front-end plugin packs): "MUST verify the pack signature before loading, failing closed"
- **Today:** Major 1 only (`frontend-plugin-packs`). The v2 seams profile already serves test packs with `.sig` files under `/conformance/seams/packs-test/`.
- **Why it matters:** A plugin bundle runs in the user's browser next to the host UI. An unsigned bundle is arbitrary script.
- **Proposed:** `v2-frontend-plugin-signature-required` (major 2; gate: `uiPlugins` advertised, seams profile (packs-test registry)). Asserts: installing a `frontend-plugin` pack with a tampered `.sig` is refused and the pack never appears as installed; the correctly signed pack installs.
- **Sabotage that must fail it:** skip verification when the signature file is missing or unreadable: the tampered pack installs.

### 15. Replay re-resolves approver membership

- **Rule** (`replay.md` § Determinism caveats (`replay` mode)): "Approver eligibility recorded on a resume event is fixed history; a host MUST NOT re-resolve membership during replay."
- **Today:** No witness at any major. `v2-approver-enforced` checks live enforcement, not replay.
- **Why it matters:** A replay that re-checks membership against today's roster rewrites who approved what, and breaks audit.
- **Proposed:** `v2-replay-approver-eligibility-fixed` (major 2; gate: `replay` modes include `replay`, `interrupt` approval, a second-tenant or second-subject credential). Asserts: a run approved by subject S, then replayed after S loses membership, completes identically and re-emits the recorded resolution.
- **Sabotage that must fail it:** re-run the eligibility check on replay: the replay parks or fails.

### 16. Replay raises a fresh interrupt

- **Rule** (`replay.md` § Determinism caveats (`replay` mode)): "`ctx.interrupt(K)` MUST short-circuit to the persisted `interrupt.resolved`, raising no new `interrupt.requested`."
- **Today:** No major-2 witness. The section has no major-2 citation.
- **Why it matters:** A replay that re-asks a human repeats approvals and can take a different branch than the source.
- **Proposed:** `v2-replay-interrupt-short-circuit` (major 2; gate: `replay` modes include `replay`, `interrupt` advertised). Asserts: replaying a resolved approval run emits no `interrupt.requested` after the fork point, reaches the same terminal and carries the source's resolve value.
- **Sabotage that must fail it:** re-execute `ctx.interrupt` on replay: the run parks in `waiting-approval`.

### 17. Replay divergence goes unreported

- **Rule** (`replay.md` § Divergence): "MUST emit `replay.diverged` `{ originalEventId, replayEventId, divergencePoint }`;"
- **Today:** No scenario at any major asserts `replay.diverged`. Only its refusal variant has a major-1 leg (`replay-divergence-at-refusal`).
- **Why it matters:** Divergence is how a replay user learns the replay is not the source run. Silent divergence makes replay evidence worthless.
- **Proposed:** `v2-replay-divergence-emitted` (major 2; gate: `replay` modes include `replay`, the mock-AI seam (a scripted response that differs on replay)). Asserts: the replay continues, emits `replay.diverged` naming both event ids and a `divergencePoint`, and reaches a terminal.
- **Sabotage that must fail it:** substitute the recorded output silently: no `replay.diverged` appears.

### 18. Inbound dedup starts a second run

- **Rule** (`webhooks.md` § Inbound triggers): "with `dedup`, MUST answer a `dedupKey` repeated within retention (at least 24 hours) with the prior `runId`;"
- **Today:** Major 1 only (`trigger-bridge-delivery`).
- **Why it matters:** Sources redeliver. Without dedup one upstream event runs a workflow, and its side effects, twice.
- **Proposed:** `v2-trigger-dedup-prior-run` (major 2; gate: `triggerBridge.dedup`). Asserts: two deliveries with the same `dedupKey` yield one run, and the second answer carries the first `runId`.
- **Sabotage that must fail it:** dedup in memory only and restart between deliveries (or skip dedup): a second run starts.

### 19. Production keys can force the engine version

- **Rule** (`headers.md` § Request headers): "Servers MUST reject it on production API keys with `403 force_engine_version_forbidden`."
- **Today:** No family: `headers.md` homes none. `version-fold` (major 1) holds one API key and cannot tell a production key from a test key, so the refusal is never exercised.
- **Why it matters:** Forcing an old engine version on production traffic reopens fixed behaviour on live runs.
- **Proposed:** `v2-force-engine-version-production-refused` (major 2; gate: a production-class key supplied to the harness (new env, e.g. `OPENWOP_TEST_PRODUCTION_API_KEY`)). Asserts: `POST /runs` with `OpenWOP-Force-Engine-Version` on the production key answers `403 force_engine_version_forbidden` and creates no run.
- **Sabotage that must fail it:** honour the header on any key: the run is created.

### 20. Residency constraints are accepted and ignored

- **Rule** (`runs.md` § `dataResidency`): "A host advertising `dataResidency` MUST honor-or-reject, and MUST NOT silently accept-and-ignore:"
- **Today:** Major 1 only (`data-residency-admission`).
- **Why it matters:** A silently ignored residency constraint puts regulated data in the wrong jurisdiction while the client believes otherwise.
- **Proposed:** `v2-residency-honor-or-reject` (major 2; gate: `dataResidency` advertised). Asserts: a run naming a region outside `dataResidency.regions` is refused `residency_unavailable`; one naming an advertised region is accepted.
- **Sabotage that must fail it:** drop the `residency` field during validation: the unadvertised region is accepted.

## Re-run

```sh
node scripts/report-v2-witness-coverage.mjs          # table + JSON summary
node scripts/report-v2-witness-coverage.mjs --write  # regenerate this file
```

## JSON summary

```json
{
  "families": {
    "total": 73,
    "v2-witnessed": 31,
    "v1-only": 38,
    "unwitnessed": 4
  },
  "byWitnessClass": {
    "claims-check": {
      "v2-witnessed": 6,
      "v1-only": 4,
      "unwitnessed": 4
    },
    "seam-gated": {
      "v2-witnessed": 5,
      "v1-only": 0,
      "unwitnessed": 0
    },
    "witnessable-gated": {
      "v2-witnessed": 20,
      "v1-only": 34,
      "unwitnessed": 0
    }
  },
  "obligationUnits": {
    "total": 873,
    "inV2CitedSections": 497,
    "inUncitedSections": 376,
    "sectionsWithObligations": 266,
    "sectionsWithNoV2Citation": 117
  },
  "declarationLinks": {
    "familiesWithFloorScenarios": 0,
    "familiesWithRequirementIds": 0
  },
  "scenarios": {
    "registered": 574,
    "major2": 137
  },
  "unresolvedV2Citations": 33,
  "major2ScenariosCitingNoCoreDoc": 19,
  "risks": {
    "listed": 20,
    "staleQuotes": [],
    "sectionsNowCited": []
  }
}
```

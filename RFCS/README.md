# OpenWOP RFCs

This directory holds **Requests for Comments** — the public design record for normative changes to the openwop protocol.

## When you need an RFC

Per `GOVERNANCE.md` §"Spec change process":

| Change                                                                                                              | RFC required?                       |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Editorial: typos, prose clarifications, link fixes                                                                  | No — direct PR                      |
| Non-normative: new examples, optional reference notes                                                               | No — direct PR with CHANGELOG entry |
| **Normative addition (backward-compatible)**: new optional fields, new SHOULD recommendations, additive event types | **Yes**                             |
| **Breaking change**: anything that invalidates an existing v1 conformance pass                                      | **Yes** — also requires a v2 plan   |

Refactors that don't touch wire shapes don't need an RFC. When in doubt, file an RFC and ask in the issue thread.

## Process

1. **Draft.** Copy `0000-template.md` to `RFCS/NNNN-short-title.md` (use the next free number; check `git log` if uncertain). Author against the template; the `Status` field starts at `Draft`.
2. **Open a pull request.** Title: `RFC NNNN: <title>`. The PR is the comment thread.
3. **Comment window.** A normative-addition RFC has a **7-day** comment window after the PR is marked ready for review. A breaking-change RFC has a **30-day** window.
4. **Decision.** Per `GOVERNANCE.md`: lazy consensus by default; two maintainer approvals required for normative changes; two maintainer approvals from different organizations for breaking changes (once the maintainer set has multiple orgs represented).
5. **Status flip.** Maintainer flips `Status` to `Active` (accepted, not yet implemented) on merge, then to `Accepted` once the implementation lands and the conformance suite reflects it. RFCs that are abandoned move to `Withdrawn`. RFCs that are replaced move to `Superseded` with a forward pointer.

## Status states

| Status       | Meaning                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `Draft`      | Proposal under active discussion. Wire shapes may shift.                                                          |
| `Active`     | Accepted by maintainers; implementation pending. Wire shapes are locked unless the RFC explicitly says otherwise. |
| `Accepted`   | Implemented and reflected in the spec corpus + conformance suite (where applicable).                              |
| `Withdrawn`  | Author or maintainers withdrew. Reasons recorded in the RFC's PR thread.                                          |
| `Superseded` | Replaced by a later RFC. The successor's number is in the RFC header.                                             |

### Parked Drafts

A `Draft` that is **deliberately idle** — authored ahead of an external precondition rather than abandoned — is annotated **Parked**: the header `Status` reads `` `Draft` (**Parked**) `` and the `Updated` field names the tripwire that un-parks it. Parked is an annotation, not a status state: the RFC stays `Draft` for counting purposes, and it never moves to `Withdrawn` while its tripwire is live. Example: [RFC 0038](./0038-working-group-charter.md) (working-group charter), parked until the `GOVERNANCE.md` §"Path to working group" tripwires fire.

### "Amended by" header field

When a later RFC amends an earlier one (an erratum, a rename, a real-world-adoption adjustment), the **earlier** RFC's header gains an `**Amended by**` row containing a forward pointer to the amending RFC plus a one-line summary of the amendment. This keeps the audit trail bidirectional: the amending RFC already names its target in its title/`Affects`; the forward pointer means a reader landing on the original is never working from silently-amended text. Examples: [RFC 0071](./0071-artifact-type-and-chat-card-packs.md) (amended by RFC 0075), [RFC 0021](./0021-ai-envelope-primitive.md) (amended by RFC 0033's error-code rename).

## Companion gap & risk registers

The RFC-authoring workflow produces two companion registers alongside substantial RFCs: `registers/<nnnn>-<slug>.gaps.md` (open design gaps discovered during authoring, each with an owner/disposition) and `registers/<nnnn>-<slug>.risks.md` (identified risks with severity and mitigation). Both live in [`RFCS/registers/`](./registers/), keyed to the RFC number.

The registers are working documents, not normative text — but they gate promotion: **a status flip to `Accepted` requires a register sweep**. Every open row must be closed, transferred to a tracked surface (a follow-up RFC, a `ROADMAP.md` line, a `docs/KNOWN-LIMITS.md` entry), or explicitly carried forward as a named open gap in the RFC's "Open spec gaps" / "Unresolved questions" section. An `Accepted` RFC with silently-open register rows is a process violation.

## Numbering

RFCs are numbered sequentially from `0001`. `0000-template.md` is reserved as the authoring template and is never assigned. Numbers are not reused; a withdrawn RFC keeps its number.

## What the RFC must include

Every RFC follows `0000-template.md` and must answer:

- **Summary.** One paragraph the maintainers can read in 30 seconds.
- **Motivation.** What problem is this solving? Who hits it?
- **Proposal.** The actual change. Wire shapes, schema diffs, prose edits.
- **Compatibility.** Is this additive, breaking, or behavior-only? Trace against `COMPATIBILITY.md`.
- **Conformance.** Which scenarios test this? Are new scenarios needed?
- **Alternatives considered.** What was rejected and why.
- **Unresolved questions.** What needs decision before implementation.

## Status index

<!-- Hand-generated 2026-06-11 from each RFC's header `Status` field. TODO: this table should be emitted by `scripts/generate-protocol-status.mjs` (which already derives these statuses for docs/PROTOCOL-STATUS.md) instead of being hand-maintained. -->

Current tally: **Accepted 98 · Active 3 · Draft 2** (103 RFCs, excluding the `0000` template; Active = 0035, 0043, 0100; Draft = 0038 Parked, 0101 Parked).

| RFC                                                                  | Title                                                                                                                                | Status               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| [0001](./0001-rfc-process.md)                                        | The RFC Process                                                                                                                      | `Accepted`           |
| [0002](./0002-agent-identity-and-reasoning-events.md)                | Agent Identity and Reasoning Events                                                                                                  | `Accepted`           |
| [0003](./0003-agent-packs.md)                                        | Agent Packs                                                                                                                          | `Accepted`           |
| [0004](./0004-memory-layer.md)                                       | Memory Layer                                                                                                                         | `Accepted`           |
| [0005](./0005-conversation.md)                                       | Multi-Turn Conversation                                                                                                              | `Accepted`           |
| [0006](./0006-orchestrator.md)                                       | Run Orchestrator                                                                                                                     | `Accepted`           |
| [0007](./0007-dispatch.md)                                           | Dispatch (`core.dispatch` Node Pattern)                                                                                              | `Accepted`           |
| [0008](./0008-wasm-abi.md)                                           | WASM ABI for Cross-Language Node Packs                                                                                               | `Accepted`           |
| [0009](./0009-production-profile-conformance.md)                     | Production-Profile Conformance                                                                                                       | `Accepted`           |
| [0010](./0010-auth-profile-conformance.md)                           | Auth-Profile Conformance                                                                                                             | `Accepted`           |
| [0011](./0011-auth-scoped-discovery.md)                              | Auth-Scoped Discovery Advertisement                                                                                                  | `Accepted`           |
| [0012](./0012-memory-compaction-profile.md)                          | Memory Compaction Profile                                                                                                            | `Accepted`           |
| [0013](./0013-workflow-chain-packs.md)                               | Workflow-chain packs                                                                                                                 | `Accepted`           |
| [0014](./0014-host-fs-capability.md)                                 | host.fs capability                                                                                                                   | `Accepted`           |
| [0015](./0015-host-kv-storage-capability.md)                         | host.kvStorage capability                                                                                                            | `Accepted`           |
| [0016](./0016-host-table-storage-capability.md)                      | host.tableStorage capability                                                                                                         | `Accepted`           |
| [0017](./0017-host-queue-bus-capability.md)                          | host.queueBus capability                                                                                                             | `Accepted`           |
| [0018](./0018-host-sql-vector-search-capability.md)                  | host.sql + host.vectorStore + host.searchIndex capabilities                                                                          | `Accepted`           |
| [0019](./0019-host-blob-cache-capability.md)                         | host.blobStorage + host.cache capabilities                                                                                           | `Accepted`           |
| [0020](./0020-host-mcp-server-composition.md)                        | host-side MCP server composition                                                                                                     | `Accepted`           |
| [0021](./0021-ai-envelope-primitive.md)                              | AI Envelope Primitive                                                                                                                | `Accepted`           |
| [0022](./0022-dispatch-input-output-mapping.md)                      | `core.dispatch` + `core.subWorkflow` runtime variable mapping                                                                        | `Accepted`           |
| [0023](./0023-conformance-agent-event-emitters.md)                   | Conformance Agent-Event Emitters                                                                                                     | `Accepted`           |
| [0024](./0024-agent-reasoning-streaming.md)                          | Streaming `agent.reasoned` Deltas                                                                                                    | `Accepted`           |
| [0025](./0025-test-mode-registry-namespace.md)                       | Test-mode Registry Namespace                                                                                                         | `Accepted`           |
| [0026](./0026-provider-usage-event.md)                               | `provider.usage` Event                                                                                                               | `Accepted`           |
| [0027](./0027-prompt-templates.md)                                   | Prompt Templates                                                                                                                     | `Accepted`           |
| [0028](./0028-prompt-library-endpoints.md)                           | Prompt Library Endpoints + Prompt Pack Kind                                                                                          | `Accepted`           |
| [0029](./0029-prompt-override-hierarchy.md)                          | Prompt Override Hierarchy + `agent.promptResolved` event                                                                             | `Accepted`           |
| [0030](./0030-envelope-reasoning-and-tier-one-subset.md)             | Envelope `reasoning` field + Tier 1 Structured-Output Subset (informative)                                                           | `Accepted`           |
| [0031](./0031-envelope-variants-and-model-capabilities.md)           | Envelope variant discrimination + model-capability declarations                                                                      | `Accepted`           |
| [0032](./0032-envelope-reliability-events.md)                        | Envelope-reliability run-event vocabulary                                                                                            | `Accepted`           |
| [0033](./0033-envelope-completion-contract.md)                       | Envelope-completion contract (truncation vs schema-violation distinction)                                                            | `Accepted`           |
| [0034](./0034-otel-collector-test-seam.md)                           | OTel collector test seam + secret-leakage invariant promotion                                                                        | `Accepted`           |
| [0035](./0035-sandbox-execution-contract.md)                         | Sandbox execution contract for pack-loaded typeIds                                                                                   | `Active`             |
| [0036](./0036-multi-region-and-cross-engine-guarantees.md)           | Multi-region idempotency + cross-engine append-ordering guarantees                                                                   | `Accepted`           |
| [0037](./0037-multi-agent-execution-model.md)                        | Multi-agent execution model + replay determinism under nondeterministic models                                                       | `Accepted`           |
| [0038](./0038-working-group-charter.md)                              | OpenWOP Working Group charter                                                                                                        | `Draft` (**Parked**) |
| [0039](./0039-multi-agent-confidence-and-memory-lifecycle.md)        | Multi-agent execution model `version: 2` — confidence-threshold escalation + agent memory lifecycle                                  | `Accepted`           |
| [0040](./0040-multi-agent-cross-host-causation.md)                   | Multi-agent execution model `version: 3` — cross-host causation linking                                                              | `Accepted`           |
| [0041](./0041-multi-agent-replay-under-nondeterminism.md)            | Multi-agent execution model `version: 4` — replay determinism under nondeterministic models                                          | `Accepted`           |
| [0042](./0042-experimental-capability-tier.md)                       | Experimental capability tier                                                                                                         | `Accepted`           |
| [0043](./0043-registry-and-extension-policy.md)                      | Registry and extension-policy                                                                                                        | `Active`             |
| [0044](./0044-confidence-escalation-interrupt-kind-advertisement.md) | Confidence-escalation interrupt-kind advertisement (clarification to RFC 0039 §A)                                                    | `Accepted`           |
| [0045](./0045-connector-pack-manifest-action-model.md)               | Connector pack manifest & action model                                                                                               | `Accepted`           |
| [0046](./0046-host-credentials-capability.md)                        | host.credentials capability — credential vault, encryption, sharing & rotation                                                       | `Accepted`           |
| [0047](./0047-host-oauth-connector-flows.md)                         | host.oauth — OAuth 2.0 authorization flows for connectors                                                                            | `Accepted`           |
| [0048](./0048-tenant-workspace-principal-identity-model.md)          | Tenant · Workspace · Principal identity model                                                                                        | `Accepted`           |
| [0049](./0049-rbac-scopes-and-authorization-decisions.md)            | RBAC scopes & authorization decisions                                                                                                | `Accepted`           |
| [0050](./0050-saml-scim-enterprise-identity-profiles.md)             | SAML / SCIM (and optional LDAP) enterprise identity profiles                                                                         | `Accepted`           |
| [0051](./0051-approval-deployment-gate-primitive.md)                 | Approval & deployment-gate primitive                                                                                                 | `Accepted`           |
| [0052](./0052-scheduling-and-time-based-triggers.md)                 | Scheduling & time-based triggers (promote + extend RFC 0017)                                                                         | `Accepted`           |
| [0053](./0053-dead-letter-routing-and-failure-sinks.md)              | Dead-letter routing & failure sinks                                                                                                  | `Accepted`           |
| [0054](./0054-run-diff-and-execution-comparison.md)                  | Run diff & execution comparison                                                                                                      | `Accepted`           |
| [0055](./0055-multimodal-envelope-variants-and-rendering-hints.md)   | Multimodal envelope variants & rendering hints (extend RFC 0031)                                                                     | `Accepted`           |
| [0056](./0056-run-feedback-and-annotation-event.md)                  | Run feedback & annotation event (`run.annotated`)                                                                                    | `Accepted`           |
| [0057](./0057-memory-write-attribution-event.md)                     | Memory write-attribution event (`memory.written`)                                                                                    | `Accepted`           |
| [0058](./0058-run-execution-bounds.md)                               | Run execution bounds (`runTimeoutMs` + `maxLoopIterations`)                                                                          | `Accepted`           |
| [0059](./0059-agent-workspace.md)                                    | Agent workspace (`host.workspace`)                                                                                                   | `Accepted`           |
| [0060](./0060-host-heartbeat-capability.md)                          | Host heartbeat capability (`host.heartbeat`)                                                                                         | `Accepted`           |
| [0061](./0061-agent-loop-lifecycle.md)                               | Stateful agent-loop lifecycle (`multiAgent.executionModel.version: 5`)                                                               | `Accepted`           |
| [0062](./0062-scheduled-memory-distillation.md)                      | Scheduled memory distillation — "dreams" (`memory.distillation`)                                                                     | `Accepted`           |
| [0063](./0063-subrun-output-attestation-and-merge-gating.md)         | Sub-run output attestation & merge gating (`core.subWorkflow.outputAttestation`)                                                     | `Accepted`           |
| [0064](./0064-tool-invocation-hooks-and-authorization.md)            | Tool invocation hooks & per-tool authorization (`host.toolHooks`)                                                                    | `Accepted`           |
| [0065](./0065-workflow-node-primary-output-annotation.md)            | Workflow node primary-output annotation                                                                                              | `Accepted`           |
| [0066](./0066-x-openwop-form-vendor-extension.md)                    | `x-openwop-form` Vendor Extension on Pack `configSchema`                                                                             | `Accepted`           |
| [0067](./0067-provider-catalog-conventions.md)                       | Provider-catalog conventions — provider-name vocabulary + BYOK auth-mode advertisement                                               | `Accepted`           |
| [0068](./0068-memory-consolidation-and-standing-commitments.md)      | Memory consolidation + standing commitments                                                                                          | `Accepted`           |
| [0069](./0069-exec-class-tool-host-extension-safety-contract.md)     | Host-extension safety contract for `exec`-class tools                                                                                | `Accepted`           |
| [0070](./0070-agent-manifest-runtime.md)                             | Agent Manifest Runtime Capability (`agents.manifestRuntime`)                                                                         | `Accepted`           |
| [0071](./0071-artifact-type-and-chat-card-packs.md)                  | Artifact-Type Packs and AI Chat Card Packs                                                                                           | `Accepted`           |
| [0072](./0072-agent-inventory-and-dispatch.md)                       | Agent Inventory + Dispatch Normative Surface (amends RFC 0070)                                                                       | `Accepted`           |
| [0073](./0073-capability-document-root-layout.md)                    | Capability families are document-root properties of `/.well-known/openwop`                                                           | `Accepted`           |
| [0074](./0074-tenant-scoped-agent-inventory.md)                      | Tenant-Scoped Manifest-Agent Inventory (amends RFC 0072)                                                                             | `Accepted`           |
| [0075](./0075-artifact-type-packs-realworld-amendment.md)            | Artifact-Type Packs — real-world adoption amendment (RFC 0071 Phase-1.1 erratum)                                                     | `Accepted`           |
| [0076](./0076-pack-runtime-requirements-and-host-safe-fetch.md)      | Pack runtime-requirements declaration + host-provided safe-fetch                                                                     | `Accepted`           |
| [0077](./0077-agent-run-lifecycle-and-live-manifest-dispatch.md)     | Agent Run Lifecycle + Live Manifest Dispatch                                                                                         | `Accepted`           |
| [0078](./0078-portable-tool-catalog-and-tool-session-contract.md)    | Portable Tool Catalog + Tool Session Contract                                                                                        | `Accepted`           |
| [0079](./0079-credential-provenance-and-egress-policy.md)            | Credential Provenance + Egress Policy                                                                                                | `Accepted`           |
| [0080](./0080-agent-memory-capability-reconciliation.md)             | Agent Memory Capability Reconciliation                                                                                               | `Accepted`           |
| [0081](./0081-agent-evaluation-and-scorecards.md)                    | Agent Evaluation, Scorecards, and Promotion Gates                                                                                    | `Accepted`           |
| [0082](./0082-agent-deployment-lifecycle.md)                         | Agent Deployment Lifecycle                                                                                                           | `Accepted`           |
| [0083](./0083-durable-trigger-and-channel-bridge-profile.md)         | Durable Trigger + Channel Bridge Profile                                                                                             | `Accepted`           |
| [0084](./0084-budget-quota-and-cost-policy.md)                       | Budget, Quota, and Cost Policy                                                                                                       | `Accepted`           |
| [0085](./0085-agent-platform-meta-profile.md)                        | `openwop-agent-platform` Meta-Profile                                                                                                | `Accepted`           |
| [0086](./0086-standing-agent-roster-and-workflow-portfolio.md)       | Standing Agent Roster + Workflow Portfolio                                                                                           | `Accepted`           |
| [0087](./0087-agent-org-chart.md)                                    | Agent Org-Chart                                                                                                                      | `Accepted`           |
| [0088](./0088-core-standard-profile.md)                              | `openwop-core-standard` — the stable Core Standard Profile                                                                           | `Accepted`           |
| [0089](./0089-conformance-certification-bundle.md)                   | Conformance certification bundle — machine-readable per-profile evidence                                                             | `Accepted`           |
| [0090](./0090-agent-verifier-and-convergence.md)                     | Agent verifier turn + convergence criteria (multi-agent execution `version: 6`)                                                      | `Accepted`           |
| [0091](./0091-multimodal-perception-input.md)                        | Multimodal perception input on `ctx.callAI` (typed content parts)                                                                    | `Accepted`           |
| [0092](./0092-agent-capability-requirements.md)                      | Agent-level capability requirements (`AgentManifest.requiresCapabilities`)                                                           | `Accepted`           |
| [0093](./0093-protocol-hardening-webhooks-tokens-idempotency.md)     | Protocol hardening — webhook delivery egress, interrupt-token lifecycle, retryable-response caching, approval-gate timeout semantics | `Active`             |
| [0094](./0094-wire-shape-reconciliation.md)                          | Wire-shape reconciliation — schema/prose defect repairs and forward-compat closure policy                                            | `Active`             |
| [0096](./0096-reviewable-learning-skill-proposal-lifecycle.md)       | Reviewable learning — skill/automation proposal lifecycle (inert drafts, RFC 0051-gated activation)                                  | `Accepted`           |
| [0097](./0097-standing-goals-and-judge-based-continuation.md)        | Standing goals — judge-based (RFC 0090) completion + bounded continuation                                                            | `Accepted`           |
| [0098](./0098-agent-platform-portability-export-bundle-and-import.md) | Agent-platform portability — export bundle + tenant import (refs-only, dry-run, idempotent)                                          | `Accepted`           |
| [0099](./0099-external-event-trigger-ingestion.md)                   | External-event trigger ingestion — webhook/email/form sources start a run (extends RFC 0083; `TriggerEvent` envelope + registration contract + SSRF/replay safety) | `Accepted`             |
| [0100](./0100-async-durable-a2a-tasks.md)                            | Async / durable A2A tasks — durable Task persistence + `tasks/resubscribe` + push for cross-host handoffs (extends `a2a-integration.md`; new `a2a` capability slot) | `Active`             |
| [0101](./0101-multi-party-group-conversation.md)                   | Multi-party group conversation — shared transcript + speaker attribution (Parked)                                                                                  | `Draft`              |
| [0102](./0102-a2ui-agent-authored-interface-surfaces.md)             | A2UI agent-authored interface surfaces — declarative cross-trust-boundary UI as a **core, advertised** `ui.a2ui-surface` envelope kind beside `media.*` (extends RFC 0055; closed `anyOf` surface, enumerated catalog, actions confined to interrupt-resume/exchange)                                | `Accepted`           |
| [0103](./0103-localized-content-surface.md)                          | Localized content surface — durable authored content (pages → sections; section = base `data` + sparse `localizations` map) reusing the Stable `i18n.md` annex's `Accept-Language`/`Content-Language` negotiation; new capability-gated `content` block (⊆ `i18n.supportedLocales`) + per-section field merge | `Accepted`           |

## See also

- `GOVERNANCE.md` — decision rules, maintainer roles, the broader spec change process.
- `COMPATIBILITY.md` — what counts as additive vs breaking.
- `MAINTAINERS.md` — current maintainer set.
- `CONTRIBUTING.md` — per-artifact rules (schemas, OpenAPI, conformance, SDK).

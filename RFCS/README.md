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

### Parked RFCs

An RFC that is **deliberately idle** — waiting on an external precondition rather than on unfinished work here — is annotated **Parked**: the header `Status` reads `` `Draft` (**Parked**) `` or `` `Active` (**Parked**) ``, and the `Updated` field **MUST name the tripwire that un-parks it**. Parked is an annotation, not a status state: the RFC keeps its underlying status for counting purposes, and it never moves to `Withdrawn` while its tripwire is live.

**Why the annotation exists.** From an index, an RFC blocked on the world and an RFC blocked on somebody's unfinished work **look identical** — and the corpus has now been wrong in both directions on exactly that. RFC 0038 was parked on an external tripwire while three of its acceptance criteria were plain repository work nobody had done; RFC 0121 sits on an unresolved legal question and kept re-reading as an open action item. **A reader cannot tell whether the maintainer is behind or the world is, and those call for opposite responses.**

The annotation applies to both non-terminal states:

| Status | What Parked means there |
| --- | --- |
| `Draft` (**Parked**) | Authored ahead of a precondition rather than abandoned. The wire shape may still move. |
| `Active` (**Parked**) | Wire shape locked and repository work complete; `Accepted` waits on a **named external condition** — a non-steward adopter, a second maintainer organization, a legal clearance, a host capability nobody has built. |

**Three rules keep the annotation honest:**

1. **A Parked RFC MUST name a falsifiable tripwire** in `Updated` — a condition someone could check and declare met. "Needs more adoption" is not a tripwire; "a non-steward host advertising `capabilities.sandbox` passes the §B probes" is. `rfc-lifecycle-coherence.test.ts` enforces this.
2. **Parked is never a substitute for `Accepted`.** It records *why* an RFC has not graduated; it does not graduate it, confer any claim, or license an advertisement. An `Active` (**Parked**) RFC is exactly as unimplemented as an `Active` one.
3. **Parking an RFC that still has repository work is a misuse** — and the one the corpus has actually committed. Before annotating, walk the acceptance criteria and finish anything that needs no external party.

**What this buys:** the status index can state how many RFCs await *repository work*, separately from how many await *the world*. Those are different numbers, and only the first is anyone here's to move.

Examples: [RFC 0038](./0038-working-group-charter.md) (`Draft`, parked until the `GOVERNANCE.md` §"Path to working group" tripwires fire), [RFC 0035](./0035-sandbox-execution-contract.md) (`Active`, parked on a non-steward host running untrusted packs in real isolation), [RFC 0111](./0111-context-economy.md) (`Active`, parked on a host running real orchestrator-loop model turns), [RFC 0121](./0121-subscription-provider-auth.md) (`Active`, parked on a steward hold pending UQ1 legal clearance).

### "Amended by" header field

When a later RFC amends an earlier one (an erratum, a rename, a real-world-adoption adjustment), the **earlier** RFC's header gains an `**Amended by**` row containing a forward pointer to the amending RFC plus a one-line summary of the amendment. This keeps the audit trail bidirectional: the amending RFC already names its target in its title/`Affects`; the forward pointer means a reader landing on the original is never working from silently-amended text. Examples: [RFC 0071](./0071-artifact-type-and-chat-card-packs.md) (amended by RFC 0075), [RFC 0021](./0021-ai-envelope-primitive.md) (amended by RFC 0033's error-code rename).

### When a correction needs a new number, and when it does not

*(Added 2026-08-19.)* The `Amended by` mechanism above assumes the amendment is
itself an RFC. Applied to every correction, that mints a number for changes that
decide nothing — and the count stops carrying information. An implementer
estimating the cost of a conforming host reads "213 RFCs" as 213 decisions.

**Amend in place, no new number, when the change:**

- corrects text that misstates a decision the RFC already made (a stale line, a
  wrong citation, a contradiction between two of its own sections);
- narrows or clarifies without changing what a conforming host must do; or
- records evidence, a measurement, or a disposition on an existing gap.

Do it by editing the RFC, bumping its `Updated` field, and adding a dated
parenthetical at the point of change — *"(clarified 2026-08-19, after a host read
this as a carve-out)"* — plus a `CHANGELOG.md` line. **Record that the earlier
text was wrong rather than silently repointing it**: the next reader needs to
know the sentence was load-bearing in the other direction.

**Mint a new RFC when the change:**

- alters what a conforming host must do — including a narrowing, if a host that
  was conforming yesterday is not conforming today;
- adds or removes wire surface; or
- reverses a decision the RFC's comment window considered.

**The distinguishing question is not "how big is the diff" but "could a host have
been relying on the old text?"** If yes, it needs a number and a compatibility
classification, however small the edit. If no, a number adds a decision that was
never made.

An amendment-in-place still gets an `Amended by`-style trail when a *separate*
RFC drives it; what changes is that a correction with no decision behind it no
longer consumes a number.

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

<!-- GENERATED by scripts/generate-protocol-status.mjs. Do not hand-edit the tally or the Status column; run `node scripts/generate-protocol-status.mjs --write`. Title cells ARE hand-written and are preserved verbatim across regeneration — edit those freely. -->

Current tally: **Accepted 154 · Active 5 · Draft 1** (160 RFCs, excluding the `0000` template; Active = 0035 Parked, 0111 Parked, 0121 Parked, 0158, 0163; Draft = 0038 Parked).

Of the 6 non-`Accepted` RFCs, **4 are [Parked](#parked-rfcs)** on a named external tripwire and **2 await repository work**.

| RFC | Title | Status |
| --- | --- | --- |
| [0001](./0001-rfc-process.md) | The RFC Process | `Accepted` |
| [0002](./0002-agent-identity-and-reasoning-events.md) | Agent Identity and Reasoning Events | `Accepted` |
| [0003](./0003-agent-packs.md) | Agent Packs | `Accepted` |
| [0004](./0004-memory-layer.md) | Memory Layer | `Accepted` |
| [0005](./0005-conversation.md) | Multi-Turn Conversation | `Accepted` |
| [0006](./0006-orchestrator.md) | Run Orchestrator | `Accepted` |
| [0007](./0007-dispatch.md) | Dispatch (`core.dispatch` Node Pattern) | `Accepted` |
| [0008](./0008-wasm-abi.md) | WASM ABI for Cross-Language Node Packs | `Accepted` |
| [0009](./0009-production-profile-conformance.md) | Production-Profile Conformance | `Accepted` |
| [0010](./0010-auth-profile-conformance.md) | Auth-Profile Conformance | `Accepted` |
| [0011](./0011-auth-scoped-discovery.md) | Auth-Scoped Discovery Advertisement | `Accepted` |
| [0012](./0012-memory-compaction-profile.md) | Memory Compaction Profile | `Accepted` |
| [0013](./0013-workflow-chain-packs.md) | Workflow-chain packs | `Accepted` |
| [0014](./0014-host-fs-capability.md) | host.fs capability | `Accepted` |
| [0015](./0015-host-kv-storage-capability.md) | host.kvStorage capability | `Accepted` |
| [0016](./0016-host-table-storage-capability.md) | host.tableStorage capability | `Accepted` |
| [0017](./0017-host-queue-bus-capability.md) | host.queueBus capability | `Accepted` |
| [0018](./0018-host-sql-vector-search-capability.md) | host.sql + host.vectorStore + host.searchIndex capabilities | `Accepted` |
| [0019](./0019-host-blob-cache-capability.md) | host.blobStorage + host.cache capabilities | `Accepted` |
| [0020](./0020-host-mcp-server-composition.md) | host-side MCP server composition | `Accepted` |
| [0021](./0021-ai-envelope-primitive.md) | AI Envelope Primitive | `Accepted` |
| [0022](./0022-dispatch-input-output-mapping.md) | `core.dispatch` + `core.subWorkflow` runtime variable mapping | `Accepted` |
| [0023](./0023-conformance-agent-event-emitters.md) | Conformance Agent-Event Emitters | `Accepted` |
| [0024](./0024-agent-reasoning-streaming.md) | Streaming `agent.reasoned` Deltas | `Accepted` |
| [0025](./0025-test-mode-registry-namespace.md) | Test-mode Registry Namespace | `Accepted` |
| [0026](./0026-provider-usage-event.md) | `provider.usage` Event | `Accepted` |
| [0027](./0027-prompt-templates.md) | Prompt Templates | `Accepted` |
| [0028](./0028-prompt-library-endpoints.md) | Prompt Library Endpoints + Prompt Pack Kind | `Accepted` |
| [0029](./0029-prompt-override-hierarchy.md) | Prompt Override Hierarchy + `agent.promptResolved` event | `Accepted` |
| [0030](./0030-envelope-reasoning-and-tier-one-subset.md) | Envelope `reasoning` field + Tier 1 Structured-Output Subset (informative) | `Accepted` |
| [0031](./0031-envelope-variants-and-model-capabilities.md) | Envelope variant discrimination + model-capability declarations | `Accepted` |
| [0032](./0032-envelope-reliability-events.md) | Envelope-reliability run-event vocabulary | `Accepted` |
| [0033](./0033-envelope-completion-contract.md) | Envelope-completion contract (truncation vs schema-violation distinction) | `Accepted` |
| [0034](./0034-otel-collector-test-seam.md) | OTel collector test seam + secret-leakage invariant promotion | `Accepted` |
| [0035](./0035-sandbox-execution-contract.md) | Sandbox execution contract for pack-loaded typeIds | `Active` |
| [0036](./0036-multi-region-and-cross-engine-guarantees.md) | Multi-region idempotency + cross-engine append-ordering guarantees | `Accepted` |
| [0037](./0037-multi-agent-execution-model.md) | Multi-agent execution model + replay determinism under nondeterministic models | `Accepted` |
| [0038](./0038-working-group-charter.md) | OpenWOP Working Group charter | `Draft` |
| [0039](./0039-multi-agent-confidence-and-memory-lifecycle.md) | Multi-agent execution model `version: 2` — confidence-threshold escalation + agent memory lifecycle | `Accepted` |
| [0040](./0040-multi-agent-cross-host-causation.md) | Multi-agent execution model `version: 3` — cross-host causation linking | `Accepted` |
| [0041](./0041-multi-agent-replay-under-nondeterminism.md) | Multi-agent execution model `version: 4` — replay determinism under nondeterministic models | `Accepted` |
| [0042](./0042-experimental-capability-tier.md) | Experimental capability tier | `Accepted` |
| [0043](./0043-registry-and-extension-policy.md) | Registry and extension-policy | `Accepted` |
| [0044](./0044-confidence-escalation-interrupt-kind-advertisement.md) | Confidence-escalation interrupt-kind advertisement (clarification to RFC 0039 §A) | `Accepted` |
| [0045](./0045-connector-pack-manifest-action-model.md) | Connector pack manifest & action model | `Accepted` |
| [0046](./0046-host-credentials-capability.md) | host.credentials capability — credential vault, encryption, sharing & rotation | `Accepted` |
| [0047](./0047-host-oauth-connector-flows.md) | host.oauth — OAuth 2.0 authorization flows for connectors | `Accepted` |
| [0048](./0048-tenant-workspace-principal-identity-model.md) | Tenant · Workspace · Principal identity model | `Accepted` |
| [0049](./0049-rbac-scopes-and-authorization-decisions.md) | RBAC scopes & authorization decisions | `Accepted` |
| [0050](./0050-saml-scim-enterprise-identity-profiles.md) | SAML / SCIM (and optional LDAP) enterprise identity profiles | `Accepted` |
| [0051](./0051-approval-deployment-gate-primitive.md) | Approval & deployment-gate primitive | `Accepted` |
| [0052](./0052-scheduling-and-time-based-triggers.md) | Scheduling & time-based triggers (promote + extend RFC 0017) | `Accepted` |
| [0053](./0053-dead-letter-routing-and-failure-sinks.md) | Dead-letter routing & failure sinks | `Accepted` |
| [0054](./0054-run-diff-and-execution-comparison.md) | Run diff & execution comparison | `Accepted` |
| [0055](./0055-multimodal-envelope-variants-and-rendering-hints.md) | Multimodal envelope variants & rendering hints (extend RFC 0031) | `Accepted` |
| [0056](./0056-run-feedback-and-annotation-event.md) | Run feedback & annotation event (`run.annotated`) | `Accepted` |
| [0057](./0057-memory-write-attribution-event.md) | Memory write-attribution event (`memory.written`) | `Accepted` |
| [0058](./0058-run-execution-bounds.md) | Run execution bounds (`runTimeoutMs` + `maxLoopIterations`) | `Accepted` |
| [0059](./0059-agent-workspace.md) | Agent workspace (`host.workspace`) | `Accepted` |
| [0060](./0060-host-heartbeat-capability.md) | Host heartbeat capability (`host.heartbeat`) | `Accepted` |
| [0061](./0061-agent-loop-lifecycle.md) | Stateful agent-loop lifecycle (`multiAgent.executionModel.version: 5`) | `Accepted` |
| [0062](./0062-scheduled-memory-distillation.md) | Scheduled memory distillation — "dreams" (`memory.distillation`) | `Accepted` |
| [0063](./0063-subrun-output-attestation-and-merge-gating.md) | Sub-run output attestation & merge gating (`core.subWorkflow.outputAttestation`) | `Accepted` |
| [0064](./0064-tool-invocation-hooks-and-authorization.md) | Tool invocation hooks & per-tool authorization (`host.toolHooks`) | `Accepted` |
| [0065](./0065-workflow-node-primary-output-annotation.md) | Workflow node primary-output annotation | `Accepted` |
| [0066](./0066-x-openwop-form-vendor-extension.md) | `x-openwop-form` Vendor Extension on Pack `configSchema` | `Accepted` |
| [0067](./0067-provider-catalog-conventions.md) | Provider-catalog conventions — provider-name vocabulary + BYOK auth-mode advertisement | `Accepted` |
| [0068](./0068-memory-consolidation-and-standing-commitments.md) | Memory consolidation + standing commitments | `Accepted` |
| [0069](./0069-exec-class-tool-host-extension-safety-contract.md) | Host-extension safety contract for `exec`-class tools | `Accepted` |
| [0070](./0070-agent-manifest-runtime.md) | Agent Manifest Runtime Capability (`agents.manifestRuntime`) | `Accepted` |
| [0071](./0071-artifact-type-and-chat-card-packs.md) | Artifact-Type Packs and AI Chat Card Packs | `Accepted` |
| [0072](./0072-agent-inventory-and-dispatch.md) | Agent Inventory + Dispatch Normative Surface (amends RFC 0070) | `Accepted` |
| [0073](./0073-capability-document-root-layout.md) | Capability families are document-root properties of `/.well-known/openwop` | `Accepted` |
| [0074](./0074-tenant-scoped-agent-inventory.md) | Tenant-Scoped Manifest-Agent Inventory (amends RFC 0072) | `Accepted` |
| [0075](./0075-artifact-type-packs-realworld-amendment.md) | Artifact-Type Packs — real-world adoption amendment (RFC 0071 Phase-1.1 erratum) | `Accepted` |
| [0076](./0076-pack-runtime-requirements-and-host-safe-fetch.md) | Pack runtime-requirements declaration + host-provided safe-fetch | `Accepted` |
| [0077](./0077-agent-run-lifecycle-and-live-manifest-dispatch.md) | Agent Run Lifecycle + Live Manifest Dispatch | `Accepted` |
| [0078](./0078-portable-tool-catalog-and-tool-session-contract.md) | Portable Tool Catalog + Tool Session Contract | `Accepted` |
| [0079](./0079-credential-provenance-and-egress-policy.md) | Credential Provenance + Egress Policy | `Accepted` |
| [0080](./0080-agent-memory-capability-reconciliation.md) | Agent Memory Capability Reconciliation | `Accepted` |
| [0081](./0081-agent-evaluation-and-scorecards.md) | Agent Evaluation, Scorecards, and Promotion Gates | `Accepted` |
| [0082](./0082-agent-deployment-lifecycle.md) | Agent Deployment Lifecycle | `Accepted` |
| [0083](./0083-durable-trigger-and-channel-bridge-profile.md) | Durable Trigger + Channel Bridge Profile | `Accepted` |
| [0084](./0084-budget-quota-and-cost-policy.md) | Budget, Quota, and Cost Policy | `Accepted` |
| [0085](./0085-agent-platform-meta-profile.md) | `openwop-agent-platform` Meta-Profile | `Accepted` |
| [0086](./0086-standing-agent-roster-and-workflow-portfolio.md) | Standing Agent Roster + Workflow Portfolio | `Accepted` |
| [0087](./0087-agent-org-chart.md) | Agent Org-Chart | `Accepted` |
| [0088](./0088-core-standard-profile.md) | `openwop-core-standard` — the stable Core Standard Profile | `Accepted` |
| [0089](./0089-conformance-certification-bundle.md) | Conformance certification bundle — machine-readable per-profile evidence | `Accepted` |
| [0090](./0090-agent-verifier-and-convergence.md) | Agent verifier turn + convergence criteria (multi-agent execution `version: 6`) | `Accepted` |
| [0091](./0091-multimodal-perception-input.md) | Multimodal perception input on `ctx.callAI` (typed content parts) | `Accepted` |
| [0092](./0092-agent-capability-requirements.md) | Agent-level capability requirements (`AgentManifest.requiresCapabilities`) | `Accepted` |
| [0093](./0093-protocol-hardening-webhooks-tokens-idempotency.md) | Protocol hardening — webhook delivery egress, interrupt-token lifecycle, retryable-response caching, approval-gate timeout semantics | `Accepted` |
| [0094](./0094-wire-shape-reconciliation.md) | Wire-shape reconciliation — schema/prose defect repairs and forward-compat closure policy | `Accepted` |
| [0095](./0095-connection-packs-portable-provider-definitions.md) | Connection packs — a registry-distributable provider definition that resolves the RFC 0047 `provider` string | `Accepted` |
| [0096](./0096-reviewable-learning-skill-proposal-lifecycle.md) | Reviewable learning — skill/automation proposal lifecycle (inert drafts, RFC 0051-gated activation) | `Accepted` |
| [0097](./0097-standing-goals-and-judge-based-continuation.md) | Standing goals — judge-based (RFC 0090) completion + bounded continuation | `Accepted` |
| [0098](./0098-agent-platform-portability-export-bundle-and-import.md) | Agent-platform portability — export bundle + tenant import (refs-only, dry-run, idempotent) | `Accepted` |
| [0099](./0099-external-event-trigger-ingestion.md) | External-event trigger ingestion — webhook/email/form sources start a run (extends RFC 0083; `TriggerEvent` envelope + registration contract + SSRF/replay safety) | `Accepted` |
| [0100](./0100-async-durable-a2a-tasks.md) | Async / durable A2A tasks — durable Task persistence + `tasks/resubscribe` + push for cross-host handoffs (extends `a2a-integration.md`; new `a2a` capability slot) | `Accepted` |
| [0101](./0101-multi-party-group-conversation.md) | Multi-party group conversation — shared transcript + speaker attribution | `Accepted` |
| [0102](./0102-a2ui-agent-authored-interface-surfaces.md) | A2UI agent-authored interface surfaces — declarative cross-trust-boundary UI as a **core, advertised** `ui.a2ui-surface` envelope kind beside `media.*` (extends RFC 0055; closed `anyOf` surface, enumerated catalog, actions confined to interrupt-resume/exchange) | `Accepted` |
| [0103](./0103-localized-content-surface.md) | Localized content surface — durable authored content (pages → sections; section = base `data` + sparse `localizations` map) reusing the Stable `i18n.md` annex's `Accept-Language`/`Content-Language` negotiation; new capability-gated `content` block (⊆ `i18n.supportedLocales`) + per-section field merge | `Accepted` |
| [0104](./0104-hitl-approver-routing.md) | Portable HITL approver routing — optional, advisory `approverGroupRefs` / `approverRoleRefs` / `audience` on the approval `InterruptPayload` so group/role approver routing is portable + capability-gated across hosts (`approversList` stays advisory; enforcement host-side). Step-up + credential-bound approvals are a separate RFC | `Accepted` |
| [0105](./0105-speech-synthesis-adapter.md) | Speech synthesis adapter — additive optional `aiProviders.speechSynthesis` sub-capability + `ctx.callSpeechSynthesizer({ text, voiceId, … })` → binary audio asset, paralleling `ctx.callImageGenerator`; closes the TTS (audio-output) wire gap (image-gen + RFC 0091 audio-input exist, but no speech synthesis) | `Accepted` |
| [0106](./0106-realtime-voice-session-profile.md) | Real-time voice session profile — additive optional `aiProviders.realtimeVoice`: streaming transcription `ctx.callTranscriber` (resolves a `Promise` at `turn_commit`, interim/final + endpointing emitted as `voice.*` run-events), a streaming arm on the RFC 0105 synthesizer, a distinct `streamRef` live handle, and a `voice.*` turn-taking / barge-in run-event taxonomy | `Accepted` |
| [0107](./0107-publishable-declarative-pack-kinds.md) | Publishable declarative pack kinds — registry version manifest carries `kind` + declarative payload, `runtime` conditional | `Accepted` |
| [0108](./0108-self-hosted-openai-compatible-provider-class.md) | Self-hosted / OpenAI-compatible provider class — additive optional `aiProviders.selfHosted[]` (subset of `supported`) marking operator-/tenant-configured OpenAI-compatible endpoints; truthful-advertisement + endpoint-non-disclosure + capability-non-inference rules | `Accepted` |
| [0109](./0109-conversation-turn-model-provenance.md) | Conversation-turn model provenance (`agent.model`) | `Accepted` |
| [0110](./0110-channel-presence.md) | Channel presence (online + typing) | `Accepted` |
| [0111](./0111-context-economy.md) | Context economy — additive OPTIONAL `multiAgent.executionModel.contextBudget` (`{ transcriptTokenBudget?, tokenCounter?, summarization? }`) that token-bounds the RFC 0061 per-iteration orchestrator transcript + declares a summarization contract; new content-free `context.summarized` event whose `summaryRef` artifact a `:fork mode:replay` MUST reuse (RFC 0041-governed, never re-summarize); does NOT flip `transcriptWindow`'s `absent ⇒ unbounded` default | `Active` |
| [0112](./0112-compact-tool-projection.md) | Compact tool projection — additive OPTIONAL `?view=compact` on the RFC 0078 tool-catalog reads returning a `{ tools: CompactToolDescriptor[] }` projection (heavy fields dropped; `inputSchema` bounded to a self-contained structural subset pinned in `compact-tool-descriptor.schema.json`), advertised via a new `toolCatalog.compactView` flag; standard view + Tier-1 SHOULD unchanged | `Accepted` |
| [0113](./0113-memory-injection-budget.md) | Memory injection budget — additive OPTIONAL `tokenBudget`/`rank`/`query` on `MemoryListOptions` (RFC 0068) that token-bound the live injection read (over-budget single entry omitted, never truncated), advertised via a new `memory.injectionBudget` (`{supported, tokenCounter}`); `rank:'relevance'` DELEGATES to the existing `memory.search` semantic mode (RFC 0080) — no new ranking surface; SR-1/CTI-1 preserved by construction | `Accepted` |
| [0114](./0114-a2ui-surface-deltas.md) | A2UI surface deltas — additive OPTIONAL host-side TRANSPORT projection over the recorded `ui.a2ui-surface` envelope (RFC 0102): the recorded envelope stays the FULL surface (replay-pinned, security-validated, event-log-full — UNCHANGED); a host MAY deliver RFC 6902 (JSON-Patch) delta frames (`a2ui-surface-delta-frame.schema.json`, op enum excludes `test`) over the run event stream to subscribers that negotiate `?a2uiDelta=1`, advertised via a new top-level `a2uiSurface.deltaTransport`; consumer re-validates the post-patch surface against the closed catalog fail-closed (all A2UI security invariants hold post-patch) | `Accepted` |
| [0115](./0115-run-transport-economy.md) | Run transport economy — additive OPTIONAL conditional GET (sequence-derived strong `ETag` + `If-None-Match`/`304`) and `Content-Encoding` negotiation (gzip baseline; `br`/`zstd` optional) on `GET /v1/runs/{runId}`, advertised via a new top-level `restTransport` capability; HTTP-layer poll economy, `200` body schema unchanged | `Accepted` |
| [0116](./0116-prompt-prefix-cache.md) | Portable prompt-prefix cache — additive OPTIONAL `cachePrefixId` (tenant-namespaced, secret-free label) on the AI-envelope `generate` request, advertised via a new provider-scoped `aiProviders.promptPrefixCache` capability; a supporting host MAY route the stable prefix to its provider's context cache. Made safe + testable by three MUSTs: a mandated `(tenant, cachePrefixId)` cache key (protocol-tier invariant `prompt-prefix-cache-cross-tenant-isolation`), a cost-hint-only/replay-invariant outcome contract, and a wire witness via new cost-only `provider.usage.cacheReadTokens`/`cacheWriteTokens` | `Accepted` |
| [0117](./0117-frontend-plugin-packs.md) | Front-end plugin packs — additive `kind:"frontend-plugin"` pack + OPTIONAL `host.uiPlugins` capability for portable, **sandboxed** UI extensions (canvas editors, custom artifact viewers). The wire owns the BOUNDARY, not a renderer: a mandated cross-origin-iframe isolation model (in-process loading is a protocol-tier MUST NOT), a closed `postMessage` host-RPC allowlist (`ui-plugin/1`), deny-egress CSP, Ed25519 signing, and graceful degradation. Invariants: `frontend-plugin-isolation` / `-egress` / `-rpc-allowlist` / `-no-byok`. The carve-out RFC 0071 deferred | `Accepted` |
| [0118](./0118-parallel-subworkflow-fan-out-and-join.md) | Parallel sub-workflow fan-out and join — additive `fanOutPolicy: 'parallel'` enum value plus an optional `joinPolicy` object (`mode`: `wait-all`/`quorum`/`first`/`race`; `onChildFailure`: `collect`/`fail-fast`/`absorb`) and `maxConcurrency` on `DispatchConfig`, closing RFC 0007 §K3's deferred parallel fan-out. Children dispatch concurrently (bounded by `maxConcurrency`/advertised `capabilities.dispatch.maxFanOut`), join per policy, emit `core.dispatch.fanOut`/`core.dispatch.join` run-events with a replay-deterministic `mergeOrder`; gated on `capabilities.dispatch.fanOutSupported: true`, default stays `'sequential'` | `Accepted` |
| [0119](./0119-isolation-model-mechanism-neutrality.md) | Front-end plugin isolation as a mechanism-neutral property (amends RFC 0117) — widens `capabilities.uiPlugins.isolation` from `const "cross-origin-iframe"` to a categorical `enum` (`cross-origin-iframe`/`wasm`/`process`/`container`/`vm` + `x-host-*`), reconciling the schema with RFC 0117 §2's own already-property-based prose and reusing the `sandbox.isolationModel` (RFC 0035) vocabulary. Reframes the `frontend-plugin-isolation` invariant in property terms and adds a normative transport-agnostic channel binding for `ui-plugin/1`. Additive (looser validation, `COMPATIBILITY.md` §4); the isolation property + all four SECURITY invariants are unchanged | `Accepted` |
| [0120](./0120-connection-pack-api-hosts.md) | Connection-pack provider `apiHosts` — declared credential-egress allow-list. Adds an OPTIONAL `provider.apiHosts` array (bare registrable hostnames, eTLD+1-matched) to the RFC 0095 connection-pack manifest, declaring the API host(s) a host MAY send the resolved credential to for connector egress (RFC 0045) — closing the gap where a pack-delivered provider has no allow-list and every credential-bearing call fails closed. Independent of the OAuth/docs hosts (MUST NOT infer); strict host-shape (`connection_pack_invalid_api_host`); new `connection-pack-api-host-shape` SECURITY invariant. Conditional MUST: `apiHosts` REQUIRED when `reach: openapi` (manifest schema) and at the RFC 0045 binding site; eTLD+1 floor with dot-anchored containment, pack MAY tighten. Additive — a pack without `apiHosts` behaves exactly as today (fails closed). Accepted 2026-06-29: single-witness (tier-2 + reference-host) — openwop-app ran the published `@openwop/openwop-conformance@1.46.0` egress leg non-vacuously (permit `graph.facebook.com`, fail-closed off-allow-list); myndhyve-1 opted out of the brokered-egress arm | `Accepted` |
| [0121](./0121-subscription-provider-auth.md) | Subscription-reuse provider auth mode — adds `"subscription"` to the `aiProviders.authModes` closed enum (RFC 0067) so a host can honestly advertise that a provider credential may be supplied by reusing an existing personal consumer subscription (Claude Pro/Max, ChatGPT) rather than a metered API key or a host-owned OAuth client. New `subscription-credential-user-scope-only` invariant (personal-subscription credentials MUST bind at `scope:"user"`, never tenant-shared). Additive (one enum value on the already-optional `authModes`; forward-compat by RFC 0067's ignore-unknown-mode rule). Active 2026-07-01 (bootstrap steward waiver, 7-day window waived; wire-shape only). Unresolved-Q1 legal/ToS review **re-scoped** as an Active→Accepted / implementation precondition — no host may advertise or implement `subscription` until it clears | `Active` |
| [0122](./0122-self-hosted-runner-remote-execution.md) | Self-hosted runner (remote-driven local execution) — new OPTIONAL root capability `selfHostedRunner`: a hosted control plane routes a run's per-step model/tool dispatch to a user-controlled **runner** that dials OUT (SSE receive + POST result, no inbound exposure) and holds local credentials (subscription CLI login, private endpoint) the host cannot reach — closing the execution-locality gap RFC 0108 (host-reachable only) and RFC 0121 (needs a local client) leave open. Per-step dispatch keeps the host the sole orchestration/replay authority; replay reads from persistence (never re-dispatches); fork re-routes to any owning-subject runner (no `runnerId` pin); absent runner ⇒ retriable `runner_unavailable`. Two new protocol-tier invariants (runner-credential-non-transit; runner-output-untrusted-transport). Additive. Accepted 2026-07-02 (dual-witness vs conformance 1.48.0: openwop-app reference + MyndHyve tier-2, both pass the gated `self-hosted-runner` scenario non-vacuously behind the capability gate). Hosts MAY now advertise `selfHostedRunner` | `Accepted` |
| [0123](./0123-connection-pack-vendor-grouping.md) | Connection-pack provider `vendor` — an additive OPTIONAL string on the RFC 0095 provider manifest naming the commercial vendor/ecosystem ("Microsoft 365", "Google", "Workday") so a host/registry groups the connector catalog by the vendors a customer uses. Presentational ONLY — NOT the RFC 0047 resolution key; gates no capability; free-form (no schema change per new vendor); a manifest without it stays valid and a host that ignores it stays conformant. Extends the built-in-only vendor grouping (openwop-app ADR 0183/0186; `packs.openwop.dev`) to pack-delivered connectors. Additive. Accepted 2026-07-06 (single-witness bootstrap waiver — the schema/spec/conformance surface the RFC defined as the Active→Accepted work is landed + GREEN; `vendor` gates no capability + no wire behavior, so the schema-shape legs are the falsifiable witness and the rendering MUSTs are the §4 unobservable-runtime class; host/registry adoption is downstream of Accepted per §Migration) | `Accepted` |
| [0124](./0124-portable-per-run-parameter-deferral.md) | Portable per-run parameter deferral for workflow-chain packs (WCP4) — OPTIONAL capability-gated `workflowChainPacks.deferredParameters` expansion mode that keeps chain `{{params.*}}` overridable per run WITHOUT the non-portable app-private runtime tokens RFC 0013 forbids. At drop time the host materializes the chain's `parameters` into top-level `variables[]` (author input as `defaultValue`) and rewrites each token into an already-spec'd runtime binding (PromptTemplate `{{varName}}` with `source:"variable"`, or a variable-sourced PortValue), so the persisted workflow contains NO `{{params.*}}` tokens and every host resolves it identically. Per-run override via existing `configurable` (run + `:fork`); replay-deterministic by riding `RunSnapshot.variables` byte-equivalence. Does NOT relax RFC 0013's expansion-time MUST — both modes coexist. Additive. Motivated by openwop-app ADR 0237. Includes the 2026-07-04 §Security amendment: a `sensitive` param (`x-openwop-sensitive`) MUST materialize as `source:"secret"` (BYOK-resolved, `[REDACTED]`, never bagged), is deferrable ONLY in a prompt-body position, and fails closed `sensitive_param_not_deferrable` (422) elsewhere; per-run supply is a secret reference, plaintext ⇒ `validation_error`. Accepted 2026-07-04 — **single-witness** graduation under the bootstrap steward waiver (0120/0121/0125/0126 precedent): openwop-app host stack (#1245→#1281, `source:"secret"` #1281) materializes → per-run override → fork-replay → sensitive redaction with plaintext-never-anywhere, gated leg green (backend 4806). Register swept (G1–G4/R1/R2/R6 resolved; **G6 second witness carried forward** — MyndHyve + in-memory both lack a chain-compose path, so a PromptTemplate-compose host is the deferred dual-witness path). Host advertises honest-off until the post-graduation `deferredParameters.supported` flip | `Accepted` |
| [0125](./0125-chain-fragment-edge-trigger-rule.md) | Chain-pack `FragmentEdge.triggerRule` — mirrors `WorkflowEdge.triggerRule` (`all_success` \| `any_success` \| `all_complete` \| `none_failed` \| `any_failed`, default `all_success`) onto workflow-chain-pack fragment edges so a chain can express fan-in / error-routing / best-effort completion (the ADR-0247 `all_complete` "let a 404 complete the run" case). Same "mirror WorkflowEdge field → FragmentEdge" move as the RFC 0013 2026-07-03 `condition` amendment. Expansion MUST preserve `triggerRule` onto the resulting `WorkflowEdge` (else the scheduler never honors it). Additive (OPTIONAL; default = implicit prior behavior); no capability flag. Active 2026-07-04 (bootstrap steward waiver, 7-day window waived). Host `mapEdgeCondition` pass-through + witness = path to Accepted | `Accepted` |
| [0126](./0126-data-parallel-dispatch-per-item-input.md) | Data-parallel `core.dispatch` per-item input — OPTIONAL, index-aligned `nextWorkerInputs[]` on `NextWorkerDecision` (`orchestrator-decision.schema.json`) so a `next-worker` decision can fan ONE `childWorkflowId` over N runtime items with distinct inputs (the map-over-collection pattern: a supervisor resolving a segment to N `contactId`s → one `re-engage-contact` run per contact). `nextWorkerInputs[i]` projects into child `i` OVER the RFC 0022 `inputMapping` (per-item value wins on key collision); `.length` MUST equal `nextWorkerIds.length` (runtime `validation_error`, not schema-expressible). Capability-gated `capabilities.dispatch.perItemInput` and **fail-closed**: a non-advertising host MUST reject a non-empty `nextWorkerInputs` rather than silently dispatch N identical children. Replay-deterministic — rides the recorded `runOrchestrator.decided` event, re-read verbatim on `:fork`. Additive; no fan-out *mode* change (RFC 0118 `fanOutPolicy`/`joinPolicy` untouched). Motivated by openwop-app ADR 0255 (segment-winback). Accepted 2026-07-04 — **single-witness** graduation under the bootstrap steward waiver (0120/0121/0125 precedent): openwop-app host executor arm (PR #1278) projects `nextWorkerInputs[idx]` into each child on both the parallel + sequential arms, with the fail-closed gate + replay-safe re-read, witnessed by `dispatch-per-item-input-executor.test.ts` (5/5 on a real `core.dispatch` node). Register swept (G1/G2/G4/G7 resolved; G3/G5/G6 + R2/R3/R4 carried forward as named open gaps). Host advertises honest-off until the post-graduation `perItemInput` flip; full segment-winback chain consumer is a tracked follow-on | `Accepted` |
| [0127](./0127-streaming-and-cdc-trigger-sources.md) | Streaming & CDC trigger sources — additively extends the RFC 0083/0099 trigger `source` enum with `stream` (a message from a Kafka/Kinesis/Pub-Sub broker) and `change` (a warehouse/DB change-data-capture row; carries an `op` insert/update/delete discriminator in `metadata.triggerData`), so a CDP-class host can advertise honest, conformance-gated streaming/CDC ingestion. Reuses RFC 0099's `TriggerEvent` envelope, SSRF posture, body-redaction (SR-1), and the RFC 0083 dedup floor unchanged — only the `source` vocabulary + two OPTIONAL `ingestion` booleans grow. Both open questions resolved (one `change` source + `op`; no `deliveryGuarantee` advert — unfalsifiable). Additive. Gates openwop-app ADR 0269 (CDP-G) streaming ingest | `Accepted` |
| [0128](./0128-purpose-propagation-permitted-use-labels.md) | Purpose-propagation — permitted-use labels on cross-host synced data. Adds an OPTIONAL `permittedPurposes: string[]` label (opaque purpose strings; absent = unlabelled, `[]` = no onward use) to the A2A message + trigger-event `metadata`, plus a `capabilities.purposePropagation` advert, so a consent-derived use-constraint survives the host boundary. The conformance-testable core is deliberately narrow — a host advertising the capability MUST **re-emit** (MAY narrow, MUST NOT widen) the label on any onward hop (observable/falsifiable); the internal-use restriction is `SHOULD`/declared-intent, explicitly NOT gated (internal use isn't wire-observable — an unfalsifiable MUST is worse than none). Additive. Gates openwop-app ADR 0268 (CDP-F) §5 cross-host purpose propagation | `Accepted` |
| [0129](./0129-data-residency-region-advertisement-and-honor-or-reject.md) | Data-residency — regional advertisement + honor-or-reject run constraint. A host MAY advertise `capabilities.dataResidency {supported, regions[]}` (opaque operator region codes; no closed registry) and a client MAY attach an OPTIONAL `residency:{region}` to `POST /v1/runs`. The single normative MUST is **admission control** (falsifiable): a host advertising `dataResidency` accepts iff the region ∈ `regions[]`, else rejects `residency_unavailable` (HTTP one-of 400/404/422) and creates no run — it MUST NOT silently accept-and-ignore. Physical byte-confinement is demoted to a §4 declared operator SHOULD, NOT conformance-gated (unobservable on the wire) — the same honesty split as 0128 §4 / 0127's no-`deliveryGuarantee`. Additive (OPTIONAL capability + OPTIONAL run-create field). Motivated by GDPR/data-localization pins | `Accepted` |
| [0130](./0130-canvas-preview-plugin-surface.md) | Canvas Preview Plugin Surface (amends RFC 0117) | `Accepted` |
| [0131](./0131-agent-manifest-role-and-skill-profile.md) | Agent-manifest `role` + the Skill profile — distinguishes a composable, task-scoped **Skill** (a `handoff` task→return capability an assistant/roster agent delegates to) from a top-level **assistant** agent, first-class on the manifest. Adds an OPTIONAL `AgentManifest.role` (`skill`/`assistant`), **explicit — never inferred** (absent ⇒ unconstrained = today's behavior; `handoff` is an interop contract, not a role signal, so an assistant may carry it). A manifest opts in with `role:"skill"`, which — encoded as a JSON-Schema `if role==="skill"` conditional — MUST declare `handoff` and constrain `memoryShape` to scratchpad-only (no `conversation`/`longTerm`); a violation **fails schema validation at publish/install** (a malformed-manifest reject, RFC 0003 §C — NOT an RFC 0072 `degraded[]` runtime tier, which keeps its "host lacks a capability" meaning). Rationale: persistent + multi-turn memory belong to the composing assistant, and a stateful worker undermines RFC 0041 replay determinism. Additive (field) + safety-fix (the §B conditional binds only opt-in `role:"skill"` manifests, of which there are zero today). No new pack kind (a "skill pack" duplicates agent-pack+handoff; SKILL.md already normalizes to an agent manifest). Gates openwop-app ADR 0312 | `Accepted` |
| [0132](./0132-anonymous-actor-authorization.md) | Anonymous-actor authorization for public agent surfaces — a new, explicit `principal` kind (opaque, origin-bound, per-session-ephemeral, non-cross-linkable, non-PII; RFC 0048 parity, resolving its §UQ1 principal-kind discriminator) for callers with no account/credential — the embeddable widget the reference consumer. An anonymous actor's authority is NOT any user/role and NOT the default-on tool baseline (openwop-app ADR 0315) but a **default-deny, explicit, per-surface tool grant** advertised via a new OPTIONAL `anonymousActor` capability family (`{supported, tiers, writeEgressControls?, failClosed}`), with a tenant-scoped no-egress/no-secrets **read** tier and a **bounded-write/egress** tier permitted ONLY behind a mandatory per-action HITL/approval OR hard rate-limit + per-session cap, SSRF-guarded audience-bound egress (RFC 0076/0079), and a hard floor that an anon actor never reaches tenant BYOK/secrets/cross-tenant data. Adds an OPTIONAL `owner.principalKind` (`user`/`agent`/`anonymous`, EXPLICIT — absent ⇒ today's behavior) as the wire witness. Every anon tool call audits via the existing `authorization.decided` event (RFC 0049) in the `openwop.*` OTel namespace — no new event type. Five proposed protocol-tier MUST-NOTs (`anon-actor-no-default-baseline` / `-no-secret-reach` / `-egress-ssrf-guarded` / `-write-egress-gated` / `-audit-opaque`), landing with their tests at `Active` (RFC 0079 precedent). Additive. Gates openwop-app tool-enabled public dispatch (chat-first-port A5). Five MUST-NOTs GRADUATED `reference-impl` → `protocol` tier at `Active → Accepted` (2026-07-22) on the openwop-app tier-1 witness (rev `03d06d1f2`, 5 gated scenarios 10/10 non-vacuous). | `Accepted` |
| [0133](./0133-workflow-chain-composition.md) | Workflow-chain composition — extends RFC 0013 workflow-chain packs with two OPTIONAL, additive capabilities so composed/stateful workflows need not stay hard-coded: (1) **sub-chains** — a chain fragment MAY reference a child chain (a sibling in the same pack, or an external published chain) via `subChains[]` + `config.subChainRef`, which the host **co-expands and co-registers** as its own owned workflow, rewriting the parent's dispatch node to the minted child id so the parent holds a **runtime** child (`core.subWorkflow` / `core.dispatch` child-run fan-out — RFC 0118 at the chain layer; realizes "workflows can hold workflows", the future-RFC forward-reference RFC 0013 anticipated); cycle/depth-guarded, `sub_chain_unsupported` refuse-not-flatten. (2) **produced variables** — a fragment MAY declare `producedVariables[]` (a value a node writes to the run bag that a downstream node reads by name, distinct from author-time `parameters`), passed through to the expanded workflow's `variables[]`, closed-world validated (`variable_undeclared`); explicit output→input edges remain PREFERRED. Additive (all new fields optional; existing chains unchanged; no wire/dispatch change). Unblocks openwop-app's 5 composed/stateful builtin workflows (Challenge Factory + `lesson-batch`, `plan-generation`, `campaign-orchestration`, `enrollment`) to migrate off the deprecated in-tree `builtinWorkflows` seam (ADR 0072). Draft → Active → Accepted 2026-07-22 on the pure-library algorithm witnessed server-free (schema + spec + `expandChainTree`/`emitProducedVariables`/`validateVariableReads` + 3 server-free scenarios + the protocol-tier `sub-chain-expansion-bounded` invariant), mirroring RFC 0013's own Accepted basis; runtime child dispatch on a live host + `sub-chain-child-tenant-scoped` (reference-impl) carried forward host-pending (see the RFC §"Status note" + `docs/KNOWN-LIMITS.md`). Amends RFC 0013. | `Accepted` |
| [0134](./0134-edge-condition-truthy-falsy.md) | Edge conditions — `truthy` / `falsy` operators | `Accepted` |
| [0135](./0135-workflow-chain-internal-visibility.md) | Workflow-chain gallery visibility — `internal` chains | `Accepted` |
| [0136](./0136-workflow-variable-format.md) | `WorkflowVariable.format` — a presentational hint for run inputs | `Accepted` |
| [0137](./0137-form-content-packs.md) | Form-content packs — `kind: "form-content"` distributes form templates; field types reuse the RFC 0071 portable subset | `Accepted` |
| [0138](./0138-pack-manifest-vendor-extensions.md) | Vendor-extension hatch on pack manifests | `Accepted` |
| [0139](./0139-extension-opacity-host-witness.md) | Host-side witness for pack-manifest extension opacity | `Accepted` |
| [0140](./0140-replay-side-effect-suppression.md) | Replay side-effect suppression — `replay.md` §"Determinism guarantees" caveat 1 has **always** required, unconditionally, that a replayed run not call an external system twice; what was defective was the *mechanism* it delegated to. `idempotency.md` Layer 2 keys on `runId` and a fork mints a new one, so a fork's key space is disjoint from its source's by construction — an implementer who follows the spec literally re-fires effects and believes they are conformant. Replaces the inoperative delegation: a replayed side-effecting node resolves the **source** run's recorded outcome for the same `(nodeId, attempt)` or fails closed with the newly-registered `replay_source_missing`; pure/LLM nodes still re-execute live (short-circuiting them would make RFC 0041 divergence detection vacuously green). Adds `replay.sideEffectSuppression` (`recorded-outcome`/`none`) as an **assurance declaration** — `none` means "no mechanism declared", NEVER permission to re-fire, since gating caveat 1 would relax an unconditional MUST (`COMPATIBILITY.md` §2.2). Requirement 5 makes the whole-run claim need **two** mechanisms — classification keeps a replay correct, a default-deny effect-seam guard keeps it safe — because classification fails **open** and drifts silently. Requirement 6 closes the cross-host case with no new machinery: a dispatch *is* an outbound call, so a replay never reaches the peer. Also declares the root `replay` capability block, which was undeclared in every schema. Scoped to `replay`, NOT `branch`. Additive. Accepted 2026-08-08 on the openwop-app tier-1 witness (ADR 0326 P3b + 0341 + 0531, widened by 0533), eight per-fix sabotages; gaps G2/G3 (the happy path is not directly witnessed; classification and the guard mask each other) carried forward. | `Accepted` |
| [0141](./0141-legacy-artifact-type-identifiers.md) | Legacy artifact-type identifiers — never-conformant status and the replay migration constraint | `Accepted` |
| [0142](./0142-store-gated-emission-witness.md) | The `store`-gated `artifact.created` emission witness | `Accepted` |
| [0143](./0143-tool-result-trust-propagation.md) | Tool-result trust is untrusted-by-default and monotone through composition | `Accepted` |
| [0144](./0144-capability-declaration-classes.md) | Which host capability families the core schema declares | `Accepted` |
| [0145](./0145-registration-source-per-type-facet.md) | `registrationSource` as a per-type artifact capability facet | `Accepted` |
| [0146](./0146-contract-provenance-advertisement.md) | `contractProvenance` — which corpus revision a host implements against | `Accepted` |
| [0147](./0147-protocol-integrity-and-standards-readiness-program.md) | Protocol Integrity and Standards-Readiness Program | `Accepted` |
| [0148](./0148-non-vacuous-conformance-certification.md) | Non-Vacuous Conformance and Certification Evidence | `Accepted` |
| [0149](./0149-machine-contract-and-version-reconciliation.md) | Machine-Contract and Version Reconciliation | `Accepted` |
| [0150](./0150-effect-identity-replay-and-split-brain-safety.md) | Effect Identity, Replay, and Split-Brain Safety | `Accepted` |
| [0151](./0151-compensation-and-partial-failure-profile.md) | Compensation and Partial-Failure Profile | `Accepted` |
| [0152](./0152-a2a-1-0-versioned-composition.md) | A2A 1.0 Versioned Composition | `Accepted` |
| [0153](./0153-mcp-2026-07-28-versioned-composition.md) | MCP 2026-07-28 Versioned Composition | `Accepted` |
| [0154](./0154-workload-identity-delegation-telemetry-and-provenance.md) | Workload Identity, Delegation, Telemetry, and Provenance Assurance | `Accepted` |
| [0155](./0155-core-profile-and-extension-discipline.md) | Core Profile and Extension Discipline | `Accepted` |
| [0156](./0156-governance-independent-assurance-and-claims.md) | Governance, Independent Assurance, and Claims Policy | `Accepted` |
| [0157](./0157-chain-fragments-carry-compensation.md) | Chain fragments carry compensation (RFC 0013 revision × RFC 0151 §B) | `Accepted` |
| [0158](./0158-durable-execution-and-disaster-recovery-qualification.md) | Durable Execution and Disaster-Recovery Qualification | `Active` |
| [0159](./0159-scim-saml-subject-linking.md) | A subject-linking obligation for hosts advertising **both** `openwop-auth-saml` and `openwop-auth-scim`: a SCIM deactivation MUST fail-close the linked SAML identity, keyed on an opaque IdP-stable subject id — so a provisioned leaver cannot still SSO in | `Accepted` |
| [0163](./0163-subject-linking-hardening.md) | Subject-linking hardening — a **declarable, witnessable** link-key class (`capabilities.auth.subjectLinkKey`, a closed enum of allowed classes only) plus a **same-IdP trust-root MUST** before a SAML⟷SCIM link may form. The additive follow-on to RFC 0159 that converts its §A.2/§A.4 negative-existence claims-check into a positive advertisement and closes its cross-IdP collision gap. | `Active` |
## See also

- `GOVERNANCE.md` — decision rules, maintainer roles, the broader spec change process.
- `COMPATIBILITY.md` — what counts as additive vs breaking.
- `MAINTAINERS.md` — current maintainer set.
- `CONTRIBUTING.md` — per-artifact rules (schemas, OpenAPI, conformance, SDK).

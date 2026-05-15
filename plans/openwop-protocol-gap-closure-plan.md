# OpenWOP Protocol Gap Closure Plan

> Status: active planning artifact
> Created: 2026-05-15
> Scope: close the gaps identified in the protocol evaluation of OpenWOP as an open source multi-agent workflow orchestration protocol.

This plan turns the protocol review into an executable roadmap. It is intentionally more operational than the archived `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`: each gap has a workstream, concrete tasks, acceptance signals, and dependency notes.

The core finding is that OpenWOP is technically strong but not yet ecosystem-strong. The protocol already has a serious wire contract, conformance suite, SDK surface, registry model, and multi-agent vocabulary. The remaining gaps concentrate in four areas:

1. External trust: independent implementations, neutral governance, and external security audit.
2. Evidence quality: conformance behavior coverage, production-scale proof, and status-doc consistency.
3. Ecosystem portability: SDK ergonomics, pack consumption, registry interoperability, and standards mappings.
4. Multi-agent maturity: agent identity mapping, cross-host composition, memory provenance, and workflow-chain pack design.

## Closure Principles

1. Do not break v1. All protocol changes in this plan are additive v1.x profiles, clarifying annexes, conformance minors, docs, or reference implementation work.
2. Prefer mechanical proof over prose. A gap is closed by a passing conformance scenario, schema validation, generated status check, interop report, public audit artifact, or independently reproducible example.
3. Keep OpenWOP a protocol. Do not absorb MCP, A2A, BPMN, Serverless Workflow, Temporal, or OpenTelemetry responsibilities. Add mappings and profiles where interoperability matters.
4. Separate controllable work from external-gated work. Outreach, audit scheduling, and non-steward adoption cannot be forced, but the repo can make each handoff low-friction and auditable.
5. Make stale status impossible where possible. If the repo already contains machine-readable evidence, prefer generated docs or CI checks over manually maintained counts.

## Definition Of Done

A workstream can be marked closed only when all applicable checks are true:

- The public docs identify the capability, profile, or governance status consistently.
- The machine-readable surface is updated: JSON Schema, OpenAPI, AsyncAPI, conformance manifest, or registry metadata.
- At least one black-box conformance scenario covers the expected behavior, unless the item is explicitly governance-only or outreach-only.
- Reference host evidence is published in `INTEROP-MATRIX.md` when host behavior is claimed.
- SDK parity is updated if clients need first-class access to the surface.
- Security-sensitive changes have a threat-model or invariant update.
- The work appears in `CHANGELOG.md`.

## Timeline Overview

| Phase | Target window | Main outcome |
|---|---:|---|
| Phase 0 | Days 0-7 | Stop status drift and establish a generated gap tracker. |
| Phase 1 | Days 8-30 | Close controllable conformance, SDK, and documentation gaps. |
| Phase 2 | Days 31-90 | Complete audit engagement, pack consumption, independent implementation recruitment, and production proof. |
| Phase 3 | Days 91-180 | Move toward neutral governance, standards mappings, hosted certification, and multi-agent ecosystem maturity. |

## Workstream 1: Status Hygiene And Source Of Truth

Grade target: B- to A-

### Gaps

- `ROADMAP.md`, `conformance/coverage.md`, `README.md`, `MAINTAINERS.md`, and some spec files disagree on counts, status, RFC state, mTLS support, memory compaction status, registry maturity, and conformance numbers.
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` is correctly archived, but some "remaining" notes in other docs still describe already-landed work.
- The repo has enough machine-readable evidence to generate much of this status, but several counts are still manually maintained.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| SH-1 | P0 | Add a generated protocol status script that counts specs, schemas, OpenAPI operations, RFC states, conformance scenarios, SDK helper coverage, and registry pack counts. | `scripts/`, `package.json`, `docs/` | `npm run openwop:check` fails when generated status differs from committed status. |
| SH-2 | P0 | Create `docs/PROTOCOL-STATUS.md` as the single human-readable generated summary. | `docs/PROTOCOL-STATUS.md` | Generated file includes date, counts, latest RFC state, latest conformance pass figures, and source files. |
| SH-3 | P0 | Update stale references for RFC 0012, mTLS, reasoning events, registry maturity, hosted docs, and pass rates. | `ROADMAP.md`, `README.md`, `conformance/coverage.md`, `spec/v1/capabilities.md`, `spec/v1/node-packs.md`, `MAINTAINERS.md` | `rg` scan for known stale phrases returns no hits except historical archived docs. |
| SH-4 | P1 | Add a corpus check that distinguishes archived docs from active docs, so historical files can keep old text without confusing status gates. | `scripts/`, `docs/` | Active docs fail on stale status; archived docs are excluded or checked only for links. |
| SH-5 | P1 | Add a "last generated from commit" field to status artifacts. | `docs/PROTOCOL-STATUS.md`, `INTEROP-MATRIX.md` | Readers can match claims to a commit hash. |

### Risks

- Over-generating docs can make routine edits noisy. Keep generated sections small and explicit.
- Historical docs should not be rewritten to hide traceability. Mark them archived and exclude them from active-status checks.

## Workstream 2: Conformance Behavior Coverage

Grade target: B+ to A

### Gaps

- Some coverage is shape-only or test-seam-gated rather than behavior-verified.
- Endpoint coverage still calls out gaps around pause/resume routes, token inspect/resolve matrices, artifacts, and webhook register/unregister.
- Multi-region idempotency, deterministic 429 induction, cross-engine append ordering, and cross-host audit checkpoint export are not yet mechanically strong.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| CF-1 | P0 | Convert the endpoint coverage manifest into generated evidence from `api/openapi.yaml` plus scenario annotations. | `conformance/`, `scripts/`, `conformance/coverage.md` | Every OpenAPI operation lists positive, auth, validation/conflict, and spec-citation coverage. |
| CF-2 | P0 | Add explicit `pauseRun` and `resumeRun` route scenarios. Include running to paused, paused to resumed, idempotent re-pause, running resume conflict, terminal target conflict, and pause-during-suspend race. | `conformance/src/scenarios/pause-resume.test.ts`, reference hosts | Passing scenario against every host that advertises pause/resume. |
| CF-3 | P0 | Add interrupt token matrix coverage. Include expired, malformed, already-resolved, wrong action, wrong token scope, replayed token, and success paths. | `conformance/src/scenarios/interrupt-*.test.ts` | Token inspect and resolve operations are no longer partial in the endpoint manifest. |
| CF-4 | P1 | Add positive artifact read and explicit scope-failure scenarios. | `conformance/src/scenarios/artifact-*.test.ts`, fixtures | `getArtifact` has positive and negative black-box coverage. |
| CF-5 | P1 | Add full webhook register, signed delivery, HMAC mismatch, replay attack, and unregister roundtrip against a test receiver. | `conformance/src/scenarios/webhook-*.test.ts`, `conformance/src/lib/webhook-receiver.ts` | Receiver rejects old timestamp, duplicate signature, wrong algorithm, and bad HMAC. |
| CF-6 | P1 | Add deterministic 429 induction. Prefer a test-only key or env flag such as `OPENWOP_FORCE_RATE_LIMIT=true`. | `conformance/src/scenarios/rate-limit-envelope.test.ts`, reference hosts | Scenario always observes 429 under CI without relying on load timing. |
| CF-7 | P1 | Add positive `configurableSchema` accepted-overlay scenario and `GET /v1/workflows/{id}` schema surface assertion. | `conformance/src/scenarios/configurable-schema.test.ts`, fixtures | Grade can move from C+ to A-. |
| CF-8 | P1 | Add cross-engine append ordering fixture. | `conformance/src/scenarios/append-ordering.test.ts`, multi-engine host fixture | Ordering claim holds outside a single engine loop. |
| CF-9 | P1 | Add public registry tarball-fetch plus signature-verify roundtrip. | `conformance/src/scenarios/registry-public.test.ts` | Public registry grade moves from A- to A. |
| CF-10 | P2 | Add browser/proxy SSE timeout soak outside fast CI. | `conformance/soak/`, docs | Long-running stream reconnect and timeout behavior is reproducible. |
| CF-11 | P2 | Add cross-host audit checkpoint export and re-anchor verifier. | `conformance/src/scenarios/audit-log-integrity.test.ts`, `spec/v1/auth-profiles.md` | A verifier can validate exported checkpoints independent of the host. |
| CF-12 | P2 | Add multi-region idempotency fixture with partition simulation. | `conformance/src/scenarios/multi-region-idempotency.test.ts`, `examples/hosts/postgres/` or a dedicated harness | Scenario demonstrates conflict behavior under partition and recovery. |

### Risks

- Some behavior cannot be black-box verified without a host test seam. When a seam is needed, document it as optional and keep it outside the normative protocol.
- Strict-mode opt-outs must remain honest: a host that does not advertise a profile should skip, not fail.

## Workstream 3: SDK Ergonomics And Cross-Language Parity

Grade target: B+ to A-

### Gaps

- Core SDK parity is strong, but several v1.x surfaces are raw-only: pause/resume, stream buffer/mixed options, webhooks, HMAC verification, debug bundle, registry reads, and some helper predicates.
- TypeScript leads slightly on run-error and status helpers.
- Optional profile helper cadence is not yet tied to conformance additions.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| SDK-1 | P0 | Add pause/resume helpers to TypeScript, Python, and Go. | `sdk/typescript/`, `sdk/python/`, `sdk/go/` | `sdk/PARITY.md` flips pause/resume to typed helpers for all three. |
| SDK-2 | P0 | Add stream option helpers for `streamMode`, mixed modes, and `bufferMs`. | SDK clients and SSE helpers | Consumers no longer need raw query composition for supported modes. |
| SDK-3 | P1 | Add webhook register/unregister helpers and shared HMAC verification helpers. | SDK clients, docs, tests | Webhook rows flip to typed helpers; receiver examples use helpers. |
| SDK-4 | P1 | Add debug-bundle helper with redaction notes and size/truncation metadata types. | SDK clients, types | Debug bundle row flips to typed helper. |
| SDK-5 | P1 | Add registry read helpers for index, manifest, tarball metadata, and signature material. | SDK clients, registry types | Registry rows flip to typed helper or explicitly remain CLI-only by design. |
| SDK-6 | P1 | Add Python and Go helper predicates matching TypeScript: run error codes and terminal statuses. | `sdk/python/src/openwop_client/types.py`, `sdk/go/types.go` | Parity matrix no longer calls out TypeScript-only convenience. |
| SDK-7 | P2 | Add cross-language smoke tests for every helper added above. | `sdk/smoke/` | `bash sdk/smoke/all.sh` covers new helper surfaces. |
| SDK-8 | P2 | Add a parity gate that fails when OpenAPI operations have no typed or explicitly raw-only SDK status row. | `scripts/`, `sdk/PARITY.md` | New routes cannot land without SDK posture. |

### Risks

- SDKs should stay low-dependency. HMAC helpers can use standard libraries in all three languages.
- Do not expose experimental workflow-chain pack helpers until RFC 0013 is accepted.

## Workstream 4: Security, Audit, And Invariants

Grade target: B+ to A-

### Gaps

- External audit is drafted but not sent or scheduled.
- Some reference-implementation security invariants are listed but not mechanically verified.
- High-stakes core packs are built and signed in-tree but public publication is audit-gated.
- Prompt-injection, BYOK, webhook HMAC, audit-log integrity, and node-pack signing all deserve independent review before broad adoption claims.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| SEC-1 | P0 | Refresh and send external audit outreach to at least three vendors. | `SECURITY/outreach/external-audit/STATUS.md` | Outreach dates and reply statuses are recorded. |
| SEC-2 | P0 | Pin the exact audit scope to the current repo state. Update references for RFC 0012, RFC 0013 status, Postgres host, mTLS, memory compaction, and high-stakes pack state. | `SECURITY/external-audit-engagement.md` | Scope matches current files and no longer references stale kickoff assumptions. |
| SEC-3 | P1 | Create `SECURITY/external-audit-findings.schema.json` and placeholder tracker. | `SECURITY/` | Findings can be tracked in machine-readable form once report arrives. |
| SEC-4 | P1 | Promote testable reference-impl-tier invariants into conformance or host smoke tests. | `SECURITY/invariants.yaml`, `conformance/`, `examples/hosts/*/test/` | Each invariant has either a test id or an explicit rationale for non-testability. |
| SEC-5 | P1 | Add receiver-side webhook HMAC replay/mismatch tests. | Conformance and SDK HMAC helpers | Audit can inspect both spec and mechanical enforcement. |
| SEC-6 | P1 | Add cross-provider BYOK matrix and high-volume debug-bundle redaction test. | Conformance, Postgres host tests | Secret redaction holds under provider failures and large bundles. |
| SEC-7 | P2 | Complete audit vendor selection, contract, kickoff, and commit freeze. | `SECURITY/outreach/external-audit/STATUS.md`, `CHANGELOG.md` | Vendor selected and pinned commit recorded. |
| SEC-8 | P2 | Remediate findings and publish public summary. | Affected files, `SECURITY/`, site | All critical/high findings fixed or mitigated before high-stakes pack publication. |

### Risks

- Audit scheduling may exceed 90 days. If so, close all pre-audit mechanical gaps and keep publication gates honest.
- Public audit results can require safety-fix breaks. Route those through the compatibility process.

## Workstream 5: Node Packs, Registry, And Supply Chain

Grade target: B+ to A-

### Gaps

- High-stakes `core.openwop.{ai,http,mcp,triggers}` packs remain audit-gated for public publication.
- Host-side pack-registry consumption is still deferred in places.
- Transitive pack dependencies and registry mirror/federation semantics remain underspecified.
- RFC 0013 workflow-chain packs are draft and should either be accepted with proof or explicitly deferred.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| PACK-1 | P0 | Implement host-side registry consumption in the Postgres reference host: fetch manifest, verify SRI, verify Ed25519 signature, honor lockfile, and reject mismatches. | `examples/hosts/postgres/`, `spec/v1/node-packs.md`, tests | Postgres can consume at least one non-built-in pack from registry or local mirror. |
| PACK-2 | P0 | Add conformance for lockfile honoring and signature failure. | `conformance/src/scenarios/pack-registry*.test.ts` | Host fails closed on tampered tarball, wrong signature, or lockfile mismatch. |
| PACK-3 | P1 | Close NP2: specify transitive dependency resolution, conflict handling, and lockfile representation. | `spec/v1/node-packs.md`, schemas | Dependency graph behavior is normative and schema-backed. |
| PACK-4 | P1 | Close NP3: specify registry mirror/federation discovery, trust roots, and offline behavior. | `spec/v1/node-packs.md`, `spec/v1/registry-operations.md` | Air-gapped and mirrored registries have a documented verification path. |
| PACK-5 | P1 | Publish non-high-stakes external pack author guidance and minimal template. | `docs/recruitment/external-pack-author.md`, examples | Third-party pack author can publish a one-node pack without reading the full spec corpus. |
| PACK-6 | P2 | Publish high-stakes core packs after audit remediation. | `registry/v1/packs/`, hosted registry docs | Public registry serves audited core pack tarballs, manifests, SBOMs, and signatures. |
| PACK-7 | P2 | Decide RFC 0013. Either advance workflow-chain packs to Active with schema/conformance/editor-expansion proof, or mark Deferred until external editor adoption. | `RFCS/0013-workflow-chain-packs.md`, schemas, conformance | RFC state reflects evidence, not aspiration. |
| PACK-8 | P2 | Add pack deprecation, yank, key rotation, and advisory examples. | `spec/v1/registry-operations.md`, `SECURITY/`, registry fixtures | Supply-chain lifecycle is documented and testable. |

### Risks

- Workflow-chain packs are editor-time abstractions. Keep them out of runtime dispatch unless a later RFC proves the need.
- Supply-chain features must fail closed. Avoid "warning only" behavior for signature and lockfile violations.

## Workstream 6: Multi-Agent Semantics And Composition

Grade target: B+ to A-

### Gaps

- AgentRef, reasoning events, dispatch, memory, and conversations are well shaped, but independent real-world multi-agent proof is thin.
- A2A and MCP integration evidence exists, but deeper operational mappings are still shallow.
- Agent identity should map to external identity systems rather than becoming a parallel trust standard.
- Cross-host memory provenance and compaction lineage need stronger end-to-end examples.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| MA-1 | P0 | Add an end-to-end multi-agent sample workflow using orchestrator, dispatch, AgentRef, reasoning events, HITL, and memory. | `examples/`, `docs/`, `conformance/fixtures/` | Sample runs on at least SQLite and Postgres. |
| MA-2 | P1 | Add A2A mapping annex: AgentRef to AgentCard, run/interrupt events to A2A task/message/state changes, and failure semantics. | `spec/v1/a2a-integration.md` | Annex includes lossless and lossy mapping tables. |
| MA-3 | P1 | Add DID-compatible identity mapping note for AgentRef without requiring DID adoption. | `spec/v1/agent-ref.md` or related docs | Agent identity trust story is explicit and non-duplicative. |
| MA-4 | P1 | Add conformance or smoke proof for reasoning event emission across `core.llm.*`, `core.mcp.toolCall`, and dispatch boundaries. | Conformance, Postgres host tests | Reasoning/tool events are paired and causally linked by ids. |
| MA-5 | P1 | Add memory compaction provenance scenario that verifies `sourceIds`, redaction carry-forward, and replay/debug-bundle visibility. | `conformance/src/scenarios/memory-compaction-*.test.ts` | RFC 0012 behavior is fully observable. |
| MA-6 | P2 | Add cross-host parent-child workflow sample that uses A2A or OpenWOP-to-OpenWOP dispatch. | `examples/`, `INTEROP-MATRIX.md` | Cross-host composition evidence is published. |
| MA-7 | P2 | Add multi-agent benchmark or stress fixture: multiple workers, bounded reasoning events, cancellation propagation, and memory TTL. | `conformance/soak/`, examples | Protocol behavior holds under concurrent agent activity. |

### Risks

- Avoid specifying internal planning algorithms. Only standardize externally visible events, identities, capabilities, and failure semantics.
- Reasoning events must stay redacted and policy-governed.

## Workstream 7: Production, Scale, And Operational Proof

Grade target: C+ to B+/A-

### Gaps

- Production profile exists, but high-throughput and multi-region behavior are not deeply proven.
- Backpressure, queue depth, retention expiry, and SSE longevity need soak-style evidence outside fast CI.
- Multi-region idempotency is the weakest protocol behavior grade.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| OPS-1 | P0 | Publish a production-profile runbook with required environment, expected limits, and strict-mode command lines. | `examples/hosts/postgres/README.md`, `docs/` | Operators can reproduce the production claim locally. |
| OPS-2 | P1 | Add load profile scripts for create-run throughput, event polling, SSE streaming, interrupt resolution, and webhook delivery. | `scripts/`, `conformance/soak/` | Repeatable benchmark output with host/version metadata. |
| OPS-3 | P1 | Add long-retention idempotency and replay expiry proof. | Postgres host tests, conformance opt-in | Retention behavior is verified over an accelerated clock or deterministic seam. |
| OPS-4 | P1 | Add deterministic backpressure scenario that does not collide with parallel test files. | Conformance, Postgres host | Backpressure passes in regular CI or documented serial profile. |
| OPS-5 | P2 | Add multi-region idempotency simulation. Include partition, duplicate key in two regions, conflict winner, loser envelope, and reconciliation. | Dedicated harness or Postgres test fixture | Grade moves from C to B+ or better. |
| OPS-6 | P2 | Add operational dashboard examples for OTel traces, queue depth, run backlog, cost metrics, and interrupt latency. | `site/`, `docs/observability` | A production operator can see the protocol health surfaces. |

### Risks

- Do not claim throughput certification from single-machine examples. Label benchmark environments clearly.
- If multi-region requires a real distributed substrate, keep the local simulation honest about what it proves.

## Workstream 8: Standards Interoperability

Grade target: B to A-

### Gaps

- OpenWOP composes well with MCP, A2A, OpenAPI, AsyncAPI, and OpenTelemetry, but mappings to CloudEvents, DID, Serverless Workflow, BPMN, and durable runtimes remain mostly prose.
- Without mapping profiles, prospective adopters may treat OpenWOP as competing with adjacent standards rather than composing with them.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| STD-1 | P0 | Add a standards comparison and composition matrix to active docs. | `spec/v1/positioning.md`, `README.md` | Each adjacent standard has "use with", "do not duplicate", and "mapping status" rows. |
| STD-2 | P1 | Add CloudEvents export mapping for OpenWOP run events. | New `spec/v1/cloudevents-mapping.md`, AsyncAPI notes | Mapping defines `type`, `source`, `subject`, `id`, `time`, and extension attributes. |
| STD-3 | P1 | Add A2A mapping profile beyond roundtrip smoke. | `spec/v1/a2a-integration.md` | Agent/task/message mapping table is conformance-citable. |
| STD-4 | P1 | Add DID-compatible AgentRef identity note. | Agent specs | AgentRef can carry or reference DID without making DID mandatory. |
| STD-5 | P2 | Add Serverless Workflow and BPMN import/export guidance. | `docs/integrations/` or `spec/v1/positioning.md` | Clear statement of what can be converted and what remains host-specific. |
| STD-6 | P2 | Add Temporal/Restate/DBOS implementation notes. | `docs/integrations/` | Runtime implementers see how OpenWOP maps to durable execution primitives. |

### Risks

- Avoid normative dependency on every adjacent standard. Most mappings should be optional profiles or non-normative implementation guides.
- Do not overpromise round-trip conversion for BPMN or Serverless Workflow if OpenWOP-specific AI/HITL semantics do not map cleanly.

## Workstream 9: Governance, Ecosystem, And Certification

Grade target: C+ to B+/A-

### Gaps

- The project has one listed maintainer.
- External host, pack author, and audit outreach are drafted but not sent.
- Vendor-neutral org migration is tripwire-gated and not yet triggered.
- Hosted leaderboard/site work exists but needs live publication and maintenance discipline.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| GOV-1 | P0 | Send external host recruitment outreach. Start with LangGraph, Restate, DBOS, and Inngest. | `MAINTAINERS.md`, `docs/recruitment/external-host.md` | Outreach dates and replies recorded. |
| GOV-2 | P0 | Send external pack author outreach. Start with small-scope APIs where a first pack is realistic. | `MAINTAINERS.md`, `docs/recruitment/external-pack-author.md` | Outreach statuses recorded and follow-up cadence scheduled. |
| GOV-3 | P1 | Publish public conformance leaderboard and badge semantics. | `site/`, `INTEROP-MATRIX.md`, docs | Hosts can link a stable badge with suite version and profile list. |
| GOV-4 | P1 | Add an "implementation certification" guide. | `docs/` | New host authors know how to run, report, and maintain conformance claims. |
| GOV-5 | P1 | Add at least one external reviewer before maintainer promotion, scoped by area. | `.github/CODEOWNERS`, `MAINTAINERS.md` | Non-steward review authority exists even before full maintainer status. |
| GOV-6 | P2 | Land one non-steward host or adapter row in `INTEROP-MATRIX.md`. | `INTEROP-MATRIX.md`, examples/docs | At least one external implementation passes a published conformance subset. |
| GOV-7 | P2 | Promote a non-steward maintainer when criteria are met. | `MAINTAINERS.md`, `GOVERNANCE.md`, `CHANGELOG.md` | Vendor-neutral migration tripwire fires. |
| GOV-8 | P2 | Open vendor-neutral org migration RFC after tripwire. | `RFCS/`, `ROADMAP.md` | Migration plan has public comment and explicit artifact redirect plan. |

### Risks

- Maintainer status should not be granted only for optics. Use reviewer status first if sustained contribution is not yet proven.
- If outreach receives no replies, publish the attempt and sharpen the adoption package rather than silently waiting.

## Workstream 10: Documentation And Developer Adoption

Grade target: B to A-

### Gaps

- The protocol corpus is rich but large. New implementers need a thinner path from "what is this" to "I passed conformance".
- Existing quickstarts are useful but should be tied to certification, profiles, registry, and SDK helper coverage.
- The strongest evidence is scattered across README, INTEROP-MATRIX, coverage docs, archived plans, and host READMEs.

### Tasks

| ID | Priority | Task | Files likely touched | Acceptance signal |
|---|---:|---|---|---|
| DOC-1 | P0 | Add an "Implementer path" doc: minimal host, profile selection, conformance, interop matrix row, badge. | `docs/IMPLEMENTER-PATH.md` | A new host author has a 1-page path. |
| DOC-2 | P1 | Add profile decision guide: minimal, production, multi-agent, registry, high-scale. | `docs/`, `spec/v1/capabilities.md` | Optional profiles are easier to choose and do not look fragmented. |
| DOC-3 | P1 | Add "What OpenWOP does not standardize" examples for model-call SDK shape, internal runtime topology, tool protocol, and cross-process agent messaging. | `README.md`, `spec/v1/positioning.md` | Boundaries are clear to new adopters. |
| DOC-4 | P1 | Add pack author quickstart with signing, SBOM, local registry, publish PR, and deprecation flow. | `docs/`, examples | First external pack author can complete a dry run. |
| DOC-5 | P2 | Add security operator guide: auth profiles, mTLS deployment, key rotation, webhook verification, BYOK redaction, audit-log verification. | `SECURITY.md`, `docs/` | Operators can deploy security profiles without reading all threat models first. |
| DOC-6 | P2 | Add "known limits" page for shape-only coverage, external-gated work, and profiles not widely implemented. | `docs/PROTOCOL-STATUS.md`, `site/` | Adoption trust improves because limits are explicit. |

### Risks

- Avoid marketing-style docs that outrun evidence.
- Keep implementation docs separate from normative spec language.

## Dependency Map

| Dependency | Blocks |
|---|---|
| External audit | Public high-stakes core pack publication, public security confidence, some governance claims. |
| Non-steward host implementation | Working-group path, vendor-neutral migration tripwire, ecosystem maturity grade. |
| Generated status checks | Reliable README/Roadmap/Coverage updates, public trust in conformance numbers. |
| Pack consumption in a reference host | Registry maturity, external pack author confidence, supply-chain conformance. |
| Multi-region fixture | Idempotency grade, production-grade distributed host claims. |
| SDK helper parity | Developer experience, examples, certification guide simplicity. |

## Priority Backlog

### P0: Do First

1. Add generated protocol status and stale-doc checks.
2. Update active docs for known drift.
3. Add pause/resume route conformance.
4. Add interrupt token matrix conformance.
5. Add SDK pause/resume and stream option helpers.
6. Refresh and send audit outreach.
7. Send external host and pack author outreach.
8. Implement Postgres pack consumption with signature and lockfile verification.
9. Add the implementer path doc.

### P1: Next

1. Add webhook receiver, HMAC replay, and unregister roundtrip coverage.
2. Add artifact read/scope coverage.
3. Add deterministic 429 induction.
4. Add positive configurableSchema coverage.
5. Add cross-engine append ordering.
6. Add SDK webhooks, HMAC, debug bundle, and registry helpers.
7. Promote security invariants into tests.
8. Close node-pack dependency and mirror/federation specs.
9. Add multi-agent end-to-end sample.
10. Publish conformance leaderboard.
11. Add standards mapping docs for CloudEvents, A2A, and DID.

### P2: Then

1. Complete audit, remediation, and public report.
2. Publish audited high-stakes core packs.
3. Land one non-steward host or adapter.
4. Open vendor-neutral org migration RFC if maintainer tripwire fires.
5. Add multi-region idempotency simulation.
6. Add production load and SSE soak profiles.
7. Decide RFC 0013 with schema and conformance proof or defer it.
8. Add Serverless Workflow, BPMN, and durable-runtime implementation guides.

## Metrics

Track these in `docs/PROTOCOL-STATUS.md` or the hosted site:

| Metric | Target |
|---|---:|
| Active-doc stale status findings | 0 |
| OpenAPI operations with generated positive coverage | 100% |
| OpenAPI operations with generated negative/auth/validation coverage | 95% or documented exception |
| Optional profile scenarios with behavior coverage when advertised | 90%+ |
| SDK raw-only rows for non-experimental surfaces | 0 |
| Security invariants with test ids or non-testability rationale | 100% |
| Public registry tarball plus signature verification coverage | Passing |
| External audit outreach sent | 3+ vendors |
| External host outreach sent | 4+ targets |
| Non-steward implementations in interop matrix | 1+ short term, 2+ working-group threshold |
| Non-steward maintainers | 1+ migration tripwire, 3 orgs working-group threshold |

## Suggested First Milestone

Name: `v1.2 evidence hardening`

Candidate contents:

- Generated protocol status document and CI check.
- Active-doc stale status cleanup.
- Pause/resume and interrupt-token conformance.
- SDK pause/resume and stream helpers.
- Deterministic 429 scenario.
- Webhook receiver replay/mismatch coverage.
- Postgres pack consumption with lockfile and signature verification.
- Audit outreach sent and tracked.
- External host outreach sent and tracked.

Exit criteria:

- `bash scripts/openwop-check.sh` passes.
- `INTEROP-MATRIX.md` records current host evidence at a commit hash.
- `sdk/PARITY.md` has no raw-only rows for basic run control or stream options.
- `SECURITY/outreach/external-audit/STATUS.md` has sent dates for at least three vendors.
- `MAINTAINERS.md` recruitment log has sent dates for at least four external host targets.

## Suggested Second Milestone

Name: `v1.3 ecosystem proof`

Candidate contents:

- Public conformance leaderboard.
- First external host or adapter row.
- Third-party pack author dry-run.
- Public registry tarball/signature conformance.
- CloudEvents, A2A, and DID mapping docs.
- Multi-region idempotency fixture.
- Production load and stream soak profile.
- Audit vendor selected or audit completed, depending on vendor schedule.

Exit criteria:

- At least one non-steward implementation has public conformance evidence.
- Registry consumption is verified by a reference host and documented for external hosts.
- Multi-region idempotency behavior is no longer shape-only.
- OpenWOP can point to a public security-review schedule or completed report.

## Open Decisions

| Decision | Default recommendation | Deadline |
|---|---|---:|
| Should RFC 0013 advance now? | Defer unless an editor implementation and conformance proof land. | Before v1.3 |
| Should CloudEvents mapping be normative? | Start non-normative; make a profile only after one exporter exists. | v1.2 planning |
| Should DID be required for AgentRef? | No. Provide optional compatibility fields and mapping guidance. | v1.2 planning |
| Should multi-region idempotency require strict behavior? | No. Keep enum levels, but require hosts to advertise honestly and test what they claim. | Before CF-12 |
| Should a Rust SDK start immediately? | No. Demand-gate it on a Rust adopter or external Rust host. | Revisit after GOV-6 |

## Final State

This plan is complete when:

1. Active docs are internally consistent and generated status checks prevent drift.
2. Conformance covers all core OpenAPI operations and the major optional profiles with behavior tests when advertised.
3. The SDKs expose typed helpers for all stable non-experimental surfaces.
4. The high-stakes security surfaces have external audit evidence and remediation history.
5. The registry can be consumed by at least one production-capable reference host with signature and lockfile enforcement.
6. At least one non-steward implementation has public conformance evidence.
7. Governance has begun moving away from single-steward authority, either through external reviewers or a non-steward maintainer.
8. OpenWOP has clear mappings to the adjacent standards it composes with, especially MCP, A2A, OpenTelemetry, CloudEvents, and identity standards.


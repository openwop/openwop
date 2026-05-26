# openwop Spec v1 — Changelog

All notable changes to the openwop v1 spec, schemas, OpenAPI/AsyncAPI, conformance suite, and reference SDKs.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1/) loosely. Versions are spec-corpus-wide (one date, multiple artifact updates per row); per-artifact versions live in their respective `package.json` / schema `$id` fields.

> **Status legend** (per [`/governance/spec-status/`](https://openwop.dev/governance/spec-status/)):
> Stable · Stabilizing · Draft · Experimental — see individual doc headers for current state. The legacy `STUB / DRAFT / OUTLINE / FINAL` vocabulary still appears in older releases below; both are valid in the corpus.

---

## [1.1.5 — unreleased]

### feat(rfc): file RFCs 0067 / 0068 / 0069 — spec-gap Draft cohort (2026-05-26)

Files three additive `Draft` RFCs from `docs/OPENWOP-FEATURE-GAP-ANALYSIS.md` (RFC rows). All additive per `COMPATIBILITY.md` §2.1; no existing required field, event, error code, or endpoint changes.

- **RFC 0067 — Provider-catalog conventions.** Adds the additive optional `capabilities.aiProviders.authModes` map (`{ <providerId>: ("apiKey" | "oauth-pkce" | "oauth-device" | "none")[] }`) so clients can pre-flight how a host expects a provider's credential to be supplied as the catalog grows past API-key providers, plus a non-normative provider-name vocabulary (`openrouter`, `litellm`, `bedrock`, `ollama`, `vllm`, …) on `aiProviders.supported`. Touches `schemas/capabilities.schema.json` + `spec/v1/capabilities.md §aiProviders` (the BYOK auth-mode contract) + new `byok-auth-modes.test.ts`. Default contract unchanged for hosts that omit `authModes`.
- **RFC 0068 — Memory consolidation + standing commitments.** Adds two additive optional capabilities — `agents.memoryConsolidation` (background merge/dedup/strengthen of LONG-TERM memory, distinct from RFC 0062 token-budgeted distillation) + `agents.commitments` (inferred standing intentions that fire a run later) — each with one content-free observability event (`agent.memory.consolidated`, `commitment.fired`). Touches `spec/v1/agent-memory.md` (§"Background consolidation" + §"Inferred commitments") + `schemas/run-event-payloads.schema.json` + `schemas/run-event.schema.json` (RunEventType enum) + `schemas/capabilities.schema.json` + 3 conformance scenarios. Carries an explicit Unresolved-questions entry on whether replay determinism holds through a consolidation pass.
- **RFC 0069 — Host-extension safety contract for `exec`-class tools.** Codifies the existing exclusion as a normative MUST-NOT: arbitrary-command (`exec`-class) execution MUST NOT be a protocol-tier capability — it lives only in named host-extension scopes (`x-host-<vendor>-exec`) with host-owned sandboxing/allowlist/approval/audit. Touches `spec/v1/host-extensions.md` (new §"`exec`-class tools") + `SECURITY/threat-model-prompt-injection.md` (§"`exec` tools") + a new protocol-tier SECURITY invariant `exec-must-not-be-protocol-tier` + an always-on server-free `exec-not-protocol-tier.test.ts` that asserts the corpus defines no exec primitive. No host wire shape changes.

Conformance suite bumps `@openwop/openwop-conformance` 1.7.0 → 1.8.0 (5 new scenarios, all additive/gated). README RFC counts: total 66 → 69, Draft 6 → 9; SECURITY invariants 102 → 103, protocol-tier 70 → 71. All three RFCs `Draft` (open for comment); reference-host implementation deferred per the RFC 0027 §G staging precedent.

### docs+conformance: MyndHyve round-4 — RFC 0058 (both arms) + RFC 0061 (`version: 5`) graduate Active → `Accepted` (2026-05-26)

MyndHyve shipped RFC 0058's loop-iterations arm + RFC 0061 stateful agent-loop same-session as the wall-clock arm. **openwop-side curl-verified** against `https://workflow-runtime-gjw5bcse7a-uc.a.run.app/.well-known/openwop` (revision `workflow-runtime-00390-vuh`): `limits.maxRunDurationMs: 600000` **and** `limits.maxLoopIterations: 100`; `capabilities.multiAgent.executionModel.version: 5` + `statefulResume: true` (`transcriptWindow` honestly omitted). The `POST /v1/host/sample/agentloop/run` seam was independently driven (`{turns:3, suspendAtTurn:2, resume}` → iterations `[1,2,3]`, `resumedIteration: 2` === suspendAtTurn, `workspaceVisible: null`), confirming `agent-loop-version5-shape` / `-iteration-monotonic` / `-stateful-resume` PASS and `-workspace-snapshot` honest soft-skip (RFC 0059 not shipped — §C-permitted). **RFC 0058 fully graduates `Active → Accepted`** — both arms (`runTimeoutMs` + `maxLoopIterations`) now enforced on a verified non-steward host (the loop arm rides RFC 0061's per-`core.orchestrator.supervisor`-turn iteration counter; breach → `cap.breached { kind: 'loop-iterations' }` + `loop_limit_exceeded` + dead-letter), closing the last acceptance box. **RFC 0061 graduates `Active → Accepted`** per `RFCS/0001` §"Promotion to Accepted" (non-steward host advertising `version: 5` + gated scenarios passing). MyndHyve commits `41dc13cce`/`ba8a85387`/`039976086`/`cddc87946`/`099c7f530`. README Active 7 → 5 / Accepted 53 → 55; the autonomous-agent-runtime cohort (0058–0064) is now fully `Accepted`. Round-3 deferrals RFC 0056 + 0062 remain deferred (no product driver; 0062 also waits on RFC 0059). Docs/conformance-evidence only; no schema or wire-shape change.

### docs(rfc-0054): promote run-diff Draft → `Active` + pin the canonical-comparison exclusion list (2026-05-26)

RFC 0054's full wire surface (the read-only `GET /v1/runs/{runId}:diff?against={otherRunId}` endpoint + `run-diff-response.schema.json` + `rest-endpoints.md` §:diff + TS SDK `runs.diff()` / `RunDiffResponse` + `conformance/src/scenarios/run-diff.test.ts` + reference-host endpoint) had landed atomically on `main` via PR #108 but the RFC was left `Draft` — a languishing-Draft-with-complete-impl drift. Promotes RFC 0054 `Draft → Active` and resolves its three Unresolved questions: (1) cross-host diff out-of-scope for v1; (2) the coarse `op` enum (`added`/`removed`/`changed`) kept, richer classification deferred as a backward-compatible refinement; (3) **the canonical-comparison exclusion list is now pinned normatively** in `rest-endpoints.md` §:diff — the comparison key is `(seq, type, JCS(payload-minus-excluded))` with `eventId`/`runId`/`causationId`/`correlationId`/wall-clock `ts`/transport metadata excluded (run-scoped/non-deterministic fields that would otherwise make every cross-run diff report total divergence; `memoryId`/`childRunId` in the observable payload are compared as-is). README Active 6 → 7 / Draft 7 → 6; this supersedes + retires the stale `feat/rfc-0054-run-diff` branch. Additive; no schema or wire-shape change (the surface was already on `main`).

### feat(app): A3 node-attributed memory writes — demo producer + ledger consumption (2026-05-26)

Completes the reference-app side of RFC 0057 per-node memory attribution, complementing the RunTimeline memory-write markers (#192). The host previously emitted only the nodeId-less session-end `memory.written`, so #192's per-lane markers had no node-attributed event to render. This adds the producer: a demo node `local.sample.demo.memory-write` writes a tenant memory entry **mid-run** and emits a **node-attributed** `memory.written` (`ctx.emit` stamps the envelope `nodeId`; the payload also carries `nodeId` per RFC 0057 §B — content-free, identifiers + non-secret tags only). The **Memory ledger** (`RunMemoryPanel`) now reads the run's `memory.written` events to authoritatively mark which entries the run wrote and badge each with the writing node (`✎ <nodeId>`), **gated on `capabilities.memory.attribution.emitsWriteEvents`** with the `run-id:` tag heuristic as the fallback for non-advertising hosts; entry content is still read from the SR-1-redacted read-side (the event is never trusted for content). Builder palette gains the node. New `test/memory-write-node.test.ts` asserts node attribution + the `memory-attribution-no-content` invariant + read-side correlation. App + sample-host only; no protocol-corpus change. Backend `tsc` + the new test pass; frontend `tsc` passes.

## [1.1.4] — 2026-05-26 — MyndHyve cohort live + autonomous-agent-runtime cohort + 19 RFC graduations

Closes the first full week of post-1.1.3 cross-host adoption: the 8-RFC MyndHyve protocol-extension cohort + the 5-RFC autonomous-agent-runtime cohort all reach `Accepted` on production non-steward implementations, the multi-agent execution-model `version: 1-4` ladder closes end-to-end, and three rounds of MyndHyve advertisement land RFCs 0028 / 0029 / 0040 / 0041 / 0055 / 0057. All wire shapes additive per `COMPATIBILITY.md` §2.1.

- **TypeScript SDK 1.1.4** (`@openwop/openwop`) publishes the RFC 0057 `memory.written` typed event helper + the round-2 SDK-migration finishers (`runsClient` / `interruptsClient` / `promptsClient` / `streamsClient` on the published SDK, debug-bundle reverted to SDK after 1.1.3's regression). Python (`openwop-client`) and Go (`openwopclient`) bump in lockstep. No wire-shape changes.
- **Conformance suite `@openwop/openwop-conformance` 1.5.0 → 1.6.0 → 1.6.1 → 1.7.0.** 1.6.0 ships the 28 RFC 0045–0054 cohort scenarios; 1.6.1 patches a stale `secrets.scopes` allowlist in `redaction.test.ts`; 1.7.0 lands the autonomous-agent-runtime cohort coverage (+1 net-new scenario file plus per-RFC behavioral additions). Bundled synthetic SAML IdP fixture lands closing the RFC 0050 deferred conformance gap.
- **MyndHyve protocol-extension cohort live in production (8 RFCs Draft → Accepted in one day).** RFCs 0045 (connector pack manifest), 0046 (`host.credentials`), 0047 (`host.oauth`), 0048 (tenant·workspace·principal identity model), 0049 (RBAC scopes + `authorization.decided`), 0051 (approval & deployment-gate primitive), 0052 (scheduling & time-based triggers), 0053 (dead-letter routing) all graduated on MyndHyve workflow-runtime revision `00211-69w` against `@openwop/openwop-conformance@1.6.0` — **28 PASS / 0 FAIL** (commit `85275cdf` on the MyndHyve side). RFC 0050 (SAML/SCIM) + 0054 (run-diff) stay `Draft` per documented MyndHyve opt-outs.
- **MyndHyve round-3 graduations (3 RFCs Active → Accepted 2026-05-26).** Revision `workflow-runtime-00217-q7c` advertises `capabilities.prompts.agentBindings: true` (RFC 0029), `aiProviders.maxInlineMediaBytes: 10485760` + `modelCapabilities.advertised: ['vision-input', 'image-output']` (RFC 0055), and `capabilities.memory.attribution.{supported: true, emitsWriteEvents: true}` with canonical `memory.written` event dual-emitted alongside vendor `x-host-myndhyve-memory-written` (RFC 0057). Curl-verified on `https://workflow-runtime-gjw5bcse7a-uc.a.run.app/.well-known/openwop`.
- **Multi-agent execution-model roadmap CLOSED end-to-end on a non-steward host.** RFC 0040 (Phase 3 cross-host causation) + RFC 0041 (Phase 4 replay determinism) graduated Active → Accepted on MyndHyve's `multiAgent.executionModel.version: 4` advertisement + `replayDeterminism.{supported: true, llmCacheKeyRecipe: "spec-rfc-0041", refusalDivergenceEmission: true}` block. The `version: 1-4` ladder is fully production-validated; `version: 5` (RFC 0061) opens the autonomous-agent-runtime extension.
- **Autonomous-agent-runtime cohort (7 RFCs filed + 5 graduated).** RFCs 0058 (run-execution bounds), 0059 (agent workspace), 0060 (`host.heartbeat`), 0061 (stateful agent-loop lifecycle, `executionModel.version: 5`), 0062 (`memory.distillation` "dreams"), 0063 (`core.subWorkflow.outputAttestation`), 0064 (`host.toolHooks`) filed `Draft` with Phase-0 architect-decision-batch clearance. Within the cycle: 0059/0060/0062/0063/0064 graduated Draft → Active → Accepted via in-memory reference-host M2 enforcement (each ships the documented `POST /v1/host/sample/*` seam + all scenarios green); 0058 + 0061 graduated to `Active` pending second-host M2 enforcement.
- **RFC 0028 Tier-2 post-promotion strengthening.** Workspace-membership normative + canonical `workspace_membership_required` 403 envelope error code + 2 new protocol-tier SECURITY invariants (`prompt-mutation-workspace-membership-enforced`, `prompt-read-workspace-membership-enforced`), filed in response to a self-disclosed adopter Admin-SDK-bypasses-DB-rules vulnerability — workspace gating now uniformly enforced across write + read paths.
- **Reference-host milestones across all four hosts.** in-memory: 5 M2 host surfaces (RFC 0059/0060/0062/0063/0064). Postgres: RFC 0026 cost-attribution + RFC 0031 model-capability gate + RFC 0040 Phase 3 cross-host causation + RFC 0056 feedback + RFC 0057 memory.written + RFC 0058 `runTimeoutMs` enforcement. SQLite: ports RFC 0022 dispatch/subWorkflow + 0026 + 0031 + 0056 + 0057 + 0058 from Postgres. Reference workflow-engine advertises `capabilities.memory.attribution.emitsWriteEvents: true` + emits on run-summary write. RFC 0031 model-capability gate-decision test seam lands on Postgres flipping the synthetic assertions live.
- **Reference-app — 6 plan items closed end-to-end.** Items #12 (pre-flight workflow validation against advertised engine limits), #13 (dedicated audit-log viewer page at `/runs/:runId/audit`), #15 (multi-turn conversation panel consuming `conversation.{opened,exchanged,closed}` events), #16 (A2A peer placeholder, forward-compat), #20 (Publish-to-registry helper banner), #25 (sticky-note canvas annotations via new `clientOnly: true` `NodeCatalogEntry` flag). The app-buildable plan closes at **23 ✅ / 2 🟡 / 0 ❌**; the two 🟡 items are structurally unblockable from the openwop side and tracked in `docs/myndhyve-round-2-handoff.md`. Multimodal renderer (RFC 0055 §C consumer), media-emitting demo node, persistent HITL artifact cards, notification-system rewrite (Web Push + OS notifications + preferences + quiet hours + flagged review queue) all ship in the same cycle.
- **`vendor.myndhyve.brand@1.1.0` — first non-steward `x-openwop-form` pack** (PR #232). Pilot annotation on `brand.persona.discover.config.json` adds `provider-picker` + `model-picker { dependsOn: ["provider"] }` (RFC 0066 normative cascade-clear). Path-to-Accepted for RFC 0066 unlocks once MyndHyve re-pins the new `manifestHash`. Bonus: `scripts/emit-pin-json.cjs` emits the 7-hash pin-block JSON for any registered pack version.
- **+8 protocol-tier SECURITY invariants** (94 → 102 total; 68 → 70 protocol-tier graduated to gate-verified). New: `authorization-fail-closed` (RFC 0049), `prompt-{mutation,read}-workspace-membership-enforced` (RFC 0028 Tier-2 — paired with a self-disclosed adopter vulnerability close-out), `media-asset-url-tenant-scoped` (RFC 0055), `memory-attribution-{no-content,tenant-scoped}` (RFC 0057), `workspace-cross-tenant-isolation` (RFC 0059 M2), `subrun-merge-approval-fail-closed` (RFC 0063 M2). Every protocol-tier MUST-NOT has at least one public test in `conformance/src/scenarios/`.
- **NEW Draft RFCs filed (12).** 0050 (SAML/SCIM enterprise identity profiles), 0054 (run-diff & execution comparison), 0055 (multimodal envelope variants), 0056 (run feedback & annotations), 0057 (memory write-attribution), 0058–0064 autonomous-agent-runtime cohort (run-execution bounds / agent workspace / heartbeat / stateful agent-loop / memory.distillation / subWorkflow attestation / host.toolHooks), 0065 (workflow node primary-output annotation — advisory `outputRole: "primary" | "secondary"` for chat-surface deterministic-artifact picking), 0066 (`x-openwop-form` vendor extension on pack `configSchema`).
- **Honest non-graduations + opt-outs.** RFC 0058 wall-clock arm took two rounds — MyndHyve initially advertised `maxNodeExecutions` in error, honestly retracted via `docs/openwop-adoption/rfc-0058-round-3-retraction.md`, then landed the real arm on 2026-05-26 (`limits.maxRunDurationMs: 600000` now advertised; `maxLoopIterations: null` honestly absent — host attests run-create clamping + canonical `cap.breached { kind: 'run-duration' }` emission). RFC 0058 stays `Active` pending second-host adoption. RFC 0035 (sandbox), 0036 (multi-region), 0050 (SAML), 0054 (run-diff) opt-outs documented at `docs/openwop-adoption/round-3-closure-2026-05-26.md` with re-evaluation criteria. RFC 0058 round-3 closure agreement loop documented at `docs/openwop-adoption/rfc-0058-round-3-retraction.md`.
- **Multi-agent "Phase N" → version-tagged rename + site regenerated.** External-facing prose drops internal "Phase N" labels for the multi-agent execution model in favor of the wire-shape `version: N` identifier (per the 2026-05-24 external-reader feedback). Site `openwop.dev/spec/v1/*` regenerated to pick up RFC 0045–0057 + cohort promotions + 404 page (PR #164). Reference-app SDK migration finished — `runsClient` / `interruptsClient` / `promptsClient` / `streamsClient` all on the published SDK (cookie-mode SSE stays on native EventSource pending an SDK `credentials: 'include'` hook).
## [1.1.3] — 2026-05-23 — coordinated SDK release for first cross-host adoption

Closes the workflow-engine reference-host pass-rate inflation that the 2026-05-22 external standards-readiness review flagged, lands first non-steward host adoption of four RFCs, and ships the Phase 4 behavioral harness end-to-end. All wire shapes additive per `COMPATIBILITY.md` §2.1.

- **TypeScript SDK 1.1.3** (`@openwop/openwop`) publishes coordinated `parseRefusal()` + `buildReasoningDirective()` helpers. Python (`openwop-client`) and Go (`openwopclient`) bump in lockstep. No wire-shape changes.
- **Workflow-engine reference host pass-rate 80.9% → 95.5%** via two bundled-path bugfixes (`envelopeAcceptor.ts` schema lookup + `promptStore.ts`/`promptCompose.ts` fixtures lookup) — both cases of `__dirname + '..' × N` overshooting under the esbuild-bundled tree. New shared `_repoPath.ts::locateRepoDir()` helper + 5-test regression guard. The inflated 129-failure number was a cascade from a single `ENOENT` crash, not 129 real conformance gaps.
- **RFC 0041 §B Phase 4 closes** — replay-divergence-at-refusal executor wiring lands the last `it.todo` from the 5-track audit harness. The workflow-engine's `:fork mode: replay` path now emits `replay.divergedAtRefusal` and fails with `error.code: 'replay_diverged_at_refusal'` when an envelope kind diverges between source and replay (both directions). Gated on `OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4=true`. RFC 0041 path-to-Accepted opens (gate: second host advertising `multiAgent.executionModel.version: 4`).
- **Phase 4 behavioral harness — Tracks 1/2/5/6/7 + RFC 0042 close.** Three new HTTP test-seam endpoint families on the reference workflow-engine drive five new conformance scenarios: multi-region partition simulator, cross-engine append-ordering harness, sandbox MVP (7-of-8 RFC 0035 §B invariants), secret-leakage OTel-attribute coverage, RFC 0042 experimental-tier shape probe. Suite scenario count 205 → 210. NEW `spec/v1/host-sample-test-seams.md` §6–§8 documents the new seams normatively.
- **First non-steward cross-host adoption.** MyndHyve (`api.myndhyve.ai`) ships Tier-1 advertisements for RFC 0021 (envelope), RFC 0027 (prompt templates with `observability: 'full'`), RFC 0028 (read-only prompt library), RFC 0029 (override hierarchy, node layer), RFC 0034 (OTel test seam, empty-buffer Tier-1), RFC 0039 Half B (memory lifecycle MAE-2 + MAE-3, `crossChildMemoryConcurrency: 'strict'`), RFC 0040 Sub-5b (MCP API-key auth). Verified live against `/.well-known/openwop`.
- **RFC promotions Active → Accepted (5 total this release):** **0027** (prompt templates) — first non-steward `prompts.supported: true` + `observability: 'full'`; **0034** (OTel collector test seam) — first non-steward Tier-1 seam-shape adoption; **0037 Phase 1** (multi-agent execution model) — first vendor-neutral validation signal; **0039 Half A** (multi-agent confidence + memory lifecycle) — cross-host evidence via MyndHyve commit `c4342b5b` against suite v1.5.0; **0044** (confidence-escalation interrupt-kind advertisement, clarification to RFC 0039 §A).
- **NEW Draft RFCs.** **0042** (experimental capability tier — `tier ∈ {stable, experimental}` + `experimentalUntil` ≤ 12-month sunset + derived `openwop-experimental` profile + conformance soft-skip routing under default mode). **0043** (registry + extension policy + IPR posture — consolidates DCO + Apache-2.0 + CC-BY-4.0 + namespace reservation rules).
- **Vendor-namespace pattern locked.** MyndHyve picked Option 1 (`x-host-myndhyve-memory-written`) per `host-extensions.md` §"Canonical prefixes" for host-private SR-1 audit events. Preserves wire-shape compat with strict RunEventType validators; the canonicalize-via-RFC path stays open for any second host that wants the same shape.
- **Honest correction — `registerHostSampleRoutes` wire-up bug.** MyndHyve's `/v1/host/sample/*` routes were deployed for days but never wired into the runtime (404 in production until commit `60b569de`). Four seams affected (RFC 0027 §E compose, RFC 0041 §A cache-key, RFC 0021 envelope-accept, RFC 0034 OTel scrape). All four now exercisable end-to-end; RFC 0027 status stays Accepted (the advertisement was real; the bug was wire-up, not logic).
- **Audit response artifacts.** NEW `docs/AUDIT-RESPONSE-2026-05.md` (point-by-point reply to the 2026-05-22 external review with calendar tripwires). NEW `docs/CONFORMANCE-RUNS-2026-05.md` (re-measurement of all 4 reference hosts against `@openwop/openwop-conformance@1.4.0` + per-failure taxonomy). NEW `docs/PHASE-4-PROGRESS.md` (Phase 4 close-out accountability with closing-commit citations).
- **Conformance suite 1.4.0 → 1.5.0.** RFC 0044 vendor-kind routing relaxation splits one strict-equality assertion into discrete `it()` blocks (+6 tests, +6 passes). Postgres 1473/1564 (94.2%), SQLite 1486/1564 (95.0%), in-memory 1445/1564 (92.4%), Python 1387/1564 (88.7% total / 100% of applicable).
- **Reference workflow-engine + sample-app polish.** Real-LLM default in the builder (`vendor.openwop-sample.chat-responder` replaces the deterministic `mock-ai` node + managed `openwop-free` credential tile by default); Copy/Export buttons on the event-stream view; Cloud Run deploy-plumbing close-out (vendored `schemas/` + dual-mount `conformance-fixtures/` so the bundled host resolves sibling-repo paths under `/app/lib`); `.gitignore` for harness runtime state (`*.db-shm`/`*.db-wal`, `.byok-master-key`, `host-fs/`).
- **Site shipped at openwop.dev** (2026-05-21). 13 new content pages + REST API explorer (Redoc) + AsyncAPI + gRPC transport explorers + JSON-LD `TechArticle` structured data on every spec doc. Star-on-GitHub CTA in the marketing footer.

---

## [1.1.2] — 2026-05-21 — gap-closure batch + envelope-hardening track + ecosystem launches

The first patch release after v1.1.1 closes every gap from the 2026-05-19 → 2026-05-21 batch covering the envelope LLM-contract-hardening RFCs, the prompt-library track, the dispatch primitives, the multi-agent execution model, the agent-pack catalog, and the marketing-site launch at openwop.dev. All wire shapes additive per `COMPATIBILITY.md` §2.1.

- **TypeScript SDK 1.1.2** (`@openwop/openwop`), Python (`openwop-client`), Go (`openwopclient`) all bump in lockstep. Conformance suite `@openwop/openwop-conformance` 1.1.1 → 1.4.0 over the release window (1.2.0 / 1.3.0 / 1.4.0 minor bumps for new behavioral scenario families).
- **Marketing site shipped to openwop.dev** (2026-05-21). First public surface for the protocol. Multi-page spec corpus rendered from `spec/v1/*.md`, demo card, Star-on-GitHub CTA. Companion `app.openwop.dev` workflow-engine sample app deployed in parallel.
- **`spec/v1/ai-envelope.md` DRAFT → FINAL v1.1** (2026-05-18). Closes the AI Envelope specification gap that was the largest remaining v1.0-era hole. Normative for envelope-acceptor wire shape, refusal kinds, capability stacking, and SR-1 secret redaction.
- **Envelope-hardening track (RFCs 0030–0033) filed + promoted Draft → Active → Accepted in 4 days** (2026-05-20 → 2026-05-21). **0030** envelope `reasoning` field + Tier-1 structured-output subset. **0031** envelope variant discrimination + model-capability declarations. **0032** envelope-reliability run-event vocabulary. **0033** envelope-completion contract (truncation vs schema-violation retry routing). Reference-host emission landed in `dispatchStructured()`; conformance scenarios cover all four RFCs end-to-end.
- **Prompt-library track (RFCs 0027 / 0028 / 0029) filed Draft + promoted Active** (2026-05-19 → 2026-05-20). RFC 0027 (prompt templates) reference-host implementation + Phase A wire shape + 4-kind dispatch wiring + `slotIndex` correctness. RFC 0028 (prompt library endpoints) reference-host `/v1/prompts*` endpoints + PromptStore + example prompt pack. RFC 0029 (prompt override hierarchy) four-layer resolver + `/v1/host/sample/prompt/resolve` seam. RFC 0027 §F shared `divergencePoint` schema diff.
- **Multi-agent track filed Draft.** **RFC 0035** (sandbox execution contract), **RFC 0036** (multi-region + cross-engine), **RFC 0037** (multi-agent execution model Phase 1 — first vendor-neutral validation tripwire), **RFC 0039** (multi-agent Phase 2 confidence-floor escalation + memory lifecycle MAE-2/MAE-3), **RFC 0040** (Phase 3 cross-host causation), **RFC 0041** (Phase 4 replay determinism under nondeterministic models). RFC 0037 Phase 1 promoted Draft → Active same day with reference-host wiring + behavioral conformance.
- **RFC 0034 (OTel collector test seam) filed Draft → Active** (2026-05-21). Replaces the failed POST-based shape with a GET-based scrape after the standards-readiness review surfaced the POST→GET reconciliation gap.
- **RFC promotion cohort Active → Accepted (15 RFCs):** **0013** (workflow-chain packs — Draft → Active → Accepted same day on Phase 4 in-tree example landing); **0014–0021** graduation cohort (8 capability RFCs — behavioral conformance via opt-in test seam); **0022** (`core.dispatch` + `core.subWorkflow` runtime variable mapping — Postgres reference impl + dispatch trio); **0023** (conformance agent-event emitters); **0024** (streaming `agent.reasoned` deltas + SDK typed-helper rollout); **0026** (`provider.usage` event — filed Draft → Active → Accepted same day); **0030 / 0031 / 0032 / 0033** envelope-hardening track promoted Active → Accepted at the close of the release window.
- **5 new Draft RFCs filed against the 2026-05-21 standards-readiness review findings.** Each maps to a specific audit finding; full close-out lands in 1.1.3's Phase 4 harness work.
- **Agent pack catalog** (4 tiers, 28 packs total). Phase 1 — Tier 0/1 foundations (9 packs). Phase 2 — Tier 2 productivity skills (5 packs). Phase 3 — Tier 3 vertical agents (10 packs). Phase 4 — Tier 4 crews + skills-bridge (4 packs). Catalog seeded with reference manifests + signing material for downstream registry publication.
- **17 `core.openwop.*` packs published to `packs.openwop.dev`** under steward-internal pre-audit (2026-05-17). First non-trivial registry population. Includes pre-publication triage finding: `core.openwop.http@1.1.2` (idempotency-key generator made deterministic), `core.openwop.data@1.2.1` + `core.openwop.crypto@1.0.2` (correctness fix for nodes mis-declared as `pure`), `core.openwop.ai@1.1.1` + `core.openwop.crypto@1.0.3` (defensive parsing of model output + JWT shapes), `core.openwop.ai@1.1.2` + `core.openwop.mcp@1.1.1` (UNTRUSTED-marker discipline on `ctx.trustBoundary='untrusted'` runs), `core.openwop.agents@1.0.1` (raw-JS tool handler — closes `OPENWOP-AUDIT-2026-003`). Old `core.openwop.ai@1.1.1` + `core.openwop.mcp@1.1.0` marked deprecated.
- **Pack patches: SSRF + JWT alg-confusion fixes (P0.1)** (2026-05-17). Yank-and-republish on the affected versions.
- **Workflow-chain packs (RFC 0013)** — Phases 1–4 land in sequence. Reference example at `examples/branching-workflow/`. Phase 4 in-tree example demonstrates chain-pack composition end-to-end.
- **`apps/workflow-engine@P3`** — Firebase Auth signup + Cloud SQL persistence + KMS-encrypted BYOK (2026-05-17). Production rollout fixes (post-mortem) (2026-05-18). First fully-managed reference deployment serving as the `app.openwop.dev` surface.
- **Workflow-engine sample app — 30+ feature commits** covering: BYOK canary echo node + provisioning, `core.channelWrite` + append-with-TTL reducer, `capability_not_provided` refusal contract, idempotency body-hash mismatch, quorum-aware approval gate, `recursionLimit` + `conversationPrimitive` refusal, `core.subWorkflow` executor + variable mutation seam, JSON content negotiation, `getWorkflow` endpoint + strict `streamMode` validation, bulk-cancel endpoint + idempotency replay header, MCP discovery shape + approval resume validation, fixture input-port → variable resolution, credential-shape redaction, cache hit semantics + debug-bundle endpoint, fs absolute-path rejection + `kv.cas` canonical shape, events/poll `lastSequence` + SSE `bufferMs` aggregation, prompt-library UI staging, managed "Try it free" provider tile, RFC 0022 dispatch cluster, parent/child cancel-cascade interrupt profile, external-event interrupt support, AI chat viewport-lock + Lucide thumbs icons.
- **Storage adapter parity harness** — SQLite vs Postgres via `pg-mem` (2026-05-18) + real Postgres via `@testcontainers/postgresql` for end-to-end behavioral fidelity. Closes the storage-adapter parity gap from the v1.1.0 close-out.
- **Conformance close-outs**: 7 `aiEnvelope.*` scenarios graduated from shape probes to behavioral assertions (2026-05-18); `agent.toolReturned` causationId pairing tightened; envelope-track `it.todo` placeholders drained (sub-tracks E + E2 + A.reasoning-redaction); `OPENWOP_REQUIRE_BEHAVIOR` wired across the prompt-* scenario family; soak-gate close-out (opt-out axes + SQLite artifact stub).
- **Untrusted-content propagation, persisted envelope-correlation dedup, downstream-LLM untrusted-content wrap, envelope-contract capability stacking refusal, approval-gate trust-boundary refusal** — five protocol-tier behavioral hardening rows close in the sample-host (2026-05-19).

---
## [1.1.1] — 2026-05-15 — post-1.1.0 additive cleanup + RFC 0012

Six additive commits landed on `main` after the v1.1.0 release tag. None changes a wire shape; all ship in a 1.1.1 patch when the registry SDKs are next published. Two close adopter-experience footnotes (lockfile demo + community pack re-sign), one closes a conformance-probe scope limit (MCP transports), and three close the RFC-process self-acceptance loop (0008 promotion + node-packs §WASM cross-link, 0001 promotion + CHANGELOG status drift fix).

- **Workspace lockfile demo** (`daeaef5`) — `examples/core-packs-lockfile/openwop-pack-lockfile.json` + README pins the 4 audit-gated core packs (`core.openwop.{ai,http,mcp,triggers}@1.0.0`) using the `pack-lockfile` schema. Demonstrates SRI integrity + Ed25519 signature material for offline / air-gapped resolution. Closes the controllable half of the "build + sign + lockfile in-tree" Phase E task; the audit-blocked half (publication to `packs.openwop.dev`) remains gated on `SECURITY/external-audit-engagement.md` §2.1.
- **`community.openwop-team.demo` re-signed** (`0bf08cc`) — Option-B reconciliation of a 3-way signing-identity drift. The demo pack now ships signed by `community-openwop-team-demo-1` (over canonical `pack.json`) instead of `openwop-registry-root` (over tarball), matching PACKS-MVP-PLAN.md §211's per-tier-key intent and illustrating the per-publisher-identity pattern. New `registry/keys/community-openwop-team-demo-1.pub` + `signingKeys[]` entry in `registry/.well-known/openwop-registry.json` (namespace-scoped to `community.openwop-team.demo` only — cannot sign for `core.*` or `vendor.*`). Canonical verifier (`registry/scripts/verify-signatures.mjs`) passes 29/29.
- **MCP probe scope-limit footnote closed** (`beb5ae6`) — all three MCP transports now verified end-to-end against `@modelcontextprotocol/sdk@1.29.0`. SSE-streamed responses verified via the same SDK without `enableJsonResponse` (probe's existing `readSseUntilId` correlates frames by JSON-RPC id). Stdio transport — HTTP-incompatible by design — exercised via the new `examples/mcp-stdio-bridge/` shim that wraps any newline-delimited-JSON-RPC stdio server as HTTP for the probe (bundled `echo-stdio-server.mjs` + per-session-id child-process lifecycle; 2/2 pass). `INTEROP-MATRIX.md` §"Composition partners" MCP row + `spec/v1/mcp-integration.md` §"Conformance + interop" + `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 6 all updated to retire the previous scope-limit language.
- **RFC 0008 (WASM ABI) promoted Active → Accepted** (`6118cce`, 2026-05-13) — all 8 acceptance-criteria items satisfied. The one previously-stuck gap (`spec/v1/node-packs.md` §"WASM runtime" cross-link) landed in the same commit with a 6-scenario coverage table mapping each `wasm-pack-*.test.ts` to its RFC 0008 anchor. The previously-stale `Open spec gaps` row `NP1 — WASM ABI for language: wasm packs` flipped to ✅ closed. README + CHANGELOG status banners refreshed to reflect 0008/0009/0010/0011 all Accepted.
- **RFC 0001 (RFC process) promoted Active → Accepted** (`20e0d1c`, 2026-05-13) — closes the meta-RFC's self-acceptance loop. All 6 acceptance-criteria items confirmed: `RFCS/README.md` + `0000-template.md` + this file shipped together; `GOVERNANCE.md` cross-references `RFCS/` at five locations; `CHANGELOG.md` records the RFC process landing; `rfc` PR label created in the public repo (`#5319e7` purple, description references the process RFC). Subsequent normative additions land under standard RFC review rather than the bootstrap waiver pattern. Same commit fixed CHANGELOG status drift for RFCs 0009/0010/0011 (had been stale at `Active` even though all three were promoted to `Accepted` 2026-05-12).
- **Final RFC ladder state (2026-05-13):** RFCs 0001–0011 all `Accepted` (11 total). 0000 is the template scaffold; 0012 (memory compaction) is parallel-session `Draft`. Every RFC with a satisfied acceptance checklist is now promoted.
- **RFC 0012 (Memory Compaction Profile) Active → Accepted (2026-05-15)** — comment window waived per `CONTRIBUTING.md` §"Bootstrap-phase notes" (sole-steward repo, no non-steward maintainer of record, no external commenters during the 48h the window was open). All 6 acceptance criteria satisfied at promotion time. RFC ladder state: **0001–0012 all `Accepted` (12 total)**. 0000 is the template scaffold. Future RFCs revert to the canonical 7-day comment window once `MAINTAINERS.md` lists a non-steward maintainer.
- **RFC 0012 (Memory Compaction Profile) Phase 3 prep landed 2026-05-14** (promoted to `Accepted` 2026-05-15 under the bootstrap waiver above):
  - **Reference host** — `examples/hosts/postgres/src/memory-adapter.ts` gains `runCompaction` + `applyCompactionRedaction` + `REFERENCE_COMPACTION_CAPABILITY`. Server.ts conditionally advertises `capabilities.memory.compaction` when `OPENWOP_MEMORY_COMPACTION=true` and exposes the test seam at `POST /v1/test/memory/{seed,compact}` when `OPENWOP_TEST_TRIGGER_COMPACTION=true`. SR-1 carry-forward (RFC 0012 §D) honored by re-substituting `[BYOK:...]` form-leaks + non-canonical `<REDACTED:...>` markers with `[REDACTED:carry-forward-<n>]` BEFORE the derived entry persists. Output entries carry the `compacted-from:<id>` provenance tag per §C.
  - **3 conformance scenarios** — `memory-compaction-event-emitted.test.ts` (canonical §B payload shape), `memory-compaction-sr1-carry-forward.test.ts` (load-bearing §D — replaces the Phase 2 `it.todo()` stub), `memory-compaction-provenance-tag.test.ts` (soft assertion on §C). All three gate on `capabilities.memory.compaction.supported` + test seam reachability. 3/3 pass live against the Postgres reference host.
  - **Host smoke** — `examples/hosts/postgres/test/memory-compaction.test.ts` verifies 7 paths end-to-end (advertisement + seed + compact + outputId readability + SR-1 §D + provenance + empty-noop).
- **RFC 0012 (Memory Compaction Profile) Draft → Active (2026-05-13)** — opens the 7-day public comment window (closes 2026-05-20). New optional `capabilities.memory.compaction` advertisement + `memory.compacted` canonical event + SR-1 carry-forward invariant for any host that distills short-lived `MemoryEntry` rows into longer-lived ones. Additive per `COMPATIBILITY.md` §2.1.
- **Tarball-fetch + signature-verify roundtrip vs `packs.openwop.dev` (2026-05-13)** — `conformance/src/scenarios/registry-public.test.ts` gains a 4th `describe` block that fetches `core.openwop.examples@1.0.0`'s tarball + `.sig` + publisher public key from the live registry, asserts SRI integrity matches a fresh SHA-256 of the tarball bytes, and runs Ed25519 verification per `node-packs.md` §"Signing recipe" (`method=ed25519` signs the whole tarball). Closes `coverage.md` row 34's "Remaining: tarball-fetch + signature-verify roundtrip" gap. 6/6 tests pass against live `packs.openwop.dev`.
- **Strict-mode opt-out signaling (2026-05-13)** — new `OPENWOP_OPTED_OUT_PROFILES=name1,name2` env var consumed by `conformance/src/lib/behavior-gate.ts` distinguishes "host opted out (honest minimal posture)" from "host claims but doesn't deliver (bug)". Strict mode (`OPENWOP_REQUIRE_BEHAVIOR=true`) skips opted-out profiles with a "honest opt-out" log line instead of failing. SQLite + Python reference hosts can now achieve strict-mode green without falsifying capability claims. Advertise + opt-out conflict surfaces a loud warning so typos don't mask real bugs.
- **Batch A — adopter-facing prose refresh (2026-05-13):**
  - `examples/hosts/postgres/conformance-full.md` + `INTEROP-MATRIX.md` re-measured against suite v1.1.0 with conditional-profile env vars: **781/850 (91.9% total, 95.2% of non-todo, 96.4% of applicable)** — up from 728/797 the prior measurement. +53 scenarios + +53 passes net of Phase H/I capability surfaces + 9 stage5 vendor packs. One failure remains: documented `webhook-signed-delivery` flake (passes in isolation; full-suite timing collision).
  - `docs/migration/v1.0-to-v1.1.md` — new adopter-facing "what's new" guide. Documents v1.1 as purely additive per `COMPATIBILITY.md` §2.1: every v1.0 conformance pass remains valid, no code changes required for v1.0 implementations. Per-capability sections walk through Phase H (BYOK / AI providers / MCP / HTTP / cap-breach kinds) + Phase I (memory / agents / auth profiles) + Phase G (spec-corpus close-out) with cross-links to RFCs + conformance scenarios. Linked from `README.md` §"Document index".
  - `ROADMAP.md` §"v1.2 outlook (projected)" — new gate-conditioned projection of v1.2 candidates: RFC 0012 memory compaction, WASM Component Model sub-RFC, Rust SDK v0.1 (demand-gated), 4 audit-gated `core.openwop.*` packs, cross-host SSE replay, mTLS termination on Postgres, multi-region idempotency end-to-end fixture. Each item carries its specific gate (RFC comment window / external audit / capability flag / adopter ask) — no fixed calendar; items move to next minor or `Withdrawn` if no signal.
  - `sdk/python/QUICKSTART.md` + `sdk/go/QUICKSTART.md` — new 5-minute end-to-end walkthroughs that boot the in-memory reference host on your laptop, run a workflow against it, and read the event log. Both READMEs link to the new quickstarts.
- **Batch C — conformance coverage close-outs (2026-05-13):**
  - **Multi-region idempotency convergence-rule resolver** (Track 13) — new `examples/hosts/postgres/src/multi-region.ts` ships the canonical algorithm for `idempotency.md` §"Multi-region idempotency" §"Convergence rule": lex-min(`runId`) wins, losers get `run.cancelled { reason: 'cross_region_dedup_loss' }`, every region's cache redirects to the winning runId. Pure function — same inputs → same outcome regardless of caller order, region, or wall clock; two regions running the resolver independently arrive at the same survivor without coordination. Smoke test (`test/multi-region-idempotency.test.ts`) verifies 6 paths including label-determinism for the operator-tier `openwop.idempotency.cross_region_conflicts_total` counter. Conformance scenario (`multi-region-idempotency.test.ts`) extended to also verify that hosts claiming `crossRegion: 'best-effort'` or `'strict'` advertise the operator metric per §"Operator surface". The Postgres reference host stays single-region (`crossRegion: 'single-region'`); the resolver is operator-adoption-ready for any future multi-region host.
  - **Cross-host trace-context propagation across `core.subWorkflow`** (Track 11 remaining row) — new `conformance/src/scenarios/otel-trace-propagation-subworkflow.test.ts` closes the previously-partial gap on `coverage.md` row 52. Asserts: when a parent run is started with an inbound `traceparent` and contains a `core.subWorkflow` node, the dispatched child run's spans MUST share the parent's traceId. Distributed traces stitch across the dispatch boundary without operator-side correlation hacks. Gates on `capabilities.observability` + `conformance-subworkflow-parent` fixture advertisement + `OPENWOP_OTEL_COLLECTOR=true`. `coverage.md` Observability row + per-scenario row both flipped to **A (full coverage)**.
- **Batch B — Postgres reference host additive surfaces (2026-05-13):**
  - **Phase I.2 reasoning-event emission wiring** — Postgres host's `core.llm.chat` / `core.llm.completion` executors now emit `agent.reasoned` (verbosity-gated per `RunOptions.configurable.reasoningVerbosity` → host default fallback `"summary"` with 512-token cap) + `agent.decided` (confidence ∈ [0,1]) after a successful AI-proxy call. `core.mcp.toolCall` emits `agent.toolCalled` BEFORE the call (carrying `argumentsSha256`) and `agent.toolReturned` AFTER (paired via shared `callId`, with `outcome.{resultSha256,resultLength,isError,durationMs}` on success or `error.{code,message}` on failure). SR-1 + MCP-1 preserved end-to-end: only SHA-256 digests + lengths + outcome flags appear on payloads — never raw tool arguments or result content. Verified by `examples/hosts/postgres/test/reasoning-event-emission.test.ts` via two new host-private fixtures (loaded through the `OPENWOP_EXTRA_FIXTURES_DIR` test seam — these typeIds are implementation-specific and not yet protocol-normative).
  - **Phase I.7 mTLS termination** — Postgres host now claims `openwop-auth-mtls` end-to-end when `OPENWOP_MTLS_CERT_PATH` + `OPENWOP_MTLS_KEY_PATH` are set. HTTP listener switches to `node:https.createServer({ requestCert: true, rejectUnauthorized: OPENWOP_MTLS_REQUIRED !== 'false' })`; `OPENWOP_MTLS_CA_PATH` is optional (when present, only client certs signed by that CA bundle pass the handshake). Discovery emits `capabilities.auth.mtls.{supported: true, required: <bool>, subjectMapping: 'cn'}` only when configured (honesty principle). Verified end-to-end by `test/mtls.test.ts` (advertisement shape + valid-cert 201 + no-cert TLS handshake rejection). The existing `conformance/src/scenarios/auth-mtls.test.ts` now flips from "Not claimed" to a verified positive path when the Postgres host is launched with `OPENWOP_MTLS_*` configured.

---

## [1.1.0] — 2026-05-12 — openwop v1.0 close-out + additive features

The close-out release for v1.0. The protocol contract was frozen on 2026-05-08 (see the spec-freeze entry below) and first published as v1.0.0 on 2026-05-11 (see entry below). This 1.1.0 release closes every controllable gap from the 2026-05-10 deep-dive review and the 2026-05-12 architectural re-evaluation, hardens the Postgres reference host to production-runtime parity, and lands 18 additive feature surfaces (Phase H launch-blockers + Phase I enterprise-blockers).

All changes in this release are **additive per `COMPATIBILITY.md` §2.1** — no existing required fields changed type or optionality, no event-type shape changed, no endpoint contract relaxed, no existing `MUST` weakened. Hosts that were v1.0.0-compliant remain v1.x-compliant; this release just adds new capability surfaces that hosts may now advertise + new conformance scenarios that gate on those advertisements.

Per-track closure status is tracked in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` (archived 2026-05-12); per-host conformance evidence lives in `examples/hosts/*/conformance.md` + `INTEROP-MATRIX.md`.

### Spec corpus state

- **29 prose specs** at `Status: FINAL v1`. Zero `DRAFT` / `STUB` / `OUTLINE` tags remain. New additions since 2026-05-08 freeze: `auth-profiles.md`, `capabilities-change-detection.md`, `grpc-transport.md`, `i18n.md`, `compliance.md`, `host-capabilities.md`, `production-profile.md`, `replay.md` retention/expiry annex, `node-packs.md` lockfile + Component-Model annexes.
- **22 first-class JSON Schemas** under `schemas/`, all JSON Schema 2020-12 with `$id` at `https://openwop.dev/spec/v1/<name>.schema.json` and `additionalProperties: false` on every object. New: `agent-manifest`, `agent-ref`, `memory-entry`, `memory-list-options`, `audit-verify-result`, `pack-lockfile`, `orchestrator-decision`, `dispatch-config`.
- **OpenAPI 3.1** (`api/openapi.yaml`) — every endpoint has `operationId` + `tags` + ≥ 1 error response; every schema referenced via cross-file `$ref`. Lints clean under `redocly lint`. New operations: `verifyAuditLog`, `bulkCancelRuns`.
- **AsyncAPI 3.1** (`api/asyncapi.yaml`) — every channel binds to a message + payload schema reference. Lints clean under `asyncapi validate`.
- **gRPC transport profile** (`api/grpc/openwop.proto` + `spec/v1/grpc-transport.md`) — canonical `openwop.v1.Engine` service; profile-gated via `capabilities.supportedTransports: ["grpc"]`.

### RFCs landed

- **RFC 0001** — RFC process itself (`Accepted`).
- **RFC 0002** — Agent identity + reasoning events (`Accepted`).
- **RFC 0003** — Agent packs (`Accepted`).
- **RFC 0004** — Memory layer + `MemoryAdapter` contract (`Accepted`).
- **RFC 0005** — Conversation as run primitive (`Accepted`).
- **RFC 0006** — Orchestrator-supervisor role (`Accepted`).
- **RFC 0007** — `core.dispatch` core node (`Accepted`).
- **RFC 0008** — WASM ABI (`Accepted` 2026-05-13) + Component-Model variant annex.
- **RFC 0009** — Production-profile conformance (`Accepted` 2026-05-12).
- **RFC 0010** — Auth-profile conformance + v1.0 closure umbrella (`Accepted` 2026-05-12).
- **RFC 0011** — Auth-scoped discovery (`Accepted` 2026-05-12).

### Multi-Agent Shift (RFCs 0002–0007 + RFC 0008)

- Phase 1 — `AgentRef` wire shape; `agent.reasoned` / `agent.toolCalled` / `agent.toolReturned` / `agent.handoff` / `agent.decided` events; `confidence` escalation contract (CP-1); `message` reducer.
- Phase 2 — Agent capability discovery on `/.well-known/openwop`; `pack.json` `agents[]` extension; agent-pack manifests.
- Phase 3 — Agent memory layer: `memoryRef` resolution + redaction (SR-1) + cross-tenant isolation (CTI-1) + host `MemoryAdapter` contract.
- Phase 4 — Conversation as run primitive: `conversation.start` / `conversation.exchange` / `conversation.close` suspend variants.
- Phase 5 — Orchestrator-supervisor: `core.orchestrator.supervisor` typeId + `OrchestratorDecision` schema + `runOrchestrator.decided` event.
- Phase 6 — `core.dispatch` core node: conservative dynamic graph mutation (CP-2); causationId propagation per RFC 0007 §E.
- WASM ABI — RFC 0008 Active; reference Rust pack at `examples/packs/rust-hello/` (28 KiB wasm32); Wasmtime-free loader at `examples/hosts/in-memory/src/wasm-loader.ts`; six conformance scenarios; deliberately-misbehaving packs for memory-cap (`examples/packs/rust-misbehaving-memory/`) and ABI-mismatch (`examples/packs/rust-misbehaving-abi/`) positive-path testing. Schema extension: `capBreached.kind` enum gained `wasm-memory`, `wasm-fuel`, `wasm-execution-time` (RFC 0008 §K). New optional capability `capabilities.nodePackRuntimes.wasm.loadedPacks[]` surfaces accepted pack names; rejected packs (declared ABI not in `abiVersions[]`) MUST be absent — drives the conformance positive path since rejection happens at load time before any node-invoke surface.
- OTLP/gRPC collector (Track 11 closure) — `conformance/src/lib/grpc-framing.ts` (hand-rolled length-prefixed gRPC HTTP/2 framing, zero npm deps) + `OtelCollector.startGrpc()` (parallel `node:http2` server, shared spans/metrics store). New optional capability `capabilities.observability.otel.exportProtocols[]` advertises the supported OTLP transports (`http/json`, `http/protobuf`, `grpc`); `spec/v1/observability.md` gains a §"Export protocols" normative section. New conformance scenario `otel-emission-grpc.test.ts` gates on the array. Opt-in via `OPENWOP_OTEL_COLLECTOR_GRPC=true` (default port 4317).

### Capability surfaces

Hosts advertise optional behaviors at `/.well-known/openwop`. New capability blocks added between 2026-05-08 and 2026-05-12:

- `capabilities.runs.{pauseResume, bulkCancel}` — pause/resume + bulk-cancel endpoints.
- `capabilities.webhooks.{supported, signatureAlgorithms}` — HMAC v1 signing (`{timestamp}.{rawBody}`).
- `capabilities.secrets.{supported, scopes, resolution}` — BYOK secret resolution (host-managed).
- `capabilities.aiProviders.{supported, byok, policies}` — AI provider routing with 4-mode policy enforcement (`disabled` / `optional` / `required` / `restricted`).
- `capabilities.mcpClient.{supported, transports, trustBoundary}` — MCP tool invocation; `trustBoundary: "untrusted"` per `threat-model-prompt-injection.md` §UNTRUSTED.
- `capabilities.httpClient.{supported, methods, ssrfGuard, maxResponseBodyBytes}` — universal `core.http.request` typeId with SSRF guard.
- `capabilities.memory.{supported, maxEntrySizeBytes, ttlSupported}` — `MemoryAdapter` read-side contract per RFC 0004.
- `capabilities.agents.{supported, profile, modelClasses, orchestratorPattern, memoryBackends, orchestrator, dispatch, reasoning}` — Multi-Agent Shift Phase 1–6 advertisement.
- `capabilities.auth.{profiles[], rotation, oauth2, oidc, auditLogIntegrity}` — auth-profile advertisement (rotation; OAuth2-CC; OIDC user-bearer; audit-log integrity).
- `capabilities.discovery.authScoped.{supported, mode}` — RFC 0011 same-endpoint auth-scoped discovery.
- `capabilities.production.{supported, backpressure, retention, debugBundle}` — production-profile claim (RFC 0009).
- `capabilities.observability.{otel, metrics}` — OTel emission with `openwop.{run.backlog, queue.depth, run.duration}` metrics; OTLP/HTTP-JSON + OTLP/HTTP-protobuf encodings supported.

### Reference SDKs at 1.1.0

- **`@openwop/openwop`** (TypeScript, npm) — first-class methods on `OpenwopClient` for every OpenAPI endpoint; `HTTP_ERROR_CODES` catalog with 40+ canonical codes; `RunEventDoc` type + `isTerminalRunStatus` helper; new typed exports added in 1.1.0: `MemoryEntry`, `MemoryListOptions`, `AgentRef`, `AgentsCapability`, `AuthProfileClaim`, `AICredentialRef`, `McpToolCallNodeConfig`, `HttpRequestNodeConfig`.
- **`openwop-client`** (Python, PyPI) — stdlib-only port preserving the same surface; `HTTP_ERROR_CODES` frozenset; matching wire types.
- **`github.com/openwop/openwop/sdk/go`** (Go modules) — same surface; `HTTPErrorCodes` slice; doc comments on every exported symbol; `go vet` clean.
- **Rust SDK** — foundation demand-gated; conformance suite is language-agnostic black-box, so future Rust client tests against the same wire contract.

### Reference hosts

Four reference implementations live under `examples/hosts/`. Conformance evidence per host in `INTEROP-MATRIX.md`:

- **In-memory** (TypeScript, `examples/hosts/in-memory/`) — local-dev fastest-boot; no persistence; claims `openwop-core` + stream profiles.
- **SQLite** (TypeScript, `examples/hosts/sqlite/`) — single-machine durability; **669/731 (91.5%)** conformance pass rate; claims audit-log-integrity + 4 interrupt profiles + auth-api-key-rotation + discovery-auth-scoped.
- **Python in-memory** (Python 3.11 stdlib-only, `examples/hosts/python/`) — cross-language portability proof; **700/788 (100% of applicable, ZERO failures)** conformance pass rate.
- **Postgres** (TypeScript, `examples/hosts/postgres/`) — production durability path; first host claiming `openwop-production`; **730/799 (91.4%)** conformance pass rate. Ships with BYOK + 4-mode AI policy + MCP client + HTTP client (SSRF-guarded) + MemoryAdapter + agents capability + API-key rotation + auth-scoped discovery + OAuth2-CC + OIDC user-bearer JWT validators (RS256 + ES256 with JWKS cache + `alg: "none"` rejection) + cap-breach enforcement + per-workflow configurableSchema validation + subworkflow outputMapping + parent linkage.

### Conformance suite at 1.1.0

- **`@openwop/openwop-conformance`** — 103 scenario files under `conformance/src/scenarios/`. New since the 1.0.0 publish: production-profile (backpressure + retention-expiry), auth profiles (api-key-rotation + OAuth2-CC + OIDC + mTLS shape), audit-log integrity, BYOK roundtrip, MCP/A2A real-impl interop (verified against `@modelcontextprotocol/server-everything` + A2A 0.3 JSON-RPC reference), agent memory (roundtrip + cross-tenant + redaction + TTL), webhook signed delivery, stream-modes (buffer + mixed-mode), bulk-cancel, MCP-toolcall redaction, HTTP-client SSRF, WASM pack ABI-version-rejection + memory-cap positive-path, configurableSchema positive overlay, pause-resume race + drain semantics.
- **Two execution modes**: `npm test` (parallel files, ~95s) and `npm run test:strict` (`--no-file-parallelism` for production-backpressure + OTel envelope coverage).
- **Behavior-gated**: `OPENWOP_REQUIRE_BEHAVIOR=true` flips capability-gated scenarios from skip to fail when the host doesn't advertise the profile.

### SECURITY invariants

- **68 invariants tracked** (`SECURITY/invariants.yaml`):
  - 35 protocol-tier (all with public conformance tests; CI-gated via `scripts/check-security-invariants.sh`).
  - 32 reference-impl tier (verified by each reference impl's own CI).
  - 1 advisory (defense-in-depth, no hard MUST).
- New protocol-tier invariants added between freeze and release: `mcp-toolcall-payload-redaction`, `http-client-ssrf-guard`, `agent-memory-cti-1`, `agent-memory-sr-1-redaction`, `auth-key-rotation-no-canary-echo`.
- Threat-model docs at `SECURITY/threat-model-*.md` (secret-leakage, prompt-injection, provider-policy, node-packs, auth-profiles).
- CNA registration + bug-bounty program annex at `SECURITY/cna.md` + `SECURITY/bug-bounty.md`.

### Wire-shape stability

The wire contract remains **frozen at v1** per `COMPATIBILITY.md` §2 — additive changes only inside v1.x, safety-fix only when correctness or CVE-class issues require it. Breaking changes wait for v2. This 1.1.0 release adds new optional capability surfaces; hosts that advertised the 1.0.0 capability set remain v1.x-compliant without change.

### Domain and package naming

- Canonical domain: `openwop.dev`
- Registry: `packs.openwop.dev` (TLS cert provisioned; live)
- Package names: `@openwop/openwop`, `@openwop/openwop-conformance`, `openwop-client`, `github.com/openwop/openwop/sdk/go` — stable through any v1.x release per `PUBLISHING.md`.

### Verification

`npm run openwop:check` — the 8-step pre-merge gate — passes for every commit on `main`:

1. TypeScript reference SDK builds + emits `dist/`
2. Conformance suite typechecks + server-free scenarios pass
3. Python reference SDK syntax + import smoke clean
4. Go reference SDK `go vet` + tests clean
5. OpenAPI 3.1 `redocly lint` clean
6. AsyncAPI 3.1 `asyncapi validate` clean
7. Publish-metadata + npm-pack-contents + Python/Go release-surface clean
8. SECURITY invariants — every protocol-tier MUST-NOT has a public test

---

## [1.0.0] — 2026-05-11 — openwop v1.0 first publish

First publication of the openwop spec corpus to the package registries. Captures everything that was in scope at the v1 spec freeze (2026-05-08) plus three days of pre-publish hardening: SQLite host conformance fixes, registry TLS provisioning, audit-log integrity profile shipped end-to-end on SQLite, CI gate hardening (NPM_CACHE / GOCACHE cross-platform), recruitment artifacts for first non-steward host + pack-author.

### Published artifacts

- **npm:** `@openwop/openwop@1.0.0` (TypeScript SDK), `@openwop/openwop-conformance@1.0.0` (conformance suite). Published 2026-05-11 05:06–05:09 UTC.
- **PyPI:** `openwop-client@1.0.0` (Python SDK).
- **Go modules:** tagged `sdk/go/v1.0.0` on origin.
- **Tag:** `v1.0.0` on origin at commit `6a637f1`.

### Scope at 1.0.0

- Spec freeze content per `[1.0] — 2026-05-08` entry below — 26 prose specs at FINAL v1; 17 first-class JSON Schemas; OpenAPI 3.1 + AsyncAPI 3.1; three reference SDKs (TS/Python/Go); conformance suite v1.0.0.
- Phase A conformance behavior closure — SQLite host pass rate 91.5% under `OPENWOP_REQUIRE_BEHAVIOR=true`.
- Phase B spec corpus completion — all `DRAFT`/`STUB`/`OUTLINE` tags retired; `host-capabilities.md` promoted; `i18n.md` + `compliance.md` annexes shipped.
- Phase C round 1 — three reference hosts (in-memory, sqlite, python) advertising their respective capability surfaces.
- Phase F — MCP + A2A probe extensions (synthetic fakes).
- Registry — `packs.openwop.dev` live with TLS; 3+ packs published with Ed25519 chains.
- CI — `npm run openwop:check` 8-step gate green.

### Known gaps at 1.0.0 (closed in 1.1.0)

- Postgres reference host had not yet shipped the BYOK / MCP / HTTP / agent-memory / OAuth2-CC / OIDC / API-key-rotation / auth-scoped-discovery surfaces.
- 11 conformance scenarios were shape-graded (not behavior-graded).
- Phase F real-impl interop (against `@modelcontextprotocol/server-everything` + A2A 0.3 reference) was not yet wired.
- Phase H launch-blockers + Phase I enterprise-blockers from the 2026-05-12 architectural re-evaluation were not yet identified.

---

## [1.0] — 2026-05-08 — openwop v1 spec freeze

Protocol contract locked. The spec corpus, schemas, API definitions, reference SDKs, and conformance suite all reach `1.0` artifact versions. This date marks the **freeze** — no breaking wire-shape changes after this point inside v1.x.

The 4-day window between this freeze and the 2026-05-12 release closes every controllable gap from the deep-dive review and hardens reference hosts to production-runtime parity. See the [1.0.0] release entry above for the consolidated record.

### What's locked at freeze

- **Prose specs** — 26 docs at `Status: FINAL v1`: `auth.md`, `capabilities.md`, `channels-and-reducers.md`, `idempotency.md`, `interrupt.md`, `node-packs.md`, `observability.md`, `replay.md`, `rest-endpoints.md`, `run-options.md`, `stream-modes.md`, `version-negotiation.md`, `profiles.md`, `scale-profiles.md`, `debug-bundle.md`, `host-extensions.md`, `a2a-integration.md`, `mcp-integration.md`, and the v1 profile/addendum docs.
- **JSON Schemas** — 17 first-class schemas including agent-ref, agent-manifest, memory-entry, memory-list-options, conversation-turn, conversation-event, and dispatch-config schemas.
- **API definitions** — OpenAPI 3.1 (`api/openapi.yaml`) + AsyncAPI 3.1 (`api/asyncapi.yaml`).
- **Reference SDKs at 1.0** — `@openwop/openwop` (TypeScript), `openwop-client` (Python), `openwopclient` (Go).
- **Conformance suite at 1.0** — `@openwop/openwop-conformance`.
- **CI gating** — `scripts/openwop-check.sh` + `.github/workflows/openwop-spec.yml`.
- **Governance** — `CONTRIBUTING.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `COMPATIBILITY.md`, `SECURITY.md`.

### Multi-Agent Shift (Phases 1-6 landed by freeze)

- **Phase 1 (RFC 0002)** — Agent identity (`AgentRef`), agent reasoning + tool + handoff event family, confidence-escalation contract, `message` reducer.
- **Phase 2 (RFC 0003)** — Agent capability discovery on `/.well-known/openwop` + `pack.json` `agents[]` extension.
- **Phase 3 (RFC 0004)** — Agent memory layer — `memoryRef` resolution, redaction guarantees, host `MemoryAdapter` contract.
- **Phase 4 (RFC 0005)** — Conversation as run primitive — `conversation.start` / `conversation.exchange` / `conversation.close`.
- **Phase 5 (RFC 0006)** — Orchestrator-supervisor role — `core.orchestrator.supervisor` node type.
- **Phase 6 (RFC 0007)** — `core.dispatch` core node — conservative dynamic graph mutation.

### Domain and package naming

- Canonical domain: `openwop.dev`
- Registry: `packs.openwop.dev`
- Package names: `@openwop/openwop`, `@openwop/openwop-conformance`, `openwop-client`, `openwopclient`

# OpenWOP Known Limits

> DOC-6 from `plans/openwop-protocol-gap-closure-plan.md`. Honest catalog of where the protocol corpus has shape-only coverage, external-gated work, profile claims with no non-steward implementer yet, or behavior tests too coarse to fully prove an invariant. Adoption trust improves when limits are explicit; this page is part of that contract.

The page is **deliberately disagreeable.** If a row here understates what the protocol can prove, file a PR with the missing evidence. If a row overstates the issue, file a PR retiring it.

For machine-readable counts, see [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md). For the operational gap-closure roadmap that drives this page, see [`plans/openwop-protocol-gap-closure-plan.md`](../plans/openwop-protocol-gap-closure-plan.md).

---

## Shape-only conformance coverage

These conformance scenarios validate the discovery / capability shape but cannot mechanically verify the host's run-time behavior without operator-supplied harness state.

| Scenario | Shape-only because | What would close it |
|---|---|---|
| `multi-region-idempotency.test.ts` | Partition + reconciliation requires actual multi-region replication infrastructure that no reference host ships. The algorithm itself is verified at `examples/hosts/postgres/src/multi-region.ts` (canonical resolver, 6-path unit test). | CF-12 / OPS-5 — multi-region simulation harness or a deployed multi-region host. |
| `replay-llm-cache-key.test.ts` §D cross-host parity | Cross-host parity (§D of the suite) is gated on `OPENWOP_BASE_URL_B` for the second-host probe — the single-host §A + §B coverage is in place via the existing host seam, the cross-host hop awaits two reference hosts that both expose the seam. (Note: the file is NOT shape-only — it ships 5 behavioral assertions; only the §D cross-host case soft-skips.) | Two adopting hosts that both implement the recipe + expose the test seam, OR an `OPENWOP_BASE_URL_B`-gated CI matrix that points at both. |
| `replay-divergence-at-refusal.test.ts` behavioral, `replay-observable-sequence-determinism.test.ts` boundary | RFC 0041 scenarios (multi-agent execution model `version: 4`). The advertisement-shape probes are behavioral; the refusal-divergence + observable-sequence behavioral assertions soft-skip until reference workflow-engine wires a staged-refusal seam on the mock-AI provider AND a `conformance-phase4-nondet-tool` fixture ships. | Workflow-engine `version: 4` implementation (refusal-staging seam + nondeterministic-tool fixture). |
| `auth-mtls.test.ts` (behavior portion) | Opt-in via `OPENWOP_TEST_MTLS=1` + operator-supplied cert paths. Capability-shape verification runs unconditionally; client-cert reject verification needs the harness. | Postgres reference host already implements mTLS termination + 3-path smoke (`test/mtls.test.ts`); the cross-host conformance behavior path lights up when a non-steward host follows. |
| `pack-registry-publish.test.ts` | Validates server-side publish-time signature checks against a synthetic registry fixture, not the live `packs.openwop.dev` end-to-end. | Already largely closed — `registry-public.test.ts` tarball + signature verify roundtrip (CF-9 close-out 2026-05-13) covers the live path. Remaining: live-registry write-side coverage when the write API ships. |

---

## Behavior tests too coarse to fully prove an invariant

Some invariants are stated normatively but mechanically verified at a level that admits non-compliant edge cases the scenario doesn't probe.

| Invariant | Test today | Gap |
|---|---|---|
| `secret-leakage-otel-attribute` (reference-impl tier) | Verified host-internally via `examples/hosts/postgres/test/byok-roundtrip.test.ts`. | The conformance OTel collector seam doesn't yet inspect span attributes; a host could pass conformance while leaking BYOK material on telemetry exports. Marked `non_testability_rationale` in `SECURITY/invariants.yaml`. |
| `secret-leakage-debug-bundle-otel` | Same as above. | Same — collector seam pending. |
| `node-pack-sandbox-timeout` (the last reference-impl sandbox invariant) | **6 of the 8 `node-pack-sandbox-*` invariants GRADUATED `reference-impl → protocol` 2026-05-31** (`fs-gated`, `no-env`, `network-gated`, `no-process`, `memory-cap`, `isolated-context`) — backed by the real-isolation host `examples/hosts/wasm-sandbox/` + the portable server-free `conformance/src/scenarios/sandbox-wasm-isolation.test.ts` (10/10 non-vacuous against real `.wasm`). Only `timeout` remains reference-impl: a wall-clock cap needs thread preemption (a worker kill-timer), which a server-free conformance probe can't exercise; it is proven at reference-impl tier by the WASM host's worker-based `test/sandbox.test.ts`. `no-eval` is JS-runtime-specific + permanently exempt (WASM has no `eval`). | A worker-driven sandbox conformance probe under `conformance/src/scenarios/` graduates `timeout` too. RFC 0035 `Active → Accepted` separately needs a **non-steward** sandbox-executing host (MyndHyve opted out: no-untrusted-packs). |
| Cross-engine append ordering | `append-ordering.test.ts` covers intra-engine sequence ordering. | CF-8 — multi-engine fixture exercising two engines writing to the same event log. |
| Workflow-engine reference — anonymous-auth fallback under `NODE_ENV=development` | `auth.test.ts` "request without Authorization header MUST return 401" fails against workflow-engine: returns 201 instead of 401. | Reference workflow-engine has an anonymous-session fallback under dev posture (for the app.openwop.dev demo). Production deployments use `NODE_ENV=production` which enforces bearer auth. A future hardening pass MAY split the anon-session middleware so it's flag-gated independently of NODE_ENV; for now it's the intentional dev posture, NOT a v1 spec break (the spec contract is bearer-required + the production host honors it). |
| Workflow-engine reference — multi-agent confidence-escalation timing flake | `multi-agent-confidence-escalation.test.ts` happy-path assertion times out (10s) on terminal status. The scenario reaches `waiting-input` but the suite was watching for a different terminal kind. | Either lengthen the scenario's poll budget OR teach the reference workflow-engine to honor `waiting-clarification` as the terminal kind for the confidence-floor escalation path per RFC 0039 §A. Tracked as a reference-host gap; not a wire-shape concern. |

---

## Profiles claimed by reference hosts but pending non-steward adoption

Per the project's `MAINTAINERS.md` `### Vendor-neutral tripwire`, several profile claims are reference-host-only today. They are mechanically verified — strict-mode conformance scenarios pass against the reference — but no non-steward implementer has shipped a host claiming them.

| Profile | Reference host | Non-steward implementer status |
|---|---|---|
| `openwop-production` | Postgres | None yet. Outreach in `docs/recruitment/external-host.md`. |
| `openwop-auth-oauth2-client-credentials` | Postgres | None yet. |
| `openwop-auth-oidc-user-bearer` | Postgres | None yet. |
| `openwop-auth-mtls` | Postgres | None yet. |
| `openwop-auth-api-key-rotation` | Postgres | None yet. |
| `openwop-discovery-auth-scoped` | Postgres | None yet. |
| `capabilities.memory.compaction` (RFC 0012) | Postgres | None yet. |

A non-steward implementer claiming any of these would fire the vendor-neutral migration tripwire in `MAINTAINERS.md`.

---

## Hosted infrastructure: what is live + what is not

| Surface | Status |
|---|---|
| `packs.openwop.dev` registry | **Live.** 48 packs across 4 trust tiers as of 2026-05-13. Tarball + Ed25519 signature + SRI integrity verified end-to-end (`registry-public.test.ts`). |
| `openwop.dev` site | Auto-built from spec corpus per `.github/workflows/site.yml`. Auto-deploy is gated on `vars.ALLOW_DEPLOY=1` (release-manager-controlled). |
| Conformance leaderboard | **Not yet live.** GOV-3 plan task — needs a hosted page rendering `INTEROP-MATRIX.md` evidence + badge semantics. |
| External audit report | **Not yet engaged** (vendor-external — the steward cannot complete a third-party audit from inside the repo). Outreach drafted at `SECURITY/outreach/external-audit/STATUS.md`; SEC-2 audit scope pinned to current repo state 2026-05-15. **The remediation obligation is now mechanized:** `scripts/check-audit-findings.mjs` (wired into `openwop:check`) reads `SECURITY/external-audit-findings.json` and **hard-fails the gate on any OPEN high/critical finding** — so the moment the report lands and findings are recorded, an unremediated serious finding blocks every release / standardization claim. Passes today on the empty pre-audit tracker. |
| High-stakes `core.openwop.{ai,http,mcp,triggers}` packs | **Built + signed in-tree, audit-gated for public publication.** See `SECURITY/external-audit-engagement.md` §2.1. |

---

## External-action gates (cannot be closed without outside engagement)

The plan calls these out explicitly — none can be moved by repo-side mechanical work alone.

| Plan task | What's required |
|---|---|
| SEC-1 | Refresh + SEND external audit outreach to ≥3 vendors. |
| SEC-7 | Complete audit vendor selection + contract + kickoff. |
| SEC-8 | Remediate findings + publish public summary. |
| GOV-1 | Send external host recruitment outreach. |
| GOV-2 | Send external pack-author outreach. |
| GOV-5 | Add at least one external reviewer before maintainer promotion. |
| GOV-6 | Land one non-steward host or adapter row in INTEROP-MATRIX. |
| GOV-7 | Promote a non-steward maintainer when criteria are met. |
| GOV-8 | Open vendor-neutral org migration RFC after tripwire fires. |

---

## RFCs not yet `Accepted`

> The **authoritative** per-RFC status list is the generated table in [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md) (run `node scripts/generate-protocol-status.mjs --write`). The table below is curated commentary on *why* selected open RFCs remain open — it is **not exhaustive** and does not list every `Active`/`Draft` RFC.

| RFC | Status | Why open |
|---|---|---|
| 0035 (Sandbox execution contract) | `Active` | A **real-isolation WASM reference host** now exists (`examples/hosts/wasm-sandbox/`, 2026-05-31) executing pack-loaded typeIds as WebAssembly; **6 of the 8 `node-pack-sandbox-*` invariants graduated `reference-impl → protocol`** (`fs-gated`/`no-env`/`network-gated`/`no-process`/`memory-cap`/`isolated-context`), backed by the portable server-free `conformance/src/scenarios/sandbox-wasm-isolation.test.ts` (10/10 non-vacuous against real `.wasm`) — superseding the 2026-05-22 premature graduation that was reverted (`5864a2f`). `timeout` stays reference-impl (a wall-clock cap needs thread preemption, not exercisable server-free; proven by the WASM host's worker-based `test/sandbox.test.ts`); `no-eval` is JS-specific + exempt. RFC 0035 stays `Active`: `Active → Accepted` needs a **non-steward** host that runs untrusted packs in a real-isolation sandbox (MyndHyve opted out: `no-untrusted-packs`). |
| 0038 (Working Group charter) | `Draft` | Ratifies the moment the `GOVERNANCE.md` tripwire fires (≥3 organizations + ≥2 non-steward hosts). The charter is **written**, not waiting on drafting work — the gate is adoption, not text. |
| 0042 (Experimental capability tier) | `Active` | Adds optional `capabilities.<feature>.tier ∈ {stable, experimental}` + `experimentalUntil` sunset rule. Filed 2026-05-22 in response to the 2026-05-22 audit's "Active RFC → experimental carve-out" recommendation. Promoted Draft → Active 2026-05-29 (comment window waived per GOVERNANCE.md lazy consensus). |
| 0043 (Registry + extension policy + IPR posture) | `Draft` | Consolidates extension-namespace rules, registry submission/yank/sign-key-rotation policy, profile/event-type/envelope-kind/capability-name reservation, and IPR posture (DCO + Apache-2.0 + CC-BY-4.0). Filed 2026-05-22 in response to the audit's "governance technically incomplete" finding. Path-to-`Active` is the 7-day comment window; WG ratification follows when the `GOVERNANCE.md` tripwire fires. |
| 0050 (SAML / SCIM enterprise identity profiles) | `Draft` | MyndHyve Tier 2 (filed 2026-05-25). SAML assertion-validation (`alg:none` rejection mirroring OIDC) + SCIM provisioning profiles mapping IdP users/groups onto RFC 0048 principals + RFC 0049 roles. Extends RFC 0010. MyndHyve opted out of this profile, so it did not graduate with the 8-RFC cohort on 2026-05-25; path-to-`Active` is the 7-day comment window. |
| 0065 (Workflow node primary-output annotation) | `Active` | Filed 2026-05-25 from the chat-surface architect-review pass. Additive optional `outputRole: "primary" \| "secondary"` on `WorkflowNode` so tooling can disambiguate the canonical artifact on multi-terminal DAGs. Advisory-only — engine behavior unchanged; pure additive per `COMPATIBILITY.md` §2.1. Promoted Draft → Active 2026-05-29 (comment window waived per GOVERNANCE.md lazy consensus). |
| 0066 (`x-openwop-form` vendor extension) | `Active` | Filed 2026-05-25. Reserves the `x-openwop-form` advisory annotation on pack-manifest `configSchema` properties so hosts can hint a picker UX (`prompt-picker`, `provider-picker`, `model-picker`, `credential-picker`, plus generic `text` / `textarea` / `string-list`) without expanding wire shape. Pure additive per `COMPATIBILITY.md` §2.1; renderer treats unknown `kind` values as `text` (forward-compat). Promoted Draft → Active 2026-05-29 (comment window waived per GOVERNANCE.md lazy consensus). Path-to-`Accepted` requires (a) a shape-conformance scenario validating that `x-openwop-form` MUST NOT bypass the underlying `configSchema` validators and that `dependsOn` cascade-clear is honored, (b) RFC 0043 cross-reference once 0043 promotes (vendor-extension reservation is logically a `0043` concern), and (c) a non-steward host advertising a pack with `x-openwop-form` annotations. The reference renderer extension (Phase 2 — consume the picker `kind` values in `Inspector.tsx`) lands after Active. |
| 0067 (Provider-catalog conventions) | `Active` | Additive optional `capabilities.aiProviders.authModes` map (`apiKey`/`oauth-pkce`/`oauth-device`/`none`) so clients pre-flight how a host expects each provider's BYOK credential, plus a non-normative provider-name vocabulary on `aiProviders.supported`. Default contract unchanged for hosts that omit `authModes`. Promoted Draft → Active 2026-05-29 (comment window waived per GOVERNANCE.md lazy consensus); full wire surface on `main`. Path-to-`Accepted`: a non-steward host advertising `authModes`. |
| 0068 (Memory consolidation + standing commitments) | `Active` | Two additive optional capabilities — `agents.memoryConsolidation` (background merge/dedup/strengthen of long-term memory) + `agents.commitments` (inferred standing intentions firing a run later) — each with one content-free event (`agent.memory.consolidated`, `commitment.fired`). All four Unresolved questions resolved at Active (a consolidation pass is a host-managed mutation outside the replay envelope per RFC 0041 §C). Path-to-`Accepted`: a host advertising the blocks + emitting the events. |
| 0069 (exec-class tool host-extension safety contract) | `Active` | Codifies the existing exclusion as a normative MUST-NOT: arbitrary-command execution MUST NOT be a protocol-tier capability — it lives only in `x-host-<vendor>-exec` host-extension scopes with host-owned sandboxing/allowlist/approval/audit. Adds the protocol-tier SECURITY invariant `exec-must-not-be-protocol-tier` + an always-on server-free scenario (`exec-not-protocol-tier.test.ts`). No host wire-shape change. Path-to-`Accepted`: a host advertising an `exec` host-extension under the contract. |
| 0075 (Artifact-type packs real-world amendment) | `Active` | RFC 0071 Phase-1.1 erratum: implementing RFC 0071 as a real AI-native host (MyndHyve, #275 — built-in artifact types, no packs) surfaced gaps the spec's deterministic-producer design didn't cover. Folds in six adoption-grounded amendments (host-native registration, an `additionalProperties:false` MUST→SHOULD relaxation + a `validation` field for AI-produced artifacts, per-type capability facets, a schema-resolvability MUST for no-pack types, a store-only conformance host) — all additive or MUST→SHOULD. Path-to-`Accepted`: a non-steward host exercising the amended facets. |
| 0078 (Portable Tool Catalog + Tool Session Contract) | `Active` | Optional capability-gated read-only projection `GET /v1/tools` + `GET /v1/tools/{toolId}` returning a normative `ToolDescriptor` (stable `toolId`, source, I/O schemas, auth/egress/approval requirements, replay policy, safety tier `pure`/`read`/`write`/`exec` with `exec` ⇒ host-extension-only per RFC 0069) across all five tool surfaces, plus an optional tool-session lifecycle. Read-only, authorization-scoped (RFC 0074 pattern), secret-free. Carries four Active-gated UQs; endpoint/SDK/behavioral surface deferred to Accepted. Path-to-`Accepted`: a host advertising the catalog. |
| 0079 (Credential Provenance + Egress Policy) | `Active` | A credential-provenance descriptor at the tool/egress boundary (content-free of the secret value) + a content-free `egress.decided` event + the load-bearing protocol-tier invariant `egress-credential-audience-bound`: a host-issued credential MUST NOT attach to an egress destination outside its `audiences` (fail-closed) — the confused-deputy guard the URL-level SSRF check doesn't perform. The audience-binding MUST sits at reference-impl tier pending a host. Additive (gated on new `httpClient.egressPolicy`); four Active-gated UQs. Path-to-`Accepted`: a host advertising the egress policy + the invariant graduating to protocol. |
| 0080 (Agent Memory Capability Reconciliation) | `Active` | Reconciles the fragmented memory advertisement into one additive model — eight named dimensions, adding the two missing optional ones (`memory.search`, `memory.retention`) + a derived `openwop-memory` profile; resolves the canonical-query-endpoint question (memory query stays host-internal at v1.x, no `GET /v1/memory`); and requires `GET /v1/agents` to surface `memoryShape` degraded-status (no silent degradation). No existing flag moved/renamed (a structural re-org would be breaking → deferred). Four Active-gated UQs. Path-to-`Accepted`: a host advertising the reconciled shape (incl. MyndHyve's in-flight `memory.supported` flip — see `INTEROP-MATRIX.md`). |
| 0081 (Agent Evaluation, Scorecards, and Promotion Gates) | `Active` | Additive `capabilities.agents.evalSuite` + `agent-eval-suite`/`eval-summary` schemas + `GET /v1/runs/{runId}/eval-summary` + content-free `eval.*` events + a `mode: eval` run shape. Protocol-tier `eval-summary-no-content-leak` invariant verified by the always-on server-free `agent-eval-suite-shape.test.ts`. Behavioral `agent-eval-run` scenario + reference-host implementation deferred to Accepted. Path-to-`Accepted`: a non-steward host running an eval suite + emitting the `eval.*` events. |
| 0082 (Agent Deployment Lifecycle) | `Active` | Additive `capabilities.agents.deployment` + deployment schemas + `GET`/`POST /v1/agents/{agentId}/deployments` + four content-free `deployment.*` events + an optional `channel` on `agent-ref` (mutually exclusive with the exact `version` pin). An `agentId@channel` binding resolves to a concrete version at `run.started` as a recorded-fact (replay/fork re-reads it, never re-resolving a moved channel — per `replay.md` §"Recorded-fact events"). Behavioral `deployment-promotion-fail-closed` invariant at reference-impl tier, graduating to protocol at Accepted. Path-to-`Accepted`: a non-steward host wiring the deployment lifecycle. |
| 0084 (Budget, Quota, and Cost Policy) | `Active` | Additive cost-governance layer, orthogonal to RFC 0058 execution bounds — reserved `budget.*` run-options keys (`maxTokens`/`maxCostUsd`/`maxToolCalls`/`maxRetries`/`modelAllow`/`modelDeny`), a content-free `budget.{reserved,consumed,threshold.crossed,exhausted}` event family (consumption tracked off existing RFC 0026 `provider.usage` — no double-counting), hard-stop via new `cap.breached{budget-*}` kinds, and model allow/deny composing RFC 0031 + 0067. Protocol-tier `budget-no-pricing-leak` invariant; consumed values are recorded facts (replay-deterministic exhaustion). All five UQs resolved. Behavioral enforcement scenario + `budget_exhausted`/`budget_model_denied` error codes + reference-host accounting deferred to Accepted. Path-to-`Accepted`: a host advertising `budget`. |
| 0085 (`openwop-agent-platform` meta-profile) | `Active` | The capstone, flipped last in the arc. An operational annex (the `production-profile.md` pattern — a claim combining a discovery predicate + required scenarios + a badge, distinct from the closed pure-predicate `profiles.md` catalog) naming the coherent agent-platform capability subset with a `partial` (core floor) vs `full` (floor + governance/operability tier) status + an aggregating conformance meta-scenario + a badge. Hard predicate terms reference only ≥Active constituents; the eval/deploy/budget (0081/0082/0084) tier is advisory-RECOMMENDED, not a hard term, so the wire lock doesn't depend on a shifting shape. Path-to-`Accepted`: gated on a host reaching `partial`/`full` (Postgres reference candidate) — the live aggregate-evidence assertion + badge rendering. |
| 0088 (`openwop-core-standard` Core Standard Profile) | `Active` | The audit-response "Core Candidate" target — an operational annex (`spec/v1/core-standard-profile.md`) defining the stable Core floor as exactly the MUSTs with black-box production-path conformance, with two levers keeping extensions out (RFC 0042 `tier: experimental` for `Active` caps; floor-exclusion for `Accepted`-but-seam-gated caps, which graduate in as their black-box proof lands). Reference predicate `isCoreStandard` + always-on server-free `core-standard-profile.test.ts`. Path-to-`Accepted`: ≥1 host advertising the `openwop-core-standard` claim backed by the §C floor scenarios passing black-box (MyndHyve + all four reference hosts already pass them). |

RFCs **0077 (Live Manifest Dispatch) + 0086 (Standing Agent Roster) + 0087 (Agent Org-Chart) + 0083 (Durable Trigger + Channel Bridge)** **were promoted `Active → Accepted` on 2026-05-31** on MyndHyve `workflow-runtime`'s live advertisement (the agent-platform arc — 0086+0077 first, then 0087, then 0083, each non-vacuously passing its gated behavioral scenario under `OPENWOP_REQUIRE_BEHAVIOR=true` + serving its normative read endpoint 401-gated; see `INTEROP-MATRIX.md`). RFC **0073 (Capability families at document root)** was promoted `Draft → Accepted` on 2026-05-31 once the conformance suite was made to **enforce** the document-root layout (the accessor's wrapper-fallback was dropped, so a wrapper-only host now grades non-conformant; the host-side mirror + schema hard-forbid are paired to v2.0). All five left the open table above and are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0029 (Prompt override hierarchy) + 0055 (Multimodal envelope variants) + 0057 (Memory-write attribution event)** **were promoted Active → Accepted on 2026-05-26** on MyndHyve workflow-runtime's round-3 advertisement (revision `workflow-runtime-00217-q7c`, openwop-side curl-verified — see `INTEROP-MATRIX.md` §"round 3"). RFC 0058 was **not** in the round-3 graduation — MyndHyve advertises `maxNodeExecutions` (the pre-existing recursionLimit bound), not RFC 0058's `limits.maxRunDurationMs` / `maxLoopIterations` surface; MyndHyve subsequently retracted the round-3 0058 claim (commit `11cacfe6b`); 0058 stayed `Active` through round-3. **0058 + 0061 then graduated `Active → Accepted` on MyndHyve's round-4 `version: 5` advertisement 2026-05-26** (`workflow-runtime-00390-vuh` — both arms shipped: `maxRunDurationMs` wall-clock + the `maxLoopIterations` loop arm riding RFC 0061's per-turn iteration counter; openwop-side curl-verified). RFC 0029/0055/0057/0058/0061 are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0059 (Agent workspace) + 0060 (`host.heartbeat`) + 0062 (Scheduled memory distillation) + 0063 (`core.subWorkflow.outputAttestation`) + 0064 (`host.toolHooks`)** **were promoted Draft → Active → Accepted on 2026-05-25** as the autonomous-agent-runtime cohort's M1 wire surfaces + M2 in-memory reference-host enforcement landed atomically. Three new protocol-tier SECURITY invariants land alongside: `workspace-cross-tenant-isolation` (RFC 0059), `subrun-merge-approval-fail-closed` (RFC 0063), and (via RFC 0049's `authorization-fail-closed` test set, no new invariant) the per-tool authz fail-closed assertion (RFC 0064). They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`. RFC 0058 + RFC 0061 (the cohort's stateful-loop keystone) graduated `Active → Accepted` 2026-05-26 on MyndHyve's round-4 `version: 5` advertisement — also `Accepted` in `docs/PROTOCOL-STATUS.md`, no longer in the open table above.

RFCs **0045 (connector pack manifest) + 0046 (`host.credentials`) + 0047 (`host.oauth`) + 0048 (tenant·workspace·principal identity) + 0049 (RBAC scopes) + 0051 (approval-gate primitive) + 0052 (scheduling triggers) + 0053 (dead-letter routing)** **were promoted Active → Accepted on 2026-05-25** as a single 8-RFC MyndHyve protocol-extension cohort (commit `c9c6bfc`, PR #148). Evidence: MyndHyve workflow-runtime advertises all five capability blocks live on `https://api.myndhyve.ai/.well-known/openwop` (curl-verified 2026-05-25); `@openwop/openwop-conformance@1.6.0` reports 28 PASS / 0 FAIL across the cohort on revision `workflow-runtime-00211-69w`. RFC 0050 (SAML/SCIM) + RFC 0054 (run diff) stay `Draft` — MyndHyve opted out; neither contributes to graduation. They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0028 (Prompt library endpoints) + 0034 (OTel collector test seam) + 0040 (`version: 3` cross-host causation) + 0041 (`version: 4` replay determinism)** **were promoted Active → Accepted on 2026-05-25** on the strength of MyndHyve workflow-runtime's `capabilities.prompts.{packsSupported: true, mutableLibrary: true, library: {...}}` Tier-2 advertisement (RFC 0028), the same revision's `observability.testSeams.otelScrape: true` adoption (RFC 0034), and the staged `multiAgent.executionModel.version: 3 → 4` rollout backed by a Firestore-backed observable-result cache (RFCs 0040 + 0041). The multi-agent execution model roadmap (versions 1–4) is now Accepted end-to-end on a non-steward host. They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0037 (`version: 1` — handoff state machine) + 0039 Half A (confidence-floor escalation) + 0044 (confidence-escalation interrupt-kind advertisement)** **were promoted Active → Accepted on 2026-05-22** in a single batch on the strength of MyndHyve workflow-runtime's cross-host conformance run (revision `workflow-runtime-00353-rab` against `@openwop/openwop-conformance@1.5.0`). RFC 0044 lands the `confidenceEscalationInterruptKind` vendor-extension pattern that lets entrenched host semantics (`x-host-<host>-<kind>`) pass conformance without cross-cutting renames. They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFC **0027 (Prompt templates wire shape)** was promoted **Active → Accepted on 2026-05-23** (commit `8f65168`) after MyndHyve workflow-runtime adopted the prompt-compose seam end-to-end. RFC 0029 followed Active → Accepted on 2026-05-26 once MyndHyve's round-3 advertisement added `prompts.agentBindings: true` — see the round-3 graduation paragraph above.

RFCs **0030, 0031, 0032, 0033** (envelope LLM-contract-hardening track) **were promoted Active → Accepted on 2026-05-21** once reference workflow-engine + MyndHyve workflow-runtime both advertised the capabilities end-to-end. They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

---

## Surfaces deliberately NOT standardized

OpenWOP is intentionally narrow. These surfaces live in adopter / vendor / host territory by design — adoption confusion sometimes treats their absence as a gap. It is not.

- **Model SDK shape.** How a host calls OpenAI / Anthropic / etc. is the host's choice.
- **Internal runtime topology.** Workers, queues, schedulers — OpenWOP is the wire contract, not the runtime.
- **Tool protocol.** MCP is the wire surface; how tools execute inside a tool server is the tool server's concern.
- **Cross-process agent messaging.** A2A is the wire surface; internal RPC is the host's choice.
- **Storage adapter shape.** OpenWOP defines `RunEventLogIO` + `SuspendIO` contracts; Postgres / DynamoDB / SQLite / etc. is the host's choice.
- **Authentication backend.** OpenWOP defines bearer auth + auth-extension profiles; IdP integration is the host's deployment concern.
- **Pack execution sandbox.** RFC 0008 defines the WASM ABI; host runtime sandbox implementation is per-host.

See [`spec/v1/positioning.md`](../spec/v1/positioning.md) §"Standards composition matrix" for the full composition stance.

---

## See also

- [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md) — generated repo state.
- [`plans/openwop-protocol-gap-closure-plan.md`](../plans/openwop-protocol-gap-closure-plan.md) — controllable + external-gated work.
- [`docs/IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md) — adoption-side path.
- [`docs/PROFILE-DECISION-GUIDE.md`](./PROFILE-DECISION-GUIDE.md) — profile-selection decision tree.
- [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) — public host roster + evidence claims.
- [`SECURITY/invariants.yaml`](../SECURITY/invariants.yaml) — protocol-tier + reference-impl-tier invariants with test references or non-testability rationales.

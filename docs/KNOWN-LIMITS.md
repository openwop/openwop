# OpenWOP Known Limits

> DOC-6 from `plans/openwop-protocol-gap-closure-plan.md`. Honest catalog of where the protocol corpus has shape-only coverage, external-gated work, profile claims with no non-steward implementer yet, or behavior tests too coarse to fully prove an invariant. Adoption trust improves when limits are explicit; this page is part of that contract.

The page is **deliberately disagreeable.** If a row here understates what the protocol can prove, file a PR with the missing evidence. If a row overstates the issue, file a PR retiring it.

For machine-readable counts, see [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md). For the operational gap-closure roadmap that drives this page, see [`plans/openwop-protocol-gap-closure-plan.md`](../plans/openwop-protocol-gap-closure-plan.md).

---

## Shape-only conformance coverage

These conformance scenarios validate the discovery / capability shape but cannot mechanically verify the host's run-time behavior without operator-supplied harness state.

| Scenario | Shape-only because | What would close it |
|---|---|---|
| `multi-region-idempotency.test.ts` | The advertisement-shape probe; **the convergence behavior is now covered** by `multi-region-idempotency-behavior.test.ts` (2026-05-22, 6 behavioral assertions) via the `POST /v1/host/sample/test/multi-region/simulate-partition` seam (gated on `OPENWOP_TEST_MULTI_REGION_SIMULATOR=true`), implemented on **both** the reference workflow-engine and the Postgres host: lex-min `runId` winner, per-region cache redirect, canonical `cross_region_dedup_loss` loser reason, resolver order-invariance, and partition→converge with no coordination. All assertions PASS (coverage.md grade A). The canonical resolver is also unit-verified at `examples/hosts/postgres/src/multi-region.ts`. | **Simulation-harness gap CLOSED** (the "multi-region simulation harness" half of the original closure). Residual is the *other* half — a genuinely **deployed multi-region host** for Core-floor entry, plus non-steward adoption — which stays external (out of the floor per RFC 0088 §D Lever-2). |
| `replay-llm-cache-key.test.ts` §D cross-host parity | Cross-host parity (§D of the suite) is gated on `OPENWOP_BASE_URL_B` for the second-host probe — the single-host §A + §B coverage is in place via the existing host seam, the cross-host hop awaits two reference hosts that both expose the seam. (Note: the file is NOT shape-only — it ships 5 behavioral assertions; only the §D cross-host case soft-skips.) | Two adopting hosts that both implement the recipe + expose the test seam, OR an `OPENWOP_BASE_URL_B`-gated CI matrix that points at both. |
| `replay-divergence-at-refusal.test.ts` behavioral, `replay-observable-sequence-determinism.test.ts` boundary | RFC 0041 scenarios (multi-agent execution model `version: 4`). **Both repo-side prerequisites are now in place:** the staged-refusal seam ships (`POST /v1/host/sample/test/mock-ai/program`) and the `conformance-phase4-nondet-tool` fixture shipped (RFC 0041 Phase 4 fixtures commit). Consequently both files are now **ACTIVE capability-gated behavioral** `it()` bodies (no `it.skip`/`it.todo`): `replay-divergence-at-refusal.test.ts` drives the program seam to stage valid-original/refusal-replay and asserts `replay.divergedAtRefusal` + `replay_diverged_at_refusal`; `replay-observable-sequence-determinism.test.ts` (2026-06-01) drives the nondet fixture through a `mode:replay` fork and asserts observable event-log prefix byte-equivalence + nondeterministic-node observable-result caching. Both soft-skip on `multiAgent.executionModel.{version >= 4, replayDeterminism.supported}`. | **Repo half DONE** (seam + fixture + active gated scenarios). Residual is adoption-only: a host advertising `version: 4` + wiring the pure-replay observable-cache path so the gated assertions execute non-vacuously — converging with RFC 0041 `Active → Accepted` on first non-steward host adoption. |
| `auth-mtls.test.ts` (behavior portion) | Opt-in via `OPENWOP_TEST_MTLS=1` + operator-supplied cert paths. Capability-shape verification runs unconditionally; client-cert reject verification needs the harness. | Postgres reference host already implements mTLS termination + 3-path smoke (`test/mtls.test.ts`); the cross-host conformance behavior path lights up when a non-steward host follows. |
| `pack-registry-publish.test.ts` | Validates server-side publish-time signature checks against a synthetic registry fixture, not the live `packs.openwop.dev` end-to-end. | Already largely closed — `registry-public.test.ts` tarball + signature verify roundtrip (CF-9 close-out 2026-05-13) covers the live path. Remaining: live-registry write-side coverage when the write API ships. |

---

## Behavior tests too coarse to fully prove an invariant

Some invariants are stated normatively but mechanically verified at a level that admits non-compliant edge cases the scenario doesn't probe.

| Invariant | Test today | Gap |
|---|---|---|
| `secret-leakage-otel-attribute` (protocol tier) | Two complementary conformance probes: the host scrape seam `GET /v1/host/sample/test/otel/spans` (`secret-leakage-otel-attribute.test.ts`), AND — new 2026-06-01 — collector-side inspection of the REAL OTLP (OpenTelemetry Protocol) export. `OtelCollector.findCanaryLeakage()` scans every captured span name/attribute/resource-attribute + metric data-point attribute for the BYOK (bring-your-own-key) canary; `otel-collector-canary-inspection.test.ts` proves the inspector is non-vacuous always-on (catches a planted canary in each surface, zero hits on a redacted payload), and the new collector-export block in `secret-leakage-otel-attribute.test.ts` runs it against a live host's real export when the in-process collector is active. | **Collector-seam gap CLOSED.** The conformance collector now inspects what the host's OTLP exporter actually shipped over the wire — a host can no longer redact in its scrape seam while leaking on the real export. Residual is adoption-only: the live collector-export assertion soft-skips until a host exports OTLP to the conformance collector (`OPENWOP_OTEL_COLLECTOR=true` + the host pointed at it) — the harness half is done. |
| `secret-leakage-debug-bundle-otel` (protocol tier) | Same scrape seam (`POST /v1/host/sample/test/debug-bundle/export`) plus the same collector-side inspector for the OTel-export half of the bundle. | Same — collector-seam gap closed; debug-bundle export itself remains a host self-report surface (no over-the-wire analogue), covered by the scrape-seam canary check. |
| `node-pack-sandbox-no-eval` (the sole permanent sandbox exemption) | **All 7 testable `node-pack-sandbox-*` invariants are now `protocol` tier.** The 6 cross-runtime ones (`fs-gated`/`no-env`/`network-gated`/`no-process`/`memory-cap`/`isolated-context`) graduated 2026-05-31 via the portable server-free `conformance/src/scenarios/sandbox-wasm-isolation.test.ts`; `timeout` graduated 2026-06-01 via the worker-driven `sandbox-wasm-timeout.test.ts` (`probeTimeout` spawns a worker + a main-thread kill-timer — the preemption a server-free probe cannot do). All backed by the real-isolation host `examples/hosts/wasm-sandbox/`. | Nothing — `no-eval` is JS-runtime-specific (no cross-runtime `eval`/`new Function` semantics) and is a **permanent** exemption per RFC 0035 + `SECURITY/invariants.yaml` `non_testability_rationale`. (RFC 0035 `Active → Accepted` separately needs a **non-steward** sandbox-executing host — tracked in the open-RFC table, not here.) |
| Cross-engine append ordering | `append-ordering.test.ts` covers intra-engine sequence ordering; **CF-8 (two engines writing to one event log) is now covered behaviorally** by `cross-engine-append-behavior.test.ts` (2026-05-22) via the `POST /v1/host/sample/test/cross-engine/{append,read,reset}` seams (gated on `OPENWOP_TEST_CROSS_ENGINE_HARNESS=true`): multiple engines appending to one `channelId` converge to a single globally-ordered linearization, per-engine submission order is preserved, and reads after partition-heal converge to the same total order. All 4 behavioral assertions PASS against the reference workflow-engine (coverage.md grade A). | **CF-8 gap CLOSED.** Residual is adoption-only: a **non-steward** host advertising the matching `crossEngineOrdering` capability + passing the behavioral assertions (the cross-host hop). The harness + reference-host proof are done. |
| Workflow-engine reference — anonymous-auth fallback (dev/demo posture) | `auth.test.ts` "no Authorization header MUST return 401" returns 201 against the reference workflow-engine when it auto-mints an anon session for the app.openwop.dev demo. | **Now operator-closeable (2026-06-01):** the anon-session fallback is flag-gated by `OPENWOP_AUTH_ENFORCE_BEARER` (independent of `NODE_ENV`) — a conformance/production deployment sets it and the host returns the spec-correct 401, so `auth.test.ts` passes. The app.openwop.dev **demo** intentionally leaves it unset (anon UX). NOT a v1 spec break: the spec contract is bearer-required and any host enforcing it (flag on, or `NODE_ENV=production`) honors it. |

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
| Conformance leaderboard | **Built + committed; deploy is the only remaining step.** The page exists at `public/conformance/index.html` — titled "OpenWOP — Conformance leaderboard", generated by `site/src/build.mjs` from `INTEROP-MATRIX.md` (Host · use case · repo · compatibility-profile claim · scale claim · production-profile claim · conformance evidence link, plus the agent-platform status sub-table), reusing the per-host badge SVGs under `public/conformance/*.svg`. The build is verified on every relevant push by `.github/workflows/site.yml` (`node src/build.mjs`). The GOV-3 repo half is **DONE**; the only remaining step is the `firebase deploy --only hosting:docs` to `openwop.dev/conformance/`, which is a **release-manager action gated on `vars.ALLOW_DEPLOY=1`** — the one explicitly non-repo step. |
| External audit report | **Not yet engaged** (vendor-external — the steward cannot complete a third-party audit from inside the repo). Outreach drafted at `SECURITY/outreach/external-audit/STATUS.md`; SEC-2 audit scope pinned to current repo state 2026-05-15. **The remediation obligation is now mechanized:** `scripts/check-audit-findings.mjs` (wired into `openwop:check`) reads `SECURITY/external-audit-findings.json` and **hard-fails the gate on any OPEN high/critical finding** — so the moment the report lands and findings are recorded, an unremediated serious finding blocks every release / standardization claim. Passes today on the empty pre-audit tracker. |
| High-stakes `core.openwop.{ai,http,mcp,triggers}` packs | **Built + signed in-tree, audit-gated for public publication.** See `SECURITY/external-audit-engagement.md` §2.1. |

---

## Sample workflow-engine host: known implementation gaps

The reference workflow-engine sample (`apps/workflow-engine/`, live at `app.openwop.dev`) is sample/template code, not a normative reference host. Known gaps in its host-surface implementations:

| Gap | Detail |
|---|---|
| `ctx.suspend` / `ctx.interrupt` is **single-suspend-per-node** | The sample realises the `interrupt.md §"key field"` replay model by re-invoking a suspended node with ONE seeded resolution. A node that calls `ctx.suspend` **multiple times sequentially within one invocation** is not fully supported — on re-invoke only the latest resolution is seeded; the sample does not accumulate prior resolutions per `key` across re-invokes. The one pack node that does this is `core.openwop.a2a.multiTurnCoordinator` (it loops `ctx.suspend` up to `maxTurns` and supplies **no per-iteration `key`**, so it also under-specifies the deterministic key the spec recommends — `${runId}:${nodeId}:${interruptCount}`). All single-suspend gate nodes work correctly: `vendor.myndhyve.chat` (phaseInputGate/approvalGate/clarificationGate), `core.openwop.hitl` (formRequest/approvalRequest/askUser), `core.openwop.flow` `waitNode` (mutually-exclusive branches → one suspend per path), `core.openwop.mcp` `handleElicitation`. The chat `approvalGate` `'ask'` loop is orchestrated by workflow edges (not a second in-node suspend), so it is unaffected. A production host that re-seeds per-`key` across re-invokes (or keeps the suspended async frame alive) handles multi-suspend; this is a sample-host limitation, **not a spec constraint** — `interrupt.md` permits any number of keyed interrupts per run. |

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
| 0035 (Sandbox execution contract) | `Active` | A **real-isolation WASM reference host** now exists (`examples/hosts/wasm-sandbox/`, 2026-05-31) executing pack-loaded typeIds as WebAssembly; **all 7 testable `node-pack-sandbox-*` invariants graduated `reference-impl → protocol`** — the 6 cross-runtime ones (`fs-gated`/`no-env`/`network-gated`/`no-process`/`memory-cap`/`isolated-context`) via the portable server-free `conformance/src/scenarios/sandbox-wasm-isolation.test.ts` (10/10 non-vacuous against real `.wasm`), and `timeout` (2026-06-01) via the worker-driven `sandbox-wasm-timeout.test.ts` (`probeTimeout` spawns a worker + a main-thread kill-timer — the thread preemption a server-free probe cannot do) — superseding the 2026-05-22 premature graduation that was reverted (`5864a2f`). Only `no-eval` stays reference-impl (JS-runtime-specific permanent exemption). The invariant-tier graduation is independent of the RFC's own status: **RFC 0035 stays `Active`** because `Active → Accepted` needs a **non-steward** host that runs untrusted packs in a real-isolation sandbox (MyndHyve opted out: `no-untrusted-packs`). |
| 0038 (Working Group charter) | `Draft` | Ratifies the moment the `GOVERNANCE.md` tripwire fires (≥3 organizations + ≥2 non-steward hosts). The charter is **written**, not waiting on drafting work — the gate is adoption, not text. |
| 0043 (Registry + extension policy + IPR posture) | `Draft` | Consolidates extension-namespace rules, registry submission/yank/sign-key-rotation policy, profile/event-type/envelope-kind/capability-name reservation, and IPR posture (DCO + Apache-2.0 + CC-BY-4.0). Filed 2026-05-22 in response to the audit's "governance technically incomplete" finding. Path-to-`Active` is the 7-day comment window; WG ratification follows when the `GOVERNANCE.md` tripwire fires. |

RFCs **0078 (Portable Tool Catalog) + 0079 (Credential Provenance + Egress Policy) + 0084 (Budget, Quota, Cost Policy) + 0068 (Memory consolidation + commitments) + 0080 (Agent Memory Capability Reconciliation) + 0050 (SAML / SCIM enterprise identity) + 0066 (`x-openwop-form` vendor extension) + 0065 (Workflow node primary-output annotation) + 0067 (Provider-catalog conventions) + 0069 (exec-class tool host-extension safety contract) + 0075 (Artifact-type packs real-world amendment) + 0088 (`openwop-core-standard` Core Standard Profile) + 0085 (`openwop-agent-platform` meta-profile) + 0042 (Experimental capability tier)** **were all promoted `Active → Accepted` on 2026-06-01** — the close-out of the Active→Accepted graduation program. The eleven capability RFCs graduated on MyndHyve `workflow-runtime`'s live advertisement, the steward verifying each independently against the public `/.well-known/openwop` + the gated behavioral scenario passing non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true` (0050's real XML-DSig SAML ACS driven over the wire for all 7 §A variants + SCIM fail-closed; 0067/0088 §B contracts re-derived from the public doc; 0078/0079 the tool-egress batch; 0068/0080 the memory batch; 0084 budget; 0066/0065 genuine reference-frontend consumption). Three graduated **steward-side as mechanism-codifications** where a non-steward advertisement is structurally impossible or would be a false claim on the wire: **0069** (corpus-level `exec`-class carve-out — no capability to advertise; RFC 0054 amendment precedent), **0080** (the degraded-memory keystone — a maximal/durable host cannot honestly produce a degraded agent; amended criterion), and **0042** (a stability-signaling metadata convention — marking a stable cap `experimental` would be a false-stability signal; amended criterion, architect-gated). **0085** is the capstone — MyndHyve certified a *full* `openwop-agent-platform`. All fourteen left the open table above and are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`. With them, **only RFC 0035 (sandbox), 0038 (WG charter), and 0043 (registry/extension policy) remain open** — each externally- or governance-gated.

RFCs **0081 (Agent Evaluation, Scorecards, and Promotion Gates) + 0082 (Agent Deployment Lifecycle)** **were promoted `Active → Accepted` on 2026-06-01** on MyndHyve `workflow-runtime`'s live advertisement (rev `workflow-runtime-00435-sep`) — the eval → deploy → eval-gated-promotion batch, each passing its gated behavioral scenario (`agent-eval-run` / `agent-deployment-lifecycle`) non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true` + serving its normative read endpoint 401-gated. On 0082's graduation the `deployment-promotion-fail-closed` SECURITY invariant advanced `reference-impl → protocol`. Both left the open table above and are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0077 (Live Manifest Dispatch) + 0086 (Standing Agent Roster) + 0087 (Agent Org-Chart) + 0083 (Durable Trigger + Channel Bridge)** **were promoted `Active → Accepted` on 2026-05-31** on MyndHyve `workflow-runtime`'s live advertisement (the agent-platform arc — 0086+0077 first, then 0087, then 0083, each non-vacuously passing its gated behavioral scenario under `OPENWOP_REQUIRE_BEHAVIOR=true` + serving its normative read endpoint 401-gated; see `INTEROP-MATRIX.md`). RFC **0073 (Capability families at document root)** was promoted `Draft → Accepted` on 2026-05-31 once the conformance suite was made to **enforce** the document-root layout (the accessor's wrapper-fallback was dropped, so a wrapper-only host now grades non-conformant; the host-side mirror + schema hard-forbid are paired to v2.0). All five left the open table above and are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0029 (Prompt override hierarchy) + 0055 (Multimodal envelope variants) + 0057 (Memory-write attribution event)** **were promoted Active → Accepted on 2026-05-26** on MyndHyve workflow-runtime's round-3 advertisement (revision `workflow-runtime-00217-q7c`, openwop-side curl-verified — see `INTEROP-MATRIX.md` §"round 3"). RFC 0058 was **not** in the round-3 graduation — MyndHyve advertises `maxNodeExecutions` (the pre-existing recursionLimit bound), not RFC 0058's `limits.maxRunDurationMs` / `maxLoopIterations` surface; MyndHyve subsequently retracted the round-3 0058 claim (commit `11cacfe6b`); 0058 stayed `Active` through round-3. **0058 + 0061 then graduated `Active → Accepted` on MyndHyve's round-4 `version: 5` advertisement 2026-05-26** (`workflow-runtime-00390-vuh` — both arms shipped: `maxRunDurationMs` wall-clock + the `maxLoopIterations` loop arm riding RFC 0061's per-turn iteration counter; openwop-side curl-verified). RFC 0029/0055/0057/0058/0061 are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0059 (Agent workspace) + 0060 (`host.heartbeat`) + 0062 (Scheduled memory distillation) + 0063 (`core.subWorkflow.outputAttestation`) + 0064 (`host.toolHooks`)** **were promoted Draft → Active → Accepted on 2026-05-25** as the autonomous-agent-runtime cohort's M1 wire surfaces + M2 in-memory reference-host enforcement landed atomically. Three new protocol-tier SECURITY invariants land alongside: `workspace-cross-tenant-isolation` (RFC 0059), `subrun-merge-approval-fail-closed` (RFC 0063), and (via RFC 0049's `authorization-fail-closed` test set, no new invariant) the per-tool authz fail-closed assertion (RFC 0064). They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`. RFC 0058 + RFC 0061 (the cohort's stateful-loop keystone) graduated `Active → Accepted` 2026-05-26 on MyndHyve's round-4 `version: 5` advertisement — also `Accepted` in `docs/PROTOCOL-STATUS.md`, no longer in the open table above.

RFCs **0045 (connector pack manifest) + 0046 (`host.credentials`) + 0047 (`host.oauth`) + 0048 (tenant·workspace·principal identity) + 0049 (RBAC scopes) + 0051 (approval-gate primitive) + 0052 (scheduling triggers) + 0053 (dead-letter routing)** **were promoted Active → Accepted on 2026-05-25** as a single 8-RFC MyndHyve protocol-extension cohort (commit `c9c6bfc`, PR #148). Evidence: MyndHyve workflow-runtime advertises all five capability blocks live on `https://api.myndhyve.ai/.well-known/openwop` (curl-verified 2026-05-25); `@openwop/openwop-conformance@1.6.0` reports 28 PASS / 0 FAIL across the cohort on revision `workflow-runtime-00211-69w`. RFC 0050 (SAML/SCIM) + RFC 0054 (run diff) did **not** graduate with this 2026-05-25 cohort — MyndHyve had opted out at the time, so neither contributed to *that* graduation; both have since reached `Accepted` independently (RFC 0054 via an amended criterion; RFC 0050 `Active → Accepted` 2026-06-01 on MyndHyve's real XML-DSig SAML ACS + SCIM — see the 2026-06-01 promotion paragraph above). All are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

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

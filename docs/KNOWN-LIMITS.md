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
| `node-pack-sandbox-*` (8 reference-impl invariants) | 8 conformance scenario files shipped in `@openwop/openwop-conformance@1.4.0` (`sandbox-no-host-fs-escape`, `sandbox-no-host-env-leak`, `sandbox-no-network-escape`, `sandbox-no-host-process-escape`, `sandbox-memory-cap`, `sandbox-timeout-cap`, `sandbox-capability-gate-respected`, `sandbox-no-cross-pack-mutation`) but the behavioral assertions are `it.todo` stubs. A 2026-05-22 premature graduation to `protocol` tier was reverted (commit `5864a2f`) precisely because the scenarios were vacuous. Postgres pack-consumer verifies install-time security only (PACK-1/PACK-2). | First reference host that mounts loaded typeIds into a sandbox **and** real behavioral assertions land on the 8 conformance scenarios. Per RFC 0035 §"Acceptance criteria" — 7 of 8 invariants then graduate `reference-impl → protocol`. |
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
| External audit report | **Not yet engaged.** Outreach drafted at `SECURITY/outreach/external-audit/STATUS.md`; SEC-2 audit scope pinned to current repo state 2026-05-15. |
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

| RFC | Status | Why open |
|---|---|---|
| 0025 (Test-mode registry namespace) | `Active` | Schema + spec + OpenAPI + reference impl + conformance wiring landed 2026-05-25 (PR #102). 25 publish-error-catalog scenarios in `pack-registry-publish.test.ts` + 1 isolation scenario in `pack-registry-isolation.test.ts` soft-skip on absent `capabilities.packs.testMode.supported: true` advertisement; reference workflow-engine advertises when env-gated. Path-to-`Accepted` requires a second host advertising the capability. |
| 0029 (Prompt override hierarchy) | `Active` | 7-day comment window closed 2026-05-27. Resolution-chain wire shape + `agent.promptResolved` event landed; MyndHyve Tier-1 discovery still shows `agents: {}` (empty) and no `prompts.agentBindings`. Path-to-`Accepted` requires a non-steward host advertising `agentBindings: true`. |
| 0035 (Sandbox execution contract) | `Active` | Spec + schema + 8 conformance scenarios landed 2026-05-21. 7-of-8 SECURITY tier graduation **reverted 2026-05-22** (commit `5864a2f`) — scenarios were vacuous (`expect(true).toBe(true)` placeholders) until a sandbox-executing reference host wires real behavioral probes. Path-to-`Accepted` is unchanged: first sandbox-executing host advertises + scenarios grow real assertions + 7 of 8 invariants re-graduate. |
| 0036 (Multi-region + cross-engine guarantees) | `Active` | Capability shape + spec prose landed 2026-05-21. Behavioral assertions deferred to the Postgres multi-region simulator (CF-12 / OPS-5). |
| 0055 (Multimodal envelope variants + rendering hints + `media.*` reference payloads) | `Active` | Promoted Draft → Active 2026-05-25 as §A vocabulary + §B `meta.rendering` hint + §C media kinds landed atomically with schemas (`envelopes/media.{audio,file,image}.schema.json`), the `media-asset-url-tenant-scoped` SECURITY invariant, conformance scenarios (`envelope-rendering-hint.test.ts` + media-asset tests), the reference-app renderer, and reference-host serving (in-memory/sqlite host advertises `aiProviders.maxInlineMediaBytes` + `media.{image,audio,file}` and serves tenant-scoped capability-token asset URLs). Path-to-`Accepted` awaits a non-steward host advertising the matching capability blocks. |
| 0056 (Run feedback & annotation event) | `Active` | Promoted Draft → Active 2026-05-25. Surface landed atomically across schema (`capabilities.feedback` + `annotation.schema.json` + `annotation-create.schema.json`), OpenAPI/AsyncAPI (`POST/GET /v1/runs/{runId}/annotations` + the `run.annotated` SSE notification), 7 capability-gated conformance scenarios, all three reference SDKs, and the in-memory reference host (advertises `capabilities.feedback`, implements the per-run annotation side-store with SR-1 content redaction). Two new protocol-tier SECURITY invariants (`annotation-cross-tenant-isolation`, `annotation-content-redaction`). Path-to-`Accepted` awaits non-steward adoption. |
| 0038 (Working Group charter) | `Draft` | Ratifies the moment the `GOVERNANCE.md` tripwire fires (≥3 organizations + ≥2 non-steward hosts). The charter is **written**, not waiting on drafting work — the gate is adoption, not text. |
| 0042 (Experimental capability tier) | `Draft` | Adds optional `capabilities.<feature>.tier ∈ {stable, experimental}` + `experimentalUntil` sunset rule. Filed 2026-05-22 in response to the 2026-05-22 audit's "Active RFC → experimental carve-out" recommendation. Path-to-`Active` is the 7-day comment window. |
| 0043 (Registry + extension policy + IPR posture) | `Draft` | Consolidates extension-namespace rules, registry submission/yank/sign-key-rotation policy, profile/event-type/envelope-kind/capability-name reservation, and IPR posture (DCO + Apache-2.0 + CC-BY-4.0). Filed 2026-05-22 in response to the audit's "governance technically incomplete" finding. Path-to-`Active` is the 7-day comment window; WG ratification follows when the `GOVERNANCE.md` tripwire fires. |
| 0050 (SAML / SCIM enterprise identity profiles) | `Draft` | MyndHyve Tier 2 (filed 2026-05-25). SAML assertion-validation (`alg:none` rejection mirroring OIDC) + SCIM provisioning profiles mapping IdP users/groups onto RFC 0048 principals + RFC 0049 roles. Extends RFC 0010. MyndHyve opted out of this profile, so it did not graduate with the 8-RFC cohort on 2026-05-25; path-to-`Active` is the 7-day comment window. |
| 0054 (Run diff & execution comparison) | `Draft` | MyndHyve Tier 3 (filed 2026-05-25). Read-only `GET /v1/runs/{runId}:diff?against={otherRunId}` returning a deterministic, replay-aware structured diff. Depends on RFC 0011 fork; aligns with `replay.md` `replay.diverged`. MyndHyve opted out; did not graduate with the cohort. Path-to-`Active` is the 7-day comment window. |
| 0057 (Memory-write attribution event) | `Draft` | Filed 2026-05-25. Optional `memory.attribution` capability + additive `memory.written` RunEvent carrying `{ memoryRef, memoryId, nodeId?, agentId? }` (identifiers only — no content) so consumers can attribute per-node memory provenance. Closes an `agent-memory.md` Open spec gap. Path-to-`Active` is the 7-day comment window. |
| 0066 (`x-openwop-form` vendor extension) | `Draft` | Filed 2026-05-25. Reserves the `x-openwop-form` advisory annotation on pack-manifest `configSchema` properties so hosts can hint a picker UX (`prompt-picker`, `provider-picker`, `model-picker`, `credential-picker`, plus generic `text` / `textarea` / `string-list`) without expanding wire shape. Pure additive per `COMPATIBILITY.md` §2.1; renderer treats unknown `kind` values as `text` (forward-compat). Path-to-`Active` is the 7-day comment window. Path-to-`Accepted` requires (a) a shape-conformance scenario validating that `x-openwop-form` MUST NOT bypass the underlying `configSchema` validators and that `dependsOn` cascade-clear is honored, (b) RFC 0043 cross-reference once 0043 promotes (vendor-extension reservation is logically a `0043` concern), and (c) a non-steward host advertising a pack with `x-openwop-form` annotations. The reference renderer extension (Phase 2 — consume the picker `kind` values in `Inspector.tsx`) lands after Active. |

RFCs **0045 (connector pack manifest) + 0046 (`host.credentials`) + 0047 (`host.oauth`) + 0048 (tenant·workspace·principal identity) + 0049 (RBAC scopes) + 0051 (approval-gate primitive) + 0052 (scheduling triggers) + 0053 (dead-letter routing)** **were promoted Active → Accepted on 2026-05-25** as a single 8-RFC MyndHyve protocol-extension cohort (commit `c9c6bfc`, PR #148). Evidence: MyndHyve workflow-runtime advertises all five capability blocks live on `https://api.myndhyve.ai/.well-known/openwop` (curl-verified 2026-05-25); `@openwop/openwop-conformance@1.6.0` reports 28 PASS / 0 FAIL across the cohort on revision `workflow-runtime-00211-69w`. RFC 0050 (SAML/SCIM) + RFC 0054 (run diff) stay `Draft` — MyndHyve opted out; neither contributes to graduation. They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0028 (Prompt library endpoints) + 0034 (OTel collector test seam) + 0040 (`version: 3` cross-host causation) + 0041 (`version: 4` replay determinism)** **were promoted Active → Accepted on 2026-05-25** on the strength of MyndHyve workflow-runtime's `capabilities.prompts.{packsSupported: true, mutableLibrary: true, library: {...}}` Tier-2 advertisement (RFC 0028), the same revision's `observability.testSeams.otelScrape: true` adoption (RFC 0034), and the staged `multiAgent.executionModel.version: 3 → 4` rollout backed by a Firestore-backed observable-result cache (RFCs 0040 + 0041). The multi-agent execution model roadmap (versions 1–4) is now Accepted end-to-end on a non-steward host. They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFCs **0037 (`version: 1` — handoff state machine) + 0039 Half A (confidence-floor escalation) + 0044 (confidence-escalation interrupt-kind advertisement)** **were promoted Active → Accepted on 2026-05-22** in a single batch on the strength of MyndHyve workflow-runtime's cross-host conformance run (revision `workflow-runtime-00353-rab` against `@openwop/openwop-conformance@1.5.0`). RFC 0044 lands the `confidenceEscalationInterruptKind` vendor-extension pattern that lets entrenched host semantics (`x-host-<host>-<kind>`) pass conformance without cross-cutting renames. They are listed as `Accepted` in `docs/PROTOCOL-STATUS.md`.

RFC **0027 (Prompt templates wire shape)** was promoted **Active → Accepted on 2026-05-23** (commit `8f65168`) after MyndHyve workflow-runtime adopted the prompt-compose seam end-to-end. RFC 0029 remains `Active` pending the `agentBindings: true` advertisement.

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

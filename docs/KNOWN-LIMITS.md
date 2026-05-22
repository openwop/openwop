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
| `replay-divergence-at-refusal.test.ts` behavioral, `replay-observable-sequence-determinism.test.ts` boundary | RFC 0041 Phase 4 scenarios. The advertisement-shape probes are behavioral; the refusal-divergence + observable-sequence behavioral assertions soft-skip until reference workflow-engine wires a staged-refusal seam on the mock-AI provider AND a `conformance-phase4-nondet-tool` fixture ships. | Workflow-engine Phase 4 implementation (refusal-staging seam + nondeterministic-tool fixture). |
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
| 0025 (Test-mode registry namespace) | `Draft` | Conformance-only typeId namespace; non-production. Pending non-steward adoption signal before promotion. |
| 0027, 0028, 0029 (Prompt templates / library endpoints / override hierarchy) | `Active` | 7-day comment window closed 2026-05-27; awaiting cross-host advertisement evidence per RFCS/0001 §"Promotion to Accepted." |
| 0034 (OTel collector test seam) | `Active` | Schema + spec prose + reference impl landed 2026-05-21; awaiting a non-steward host wiring the seam to graduate. |
| 0035 (Sandbox execution contract) | `Active` | Spec + schema + 8 conformance scenarios landed 2026-05-21. 7-of-8 SECURITY tier graduation **reverted 2026-05-22** (commit `5864a2f`) — scenarios were vacuous (`expect(true).toBe(true)` placeholders) until a sandbox-executing reference host wires real behavioral probes. Path-to-`Accepted` is unchanged: first sandbox-executing host advertises + scenarios grow real assertions + 7 of 8 invariants re-graduate. |
| 0036 (Multi-region + cross-engine guarantees) | `Active` | Capability shape + spec prose landed 2026-05-21. Behavioral assertions deferred to the Postgres multi-region simulator (CF-12 / OPS-5). |
| 0037, 0039, 0040, 0041 (Multi-agent execution model Phases 1–4) | `Active` | Phase 1 + Phase 2 confidence-floor + Phase 4 staged-refusal seam are wired against the reference workflow-engine end-to-end; Phase 3 cross-host causation + the Phase 4 nondeterministic-tool fixture await a second host. Path-to-`Accepted` is a non-steward host advertising `multiAgent.executionModel.version: 4` end-to-end. |
| 0038 (Working Group charter) | `Draft` | Ratifies the moment the `GOVERNANCE.md` tripwire fires (≥3 organizations + ≥2 non-steward hosts). The charter is **written**, not waiting on drafting work — the gate is adoption, not text. |

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

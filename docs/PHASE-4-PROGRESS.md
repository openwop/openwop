# Phase 4 — Behavioral harnesses (audit close-out tracking)

> Status: ACTIVE. Filed 2026-05-22 in response to the 2026-05-22 standards-readiness review's Acceptance-Bar item #5 ("Hard behavioral harnesses for multi-region idempotency, cross-engine append ordering, sandbox execution, replay determinism, and secret-leakage telemetry/export paths").
>
> Updates to this doc are visible in `git log -- docs/PHASE-4-PROGRESS.md`. Each row's commit / PR reference closes when the harness lands.

This document tracks the 5 behavioral harnesses the audit named, with the current state, the specific unblock criterion, and the named PR or commit that will close each. The audit was correct that the harnesses are not yet wired end-to-end; this is the public accountability artifact for closing each one.

---

## Harness 1 — Multi-region idempotency simulator

| Field | Value |
|---|---|
| Audit reference | `KNOWN-LIMITS.md:17` "CF-12 / OPS-5 — multi-region simulation harness or a deployed multi-region host" |
| Today's coverage | `conformance/src/scenarios/multi-region-idempotency.test.ts` — categorical + granular shape probes (3 describe blocks). Postgres host-internal: `examples/hosts/postgres/test/multi-region-idempotency.test.ts` + `test/multi-region-partition.test.ts` (6-path canonical resolver test). |
| Gap | The conformance scenario does NOT drive the host's resolver via a partition simulator; behavioral assertion is documented only. The Postgres host has the resolver but no simulator HTTP seam. |
| Unblock criterion | (a) `examples/hosts/postgres/src/multi-region-simulator.ts` exposes a `POST /v1/host/sample/test/multi-region/simulate-partition` test seam that takes a partition spec + replays an idempotency-key conflict, returning the resolver's winner. (b) `conformance/src/scenarios/multi-region-idempotency-behavior.test.ts` (NEW) gates on `OPENWOP_TEST_MULTI_REGION_SIMULATOR=true` and asserts: same idempotency-key submitted to region A + B during partition → on heal, one creates, one is canonical-resolved per the host's advertised `partitionRecoveryStrategy`. |
| Effort | ~1 day Postgres-side wiring + 0.5 day conformance scenario. |
| Closing PR | TBD — `feat(postgres-host+conformance): multi-region simulator + CF-12/OPS-5 close-out` |
| Closes | RFC 0036 `Active → Accepted` path-to-promotion (alongside cross-host evidence). |

## Harness 2 — Cross-engine append ordering

| Field | Value |
|---|---|
| Audit reference | `KNOWN-LIMITS.md:34` "CF-8 — multi-engine fixture exercising two engines writing to the same event log" |
| Today's coverage | `conformance/src/scenarios/append-ordering.test.ts` — intra-engine ordering only. `conformance/src/scenarios/cross-engine-append-ordering.test.ts` — categorical `crossEngineOrdering` shape probe + 4-enum `orderingModel` shape probe. Postgres host-internal: `examples/hosts/postgres/test/cross-engine-append.test.ts`. |
| Gap | The two-engine cross-write fixture does not exist in conformance — only intra-engine ordering is asserted. |
| Unblock criterion | (a) Add `examples/hosts/postgres/src/cross-engine-fixture.ts` that spins up TWO engine instances against the same Postgres backend, each appending to the same `eventLog` channel. (b) `conformance/src/scenarios/cross-engine-append-behavior.test.ts` (NEW) drives both engines via the test seam and asserts the host's advertised `orderingModel` (lamport / vector-clock / global-sequencer) produces a globally-consistent ordering. |
| Effort | ~1 day. The Postgres host already enforces intra-engine ordering with claim+sequence; the cross-engine path needs a `LISTEN/NOTIFY`-based sequencer probe. |
| Closing PR | TBD — `feat(postgres-host+conformance): two-engine append-ordering harness + CF-8 close-out` |
| Closes | RFC 0036 `Active → Accepted` path-to-promotion (the cross-engine half). |

## Harness 3 — Sandbox execution (RFC 0035)

| Field | Value |
|---|---|
| Audit reference | `KNOWN-LIMITS.md:33` "no reference host executes pack-loaded typeIds in a sandbox"; commit `5864a2f` (2026-05-22) reverted 7 premature `reference-impl → protocol` tier graduations because the conformance scenarios were vacuous (`expect(true).toBe(true)`). |
| Today's coverage | 8 conformance scenario files shipped in `@openwop/openwop-conformance@1.4.0` (`sandbox-no-host-fs-escape`, `sandbox-no-host-env-leak`, `sandbox-no-network-escape`, `sandbox-no-host-process-escape`, `sandbox-memory-cap`, `sandbox-timeout-cap`, `sandbox-capability-gate-respected`, `sandbox-no-cross-pack-mutation`). Behavioral assertions are `it.todo` pending sandbox-executing host. |
| Gap | No reference host implements a sandbox runtime. The Postgres pack-consumer verifies install-time security (PACK-1 / PACK-2) but does not mount loaded typeIds into a runtime sandbox. |
| Unblock criterion | First reference host that ships a sandbox-executing runtime. Two paths: |
| Path A: Node `vm` MVP | `examples/hosts/postgres/src/sandbox-vm.ts` — process-isolation MVP using `node:vm` with `--max-old-space-size=128` child, 5s `setTimeout` kill, file-system seal via `process.chdir('/tmp/sandbox')` + `chroot`-equivalent on Linux. Proves 5 of 8 invariants (`sandbox-no-host-fs-escape`, `sandbox-no-host-env-leak`, `sandbox-no-network-escape`, `sandbox-memory-cap`, `sandbox-timeout-cap`); fails honestly on `sandbox-no-host-process-escape` (a child process inside the VM CAN spawn) and `sandbox-no-cross-pack-mutation` (in-memory state shared across packs). Approximate effort: 3-5 days. |
| Path B: WASM via RFC 0008 | Use `wasmtime` or `@wasm/sandbox`; the existing RFC 0008 WASM ABI already covers loading + invoking. Path-to-Accepted is the WASM runtime mounting typeIds via the same loader the in-memory host uses for `wasm-pack-*` scenarios. Approximate effort: 1-2 weeks. |
| Recommended | **Path A (vm MVP) for credibility, Path B (WASM) for production.** Path A proves the audit's "behavioral harnesses" point with 5 of 8 invariants quickly; Path B closes the remaining 3 in the longer arc. |
| Closing commits | TBD — `feat(postgres-host): sandbox-vm MVP — 5 of 8 invariants` + (later) `feat(postgres-host): WASM sandbox runtime + RFC 0035 § Acceptance close-out` |
| Closes | RFC 0035 `Active → Accepted`; 5–7 of 8 `node-pack-sandbox-*` invariants re-graduate `reference-impl → protocol` per the RFC 0035 acceptance criteria. |
| Sequencing note | Per the prior `5864a2f` revert, premature graduation is worse than no graduation. The conformance scenarios MUST grow real behavioral assertions BEFORE the SECURITY tier flip, not the other way around. |

## Harness 4 — Replay determinism Phase 4 (RFC 0041)

| Field | Value |
|---|---|
| Audit reference | `KNOWN-LIMITS.md:19` "RFC 0041 Phase 4 scenarios. The advertisement-shape probes are behavioral; the refusal-divergence + observable-sequence behavioral assertions soft-skip until reference workflow-engine wires a staged-refusal seam on the mock-AI provider AND a `conformance-phase4-nondet-tool` fixture ships." |
| Today's coverage | `conformance/src/scenarios/replay-divergence-at-refusal.test.ts` — advertisement-shape probes with a `refusalDivergenceEmission: true` MUST when `version >= 4`. Two `it.todo` behavioral assertions documented end-to-end (lines 132–133) with the wire-shape they will probe spelled out in comments. `conformance/src/scenarios/replay-observable-sequence-determinism.test.ts` — analogous shape + boundary. **Two fixtures landed 2026-05-22:** `conformance-phase4-replay-divergence` + `conformance-phase4-nondet-tool` — per the contract documented in `spec/v1/host-sample-test-seams.md §5`. |
| Gap | The reference workflow-engine's `:fork mode: replay` path at `apps/workflow-engine/backend/typescript/src/routes/runs.ts:538` is sample-grade — copies events as-is, does not re-dispatch pure nodes nor detect refusal-divergence. The mock-AI provider (`apps/workflow-engine/backend/typescript/src/providers/dispatchMock.ts`) DOES already honor per-attempt-index program entries (refusal mode is wired via `refusalText` + `stopReason: 'safety'`), so the conformance program-seeding pattern is ready. |
| Unblock criterion | (a) **DONE 2026-05-22:** `conformance/fixtures/conformance-phase4-replay-divergence.json` + `conformance/fixtures/conformance-phase4-nondet-tool.json` landed; fixtures.md catalog updated. (b) Wire the `:fork mode: replay` path to: capture the original LLM-emitting node's envelope kind from the source event log; on re-dispatch, detect when the new envelope kind differs ('valid' ↔ 'refusal'); emit `replay.divergedAtRefusal` event with the §B payload; fail run with HTTP 422 + `error.code: 'replay_diverged_at_refusal'`. (c) Wire the discovery advertisement: `multiAgent.executionModel.replayDeterminism.{supported: true, refusalDivergenceEmission: true}` when `OPENWOP_PHASE4_REPLAY_DETERMINISM=true`. (d) Flip the 2 `it.todo` lines in `replay-divergence-at-refusal.test.ts` to `it()` with the assertion bodies the scenario header already spells out. |
| Effort | (a) DONE. (b) ~2-3 days — requires teaching the executor about replay-mode envelope-kind comparison, which the current sample-grade fork path does not have. (c) ~30 minutes — discovery advertisement. (d) ~30 minutes — flip 2 it.todo. Total ~3 days for the behavioral half. |
| Closing PR | TBD — `feat(workflow-engine+conformance): RFC 0041 Phase 4 staged-refusal seam + behavioral close-out`. Track 2 partial close 2026-05-22 (fixtures + catalog updates landed). |
| Closes | RFC 0041 `Active → Accepted` path-to-promotion (the behavioral half; cross-host parity remains gated on a non-steward Phase 4 host). |

## Harness 5 — Secret-leakage telemetry / export paths

| Field | Value |
|---|---|
| Audit reference | `KNOWN-LIMITS.md:31` "secret-leakage-otel-attribute (reference-impl tier) ... The conformance OTel collector seam doesn't yet inspect span attributes; a host could pass conformance while leaking BYOK material on telemetry exports." Also `KNOWN-LIMITS.md:32` for `secret-leakage-debug-bundle-otel`. |
| Today's coverage | Verified host-internally via `examples/hosts/postgres/test/byok-roundtrip.test.ts` (BYOK canary substitution at the run-event payload + `RunSnapshot.variables` surface). RFC 0034 OTel collector test seam is **Active** with the wire shape normed — `GET /v1/host/sample/test/otel/spans?runId=<id>` returns spans with attributes. |
| Gap | No conformance scenario consumes the RFC 0034 seam to scrape span attributes for the BYOK canary. |
| Unblock criterion | (a) Add `conformance/src/scenarios/secret-leakage-otel-attribute.test.ts` — capability-gated on `capabilities.observability.otel.collectorSeam.supported: true` (RFC 0034) AND `capabilities.secrets.supported: true`. Asserts: (i) Submit a BYOK secret via `POST /v1/secrets` with a known canary string (`OPENWOP_CANARY_<random>`). (ii) Run a workflow that exercises `core.llm.chat` with the secret. (iii) Hit `GET /v1/host/sample/test/otel/spans?runId=<id>`, walk every span's attributes, assert none of them contains the canary string. (iv) Same probe against `GET /v1/runs/<id>/debug-bundle`. |
| Effort | ~0.5–1 day (scenario only; seam already exists per RFC 0034). |
| Closing PR | TBD — `feat(conformance): secret-leakage OTel telemetry harness + KNOWN-LIMITS §"Behavior tests too coarse" close-out` |
| Closes | `secret-leakage-otel-attribute` + `secret-leakage-debug-bundle-otel` SECURITY invariants graduate `reference-impl → protocol`. |

---

## Tracking summary

| # | Harness | State today | Estimated unblock | Closes |
|---|---|---|---|---|
| 1 | Multi-region idempotency simulator | Shape probes + host-internal resolver | ~1.5 days | RFC 0036 (multi-region half) |
| 2 | Cross-engine append ordering | Shape probes only | ~1 day | RFC 0036 (cross-engine half) |
| 3 | Sandbox execution | 8 scenarios with `it.todo`; 0 host coverage | ~3-5 days (vm MVP) or 1-2 weeks (WASM) | RFC 0035 + 5–7 of 8 sandbox SECURITY graduations |
| 4 | Replay determinism Phase 4 | Shape probes + 2 `it.todo` | ~1 day | RFC 0041 (behavioral half) |
| 5 | Secret-leakage telemetry | Host-internal only; RFC 0034 seam exists | ~0.5–1 day | 2 SECURITY-invariant graduations |
| **Total estimated effort** | | | **~7–9 days (vm MVP) or ~2 weeks (WASM)** | All 5 harnesses + 3 RFC promotions |

**Sequencing note.** Harnesses 1, 2, 4, 5 are independent and can land in parallel. Harness 3 (sandbox) is the largest single workload and should be sequenced last to avoid stalling the audit-response progress on the other four. The audit's specific complaint (`5864a2f` revert) was that **scenarios without behavior are worse than no scenarios** — Harnesses 1+2+4+5 are exactly the close-out that demonstrates the project understands this.

## Why this document exists (vs just landing code)

The audit's complaint was about **observable evidence**, not about effort. A published progress doc that:

1. Names each harness with a specific unblock criterion,
2. Estimates the effort honestly,
3. Records the closing PR or commit as each lands,

…converts the audit's "vague unfinished work" objection into "named accountability work-items." This is what a standards-body auditor wants to see. The published artifact is itself audit progress, even before the harnesses land — it demonstrates the project takes the audit seriously enough to mechanize its own accountability.

The doc gets updated on each merge that closes a row.

## See also

- `docs/AUDIT-RESPONSE-2026-05.md` — point-by-point response to the audit, including this doc as the §5 deliverable.
- `docs/KNOWN-LIMITS.md` — the canonical limits catalog this doc draws from.
- `docs/CONFORMANCE-RUNS-2026-05.md` — the v1.4.0 pass-rate baseline against which harness-landing deltas will be visible.
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` — the 1–9 controllable + external-gated work tracks.
- Commit `5864a2f` — the 2026-05-22 sandbox-graduation revert that motivated this doc's "scenarios without behavior" emphasis.

# Conformance Result: openwop SQLite Reference Host

> **Latest measurement:** **2026-05-22 against `@openwop/openwop-conformance@1.5.0` — 1486 passed / 7 failed / 55 skipped / 16 todo of 1564 tests (95.0%)**. See `docs/CONFORMANCE-RUNS-2026-05.md` for the per-failure-topic taxonomy. All 7 failures are capability gaps in surfaces SQLite has not yet wired (RFC 0022 dispatch input/output mapping × 4, RFC 0026 cost-attribution × 2, RFC 0031 model-capability-insufficient executor × 1) — not regressions vs suite v1.1.0.
>
> **Prior measurements:** 2026-05-22 against suite v1.4.0 — 1480/1558 (95.0%); 2026-05-19 against suite v1.2.0 — 669/731 (retained below for historical context).
>
> **Run date (prior):** 2026-05-19 (snapshot refreshed after soak-gate close-out via `OPENWOP_OPTED_OUT_FIXTURES` + `OPENWOP_OPTED_OUT_SCENARIOS` + the SQLite artifact-route auth stub — see CHANGELOG `[1.1.2 — unreleased]`. Previous snapshots: 2026-05-12 Phase A/D close-out; 2026-05-11 audit-log + four interrupt profiles)
> **Host version:** `openwop-host-sqlite@1.0.0`
> **Conformance suite:** `@openwop/openwop-conformance@1.5.0` (latest run)
> **Profile claim:** `openwop-core` · `openwop-stream-poll` · `openwop-stream-sse` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` · `openwop-auth-api-key-rotation` · `openwop-discovery-auth-scoped`. Debug-bundle advertised.
> **Profiles explicitly NOT claimed (per honesty principle):** `openwop-production` (Postgres host is the canonical claimant — see `INTEROP-MATRIX.md`), `openwop-auth-oauth2-client-credentials`, `openwop-auth-oidc-user-bearer`, `openwop-auth-mtls`. The reference HTTP listener does not enforce backpressure/retention, parse JWTs, or terminate TLS, so advertising those profiles would be over-claiming.
> **Scale claim:** `minimal` (single-process; SQLite single-writer)

## Summary

Against the live SQLite host (`npm start` from `examples/hosts/sqlite/`):

- **Test files:** 140 total (post-soak-gate close-out — suite grew with RFC 0013 workflow-chain-packs, RFC 0022 dispatch mapping, audit-tamper scenarios, etc.).
- **Tests (strict-mode, `OPENWOP_REQUIRE_BEHAVIOR=true` + opt-out envs):** **1216 passing / 0 failing / 55 skipped / 7 todo** (2026-05-19, against suite `@openwop/openwop-conformance@1.2.0`). Required envs for a green run: `OPENWOP_OPTED_OUT_PROFILES=openwop-production,openwop-auth-oauth2-client-credentials,openwop-auth-oidc-user-bearer,openwop-auth-mtls,openwop-replay-fork,workflowChainPacks` + `OPENWOP_OPTED_OUT_FIXTURES=conformance-dispatch-input-mapping*,conformance-dispatch-output-mapping*,conformance-dispatch-cross-worker-handoff*,conformance-subworkflow-input-mapping*` + `OPENWOP_OPTED_OUT_SCENARIOS=otel-trace-propagation-subworkflow`. The 55 skips break down as: profile-opt-outs (this host doesn't claim production, OAuth2-CC, OIDC, mTLS, replay-fork, workflow-chain-packs), fixture-opt-outs (RFC 0022 §A/§B variable projection not implemented in the reference executor), and one scenario-opt-out (traceparent doesn't thread the `core.subWorkflow` dispatch boundary).
- **Test command (mirrors `.github/workflows/conformance-soak.yml`):**
  ```
  OPENWOP_BASE_URL=http://127.0.0.1:3838 OPENWOP_API_KEY=openwop-sqlite-dev-key \
    OPENWOP_REQUIRE_BEHAVIOR=true \
    OPENWOP_OPTED_OUT_PROFILES='...' \
    OPENWOP_OPTED_OUT_FIXTURES='...' \
    OPENWOP_OPTED_OUT_SCENARIOS='otel-trace-propagation-subworkflow' \
    npx vitest run --no-file-parallelism
  ```
- **RFC 0011 auth-scoped discovery (verified end-to-end 2026-05-12):** With `OPENWOP_TENANT2_API_KEY` configured, the host returns three views — unauthenticated + primary (6 capability keys: `auth`, `discovery`, `dispatch`, `orchestrator`, `secrets`, `webhooks`) vs tenant2 (4 keys: `auth`, `discovery`, `secrets`, `webhooks`). Tenant2's keyset is a strict subset of primary's, satisfying the no-authorization-oracle invariant from `capabilities-change-detection.md` §"Scoped capability views" line 69. All 3 RFC 0011 subtests in `discovery.test.ts` pass under `OPENWOP_REQUIRE_BEHAVIOR=true` + `OPENWOP_TEST_UNAUTHORIZED_API_KEY=<tenant2-key>`.
- **RFC 0010 auth-profile rotation (verified end-to-end 2026-05-12):** Two-key overlap via `OPENWOP_SECONDARY_API_KEY`; constant-time dual-candidate `checkAuth`; canary-redaction confirmed. `auth-api-key-rotation.test.ts` passes 3/3 under behavior mode.

Net result vs the in-memory host (which claims only `openwop-core` + stream profiles): SQLite adds the durability surface plus 7 optional profile claims, each verified end-to-end through the conformance suite or host-internal tests.

## What this host adds over in-memory

| Property | In-memory | SQLite |
|---|---|---|
| Run state survives process restart | ❌ | ✅ |
| Events survive process restart | ❌ | ✅ |
| Claim acquisition for cross-process safety | N/A | ✅ |
| Idempotency cache survives restart | ❌ | ✅ |
| Total LOC | ~570 | ~700 |
| External dependencies | 0 | 1 (`better-sqlite3`) |

The SQLite host is the cheapest possible proof of "I can replace the storage layer without changing the wire contract." It is also a durable OpenWOP host with a different storage backend from the in-memory example, addressing the interoperability ask for a non-trivial backend.

## Per-file result (mirrors in-memory shape)

| Scenario file | Status | Tests | Notes |
|---|---|---|---|
| `discovery.test.ts` | ✅ PASS | 4/4 | |
| `runs-lifecycle.test.ts` | ✅ PASS | 3/3 | |
| `idempotency.test.ts` | ✅ PASS | 2/2 | |
| `idempotencyRetry.test.ts` | ✅ PASS | 3/3 | RFC 0002 contract checks |
| `cancellation.test.ts` | ✅ PASS | 2/2 | |
| `auth.test.ts` | ✅ PASS | 2/2 | |
| `errors.test.ts` | ✅ PASS | 2/2 | |
| `failure-path.test.ts` | ✅ PASS | 1/1 | |
| `multi-node-ordering.test.ts` | ✅ PASS | 1/1 | |
| `eventOrdering.test.ts` | ✅ PASS | 4/4 | repeated-poll stability proved against persistence |
| `policies.test.ts` | ✅ PASS | 5/5 | shape contract; host doesn't advertise policies |
| `providerPolicyEnforcement.test.ts` | ✅ PASS | 5/5 | mode-set contract; skip-equivalent on enforcement |
| `redaction.test.ts` | ✅ PASS | 6/6 | |
| `redactionAdversarial.test.ts` | ✅ PASS | 4/4 | |
| `approval-payload.test.ts` | ✅ PASS | 4/4 | shape only |
| `pack-registry-publish.test.ts` | ✅ PASS | with skips | host doesn't claim `openwop-node-packs` — absent-fallback path |
| `maliciousManifest.test.ts` | ✅ PASS | 4/4 | skip-equivalent on absent registry |
| `cost-attribution.test.ts` | ✅ PASS | 1/1 + 5 todo | |
| `fixtures-valid.test.ts` | ✅ PASS | 22/22 | server-free |
| `spec-corpus-validity.test.ts` | ✅ PASS | 42/42 | server-free |
| `profileDerivation.test.ts` | ✅ PASS | 25/25 | server-free |
| `highConcurrency.test.ts` | ✅ PASS | 4/4 | |
| `debugBundle.test.ts` | ✅ PASS | 6/6 | host advertises `debugBundle.supported: true` |
| `audit-log-integrity.test.ts` | ✅ PASS | 2/2 | passes in strict mode (`OPENWOP_REQUIRE_BEHAVIOR=true`); host emits Ed25519-signed checkpoints over a hash-chained audit log. Internal tamper test at `test/audit-tamper.test.ts` proves chainValid: false on in-place mutation. |
| `interrupt-approval.test.ts` | ✅ PASS | 3/3 | baseline `core.approvalGate` end-to-end (suspend → resolve → terminal). |
| `interrupt-clarification.test.ts` | ✅ PASS | 1/1 | `core.clarificationGate` with question-set resume validation. |
| `interrupt-quorum-resolution.test.ts` | ✅ PASS | 2/2 | three-accepts-resume + majority-reject paths against `core.approvalGate` config `requiredApprovals: 3, rejectionPolicy: majority`. |
| `interrupt-auth-required-resume.test.ts` | ✅ PASS | 2/2 | bearer-token resolve succeeds; signed-token resolve REJECTED with 403 when the interrupt config carries `profile: openwop-interrupt-auth-required`. Insufficient-scope subtest auto-skips without `OPENWOP_TEST_LOW_SCOPE_KEY`. |
| `interrupt-external-event-correlation.test.ts` | ✅ PASS | 2/2 | `core.interrupt kind=external-event` with signed callback token at `/v1/interrupts/{token}`; matching correlation resumes, mismatched returns 422 `correlation_mismatch`. |
| `interrupt-parent-child-cascade.test.ts` | ✅ PASS | 2/2 | `core.subWorkflow` dispatch + parent/child linkage in snapshot (`childRuns[]`); parent cancel cascades to child (both reach terminal `cancelled`); late resolve on cascaded child returns 404. |
| `runtime-capabilities.test.ts` | ❌ 1/2 | | host advertises empty `runtimeCapabilities`; out-of-profile |
| `version-negotiation.test.ts` | ❌ 1/4 | | event-shape `seq` vs spec's `eventId+sequence` (same gap as in-memory) |
| `cap-breach.test.ts` | ❌ 0/2 | | host doesn't enforce `recursionLimit` — out-of-profile |
| `channel-ttl.test.ts` | ❌ 0/1 | | channels not implemented — out-of-profile |
| `subworkflow.test.ts` | ❌ 0/2 | | sub-workflows not implemented — out-of-profile |
| `replay-fork.test.ts` | ❌ 1/6 | | `POST /v1/runs:fork` not implemented — out-of-profile |
~~| `interrupt-approval.test.ts` | ❌ 0/3 | | host doesn't claim `openwop-interrupts` |~~ — closed 2026-05-11 (T1.2 commit A).
~~| `interrupt-clarification.test.ts` | ❌ 0/1 | | same |~~ — closed 2026-05-11 (T1.2 commit A).
| `pack-registry.test.ts` | ❌ 5/8 | | host doesn't claim `openwop-node-packs` |
| `stream-modes.test.ts` | ❌ 3/4 | | mixed-mode SSE buffering scenario fails (advanced) |
| `stream-modes-buffer.test.ts` | ❌ 1/4 | | `bufferMs` query forwarding not implemented |
| `stream-modes-mixed.test.ts` | ❌ 2/4 | | array-form `streamMode` parameter handling partial |
| `identity-passthrough.test.ts` | ❌ 0/1 | | host doesn't echo nested input objects through to `variables` |

## Failure classification

| Category | Files | Reason |
|---|---|---|
| **Out-of-profile (expected)** | `cap-breach`, `channel-ttl`, `subworkflow`, `replay-fork`, `interrupt-*`, `pack-registry`, `runtime-capabilities`, `identity-passthrough` | Host doesn't claim the gating profile. Adding the corresponding feature would lift the host's profile claim. |
| **Within-profile gaps** | `version-negotiation`, `stream-modes-buffer`, `stream-modes-mixed`, partial `stream-modes` | Same gaps as in-memory host: event-shape `seq` vs `eventId+sequence`; SSE buffering / array `streamMode` parameter handling. |

## Reproducing this result

```bash
# Terminal 1
cd examples/hosts/sqlite
npm install
npm start

# Terminal 2 (from repo root)
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3838 OPENWOP_API_KEY=openwop-sqlite-dev-key npx vitest run
```

## Comparison with in-memory host

The in-memory host (`examples/hosts/in-memory/`) and SQLite host run nearly the same code path at the wire level. The differences:

- **SQLite passes `eventOrdering` repeated-poll stability** with stronger evidence — events come from the durable log every read, not from process-local state.
- **SQLite advertises `debugBundle.supported: true`** like the in-memory host; their bundle responses share the same shape contract.
- **SQLite's idempotency cache survives restart**; the in-memory cache doesn't. The `staleClaim` scenario exercises the stop-restart-resume path for claim recovery.

The within-profile gaps are identical because both hosts share the same `seq` field naming choice. Closing them in one host should close them in both.

## Stale-claim recovery (live)

`staleClaim.test.ts` passes against this host. The scenario spawns process A pointing at a temp DB, starts a long-running run, SIGKILLs A, waits for the claim to expire, then spawns process B pointing at the same DB. B's resume-on-startup re-acquires the claim and finishes the run. The event log shows `run.started` (from A) followed by `run.resumed` (from B) followed by the rest of the run's lifecycle.

Run it manually:

```bash
OPENWOP_RUN_STALE_CLAIM=1 \
  OPENWOP_BASE_URL=http://127.0.0.1:9999 OPENWOP_API_KEY=irrelevant \
  npx vitest run src/scenarios/staleClaim.test.ts
```

(The `OPENWOP_BASE_URL` + `OPENWOP_API_KEY` env vars are required by the conformance suite's standard driver but are not used by this scenario — it spawns its own host processes.)

Typical wall-clock: ~5–8 seconds. The dominant cost is the 5-second `core.delay` re-execution on host B; the spec says nothing about Layer-2 idempotency, so the reference example re-runs the delay from scratch. Production hosts with Layer-2 dedup would skip the already-completed sub-steps.

## Known v1.x Expansion Candidates

1. ~~**Resume-on-startup.**~~ ✅ Live as of 2026-05-01.
2. ~~**Heartbeat renewal.**~~ ✅ Live as of 2026-05-01.
3. ~~**Audit-log integrity profile.**~~ ✅ Live as of 2026-05-11. Hash-chained `audit_log` table + Ed25519-signed `audit_checkpoints`; `GET /v1/audit/verify` reports `chainValid` + anomalies. Wiring under `src/audit.ts`.
4. ~~**HITL interrupts + four optional profiles.**~~ ✅ Live as of 2026-05-11 (T1.2 commits A–D). `core.approvalGate` / `core.clarificationGate` / `core.interrupt` / `core.subWorkflow` node types; `POST /v1/runs/{runId}/interrupts/{nodeId}` + `POST /v1/interrupts/{token}` resolve routes; `interrupts` table with hash-chain'd vote ledger; parent/child cascade via `parent_run_id` linkage. Wiring under `src/interrupts.ts`.
5. **Postgres adapter.** Same schema, swap the DB driver, gain horizontal scale-out. Filed as a future row in `INTEROP-MATRIX.md`.
4. **Multi-tenancy.** Add `tenant_id` to every table + composite primary keys. Currently single hardcoded tenant.
5. **Layer-2 idempotency** for non-pure nodes. The reference example only ships pure nodes (`core.noop`, `core.delay`); a fork that adds `core.ai.callPrompt` MUST persist invocation results to dedupe on resume.

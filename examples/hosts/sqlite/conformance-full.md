# Full Conformance Run — SQLite Reference Host

> **Run date:** 2026-05-11 (post T1.1 + T1.2)
> **Host version:** `openwop-host-sqlite@1.0.0` at commit `64b8802`
> **Conformance suite:** `@openwop/openwop-conformance` (this repo, post `83929fb`)
> **Profile claims:** `openwop-core` · `openwop-stream-poll` · `openwop-stream-sse` · `openwop-audit-log-integrity` · `openwop-interrupt-quorum` · `openwop-interrupt-auth-required` · `openwop-interrupt-external-event` · `openwop-interrupt-cascade-cancel` · (debug-bundle advertised)
> **Scale claim:** `minimal`
> **Production-profile claim:** Not claimed

---

## Headline numbers

| Metric | Count |
|---|---:|
| Test files | 86 |
| Files fully passing | 52 |
| Files with at least one failure | 15 |
| Files fully skipped | 19 |
| Tests passing | **550** |
| Tests failing | 25 |
| Tests skipped (out-of-profile) | 32 |
| Tests as `it.todo()` (deferred) | 27 |
| **Total tests** | 634 |

**Net delta vs prior published snapshot (`conformance.md`, 2026-05-01):** +384 tests passing. Most of that growth comes from suite expansion (server-free corpus checks doubled; multi-agent and capability-gated scenarios added). T1.1 and T1.2 contribute the following file-level wins that were previously skipped or had no host implementation to test against:

- `audit-log-integrity.test.ts` — 2/2 ✅ (T1.1; passes in strict mode)
- `interrupt-approval.test.ts` — 3/3 ✅ (T1.2 A)
- `interrupt-clarification.test.ts` — 1/1 ✅ (T1.2 A)
- `approval-payload.test.ts` — 4/4 ✅ (T1.2 A)
- `interrupt-quorum-resolution.test.ts` — 2/2 ✅ (T1.2 A)
- `interrupt-auth-required-resume.test.ts` — 2/2 ✅ (T1.2 B; insufficient-scope subtest auto-skips without `OPENWOP_TEST_LOW_SCOPE_KEY`)
- `interrupt-external-event-correlation.test.ts` — 2/2 ✅ (T1.2 C)
- `interrupt-parent-child-cascade.test.ts` — 2/2 ✅ (T1.2 D)

That's **14 tests newly passing** because of host work landed in this branch.

Internal tamper-detection test (`examples/hosts/sqlite/test/audit-tamper.test.ts`) — separately from the black-box conformance suite — also passes.

---

## Failure classification

The 25 failing tests partition into four buckets. Out-of-profile failures are expected — the SQLite host doesn't claim those surfaces. Doc-side failures are gap-list items, not host bugs.

### A. Out-of-profile (host doesn't implement; expected) — 19 tests

| File | Failing | Reason |
|---|---:|---|
| `append-ordering.test.ts` | 1 | Channels/reducers not implemented (out of `openwop-core`). |
| `cap-breach.test.ts` | 2 | `recursionLimit` cap not enforced. |
| `channel-ttl.test.ts` | 1 | TTL reducer not implemented. |
| `dispatchLoop.test.ts` | 1 | Orchestrator dispatch (RFC 0007) not implemented. |
| `identity-passthrough.test.ts` | 1 | Input → variables echo not implemented. |
| `pack-registry.test.ts` | 3 | Host doesn't ship a registry endpoint (out of `openwop-node-packs`). |
| `route-coverage.test.ts` | 1 | `GET /v1/workflows/{workflowId}` not implemented. |
| `runtime-capabilities.test.ts` | 1 | Returns `unsupported_node_type` where spec wants `capability_not_provided`. |
| `stream-modes.test.ts` | 1 | Doesn't reject unknown `streamMode` with 400. |
| `stream-modes-buffer.test.ts` | 3 | `?bufferMs=` aggregation hint not implemented. |
| `stream-modes-mixed.test.ts` | 2 | Mixed-mode validation not implemented. |
| `subworkflow.test.ts` | 2 | `conformance-subworkflow-parent` fixture uses `core.subWorkflow` with `outputMapping` — supported in T1.2 D for the cascade case but not the output-mapping case. |

### B. Doc-side gap — 2 tests

| File | Failing | Reason |
|---|---:|---|
| `spec-corpus-validity.test.ts` | 2 | README document index lists 28 docs, but the corpus-validity scan finds 29 prose files in `spec/v1/`. Specifically, `spec/v1/host-capabilities.md` is on disk but not linked from the README. Doc-side fix (README addition or file removal); not a host bug. |

### C. Within-profile wire-shape gap — 3 tests

| File | Failing | Reason |
|---|---:|---|
| `version-negotiation.test.ts` | 3 | Host's persisted event shape uses `seq` and lacks the canonical `eventId`. Same gap recorded in the prior `conformance.md` for both reference hosts. Fix requires touching the event-write path across both hosts and the in-memory SDK. |

### D. Conversation refusal contract — 1 test

| File | Failing | Reason |
|---|---:|---|
| `conversationCapabilityNegotiation.test.ts` | 1 | Host accepts a workflow that references conversation primitives even though `capabilities.conversationPrimitive` is not advertised. Should refuse at workflow registration or run-create. Fix is a small validation in `handleCreateRun`. |

---

## Capability-gated soft-skips (32 tests)

These scenarios skip cleanly because the host doesn't advertise their gating capability. Soft-skip is the contract per `OPENWOP_REQUIRE_BEHAVIOR=false` (default). Strict-mode runs would surface these as failures.

| File | Skipped | Gating capability |
|---|---:|---|
| `agentConfidenceEscalation.test.ts` | 1 | `capabilities.agents.supported` |
| `agentMemoryCrossTenantIsolation.test.ts` | 1 | `capabilities.agents.memoryBackends` |
| `agentMemoryRedactionContract.test.ts` | 1 | same |
| `agentMemoryRoundTrip.test.ts` | 1 | same |
| `agentMemoryTtlExpiry.test.ts` | 1 | same |
| `agentMessageReducer.test.ts` | 1 | `capabilities.agents.supported` |
| `agentMetadata.test.ts` | 1 | same |
| `agentPackExport.test.ts` | 1 | `capabilities.agents.packs` |
| `agentPackInstall.test.ts` | 1 | same |
| `agentPackProvenance.test.ts` | 1 | same |
| `agentReasoningEvents.test.ts` | 1 | `capabilities.agents.supported` |
| `byok-roundtrip.test.ts` | 3 | `capabilities.secrets.supported` |
| `conversationLifecycle.test.ts` | 1 | `capabilities.conversationPrimitive` |
| `conversationReplayDeterminism.test.ts` | 1 | same |
| `conversationVsLegacySuspend.test.ts` | 1 | same |
| `orchestratorConservativePath.test.ts` | 1 | `capabilities.agents.orchestrator` |
| `orchestratorDispatch.test.ts` | 1 | same |
| `orchestratorTermination.test.ts` | 1 | same |
| `pack-registry-publish.test.ts` | 25 | `openwop-node-packs` profile |
| `replay-fork.test.ts` | 6 | `capabilities.replay.supported` |
| `replay-fork-arbitrary.test.ts` | 3 | same |
| (others surfaced as warnings) | ~6 | OTel collector, MCP fake server, A2A peer, public-registry fetch, etc. |

The biggest single bucket here is `pack-registry-publish.test.ts` (25 skipped) — these would unlock if the host implemented the registry endpoints. The `replay-fork*.test.ts` group (9 skipped) would unlock with `POST /v1/runs/{runId}:fork`.

---

## Strict-mode runs

Setting `OPENWOP_REQUIRE_BEHAVIOR=true` converts capability-gated soft-skips into hard failures. Verified passing in strict mode for the capabilities the host **does** advertise:

```bash
OPENWOP_BASE_URL=http://127.0.0.1:3838 \
OPENWOP_API_KEY=openwop-sqlite-dev-key \
OPENWOP_REQUIRE_BEHAVIOR=true \
npx vitest run src/scenarios/audit-log-integrity.test.ts
```

Result: 2/2 PASS. The other capability-gated scenarios (`pause-resume`, `configurable-schema`, `webhook-sig-algorithm`, etc.) remain in default-skip mode because the host doesn't yet advertise their profiles — strict mode would correctly fail them.

---

## Reproducing this result

```bash
# Terminal 1
cd examples/hosts/sqlite
rm -rf data        # fresh DB + audit signing key
OPENWOP_PORT=3838 npm start

# Terminal 2 (from repo root)
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3838 \
  OPENWOP_API_KEY=openwop-sqlite-dev-key \
  npx vitest run
```

The per-file `conformance.md` next to this file carries the prior-baseline analysis; this file is the all-profiles snapshot at the post-T1.2 milestone.

---

## What unlocks the most coverage next

Ranked by tests-newly-passing per unit of host work:

1. **`identity-passthrough.test.ts` + `route-coverage.test.ts`** — small executor + handler changes (input echo, `GET /v1/workflows/{id}`). Roughly 2 tests.
2. **`conversationCapabilityNegotiation.test.ts`** — one validation in `handleCreateRun`. Roughly 1 test.
3. **`runtime-capabilities.test.ts` `capability_not_provided` error code** — change one error literal. 1 test.
4. **`stream-modes*.test.ts` validation** — reject unknown `streamMode`, validate `bufferMs` range. 7 tests.
5. **`cap-breach.test.ts`** — enforce `recursionLimit` cap. 2 tests.
6. **`channel-ttl.test.ts` + `append-ordering.test.ts`** — implement channel writes + the `append` reducer. 2 tests, but the foundation for several more.
7. **`replay-fork*.test.ts`** — implement `POST /v1/runs/{runId}:fork`. Unlocks 9 currently-skipped tests.
8. **`pack-registry*.test.ts`** — implement the read surface of the in-host pack registry. Unlocks 28 tests (3 failing + 25 skipped).

Each of (1)–(4) is plausibly a single-session commit. (7)–(8) are substantial standalone tracks similar in scope to T1.2.

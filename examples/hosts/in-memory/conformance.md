# Conformance Result: openwop In-Memory Reference Host

> **Latest measurement:** **2026-06-01 against `@openwop/openwop-conformance@1.18.1` — 2010 passed / 46 failed / 105 skipped / 0 todo of 2161 tests (93.0%)** (the cross-host re-measurement in `INTEROP-MATRIX.md`; the 1.16–1.18.1 additions are capability-gated, so vs the same-day 1.15.0 reading this host gained **+18 passed** with failures/skips unchanged). The current published suite is `1.19.0`; its sole addition (the RFC 0082 §B `agent-channel-dispatch` scenario) is capability-gated on `agents.deployment` and **soft-skips** on this host — applicable pass count unchanged. Failures are honest non-claims for surfaces the minimal host does not behaviorally implement (artifacts, bulk-cancel, BYOK, cap/cost-breach, channel-TTL, interrupts, multi-agent dispatch, et al.); failures fell 48 → 46 even as the suite grew 2074 → 2161, and `it.todo` is 0.
>
> **Prior measurement (superseded 2026-06-01):** **2026-05-30 against `@openwop/openwop-conformance@1.10.0` — 1922 passed / 48 failed / 104 skipped / 0 todo of 2074 tests (92.7%)**. See `docs/CONFORMANCE-RUNS-2026-05-30.md` for the per-failure-topic taxonomy and `INTEROP-MATRIX.md` for the cross-host comparison. Failures concentrate in surfaces the minimal host does not behaviorally implement (interrupts ×11, stream-modes ×6, multi-agent dispatch ×4, bulk-cancel ×4, sub-workflow ×3, pack-registry ×3, BYOK/cost/cap ×6, workspace ×2, + 10 singles); the suite grew 1564 → 2074 since the prior reading and `it.todo` is now 0.
>
> **Prior measurement (superseded 2026-05-30):** **2026-05-22 against `@openwop/openwop-conformance@1.5.0` — 1445 passed / 48 failed / 55 skipped / 16 todo of 1564 tests (92.4%)**. See `docs/CONFORMANCE-RUNS-2026-05.md` for the per-failure-topic taxonomy and `INTEROP-MATRIX.md` for the cross-host comparison. Failures decompose into ~10 real bugs (canonical `RunEventDoc` shape carry-forward on event emission paths; events/poll forward-compat tolerance) and ~38 honest non-claims (scenarios outside the claimed `openwop-core` + `openwop-stream-poll` + `openwop-stream-sse` profile set).
>
> **⚠️ This measurement predates the RFC 0058 / 0059 / 0060 / 0062 / 0063 / 0064 enforcement landings (2026-05-25).** Several listed "real bugs" are now resolved or surfaces added: the **events/poll** path emits the canonical `eventId` / `sequence` / `payload` envelope + run-creation seeds workflow `variables[].defaultValue` (RFC 0058 §"Run execution bounds" below); the host now advertises + enforces **`capabilities.workspace`** (RFC 0059 §"Agent workspace"), **`capabilities.heartbeat`** (RFC 0060 §"Host heartbeat"), **`capabilities.memory.distillation`** (RFC 0062 §"Scheduled memory distillation"), **`capabilities.agents.subRunAttestation`** (RFC 0063 §"Sub-run output attestation"), and **`capabilities.toolHooks`** (RFC 0064 §"Tool-invocation hooks"), lighting up the previously-soft-skipped workspace + heartbeat + distillation + subrun + tool-hooks behavior scenarios. The pass/fail counts above have **not** been re-measured against the current host — they are conservative (expect the new enforcement to lift `run-execution-bounds-shape`, the `workspace-*`, the `heartbeat-*`, the `distillation-*`, the `subrun-*`, the `tool-hooks-*`, and several event-reading scenarios). The SSE + debug-bundle paths remain on the legacy `seq` / `data` shape (candidate #1).
>
> **Prior measurements:** 2026-05-22 against suite v1.4.0 — 1439/1558 (92.4%); 2026-05-18 against suite v1.1.1 — 135/193 (retained below for historical context; suite scenario count grew from 193 → 1558 → 1564).
>
> **Host version:** `openwop-host-in-memory@1.1.1`
> **Conformance suite:** `@openwop/openwop-conformance@1.5.0` (last full re-measurement; the current suite is `@openwop/openwop-conformance@1.6.1` — the additive RFC 0058/0059/0060/0062/0063/0064 wire + behavior scenarios in 1.6.x are exercised by the RFC-specific evidence sections below rather than re-summarized in this banner)
> **Profile claim:** `openwop-core` + `openwop-stream-poll` + `openwop-stream-sse`
> **Capability claim (RFC 0013):** `workflowChainPacks.supported: true` — host advertises the chain-expansion capability under `/.well-known/openwop` and serves the vendor-prefixed expansion endpoint `POST /v1/host/sample/workflow-chain:expand`. Mounted on top of `OPENWOP_PACK_REGISTRY_DIR` (defaults to the in-tree `examples/packs/`).
> **Capability claim (RFC 0056):** `feedback.{supported: true, targets: ["run"], signals: ["rating", "correction", "label", "flag"]}` — host serves `POST/GET /v1/runs/{runId}/annotations` backed by a per-run annotation side-store (not a RunEvent). See the RFC 0056 evidence section below.
> **Scale profile claim:** `minimal`

## Summary

Against the live in-memory host (single Node process, `npm start`):

- **Test files:** 30 total — 16 fully passing, 14 with at least one failure.
- **Tests:** 193 total — 135 passing, 28 failing, 30 todo (intentionally skipped scenarios).
- **Profile-targeted result:** every scenario the host's claimed profile gates on passes. Failures are all in scenarios that exercise capabilities outside the claimed profile set.

## RFC 0056 — run feedback & annotations (2026-05-25)

Run against the live host (`npm start`, default `http://127.0.0.1:3737`):

```bash
OPENWOP_BASE_URL=http://127.0.0.1:3737 OPENWOP_API_KEY=openwop-inmem-dev-key \
  npx vitest run src/scenarios/feedback-*.test.ts
# → Test Files  7 passed (7) · Tests  7 passed (7)
```

| Scenario file | Result | Notes |
|---|---|---|
| `feedback-capability-shape.test.ts` | ✅ PASS | `capabilities.feedback` well-formed (boolean `supported`; `targets`/`signals` from the closed vocabularies) |
| `feedback-record-and-list.test.ts` | ✅ PASS | `POST` → 201 with `annotationId`; `GET` lists it back |
| `feedback-on-terminal-run.test.ts` | ✅ PASS | annotation on a `completed` run accepted (non-blocking, post-hoc) |
| `feedback-cross-tenant-isolation.test.ts` | ✅ PASS | run-scoped side-store → list carries only this run's `target.runId` (CTI-1) |
| `feedback-correction-redaction.test.ts` | ✅ PASS | `sk-…` canary in `signal.correction` + `note` scrubbed to `[redacted]` before persistence/listing (SR-1) |
| `feedback-unsupported-501.test.ts` | ⏭️ soft-skip | N/A — this host advertises `feedback.supported: true`, so the unadvertised-501 path doesn't apply |
| `feedback-fork-not-copied.test.ts` | ⏭️ soft-skip | this host doesn't expose `POST /v1/runs/{runId}:fork`; the side-store design means a fork would inherently start with zero annotations |

Implementation: `examples/hosts/in-memory/src/server.ts` — `annotations: Map<runId, StoredAnnotation[]>` side-store, `handleCreateAnnotation` / `handleListAnnotations`, `scrubSecretShaped()` for SR-1. This is the first reference-host implementation backing RFC 0056 (`Active`).

## Per-file result

| Scenario file | Status | Tests | Notes |
|---|---|---|---|
| `discovery.test.ts` | ✅ PASS | 4/4 | `/.well-known/openwop` + `/v1/openapi.json` |
| `runs-lifecycle.test.ts` | ✅ PASS | 3/3 | `POST /v1/runs` + snapshot + 404 |
| `idempotency.test.ts` | ✅ PASS | 2/2 | Layer 1 cache + 409-on-body-conflict |
| `cancellation.test.ts` | ✅ PASS | 2/2 | Mid-flight cancel of `core.delay` |
| `auth.test.ts` | ✅ PASS | 2/2 | Bearer required + invalid → 401 |
| `errors.test.ts` | ✅ PASS | 2/2 | Canonical error envelope |
| `failure-path.test.ts` | ✅ PASS | 1/1 | Workflow failure terminal state |
| `multi-node-ordering.test.ts` | ✅ PASS | 1/1 | Single fixture has linear DAG |
| `policies.test.ts` | ✅ PASS | 5/5 | Discovery-shape only — host doesn't advertise `aiProviders.policies`, scenarios skip-equivalent |
| `redaction.test.ts` | ✅ PASS | 6/6 | Discovery shape + canary surfaces; host has no secrets path so canaries can't enter |
| `cost-attribution.test.ts` | ✅ PASS | 1/1 + 5 todo | Host doesn't emit cost attribution; suite tolerates absence |
| `fixtures-valid.test.ts` | ✅ PASS | 22/22 | Server-free schema validation |
| `spec-corpus-validity.test.ts` | ✅ PASS | 37/37 | Server-free spec validation |
| `profileDerivation.test.ts` | ✅ PASS | 25/25 | Server-free derivation lib |
| `highConcurrency.test.ts` | ✅ PASS | 4/4 | 10 parallel + 5 sequential retries; tagged `@scale-profile-production` but passes against `minimal` host since the floors are minimums |
| `runtime-capabilities.test.ts` | ❌ 1/2 | | Host advertises empty `runtimeCapabilities`; scenario expects at least one. Out-of-profile. |
| `version-negotiation.test.ts` | ❌ 1/4 | | Persisted-event shape gap — host emits events with `seq` field; spec expects `eventId` + `sequence`. **Real protocol gap.** |
| `cap-breach.test.ts` | ❌ 0/2 | | Host doesn't enforce `recursionLimit`. Out-of-profile. |
| `channel-ttl.test.ts` | ❌ 0/1 | | Channels not implemented. Out-of-profile. |
| `subworkflow.test.ts` | ❌ 0/2 | | Sub-workflows not implemented. Out-of-profile. |
| `replay-fork.test.ts` | ❌ 1/6 | | `POST /v1/runs:fork` not implemented. Out-of-profile. |
| `interrupt-approval.test.ts` | ❌ 0/3 | | Interrupts not implemented (host doesn't claim `openwop-interrupts`). |
| `interrupt-clarification.test.ts` | ❌ 0/1 | | Same. |
| `approval-payload.test.ts` | ✅ PASS | 4/4 | Discovery-shape + suspend-schema-shape only; host serves no approvals so the runtime path is skip-equivalent |
| `pack-registry.test.ts` | ❌ 5/8 | | Host doesn't claim `openwop-node-packs`; some shape contracts pass against the absence-fallback path |
| `pack-registry-publish.test.ts` | ✅ PASS | with skips | Host returns 404 on every publish path; suite treats as absent-registry pass |
| `stream-modes.test.ts` | ❌ 3/4 | | Basic SSE + polling work; mixed-mode SSE buffering scenario fails (advanced behavior) |
| `stream-modes-buffer.test.ts` | ❌ 1/4 | | `bufferMs` query forwarding not implemented |
| `stream-modes-mixed.test.ts` | ❌ 2/4 | | Array-form `streamMode` parameter handling partial |
| `identity-passthrough.test.ts` | ❌ 0/1 | | Host doesn't echo deeply-nested input objects through to `variables` (the scenario asserts pass-through) |

## Failure classification

| Category | Files | Reason |
|---|---|---|
| **Out-of-profile (expected)** | `cap-breach`, `channel-ttl`, `subworkflow`, `replay-fork`, `interrupt-*`, `pack-registry`, `runtime-capabilities`, `identity-passthrough` | Host doesn't claim the profile that gates these scenarios. Adding the corresponding feature would lift the host's profile claim. |
| **Real protocol gap** | `version-negotiation.test.ts` (event shape), `stream-modes-buffer.test.ts`, `stream-modes-mixed.test.ts` | Host's event-shape uses `seq` while spec expects `eventId` + `sequence`; SSE `bufferMs`/`streamMode` parameter handling is rudimentary. These are within-profile gaps that would close on a refactor. |

## Reproducing this result

```bash
# Terminal 1
cd examples/hosts/in-memory
npm install
npm start

# Terminal 2 (from repo root)
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3737 OPENWOP_API_KEY=openwop-inmem-dev-key npx vitest run
```

The result above is captured against the OpenWOP v1.0 conformance baseline. Future suite minors may introduce new scenarios; this host's pass record is pinned to the suite version it was tested against.

## What this proves

This host establishes **independent implementation** of the OpenWOP v1 wire contract:

- **Independent codebase.** Single 600-LOC TypeScript file using only the Node stdlib.
- **Profile-truthful.** The host's discovery payload satisfies exactly the predicates for the profiles it claims; the conformance suite verifies it via `lib/profiles.ts`.

The interop matrix in `INTEROP-MATRIX.md` cross-tabulates this host with other published conformance evidence.

## Workflow-chain pack expansion (RFC 0013 Phase 3 — 2026-05-18)

- **`workflow-chain-host-expansion.test.ts`** — 6/6 passing under `OPENWOP_REQUIRE_BEHAVIOR=true` with `OPENWOP_BASE_URL=http://127.0.0.1:3737`. Cases: discovery advertises the capability; 1-node chain expansion with substituted config + rewritten id + capability propagation; 2-node chain with edge rewriting; 404 `pack_not_found`; 404 `chain_not_found`; 422 `invalid_request` on malformed body.
- **Implementation surface:** `examples/hosts/in-memory/src/workflow-chain-expansion.ts` — pure-function expansion wrapper composing the spec-authoritative `expandChain()` algorithm with the host-specific I/O (registry filesystem mirror lookup + optional Ed25519 signature verification). HTTP handler in `server.ts` (`handleExpandWorkflowChain`).
- **Host-side test:** `examples/hosts/in-memory/test/workflow-chain-expansion.test.ts` — 5/5 passing under `npx tsx`. Covers the same paths as a pure-function exercise (no HTTP boot).
- **Sample pack:** `examples/packs/workflow-chain-sample/pack.json` (in-tree, unsigned — sample-host concession; production deployers MUST require signatures per `node-packs.md §"Verification flow"`).

## Run execution bounds (RFC 0058 — 2026-05-25)

- **`run-execution-bounds-shape.test.ts`** — 3/3 passing with `OPENWOP_BASE_URL=http://127.0.0.1:3737`. The host advertises `capabilities.limits.maxRunDurationMs` (`600000`) and **enforces the wall-clock `runTimeoutMs` bound**: `handleCreateRun` resolves + clamps `configurable.runTimeoutMs` to that ceiling (rejecting out-of-range with `400 validation_error`); `runWorkflow` arms a per-run deadline timer that emits `cap.breached { kind: 'run-duration', limit, observed }` and transitions the run to `failed` with `error.code = 'run_timeout'`. The `run-duration` behavior block is **live + green** against this host.
- **`maxLoopIterations` (loop-iterations) is not enforced here** — this host is a linear node walk with no RFC 0037 orchestrator loop, so it doesn't advertise `multiAgent.executionModel.supported` and has no per-turn iterations to count. That bound's enforcement rides RFC 0061 (the execution-loop host). The shape scenario's `loop-iterations` behavior block soft-skips accordingly.
- **Implementation surface:** `examples/hosts/in-memory/src/server.ts` (`MAX_RUN_DURATION_MS`, `failRunDuration()`, the deadline timer in `runWorkflow`, `runTimeoutMs` resolution in `handleCreateRun`). Making the breach observable to the black-box suite also moved the poll path's event serialization to the canonical `run-event.schema.json` envelope (see candidate #1 below).

## Agent workspace (RFC 0059 — 2026-05-25, `Accepted`)

- **`workspace-capability-shape.test.ts`** (2/2) + **`workspace-behavior.test.ts`** (4/4) + **`workspace-cross-tenant-isolation.test.ts`** (1/1) — all passing with `OPENWOP_BASE_URL=http://127.0.0.1:3737`. The host advertises `capabilities.workspace { supported: true, versioned: true, maxFileBytes: 1048576, maxFiles: 256, maxVersions: 20 }` and implements §C/§D/§E end-to-end.
- **§C** — `GET|PUT|DELETE /v1/host/workspace/files[/{path}]`: versioned store, monotonic `version`, recomputed `etag`, `If-Match` → `409 workspace_conflict` (`details.currentVersion`), `content` > `maxFileBytes` → `413 workspace_too_large`, `list` returns metadata only.
- **§D** — an immutable workspace read snapshot is captured at run creation and exposed on `GET /v1/runs/{runId}` as `workspace: [{ path, version }]`.
- **§E WCT-1** — every file is owner-scoped to its `{tenant, workspace}`; a cross-owner `get`/`list` fails closed (404). Backs the `workspace-cross-tenant-isolation` SECURITY invariant; exercised via the `POST /v1/host/sample/workspace/op` seam (`host-sample-test-seams.md` §9). **§E WSR-1** — writes pass through `scrubSecretShaped()` (SR-1); this host resolves no BYOK plaintext, so redaction is structural.
- **Implementation surface:** `examples/hosts/in-memory/src/server.ts` — `workspaceStore`, the `workspace*Op` core functions, the four `handleWorkspace*` §C handlers, the `handleWorkspaceSeam` cross-owner test seam, and `workspaceSnapshotFor()` wired into the run snapshot.

## Host heartbeat (RFC 0060 — 2026-05-25, `Accepted`)

- **`heartbeat-capability-shape.test.ts`** (1/1) + **`heartbeat-fires-once-per-tick.test.ts`** (1/1) + **`heartbeat-idempotent-no-spam.test.ts`** (1/1, the keystone) + **`heartbeat-runtime-bound.test.ts`** (1/1) — all passing with `OPENWOP_BASE_URL=http://127.0.0.1:3737`. The host advertises `capabilities.heartbeat { supported: true, minIntervalSec: 1, maxRuntimeMs: 5000 }`.
- **Tick seam** `POST /v1/host/sample/heartbeat/tick` (`host-sample-test-seams.md`): one `heartbeat.evaluated { heartbeatId, status, changed }` per tick (§B.1); `heartbeat.stateChanged { heartbeatId, from, to }` + `enqueuedRuns: 1` **only** when `observedState` differs from the persisted prior tick (§B.5 anti-spam) — an unchanged tick emits neither; `status: 'timeout'` when `simulateSlowMs` exceeds `maxRuntimeMs` (§B.2, a terminated evaluation does not transition or enqueue).
- **Implementation surface:** `examples/hosts/in-memory/src/server.ts` — `heartbeatState` (per-`heartbeatId` prior-state map), `stableStringify()` (value-based transition detection), `handleHeartbeatTick()`.

## Sub-run output attestation + merge gating (RFC 0063 — 2026-05-25, `Accepted`)

- **`subrun-attestation-shape.test.ts`** (1/1) + **`subrun-checksum-stable.test.ts`** (1/1) + **`subrun-approval-gate.test.ts`** (1/1) + **`subrun-approval-fail-closed.test.ts`** (1/1) — all passing with `OPENWOP_BASE_URL=http://127.0.0.1:3737`. The host advertises `capabilities.agents.subRunAttestation: true`.
- **Attest seam** `POST /v1/host/sample/subrun/attest` (`host-sample-test-seams.md`): §B surfaces `attestation { checksum, algorithm: 'sha256' }` where `checksum` is the byte-stable JCS+SHA-256 digest of `childOutputs` (key-order-invariant via `stableStringify` → `createHash('sha256')`); §C merges (`merged: true` + `mergedValues`) only on `approvalAction` `accept`/`edit-accept` and **fails closed** (`merged: false`, no `mergedValues`) on `reject`/absent when `requireApproval: true`. Backs the `subrun-merge-approval-fail-closed` SECURITY invariant.
- **Checksum canonicalization:** `stableStringify` is recursive sorted-key JSON with `JSON.stringify` per leaf — effectively RFC-8785-conformant for JSON-representable values (RFC 8785's number/string rules are defined in ECMAScript terms). Cross-host byte-identical verification holds as long as the peer host canonicalizes via the same ECMAScript number rules; a production cross-host deployment with exotic numeric forms SHOULD pin a vetted RFC 8785 library.
- **§D `principalScope` is out of scope on this host.** RFC 0063 §D narrows the approval to RFC 0049 scopes; this host does not wire RFC 0049 authorization, so the seam accepts `principalScope` but does not enforce it, and no scenario exercises §D. The `Accepted` claim covers §B (checksum) + §C (merge gate, the `subrun-merge-approval-fail-closed` invariant); §D principal-scoping is exercised on an RBAC-capable host.
- **Implementation surface:** `examples/hosts/in-memory/src/server.ts` — `subRunChecksum()` (JCS+SHA-256), `handleSubRunAttest()`. No new event type: the attestation rides the existing RFC 0037 `core.workflowChain.event { phase: 'output.harvested' }` shape.

## Tool-invocation hooks + per-tool authorization (RFC 0064 — 2026-05-25, `Accepted`)

- **`tool-hooks-shape.test.ts`** (1/1) + **`tool-hooks-content-free.test.ts`** (1/1) + **`tool-hooks-authorization-fail-closed.test.ts`** (1/1) + **`tool-hooks-rate-limit.test.ts`** (1/1) + **`tool-hooks-secret-redaction.test.ts`** (1/1) — all passing with `OPENWOP_BASE_URL=http://127.0.0.1:3737`. The host advertises `capabilities.toolHooks { supported: true, prePostEvents: true, perToolAuthorization: true, perToolRateLimit: true }`.
- **Invoke seam** `POST /v1/host/sample/toolhooks/invoke` (`host-sample-test-seams.md`): §B `agent.toolCalled` carries `argsHash` (= SHA-256 of the **SR-1-redacted** JCS serialization of the args — a resolved secret is scrubbed before hashing, so the canary never enters the hash input or any emitted field) + `principal` + `transport`; `agent.toolReturned` carries `status` + (on `ok`) a non-negative `durationMs`. §C per-tool authorization is **fail-closed** — a non-empty `requiredScopes` is unevaluable on this non-RBAC host, so `status: 'forbidden'` and the tool never runs (no `durationMs`); this is the per-tool application of RFC 0049's `authorization-fail-closed` invariant (`tool-hooks-authorization-fail-closed.test.ts` is added to that invariant's test set). §D `simulateRateLimitExhausted` yields `status: 'rate_limited'`.
- **Implementation surface:** `examples/hosts/in-memory/src/server.ts` — `handleToolHooksInvoke()` (reuses `scrubSecretShaped` + `stableStringify` + `createHash('sha256')`). No new event type or error code: reuses RFC 0002 `agent.toolCalled`/`agent.toolReturned` + RFC 0049 `forbidden` + existing `rate_limited`.
- **Seam-demonstrated; this host has no production agent-tool-calling runtime.** There are no real `agent.toolCalled` events on this host, so the toolHooks contract is exercised entirely through the seam. The **fail-closed authorization** (unevaluable scope → `forbidden`; no scope resolver, so a scoped tool is never granted — the deny side of RFC 0049's `authorization-fail-closed` is real) and the **SR-1-redacted `argsHash`** are real, reusable logic. **`perToolRateLimit` is a simulation hint, not a real token bucket** — the host maintains no per-`(principal, tool)` bucket state and returns `rate_limited` only when the seam passes `simulateRateLimitExhausted`. A production host with an actual tool-invocation path keys a real bucket on `(principal, toolName)` and grants scoped tools through a real RFC 0049 resolver.

## Scheduled memory distillation — "dreams" (RFC 0062 — 2026-05-25, `Accepted`)

- **`distillation-shape.test.ts`** (1/1) + **`distillation-token-budget.test.ts`** (1/1) + **`distillation-stable-archive.test.ts`** (1/1) + **`distillation-index-roundtrip.test.ts`** (1/1) + **`distillation-secret-carryforward.test.ts`** (1/1) — all passing with `OPENWOP_BASE_URL=http://127.0.0.1:3737`. The host advertises `capabilities.memory.distillation { supported: true, maxTokenBudget: 100000, scheduled: false, indexEmitted: true, tokenizerName: 'claude', archiveRetention: 'P30D' }`.
- **Distill seam** `POST /v1/host/sample/memory/distill` (`host-sample-test-seams.md`): §B runs a budgeted distillation — `tokensUsed` (≈ scrubbed-corpus length / 4, floored) MUST be `≤ tokenBudget`; a budget below the corpus minimum returns `422 token_budget_exceeded` with **no `archiveChecksum`** (atomic, no partial archive). `archiveChecksum` is the byte-stable JCS+SHA-256 of the SR-1-scrubbed sources (same sources ⇒ same digest). On `indexEmitted`, a content-free `MEMORY-INDEX.json` manifest (`{ version, archiveChecksum, entryCount, updatedAt }` — no raw source content) is written to the run-owner's workspace via the RFC 0059 store and returned as `indexFile`. The `memory.compacted` event carries the additive `distillation { tokenBudget, tokensUsed, indexUpdated }` sub-object — no new event type.
- **SR-1 carry-forward:** the corpus is `scrubSecretShaped`-scrubbed **before** archiving/hashing, so a redacted secret never enters the archive, its checksum, the index, or the event (no new invariant — SR-1 holds at the RFC 0012 layer).
- **Seam-demonstrated; on-demand only.** This host has no production `MemoryAdapter`, so distillation is exercised via the seam; `scheduled: false` (no `capabilities.scheduling` here — a scheduled trigger composes RFC 0052 on a scheduling host). The `archiveChecksum`, budget gate, SR-1 scrub, and the real `MEMORY-INDEX.json` workspace write (RFC 0059) are real logic.
- **`tokenizerName: 'claude'` is a nominal advertisement; the budget is a tokenizer-agnostic `ceil(len/4)` estimate.** The reference host does not run a real claude tokenizer — `chars/4` is a best-effort English approximation that sits within the capability's stated "±10% conformance tolerance" for common prose, but a production host MUST count against the named tokenizer (and would diverge from `chars/4` on code / non-English / special tokens). `memory.distillation` consumers reading `tokenizerName` get an honest *name* but should treat this host's budget accounting as an estimate.
- **Implementation surface:** `examples/hosts/in-memory/src/server.ts` — `handleMemoryDistill()` (reuses `scrubSecretShaped` + `stableStringify` + `createHash('sha256')` + `workspacePutOp`).

## Artifact-type packs — store-only host (RFC 0071 + RFC 0075 P2-1 — 2026-05-27)

- **Capability claim:** `host.artifactTypes: { supported: true, store: true, render: false }` — a deliberately **store-only** posture. The reference host persists artifacts of registered types but renders nothing.
- **`artifact-type-store-without-render.test.ts` (1/1)** + **`artifact-type-pack-install.test.ts` (2/2)** PASS against the running host (steward-verified locally, 2026-05-27) — plus the always-on server-free `artifact-type-pack-manifest-validation` + `artifact-schema-compile-bounded`.
- **Why this host matters:** it's the one that exercises the **store-without-render negotiation guarantee** end-to-end (`artifact-type-packs.md` §host.artifactTypes) — a registered, schema-valid artifact is stored and the run completes with `rendered:false`, never failing for lack of a renderer. A render-everything host (MyndHyve, `render:true`) can only honestly soft-skip this path, so the store-only reference host is what actually verifies it.
- **Implementation surface:** `examples/hosts/in-memory/src/server.ts` — `host.artifactTypes` advertisement + `handleArtifactTypeInstall()` / `handleArtifactTypeProduce()` over the `POST /v1/host/sample/artifacttypes/{install,produce}` seam (`artifactTypeRegistry` map + `validateArtifactPayload()` subset validator + a size bound per RFC 0075 R1). Zero-dep — the schema-subset validator is hand-rolled (a production engine compiles with Ajv).

## Host outbound-HTTP + safe-fetch (RFC 0076 §B — 2026-05-29)

- **`safefetch-behavior.test.ts` (5/5)** + **`http-client-ssrf.test.ts` (1/1)** PASS under `OPENWOP_REQUIRE_BEHAVIOR=true` against `OPENWOP_BASE_URL=http://127.0.0.1:3737` (steward-verified locally, 2026-05-29). The host advertises `capabilities.httpClient { supported: true, ssrfGuard: true, maxResponseBodyBytes: 10485760, requestTimeoutMs: 30000, methods: [...], safeFetch: { supported: true } }`.
- **Safe-fetch seam** `POST /v1/host/sample/http/safe-fetch` (`host-sample-test-seams.md`): the SSRF guard (resolve→pin→connect) blocks loopback / RFC 1918 / link-local / cloud-metadata targets (`{outcome:"blocked", blocked:"ssrf"}`); a `simulateRebindTo` that re-resolves a public name to a blocked address is also blocked (DNS-rebinding defeat via the pinned-IP model); a `Connection: upgrade` header is refused (`blocked:"upgrade"`, no 101 socket-hijack escape). A public target with no upgrade returns `{outcome:"fetched", status:200}` and — since this host also advertises `toolHooks.prePostEvents` — the `agent.toolCalled`/`agent.toolReturned` audit pair (`transport:"http"`, RFC 0064). Reuses the `http-client-ssrf-guard` invariant + the `maxResponseBodyBytes` cap — no new invariant.
- **Seam-demonstrated; this host runs no pack runtime.** The blocking decisions (SSRF blocklist, rebinding, upgrade-refusal) are real, reusable logic; the *successful fetch* is simulated (no real egress in the conformance env). A production host's `ctx.http.safeFetch` performs the real resolve→pin→connect fetch with the body/timeout caps. §B → `Accepted` additionally awaits `core.openwop.http@2.0.0` consuming `ctx.http?.safeFetch` + a non-steward host adopting it (MyndHyve committed).
- **Implementation surface:** `examples/hosts/in-memory/src/server.ts` — the `httpClient.safeFetch` advertisement + `safeFetchBlockReason()` (IP-literal blocklist, mirrors the Postgres `checkHttpDestination`) + `handleSafeFetch()` over the seam (reuses `scrubSecretShaped` + `stableStringify` + `createHash('sha256')` for the audit `argsHash`).

## Conformance certification bundle (RFC 0089 — 2026-06-02, `Accepted`)

- **Committed machine-readable bundle:** [`certification-bundle.json`](./certification-bundle.json), generated by `openwop-conformance --base-url http://127.0.0.1:3737 --api-key <key> --certify certification-bundle.json` against the live in-memory host. It binds this host's claimed profiles to the reproducible run: suite version (`@openwop/openwop-conformance@1.18.1`), per-scenario pass/fail/skip lists, host identity, and the verbatim `/.well-known/openwop` document plus its canonical-JSON SHA-256.
- **Profiles claimed (exactly the set the discovery document derives, RFC 0089 §B(1)):** `openwop-core` + `openwop-stream-sse` + `openwop-stream-poll` + `openwop-node-packs` + `openwop-fixtures`. The host **honestly does NOT claim** `openwop-core-standard` because its discovery document omits `clarification.request` from `supportedEnvelopes` (it implements no interrupt path), so `isCoreStandard` is false and the profile is not derivable — exactly the spec's "claim ≠ evidence" point made mechanical.
- **`verifyBundle()` ACCEPTS the bundle (§B):** every claimed profile re-derives from the captured `discovery.document` AND is floor-proven (none of the claimed profiles defines floor scenarios in `PROFILE_FLOOR_SCENARIOS`, so the floor condition holds vacuously and honestly). The bundle's `results.failed` records the host's honest non-claims (interrupts, dispatch, sub-workflows, BYOK, stream-mode buffering, et al.) — none of which touch a *claimed* profile's floor.
- **Server-free round-trip:** the RFC 0089 block of `conformance/src/scenarios/spec-corpus-validity.test.ts` validates the committed bundle against `conformance-certification-bundle.schema.json`, asserts `verifyBundle().valid`, and recomputes `discovery.sha256` from the captured document.

## Known v1.x Expansion Candidates

1. **Event-shape gap (`seq` → `eventId` + `sequence`).** The **`/v1/runs/{runId}/events/poll`** path now emits the spec-canonical envelope (`eventId` / `sequence` / `payload`) **exactly** — no legacy `seq` / `data` aliases, so the response satisfies `run-event.schema.json` (`additionalProperties: false`). Landed alongside RFC 0058 enforcement so `cap.breached` payloads are readable by black-box scenarios; conformance readers tolerate both shapes via `sequence ?? seq` / `payload ?? data`. The **SSE path + the debug-bundle path still use the legacy `seq` / `data` shape**; moving them to canonical names will lift `version-negotiation.test.ts` 1/4 → 4/4.
2. **SSE buffering (`bufferMs`).** Implement query-param-driven backlog buffering before terminal close. Lifts `stream-modes-buffer.test.ts` 1/4 → 4/4.
3. **Array `streamMode` parameter.** Accept `?streamMode=poll,sse` and dispatch deterministically. Lifts `stream-modes-mixed.test.ts` 2/4 → 4/4.
4. **Identity passthrough.** Mount `inputs.*` into `variables.*` in the snapshot.
5. **(Profile-expanding)** Optional: implement interrupts, then claim `openwop-interrupts`; this lifts the interrupt scenarios.

The first four are within-profile cleanups for a future reference-host maintenance release. The fifth is a deliberate scope expansion — file an RFC or wait for a third party to fork the host with that need.

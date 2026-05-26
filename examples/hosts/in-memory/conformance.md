# Conformance Result: openwop In-Memory Reference Host

> **Latest measurement:** **2026-05-22 against `@openwop/openwop-conformance@1.5.0` — 1445 passed / 48 failed / 55 skipped / 16 todo of 1564 tests (92.4%)**. See `docs/CONFORMANCE-RUNS-2026-05.md` for the per-failure-topic taxonomy and `INTEROP-MATRIX.md` for the cross-host comparison. Failures decompose into ~10 real bugs (canonical `RunEventDoc` shape carry-forward on event emission paths; events/poll forward-compat tolerance) and ~38 honest non-claims (scenarios outside the claimed `openwop-core` + `openwop-stream-poll` + `openwop-stream-sse` profile set).
>
> **⚠️ This measurement predates the RFC 0058 / 0059 / 0060 enforcement landings (2026-05-25).** Several listed "real bugs" are now resolved or surfaces added: the **events/poll** path emits the canonical `eventId` / `sequence` / `payload` envelope + run-creation seeds workflow `variables[].defaultValue` (RFC 0058 §"Run execution bounds" below); the host now advertises + enforces **`capabilities.workspace`** (RFC 0059 §"Agent workspace") and **`capabilities.heartbeat`** (RFC 0060 §"Host heartbeat"), lighting up the previously-soft-skipped workspace + heartbeat behavior scenarios. The pass/fail counts above have **not** been re-measured against the current host — they are conservative (expect the new enforcement to lift `run-execution-bounds-shape`, the `workspace-*`, the `heartbeat-*`, and several event-reading scenarios). The SSE + debug-bundle paths remain on the legacy `seq` / `data` shape (candidate #1).
>
> **Prior measurements:** 2026-05-22 against suite v1.4.0 — 1439/1558 (92.4%); 2026-05-18 against suite v1.1.1 — 135/193 (retained below for historical context; suite scenario count grew from 193 → 1558 → 1564).
>
> **Host version:** `openwop-host-in-memory@1.1.1`
> **Conformance suite:** `@openwop/openwop-conformance@1.5.0` (latest run)
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

## Known v1.x Expansion Candidates

1. **Event-shape gap (`seq` → `eventId` + `sequence`).** The **`/v1/runs/{runId}/events/poll`** path now emits the spec-canonical envelope (`eventId` / `sequence` / `payload`) **exactly** — no legacy `seq` / `data` aliases, so the response satisfies `run-event.schema.json` (`additionalProperties: false`). Landed alongside RFC 0058 enforcement so `cap.breached` payloads are readable by black-box scenarios; conformance readers tolerate both shapes via `sequence ?? seq` / `payload ?? data`. The **SSE path + the debug-bundle path still use the legacy `seq` / `data` shape**; moving them to canonical names will lift `version-negotiation.test.ts` 1/4 → 4/4.
2. **SSE buffering (`bufferMs`).** Implement query-param-driven backlog buffering before terminal close. Lifts `stream-modes-buffer.test.ts` 1/4 → 4/4.
3. **Array `streamMode` parameter.** Accept `?streamMode=poll,sse` and dispatch deterministically. Lifts `stream-modes-mixed.test.ts` 2/4 → 4/4.
4. **Identity passthrough.** Mount `inputs.*` into `variables.*` in the snapshot.
5. **(Profile-expanding)** Optional: implement interrupts, then claim `openwop-interrupts`; this lifts the interrupt scenarios.

The first four are within-profile cleanups for a future reference-host maintenance release. The fifth is a deliberate scope expansion — file an RFC or wait for a third party to fork the host with that need.

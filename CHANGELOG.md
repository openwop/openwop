# openwop Spec v1 — Changelog

All notable changes to the openwop v1 spec, schemas, OpenAPI/AsyncAPI, conformance suite, and reference SDKs.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1/) loosely. Versions are spec-corpus-wide (one date, multiple artifact updates per row); per-artifact versions live in their respective `package.json` / schema `$id` fields.

> **Status legend** (per [`/governance/spec-status/`](https://openwop.dev/governance/spec-status/)):
> Stable · Stabilizing · Draft · Experimental — see individual doc headers for current state. The legacy `STUB / DRAFT / OUTLINE / FINAL` vocabulary still appears in older releases below; both are valid in the corpus.

---

## [1.1.4 — unreleased] — docs-sync drift cleanup

### fix(conformance): RFC 0061 — lift the executionModel version guard to [1, 5] + document the M2-host requirement (2026-05-26)

RFC 0061 M1 bumped `capabilities.schema.json §multiAgent.executionModel.version` to `maximum: 5` and added `agent-loop-version5-shape.test.ts` (which asserts `version ∈ [1, 5]`), but left `multi-agent-handoff-state-machine.test.ts` asserting `version ∈ [1, 4]` — so a host legitimately advertising `version: 5` (the very thing RFC 0061 enables) would **fail** that scenario. Corrects the handoff scenario's range guard + docstring to `[1, 5]`, matching the schema and the version-5 shape scenario.

Also adds an implementation note to RFC 0061 recording that its **reference-host enforcement (`Active → Accepted`) requires an execution-model host, not the in-memory reference host**: `version: 5` is the top of the RFC 0037→0041 ladder (a host advertising it MUST implement phases 1..5 additively), so advertising `executionModel.supported` activates the ~15 ladder scenarios the linear-walk in-memory host doesn't implement — unlike the standalone RFC 0058/0059/0060/0063/0064 capabilities. The v5 loop + the `POST /v1/host/sample/agentloop/run` seam belong on `apps/workflow-engine` or a non-steward host already on the ladder. RFC 0061 stays `Active`. Conformance/docs only; no schema or wire-shape change.

### feat(host-postgres)+feat(host-sqlite): implement RFC 0056 run feedback/annotations (2026-05-26)

Ports the RFC 0056 run feedback/annotation surface from the in-memory reference to the Postgres + SQLite hosts (previously only in-memory implemented it, so the seven `feedback-*` conformance scenarios soft-skipped on PG/SQLite). Each host now advertises `capabilities.feedback { supported: true, targets: ['run'], signals: ['rating','correction','label','flag'] }` and serves `POST /v1/runs/{runId}/annotations` (record → 201 with the persisted annotation) + `GET /v1/runs/{runId}/annotations` (list). Annotations are a per-run side-store (a new `annotations` table, not the replayable event log), so a fork starts with zero annotations (§D) and a list is inherently run-scoped (§E / CTI-1). Untrusted free-text (`signal.correction`, `note`, and every string-valued signal field) is secret-shape-scrubbed before persistence per the `annotation-content-redaction` SECURITY invariant (§E / SR-1); unknown `signal` keys are rejected (`additionalProperties:false`). All 7 `feedback-*` scenarios now pass on both hosts; full suites green (Postgres 1700/0/118, SQLite 1714/0/104). Host-only; no protocol-corpus change (the wire surface — openapi `recordAnnotation`/`listAnnotations`, asyncapi `run.annotated`, `capabilities.feedback`, `annotation.schema.json` — already landed with RFC 0056). The optional `run.annotated` SSE notification is not yet emitted (matches the in-memory reference; no scenario exercises it).
### docs(rfc-0064): /code-review follow-ups on the M2 enforcement (2026-05-25)

Two findings from a `/code-review` pass over the RFC 0064 M2 commit. Docs + one code comment; no schema, behavior, or wire-shape change.

- **conformance.md — seam-demonstration honesty.** Documented that the in-memory host has no production agent-tool-calling runtime, so the toolHooks contract is exercised entirely via the seam: the fail-closed authorization (unevaluable scope → `forbidden`; no resolver, so scoped tools are never granted) and the SR-1-redacted `argsHash` are real logic, but **`perToolRateLimit` is a simulation hint, not a real token bucket** — the host keeps no per-`(principal, tool)` bucket state and returns `rate_limited` only on the seam's `simulateRateLimitExhausted`. Keeps the production discovery advertisement from reading as "this host rate-limits real tool calls."
- **server.ts** comment noting `toolName` is accepted for request-shape fidelity but unused by the simulation (a production host keys a real bucket on `(principal, toolName)`).

### RFC 0064 (host.toolHooks) — Milestone 2: reference-host enforcement; promote Active → `Accepted` (2026-05-25)

The in-memory reference host now implements the RFC 0064 tool-invocation-hooks surface end-to-end, taking it from `Active` to **`Accepted`**. It advertises `capabilities.toolHooks { supported: true, prePostEvents: true, perToolAuthorization: true, perToolRateLimit: true }` and implements the documented `POST /v1/host/sample/toolhooks/invoke` seam:

- **§B content-free audit** — `agent.toolCalled` carries `argsHash` (= SHA-256 of the **SR-1-redacted** JCS serialization of the args; a resolved secret is scrubbed before hashing, so the plaintext never enters the hash input or any emitted field) + `principal` + `transport`; `agent.toolReturned` carries `status` + (on `ok`) a non-negative `durationMs`.
- **§C per-tool authorization (fail-closed)** — a non-empty `requiredScopes` is unevaluable on this non-RBAC host, so `status: 'forbidden'` and the tool never runs (no `durationMs`). This is the per-tool application of RFC 0049's `authorization-fail-closed` invariant; `tool-hooks-authorization-fail-closed.test.ts` is added to that invariant's test set (**no new invariant**).
- **§D per-tool rate limit** — `simulateRateLimitExhausted` yields `status: 'rate_limited'`.

All five `tool-hooks-*.test.ts` scenarios (shape always-on + content-free / authorization-fail-closed / rate-limit / secret-redaction) are live + green (no new scenarios; the M1 set flips from soft-skip to enforced). Reuses RFC 0002 events + RFC 0049 `forbidden` + the existing `rate_limited` — **no new event type, error code, or invariant**. RFC 0064 `Active → Accepted` (Accepted 48 → 49, Active 11 → 10). **This completes the entire autonomous-agent-runtime cohort's reference-host enforcement** (0058 runTimeoutMs + 0059 + 0060 + 0063 + 0064; the 0061 stateful loop + 0062 distillation remain Active pending their host wiring). Additive; no existing wire-shape change.

### docs(rfc-0063): /code-review follow-ups on the M2 enforcement (2026-05-25)

Four findings from a `/code-review` pass over the RFC 0063 M2 commit. Docs only; no schema, host-code, or wire-shape change.

- **§D `principalScope` scoped out for this host.** `examples/hosts/in-memory/conformance.md` now states that RFC 0063 §D (narrow the approval to RFC 0049 scopes) is accepted-but-not-enforced on this non-RBAC host and is exercised on an RFC-0049-capable host — the `Accepted` claim covers §B (checksum) + §C (the `subrun-merge-approval-fail-closed` merge gate).
- **Checksum canonicalization note.** Documented that the host's `stableStringify`-based checksum is effectively RFC-8785-conformant for JSON-representable values (RFC 8785's number/string rules are defined in ECMAScript terms); a production cross-host deployment with exotic numeric forms SHOULD pin a vetted RFC 8785 library.
- **conformance.md** measurement-header annotation extended to include the RFC 0063 enforcement landing.
- **INTEROP-MATRIX** in-memory row records the new `capabilities.agents.subRunAttestation` advertisement.

### docs(spec): fix duplicate `### 9` heading in host-sample-test-seams.md (RFC 0061 /code-review follow-up) (2026-05-26)

Two seams shared the heading number `### 9.` — the RFC 0059-M2 "Workspace cross-owner driver" (inserted at 9, referenced as `§9` in `CHANGELOG.md` / `RFCS/0059` / the in-memory `conformance.md`) and the older RFC 0039 "`POST /v1/runs/{runId}:fork mode:replay`" fork seam. Surfaced during the RFC 0061 `/code-review`; confirmed pre-existing (a parallel session's RFC 0059-M2 reused the number). Renumbered the fork seam to `### 10.` — it is referenced by number nowhere, and the workspace `§9` cross-refs stay correct. Prose-only; no schema, wire-shape, or seam-contract change.

### RFC 0063 (core.subWorkflow output attestation) — Milestone 2: reference-host enforcement; promote Active → `Accepted` (2026-05-25)

The in-memory reference host now implements the RFC 0063 verify-before-merge surface end-to-end, taking it from `Active` to **`Accepted`**. It advertises `capabilities.agents.subRunAttestation: true` and implements the documented `POST /v1/host/sample/subrun/attest` seam (`host-sample-test-seams.md`):

- **§B checksum** — `attestation { checksum, algorithm: 'sha256' }` where `checksum` is the byte-stable JCS+SHA-256 digest of `childOutputs` (key-order-invariant via the host's `stableStringify`, host-independent), surfaced on the existing RFC 0037 `core.workflowChain.event { phase: 'output.harvested' }` shape — **no new event type**.
- **§C merge gate** — when `outputAttestation.requireApproval: true`, the merge proceeds (`merged: true` + `mergedValues`) **only** on `approvalAction` `accept`/`edit-accept` and **fails closed** (`merged: false`, no `mergedValues`) on `reject` / absent / expired; the no-approval default merges. Reuses RFC 0051 `approval` + RFC 0049 scopes — no new interrupt kind or error code.

Registered the protocol-tier **`subrun-merge-approval-fail-closed`** SECURITY invariant (invariants 101 → 102; protocol-tier 69 → 70) with `subrun-approval-fail-closed.test.ts` as its public test. All four `subrun-*.test.ts` scenarios (shape always-on + checksum-stable / approval-gate / approval-fail-closed) are live + green (no new scenarios; the M1 set flips from soft-skip to enforced). RFC 0063 `Active → Accepted` (Accepted 47 → 48, Active 11 → 10). Additive; no existing wire-shape change.

### docs(rfc-0060): /code-review follow-ups on the M2 enforcement (2026-05-25)

Five findings from a `/code-review` pass over the RFC 0060 M2 commit. Docs/spec-prose only; no schema, host-code, or wire-shape change.

- **RFC 0060 Phase-0 scope note.** The Phase-0 resolution named two advertised knobs — `heartbeat.maxStateBytes` (prior-state size cap) + `heartbeat.maxPendingEnqueued` (backpressure pause MUST) — that never landed in `capabilities.schema.json` and aren't host-enforced. Added a scope note that they are **deferred to a follow-up** (meaningful only once a host wires a durable interval + real run-enqueue substrate; additive when they land), so the `Accepted` flip covers the once-per-tick / bounded / idempotent / emit-on-transition contract without overclaiming.
- **First-tick semantics (spec clarification).** `host-capabilities.md §host.heartbeat` now states normatively that a heartbeat's first tick (no persisted prior state) MUST be treated as a transition (`changed: true`, baseline emitted via `from: {}`) — making the §B.5 transition rule total and keeping a first non-empty observation actionable. Includes the durable-vs-in-memory restart-re-notification note (a host that loses prior state re-fires the next tick as a first tick; durable hosts SHOULD persist).
- **In-memory `conformance.md`** measurement-header annotation extended to cover the RFC 0059 + 0060 enforcement landings (the counts predate them; conservative).
- **INTEROP-MATRIX** in-memory row records the new `capabilities.workspace` (RFC 0059) + `capabilities.heartbeat` (RFC 0060) advertisements.

### RFC 0060 (host.heartbeat) — Milestone 2: reference-host enforcement; promote Active → `Accepted` (2026-05-25)

The in-memory reference host now implements the RFC 0060 heartbeat surface end-to-end, taking it from `Active` to **`Accepted`**. It advertises `capabilities.heartbeat { supported: true, minIntervalSec: 1, maxRuntimeMs: 5000 }` and implements the documented `POST /v1/host/sample/heartbeat/tick` seam (`host-sample-test-seams.md`):

- **§B.1** — exactly one `heartbeat.evaluated { heartbeatId, status, changed }` per tick.
- **§B.5 (anti-spam, the keystone)** — `heartbeat.stateChanged { heartbeatId, from, to }` + `enqueuedRuns: 1` are emitted **only** when `observedState` differs from the persisted prior tick (value-based comparison via a stable stringify); an unchanged tick emits neither. Action is gated on a state *transition*, not on the tick.
- **§B.2** — `simulateSlowMs` exceeding `maxRuntimeMs` terminates the evaluation and reports `status: 'timeout'` (no transition, no enqueue).

All four conformance scenarios — `heartbeat-{capability-shape, fires-once-per-tick, idempotent-no-spam, runtime-bound}.test.ts` — are live + green against the host (no new scenarios; the M1 set flips from soft-skip to enforced). RFC 0060 `Active → Accepted` (Accepted 46 → 47, Active 12 → 11). Additive; no existing wire-shape change.

### fix(hosts): RFC 0058 `cap.breached{run-duration}` `observed` must strictly exceed `limit` (2026-05-26)

Fixes a measurement-boundary flake in the RFC 0058 run-duration breach across all three reference hosts (in-memory, Postgres, SQLite). Each host computed `observed` as `Date.now() - runStartMs`; at the deadline boundary that integer-millisecond read occasionally lands exactly on `limitMs` (e.g. `observed=1000, limit=1000`), failing `run-execution-bounds-shape.test.ts`'s assertion that `observed` strictly exceeds `limit`. The deadline timer firing proves the run genuinely exceeded the bound (real elapsed is fractionally past it), so `failRunDuration` now floors `observed` to `max(elapsed, limitMs + 1)` — honoring the strict-exceedance invariant without misreporting. Surfaced as a ~1-in-N flake under full-suite parallelism (the test passed in isolation); root-caused to the host boundary, not test timing, so the conformance scenario is unchanged. Verified: full suite green ×3 on SQLite, ×2 on Postgres; the breach now consistently emits `observed ≥ limit+1`. Host-only; no protocol-corpus change.
### RFC 0059 (agent workspace) — Milestone 2: reference-host enforcement; promote Active → `Accepted` (2026-05-25)

The in-memory reference host now implements `host.workspace` end-to-end, taking RFC 0059 from `Active` to **`Accepted`**. It advertises `capabilities.workspace { supported, versioned, maxFileBytes: 1048576, maxFiles: 256, maxVersions: 20 }` and honors:

- **§C endpoints** — `GET /v1/host/workspace/files` (list, metadata only, `?prefix=`), `GET …/files/{path}` (`?version=N`), `PUT …/files/{path}` (atomic create/replace, monotonic `version`, recomputed `etag`, `If-Match` → `409 workspace_conflict` with `details.currentVersion`, `content` > `maxFileBytes` → `413 workspace_too_large`), `DELETE …/files/{path}` (tombstone). Run inputs already seed from variable defaults (RFC 0058 M2).
- **§D run-start snapshot** — an immutable workspace read snapshot is captured at run creation and exposed on the run snapshot (`GET /v1/runs/{runId}` → `workspace: [{ path, version }]`), replay-deterministic.
- **§E invariants** — **WCT-1** (cross-owner isolation): every file is scoped to its `{tenant, workspace}` owner; a `get`/`list` under a different owner fails closed (404, no existence leak). Registered as the protocol-tier `workspace-cross-tenant-isolation` invariant in `SECURITY/invariants.yaml` (invariant count 100 → 101) with `workspace-cross-tenant-isolation.test.ts` as its public test. **WSR-1** (secret redaction): writes pass through the host's `scrubSecretShaped()` (SR-1).

A documented test seam `POST /v1/host/sample/workspace/op` (`host-sample-test-seams.md` §9) drives CRUD against an explicit owner so WCT-1 is exercisable on this single-credential host (mirrors the blob/kv/queue cross-tenant seams). Two new conformance scenarios — `workspace-behavior.test.ts` (CRUD/ETag/too-large/snapshot via the §C endpoints) and `workspace-cross-tenant-isolation.test.ts` (WCT-1) — are live + green (suite 261 → 263). Additive; no existing wire-shape change.

### RFC 0061 (stateful agent-loop lifecycle, `executionModel.version: 5`) — wire surface landed; promote Draft → `Active` (2026-05-25)

Wire surface for the autonomous-agent-runtime cohort's **keystone**: it promotes the RFC 0037 execution loop (already re-entrant + replay-deterministic) to a *stateful* lifecycle at `multiAgent.executionModel.version: 5` — reusing the existing loop, the per-turn `runOrchestrator.decided` event, and the `terminate` exit rather than a parallel `agents.loop` surface. Landed: the `version` ceiling bumped 4 → 5 (widening, additive) + two additive optional fields on the `multiAgent.executionModel` block (`statefulResume`, `transcriptWindow`); an additive optional `iteration` counter on the existing `runOrchestrator.decided` payload (1-based, monotonic, the observable quantity `maxLoopIterations` (RFC 0058) bounds — declared in `properties` since the `$def` is `additionalProperties:false`, no new event type); a new normative `## Stateful agent-loop lifecycle (version >= 5)` section in `multi-agent-execution.md` (§B iteration counter, §C per-iteration memory+workspace+transcript snapshot inputs with next-turn write visibility, §D stateful HITL resume preserving the counter, §E acceptance via `terminate` + bound via `maxLoopIterations`); the agent-loop invoke seam in `host-sample-test-seams.md`. Four conformance scenarios (`agent-loop-version5-shape` always-on + `-iteration-monotonic`/`-workspace-snapshot`/`-stateful-resume` gated on `version >= 5` / `host.workspace` / `statefulResume` + the seam). **No new event type, capability block, or SECURITY invariant** — the loop's BYOK/CTI/SR-1 invariants are inherited from RFC 0037/0039/0059 unchanged; composes the RFC 0058 bound + RFC 0059 workspace snapshot + RFC 0039 memory snapshot + RFC 0041 replay determinism. **G1 (RFC 0058 gating reference):** already satisfied — `maxLoopIterations` gates on `executionModel.supported` everywhere; no `agents.loop.supported` reference exists, so no RFC 0058 change was needed. **RFC 0061 graduates `Draft → Active`**, closing the cohort's Draft remainder; `Active → Accepted` awaits a host wiring the v5 loop. Additive; no existing wire-shape change.

### docs(capabilities): add the `#### memory.distillation` reference subsection (RFC 0062 /code-review follow-up) (2026-05-25)

`capabilities.md` §`memory` maintains a per-sub-block advertisement reference (it has a detailed `#### memory.compaction` subsection), but RFC 0062 landed the `memory.distillation` schema block + the `agent-memory.md` run contract without the parallel `capabilities.md` subsection — so a host author reading the advertisement reference found `memory`/`memory.compaction` but not `memory.distillation`. Adds `#### memory.distillation (RFC 0062, Active)` mirroring the compaction entry (Why-this-exists, advertisement JSON example, per-field bullets, token-budget + SR-1 normative note pointing at `agent-memory.md` §"Scheduled distillation"). Prose-only; no schema or wire-shape change.

### RFC 0062 (`memory.distillation` — "dreams") — wire surface landed; promote Draft → `Active` (2026-05-25)

Wire surface for the autonomous-agent-runtime cohort's scheduled, token-budgeted memory distillation — the "dream" pattern: a periodic background run distills recent transactional memory into long-term artifacts under an explicit token budget, then refreshes a retrieval index the next session loads at startup. Composes RFC 0012 (compaction) + RFC 0052 (scheduling) + RFC 0059 (workspace index) rather than inventing a parallel pipeline. Landed: the additive `capabilities.memory.distillation` sub-block (`{ supported, maxTokenBudget?, scheduled?, indexEmitted?, tokenizerName?, archiveRetention? }`, nested under `memory`); an additive optional `distillation { tokenBudget, tokensUsed, indexUpdated }` sub-object on the **existing** `memory.compacted` event (RFC 0012) — not a parallel `memory.distilled` event; the `distillation.tokenBudget` reserved run-option key (`run-options.md`); the `token_budget_exceeded` error code registered in `rest-endpoints.md` (was SDK-vocab-only); the normative distillation contract in `agent-memory.md` (§"Scheduled distillation" — read snapshot → mandatory token budget counted against an advertised `tokenizerName` (±10%) → RFC 0012 distill with SR-1 carry-forward → byte-stable archive → `MEMORY-INDEX.json` workspace file riding `workspace.updated` → emit extended `memory.compacted`); the memory-distillation invoke seam in `host-sample-test-seams.md`. Five conformance scenarios (`distillation-shape` always-on + `-token-budget`/`-stable-archive`/`-index-roundtrip`/`-secret-carryforward` gated on the seam). **No new event type; SR-1 carry-forward lands at the RFC 0012 layer (no new invariant).** The `trigger` enum is unchanged — a scheduled distillation is `host-managed`. **RFC 0062 graduates `Draft → Active`**; `Active → Accepted` awaits a host running a scheduled distillation within budget + updating a retrievable index. Additive; no existing wire-shape change.

### feat(host-postgres)+feat(host-sqlite): enforce RFC 0058 `runTimeoutMs` (run-duration bound) (2026-05-25)

Both reference hosts now enforce the RFC 0058 wall-clock run bound, closing the `run-execution-bounds-shape` conformance failure that landed when the suite grew to include RFC 0058. Each host arms a per-run deadline = `min(configurable.runTimeoutMs, MAX_RUN_DURATION_MS)` (host ceiling, default 1h, advertised as `capabilities.limits.maxRunDurationMs`) at `run.started`; when it fires the host aborts the in-flight node and emits `cap.breached { kind: 'run-duration', limit, observed }` (observed = measured elapsed wall-clock, strictly > limit) then transitions to `failed` with `error.code = 'run_timeout'` — distinguishable on the wire from an application failure per `capabilities.md` §"Engine-enforced limits". The deadline-abort is re-attributed from the node's `cancelled` outcome to the run-duration breach. Also fixes `core.delay` resolution on both hosts to resolve its `delayMs` variable ref against the run's variable bag (defaultValue seed) overlaid with run inputs — the `conformance-run-duration-breach` fixture relies on the seeded `delayMs: 30000` default (previously collapsed to the 100ms fallback, so the bound never tripped); explicit `inputs.delayMs` (e.g. streamReconnect's `2000`) still overrides. Complements the in-memory host's RFC 0058 enforcement (separate work). The `maxLoopIterations` half of RFC 0058 is gated on `agents.loop.supported` (RFC 0061), which neither host advertises. Host-only; no protocol-corpus change.

### RFC 0058 M2 — /code-review follow-ups on the in-memory host enforcement (2026-05-25)

Five findings from a `/code-review` pass over the RFC 0058 M2 commit. Host + conformance only; no protocol-corpus change.

- **Poll envelope is now schema-clean.** Dropped the transitional `seq` / `data` legacy aliases from the `/v1/runs/{runId}/events/poll` response — they violated `run-event.schema.json` (`additionalProperties: false`). The two conformance readers that consumed `data` (`replayDeterminism`, `replay-fork-arbitrary` `structuralShape`) now read `payload ?? data` (canonical-first with legacy fallback — strictly more tolerant, so the still-legacy sqlite/postgres/python hosts stay green). The in-memory poll path now emits exactly `eventId` / `runId` / `type` / `sequence` / `payload` / `timestamp` (+ optional `nodeId`).
- **`runTimeoutMs` honors its `number` type.** Validation relaxed from integer-only to any positive finite number, floored to integer ms internally (`cap.breached.limit` is an integer per `run-event-payloads.schema.json`).
- **Mid-node timeout emits `node.failed { run_timeout }`** (was `node.cancelled`), so the node-level outcome agrees with the run's terminal `failed`.
- **Deadline timer `.unref()`'d** so a pending run-timeout never holds the event loop open (the HTTP server keeps the process alive; the timer is always cleared on settle).
- **`conformance.md` measurement header annotated** as predating this enforcement (counts not re-measured; conservative).

### RFC 0063 (`core.subWorkflow.outputAttestation`) — wire surface landed; promote Draft → `Active` (2026-05-25)

Wire surface for the autonomous-agent-runtime cohort's verify-before-merge guarantee on sub-workflows — an opt-in checksum + approval gate so a parent can verify sub-agent artifacts rather than merging them blindly: additive `agents.subRunAttestation` capability flag; an additive optional `attestation { checksum, algorithm }` object on the **existing** `core.workflowChain.event { phase: 'output.harvested' }` (RFC 0037) — declared in `properties` since that `$def` is `additionalProperties:false`, no new event type; the normative `outputAttestation` section on `core.subWorkflow` in `node-packs.md` (§B checksum via the RFC 8785 JCS + SHA-256 recipe pinned in `replay.md`, so a cross-host child verifies; §C `requireApproval` suspends via an RFC 0051 `approval` interrupt **before** `outputMapping` and **fails closed**; §D `principalScope` narrows to RFC 0049 scopes); the sub-run attestation invoke seam in `host-sample-test-seams.md`. Four conformance scenarios (`subrun-attestation-shape` always-on + `-checksum-stable`/`-approval-gate`/`-approval-fail-closed` gated on the seam). **Reuses RFC 0051's `approval` kind + RFC 0049 scopes — no new interrupt kind, event type, or error code.** The proposed protocol-tier SECURITY invariant `subrun-merge-approval-fail-closed` lands with its public test at reference-host implementation, not at `Active`. **RFC 0063 graduates `Draft → Active`**; `Active → Accepted` awaits a host wiring the gate. Additive; no existing wire-shape change.

### RFC 0058 (run execution bounds) — Milestone 2: reference-host `runTimeoutMs` enforcement (2026-05-25)

The in-memory reference host (`examples/hosts/in-memory`) now **enforces the wall-clock `runTimeoutMs` bound**: it advertises `capabilities.limits.maxRunDurationMs` (600000), resolves + clamps `RunOptions.configurable.runTimeoutMs` to that ceiling at run-create (rejecting out-of-range with `400 validation_error`), and arms a per-run deadline timer in `runWorkflow` that emits `cap.breached { kind: 'run-duration', limit, observed }` then transitions the run to `failed` with `error.code = 'run_timeout'`. The `run-execution-bounds-shape.test.ts` `run-duration` behavior block flips from soft-skip to **live + green** (3/3). To make the breach observable to the black-box suite, the `/v1/runs/{runId}/events/poll` path moved to the canonical `run-event.schema.json` envelope (`eventId` / `sequence` / `payload`; legacy `seq` / `data` retained as aliases — zero-regression superset). The host now also seeds run inputs from workflow `variables[].defaultValue`. **`maxLoopIterations` enforcement remains deferred to RFC 0061** (no reference host runs the RFC 0037 orchestrator loop). RFC 0058 stays `Active`; `Active → Accepted` awaits the loop-iteration half. Additive; no wire-shape change to existing surfaces.

### RFC 0066 (`x-openwop-form` vendor extension on pack `configSchema`) — filed `Draft` (2026-05-25)

New RFC reserving the `x-openwop-form` advisory annotation on pack-manifest `configSchema` properties so pack authors can opt their nodes into picker-grade UX (model / provider / credential / prompt pickers + cross-field cascades) that the static reference-app catalog already provides for built-in nodes. Motivated by the architect audit on `plans/app-buildable-now-on-existing-protocol.md` item #11 — item split into 11a (shipped: JSON-Schema validation-hint surfacing + array<string> rendering) and 11b (this RFC; picker UX for pack-installed nodes).

Spec text added to `spec/v1/node-packs.md` §"`x-openwop-form` UX hints on `configSchema` properties (RFC 0066, Draft)" — vocabulary table for the seven `kind` values, normative MUSTs on the unknown-`kind` fallback + `dependsOn` cascade-clear + non-bypass of `configSchema` validation, positive example using `core.ai.chatCompletion`.

Hosts MUST NOT read `x-openwop-form`; it's a consumer-side rendering hint. The `configSchema` itself remains the authoritative validator for what the host accepts. **Pure additive** per `COMPATIBILITY.md §2.1`: pack-author opt-in, no required field, no host change, no SDK change, no schema bump (the `x-*` prefix is the standard JSON Schema vendor-extension convention, accepted by every conformant validator and ignored by every renderer that doesn't recognize the key).

Path-to-Active is the 7-day comment window. Path-to-Accepted requires the spec text merged + the new shape-conformance scenario green + a non-steward pack author publishing a pack that exercises the extension (cohort precedent). Reference-app implementation (Phase 2) ships after Draft → Active.

### feat(app): item #11a — JSON-Schema validation-hint surfacing + array<string> rendering (2026-05-25)

Architect audit (against `plans/app-buildable-now-on-existing-protocol.md` item #11) found the pack-manifest JSON-Schema → form pipeline already shipped (frontend `configFieldsFromSchema` + `Inspector.tsx` + boot-time `loadDynamicCatalog()` merging pack-served nodes into the catalog). Item #11 split into **11a (this entry; no RFC needed)** and **11b (pending RFC for picker UX via `x-openwop-form` vendor extension)** — see the plan doc for the split rationale.

This entry ships 11a: extend the converter + renderer to honor JSON-Schema 2020-12 keywords the original pass ignored. App-only; no protocol-corpus change. Frontend `tsc --noEmit` clean.

- **`configFieldsFromSchema` extracted to its own module** (`apps/workflow-engine/frontend/react/src/builder/palette/configFieldsFromSchema.ts`) so it's unit-testable without the React store wiring. `catalogRegistry.ts` re-exports for back-compat; no call-site change.
- **Number inputs** forward `minimum` / `maximum` / `multipleOf` → HTML5 `min` / `max` / `step`. Integer fields default `step` to `1`.
- **Text inputs** forward `minLength` / `maxLength` / `pattern` → HTML5 `minlength` / `maxlength` / `pattern`. Textareas forward length hints only (HTML5 has no `pattern` on textarea).
- **New `string-list` ConfigField kind** for `array` of `items: { type: 'string' }` — one-per-line textarea that round-trips to `string[]`, honors `maxItems` (clamps + warns at the help row), and surfaces `items.pattern` in help text. Replaces the prior raw-JSON-textarea fallback for the common stop-sequence / tag-list shape (e.g., `core.ai.chatCompletion`'s `stopSequences`).
- **`default` values for `array<string>` and `object` shapes** are now carried through unchanged; the renderer pretty-prints object/array defaults into the textarea (previously silently dropped).
- **`ConfigField` interface extended** with optional `min` / `max` / `step` / `minLength` / `maxLength` / `pattern` / `maxItems` validation-hint fields + the new `string-list` kind + a wider `defaultValue` type covering `string[]` / `Record<string, unknown>` / `unknown[]`.
- **Unit test surface** at `apps/workflow-engine/frontend/react/src/builder/palette/__tests__/configFieldsFromSchema.test.ts` — vitest-style, 25+ cases, including the production `core.ai.chatCompletion` configSchema as a regression fixture. The frontend doesn't currently ship a test runner; the file is excluded from `tsc --noEmit` and becomes auto-running the moment `vitest` is added as a frontend devDep (one `npm install` + `"test": "vitest run"` script away — documented at the top of the test file).

**Validation hints are advisory UX only** — the host MUST still validate the persisted workflow against the authoritative pack manifest schema. The Inspector's HTML5 attribute forwarding catches obvious typos at edit time but is not a substitute for backend validation.

### fix(spec): RFC 0064 `host.toolHooks` review follow-ups — broken anchor, schema status text, conformance citation (2026-05-25)

Three editorial corrections on the merged RFC 0064 surface (no wire-shape change): (1) `mcp-integration.md` cross-ref to `host-capabilities.md#§hosttoolhooks` → `#hosttoolhooks` — GitHub's slugger strips the `§`, so the `§`-prefixed anchor 404'd on click; (2) the `capabilities.schema.json` `toolHooks` block description read "RFC 0060 sibling — RFC 0064 (`Draft`)" while the RFC is now `Active` and the prose contradicted it → "RFC 0064 (`Active`) — sibling of `heartbeat`"; (3) `tool-hooks-secret-redaction.test.ts` cited §E (credentials) for the SR-1 `argsHash` redaction MUST, which lives in §B → now cites §B. Description-only schema edit; no field, type, or required-array change.

### fix(host-postgres): artifact endpoint rejects unauthenticated requests (401 before existence) (2026-05-25)

The Postgres host had no `GET /v1/runs/{runId}/artifacts/{artifactId}` route, so unauthenticated requests fell through to the catch-all 404 — answerable without ever checking auth, a cross-tenant existence oracle (`artifact-auth.test.ts` expects 401). Adds an artifact route that runs `checkAuth` **before** any existence check: missing/invalid auth → canonical 401 `unauthenticated`; an authenticated caller → 404 `artifact_not_found` (this host persists no artifacts). Closes the last deterministic Postgres conformance failure (now 0 failed / 1627 passed; `webhook-signed-delivery` remains a known full-suite timing flake). Host-only; no protocol-corpus change.

### fix(host-postgres): register `core.identity` — closes the RFC 0022 dispatch/subWorkflow conformance failures (2026-05-25)

The Postgres reference host never registered the canonical `core.identity` node (`spec/v1/node-packs.md` §`core.identity`; "servers SHOULD ship for v1 conformance"). Every RFC 0022 dispatch/subWorkflow child fixture uses `core.identity` as its noop body, so those children failed `unsupported_node_type` and cascaded their parents to `failed` — surfacing as 4 RFC 0022 conformance failures (`dispatch-input-mapping`, `dispatch-output-mapping`, `dispatch-cross-worker-handoff`, `subworkflow-input-mapping`) **plus** a 5th, separately-uncounted `identity-passthrough.test.ts` failure. This corrects the prior taxonomy in `docs/CONFORMANCE-RUNS-2026-05*.md`, which mis-attributed the 4 failures to a missing "supervisor-mock extension" (that extension — `config.mockDispatchPlan` — already shipped). Adds a `core.identity` case to `executeNode` (echo-input passthrough: folds the run's `inputs_json` into `variables_json`, since this host seeds variables from `defaultValue` only). Re-measured: Postgres conformance **6 failures → 2** (the 2 remaining — `webhook-signed-delivery` flake + `artifact-auth` 404-vs-401 — are pre-existing and unrelated). Host-only; no protocol-corpus change.

### feat(host-sqlite): RFC 0022 dispatch/subWorkflow runtime variable mapping — port from Postgres (2026-05-25)

Closes RFC 0022 on the SQLite reference host (the supervisor-mock gap was real here, unlike Postgres). Adds: `config.mockDispatchPlan` support on `core.orchestrator.supervisor` (emit a fixture-driven `OrchestratorDecision[]` sequence in order, then `terminate`); sequential multi-worker `core.dispatch` honoring all four RFC 0022 mapping fields (`inputMapping` / `outputMapping` / `perWorkerInputMappings` / `perWorkerOutputMappings`) — projects parent variables into each child's `inputs_json` via `effectiveInputMapping = perWorkerInputMappings[workerId] ?? inputMapping ?? {}` and harvests child variables back into the shared parent bag on terminal `completed` (failed/cancelled skip; the parent bag is the §D cross-worker handoff channel); `inputMapping` on `core.subWorkflow` (two-pass child-variable seeding: `defaultValue` then projection override); top-level `defaultValue` seeding of run variables at create (was inputs-only); and the `capabilities.agents.dispatchMapping: true` + `capabilities.subWorkflow.inputMapping: true` advertisements. All 13 RFC 0022 scenario cases pass (negative refusal + mid-run-mutation paths soft-skip — SQLite exposes no test seam). Re-measured: SQLite conformance **7 failures → 1** (the remaining `model-capability-insufficient` was independently closed by the SQLite RFC 0031 model-capability gate, #189 — so SQLite is now at 0 failures). Host-only; no protocol-corpus change.

### RFC 0064 (`host.toolHooks`) — wire surface landed; promote Draft → `Active` (2026-05-25)

Wire surface for the autonomous-agent-runtime cohort's tool-invocation hooks — per-tool authorization + rate limiting + a content-free tool-call audit trail, layered on the **existing** `agent.toolCalled` / `agent.toolReturned` events (RFC 0002) rather than a parallel surface: additive top-level `capabilities.toolHooks` block (`{ supported, prePostEvents?, perToolAuthorization?, perToolRateLimit? }`); five additive optional payload fields — `argsHash` (SR-1-redacted JCS+SHA-256, content-free per RFC 0057), `principal` (RFC 0048; `core.system` for non-agent egress), `transport` (`mcp`/`http`/`native`) on `agentToolCalled`, and `status` (`ok`/`error`/`forbidden`/`rate_limited`) + `durationMs` (recorded, re-emitted on replay) on `agentToolReturned`; the normative §host.toolHooks contract in `host-capabilities.md` + a cross-ref from `mcp-integration.md`. Per-tool authorization **reuses** RFC 0049's `forbidden` error + `authorization-fail-closed` invariant (fail-closed: a lacked/unevaluable scope never invokes the tool); rate limiting reuses `rate_limited`. **No new event type, error code, or SECURITY invariant.** Five conformance scenarios (`tool-hooks-shape` always-on + `-content-free`/`-authorization-fail-closed`/`-rate-limit`/`-secret-redaction` gated on the documented tool-hooks invoke seam in `host-sample-test-seams.md`). **RFC 0064 graduates `Draft → Active`**; `Active → Accepted` awaits a host wiring the seam. Additive; no existing wire-shape change.

### RFC 0059 (agent workspace) — Milestone 1: schema + spec prose; promoted Draft → `Active` (2026-05-25)

Lands the additive `host.workspace` capability — a versioned, atomic, tenant·workspace-scoped (RFC 0048) ground-truth file store, complementing the transactional `MemoryAdapter` (RFC 0004) with a durable, path-addressable file layer. The wire surface landed atomically across:

- **Schema:** `capabilities.workspace` block (`{supported, versioned, maxFileBytes, maxFiles, maxVersions}`); new `workspace-file.schema.json` + `workspace-file-create.schema.json`; a content-free `workspace.updated` RunEvent payload (`run-event-payloads.schema.json#$defs.workspaceUpdated` + the `run-event.schema.json` `RunEventType` enum) — no `eventLogSchemaVersion` bump.
- **API:** four `/v1/host/workspace/files[/{path}]` endpoints (`listWorkspaceFiles` / `getWorkspaceFile` / `putWorkspaceFile` honoring `If-Match` with `409 workspace_conflict` + `413 workspace_too_large` / `deleteWorkspaceFile`), each `501`-gated on `capabilities.workspace.supported`; AsyncAPI `workspace.updated` message on the `updates` + `debug` channels.
- **Spec:** new `spec/v1/agent-workspace.md` (`DRAFT v1.x`) with the §C endpoints, §D run-snapshot exposure, and §E invariants (WCT-1 cross-tenant + WSR-1 secret-redaction as normative prose); `workspace_conflict` + `workspace_too_large` registered in `rest-endpoints.md`.
- **SDK:** `listFiles`/`getFile`/`putFile`/`deleteFile` (TS), `list_workspace_files`/`get_workspace_file`/`put_workspace_file`/`delete_workspace_file` (Python), `ListWorkspaceFiles`/`GetWorkspaceFile`/`PutWorkspaceFile`/`DeleteWorkspaceFile` (Go) — null/false-on-404/501 + `If-Match` support, mirroring the annotation methods.
- **Conformance:** always-on `workspace-capability-shape.test.ts` (+1 scenario file; suite 247 → 248); coverage.md row added.

Behavioral conformance (CRUD/ETag/cross-tenant-isolation/run-snapshot) and the `workspace-cross-tenant-isolation` SECURITY invariant + its public test land at the implementation milestone (Milestone 2), not at Active. README counts re-synced. Additive; no breaking change.

### RFC 0060 — document the heartbeat tick seam; code-review follow-ups (2026-05-25)

Closes a `/code-review` finding on RFC 0060: the three gated `heartbeat-*.test.ts` scenarios drove a `POST /v1/host/sample/heartbeat/tick` seam that was undocumented (and the RFC §D text mis-cited the RFC 0052 `scheduling/tick` seam) — so they could never be wired by a willing host (the "looks-like-coverage-but-never-runs" trap). Added the **heartbeat tick seam** to `host-sample-test-seams.md` §"Open seams" (path + `{ heartbeatId, observedState, simulateSlowMs? }` → `{ evaluated, stateChanged, enqueuedRuns }` shape + capability gate), reconciled the RFC §D conformance text to cite it, and `lib/heartbeat.ts` already matches. Also added an advisory-tier SECURITY invariant `heartbeat-state-no-secret` (the `heartbeat.stateChanged` `from`/`to` SHOULD NOT carry secret material; advisory since heartbeat state is host-internal, not BYOK-resolved) and dropped a defensive parenthetical from the README Active-RFC list. Invariant count 99 → 100 (advisory 1 → 2). Docs/spec only; no wire-shape change.

### fix(app): code-review follow-ups on the SDK-migration PR (2026-05-25)

Five findings from a `/code-review` pass over PRs #188 + #193 (SDK-migration close-out). All app-only; no protocol-corpus change. Frontend `tsc --noEmit` clean.

- **`client/runsClient.ts`** — `getDebugBundle` was using the banned `as unknown as` cast (per the code-review skill's quality gate). Imports the SDK's `DebugBundle` type directly and returns it; the only consumer (`RunDetailPage.tsx`) just `JSON.stringify`s the result, so no behavior change.
- **`client/streamsClient.ts`** — `subscribeBearer` declared + received `idleMs`/`absoluteMs` parameters that were never referenced in the body (the actual timer arming uses closures captured in `subscribeToRun`'s scope). Asymmetric signature with cookie-mode. Dropped them from both the call site and the parameter type.
- **`client/interruptsClient.ts`** — the re-exported `InterruptInspection` type is now the SDK's `InterruptByTokenInspection`. This narrows the kind union (drops `'refinement'` / `'cancellation'`) and removes the prior `resolved: boolean` field. **No current in-app consumer reads either** (grep is clean), so zero runtime impact; the change aligns the consumer-side surface with the SDK's authoritative type. Future code that needs `resolved` or those kinds should source them from the run-event log instead of the inspection envelope.
- **`discovery/CapabilitiesPanel.tsx`** — moved six new inline `style={{...}}` instances on the Conformance & profiles card to new `.cap-table-label` / `.cap-chip-list` / `.cap-badge-img` classes in `styles/global.css` (token-driven via `var(--space-1)`); dropped a couple of inline rules that were already in `.cap-table th, .cap-table td` / `.cap-table code`.
- **`discovery/CapabilitiesPanel.tsx` + `client/config.ts`** — badge `<img src>` and the leaderboard `<a href>` were hard-coded to `https://openwop.dev/...`. Now resolve against a new `config.siteBaseUrl` (env: `VITE_OPENWOP_SITE_URL`, default `https://openwop.dev`) so an air-gapped / fork deployment can point at its own copies. The badge SVGs ship in this repo's `public/badge/` for same-origin serving.

### RFC 0060 (`host.heartbeat`) — wire surface landed; promote Draft → `Active` (2026-05-25)

Wire surface for the autonomous-agent-runtime cohort's heartbeat capability — system-managed, predicate-gated polling (the controlled, request-shaped exception to openwop's poll-free design): additive top-level `capabilities.heartbeat` block (`{ supported, minIntervalSec?, maxRuntimeMs? }`); two heartbeat-scoped AsyncAPI events `heartbeat.evaluated` / `heartbeat.stateChanged` on a new `heartbeatEvents` channel, backed by `schemas/heartbeat-evaluated.schema.json` + `schemas/heartbeat-state-changed.schema.json` (NOT RunEvents — heartbeat-scoped; added to the conformance synthetic-message set); the normative §host.heartbeat contract in `host-capabilities.md` (fire-once-per-tick, runtime-bounded, idempotent, transition-gated to prevent notification spam); a `positioning.md` bounded-exception note; and four conformance scenarios (`heartbeat-capability-shape` always-on + `-fires-once-per-tick` / `-idempotent-no-spam` / `-runtime-bound` gated on the cap + a host tick seam, soft-skip until a host wires it). Composes on RFC 0052 (`scheduling`) for the tick substrate and is hard-ceilinged by RFC 0058's `maxRunDurationMs`. **RFC 0060 graduates `Draft → Active`**; `Active → Accepted` awaits a host wiring the tick seam. Counts synced (38 schemas; 251 scenarios; Active 8 → 9, Draft 12 → 11). Additive; no existing wire-shape change.

### feat(app): finish the SDK migration of the reference frontend (2026-05-25)

Closes item #22 ("Replace hand-rolled fetch with the published SDK") from `plans/app-buildable-now-on-existing-protocol.md`. The reference app had drifted on three surfaces where the published `@openwop/openwop` SDK already exposed a helper (per `sdk/PARITY.md`):

- `client/runsClient.ts` — `getDebugBundle()` routed through `client.runs.debugBundle()` (parity row SDK-4, closed 2026-05-15) instead of a hand-rolled fetch added in PR #188.
- `client/interruptsClient.ts` — `inspectByToken()` routed through `client.interrupts.inspectByToken()` instead of a hand-rolled `GET /v1/interrupts/{token}`.
- `prompts/promptsClient.ts` + `builder/DemoHostBanner.tsx` — discovery probes routed through the existing `getCapabilities()` (`client.discovery.capabilities()`) instead of hand-rolled `GET /.well-known/openwop`.

Larger win in `client/streamsClient.ts`: bearer-mode SSE now routes through the SDK's `streamEvents()` (fetch + ReadableStream — `sse.ts`), which sets `Authorization: Bearer` as a real header. **Drops the `?apiKey=<key>` URL query-param pattern** the prior EventSource implementation had to use because `EventSource` can't set custom headers — that pattern leaked credentials into browser history, server logs, and shared screenshots. Bearer-mode SSE is now captured by the in-app network recorder (per `devtools/networkRecorder.ts`); cookie-mode SSE stays on native `EventSource` because the SDK's `streamEvents` doesn't expose a `credentials: 'include'` hook for the `openwop.session` cookie. Public API of `subscribeToRun` / `Subscription` / dual idle+absolute timeouts is preserved; the 5 consumer surfaces (chat session, builder live overlay, RunDetailPage timeline, CommandCenter run summary, devtools recorder) are unchanged.

Deferred to next SDK publish: `client/feedbackClient.ts` annotation create/list — the SDK source has `client.runs.{create,list}Annotation()` per `sdk/PARITY.md` 2026-05-25 entry, but the published `@openwop/openwop@1.1.3` doesn't include them yet. Marked with a `TODO` comment for a mechanical swap once the SDK ships.

Out of scope: `client/registryClient.ts` would need a separate SDK instance pointed at the public registry origin (`packs.openwop.dev` vs. the host's `baseUrl`); cleaner refactor for a follow-up.

App-only; no protocol-corpus change.

### RFC 0057 (memory write-attribution) — §D replay-stability: backend guard + conformance (2026-05-25)

Closes a `/code-review` finding: the reference backend's at-completion run-summary write was unguarded against replay, so a `replay`-mode fork that re-executed to completion would mint a new `memoryId` and re-emit `memory.written` — contrary to RFC 0057 §D ("MUST NOT regenerate `memoryId`"). The executor now **skips** the run-summary write (and its `memory.written` emit) when `run.forkMode === 'replay'`; `branch`-mode forks (genuinely new runs) still write + attribute their own. Added the always-relevant §D distinction + a non-normative implementation note to the RFC, and a new `memory-attribution-replay-stable.test.ts` conformance scenario (gated; asserts a replay introduces no `memory.written` with a new `memoryId`) — passes against the reference backend. Scenario count 246 → 247. Additive; no wire-shape change.

### RFCs 0058–0064 — Phase-0 architect decision batch resolved; RFC 0058 promoted Draft → `Active` (2026-05-25)

Closes the architect Phase-0 decision batch (`docs/autonomous-agent-runtime-plan.md` §8.3) — the only gate to `Draft → Active` for the autonomous-agent-runtime cohort. No wire-shape change (decisions + status only):

- **Decisions recorded** in each RFC's "Phase-0 resolution" block + the §8.3 checklist (all ticked). Rulings: (A) the four additive event extensions confirmed non-breaking against `origin/main` schemas — no `eventLogSchemaVersion` bump; (B) checksums (0063) + `argsHash` (0064) pinned to the existing RFC 8785 JCS recipe in `replay.md §B`; (C) `token_budget_exceeded` / `workspace_conflict` / `workspace_too_large` are the only new error codes (0064 reuses `forbidden` + `rate_limited`); (D1–D11) the eleven "decide before Active" knobs resolved; (E) two new protocol-tier invariants (0059, 0063) land with their tests at implementation, 0064 reuses RFC 0049's `authorization-fail-closed`.
- **Additive-amendment notes** added to the three Accepted RFCs whose events the cohort extends: 0002 (`agent.toolCalled`/`agent.toolReturned`), 0012 (`memory.compacted`), 0037 (`runOrchestrator.decided` + `core.workflowChain.event`).
- **RFC 0058 → `Active`** — its wire surface (schema + spec + conformance + SDK) landed atomically, meeting the repo's Active bar; architect-cleared + steward-accepted. `Active → Accepted` awaits reference-host enforcement. README counts re-synced (Active 7 → 8, Draft 13 → 12). RFCs 0059–0064 stay `Draft` (decision-complete + wire-shape-pinned; they flip to Active when their Phase-2 schema + prose land).

### feat(host-postgres): RFC 0031 gate-decision test seam — flips the synthetic model-capability assertions live (2026-05-25)

Adds `POST /v1/host/sample/test/evaluate-model-capability-gate` to the Postgres reference host — a pure-function exerciser for the RFC 0031 §B gate's substitute/refuse/dispatch decision matrix + emitted event payloads (no event-log write, no secrets; always-on). This flips the previously-soft-skipping synthetic assertions in `model-capability-insufficient.test.ts` (4 refuse cases) and `model-capability-substituted.test.ts` (substitute/refuse/dispatch) from 404-skip → live against Postgres. New `test/model-capability-gate-seam.test.ts` (PGlite) exercises all five outcomes (refuse ×3, substitute, dispatch). Postgres-only: the seam belongs on a host with a real provider-capability map — the SQLite host routes no AI (empty map, can only refuse), so it correctly does NOT expose the seam and keeps soft-skipping the synthetic cases. Host-only; no protocol-corpus change.

### RFC 0057 (memory write-attribution) — SDK typed event helpers (TS/Python/Go) (2026-05-25)

All three reference SDKs gain a typed `memory.written` event helper, joining the RFC 0024 `agent.*` event-helper family at full parity: TS `isMemoryWritten` + `MemoryWrittenPayload`; Python `is_memory_written` + `memory_written_payload` + `MemoryWrittenPayload`; Go `IsMemoryWritten` + `UnmarshalMemoryWritten` + `MemoryWrittenPayload`. Typed event-type predicates sit outside the headline net-surface count (they narrow payloads rather than wrap endpoints) but are kept symmetric across all three — see `sdk/PARITY.md`. tsc + go vet/gofmt + ruff clean.

### RFC 0058 §A–§D — run-execution-bounds wire surface landed (`Draft`, 2026-05-25)

Implements the RFC 0058 wire surface (additive; Status stays `Draft` pending the comment window + reference-host enforcement, per the RFC 0052 precedent).

- **Schema:** `capabilities.schema.json` `limits.{maxRunDurationMs,maxLoopIterations}` (optional); `run-event-payloads.schema.json` `capBreached.kind` enum gains `run-duration` + `loop-iterations` (additive enum extension, no `eventLogSchemaVersion` bump — same move as RFC 0008 §K `wasm-*`).
- **Spec:** `run-options.md` reserved keys `runTimeoutMs` + `maxLoopIterations`; `capabilities.md` §"Engine-enforced limits" resolution for the two run-scoped kinds + `observed`-recorded-not-recomputed replay clause; `rest-endpoints.md` error codes `run_timeout` + `loop_limit_exceeded`; `observability.md` `openwop.cap_kind` enumeration.
- **Conformance:** `run-execution-bounds-shape.test.ts` (always-on advertisement-shape) + `coverage.md` row; `run-duration` breach behavior soft-skips until a host enforces wall-clock timeouts.
- **SDKs:** TS / Python / Go gain the two `limits` fields, the two `RunConfigurable` keys, and the two error codes.

### RFCs 0058–0064 — autonomous-agent-runtime cohort filed (`Draft`, 2026-05-25)

Seven additive RFCs filed from the `apps/workflow-engine` demo-app gap audit against the proposed autonomous-agent-runtime feature set. All `additive`, all capability-gated; spec/schema/conformance/SDK/host work tracked in [`docs/autonomous-agent-runtime-plan.md`](./docs/autonomous-agent-runtime-plan.md). No normative wire shape changes yet (Draft) — README RFC counts synced to 65 / Draft (13).

- **RFC 0058** run execution bounds — `runTimeoutMs` + `maxLoopIterations` reserved keys, `limits.{maxRunDurationMs,maxLoopIterations}`, surfaced through **two new `cap.breached` kinds** (`run-duration`, `loop-iterations`) reusing the unified engine-enforced-limit event rather than a new event type, + `run_timeout` / `loop_limit_exceeded` codes (closes the no-per-run-timeout gap; `recursionLimit` only counts nodes).
- **RFC 0059** agent workspace — `host.workspace`: versioned, atomic, tenant·workspace-scoped ground-truth file store + `workspace.updated`; new durable layer beside `MemoryAdapter`.
- **RFC 0060** host heartbeat — `host.heartbeat`: predicate-gated, runtime-bounded, idempotent poller emitting `heartbeat.evaluated` / `stateChanged` (anti-spam); composes RFC 0052; `positioning.md` bounded-exception note.
- **RFC 0061** stateful agent-loop lifecycle — promotes the RFC 0037 execution loop to `multiAgent.executionModel.version: 5`: per-iteration workspace snapshot (RFC 0059), an additive `iteration` counter on `runOrchestrator.decided` that `maxLoopIterations` (RFC 0058) bounds, and a `statefulResume` guarantee — reusing the existing loop + event rather than a parallel `agents.loop` surface.
- **RFC 0062** scheduled memory distillation ("dreams") — `memory.distillation`: token-budgeted scheduled compaction (`distillation.tokenBudget` reserved key) reusing RFC 0012's `memory.compacted` event (+ an additive optional `distillation` sub-object) rather than a new `memory.distilled` event; memory-index workspace file; composes RFC 0012 + 0052 + 0059. Registers `token_budget_exceeded`.
- **RFC 0063** sub-run output attestation & merge gating — optional `core.subWorkflow.outputAttestation` (checksum + RFC 0051 approval before `outputMapping` merge, fail-closed); surfaces the checksum via an additive `attestation` field on the existing `core.workflowChain.event { phase: 'output.harvested' }` rather than a new `subRun.attested` event.
- **RFC 0064** tool invocation hooks & per-tool authorization — `host.toolHooks`: extends the existing `agent.toolCalled` / `agent.toolReturned` events (RFC 0002) with content-free `argsHash` + `status`/`durationMs`, fail-closed per-tool RBAC reusing RFC 0049's `forbidden` error + `authorization-fail-closed` invariant, per-tool rate limiting reusing `rate_limited` — no parallel `tool.invoked`/`tool.returned`/`tool_forbidden` surface.
### feat(host-sqlite): RFC 0031 model-capability gate — port from the Postgres reference (2026-05-25)

Ports the RFC 0031 model-capability gate to the SQLite reference host (follows the Postgres landing): `src/modelCapability.ts` (the shared gate + probe), a pre-`node.started` gate in `executeNode` (refuse → `model.capability.insufficient` before `node.failed` + `capability_not_provided`; node never executes), and `capabilities.modelCapabilities.{supported: true, advertised: [], substitutionSupported: false}` in discovery. Honest posture: SQLite routes no AI (it omits `aiProviders`), so its active model satisfies NO model capability — `advertised: []` and any node requiring one is refused; the gate's active provider is set accordingly so the advertisement and behavior stay consistent. New end-to-end `test/model-capability-insufficient.test.ts` (boots the host over a temp DB + free port) asserts the failure code + event ordering + no node execution. Host-only; no protocol-corpus change. Closes the SQLite side of the model-capability-insufficient gap.

### RFC 0057 (memory write-attribution) — reference-host emission; promote Draft → `Active` (2026-05-25)

The workflow-engine **reference backend** (deployed as `app.openwop.dev`) now advertises `capabilities.memory.attribution.{ supported: true, emitsWriteEvents: true }` and emits a content-free `memory.written` RunEvent on its run-summary write (`executor.ts` — identifiers + non-secret tags only; `nodeId` omitted as a host session-end write per RFC 0057 §B). The four `memory-attribution-*.test.ts` scenarios pass against it (verified locally: discovery advertises the block; a completed run emits exactly one `memory.written` with no `content`). With schema + prose + SECURITY + conformance (corpus, prior entry) and a host advertising-and-honoring the capability, **RFC 0057 graduates `Draft → Active`**; `Active → Accepted` awaits a non-steward host. README RFC counts synced (Active 6 → 7, Draft 7 → 6); `docs/PROTOCOL-STATUS.md` regenerated. Additive.
### feat(host-postgres): RFC 0031 model-capability gate — closes the model-capability-insufficient conformance gap (2026-05-25)

The Postgres reference host now honors `NodeModule.requiredModelCapabilities` at dispatch (RFC 0031 §B). Adds `src/modelCapability.ts` (ported from the reference workflow-engine's `modelCapabilityGate.ts` + `modelCapabilityProbe.ts`: static per-provider capability map + `evaluateModelCapabilityGate` + payload builders); wires a pre-`node.started` gate in `executeNode` that, for a node whose required capability the active model doesn't advertise, emits `model.capability.insufficient` BEFORE `node.failed` and fails the run with `error.code = "capability_not_provided"` (§B step 4 + §D) — the node never executes (no `node.completed` / `provider.usage`); advertises `capabilities.modelCapabilities.{supported, advertised, substitutionSupported: false}` in discovery. New end-to-end `test/model-capability-insufficient.test.ts` (PGlite) drives the `conformance-model-capability-insufficient` fixture and asserts the failure code + event ordering. Closes the `model-capability-insufficient.test.ts` E2E failure in `docs/CONFORMANCE-RUNS-2026-05.md`. Host-only; no protocol-corpus change. (The 4 synthetic gate-decision assertions soft-skip on 404 — a `/v1/host/sample/test/evaluate-model-capability-gate` seam is a follow-up.)

### feat(host-sqlite): RFC 0026 cost attribution — port from the Postgres reference (2026-05-25)

Ports the RFC 0026 cost-attribution implementation to the SQLite reference host (follows the Postgres landing): `src/cost.ts` (canonical `openwop.cost.*` allowlist sanitizer + per-run rollup), `addNodeSpanAttributes()` in `observability.ts`, a `conformance.cost.emit` case in `executeNode` (sanitize → span → rollup; `node.completed` via the post-switch path), and `metrics.openwopCost` on the run snapshot (`run-snapshot.schema.json`). Non-allowlisted keys + the credential-shaped canary are dropped (`cost-attribution-allowlist-redaction`). New end-to-end `test/cost-attribution.test.ts` (boots the host over a temp SQLite DB + free port) asserts the rollup folds usd/tokens/provider and drops the violations. Host-only; no protocol-corpus change. Closes the SQLite side of the cost-attribution conformance gap.

### RFC 0057 (memory write-attribution) — corpus (schema + prose + SECURITY + conformance) (2026-05-25)

Wire surface for RFC 0057 (stays `Draft` pending reference-host emission): additive `memory.written` RunEvent (`run-event.schema.json` enum + `run-event-payloads.schema.json#/$defs/memoryWritten`, identifiers-only — `{ memoryRef, memoryId, nodeId?, agentId?, tags? }`, never content); additive `capabilities.memory.attribution.{ supported, emitsWriteEvents }` block. The event is a **replayable recorded fact** (re-emitted from the log, never regenerated — `replay.md` §"Recorded-fact events"), the inverse of RFC 0056's side-resource annotations. Spec prose closed the `agent-memory.md` §"Open spec gaps" per-node-attribution gap + added the `observability.md` event-vocabulary row. Two protocol-tier SECURITY invariants (`memory-attribution-no-content`, `memory-attribution-tenant-scoped`) + four capability-gated conformance scenarios (`memory-attribution-{shape,no-content,tenant-scoped,emits-on-write}.test.ts`, gated on `capabilities.memory.attribution.emitsWriteEvents`). All additive; no api/asyncapi change (the event rides the existing run-event stream).

### RFC 0065 — workflow node primary-output annotation (Draft, 2026-05-25)

New `Draft` RFC: adds an optional `outputRole: "primary" | "secondary"` field to `WorkflowNode` in `schemas/workflow-definition.schema.json`. Advisory-only authoring-time hint that lets a workflow author mark exactly one terminal node as the canonical-deliverable artifact, disambiguating the run's "primary output" when the graph has multiple terminal nodes. Engine behavior unchanged; tooling (chat-surface completion cards, run-detail page headers) MAY consume the hint to pick which of N terminal outputs to surface. Filed from the chat-surface architect-review pass on PR #159 — v1 convention there is "N View links for N terminals"; this RFC is the v2 "primary-tagged" path. All additive. Compatibility: implementer SDKs validating against pre-0065 workflow-definition.schema.json copies will reject the new field per the existing additive-field convention; SDK consumers bump their schema copy to v1.1.x to accept it. New conformance scenario `workflow-primary-output-annotation.test.ts` (always-on; 6 cases — accepts primary + secondary on different nodes, accepts the field absent, rejects unknown enum, rejects non-string, permits multiple primaries per the "tooling decides" promise). README RFC count synced 57 → 58 (Draft 6 → 7); conformance scenario count synced 240 → 241; `docs/PROTOCOL-STATUS.md` regenerated.

### feat(host-postgres): RFC 0026 cost attribution — closes the cost-attribution conformance gap (2026-05-25)

The Postgres reference host now implements RFC 0026 cost attribution end-to-end, closing the `cost-attribution.test.ts` failures recorded in `docs/CONFORMANCE-RUNS-2026-05.md` (the host previously had no `conformance.cost.emit` handler — the typeId hit `unsupported_node_type`, and no `metrics.openwopCost` surfaced on the snapshot). Adds `examples/hosts/postgres/src/cost.ts` (canonical `openwop.cost.*` allowlist sanitizer + per-run rollup mirroring the reference workflow-engine's `costEmitter.ts`); wires a `conformance.cost.emit` case in `executeNode` (sanitize → `addNodeSpanAttributes` for an OTel scrape → fold into the rollup); surfaces `metrics.openwopCost` on the run snapshot (`run-snapshot.schema.json`). Non-allowlisted keys + the credential-shaped canary are dropped (the `cost-attribution-allowlist-redaction` invariant). New `test/cost-attribution.test.ts` (PGlite, end-to-end) asserts the rollup folds usd/tokens/provider and drops the violations. Host-only; no protocol-corpus change.

### fix(app)+spec(rfc-0055): media-node code-review fixes — schema-conformant payload + a11y `alt` (2026-05-25)

Addresses the #169 code-review findings. **(1)** The demo media-emit node emitted a `media.image` payload with a nested `meta.rendering` key that `schemas/envelopes/media.image.schema.json` rejects (`additionalProperties:false`); the producer now emits a payload that conforms to the published per-kind schema. To keep the accessibility text, **`alt` is added as an optional field to the three `media.{image,audio,file}` schemas** (additive — a11y-positive; images SHOULD carry alt) + noted in `ai-envelope.md` §"Media reference payloads", and the node emits `alt` at the payload top level. The run-detail media renderer reads `payload.alt`. **(2)** `nodeCatalog` accent `var(--color-clay, #b5651d)` (undefined token → hardcoded fallback) → `var(--clay)`. **(3)** catalog badge emoji → single letter, matching convention. App + additive schema only; `openwop:check` 9/9.

### feat(app): media-emitting demo node — closes the RFC 0055 §C loop end-to-end (2026-05-25)

Adds the **producer** the RFC 0055 §C serving + §B rendering rails were built to carry. A new demo node `local.sample.demo.image-emit` stores an image in the host media store and emits a `media.image` event referencing it by tenant-scoped URL (never inlined), so a run now has a `media.image` in its event log + debug bundle, served from `GET /v1/host/sample/assets/{token}`. The builder palette gains the node (static catalog entry); the run-detail event stream renders `media.{image,audio,file}` events inline (thumbnail / audio player / download link, with URL sanitization). New backend test runs the node and asserts the debug bundle carries the media.image by URL + the URL resolves to the PNG — closing the produce → store → serve → debug-bundle loop and giving the §C debug-bundle conformance assertion a real run to activate against. App + sample-host only; no protocol-corpus change. Backend 294 tests pass; frontend build clean.

### RFC 0055 follow-ups — model-capability badge (§A) + debug-bundle media-reference assertion (§C) (2026-05-25)

Closes the two deferred RFC 0055 follow-ups. **§A:** the builder model picker (`ModelPickerInput`) now renders per-model capability pills (📷 Vision / 🛠 Tools / ⌗ Structured) for the selected model from `providers.json`, so a user sees whether the chosen model supports vision before relying on it. **§C:** the debug-bundle `it.todo` in `media-url-inline-cap.test.ts` is replaced by a live capability-gated assertion of RFC 0055 §C rule 3 — a `media.*` payload appearing in a run's debug bundle MUST be a URL reference, never inlined binary; gated on `aiProviders.maxInlineMediaBytes` + `debugBundle.supported`, soft-skips on hosts (incl. the reference host) that don't emit media into runs. App + conformance only; `openwop:check` 9/9. All additive.

### RFC 0055 promoted Draft → Active — multimodal envelope variants (2026-05-25)

Closes RFC 0055 end-to-end on the reference host. §A (capability vocabulary) + §B (`meta.rendering` hint) + §C (`media.{image,audio,file}` kinds + tenant-scoped asset-URL discipline + `media-asset-url-tenant-scoped` invariant) all landed with schemas, conformance, the reference-app chat renderer, and reference-host serving. Promotion basis: the in-memory/sqlite reference host advertises `aiProviders.maxInlineMediaBytes` + `media.{image,audio,file}` in `supportedEnvelopes`/`schemaVersions` and serves tenant-scoped capability-token asset URLs (`GET /v1/host/sample/assets/{token}`), and `media-url-inline-cap.test.ts`'s behavioral store→serve→tenant-scoping assertions are now live (soft-skip offline) — replacing the prior `it.todo`s. `Active → Accepted` awaits a non-steward host advertising the surface per `RFCS/0001`. The `vision-input`/`audio-*` model-capability identifiers are reserved/registered; a host advertises them only when its model supports them (the reference mock model advertises none). Counts: RFC status Active 4 → 5, Draft 8 → 7; `docs/PROTOCOL-STATUS.md` regenerated. All additive.

### `apps/workflow-engine` — persistent artifact cards for HITL decisions + workflow completion (2026-05-25)

App-tier only (no spec / schema / conformance change). The chat thread now retains two artifact cards that were previously lost: a `HitlDecisionCard` that replaces the interactive approval card after the user resolves an interrupt, and a `WorkflowCompletionCard` that appends below the workflow_run bubble on terminal status. Both derive from existing event-log + run state (Option B, no new persistence).

BE seam touched: executor's resume-time event-log write now runs the resumeValue through `sanitizeFreeTextDeep` (new shared `byok/textRedaction.ts`) so HITL `comment` fields carrying pasted upstream keys get scrubbed before persistence — closes a real SR-1-class gap surfaced in the architect review.

PR #159 + immediate followups PR #163 (code-review fixes: Rules of Hooks violation, banned-pattern escapes, memoization tightening) + the UX-review pass on top (modal focus trap + return-focus, inline-SVG status icons replacing Unicode glyphs, color-token replacement of two hard-coded `rgba()` literals, ARIA landmark labels on both card families).

### RFC 0055 §C — media reference payloads (`media.{image,audio,file}`) + asset-URL discipline (2026-05-25)

Third RFC 0055 slice (after §A+§B in #156). Adds three **optional, advertised** envelope kinds — `media.image`, `media.audio`, `media.file` — with per-kind payload schemas (`schemas/envelopes/media.{image,audio,file}.schema.json`: `{ url?, base64?, bytes, mimeType?, … }`, `additionalProperties:false`). **Not** added to the four MUST-recognize universal kinds (that would be breaking) — a host emits/advertises them only if it produces media; consumers that don't recognize them fall back. New `spec/v1/ai-envelope.md` §"Media reference payloads" pins the normative asset-URL discipline: tenant-scoped non-guessable URLs (rule 1), inline base64 only ≤ `capabilities.aiProviders.maxInlineMediaBytes` (new optional field, default 256 KiB; rule 2), debug-bundle by reference (rule 3), asset retention ≥ run-log retention (rule 4). New protocol-tier SECURITY invariant `media-asset-url-tenant-scoped` + always-on conformance scenario `media-url-inline-cap.test.ts` (schema compile + round-trip + advertisement shape; cross-tenant + cap behavioral via `it.todo` pending greenfield host asset-serving). RFC 0055 stays `Draft`; reference-host asset serving + the §A model-picker badge are the remaining slices. Counts synced: scenario files 239 → 240, SECURITY invariants 96 → 97 (protocol 65 → 66); `docs/PROTOCOL-STATUS.md` regenerated. All additive.

### RFC 0056 (run feedback & annotations) — wire + conformance + SECURITY + sample-host implementation (2026-05-25)

Implemented RFC 0056 (**promoted Draft → `Active` 2026-05-25**): `capabilities.feedback` block; `annotation.schema.json` + `annotation-create.schema.json`; `POST/GET /v1/runs/{runId}/annotations` (OpenAPI, `501` when unadvertised); the `run.annotated` AsyncAPI SSE notification — a **side-resource, NOT in the `RunEventType` enum / not replayable** (RFC 0056 §B/§D, the architect-review fix); 7 capability-gated conformance scenarios + `lib/feedback.ts`; 2 protocol-tier SECURITY invariants (`annotation-cross-tenant-isolation`, `annotation-content-redaction`). Spec prose added to `observability.md` (§"Quality signals"), `replay.md`, `debug-bundle.md`, `interrupt.md`. The workflow-engine **sample backend** advertises `capabilities.feedback` and implements the per-run annotation side-store + endpoints + secret-pattern/SR-1 redaction (sqlite + postgres adapters), **activating the reference app's feedback UI on `app.openwop.dev`**. **All three reference SDKs** (TS/Python/Go) gained `createAnnotation`/`listAnnotations` helpers (PARITY 34/34/34). The **in-memory reference host** (`@openwop/openwop-host-in-memory@1.1.3`) now advertises `capabilities.feedback` and implements the annotation side-store + SR-1 redaction — the 7 `feedback-*.test.ts` scenarios pass against it (see `examples/hosts/in-memory/conformance.md`), backing the `Active` promotion. Also fixed the `lib/feedback.ts` `seedRun` helper, which referenced a non-existent `conformance-a` fixture (so the behavioral scenarios soft-skipped everywhere) — it now seeds the canonical `conformance-noop` fixture. All additive.

### RFC 0055 §A + §B — multimodal capability vocabulary + envelope rendering hints (2026-05-25)

First slice of RFC 0055 (multimodal envelope variants). **§A:** registers four reserved `modelCapabilities` identifiers — `vision-input`, `audio-input`, `audio-output`, `image-output` — in the open, pattern-validated prose registry (`capabilities.schema.json` `advertised` description + RFC 0031 §C; **not** an enum, so additive). **§B:** adds an optional `meta.rendering` hint to the `EnvelopeMeta` $def in `ai-envelope.schema.json` (`{ display, mimeType, lang, alt, title }`, `additionalProperties:false`) + a normative `spec/v1/ai-envelope.md` §"Rendering hints" — advisory only, never changes payload validation, unknown values fall back to default rendering. New always-on conformance scenario `envelope-rendering-hint.test.ts` (optionality + closed-enum + additionalProperties:false). RFC 0055 stays `Draft`; §C (`media.*` universal kinds + tenant-scoped asset URLs + `media-asset-url-tenant-scoped` invariant) and the reference-app renderer wiring are follow-up slices. Counts synced: scenario files 238 → 239; `docs/PROTOCOL-STATUS.md` regenerated. All additive.

### `@openwop/openwop-conformance` 1.6.0 → 1.6.1 — fix stale `secrets.scopes` allowlist in `redaction.test.ts` (2026-05-25)

Patch release fixing a self-contradiction MyndHyve surfaced during the 1.6.0 cohort run: `redaction.test.ts:103` hardcoded the `secrets.scopes` allowlist as `['tenant', 'user', 'run']`, but the same release's `capabilities.schema.json` enumerates `["tenant", "user", "run", "workspace"]` (`workspace` is the RFC 0046/0048 sub-tenant scope, additive). A host honestly advertising a `workspace`-scoped secret was wrongly failed. The allowlist now tracks the schema enum; schema + RFC 0046 §A were already canonical, so this is a test-only correction. Three version anchors synced (`conformance/package.json`, `scripts/openwop-check-publish-metadata.sh`, `scripts/check-npm-pack-contents.sh`); `conformance/CHANGELOG.md` [1.6.1] added. Does **not** affect the cohort graduation (the bug is unrelated to any of the 8 RFCs' gates). All additive.

### RFC 0045/0046/0047/0048/0049/0051/0052/0053 promoted Active → Accepted — MyndHyve cohort LIVE on production (2026-05-25)

The 8-RFC MyndHyve protocol-extension cohort graduates `Active → Accepted` on a verified non-steward conformance run, per `RFCS/0001` §"Promotion to Accepted". MyndHyve's `workflow-runtime` advertises all five capability blocks (`credentials`, `oauth`, `authorization`, `scheduling`, `deadLetter`) plus the identity-triple + approval-gate surfaces live on `https://api.myndhyve.ai/.well-known/openwop` (independently curl-verified 2026-05-25), and the published `@openwop/openwop-conformance@1.6.0` suite reports **28 PASS / 0 FAIL** across the cohort.

- **Evidence:** revision `workflow-runtime-00211-69w`, commit `85275cdf87972e02c2e588cba481415f3e0edb15`, suite `@openwop/openwop-conformance@1.6.0`, target `https://api.myndhyve.ai/.well-known/openwop`. Per-RFC adoption write-up in `docs/openwop-adoption/0045-0054-cohort-summary.md`; verified rows added to `INTEROP-MATRIX.md`.
- Each RFC's `Status` flips `Active → Accepted` with the verified evidence in its `Updated` field.
- **RFC 0050 (SAML/SCIM) + 0054 (run-diff) stay `Draft`** — MyndHyve opted out of both; neither contributes to this graduation (0050's synthetic-IdP fixture remains bundled, awaiting any host wiring a SAML ACS; 0054 awaits a time-travel-debug UI).
- **Counts synced:** README RFC-status `Accepted` 37 → 45, `Active` 12 → 4 (Draft 8 + 57 total unchanged); `docs/PROTOCOL-STATUS.md` regenerated; `docs/myndhyve-rfc-adoption-handoff.md` target URL corrected to the bare host. All additive.

### `apps/workflow-engine` — notification system replaces approval inbox (2026-05-25)

App-tier only (no spec / schema / conformance change). The standalone HITL approval `/inbox` becomes one filter of a generalized notification surface modeled on the myndhyve notification system. Backend adds a `notifications` table (Postgres v6 / sqlite v8), REST CRUD + SSE stream at `/v1/notifications`, and emits a notification when a HITL interrupt opens or a run fails. Frontend adds a header bell with unread badge, a right-side `NotificationPanel` drawer, and migrates `/inbox` to filter the notification list by action-needed types (preserving the inline `RenderInterrupt` resolve form).

### RFC 0057 — memory write-attribution event (`memory.written`), Draft (2026-05-25)

Proposes an additive, capability-gated (`memory.attribution`) `memory.written` RunEvent carrying **identifiers only** (`{ memoryRef, memoryId, nodeId?, agentId?, tags? }`, never content), so a consumer can attribute per-node memory provenance on the wire — closing the `agent-memory.md` "which node wrote which entry" gap that the reference app's memory ledger (app-ux §A3) surfaces. Stays `Draft`; the event is content-free (SR-1 trivial) and a recorded fact re-emitted on replay (no new non-determinism). Two SECURITY invariants (`memory-attribution-no-content`, `memory-attribution-tenant-scoped`) + capability-gated conformance scenarios specified for the Active landing. Counts synced: README RFC status 56 → 57 total, `Draft` 7 → 8; `docs/PROTOCOL-STATUS.md` regenerated; `agent-memory.md` §"Open spec gaps" backlinks the RFC. All additive.

### RFC 0045/0046/0047/0048/0049/0051/0052/0053 promoted Draft → Active — MyndHyve cohort adoption (2026-05-25)

8 of the 10 MyndHyve protocol-extension RFCs graduate `Draft → Active` on MyndHyve's non-steward implementation (advertise + behavioral seams shipped per their `docs/openwop-adoption/0045-0054-cohort-summary.md`, 2026-05-25). Each RFC's `Status` flips to `Active` with the adoption evidence in its `Updated` field; wire shapes are now locked for these surfaces per `RFCS/0001`.

- **Active → Accepted is explicitly NOT done here** — it stays gated on the published `@openwop/openwop-conformance@1.6.0` suite (PR #135, release-ready; needs `npm publish`) running against `api.myndhyve.ai/workflow-runtime` and reporting pass, per `RFCS/0001` §"Promotion to Accepted" (this repo graduates on the verified conformance run, not the advance report). The Accepted batch flip + INTEROP-MATRIX advertisement rows land when that green run is reported + verified.
- **RFC 0050 (SAML/SCIM) + 0054 (run-diff) stay `Draft`** — MyndHyve opted out (0050: zero SSO infra/customer pull, though the synthetic-IdP fixture is now bundled; 0054: substrate exists, no UI demand). Narrowed promotion paths recorded in each RFC.
- **Counts synced:** README RFC-status `Active` 4 → 12, `Draft` 15 → 7 (Accepted 37 unchanged; 56 total); `docs/PROTOCOL-STATUS.md` regenerated.

### RFC 0050 — bundled synthetic SAML IdP fixture (closes the deferred conformance gap) (2026-05-25)

Lands the synthetic SAML IdP harness MyndHyve flagged as a graduation blocker for RFC 0050. `conformance/src/lib/saml-idp.ts` (hermetic, `node:crypto` RSA-SHA256, no deps) mints a valid assertion + the six negatives (`alg-none`, `bad-signature`, `unsigned`, `expired`, `not-yet-valid`, `signature-wrapping`); its `verify()` implements the RFC 0050 §A MUST list. `auth-saml-profile.test.ts` now runs the **1-positive + 6-negative reference suite server-free** (a real SAML validation reference), in addition to the existing env-gated host-ACS path. RFC 0050 acceptance updated; the remaining `Active → Accepted` gate is a host wiring its SAML ACS to the `auth/saml/validate` seam. Lands in the unpublished `@openwop/openwop-conformance@1.6.0` (no new scenario file; no version re-bump). All additive.

### `@openwop/openwop-conformance` 1.5.0 → 1.6.0 — ships the RFC 0045–0054 cohort scenarios (2026-05-25)

Cut the conformance suite minor release so adopting hosts can pin a published version carrying the MyndHyve protocol-extension cohort scenarios and report pass for graduation. Triggered by MyndHyve shipping 8 of the 10 RFCs (advertise + behavioral seams) and asking for a pinnable suite. `conformance/package.json` 1.5.0 → 1.6.0; `scripts/openwop-check-publish-metadata.sh` `EXPECTED_CONFORMANCE_VERSION` synced; `conformance/CHANGELOG.md` [1.6.0] enumerates the per-RFC scenarios; `docs/PROTOCOL-STATUS.md` regenerated. The actual `npm publish` is the release-manager step (this lands the release-ready bump). Independent of the SDK version line (still 1.1.x).

### RFC 0053 dead-letter routing & failure sinks — completes the MyndHyve batch (2026-05-25)

A run-level dead-letter sink: a run/node that exhausts its retry policy (RFC 0009) lands in a durable, inspectable sink and stays fork-eligible (RFC 0011), instead of being logged and lost. **Completes the MyndHyve protocol-extension batch (RFCs 0045–0054) on the openwop side.** RFC 0053 stays `Draft`. All additive.

- **Schema:** new top-level `capabilities.deadLetter` block (`supported` / `retentionDays`); new `run.dead_lettered` event (`{ runId, nodeId?, reason, attempts }`) in `run-event-payloads.schema.json` + the `RunEventType` enum.
- **Spec:** `host-capabilities.md` §host.deadLetter — retry-exhaustion → sink + `run.dead_lettered`, fork-eligibility for the retention window, purge after `retentionDays`. Distinct from `queueBus.deadLetterSupported` (transport-level); composes with RFC 0009 retry + RFC 0011 fork.
- **Conformance:** `deadletter-capability-shape.test.ts` (advertisement shape, always runs) + `deadletter-retry-exhaustion.test.ts` (retry-exhaustion → `run.dead_lettered` + fork-eligibility, capability-gated, `POST /v1/host/sample/deadletter/exhaust` seam soft-skips, registered in `host-sample-test-seams.md`). Retention-purge scenario deferred.
- **Counts synced:** conformance scenario files → 229; `RunEventType` variants 70→71; README + conformance README + `coverage.md` updated; `docs/PROTOCOL-STATUS.md` regenerated. (No new schema file, no new invariant.)

### RFC 0043 implemented (Draft) — registry/extension policy now auditable (2026-05-25)

Lands RFC 0043's landable acceptance criteria so the registry, namespace, name-reservation, and IPR policy is auditable today (the RFC stays `Draft`; promotion to `Accepted` is gated on the `GOVERNANCE.md` working-group tripwire — ≥3 orgs + ≥2 non-steward hosts — and is not a code task). `additive` policy text, no wire-shape change.

- **NEW `docs/governance/registry-policy.md`** — one-stop policy index mapping each topic (namespaces, trust tiers, submission, deprecation/yank, key rotation, name reservation, IPR) to its RFC 0043 section + operational reference.
- **Cross-links landed** per RFC 0043 §E: `host-extensions.md` (§A/§C summary footer), `registry-operations.md` (policy-layer header), `RFCS/0038` (WG inherits §B/§C on ratification), `GOVERNANCE.md` §"Path to working group" (RFC 0043 ratification on WG activation), `MAINTAINERS.md` (registry-approver expectation + §B.4 key-rotation dual control).
- RFC 0043 acceptance criteria 1–3 checked; only the comment window + WG ratification remain.

### RFC 0052 scheduling & time-based triggers — Tier-3 step (2026-05-25)

Gives the `schedule` trigger a portable, durable, once-per-tick execution contract — promoting the scheduling intent behind RFC 0017 (`host.queueBus`) into a conformance-tested surface. RFC 0052 stays `Draft`. All additive.

- **Schema:** new top-level `capabilities.scheduling` block (`supported` / `cron` / `delayed` / `calendar` / `maxFutureHorizon`) in `capabilities.schema.json`.
- **Spec:** `host-capabilities.md` §host.scheduling — durable scheduled runs, exactly-once-per-tick firing (composes with `idempotency.md`), `maxFutureHorizon` enforcement, documented missed-tick policy (no backlog flood). Orthogonal to the in-DAG `core.control.delay` primitive (unchanged). New `schedule_horizon_exceeded` error code registered in `rest-endpoints.md`.
- **Conformance:** `scheduling-capability-shape.test.ts` (advertisement shape, always runs) + `scheduling-cron-fires-once.test.ts` (once-per-tick + missed-tick MUST-NOT, capability-gated, `POST /v1/host/sample/scheduling/tick` seam soft-skips, registered in `host-sample-test-seams.md`). Delayed-horizon + calendar scenarios deferred.
- **Counts synced:** conformance scenario files → 227; README + conformance README + `coverage.md` updated; `docs/PROTOCOL-STATUS.md` regenerated. (No new schema file, no new invariant, no new event.)

### RFC 0028 Tier-2 post-promotion T1 + T2 — canonical `workspace_membership_required` envelope + read-side sister scenario (2026-05-25)

Two same-day tightenings landed in response to MyndHyve's green-light relay on the original RFC 0028 Tier-2 workspace-membership invariant. Combined into one commit — shared threat model, shared normative paragraph location, shared conformance-gate pattern.

**T1 — canonicalize `workspace_membership_required` as the 403 envelope error code.**

- `spec/v1/rest-endpoints.md` §"Common error codes" gains a new `workspace_membership_required` entry right after `run_forbidden`. Documents the canonical envelope `{ "error": "workspace_membership_required", "message": "<diagnostic>" }` and the cross-reference to both prompts.md and the conformance invariants.
- `conformance/src/scenarios/prompt-mutation-workspace-membership-enforced.test.ts` strengthened to assert `error === "workspace_membership_required"` ONLY when the host's refusal status is 403. Hosts that refuse with other 4xx/5xx codes (401, 404, 5xx) have their envelope shape unconstrained. Canonical-on-403 is a strengthening, not a forced upgrade — hosts that prefer other status codes remain conformant.

**T2 — read-side sister scenario.**

- `spec/v1/prompts.md` §"Discovery & distribution" §"REST endpoints" §"Workspace membership on workspace-scoped writes" renamed and extended to §"Workspace membership on workspace-scoped reads and writes". Read paths are NOT exempt from the workspace-membership invariant just because they don't write — a `GET /v1/prompts?workspaceId=<not-mine>` that returns another workspace's templates is a cross-tenant data leak with the same blast radius. Added explicit normative coverage of `GET /v1/prompts?workspaceId=`, `GET /v1/prompts/{templateId}` (when workspace is derived), and `POST /v1/prompts:render` (when workspaceId is in the body).
- `conformance/src/scenarios/prompt-read-workspace-membership-enforced.test.ts` (NEW) — gates on `capabilities.prompts.supported: true` (broader than `mutableLibrary` per MyndHyve's preferred Option B gating; read-only hosts that expose `?workspaceId=` aren't exempt from the symmetric authz invariant). Drives `GET /v1/prompts?workspaceId=<random-non-member>` and interprets the response: 4xx PASS with canonical envelope check on 403; 200 with empty `templates[]` PASS as the correct null result for a random nonexistent workspace; 200 with non-empty `templates[]` FAIL as a cross-tenant leak; 200 without `templates[]` field SKIP via response-shape detection (host doesn't expose workspace-scoped reads — out of scope). Self-skipping via response shape avoids inventing a new capability field just for this gating concern.
- NEW protocol-tier SECURITY invariant `prompt-read-workspace-membership-enforced` in `SECURITY/invariants.yaml`, sibling to the existing `prompt-mutation-workspace-membership-enforced` write-side invariant.
- `prompts.md` §"Security invariants" now lists both invariants and points at the normative paragraph for the full text.
- `RFCS/0028` appended §"Post-promotion tightening (2026-05-25, T1 + T2)" documenting both changes + the MyndHyve adoption-note pattern paraphrased from their corrected `routes/prompts.ts` comment block (Admin SDK bypasses Firestore rules; the application-tier membership check is mandatory; same anti-pattern applies to Supabase service-role keys, Convex-equivalent admin clients, raw Postgres with a server-side connection).

**Counts synced:** SECURITY invariants 93 → 94 / protocol-tier 62 → 63 (+1 via `prompt-read-workspace-membership-enforced`); conformance scenario files +1. MyndHyve confirms `workflow-runtime-00208-km5` passes both probes (write + read) with no code changes — both paths already return 403 with `error: "workspace_membership_required"`. No wire-shape change; no RFC status change.

**Honest correction (post-T1+T2, same-day).** MyndHyve's reference-artifact relay that drove T1 claimed the host already emitted the canonical envelope on 403. That claim was incorrect: pre-fix the host emitted the generic `{"error": "forbidden"}` (their `AUTH_CODE_TO_WIRE` mapping translated `WORKSPACE_MEMBERSHIP_DENIED` to the generic `'forbidden'` wire code, shared with other "kinda-forbidden" modes). Surfaced via MyndHyve's own `/code-review`; fixed in their commit `61993c85b` by narrowing `WORKSPACE_MEMBERSHIP_DENIED → 'workspace_membership_required'` (leaving `WORKSPACE_MEMBERSHIP_CHECK_FAILED` as `'forbidden'` for fail-closed-on-infra-error posture); paired with a real memory-leak fix in the GET-side membership middleware, JSDoc correction of the same false-reassurance pattern that drove the original CRITICAL, and a new integration test that mounts the full middleware chain on ephemeral-port Express and asserts the 403 envelope shape directly. **Spec is correct; adopter aligned to it** — T1 stays. RFC 0028 §Post-promotion tightening appendix records the correction loop alongside the existing INTEROP-MATRIX `registerHostSampleRoutes` honest-correction precedent.

### Tier-2 (RFC 0048–0051) code-review follow-ups — gate request-event routing + doc polish (2026-05-25)

Resolves findings from a `/code-review` pass over Tier-2. No wire-shape change.

- **RFC 0051 approval-gate request-event routing corrected.** The gate's *request* now correctly surfaces via the canonical `interrupt.requested` (`kind: 'approval'`) event per `interrupt.md` — not the legacy `approval.requested` (whose `approvalRequested` $def is the back-compat artifact-approval shape). Fixed in `RFCS/0051` (§B, Summary, acceptance, impl note) and a new normative request-event bullet in `interrupt-profiles.md` §approvalGate. The three new outcome events (`approval.granted`/`.rejected`/`.overridden`) are unchanged.
- **AsyncAPI `AnyRunEvent` catch-all** example list now names `authorization.decided` (RFC 0049) + `approval.granted`/`.rejected`/`.overridden` (RFC 0051), matching the `connector.*` precedent (the `RunEventType` enum remains authoritative).
- **`auth.md` §Role-based authorization** — rephrased a descriptive lowercase "may" to avoid RFC 2119 ambiguity.

### RFC 0051 approval & deployment-gate primitive — completes Tier-2 (2026-05-25)

The `core.openwop.governance.approvalGate` node — a first-class, role-gated, audited approval/deploy-gate composing the quorum + auth-required interrupt profiles with RFC 0049 authorization. Completes Tier-2 of the MyndHyve protocol-extension batch on the openwop side. RFC 0051 stays `Draft`. All additive.

- **Schema:** three new governance events — `approval.granted` / `approval.rejected` / `approval.overridden` (the last with a mandatory `reason` audit breadcrumb) — in `run-event-payloads.schema.json` + the `RunEventType` enum. `approval.requested` reuses the existing event.
- **Spec:** `interrupt-profiles.md` §`core.openwop.governance.approvalGate` — node config (`requiredRole`/`requiredScope`, optional `quorum`, role-gated audited `override`, `resumeSchema`) + normative requirements: fail-closed denial (RFC 0049 §C), quorum release, reject-loopback, override emits `approval.overridden` + an audit entry, `400 INVALID_RESUME_VALUE` on malformed resume.
- **Conformance:** `approval-gate-events.test.ts` (server-free event-shape) + `approval-gate-flow.test.ts` (unauthorized-denied + override-audited, capability-gated on `authorization.supported`, `governance/approval-gate` seam soft-skips, registered in `host-sample-test-seams.md`). Grant/reject-loopback/quorum scenarios deferred to a host.
- **No new SECURITY invariant** — fail-closed denial reuses RFC 0049's `authorization-fail-closed`; override-audited is conformance-asserted.
- **Counts synced:** conformance scenario files → 224; `RunEventType` variants 67→70; README + conformance README + `coverage.md` updated; `docs/PROTOCOL-STATUS.md` regenerated.

### Reference-app UX RFC pair 0055 + 0056 filed as `Draft` (2026-05-25)

Two additive, in-charter RFCs authored to unblock reference-app UX work (see [`plans/app-ux-enhancements.md`](plans/app-ux-enhancements.md)) without touching the frozen v1 wire contract. Both flip `Draft → Active → Accepted` only on maintainer promotion + a host wiring the surface + conformance.

- **[`RFCS/0055`](RFCS/0055-multimodal-envelope-variants-and-rendering-hints.md) — multimodal envelope variants & rendering hints.** Promotes RFC 0031 §C's reserved `vision-input` / `audio-input` / `audio-output` / `image-output` model-capability identifiers into a formal closed vocabulary, adds an **optional** `meta.rendering` hint (`display` ∈ markdown/code/card/image/audio/file + `mimeType`/`lang`/`alt`/`title`) on the AI envelope, and a `media.*` URL-reference payload convention (mirrors the existing `ctx.callVideoGenerator` host-served-URL discipline, bounded by `aiProviders.maxInlineMediaBytes`). Lets an LLM node emit images/audio/files/cards that any consumer renders portably. Explicitly **does not** add a real-time A/V/screen/cursor transport (out of charter — media plumbing OpenWOP composes with, not owns). All additive.
- **[`RFCS/0056`](RFCS/0056-run-feedback-and-annotation-event.md) — run feedback & annotation event.** New optional `host.feedback` capability, additive `run.annotated` RunEvent + `annotation.schema.json`, and capability-gated `POST/GET /v1/runs/{runId}/annotations` for a portable, non-blocking human/agent quality signal (rating / correction / label / flag) bound to a run, event, or node. Distinct from `interrupt` (non-blocking, post-terminal-eligible). Feeds analytics (correction-rate / mean-rating), the HITL inbox, and replay; survives debug-bundle export; not copied into a fork. Adds two protocol-tier SECURITY invariants (`annotation-cross-tenant-isolation`, `annotation-content-redaction`). All additive.
- **Doc surfaces synced:** README RFC-status paragraph (54 → 56 RFCs excluding template; Draft 13 → 15), `docs/PROTOCOL-STATUS.md` regenerated via `npm run protocol:status`.

### RFC 0050 SAML / SCIM enterprise identity profiles — Tier-2 step 3 (2026-05-25)

Adds two entries to the auth-profile family (extends RFC 0010), mapping enterprise IdP users/groups onto RFC 0048 principals + RFC 0049 roles. RFC 0050 stays `Draft`. All additive (conditional profiles).

- **Spec:** `auth-profiles.md` gains `openwop-auth-saml` (XML-DSig assertion validation, `alg:none` + signature-wrapping rejection mirroring the OIDC work, validity-window enforcement, attribute→principal mapping), `openwop-auth-scim` (SCIM 2.0 `/Users` + `/Groups` → principal/role upserts; deactivate ⇒ fail-closed deny composing with RFC 0049), and optional `openwop-auth-ldap` (directory-bind variant). The three profile ids are reserved in the `capabilities.auth.profiles` schema description.
- **Conformance:** `auth-saml-profile.test.ts` + `auth-scim-profile.test.ts` — profile-advertisement shape always; behavioral assertion-validation / provisioning opt-in via `OPENWOP_TEST_SAML_IDP_URL` / `OPENWOP_TEST_SCIM_URL` + the `auth/saml/validate` + `auth/scim/provision` seams (registered in `host-sample-test-seams.md` §"Open seams"). Mirrors the `auth-mtls` opt-in precedent; the full SAML 1-positive-+-6-negatives suite + a bundled synthetic-IdP XML-DSig harness are deferred (the same gap RFC 0010's OIDC profile noted).
- **Counts synced:** conformance scenario files → 222; README + conformance README + `coverage.md` updated; `docs/PROTOCOL-STATUS.md` regenerated. (No new schema file, no new invariant, no new event.)

### RFC 0028 Tier-2 follow-up — workspace-membership-enforcement normative + SECURITY invariant (2026-05-25)

Closes a spec gap surfaced by a self-disclosed adopter vulnerability landed within hours of the RFC 0028 promotion. The MyndHyve workflow-runtime's `POST`/`PUT`/`DELETE /v1/prompts*` handlers on revision `00207-vzq` accepted an arbitrary `workspaceId` from the request body and wrote via the Firebase Admin SDK — which bypasses Firestore security rules — letting any authenticated user insert a user-template into a workspace they don't belong to (live window: ~2 hours; hotfixed by MyndHyve commit `26aa0a191`, revision `workflow-runtime-00208-km5`). The wire shape was unchanged before/after the hotfix, so the RFC 0028 promotion still stands.

The underlying openwop spec gap: `prompts.md` §"Discovery & distribution" §"Authorization" originally said only "Hosts SHOULD scope by writer role; the spec defers role-mapping to host policy" — implicit on the workspace-membership-on-writes contract. The MyndHyve adopter pattern (Admin-SDK writes bypass DB-tier auth while caller-supplied `workspaceId` is trusted) is common across Firebase / Supabase / RLS-style stacks; the spec MUST belongs at the application tier, not in the database vendor's rules. Closed by:

- **`spec/v1/prompts.md` §"Discovery & distribution" §"REST endpoints" §"Workspace membership on workspace-scoped writes"** — NEW normative paragraph requiring hosts to verify the authenticated principal's workspace membership BEFORE honoring any mutating write, with explicit language that hosts persisting via a database vendor's privileged admin client MUST replicate the membership check at the application tier rather than relying on the vendor's row-level security rules. Cross-references `auth.md` §"Identity claims" and RFC 0048 §D.
- **`SECURITY/invariants.yaml`** — NEW protocol-tier invariant `prompt-mutation-workspace-membership-enforced` (severity: high). Cross-listed in `prompts.md` §"Security invariants" alongside the existing `prompt-composed-*` invariants.
- **`conformance/src/scenarios/prompt-mutation-workspace-membership-enforced.test.ts`** (NEW) — capability-gated on `capabilities.prompts.mutableLibrary: true`. Probe drives `POST /v1/prompts` with a cryptographically-random non-member `workspaceId` and asserts the host refuses (any 4xx/5xx is acceptable; 2xx silent success is the failure mode). Operator override via `OPENWOP_TEST_NONMEMBER_WORKSPACE_ID`.
- **`RFCS/0028`** — appended §"Post-promotion notes (2026-05-25)" documenting the adopter disclosure, the openwop spec sharpening that followed, and the new invariant.

**Counts synced:** SECURITY invariants 92 → 93 / protocol-tier 61 → 62 (+1 via `prompt-mutation-workspace-membership-enforced`). Conformance scenario files +1 (the new probe). No wire-shape change; no RFC status change.

### RFC 0028 promoted Active → Accepted — Tier-2 prompt-pack advertise live on MyndHyve (2026-05-25)

MyndHyve workflow-runtime advertises `capabilities.prompts.{supported: true, templateKinds: ["system", "user", "few-shot", "schema-hint"], observability: "full", packsSupported: true, mutableLibrary: true, library: {id: "myndhyve-system", renderEndpoint: "/v1/prompts:render", maxRenderRequestBytes: 65536}}` live on `https://myndhyve.ai/.well-known/openwop` (verified 2026-05-25 via direct curl).

The README RFC index path-to-Accepted criterion for RFC 0028 — "MyndHyve Tier-1 advertises `packsSupported: false, mutableLibrary: false`; path-to-Accepted requires both `true`" — is satisfied at the wire. A parallel session on the openwop side shipped the host-side `kind: "prompt"` pack ingest + `packsSupported: true` advertise + the real `library` block end-to-end during the same conformance window that closed RFC 0041.

Per the bootstrap-phase rule (advertisement + scenarios pass-modulo-honest-skip), the Tier-2 path-to-Accepted bar is met. RFC 0029 stays Active — MyndHyve's discovery still shows `agents: {}` (empty) and no `prompts.agentBindings`; promotion gates on a future `agentBindings: true` signal once the host-side agent identity work ships.

Same docs-sync pass folds in **RFC 0049's SECURITY invariant addition** that landed upstream while my RFC 0041 promotion commit was rebasing: 91 invariants → 92 / 60 protocol-tier → 61 / +1 line for `authorization-fail-closed` — these were dropped from the README by my `--theirs` resolution during the second rebase and are reinstated here.

Counts: **RFCs Accepted 36 → 37; Active 5 → 4.**

### RFC 0049 RBAC scopes & authorization decisions — Tier-2 step 2 (2026-05-25)

Binds the RFC 0048 `principal`'s role to scopes (reusing the API-key scope grammar) and makes authorization decisions observable, auditable, and conformance-testable — including a normative fail-closed default. RFC 0049 stays `Draft`. All additive.

- **Schema:** new top-level `capabilities.authorization` block (`supported` / `failClosed` const-true / `roles: [{ role, scopes[] }]`) in `capabilities.schema.json`; new `authorization.decided` event (`{ principal, action, resource, allowed, reason }`) in `run-event-payloads.schema.json` + the `RunEventType` enum (`run-event.schema.json`).
- **Spec:** `auth.md` §"Role-based authorization (RFC 0049)" — role→scope binding reusing the API-key scope-match semantics, the fail-closed MUST (absent/unseeded role ⇒ deny; never default-allow), and the redaction-safe `authorization.decided` event feeding the RFC 0009/0010 audit log.
- **SECURITY:** new protocol-tier invariant `authorization-fail-closed`.
- **Conformance:** `authorization-roles-shape.test.ts` (advertisement shape, always runs) + `authorization-fail-closed.test.ts` (fail-closed MUST-NOT, capability-gated, `POST /v1/host/sample/authorization/decide` seam soft-skips). Scope-match + denial-audited scenarios deferred to a host. The `POST /v1/host/sample/authorization/decide` seam is registered in `host-sample-test-seams.md` §"Open seams".
- **Counts synced:** invariants 91→92 / protocol-tier 60→61, conformance scenario files 218→220, `RunEventType` variants 66→67; `PROTOCOL-STATUS.md` regenerated; README + conformance README + `coverage.md` updated.

### RFC 0046/0047/0048 code-review follow-ups — test-seam registry + principal opacity (2026-05-25)

Resolves findings from a `/code-review` pass over RFC 0048 (and the Tier-1 seams). No wire-shape change.

- **Test seams registered in `host-sample-test-seams.md` §"Open seams".** The conformance seams introduced this session — `credentials/echo` (RFC 0046), `oauth/connector-echo` (RFC 0047), `identity/owned-run` + `identity/cross-workspace-read` (RFC 0048) — are now documented in the normative `/v1/host/sample/*` seam registry (each with its contract + gating capability + the scenario it unblocks), matching the RFC 0039 memory-seam precedent. Previously they lived only in scenario docstrings + `coverage.md`.
- **`owner.principal` opacity is now normative.** `auth.md` §"Identity claims" gains an "Identifier opacity (normative)" rule: because `RunSnapshot.owner` is echoed on `run.started` (SSE/webhooks/debug bundles) un-redacted, hosts MUST use an opaque, non-PII identifier for `principal` (SHOULD for `tenant`/`workspace`). Previously advisory prose.
### RFC 0054 implemented — run-diff endpoint `GET /v1/runs/{runId}:diff` lands (2026-05-25)

Implements the spec + reference-host + SDK + conformance surface for RFC 0054 (`Draft`): a read-only, deterministic, replay-aware structured diff of two runs (typically a run and its `:fork`), the protocol surface behind run-vs-fork comparison. All additive.

- **Schema:** new `schemas/run-diff-response.schema.json` (`{ a, b, divergedAtSeq, eventDiffs[], stateDiff, truncated? }`), indexed in `schemas/README.md`.
- **Spec + OpenAPI:** `rest-endpoints.md` Runs-table row + a normative subsection pinning the pure-function determinism contract to `replay.md`, the both-runs `runs:read` authz, and the OPTIONAL 404-when-unimplemented rule; additive `GET :diff` path in `api/openapi.yaml` (required `against` query param; 400/401/403/404).
- **SDK (TS):** `client.runs.diff(runId, against)` + `RunDiffResponse` / `RunDiffEventDiff` types.
- **Reference host:** `GET /v1/runs/{runId}:diff` on the workflow-engine sample — regex-pinned (registered before the generic `:runId` GET), canonical-comparison diff excluding non-deterministic transport metadata; `forbidden` (not the RFC text's non-canonical `run_forbidden`) on missing read.
- **Conformance:** `run-diff.test.ts` — self-diff (determinism floor), two-fixture divergence, response-shape + redaction-safety, `400`/`404` error surface; soft-skips on 404. All four pass against the reference host.
- **Counts synced:** JSON Schemas 33→34, OpenAPI operations 30→31, conformance scenario files 217→218; `docs/PROTOCOL-STATUS.md` regenerated.

### RFC 0025 implemented — Test-mode registry namespace `/v1/packs-test/*` lands (2026-05-25)

**Closes the 26-`it.todo()` gap in `conformance/src/scenarios/pack-registry-publish.test.ts`** without requiring the conformance suite to obtain `packs:publish` scope on the real registry. Per RFC 0025 (`Draft`, comment window 2026-05-19 → 2026-05-26):

- **Capability flag** (`schemas/capabilities.schema.json`). New optional `packs.testMode` block with `supported` (required) + `isolated` (RFC 0025 §C guarantee) + `catalogResetEndpoint` (RFC 0025 §C point 4) + `scopes` (per-namespace acceptance set). Block sits next to `workflowChainPacks` to group pack-related capability blocks.
- **Spec prose** (`spec/v1/node-packs.md`). New §"Test-mode registry namespace" between `GET /v1/packs/-/search` and "Optional registry endpoints" — declares the four mirrored endpoints, names the four §C isolation guarantees as MUSTs, points at the reference impl path.
- **OpenAPI surface** (`api/openapi.yaml`). Four new endpoints under the new `packs-test` tag: `PUT/GET/DELETE /v1/packs-test/{name}/-/{version}.tgz` + `GET /v1/packs-test/{name}/-/{version}.sig`. PUT enumerates all 19 publish error codes verbatim. New `TestPackPublishRecord` schema + `PackName`/`PackVersion` parameter components for reuse.
- **Reference impl** (`apps/workflow-engine/backend/typescript/src/routes/packs-test.ts`). In-memory isolated `Map<(name, version), record>`, env-gated on `OPENWOP_PACKS_TEST_NAMESPACE_ENABLED=true`. Validation pipeline runs URL → body-shape → gzip-magic → decompress-cap → tar-parse → manifest → integrity → conflict, first-failing-check-wins. Emits 17 of the 19 documented publish error codes (the two granular-pair codes ride alongside the aggregate `manifest_mismatch`). Idempotent re-publish returns 200; conflicting re-publish returns 409. `POST /v1/packs-test/reset` clears the catalog for suite teardown.
- **Discovery wiring** (`apps/workflow-engine/backend/typescript/src/routes/discovery.ts`). Advertises `capabilities.packs.testMode` only when the env-gate is set, matching the RFC 0034 `testSeams` pattern — a conformance suite that sees the advertisement is guaranteed to find serving endpoints.
- **OpenwopError code surface** (`apps/workflow-engine/backend/typescript/src/types.ts`). Adds 17 new pack-registry error codes (`invalid_pack_scope`, `invalid_body`, eight `tarball_*`, `invalid_manifest`, `manifest_mismatch` + granular pair, `pack_integrity_failure`, `unsupported_runtime`, `conflict`, `version_conflict`, `unpublish_window_expired`) to the union.
- **Conformance driver enhancement** (`conformance/src/lib/driver.ts`). `Buffer` / `Uint8Array` bodies are now sent as raw bytes rather than JSON-stringified — the test file's own `// Body is JSON-stringified by default...the impl PR will likely extend the driver with an octet-stream variant` note was a forward-reference to this PR. JSON object bodies still JSON-stringify by default.
- **Status flip.** RFC 0025 promoted `Draft → Active` — the implementation has landed inside the 7-day comment window with no objections raised on the working-group thread; the gate's spec-prose / schema / OpenAPI / impl / conformance / CHANGELOG criteria are all met.

The 26 scenarios in `pack-registry-publish.test.ts` were already authored as behavioral assertions that soft-skip when `capabilities.packs.testMode.supported !== true` (see the `BEHAVIORAL (soft-skip)` header on the file). With this RFC implemented, the assertions execute against the reference impl when `OPENWOP_PACKS_TEST_NAMESPACE_ENABLED=true` is set; hosts that haven't implemented the mirror still soft-skip cleanly.

### RFC 0048 tenant·workspace·principal identity model — opens Tier-2 (2026-05-25)

First step of Tier-2 (multi-tenant identity & governance); foundation for RFC 0049/0050/0051. Promotes the existing tenant dimension to an explicit `{ tenant, workspace?, principal }` triple threading run ownership + discovery + events. Builds on RFC 0011. RFC 0048 stays `Draft`. All additive.

- **Schema:** optional `owner` triple (`{ tenant (required), workspace?, principal? }`) on `RunSnapshot` (`run-snapshot.schema.json`), echoed redaction-safe on the `run.started` event payload (`run-event-payloads.schema.json`). `principal` is an opaque id, never PII.
- **Spec:** `auth.md` §"Identity claims — tenant · workspace · principal" — the three optional auth-context claims, run-ownership recording, workspace isolation (a `principal` in workspace A MUST NOT read workspace B's run — fail-closed `run_forbidden`), and workspace-scoped discovery extending RFC 0011's tenant-narrowing (reuses `capabilities.discovery.authScoped`).
- **Error code:** `run_forbidden` registered in `rest-endpoints.md` (cross-workspace isolation, fail-closed, no existence leak).
- **Conformance:** `identity-owner-shape.test.ts` (server-free owner-triple schema validity) + `cross-workspace-isolation.test.ts` (§D isolation MUST-NOT via the `cross-workspace-read` seam, capability-gated/soft-skip). Workspace-scoped-discovery + behavioral ownership-echo scenarios deferred to a host.
- **Counts synced:** conformance scenario files 215→217; README + conformance README + `coverage.md` updated; `docs/PROTOCOL-STATUS.md` regenerated. (No new schema file; no new invariant — isolation is conformance-asserted per the RFC's acceptance criteria.)

### RFC 0045/0046/0047 code-review follow-ups — spec-coherence cleanup (2026-05-25)

Resolves findings from a senior code-review pass over the Tier-1 batch. No wire-shape change; editorial + registry completeness.

- **RFC 0046 + 0047 §A reconciled to the implemented wire path.** The §A schema diffs + normative MUST clauses showed the capability nested under a `host` key (`host.credentials.supported` / `host.oauth.supported`); the implemented and authoritative path is **top-level `capabilities.credentials` / `capabilities.oauth`** (matching `fs` / `queueBus`). Added a wire-path note to each §A and corrected the field-path references. The `§host.*` prose name is unchanged.
- **Error codes registered in `rest-endpoints.md`.** Added `credential_not_found`, `credential_scope_unsupported`, `oauth_provider_unsupported`, `oauth_scope_unsupported`, `connector_auth_expired` (RFC 0047), `connector_action_unresolved` (RFC 0045); extended `credential_forbidden` + `credential_unavailable` to cover the RFC 0046 `capabilities.credentials` surface.
- **AsyncAPI `AnyRunEvent` catch-all** now names `connector.authorized` / `connector.auth_expired` and clarifies the named messages are a curated `updates`-tier subset (the `RunEventType` enum remains authoritative/exhaustive).
- **`connector-manifest-validity.test.ts`** `describe()` blocks aligned to the `category:` server-free convention.

### RFC 0045 connector pack manifest — completes Tier-1 of the MyndHyve protocol-extension batch (2026-05-25)

Third and final step of the Tier-1 critical path (depends on RFC 0046 + 0047, both on `main`). Lands the optional `connector` manifest block — the n8n/Make-style *trigger + action + auth + pagination* bundle, expressed manifest-first. This is the leverage point: it lets MyndHyve re-emit its 38 host-locked `vendor.myndhyve.*` integration packs as portable, registry-installable connectors. RFC 0045 stays `Draft`. All additive (optional block; packs without it are unchanged plain node packs).

- **Schema:** optional top-level `connector` block + `Connector` / `ConnectorAuth` $defs in `node-pack-manifest.schema.json`. A connector declares `{ id, displayName, auth, actions: [{ typeId, displayName, idempotent?, rateLimit?, paginated? }], triggers: [] }`. `ConnectorAuth` is a `oneOf` over the RFC 0047 OAuth2 `NodeAuth` and an RFC 0046 `{ type: 'credential', key, scope? }` stored-credential reference.
- **Spec:** `node-packs.md` §Connectors — action contract (actions are existing nodes annotated with scheduler hints; every `actions[].typeId` + `triggers[]` MUST resolve to a `nodes[].typeId`, else `connector_action_unresolved`), idempotency/rate-limit hint semantics, auth + capability gating, registry discovery facet.
- **Conformance:** `connector-manifest-validity.test.ts` (server-free, always runs) — §A schema validity of the `connector` block (both ConnectorAuth variants, positive + negatives) + §B action/trigger typeId-resolution semantics. Behavioral idempotency-hint + rate-limit scenarios + a synthetic connector fixture deferred until a host advertises a connector.
- **Counts synced:** conformance scenario files 214→215; README + conformance README + `coverage.md` updated; `docs/PROTOCOL-STATUS.md` regenerated. (No new schema file, no new invariant.)

**Tier 1 complete on the openwop side:** `host.credentials` (0046) + `host.oauth` (0047) + connector manifest (0045) now give a host the full portable contract; `Accepted` for each is gated on MyndHyve wiring the implementation.

### RFC 0041 promoted Active → Accepted — Phase 4 replay determinism live on MyndHyve; multi-agent execution model roadmap (Phases 1-4) now closed end-to-end on a non-steward host (2026-05-25)

**Milestone — multi-agent execution model Phases 1+2+3+4 now Accepted end-to-end on a non-steward host.** MyndHyve workflow-runtime advertises `multiAgent.executionModel.{version: 4, replayDeterminism: {supported: true, llmCacheKeyRecipe: "spec-rfc-0041", refusalDivergenceEmission: true}}` live on `https://myndhyve.ai/.well-known/openwop` (verified 2026-05-25 via direct curl).

The §C Tier-2 Firestore-backed observable-result cache + the §D advertise land together in MyndHyve commit `708753e7`:

- **§C Tier-2 — Firestore-backed observable-result cache.** `services/workflow-runtime/src/firestoreObservableResultCache.ts` (NEW) keys workspace-scoped Firestore docs at `workspaces/{wsId}/observableResultCache/{runId}__{nodeId}__{attempt}__{cacheKeyHash}`. Cross-tenant isolation enforced by path + defense-in-depth `workspaceId` field check on read. Firestore TTL policy on `expiresAt` + read-time stale-check for not-yet-swept docs. Read failures fail-safe to provider call; write failures logged at warn (user sees successful stream). Pluggable backend interface; `OBSERVABLE_RESULT_CACHE_BACKEND` env selects backend (default in-memory; `'firestore'` selects the Tier-2 backend).
- **§B emission wired (carried from `08125ad`).** `serverCallAI.ts:checkRefusalDivergence(kind)` runs BEFORE both terminal yields; on divergence emits `replay.divergedAtRefusal` event with the full §B payload + yields the `REPLAY_DIVERGED_AT_REFUSAL:` structured error in place of the original terminal.
- **§D advertise gated on env var.** Production deploys WITHOUT the env var honestly stay at `version: 3` + omit `replayDeterminism`. Same honest-advertise discipline that drove the previous staged rollouts.
- **Staged rollout, verified end-to-end.** Code deployed at `workflow-runtime-00205-2pc` (advertise stayed `version: 3`); env var flipped via `gcloud run services update --update-env-vars OBSERVABLE_RESULT_CACHE_BACKEND=firestore`; new revision `workflow-runtime-00206-tdh` advertises the full §D block. `version: 4` is the final ladder rung on `multiAgent.executionModel`; all four phases live in production.

**Conformance posture under the bootstrap-phase rule (advertisement + scenarios pass-modulo-honest-skip):**

| Scenario | Was | Now |
|---|---|---|
| `replay-divergence-at-refusal.test.ts` advertisement-shape probe | SKIP (block absent) | **PASS** (block present, three required fields verified) |
| `replay-llm-cache-key.test.ts` recipe correctness (5 behavioral) | PASS conditional on env-gate | **PASS** against live MyndHyve target (host-sample seam reachable post-`60b569de` wire-up) |
| `replay-llm-cache-key-portable.test.ts` non-recipe-field invariance | PASS conditional | **PASS** (same) |

The §B refusal-divergence BEHAVIORAL probe (the cross-revision driver that constructs a source run + drives a replay against a deployed host) remains an upstream `it.todo` on the openwop suite side — it has not been authored. MyndHyve's `serverCallAI.ts:checkRefusalDivergence` wiring is implementation-ready and will exercise the driver when it lands.

**Phase 1-4 roadmap rung-by-rung — each `version: N` advertised honestly with the spec contract honored in production:**

| Version | Phase | RFC | Honored by |
|---|---|---|---|
| 1 | Phase 1 — handoff state machine | RFC 0037 | `core.workflowChain.event` emission from `dispatch.node.ts` |
| 2 | Phase 2 — confidence escalation | RFC 0039 §A | `confidenceEscalationFloor: 0.5` + `core.workflowChain.confidence-escalated` emission |
| 3 | Phase 3 — cross-host causation | RFC 0040 | `ServerHttpClientAdapter.fetch` outbound `traceparent` + `GET /v1/runs/:runId/ancestry` + sqlite-host MCP peer at `/v1/mcp/invoke-node` |
| 4 | Phase 4 — replay determinism | RFC 0041 | §A cache-key recipe + §B refusal-divergence detection/emission/structured-error-code + §C Firestore-backed cross-instance cache + §D advertise |

Counts: **RFCs Accepted 35 → 36; Active 6 → 5** (this commit; per-commit delta after upstream's RFC 0025 Draft → Active landed in the same `[1.1.4 — unreleased]` block).

### RFC 0047 `host.oauth` — spec + schema + connector events + shape/redaction conformance landed (2026-05-25)

Second step on the Tier-1 critical path (depends on RFC 0046, already on `main`). Lands the openwop-side `host.oauth` contract: the host performs the OAuth 2.0 authorization-code + refresh dance on a user's behalf for connector nodes, stores the token as a `host.credentials` entry, and resolves it into the node sandbox as a bearer token. RFC 0047 stays `Draft`. All additive.

- **Schema:** new top-level `capabilities.oauth` block (`supported` / `grants` / `providers[]`); new `NodeAuth` $def + node-level `auth: { type: 'oauth2', provider, scopes[] }` in `node-pack-manifest.schema.json`; two additive redaction-safe events `connector.authorized` / `connector.auth_expired` in `run-event-payloads.schema.json` (carry the credential reference, never token material).
- **Spec:** `auth.md` Open-spec-gap row **A5** flipped to closed (authorization-code is now `host.oauth`, distinct from A1 client-credentials = host auth); `host-capabilities.md` §host.oauth — token lifecycle (host-side dance + transparent refresh), connector-auth declaration, redaction-safe events, advertisement shape.
- **SECURITY:** no new invariant — OAuth tokens are stored as `host.credentials` entries, so token redaction is covered by the existing RFC 0046 `credential-payload-redaction` invariant (whose note already names the host.oauth flow).
- **Conformance:** `oauth-capability-shape.test.ts` (advertisement shape, always runs) + `oauth-connector-redaction.test.ts` (token-material redaction, capability-gated, `POST /v1/host/sample/oauth/connector-echo` seam soft-skips on 404). Authcode-roundtrip + refresh scenarios deferred until a host wires the seam.
- **Counts synced:** conformance scenario files 212→214; README + conformance README + `coverage.md` updated; `docs/PROTOCOL-STATUS.md` regenerated. (Invariants + schema-file counts unchanged.)

### RFC 0046 `host.credentials` — spec + schema + SECURITY invariant + shape/redaction conformance landed (2026-05-24)

First implementation pass on the Tier-1 critical path of the MyndHyve protocol-extension batch (RFCs 0045–0054). RFC 0046 stays `Draft`; this lands the openwop-side contract so a host can implement against it (`Active`/`Accepted` follow maintainer promotion + a non-steward host wiring the vault). All additive.

- **Schema:** new top-level `capabilities.credentials` block (`supported` / `scopes` / `encryptionAtRest` / `rotation` / `sharing`) in `schemas/capabilities.schema.json`; `workspace` appended to the `secrets.scopes` enum (additive). New `schemas/credential-reference.schema.json` (the opaque `{ ref, scope }` wire shape — never the secret). New `CredentialRequirement` $def + node-level `requiredCredentials[]` in `schemas/node-pack-manifest.schema.json`.
- **Spec:** `spec/v1/host-capabilities.md` §host.credentials — resolution contract (sandbox-only injection, fail-closed `credential_forbidden`), two-key-overlap rotation, relationship to `§host.secrets`, advertisement shape.
- **SECURITY:** new protocol-tier invariant `credential-payload-redaction` (sibling to `mcp-toolcall-payload-redaction`) — resolved material MUST NOT appear in inputs, variables, channels, events, debug bundle, or replay state.
- **Conformance:** `credentials-capability-shape.test.ts` (advertisement shape, always runs) + `credential-payload-redaction.test.ts` (adversarial redaction, capability-gated, `POST /v1/host/sample/credentials/echo` seam soft-skips on 404 — mirrors `fs-path-traversal`). Resolve-roundtrip + rotation-overlap scenarios deferred until a host wires the seam.
- **Counts synced:** README invariants 90→91 / protocol-tier 59→60, JSON Schemas 32→33, conformance scenario files 210→212; `docs/PROTOCOL-STATUS.md` regenerated; `coverage.md` gains two rows.

### RFC 0040 promoted Active → Accepted — `version: 3` cross-host causation live on MyndHyve (2026-05-24)

**Milestone — multi-agent execution model Phases 1+2+3 now Accepted end-to-end on a non-steward host.** MyndHyve workflow-runtime advertises `multiAgent.executionModel.{version: 3, crossHostCausation: {supported: true, hostId: 'myndhyve', ancestryEndpointSupported: true}}` live on `https://api.myndhyve.ai/.well-known/openwop` (verified 2026-05-24 via direct curl).

Two coordinated MyndHyve commits land the full Phase 3 surface:

1. **`f281549f` (Cloud Run revision `workflow-runtime-00198-q48`)** — Sessions 5c+5d+5e close-out: sqlite-reference-host MCP peer with distinct `hostId: 'sqlite-reference'` (closes the self-loop tautology that would otherwise have MyndHyve calling itself); `core.conformance.mcp-invoke` conformance node; `version: 3` discovery advertise; outbound `traceparent` injection on every outbound HTTP through `ServerHttpClientAdapter.fetch` (single injection point covers AI provider calls, webhook deliveries, conformance test seams, MCP outbound — closes calling-side §B contract everywhere at once).

2. **`dcf259b1` (revision `00199-4lk`)** — RFC 0041 §C observable-result cache Tier-1 (in-memory, workspace-first-keyed: `workspaceId|runId|nodeId|attempt|llmCacheKey`). 26 unit tests pin the cross-tenant isolation invariant.

**Conformance evidence per MyndHyve's report:**
- `cross-host-causation-shape.test.ts` — PASS (advertises `version: 3` + `crossHostCausation` block; scenario reads + validates shape).
- `cross-host-ancestry-endpoint.test.ts` — PASS. `GET /v1/runs/{runId}/ancestry` endpoint is registered (returns JSON `{"error":"Not found"}` for unknown runId — distinct from bare 404 it returned pre-`f281549f`).
- `cross-host-traceparent-propagation.test.ts` — stays `it.todo` upstream. MyndHyve calling-side + sqlite-reference-host receiving-side both ready; waiting on the cross-host harness driver landing on the openwop side.

Per the bootstrap-phase rule (advertisement + scenarios pass-modulo-honest-skip), the path-to-Accepted bar is met.

**RFC 0041 stays Active.** MyndHyve's §C observable-result cache Tier-1 is live but the `replayDeterminism` capability block stays honestly absent from discovery — §B refusal-divergence emission is missing (engine-side replay-execution path detection deferred to avoid parallel-session collision with `560cfc89`'s `canonicalRuns.ts` work). MyndHyve's honest-capability-advertisement discipline: advertise only what's fully honored. The Tier-2 Firestore-backed cache (cross-instance replay determinism) is also a separate strengthening tier.

**16 scenario flips on MyndHyve's side** (per their report — SKIP-on-404 → PASS after the `60b569de` `registerHostSampleRoutes` wire-up + `f281549f` cross-host surface):

| Scenario | Was | Now |
|---|---|---|
| `prompt-list.test.ts`, `prompt-render-secret-redaction.test.ts`, `prompt-render-trust-marker.test.ts`, `prompt-resolution-chain.test.ts` | SKIP | PASS |
| `ai-envelope-shape.test.ts` (behavioral), 6 `aiEnvelope.*.test.ts` scenarios (universalKinds, contractRefusal, capBreached, redaction, schemaDrift, trustBoundaryPropagation, correlationReplay) | SKIP on 404 | PASS |
| `otel-scrape-seam-shape.test.ts` | n/a | PASS (200 + `{spans:[]}`) |
| `envelope-reasoning-secret-redaction.test.ts` | n/a | PASS vacuously safe (Tier-1 boundary per RFC 0034 §B) |
| `cross-host-causation-shape.test.ts` | SKIP (block absent) | PASS (`version: 3` + `crossHostCausation`) |
| `cross-host-ancestry-endpoint.test.ts` | SKIP | PASS |
| `mcp-tool-roundtrip.test.ts` | SKIP | PASS when `OPENWOP_MCP_REAL_SERVER_URL` points at sqlite-host |

**Notable architectural finds from MyndHyve's session:**
1. RFC 0040 §B closing at `ServerHttpClientAdapter.fetch` — single injection point covers all outbound HTTP. Calling-side §B contract closed everywhere at once.
2. sqlite-reference-host as cross-host test peer — distinct `hostId: 'sqlite-reference'` closes the self-loop tautology where MyndHyve would otherwise call itself.
3. Observable-result cache is workspace-first keyed — `workspaceId|runId|nodeId|attempt|llmCacheKey` encoding makes tenant boundary lexically obvious in logs.
4. Honest capability discipline — `replayDeterminism` block stays absent on discovery despite §C cache being live, because §B emission missing means the host doesn't honor the full §D contract yet.

**Updates landed in this commit:**
- `RFCS/0040-multi-agent-cross-host-causation.md` Status: `Active → Accepted`. 9 of 10 acceptance-criteria items `[ ] → [x]` (remaining: `spec/v1/mcp-integration.md` + `spec/v1/a2a-integration.md` tracecontext cross-link prose — documentation strengthening, not a gate-blocker).
- `INTEROP-MATRIX.md` header date note rewritten to describe the RFC 0040 promotion as the headline.
- `README.md` Accepted (34 → 35 — adds 0040); Active (6 → 5).

### MyndHyve protocol-extension RFC batch 0045–0054 filed as `Draft` (2026-05-24)

Authored ten new RFCs that let MyndHyve (an OpenWOP host) express product surfaces — connectors, the workspace credential vault, OAuth, workspace/RBAC scoping, CMS approval gates, scheduled routines — *through the protocol* rather than as host-private code no other host can interoperate with. All are **additive** to the frozen v1 wire contract (new optional capabilities / events / endpoints / schemas, advertised via `/.well-known/openwop` and skipped by hosts that don't implement them); per each RFC's cross-cutting principles they flip `Draft → Active → Accepted` only as maintainers accept them and a non-steward host lands the implementation + conformance. Source plan: [`plans/myndhyve-protocol-extension-rfcs.md`](plans/myndhyve-protocol-extension-rfcs.md).

- **Tier 1 — connectors & credentials (critical path):** [`RFCS/0046`](RFCS/0046-host-credentials-capability.md) `host.credentials` (portable credential resolution + lifecycle: store-at-rest, workspace sharing, two-key-overlap rotation, new `credential-payload-redaction` SECURITY invariant); [`RFCS/0047`](RFCS/0047-host-oauth-connector-flows.md) `host.oauth` (host-performed authorization-code + refresh, tokens stored as 0046 credentials, closes the `auth.md` authorization-code gap); [`RFCS/0045`](RFCS/0045-connector-pack-manifest-action-model.md) connector pack manifest (optional `connector` block: typed actions + idempotency/rate-limit metadata binding to 0046/0047).
- **Tier 2 — identity & governance:** [`RFCS/0048`](RFCS/0048-tenant-workspace-principal-identity-model.md) tenant·workspace·principal identity triple (extends RFC 0011, adds optional `RunSnapshot.owner`); [`RFCS/0049`](RFCS/0049-rbac-scopes-and-authorization-decisions.md) RBAC role→scope binding + `authorization.decided` event + fail-closed `authorization-fail-closed` invariant; [`RFCS/0050`](RFCS/0050-saml-scim-enterprise-identity-profiles.md) SAML/SCIM (+optional LDAP) enterprise auth profiles (extends RFC 0010); [`RFCS/0051`](RFCS/0051-approval-deployment-gate-primitive.md) `core.openwop.governance.approvalGate` (role-gated, audited approvals composing the quorum + auth-required interrupt profiles).
- **Tier 3 — runtime reliability & tooling:** [`RFCS/0052`](RFCS/0052-scheduling-and-time-based-triggers.md) `host.scheduling` (cron/delayed/calendar, once-per-tick durable execution behind the `schedule` trigger; composes with RFC 0017); [`RFCS/0053`](RFCS/0053-dead-letter-routing-and-failure-sinks.md) `host.deadLetter` + `run.dead_lettered` (fork-eligible failure sink); [`RFCS/0054`](RFCS/0054-run-diff-and-execution-comparison.md) read-only `GET /v1/runs/{runId}:diff?against={otherRunId}` deterministic run comparison (depends on RFC 0011 fork).
- **Doc surfaces synced:** README RFC-status paragraph (44 → 54 RFCs excluding template; Draft 4 → 14), `docs/KNOWN-LIMITS.md` §"RFCs not yet Accepted" gains ten rows, `docs/PROTOCOL-STATUS.md` regenerated via `npm run protocol:status`.

### RFC 0039 Half B fully closed end-to-end — 422 wire-route surface live (2026-05-24)

MyndHyve commit `560cfc89` (Cloud Run revision `workflow-runtime-00362-yoz` now serving 100% on `api.myndhyve.ai`; replaces parallel-session-self-pinned `00196-7mm`) lands the `replay_memory_snapshot_unavailable` 422 wire-route surface that had been the long-standing parallel-session blocker. Three coordinated pieces:

1. **Engine wiring** — `runExecutor.ts` selects `MyndHyveMemoryResolver.forFork(forkedFrom.runId)` for replay-mode dispatches, so `ctx.memory.snapshotAtSeq()` reads the parent run's journal instead of returning `null`.
2. **Route pre-flight** — new exported helper `checkReplayMemorySnapshotPreflight` at the canonical `POST /v1/runs/{runId}:fork`. Uses the SAME `forFork(sourceRunId)` construction the dispatch uses, so the gate truthfully predicts dispatch behavior (no probe-vs-dispatch dishonesty).
3. **Wire-shape envelope locked**:
   ```jsonc
   {
     "error": "replay_memory_snapshot_unavailable",
     "message": "<human>",
     "details": {
       "fromSeq": <number>,
       "sourceRunId": "<string>",
       "reason": "retention_expired" | "event_log_unavailable"
     }
   }
   ```
   The `reason` discriminator splits the two ways a snapshot can be unserveable: `retention_expired` (source past the host's `retention.ts` window; journal may be GC'd) vs `event_log_unavailable` (probe `snapshotAtSeq` returned `null` per degraded infra). Matches `spec/v1/rest-endpoints.md:314` `replay_memory_snapshot_unavailable` envelope contract end-to-end.

Live verification 2026-05-24: `POST /v1/runs/<probe>:fork` returns `401` (route registered + authenticating) — distinct from the `404` it returned pre-`560cfc89`. MyndHyve has a full conformance run against `00362-yoz` in flight; the `multi-agent-memory-lifecycle.test.ts` MAE-3 behavioral assertion stays `it.skip` per the parallel-session RFC 0042 §B experimental-tier carve-out for the broader memory-lifecycle surface — lifting that gate is a separate operator-side decision.

**Vendor-extension event type confirmation.** MyndHyve also confirmed `x-host-myndhyve-memory-written` stays as the canonical wire-shape they emit for SR-1-audit journaling. No canonicalization RFC needed unless we want one upstream. The forward-reference row in INTEROP-MATRIX §"Forward-reference — MyndHyve vendor-extension RunEventTypes" stays as-is.

**Updates:**
- `RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md` path-to-Accepted footer rewritten to document the 422 wire-route closure with the three coordinated pieces + envelope shape. Status stays `Accepted` (Half B work is additive on the already-Accepted RFC; no Status flip).
- `INTEROP-MATRIX.md` header date 2026-05-23 → 2026-05-24; lead note rewritten to describe the 422 closure as the headline.

Status: RFC 0039 Half B is now FULLY wired across discovery + host primitive + route surface + envelope contract. The full multi-agent execution model roadmap (Phases 1-4 = RFCs 0037, 0039, 0040, 0041) has Phases 1 + 2 fully Accepted + wired end-to-end on a non-steward host; Phases 3 + 4 (RFCs 0040, 0041) remain Active pending `version: 3` / `version: 4` advertisements + cross-host harness work.

### Docs-sync drift cleanup (2026-05-24)

- **Docs sync drift cleanup (2026-05-24).** Removed stale RFC 0034 from `docs/KNOWN-LIMITS.md`'s open-RFC table after its 2026-05-23 Active → Accepted promotion, refreshed README document-index word counts from current `spec/v1/*.md`, corrected the implementation-certification badge-generator citation, and made the SQLite historical conformance-full banner cite the exact `@openwop/openwop-conformance@1.5.0` suite version.
- **Validator gate hardening.** Root release tooling now pins `@redocly/cli@2.31.4` + `@asyncapi/cli@4.1.1` as repo-root devDependencies and `scripts/openwop-check.sh` invokes local bins directly instead of `npx -y`, using `--legacy-peer-deps` for the root-only install to avoid AsyncAPI Studio's React peer-resolution loop. This matches the drift-catalog rule for validator-toolchain updates.

### Multi-agent "Phase N" → version-tagged rename for external readability (2026-05-24)

External auditor 2026-05-24 said: "Remove all references to 'phase 4' from our documentation as no one else will know what that is." The repo had accumulated multi-agent "Phase 1-4" labels across spec text, RFC titles, conformance scenarios, and accountability docs — internally meaningful, externally opaque. The canonical machine-readable identifier is the integer `multiAgent.executionModel.version ∈ {1, 2, 3, 4}` already advertised on the wire; this batch rewrites the human-facing prose to lead with that + the RFC's feature name instead of the phase label.

- **File renames** (`git mv` preserves history): `docs/PHASE-4-PROGRESS.md` → `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md`; `docs/PHASE-4-CLOSEOUT-2026-05-23.md` → `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-CLOSEOUT-2026-05-23.md`. Each renamed file gains a top-of-file "Renamed 2026-05-24" note explaining the rationale.
- **RFC titles rewritten:** RFC 0039 "Multi-agent Phase 2" → "Multi-agent execution model `version: 2`"; RFC 0040 "Phase 3" → "`version: 3`"; RFC 0041 "Phase 4" → "`version: 4`". RFC 0037's title already named the feature.
- **Spec prose:** `spec/v1/multi-agent-execution.md` status block reframed from "Phase 1 of a four-phase formalization" → "first installment of a four-version formalization" with explicit `version: N` + RFC-number citations. Section headers, version mapping table, and open-spec-gaps table all rewritten with the RFC + version form.
- **Conformance scenarios:** docstrings in `multi-agent-confidence-escalation.test.ts` + `replay-observable-sequence-determinism.test.ts` rewritten to use `version: N` framing.
- **Long-tail body sweep:** 5 current-state docs cleaned (`docs/MULTI-AGENT-BEHAVIORAL-HARNESS-{PROGRESS,CLOSEOUT-2026-05-23}.md`, `docs/KNOWN-LIMITS.md`, `conformance/coverage.md`, `conformance/fixtures.md`) — 18 line-for-line swaps.
- **README link-rot regression-fix.** Per the `feedback_git_add_race` 2026-05-24 fifth-instance lesson: `README.md:130` referenced the old `./docs/PHASE-4-PROGRESS.md` path because the original rename commit unstaged README entirely (to avoid claiming the parallel agent's banner rewrite) — losing my single-line path fix alongside their work. Caught by `spec-corpus-validity.test.ts` link-integrity check; fixed via `git add -p` of just my hunk.
- **`/update-docs` skill expanded 21 → 22 drift modes.** New Drift #22 — "Internal phasing labels in external-facing prose" — inventories the 6 phasing schemes the repo has accumulated (multi-agent, Postgres `Phase H/I`, Multi-Agent Shift, ROADMAP, session, harness-track), spells out the substitution policy per scheme (wire-shape integers + env vars NEVER renamed; multi-agent prose YES; the others left alone unless audited), and lands a 7-step atomic fix recipe. The `feedback_git_add_race` memory also gains a fifth-instance entry documenting the `git add -p` discipline.

**Preserved (never renamed):** wire-shape `multiAgent.executionModel.version: 1-4` integer advertisement, env var `OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4=true`, historical CHANGELOG entries. Explicitly out of this sweep's scope: Postgres host "Phase H/I" launch tracks, ROADMAP "Phase 1 — Credibility / Phase 2 — Adoption / Phase 3 — Ecosystem" marketing-roadmap phasing, "Multi-Agent Shift Phase N" v1.0 agent-extensions-track labels, and dated outreach materials.

---

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

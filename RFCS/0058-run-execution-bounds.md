# RFC 0058: Run execution bounds (`runTimeoutMs` + `maxLoopIterations`)

| Field | Value |
|---|---|
| **RFC** | 0058 |
| **Title** | Two additive per-run safety bounds — a wall-clock `runTimeoutMs` and a loop-iteration ceiling `maxLoopIterations` — surfaced through two new `cap.breached` kinds (`run-duration`, `loop-iterations`) on the existing unified engine-enforced-limit event, closing the runaway-execution gap that `recursionLimit` (a node-execution count) does not cover |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-26 (**wall-clock arm now non-steward-adopted** — MyndHyve `workflow-runtime` advertises `capabilities.limits.maxRunDurationMs: 600000` live on `https://workflow-runtime-gjw5bcse7a-uc.a.run.app/.well-known/openwop` (openwop-side curl-verified 2026-05-26; `maxLoopIterations: null` honestly absent), clamps `configurable.runTimeoutMs` at run-create, and emits canonical `cap.breached { kind: 'run-duration' }` + `run_timeout` + RFC 0053 dead-letter on breach (their commits `ded1ed43a`/`5f03d5e18`/`8471cbb74`/`4357512b7`; an earlier `maxNodeExecutions` conflation was honestly retracted first). The wall-clock arm (`runTimeoutMs`) has now met the Accepted bar — both the in-memory reference host AND a verified non-steward host enforce it — but **RFC 0058 stays `Active`**: the full RFC graduates only when the `maxLoopIterations` arm is enforceable, which rides RFC 0061's execution-loop host. Per the RFC 0029 Tier-1/Tier-2 precedent, per-arm progress is recognized without a binary status flip — a binary list cannot honestly show "0058 Accepted" while `maxLoopIterations` is enforceable nowhere. 2026-05-25 (Draft → Active — architect Phase-0 clearance per `docs/autonomous-agent-runtime-plan.md` §8 + steward acceptance; wire surface landed atomically; `runTimeoutMs` reference-host enforcement landed in `examples/hosts/in-memory` with the run-duration behavior scenario live + green.)) |
| **Affects** | `spec/v1/run-options.md` (2 reserved keys) · `schemas/capabilities.schema.json` (`limits.maxRunDurationMs`, `limits.maxLoopIterations`) · `schemas/run-event-payloads.schema.json` (`capBreached.kind` enum +2) · `spec/v1/capabilities.md` §"Engine-enforced limits and the `cap.breached` event" · `spec/v1/rest-endpoints.md` (`run_timeout`, `loop_limit_exceeded` error codes) · `spec/v1/multi-agent-execution.md` (loop-iteration definition) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop has exactly one runaway-execution cap today: `recursionLimit`, a *node-execution* ceiling (`run-options.md` §"Reserved keys"), enforced via `cap.breached { kind: 'node-executions' }`. It does not bound wall-clock time, and it cannot distinguish a 1000-node linear workflow from a 1-node agent loop that re-enters itself 1000 times. This RFC adds two additive reserved keys — `runTimeoutMs` (wall-clock deadline) and `maxLoopIterations` (agent-loop iteration ceiling) — each clamped to a new advertised `Capabilities.limits` field, and surfaces their breach through **two new `kind` values on the existing `cap.breached` event** (`run-duration`, `loop-iterations`) rather than a parallel termination event. This is the safety foundation the rest of the autonomous-agent-runtime cohort (RFCs 0059–0064) builds on.

## Motivation

The `apps/workflow-engine` reference app runs its executor loop as an unbounded `while (true)` (`backend/typescript/src/executor/executor.ts`); an agent whose supervisor keeps emitting `next-worker` (per `multi-agent-execution.md`) blocks until an *external* process killer (Cloud Run's request deadline) intervenes. That is not a protocol contract — it is an accident of the deployment substrate, and it is invisible on the wire. An operator cannot ask for "stop this run after 5 minutes" and a workflow author cannot ask for "stop this agent after 20 loop iterations." Both are interop guarantees, not implementation details: a workflow moved between two hosts must terminate the same way.

The spec is the right place because a *bound-triggered* termination must be distinguishable on the wire from an application failure (so replay, analytics, and the HITL inbox can treat it correctly), and the clamping ceiling must be discoverable so a client can pre-flight a request rather than have it silently truncated. openwop already solved exactly this shape for `recursionLimit`: `capabilities.md` §"Engine-enforced limits" deliberately unifies all cap breaches under one `cap.breached` event with a `kind` discriminator "instead of N parallel surfaces," citing LangGraph / Temporal / Step Functions. This RFC follows that precedent rather than departing from it.

## Proposal

### §A — `run-options.md`: two reserved keys (additive)

Add to the reserved-keys table:

| Key | Type | Semantics |
|---|---|---|
| `runTimeoutMs` | `number` | Wall-clock deadline for the whole run, in milliseconds, measured from `run.started`. The server resolves the effective limit as `min(runTimeoutMs, Capabilities.limits.maxRunDurationMs)`; out-of-range values are validated at run-create time (`400 validation_error`), never at runtime. When the deadline passes the host MUST emit `cap.breached { kind: 'run-duration', limit: <resolvedMs>, observed: <elapsedMs> }`, transition the run to `failed`, set `RunSnapshot.error.code = 'run_timeout'`, and stop scheduling. Absent ⇒ only the host ceiling applies. |
| `maxLoopIterations` | `number` | Ceiling on **agent-loop iterations** — one increment per orchestrator turn per `multi-agent-execution.md` §"Execution loop". Distinct from `recursionLimit` (total node executions). Effective limit `min(maxLoopIterations, Capabilities.limits.maxLoopIterations)`. On breach the host MUST emit `cap.breached { kind: 'loop-iterations', limit: <resolvedMax>, observed: <iterationCount> }`, transition to `failed`, set `error.code = 'loop_limit_exceeded'`, stop scheduling. Hosts that don't advertise `capabilities.multiAgent.executionModel.supported` (the execution loop, RFC 0037) ignore the key — there are no orchestrator turns to count. RFC 0061 (`version: 5`) adds the observable per-turn `iteration` counter this bound reads. |

These follow the `recursionLimit` resolution + validation pattern in `capabilities.md` §"Resolution: `recursionLimit` + `maxNodeExecutions`" verbatim — only the counted quantity differs.

### §B — `capabilities.schema.json`: two `limits` ceilings (additive)

Joins the existing engine-enforced limits (`clarificationRounds` / `schemaRounds` / `envelopesPerTurn` / `maxNodeExecutions`):

```diff
   "limits": {
     "type": "object",
     "properties": {
       "maxNodeExecutions": { "type": "integer", "minimum": 1 },
+      "maxRunDurationMs": {
+        "type": "integer", "minimum": 1000,
+        "description": "RFC 0058. Engine-side wall-clock ceiling per run; upper bound for RunOptions.configurable.runTimeoutMs. Breach emits cap.breached{kind:'run-duration'} + error run_timeout."
+      },
+      "maxLoopIterations": {
+        "type": "integer", "minimum": 1,
+        "description": "RFC 0058. Engine-side ceiling on agent-loop iterations (orchestrator turns per RFC 0037's execution loop); upper bound for RunOptions.configurable.maxLoopIterations. Breach emits cap.breached{kind:'loop-iterations'} + error loop_limit_exceeded. Optional; hosts that advertise it MUST enforce it."
+      }
     }
   }
```

Both are OPTIONAL (additive); absent ⇒ no host ceiling beyond the deployment substrate.

### §C — `cap.breached` kind extension (additive, reuse not new event)

Extend the existing `capBreached.kind` enum in `run-event-payloads.schema.json` — the same enum RFC 0008 §K already extended with `wasm-*` kinds:

```diff
   "capBreached": {
     "properties": {
-      "kind": { "type": "string", "enum": ["clarification", "schema", "envelopes", "node-executions", "wasm-memory", "wasm-fuel", "wasm-execution-time"] },
+      "kind": { "type": "string", "enum": ["clarification", "schema", "envelopes", "node-executions", "wasm-memory", "wasm-fuel", "wasm-execution-time", "run-duration", "loop-iterations"] },
       "limit":    { "type": "integer", "minimum": 0 },
       "observed": { "type": "integer", "minimum": 0 }
     }
   }
```

The payload already carries `{ kind, limit, observed }` and is `additionalProperties: true`. `run-duration` maps `limit: resolvedTimeoutMs, observed: elapsedMs`; `loop-iterations` maps `limit: resolvedMax, observed: iterationCount`. **No new event type, no `eventLogSchemaVersion` bump** — per the `node-executions` precedent (`capabilities.md` §"What this closes"), adding a `kind` to this enum is additive on the existing surface. Consumers that don't recognize the new kinds still receive a `cap.breached` event and handle it generically via the `kind` discriminator + subsequent `run.failed`.

The host MUST record `observed` (the `elapsedMs` / `iterationCount` at trip) in the emitted event; on replay or `:fork`, the host MUST reuse the recorded `observed` value and MUST NOT recompute it from a wall clock or live counter, per `replay.md` (this is already how `node-executions` records its observed count).

**Positive example.** `runTimeoutMs: 60000` on a run that finishes in 4 s → no breach; ordinary `run.completed`.
**Negative example.** `runTimeoutMs: 1000` on a run that needs 5 s → at ~1 s: `cap.breached { kind: 'run-duration', limit: 1000, observed: ~1000 }` then `run.failed { error: { code: 'run_timeout' } }`.

### §D — error codes (`rest-endpoints.md`)

Siblings of the existing `recursion_limit_exceeded` and `sandbox_timeout` rows:

- `run_timeout` — RFC 0058. A run exceeded its effective `runTimeoutMs` (`min(runTimeoutMs, maxRunDurationMs)`). `details.elapsedMs` SHOULD report observed duration (mirrors `sandbox_timeout`). Pairs with `cap.breached { kind: 'run-duration' }`. The run terminates `failed`.
- `loop_limit_exceeded` — RFC 0058. A run exceeded its effective `maxLoopIterations`. `details.iteration` SHOULD report the count reached. Pairs with `cap.breached { kind: 'loop-iterations' }`. Applies only on hosts advertising `capabilities.multiAgent.executionModel.supported` (RFC 0037).

## Compatibility

**Additive.** Per `COMPATIBILITY.md` §2.2: both reserved keys are optional `configurable` entries (run without them behaves as today); both `limits` fields are optional; the two error codes are new (no existing code changes meaning); and the `cap.breached.kind` enum *gains* two values without changing the shape, semantics, or required fields of the event — exactly the additive move RFC 0008 §K already made for the `wasm-*` kinds. No existing required field, optional-field type, event shape, endpoint contract, `MUST`, or HTTP-status meaning changes. No existing v1 conformance pass is invalidated.

Forward-compat clauses: (1) a client that never sends the new keys is unaffected; (2) a server that never advertises the new `limits` fields applies no new ceiling; (3) a consumer with the old `kind` enum still receives `cap.breached` and routes on the string discriminator (the event is `additionalProperties: true`, so unknown kinds do not fail generic handling) — a *strict* validator pinned to the old enum is the only caller that would reject, which is the standard additive-enum caveat (see Unresolved #3).

## Conformance

Existing coverage: `conformance-cap-breach` fixture (`conformance/fixtures.md`) exercises `kind: 'node-executions'` (10 noop nodes + `recursionLimit: 5` → `failed` + `cap.breached`). New scenarios extend the same pattern + deterministic-clock seam:

- **`run-bounds-shape.test.ts`** — `maxRunDurationMs` / `maxLoopIterations` validate as positive integers when advertised; the `capBreached.kind` enum includes the two new values. (Always runs.)
- **`run-timeout-fires.test.ts`** — a run with `runTimeoutMs` below its real duration emits `cap.breached { kind: 'run-duration' }` + terminal `failed` + `run_timeout`. (Gated on `limits.maxRunDurationMs` advertised; uses the RFC 0052 `scheduling/tick` deterministic-clock seam.)
- **`run-loop-limit-fires.test.ts`** — an agent loop with `maxLoopIterations: N` emits `cap.breached { kind: 'loop-iterations' }` on the (N+1)th orchestrator turn + `loop_limit_exceeded`. (Gated on `multiAgent.executionModel.supported`, RFC 0037; RFC 0061 `version: 5` adds the `iteration` counter.)
- **`run-bounds-clamp.test.ts`** — a `runTimeoutMs` above `maxRunDurationMs` is clamped at run-create (not rejected unless out of validator range); the run breaches at the ceiling. (Gated.)

New fixture `conformance-run-duration-breach` added to `conformance/fixtures.md`. Server-free shape subset <1s.

## Alternatives considered

1. **A new dedicated `run.terminated` lifecycle event** (the author's first draft). Rejected — it duplicates `cap.breached` and directly contradicts the documented design in `capabilities.md` §"Engine-enforced limits," which unifies all caps under one event "instead of N parallel surfaces." Extending the `kind` enum is the established, lower-surface-area path (RFC 0008 §K already did it).
2. **Reuse `recursionLimit` for everything.** Rejected — node-count and loop-count are different quantities; a single counter cannot express "≤ 20 agent iterations regardless of nodes-per-iteration," the agent-loop safety knob operators want.
3. **Make timeout a host-only concern (no wire key).** Rejected — then a workflow author cannot request a tighter-than-host deadline, and behavior is non-portable across hosts.

## Unresolved questions

*Resolved by the Phase-0 architect ruling (2026-05-25); see `docs/autonomous-agent-runtime-plan.md` §8.*

1. **Soft vs. hard timeout** — RESOLVED: hard-cancel via the existing cancellation path; the host MUST flush the `cap.breached` + `run.failed` events to the log before terminating.
2. **Iteration under nested orchestration** — RESOLVED: each run carries its own loop counter; a child sub-orchestrator's iterations do NOT count against the parent's `maxLoopIterations`.
3. **Strict-enum consumers / per-event version** — RESOLVED: **no `eventLogSchemaVersion` bump** — the `wasm-*` enum-addition precedent (`capabilities.md §"What this closes"`) is authoritative; the `cap.breached.kind` additions are additive for forward-compatible consumers (`additionalProperties: true`).

## Implementation notes (non-normative)

- `apps/workflow-engine`: add a deadline check + iteration counter in `executor.ts`'s drain loop, mirroring the existing `nodeExecutionCount` / `cap.breached` path (`executor.ts` already emits `cap.breached { kind: 'node-executions' }`); the two new kinds reuse that emission site. Effort: small.
- No new SECURITY invariant at Draft; the termination paths are safety-additive, not a new MUST-NOT.
- Sequence first in the cohort — RFC 0061 (`maxLoopIterations` enforcement) and RFC 0064 (`durationMs`) depend on the bound + the determinism clause landing here.

## Acceptance criteria

- [x] `run-options.md` reserved-keys rows merged (resolution pattern cross-referencing `capabilities.md` §Resolution).
- [x] `capabilities.schema.json` `limits` additions + `capBreached.kind` enum +2 in `run-event-payloads.schema.json` + `capabilities.md` §"Engine-enforced limits" updated to enumerate all kinds (+ `observability.md` `openwop.cap_kind`).
- [x] `run_timeout` + `loop_limit_exceeded` registered in `rest-endpoints.md`.
- [x] Shape conformance scenario `run-execution-bounds-shape.test.ts` (always-on) + `coverage.md` row. The behavior (`run-duration` breach) block + the `conformance-run-duration-breach` fixture are now **live + green** against the in-memory reference host (see below); the `loop-iterations` behavior stays soft-skipped pending RFC 0061.
- [x] SDK type additions: TS `Capabilities.limits` + `RunConfigurable`; Python `CapabilitiesLimits` + `RunConfigurable` + parser + error-code set; Go `CapabilitiesLimits` + `RunConfigurable` (+ `MarshalJSON`) + error-code list.
- [x] CHANGELOG entry under `[1.1.4 — unreleased]`.
- [x] Reference host (`examples/hosts/in-memory`) enforces **`runTimeoutMs`** (wall-clock) — arms a per-run deadline timer, emits `cap.breached { kind: 'run-duration', limit: <resolvedMs>, observed: <elapsedMs> }`, transitions to `failed` with `error.code = 'run_timeout'`, and advertises `capabilities.limits.maxRunDurationMs`. The behavior scenario flips from soft-skip to **live + green** against this host.
- [ ] Reference host enforces **`maxLoopIterations`** — **deferred to RFC 0061**, which formalizes the per-turn orchestrator `iteration` counter this bound clamps (see §Implementation-notes: "RFC 0061 (`maxLoopIterations` enforcement) … depend[s] on the bound … landing here"). No reference host advertises `multiAgent.executionModel.supported` (the RFC 0037 loop) — the in-memory host is a linear node walk with no orchestrator turns to count — so enforcement lands with the execution-loop host in RFC 0061. **(2026-05-26 architect finding, per RFC 0061 §Implementation-notes): RFC 0061 M2 itself requires a genuine *re-entrant* agent-loop host — the steward hosts are linear-walk (in-memory) / single-pass `core.dispatch` (`apps/workflow-engine`), neither of which counts re-entrant orchestrator turns — so this `maxLoopIterations` half inherits the same re-entrant-loop-host prerequisite (a non-steward runtime like MyndHyve at `version: 4` → `5`, or a workflow-engine executor rearchitecture). RFC 0058 stays `Active`.)**

**Implementation note (2026-05-25, runTimeoutMs enforcement):** The wall-clock bound is now enforced in `examples/hosts/in-memory` (`runWorkflow` arms a deadline timer; `handleCreateRun` resolves + clamps `configurable.runTimeoutMs` to the advertised `maxRunDurationMs` ceiling, rejecting out-of-range with `400 validation_error`). Making the breach observable to the black-box suite also required repairing the poll path's event envelope to the canonical `run-event.schema.json` shape (`eventId` / `sequence` / `payload`; legacy `seq` / `data` retained as aliases) — the "canonical `RunEventDoc` shape" gap the host's `conformance.md` tracks. `Active → Accepted` for the *full* RFC still awaits the `maxLoopIterations` half, which rides RFC 0061; **Status stays `Active`**.

**Implementation note (2026-05-25, wire surface):** The full wire surface — `run-options.md` keys, the two `capabilities.limits` fields, the two `capBreached.kind` values, `capabilities.md` §"Engine-enforced limits" resolution, the two error codes, `observability.md` `cap_kind`, the always-on shape conformance scenario, and TS/Python/Go SDK types — landed atomically (architect Phase-0 clearance + steward acceptance flipped `Draft → Active`). `npm run openwop:check` green.

## References

- [`spec/v1/capabilities.md`](../spec/v1/capabilities.md) §"Engine-enforced limits and the `cap.breached` event" — the unified surface this extends; the `recursionLimit` resolution pattern reused.
- [`spec/v1/run-options.md`](../spec/v1/run-options.md) — reserved keys (`recursionLimit` sibling) + `validateRecursionLimit()`.
- [`spec/v1/multi-agent-execution.md`](../spec/v1/multi-agent-execution.md) — the orchestrator-turn loop `maxLoopIterations` counts.
- [`spec/v1/replay.md`](../spec/v1/replay.md) — `observed` recorded, not regenerated at fork.
- [`RFCS/0061-agent-loop-lifecycle.md`](./0061-agent-loop-lifecycle.md) — the loop lifecycle whose iterations this bounds.
- [`RFCS/0008`](./0008-wasm-abi.md) §K — prior additive `cap.breached.kind` enum extension (`wasm-*`).
- Temporal `WorkflowExecutionTimeout`, AWS Step Functions `TimeoutSeconds`, LangGraph `GraphRecursionError` (prior art for unified cap-failure events).

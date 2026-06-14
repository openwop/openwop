# RFC 0097: Standing Goals and Judge-Based Continuation

| Field             | Value                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0097                                                                                                                  |
| **Title**         | Standing Goals and Judge-Based Continuation                                                                          |
| **Status**        | `Accepted`                                                                                                           |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                       |
| **Created**       | 2026-06-13                                                                                                          |
| **Updated**       | 2026-06-14 (`Active → Accepted`: non-steward live witness — MyndHyve advertises `agents.goals` at the locked shape (`judge:[verifier]`, `requiresBounds:true`) on live rev `workflow-runtime-00269-ljm` and serves the seams non-vacuously (create-without-bounds → 422, client `state:satisfied` → 422), steward curl-verified; openwop-app reference host (rev `00174-6m6`) serves the full surface + passed `goal-standing-continuation` 7/7 non-vacuous vs `@openwop/openwop-conformance@1.24.0`. CLI `goals` group live-smoke green. Both legs of the §D Accepted bar met.) · 2026-06-13 (`Draft → Active`: spec floor landed — `agents.goals` capability + `goal.schema.json` + `agent-runtime.md` §"Standing goals" + the `goal-continuation-bounded` / `goal-completion-judge-only` invariants + content-free `goal.evaluated`/`goal.closed` events + 3 capability-gated scenarios. 7-day comment window bypassed by maintainer.) |
| **Affects**       | `capabilities.schema.json`, `spec/v1/agent-runtime.md` (new §), `schemas/goal.schema.json` (new), `api/openapi.yaml`, conformance, `@openwop/cli` (`goals` group) |
| **Compatibility** | `additive`                                                                                                          |
| **Supersedes**    | —                                                                                                                  |
| **Superseded by** | —                                                                                                                  |

## Summary

Add an optional, capability-gated **standing goal** primitive: a durable objective with explicit **completion criteria**, evaluated by a host-side **judge** (RFC 0090 verifier/convergence), that keeps an agent working — across turns and across runs — until the judge deems the goal satisfied, the goal hits a declared bound, or the agent escalates. A `Goal` composes existing primitives rather than introducing a new execution model: the *continuation arm* reuses RFC 0068 standing commitments / RFC 0052–0058–0060 triggers, the *completion check* reuses RFC 0090, the *bounds* reuse RFC 0058 execution bounds, and *"I'm stuck"* reuses the RFC 0044 confidence-escalation interrupt. The only new wire is the goal object, its lifecycle, and two content-free observability events. Hosts that omit `agents.goals` are unchanged.

## Motivation

"Keep working until the release checklist is complete" is a different shape from everything openwop models today. RFC 0052/0058/0060 *fire* a run on a clock or predicate; RFC 0068 fires a run when an inferred commitment's condition is met. All three are **arms that trigger work**. None of them models a **standing objective that judges its own completion and re-engages until satisfied** — the Hermes "persistent goals + lightweight judge model" pattern, and the OpenClaw "standing instructions" pattern. The distinction is convergence, not triggering: a goal owns (1) a success predicate, (2) a judge that evaluates progress after each contributing run, and (3) a continuation decision (`continue | done | escalate | abandon`).

openwop already has the parts:

- **The judge** — RFC 0090 (agent verifier & convergence) defines verifier evaluation and convergence; a goal's completion check is exactly a verifier verdict applied to an objective.
- **The continuation arm** — RFC 0068 commitments, RFC 0052 scheduling, RFC 0060 heartbeat predicates, RFC 0061 agent-loop-lifecycle already fire runs without a fresh user turn.
- **The safety rails** — RFC 0058 execution bounds (cost/iteration/wall-clock ceilings) cap runaway continuation; RFC 0044 lets an agent escalate via a confidence-escalation interrupt; RFC 0084 budget/quota gates spend.

What is missing is the **objective object that ties a success criterion to a judge to a continuation loop**, with the hard invariant that continuation **MUST** stop at a declared bound or an unmet escalation. Today "this goal kept the agent working until the judge said done, and never exceeded its iteration/cost bound" is host-private — an operator running unattended goals can't get a cross-host guarantee that the loop terminates. That termination guarantee is a correctness + safety property and belongs on the wire. The *judge model* and the *planning* stay host choices; this RFC pins the object, the lifecycle, the bound-enforcement invariant, and the events.

## Proposal

### §A — `capabilities.schema.json`: additive optional sub-block under `agents`

```diff
   "agents": {
     "type": "object",
     "properties": {
+      "goals": {
+        "type": "object",
+        "description": "Standing objectives with judge-based completion and bounded continuation (RFC 0097). Optional.",
+        "properties": {
+          "judge": {
+            "enum": ["verifier", "host"],
+            "description": "`verifier` = completion check is an RFC 0090 verifier verdict; `host` = an opaque host evaluator."
+          },
+          "continuation": {
+            "type": "array",
+            "description": "How a goal re-engages work between checks.",
+            "items": { "enum": ["schedule", "commitment", "heartbeat", "manual"] }
+          },
+          "requiresBounds": {
+            "type": "boolean",
+            "default": true,
+            "description": "If true, a goal MUST declare RFC 0058 bounds before it may activate."
+          }
+        },
+        "required": ["judge", "continuation"]
+      }
     }
   }
```

### §B — `schemas/goal.schema.json` (new)

```jsonc
{
  "$id": "https://openwop.dev/spec/v1/goal.schema.json",
  "type": "object",
  "required": ["id", "objective", "state", "completion", "bounds", "owner", "createdAt"],
  "properties": {
    "id":        { "type": "string" },
    "objective": { "type": "string", "description": "The standing objective, SR-1 redaction-safe." },
    "state":     { "enum": ["active", "satisfied", "escalated", "abandoned", "bound-exceeded"] },
    "completion": {
      "type": "object",
      "required": ["check"],
      "properties": {
        "check": { "enum": ["verifier", "host"] },
        "verifierRef": { "type": ["string", "null"], "description": "RFC 0090 verifier id when check=verifier." },
        "lastVerdict": { "type": ["object", "null"], "description": "Most recent judge verdict {satisfied: bool, confidence, runId} — content-free re: objective text." }
      }
    },
    "continuation": {
      "type": "object",
      "required": ["mode"],
      "properties": {
        "mode": { "enum": ["schedule", "commitment", "heartbeat", "manual"] },
        "armRef": { "type": ["string", "null"], "description": "The RFC 0052 job / RFC 0068 commitment / RFC 0060 heartbeat that re-engages work." }
      }
    },
    "bounds":  { "type": "object", "additionalProperties": false, "properties": { "maxLoopIterations": { "type": "integer", "minimum": 1 }, "runTimeoutMs": { "type": "integer", "minimum": 0 }, "maxCostUsd": { "type": "number", "minimum": 0 } }, "description": "RFC 0058 ceilings inlined (no standalone execution-bounds.schema.json in the corpus): max loop iterations, wall-clock deadline (ms), accumulated cost (RFC 0084)." },
    "progress": {
      "type": "object",
      "properties": {
        "iterations": { "type": "integer", "minimum": 0 },
        "contributingRunIds": { "type": "array", "items": { "type": "string" } }
      }
    },
    "owner":     { "type": "object", "additionalProperties": false, "required": ["tenant"], "properties": { "tenant": { "type": "string", "minLength": 1 }, "workspace": { "type": "string", "minLength": 1 }, "principal": { "type": "string", "minLength": 1 } }, "description": "RFC 0048 identity triple — inlined (matches run-snapshot.schema.json.owner)." },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" }
  }
}
```

### §C — Endpoints (host-extension `/v1/host/sample/goals`, promotable to `/v1/goals`)

| Method + path | Purpose |
| --- | --- |
| `GET /goals[?state=]` | List goals (RFC 0048 scoped). |
| `GET /goals/{id}` | One goal incl. `progress` + `completion.lastVerdict`. |
| `POST /goals` | Create. If `agents.goals.requiresBounds` is true, the body **MUST** include valid RFC 0058 `bounds` or the host returns `422`. |
| `PATCH /goals/{id}` | Edit objective / completion / continuation while `active`. |
| `POST /goals/{id}/pause` · `/resume` | Suspend / re-arm continuation. |
| `POST /goals/{id}/abandon` | `state: abandoned`. |

(There is no `complete` write: completion is the judge's verdict, never asserted by a client — see §E.)

### §D — Events (additive, content-free, redaction-safe)

- `goal.evaluated` — `{ goalId, satisfied, confidence, runId, iterations }`. Emitted after each judge check. No objective text.
- `goal.closed` — `{ goalId, finalState }` where `finalState ∈ {satisfied, escalated, abandoned, bound-exceeded}`.

### §E — `spec/v1/agent-runtime.md` normative prose (new section "Standing goals")

1. A goal's completion **MUST** be determined by the judge declared in `completion.check` (an RFC 0090 verifier verdict or the host evaluator). A client **MUST NOT** be able to set `state: satisfied` directly.
2. Continuation **MUST** be bounded: when `requiresBounds` is advertised, an `active` goal without RFC 0058 `bounds` is invalid. The host **MUST** stop continuation and set `state: bound-exceeded` (emitting `goal.closed`) when any declared bound is crossed — iteration count, accumulated cost (RFC 0084), or wall-clock deadline.
3. If the agent cannot make progress and emits an RFC 0044 confidence-escalation interrupt against a goal, the host **MUST** set `state: escalated` and stop continuation until a human resolves it.
4. Each judge evaluation **MUST** be attributable to the `runId` it evaluated (`goal.evaluated.runId`); `contributingRunIds` is RFC 0040 causation-compatible.
5. `objective` and any verdict payload **MUST** be SR-1 redaction-safe.

### Examples

**Positive** — a goal with `continuation.mode = schedule` (daily) and `bounds.maxIterations = 7`: each fired run contributes work, `goal.evaluated` records the verdict; on the 4th run the verifier returns `satisfied: true` → `state: satisfied`, `goal.closed`, continuation disarmed.

**Negative** — same goal, but the verifier never satisfies; on iteration 7 the host stops, sets `state: bound-exceeded`, emits `goal.closed` (no 8th run). A `POST /goals` with `requiresBounds` advertised and no `bounds` → `422`.

## Compatibility

**Additive.** New optional capability sub-block (`agents.goals`), new schema, new host-extension endpoints, two ignorable events. Guarantees: absent the capability, no endpoints/events exist; the goal object reuses existing schemas (`execution-bounds`, `identity`) so no existing schema changes shape; run execution is untouched. Lands in v1.x.

## Conformance

- **Existing coverage:** RFC 0090 verifier scenarios cover the judge; RFC 0058 covers bound enforcement; RFC 0044 covers escalation interrupts.
- **New scenarios (capability-gated on `agents.goals`):**
  1. *Convergence* — a goal closes `satisfied` when the verifier verdict flips, and continuation disarms.
  2. *Bounded termination* — a never-satisfied goal stops exactly at `maxIterations` with `state: bound-exceeded`; no further runs fire.
  3. *Escalation halt* — a confidence-escalation interrupt against the goal sets `escalated` and halts continuation.
  4. *No client-side completion* — `PATCH` attempting `state: satisfied` is rejected.

## Alternatives considered

1. **Extend RFC 0068 commitments with a "repeat until done" flag.** Rejected: a commitment is a *fire-once arm*; bolting a self-judging convergence loop onto it overloads its semantics and hides the termination guarantee. A goal *uses* a commitment as one continuation mode, which is the right layering.
2. **Model goals purely as a client loop (client re-submits until happy).** Rejected: then the termination/bound guarantee lives in the client, is unattended-unsafe, and can't be certified cross-host; the whole value is host-enforced bounded continuation.
3. **Make the judge a new bespoke evaluator.** Rejected: RFC 0090 already defines verifier verdicts and convergence — reuse it.
4. **Do nothing.** Rejected: leaves "persistent goals" (a top-tier competitor differentiator) host-private and the loop-termination safety property unverifiable.

## Unresolved questions

1. Should a goal be allowed to spawn *sub-goals* (decomposition), or is that left to multi-agent orchestration (RFC 0037)? Current draft: out of scope; a goal references contributing runs only.
2. When `judge = host` (opaque), what minimum verdict shape must `goal.evaluated` carry for an A2A peer to reason about progress?
3. Should `bound-exceeded` auto-escalate (notify a human) or terminate silently with just the event? (Leaning: emit `goal.closed` + optionally fire a notification; not mandated.)

## Implementation notes (non-normative)

Reference host: `/v1/host/sample/goals`; the judge is an RFC 0090 verifier invocation after each contributing run; continuation re-uses the existing scheduler/commitment/heartbeat machinery. The `@openwop/cli` `goals` group drives `list`/`get`/`create`/`pause`/`resume`/`abandon` (`--json` on reads; exit codes `0` satisfied / `3` escalated / `1` bound-exceeded|error). Sequencing: depends on RFC 0090 + RFC 0058 (both Accepted/Active); pairs with the shipped CLI `workforces` group for fleet-scale goal portfolios.

## Acceptance criteria

- [ ] Spec text merged (`agent-runtime.md` §"Standing goals").
- [ ] `capabilities.schema.json` + `goal.schema.json` updated; `api/openapi.yaml` paths added.
- [ ] ≥1 conformance scenario per §Conformance, capability-gated.
- [ ] CHANGELOG entry under the target v1.x.
- [ ] Reference host implements `/v1/host/sample/goals` and passes the new scenarios, or the RFC explicitly defers reference-host implementation.

## References

- RFC 0090 (agent verifier & convergence) · RFC 0068 (standing commitments) · RFC 0052 (scheduling) · RFC 0058 (execution bounds) · RFC 0060 (heartbeat) · RFC 0061 (agent loop lifecycle) · RFC 0044 (confidence-escalation interrupt) · RFC 0084 (budget/quota/cost policy) · RFC 0048 (identity triple) · RFC 0040 (cross-host causation) · RFC 0037 (multi-agent execution model).
- Prior art: Hermes persistent goals + judge model; OpenClaw standing instructions; Temporal "continue-as-new" bounded loops.
- Competitive feature analysis (`docs/`).

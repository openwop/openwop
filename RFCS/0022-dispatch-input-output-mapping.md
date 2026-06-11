# RFC 0022: `core.dispatch` + `core.subWorkflow` runtime variable mapping

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0022                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Title**         | `core.dispatch` + `core.subWorkflow` runtime variable mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Created**       | 2026-05-18                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Updated**       | 2026-05-19 (negative-path coverage closed: the remaining `it.todo` cases from the 2026-05-18 deferral list — HVMAP-1a-null (unset-variable projection), HVMAP-1a-refusal + HVMAP-2-refusal (refusal-on-missing-capability), HVMAP-1b-failed + HVMAP-1b-cancelled (child-terminal-state outputMapping skip), HVMAP-1c-override (per-worker mapping precedence), HVMAP-2-unset (subWorkflow unset-input projection), HVMAP-2-no-midrun-propagation (parent mid-run mutation suppression) — all graduated to live behavioral tests. The conformance-harness infrastructure that gated them landed in the same cycle: capability-toggle seam (`conformance/src/lib/host-toggle.ts` backed by `POST /v1/host/sample/test/capability-toggle` on the reference workflow-engine), `conformance-dispatch-deterministic-fail-child.json` + `conformance-dispatch-cancellable-child.json` (child-lifecycle fixtures), and `conformance-dispatch-input-mapping-no-default.json` + `conformance-subworkflow-input-mapping-no-default.json` (defaultValue-omitting variants). Republished as `@openwop/openwop-conformance@1.3.0`. Prior history: 2026-05-18 (Active → Accepted: HVMAP-1a/1b/1c graduated from `it.todo()` placeholders to live behavioral tests against the Postgres reference host alongside the supervisor-mock extension (`config.mockDispatchPlan` on `core.orchestrator.supervisor` — §"Unresolved questions" #6); HVMAP-2 already lived behavioral; Postgres reference host advertises `capabilities.agents.dispatchMapping: true` + `capabilities.subWorkflow.inputMapping: true` end-to-end). Draft → Active 2026-05-18 via bootstrap-phase waiver per `CONTRIBUTING.md` §"Bootstrap-phase notes"; additive RFC; schema deltas + spec prose + placeholder scenarios + capability advertisements landed at `Draft` in commits cf7df05 + 02a84e1; reference-host impl landed in a8a8594. |
| **Affects**       | `schemas/dispatch-config.schema.json`, `schemas/capabilities.schema.json`, `spec/v1/node-packs.md` (`core.dispatch` row + `core.subWorkflow contract` §), `spec/v1/capabilities.md` (new advertisements), `RFCS/0007-dispatch.md` (additive amendment)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Summary

Close the same authoring gap on the two openwop workflow-invocation primitives:

1. **`core.dispatch`** (RFC 0007) — add four optional fields (`inputMapping`, `outputMapping`, `perWorkerInputMappings`, `perWorkerOutputMappings`) so a supervisor-driven dispatch can project parent variables into child inputs and harvest child variables back into the parent.
2. **`core.subWorkflow`** (spec v1 §"`core.subWorkflow` contract") — add `inputMapping` (symmetric to its existing normative `outputMapping`) so a parent can project runtime variables into a child workflow's inputs without relying solely on `variables[].defaultValue` at child registration.

Without these, supervisor-driven workflows must build hybrid DAGs that interleave `core.dispatch` (for runtime worker selection) with `core.subWorkflow` (for parent/child variable flow — and even that primitive's input side is currently absent). The RFC closes both halves with one additive surface.

## Motivation

openwop has two primitives that invoke a child workflow:

| Primitive          | Author-time vs. runtime selection                                                        | `inputMapping` | `outputMapping`                                              |
| ------------------ | ---------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------ |
| `core.subWorkflow` | Author-time (`config.workflowId` pinned in the workflow definition)                      | ✗ **missing**  | ✓ normative (`node-packs.md` §"`core.subWorkflow` contract") |
| `core.dispatch`    | Runtime (`OrchestratorDecision.nextWorkerIds[]` supplied by the supervisor at execution) | ✗ **missing**  | ✗ **missing**                                                |

The asymmetry hurts in production:

- **`core.dispatch`** invokes children with `{}` inputs and discards their variables (today's normative contract — see `dispatch.node.ts:307` in the Postgres reference). Every supervisor-driven workflow that needs parent/child data flow has to wrap dispatch in additional plumbing.
- **`core.subWorkflow`** receives nothing from the parent at runtime — children only get `variables[].defaultValue` declarations folded in at run-create time (per `node-packs.md` §"Variable seeding"). A parent that wants to pass `currentPrdId` into a child workflow has no first-class way to do so; the child must read from a side channel (storage, the conversation channel) or accept the value as a baked-in default that can't vary per dispatch.

### What this forces today

A non-trivial supervisor-driven workflow needs BOTH primitives in a hybrid DAG, plus a side channel for the half-fixed primitive:

```text
adaptive-root
├── core.orchestrator.supervisor          # decides which phases to run
├── core.dispatch                          # invokes supervisor-selected phases
│   └── (children: no input/output mapping — wrap in side channel)
└── core.subWorkflow (× N)                 # cross-phase artifact handoff
    ├── PRD child (outputMapping wired; INPUTS come from side channel)
    ├── BRAND child (outputMapping wired; INPUTS come from side channel)
    └── ...
```

The author splits the workflow into "phases the supervisor picks" and "phases that need parent/child variable flow," then wires conditional edges between them — AND uses a side channel (workspace storage, a parent-set channel variable, etc.) for any value that needs to reach a child as input. This works but adds DAG topology and side-channel coupling that convey nothing about intent.

### Concrete production motivation

The pattern was first hit in production by the MyndHyve Launch Studio rebuild (`vendor.myndhyve.launchStudioSupervisor`, internal RFC at `docs/rfcs/openwop-dispatch-input-output-mapping.md`):

1. Supervisor picks 8 phases from a brief (`templateHint`).
2. Phase 1 (`foundation-prd`) produces `prdId`.
3. Phase 2 (`brand-system`) needs `prdId` as input, produces `brandId`.
4. Phase 7 (`landing-page`) needs `brandId`, `prdId`, and `campaignIds`.

The MyndHyve RFC's three considered workarounds (hybrid DAG, canonical-store side channel, vendor wrapper) all fail the protocol-tier "this should work cross-host" bar.

## Proposal

### A. `core.dispatch` — add four optional mapping fields

Extend `schemas/dispatch-config.schema.json` with:

```diff
   "properties": {
     "askUserRouting": { ... unchanged ... },
     "workerDispatchModel": { ... unchanged ... },
     "fanOutPolicy": { ... unchanged ... },
-    "iterationCap": { ... unchanged ... }
+    "iterationCap": { ... unchanged ... },
+    "inputMapping": {
+      "type": "object",
+      "additionalProperties": { "type": "string" },
+      "description": "Default input mapping for every dispatched child on the next-worker path. Keys are CHILD variable names; values are PARENT variable names. Per-worker overrides take precedence."
+    },
+    "outputMapping": {
+      "type": "object",
+      "additionalProperties": { "type": "string" },
+      "description": "Default output mapping for every completed child on the next-worker path. Keys are PARENT variable names; values are CHILD variable names. Failed / cancelled children skip the mapping. Per-worker overrides take precedence."
+    },
+    "perWorkerInputMappings": {
+      "type": "object",
+      "additionalProperties": { "type": "object", "additionalProperties": { "type": "string" } },
+      "description": "Per-worker input mapping overrides, keyed by child workflowId."
+    },
+    "perWorkerOutputMappings": {
+      "type": "object",
+      "additionalProperties": { "type": "object", "additionalProperties": { "type": "string" } },
+      "description": "Per-worker output mapping overrides, same fallback semantics."
+    }
   }
```

**Normative behavior.** For each `workerId` in `OrchestratorDecision.nextWorkerIds[]`, the dispatch node MUST:

```text
effectiveInputMapping  = perWorkerInputMappings[workerId]  ?? inputMapping  ?? {}
effectiveOutputMapping = perWorkerOutputMappings[workerId] ?? outputMapping ?? {}
```

1. Build child inputs: `childInputs[childKey] = parentVariables.get(parentKey)` for each `(childKey, parentKey)` in `effectiveInputMapping`. Unset parent variables MUST surface as `undefined` on child input (not omitted, not `null`).
2. Invoke child with built `childInputs`.
3. On child terminal `completed`, project child variables back: `parentVariables.set(parentKey, childVariables[childKey])` for each `(parentKey, childKey)` in `effectiveOutputMapping`.
4. On child terminal `failed` / `cancelled`, MUST skip `outputMapping`; parent variables stay at their pre-dispatch state for that child.

Hosts MUST NOT silently ignore non-empty mapping fields. A host that advertises `capabilities.agents.dispatch: true` but not `capabilities.agents.dispatchMapping: true` MUST refuse the workflow at registration with `validation_error` + `details.requiredCapability: "agents.dispatchMapping"`.

### B. `core.subWorkflow` — add `inputMapping`

Extend the normative §"`core.subWorkflow` contract" in `spec/v1/node-packs.md`:

```diff
 {
   "workflowId": "<child-workflow-id>",
   "waitForCompletion": true,
   "onChildFailure": "fail-parent" | "absorb",
+  "inputMapping": { "<childVar>": "<parentVar>" },
   "outputMapping": { "<parentVar>": "<childVar>" },
   "propagateCancellation": true
 }
```

**New normative bullet:**

> - `inputMapping` (optional, object): a `childVar → parentVar` map applied at child-run create time. For each `(childKey, parentKey)` pair, the host MUST seed the child workflow's initial variable bag with `childKey ← parentVariables[parentKey]`. The seeding overrides any `variables[].defaultValue` declaration on the child workflow with a matching name. Unset parent variables MUST surface as `undefined` on the child variable (not omitted, not `null`) — symmetric with `outputMapping`. The seeding fold is one-shot at run-create time; subsequent parent-variable mutations do NOT propagate to the child mid-run.

`inputMapping` interacts with the existing §"Variable seeding" rule as follows: child variables MUST first be folded from `variables[].defaultValue`, THEN overridden by `inputMapping` projections. The two are non-conflicting because `inputMapping` is host-supplied at runtime and `defaultValue` is author-supplied at workflow registration.

Hosts that advertise the existing `core.subWorkflow` surface but not the new `capabilities.subWorkflow.inputMapping: true` MUST refuse the workflow at registration with `validation_error` + `details.requiredCapability: "subWorkflow.inputMapping"` if any `inputMapping` field is non-empty.

### C. Capability advertisements

Add two new optional flags under `schemas/capabilities.schema.json`:

```diff
   "agents": {
     ...
+    "dispatchMapping": {
+      "type": "boolean",
+      "default": false,
+      "description": "Phase 6.1. When true, host honors inputMapping / outputMapping / perWorker{Input,Output}Mappings on DispatchConfig per RFC 0022 §A. Implies (but does not require) agents.dispatch: true."
+    }
   },
+  "subWorkflow": {
+    "type": "object",
+    "description": "Capability surface for `core.subWorkflow` extensions. Added by RFC 0022 §B; the baseline core.subWorkflow contract (RFC 0007 / node-packs.md §contract) is unconditional and does not need a capability flag.",
+    "properties": {
+      "inputMapping": {
+        "type": "boolean",
+        "default": false,
+        "description": "When true, host honors the inputMapping field on the core.subWorkflow config per RFC 0022 §B."
+      }
+    },
+    "additionalProperties": false
+  }
```

The two flags are independently advertisable: a host may add input-mapping support to `core.subWorkflow` without supporting it on `core.dispatch`, or vice versa. This matches the underlying implementation reality — they're separate code paths, and one may land before the other in a given host's roadmap.

### D. Fan-out interaction (`core.dispatch` only)

For `fanOutPolicy: 'sequential'` (default v1.x), children dispatch in order; the output mapping from child N is visible to child N+1's input mapping — the dispatch node operates on the same in-loop parent variable bag.

For `fanOutPolicy: 'parallel'` (out of scope for v1.x per RFC 0007 §K3), proposed future semantics (NOT normative in this RFC):

- Parallel fan-out + `outputMapping` would require each parallel child's effective `outputMapping` to target disjoint parent variables.
- A future `parallelMergeStrategy` field (`first-wins` / `last-wins` / `reject`) could relax this.

Either way, the parallel surface is deferred to the same future RFC that lands parallel fan-out.

### E. Positive + negative examples

**Positive (`core.dispatch`):**

```json
{
  "askUserRouting": "auto",
  "workerDispatchModel": "child-run",
  "fanOutPolicy": "sequential",
  "perWorkerInputMappings": {
    "brand-system": { "prdId": "currentPrdId" },
    "landing-page": { "prdId": "currentPrdId", "brandId": "currentBrandId" }
  },
  "perWorkerOutputMappings": {
    "foundation-prd": { "currentPrdId": "prdId" },
    "brand-system":  { "currentBrandId": "brandId" }
  }
}
```

**Positive (`core.subWorkflow`):**

```json
{
  "workflowId": "child-foundation-prd",
  "waitForCompletion": true,
  "onChildFailure": "fail-parent",
  "inputMapping":  { "templateHint": "currentTemplateHint" },
  "outputMapping": { "currentPrdId": "prdId" }
}
```

**Negative (`core.dispatch` — schema validation):**

```json
{ "inputMapping": "prdId" }
```

Reason: `inputMapping` must be an object string→string, not a string scalar.

**Negative (`core.subWorkflow` — capability validation):**

```json
{ "workflowId": "x", "inputMapping": { "a": "b" } }
```

On a host advertising `core.subWorkflow` but not `capabilities.subWorkflow.inputMapping: true`, registration MUST surface `validation_error` + `details.requiredCapability: "subWorkflow.inputMapping"`. Silent acceptance + ignore is NOT conformant.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1.

- All new fields (4 on dispatch, 1 on subWorkflow) are optional. Pre-RFC workflows that do not set them get bit-identical behavior to v1 baseline.
- No required-field changes, no event-shape changes, no `MUST` relaxation.
- New capability flags default to `false`. Hosts that do not advertise them continue to pass the existing RFC 0007 + subWorkflow-contract conformance surfaces unchanged.
- Workflows that use the new fields fail-closed at registration on hosts that don't advertise the matching flag (NOT silent acceptance).

## Conformance

Four new scenarios under `conformance/src/scenarios/`, capability-gated:

| Scenario                                | Gate                                          | Asserts                                                                                                                                                                                                                                                           |
| --------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatch-input-mapping.test.ts`        | `capabilities.agents.dispatchMapping: true`   | Supervisor emits `next-worker: ['child-a']`; dispatch's `inputMapping: { childGreeting: 'parentName' }`; child-a receives `inputs.childGreeting === parent's parentName`.                                                                                         |
| `dispatch-output-mapping.test.ts`       | `capabilities.agents.dispatchMapping: true`   | Child returns `variables: { childOutcome: 'done' }`; dispatch's `outputMapping: { parentResult: 'childOutcome' }`; parent's `parentResult === 'done'` after dispatch yields.                                                                                      |
| `dispatch-cross-worker-handoff.test.ts` | `capabilities.agents.dispatchMapping: true`   | Sequential fan-out: child-a writes `sharedVar` via `perWorkerOutputMappings`; child-b reads `inputs.input = parent's sharedVar` via `perWorkerInputMappings`.                                                                                                     |
| `subworkflow-input-mapping.test.ts`     | `capabilities.subWorkflow.inputMapping: true` | Parent's `currentPrdId='prd-1'`; subWorkflow config carries `inputMapping: { receivedPrdId: 'currentPrdId' }`; child run's initial variable bag has `receivedPrdId === 'prd-1'`, overriding the child workflow's `variables[].defaultValue.receivedPrdId` if set. |

Companion fixtures:

- `conformance/fixtures/conformance-dispatch-input-mapping.json`
- `conformance/fixtures/conformance-dispatch-output-mapping.json`
- `conformance/fixtures/conformance-dispatch-cross-worker-handoff.json`
- `conformance/fixtures/conformance-subworkflow-input-mapping.json`

Each scenario soft-skips on hosts that do not advertise the relevant capability flag. Validation-error scenarios covering the fail-closed registration path are OPTIONAL for this RFC's first cut.

## Alternatives considered

### A. Pass mappings through `OrchestratorDecision`

Have the supervisor emit `{kind: 'next-worker', nextWorkerIds: ['x'], inputMapping: {...}}`. **Rejected:** changes the canonical decision shape, requires a normative amendment to RFC 0006 for what is fundamentally an integration concern. The mapping belongs at the dispatch boundary (HOW the invocation is wired), not in the supervisor's decision (WHAT to dispatch). And it wouldn't help `core.subWorkflow` at all — author-time selection has no `OrchestratorDecision` to ride on.

### B. Generalize `core.subWorkflow` to take a list of workflowIds

Add `core.subWorkflow.workflowIds: string[]` and have it optionally fan out, eliminating `core.dispatch`. **Rejected** because `subWorkflow.config.workflowId` is author-time; supervisor selection is run-time. Conflating them muddles two distinct primitives — `subWorkflow` is the static-DAG sub-flow primitive, `dispatch` is the dynamic-DAG one.

### C. New `core.dispatchWithMapping` typeId (and `core.subWorkflowWithInputs`)

Ship sibling typeIds per gap. **Rejected** because every supervisor-driven workflow that grows beyond toy size will want mapping — additional indirection postpones the problem and creates typeId-pair confusion across the catalog. One field-additive change to two existing typeIds is cleaner than four typeIds total.

### D. Compose at the host level (vendor wrappers)

Hosts wrap `core.dispatch` and `core.subWorkflow` in their own `vendor.<host>.*` siblings. **Rejected:** vendor drift; cross-host workflow portability disappears.

### E. Do nothing

Leave both primitives half-functional and let workflow authors build hybrid DAGs with side-channel inputs. **Rejected:** the hybrid pattern is mechanical noise that doesn't survive contact with non-trivial supervisor-driven workflows. The production-use spike (Launch Studio adaptive supervisor) demonstrated this concretely. The cost of doing nothing accumulates with every supervisor-driven workflow authored.

### F. Couple both nodes behind ONE capability flag

Use a single `capabilities.workflowInvocation.runtimeMapping: true` that gates both. **Rejected** because the two surfaces are independently implementable in host code, and forcing them to land together creates an artificial barrier for hosts that want to ship one half first. Two flags is the more honest pattern.

## Unresolved questions

1. **Cardinality of `perWorker*` overrides.** Map keyed by `workflowId`. If two children of the same `workflowId` are dispatched in one `next-worker` decision, they share mapping. Probably fine — alternative would be keying by index in `nextWorkerIds[]` (rejected as fragile against decision reorderings during retry).

2. **Variable scoping for parallel fan-out.** Deferred to the future RFC alongside `parallelMergeStrategy` (RFC 0007 §K3 follow-up). This RFC normates sequential semantics only.

3. **Interaction with `passthrough` / `inheritContext`.** `core.subWorkflow` does not currently expose `passthrough`. Dispatch implicitly uses `inheritContext: true`. Recommend NOT adding `passthrough` here — `inputMapping`/`outputMapping` is the explicit channel. If implementer feedback disagrees, a follow-up RFC can add it.

4. **Validator warnings for unknown parent variables.** Should workflow registration warn (not fail) when a mapping references a parent variable not declared in `workflow.variables[]`? Suggest yes-as-warning, no-as-error — symmetric with `core.subWorkflow`'s existing `outputMapping` validator behavior. Not blocking.

5. **Mid-run `inputMapping` updates for `core.subWorkflow`.** The seeding fold is one-shot at child run-create time. Should mid-run parent-variable changes propagate to the child? Recommend NO — `core.subWorkflow` is synchronous-completion-based; the child is short-lived enough that mid-run propagation adds complexity without clear demand. Flagged for v1.3 reconsideration.

6. **Supervisor-mock extension for dispatch-trio conformance scenarios.** Added 2026-05-18 alongside the Postgres reference impl. HVMAP-1a / HVMAP-1b / HVMAP-1c require the conformance harness to drive specific `OrchestratorDecision` sequences per fixture (different `nextWorkerIds[]` shapes, different fan-out depths). The existing `core.orchestrator.supervisor` reference implementation emits a single hard-coded `next-worker: ['conformance-noop']` decision — fine for the original RFC 0007 dispatch-loop test, insufficient for these. Two candidate mechanisms: (a) add `node.config.mockDispatchPlan: OrchestratorDecision[]` to the supervisor block in `examples/hosts/postgres/src/server.ts` so fixtures can drive the decision script via per-node config; (b) wire the RFC 0023 `core.conformance.mock-agent` typeId to the supervisor side of the dispatch chain. Neither blocks the host's RFC 0022 wire-surface implementation (which IS complete); both are conformance-harness infrastructure. Promotion of RFC 0022 to `Accepted` is gated on whichever path lands.

## Implementation notes (non-normative)

Migration cost (reference impl):

| Concern                                           | Cost                                       | Notes                                                                  |
| ------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `schemas/dispatch-config.schema.json`             | ~25 LOC                                    | Drafted in §A; lands with this RFC                                     |
| `schemas/capabilities.schema.json`                | ~20 LOC                                    | Two new flags (§C); lands with this RFC                                |
| `spec/v1/node-packs.md` §contract                 | ~15 LOC prose                              | New `inputMapping` bullet + cross-link to RFC 0022 §B                  |
| Postgres reference host — `dispatch.node.ts`      | ~30 LOC                                    | Build child inputs from mapping; harvest child variables on completion |
| Postgres reference host — `subWorkflow.node.ts`   | ~15 LOC                                    | Seed child variables from `inputMapping` after defaultValue fold       |
| Postgres reference host — discovery advertisement | ~4 LOC                                     | Flip the two capability flags after the runtime patches land           |
| Conformance scenarios                             | 4 new server-driven scenarios + 4 fixtures | Mirrors existing subWorkflow/dispatch test patterns                    |

Downstream adoption (`vendor.myndhyve.launchStudioSupervisor`): the adaptive root collapses from a hybrid `dispatch + subWorkflow + side-channel` DAG to a sequence of `dispatch` invocations per phase — estimated ~80 LOC delta in the MyndHyve consumer post-merge.

## Acceptance criteria

- [x] Spec text merged (this file). (2026-05-18, cf7df05)
- [x] `schemas/dispatch-config.schema.json` updated with the four new fields. (2026-05-18, cf7df05)
- [x] `schemas/capabilities.schema.json` updated with `agents.dispatchMapping` AND `subWorkflow.inputMapping`. (2026-05-18, cf7df05)
- [x] `spec/v1/node-packs.md` §"`core.subWorkflow` contract" updated with the new `inputMapping` field + normative bullet. (2026-05-18, cf7df05)
- [x] `RFCS/0007-dispatch.md` references this RFC in a "See also" or amendment note. (2026-05-18, 02a84e1)
- [x] Four new conformance scenarios + four fixtures land in `conformance/`. (2026-05-18 — HVMAP-1a / HVMAP-1b / HVMAP-1c / HVMAP-2 happy paths landed as live behavioral tests against the Postgres reference host alongside the supervisor-mock extension. 2026-05-19 — full negative-path coverage closed: HVMAP-1a-null (unset-variable projection), HVMAP-1a-refusal + HVMAP-2-refusal (capability-refusal via the `host-toggle.ts` seam), HVMAP-1b-failed + HVMAP-1b-cancelled (child terminal-state outputMapping skip), HVMAP-1c-override (per-worker mapping precedence), HVMAP-2-unset (subWorkflow unset-parent-input projection), HVMAP-2-no-midrun-propagation (parent mid-run mutation suppression) — all now live `it()` blocks. Supporting fixtures: `conformance-dispatch-input-mapping-no-default.json`, `conformance-subworkflow-input-mapping-no-default.json`, `conformance-dispatch-per-worker-override.json`, `conformance-dispatch-deterministic-fail-child.json`, `conformance-dispatch-cancellable-child.json`. Capability-toggle seam: `conformance/src/lib/host-toggle.ts` backed by `POST /v1/host/sample/test/capability-toggle` on the reference workflow-engine. Republished as `@openwop/openwop-conformance@1.3.0`.)
- [x] At least one reference host implements + passes the new scenarios; INTEROP-MATRIX row reflects the new capability advertisements. (2026-05-18 — Postgres reference host advertises `capabilities.agents.dispatchMapping: true` + `capabilities.subWorkflow.inputMapping: true`; `dispatch.node` executor + `subWorkflow.node` executor wired per §A + §B; HVMAP-1a/1b/1c/2 happy paths pass end-to-end against the host's PGlite test harness.)
- [x] CHANGELOG entry under `[Unreleased]`. (2026-05-18)

All acceptance criteria met, including the full negative-path conformance coverage closed in `@openwop/openwop-conformance@1.3.0` (2026-05-19).

## References

- `RFCS/0006-orchestrator.md` — supervisor surface emitting `OrchestratorDecision`.
- `RFCS/0007-dispatch.md` — `core.dispatch` Accepted RFC (this RFC additively amends).
- `RFCS/0011-auth-scoped-discovery.md` — capability advertisement discipline.
- `schemas/dispatch-config.schema.json` — schema extended in §A.
- `schemas/capabilities.schema.json` — schema extended in §C.
- `spec/v1/node-packs.md` §"`core.subWorkflow` contract" — prose extended in §B.
- `COMPATIBILITY.md` §2.1 — additive-change rules.
- Production motivation: `vendor.myndhyve.launchStudioSupervisor` adaptive root (MyndHyve host implementation) — internal RFC at `docs/rfcs/openwop-dispatch-input-output-mapping.md`.

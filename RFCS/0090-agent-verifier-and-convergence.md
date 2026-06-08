# RFC 0090: Agent verifier turn + convergence criteria (multi-agent execution `version: 6`)

| Field | Value |
|---|---|
| **RFC** | 0090 |
| **Title** | A first-class verifier/critic turn (`agent.verified` event) + observable convergence criteria on the orchestrator `terminate` decision, so a multi-agent run can check work before committing and stop on a stated success condition rather than an opaque self-judgement |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-07 |
| **Updated** | 2026-06-07 (`Draft → Active` — comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus during the bootstrap phase, after a steward wire-shape review. The additive surface (the `agent.verified` event + `agentVerified` $def, the `verifier {supported,gating}` capability, the `executionModel.version` 5→6 ceiling, and the `successCriteria` on the `terminate` decision) is landed and validates: `spec-corpus-validity` green, the always-on `agent-verifier-shape.test.ts` passes, and the new protocol-tier `verifier-no-content-leak` invariant has its public test. **Wire shapes are now locked.** The behavioral `verifier-gating` scenario + the SDK type + a reference host advertising `version: 6` remain for `Active → Accepted`.) |
| **Affects** | `spec/v1/multi-agent-execution.md` (new §"Verifier and convergence (`version >= 6`)") · `schemas/run-event-payloads.schema.json` (NEW `agent.verified` event + `$def`) · `schemas/capabilities.schema.json` (`multiAgent.executionModel.version` ceiling 5→6; NEW optional `verifier` sub-block) · `schemas/orchestrator-decision.schema.json` (additive optional `successCriteria` on the `terminate` decision — lands at `Active`) · `api/asyncapi.yaml` (run-event channel note) · new conformance scenarios · `SECURITY/invariants.yaml` (`verifier-no-content-leak`) · `CHANGELOG.md` · `INTEROP-MATRIX.md` |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop models a supervisor that decides `next-worker` / `ask-user` / `terminate` (RFC 0006) and an agent that emits `agent.decided` with optional `confidence` (RFC 0002), but it has **no primitive for an independent check of a result before it is committed**, and **no observable record of *why* the orchestrator decided the goal was met**. This RFC adds a first-class verifier turn — a content-free `agent.verified { target, verdict, criteria?, confidence? }` event a critic emits over a prior result — and an additive optional `successCriteria` on the orchestrator's `terminate` decision, so a run's stopping condition is a stated, inspectable fact rather than the supervisor's opaque self-judgement. Both are additive, gated behind a new `multiAgent.executionModel.version: 6` + a `verifier` capability sub-block; hosts that don't advertise them are unchanged.

## Motivation

The state-of-the-art agent literature treats **planner–actor–critic** (a deliberation phase, an action phase, and an independent checking phase) as more reliable than single-shot answer generation, and identifies *premature stopping* and *unverified plausible-but-wrong output* as the dominant long-horizon failure modes (τ-bench pass^k collapse; DeepSearchQA stopping-criterion failures). openwop today expresses the planner (orchestrator) and the actor (worker / `agent.decided`) but **not the critic**:

1. **No verifier turn.** A worker's `agent.decided` is self-reported. Nothing in the wire lets an *independent* agent assert "I checked this result against criteria X and it passes/fails/needs revision," and nothing lets the loop branch on that verdict. The `confidence` field on `agent.decided` is the actor's own estimate, not a check.
2. **Opaque convergence.** `runOrchestrator.decided { decision: terminate }` (RFC 0006) ends the run with an optional free-text `reason`, but there is no *structured, observable* statement of the success criteria the supervisor judged satisfied. An operator auditing a run cannot tell whether the agent stopped because the goal was met or because it gave up.

The spec is the right place because a verifier verdict and a convergence record are **cross-host observability + control-flow contracts**: a SIEM consuming events from multiple hosts, a replay/`:fork` of a verified run, and an orchestrator that branches on "did the critic pass it?" all need one stable wire shape. The per-host *verification logic* (which model, which rubric) stays a host/agent choice; this RFC standardizes the *observable verdict* and the *stop condition*, additively.

## Proposal

### §A — The `agent.verified` event (NEW, content-free; normative when `verifier.supported`)

A critic agent emits `agent.verified` after checking a prior result (a worker's `agent.decided`, a sub-run's harvested output, or a tool result). It is **content-free** — it names *what* was checked and the *verdict*, never the checked content itself (mirrors the `eval.scored` / `memory.written` content-free precedent).

```diff
   "agent.decided":             { "$ref": "#/$defs/agentDecided" },
+  "agent.verified":            { "$ref": "#/$defs/agentVerified" },
   "runOrchestrator.decided":   { "$ref": "#/$defs/runOrchestratorDecided" },
```

```jsonc
"agentVerified": {
  "type": "object",
  "description": "RFC 0090. A critic agent's independent verdict over a prior result, emitted before the result is committed/merged. Content-free: names the target + verdict + (optional) the criteria keys checked, never the verified content.",
  "required": ["agentId", "target", "verdict"],
  "properties": {
    "agentId":  { "type": "string", "minLength": 3, "maxLength": 256,
                  "description": "AgentRef.agentId of the verifying (critic) agent. SHOULD differ from the agent whose work is being checked; a host MAY allow self-verification but MUST surface that the verifier == the actor." },
    "target":   { "type": "string", "minLength": 1,
                  "description": "Opaque reference to what was checked — the eventId of the verified `agent.decided`, a child runId, or a tool callId. Lets a consumer chain the verdict to its subject without re-deriving it." },
    "verdict":  { "type": "string", "enum": ["pass", "fail", "revise"],
                  "description": "`pass`: result is acceptable, the loop MAY commit/terminate. `fail`: result is rejected; the host MUST NOT commit it on a `verifier.gating` host. `revise`: result needs another actor turn — the host SHOULD route back to the actor rather than terminate." },
    "criteria": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true,
                  "description": "Optional closed list of the criteria KEYS the verifier evaluated (e.g. `[\"schema-valid\",\"grounded\",\"no-pii\"]`). Keys only — never the per-criterion verdict text — for SIEM safety." },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1,
                  "description": "Optional verifier confidence in `[0,1]`. Distinct from `agent.decided.confidence` (the actor's self-estimate): this is the critic's confidence in its own verdict. MAY drive the RFC 0039 escalation contract." },
    "causationHostId": { "type": "string", "minLength": 1,
                  "description": "RFC 0040 §A — cross-host causation pointer when the verified target lives on a different host." }
  },
  "additionalProperties": false
}
```

### §B — `verdict` control-flow contract (normative when `verifier.gating: true`)

A host advertising `verifier.gating: true` MUST treat the verdict as a gate before commit:

- `verdict: "fail"` over a sub-run output → the host MUST NOT apply the `outputMapping` / merge the output (composes the RFC 0063 fail-closed merge gate). The run SHOULD route to `ask-user` or another actor turn, MUST NOT silently terminate as success.
- `verdict: "revise"` → the host SHOULD dispatch another actor turn (a bounded retry under `maxLoopIterations`, RFC 0058), not terminate.
- `verdict: "pass"` → the host MAY proceed to commit/terminate.
- Absence of any `agent.verified` over a result is **not** a failure — verification is opt-in; only an *emitted* `fail`/`revise` gates.

A host advertising `verifier.supported: true` but `gating: false` emits the verdict for observability only (the orchestrator MAY still branch on it in its own logic); the host makes no commit-gating guarantee.

### §C — `successCriteria` on `terminate` (additive optional; lands at `Active`)

The orchestrator's `terminate` decision gains an additive optional `successCriteria` so the *reason a run converged* is structured and observable, not free text:

```diff
   "terminate": {
     "properties": {
       "reason": { "type": "string", "description": "Free-text rationale (existing)." },
+      "successCriteria": {
+        "type": "array", "items": { "type": "object", "additionalProperties": false,
+          "required": ["key", "met"],
+          "properties": {
+            "key": { "type": "string", "minLength": 1, "description": "Criterion identifier (e.g. `goal-answered`)." },
+            "met": { "type": "boolean", "description": "Whether the supervisor judged this criterion satisfied." }
+          } },
+        "description": "RFC 0090. Optional structured convergence record. When present, a terminate with any `met: false` entry signals a give-up (not a success); consumers MUST NOT treat such a run as goal-satisfied. Content-free: keys + booleans only."
+      }
     }
   }
```

### §D — Capability advertisement

```diff
   "version": {
-    "maximum": 5,
+    "maximum": 6,
     "description": "... 5 = Phase 5 (stateful agent-loop lifecycle, RFC 0061). 6 = Phase 6 (verifier turn + convergence criteria, RFC 0090). A host advertising version: N MUST implement all phases 1..N additively."
   },
+  "verifier": {
+    "type": "object",
+    "additionalProperties": false,
+    "required": ["supported"],
+    "properties": {
+      "supported": { "type": "boolean", "description": "Host emits `agent.verified` and honors §A. Applies only when version >= 6." },
+      "gating":    { "type": "boolean", "description": "Host enforces the §B commit-gating contract (a `fail` verdict blocks merge/terminate, fail-closed). Absent/false ⇒ verdict is observability-only." }
+    }
+  }
```

### Examples

**Positive.** Worker emits `agent.decided { agentId: "w1", decision: {...} }` (eventId `e42`). Critic emits `agent.verified { agentId: "critic", target: "e42", verdict: "pass", criteria: ["schema-valid","grounded"], confidence: 0.9 }`. On a `gating` host the supervisor then `terminate`s with `successCriteria: [{ key: "goal-answered", met: true }]`.

**Negative (gating).** Critic emits `agent.verified { ..., target: "e42", verdict: "fail" }`. On a `verifier.gating: true` host the worker's output MUST NOT be merged and the run MUST NOT terminate as success → non-conformant if it does.

**Negative (schema).** `agent.verified { agentId: "c", target: "e42", verdict: "ok" }` fails validation — `verdict` is the closed enum `pass|fail|revise`. `agent.verified` carrying a `result`/`content` field fails (`additionalProperties: false`) — the event is content-free.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). A new optional event type (pre-version-6 consumers never see it; unknown event types are already tolerated), an optional `successCriteria` field on an existing decision (absent ⇒ today's free-text terminate), a new optional `verifier` capability sub-block, and a `version` ceiling bump 5→6 (a host advertising ≤5 is unaffected; the enum widening is non-breaking). No existing field is moved, renamed, removed, or type-changed; no existing `MUST` is relaxed; no conformance pass is invalidated. The §B gating MUSTs only fire when a host advertises `verifier.gating: true`.

## Conformance

- **`agent-verified-shape.test.ts`** (always-on, server-free): the `agent.verified` payload validates; `verdict` enum is closed; content-free (`additionalProperties:false`); `successCriteria` validates on `terminate`.
- **`verifier-gating.test.ts`** (gated on `multiAgent.executionModel.verifier.gating`): a `fail` verdict over a sub-run output blocks the merge + prevents a success-terminate; a `pass` permits it; a `revise` routes to another actor turn within `maxLoopIterations`. Soft-skips when unadvertised.
- **`verifier-no-content-leak.test.ts`** (gated on `verifier.supported`): no `agent.verified` payload carries the verified content (only `target` + verdict + criteria keys) — the public test for the new SECURITY invariant.

## SECURITY

New protocol-tier invariant `verifier-no-content-leak` (`SECURITY/invariants.yaml`): an `agent.verified` payload MUST NOT contain the verified content (the result text, the tool output, or BYOK material) — only the opaque `target`, the `verdict`, and the closed `criteria` keys. Mirrors `eval-summary-no-content-leak`. Ships with `verifier-no-content-leak.test.ts` in the same PR.

## Alternatives considered

1. **Overload `agent.decided` with a `verifierVerdict` field.** Rejected — conflates the actor's self-estimate with an independent check; a separate event lets a *different* `agentId` own the verdict and lets consumers chain verdict→target cleanly.
2. **Reuse `eval.scored` (RFC 0081).** Rejected — eval is an out-of-band suite run (`mode: "eval"`) scoring an agent against a fixed test set; a verifier turn is *in-band* control flow over a live result. Different lifecycle, different gating semantics.
3. **Leave convergence as free-text `reason`.** Rejected — the give-up-vs-success ambiguity is exactly the premature-stopping failure mode the motivation cites; a structured `successCriteria` is the load-bearing fix prose can't provide.
4. **Make verification mandatory.** Rejected — would be breaking and is often unwanted (cheap, low-stakes turns). Opt-in via capability + per-result emission.

## Unresolved questions

1. **Self-verification.** Should `agent.verified.agentId == agent.decided.agentId` be forbidden, or merely surfaced? Proposed: surfaced (a host MAY allow it but MUST make verifier identity inspectable). Confirm before `Active`.
2. **`revise` retry budget.** Should the spec pin a default max revise-loops, or defer entirely to `maxLoopIterations` (RFC 0058)? Proposed: defer to RFC 0058; no new bound.
3. **Verifier ↔ confidence interaction.** When both `agent.decided.confidence` (actor) and `agent.verified.confidence` (critic) are below floor, which drives the RFC 0039 escalation? Proposed: either below floor escalates (logical OR). Confirm.

## Acceptance criteria

- [ ] `spec/v1/multi-agent-execution.md` §"Verifier and convergence (`version >= 6`)" with §A–§D.
- [ ] `run-event-payloads.schema.json` `agent.verified` + `agentVerified` `$def`; `capabilities.schema.json` version 6 + `verifier` block; `orchestrator-decision.schema.json` `successCriteria` (Active).
- [ ] Conformance: `agent-verified-shape.test.ts` (always-on) + `verifier-gating.test.ts` + `verifier-no-content-leak.test.ts` (gated).
- [ ] `SECURITY/invariants.yaml` `verifier-no-content-leak` + matching public test.
- [ ] CHANGELOG entry under `[Unreleased]`; INTEROP-MATRIX row.
- [ ] All three Unresolved questions resolved (record in `Updated:`).
- [ ] `Active → Accepted`: at least one host advertises `version: 6` + `verifier` and passes the gated scenarios non-vacuously.

## References

- [`RFCS/0002-agent-identity-and-reasoning-events.md`](./0002-agent-identity-and-reasoning-events.md) — `agent.decided` + `confidence` this complements.
- [`RFCS/0006-orchestrator.md`](./0006-orchestrator.md) — the `terminate` decision §C extends.
- [`RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md`](./0039-multi-agent-confidence-and-memory-lifecycle.md) — the confidence-escalation contract the verifier confidence composes with.
- [`RFCS/0063-subrun-output-attestation-and-merge-gating.md`](./0063-subrun-output-attestation-and-merge-gating.md) — the fail-closed merge gate §B composes.
- [`RFCS/0081-agent-evaluation-and-scorecards.md`](./0081-agent-evaluation-and-scorecards.md) — the content-free `eval.scored` precedent + the out-of-band contrast (Alt 2).
- [`spec/v1/multi-agent-execution.md`](../spec/v1/multi-agent-execution.md) — the doc this extends.

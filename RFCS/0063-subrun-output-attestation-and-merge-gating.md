# RFC 0063: Sub-run output attestation & merge gating (`core.subWorkflow.outputAttestation`)

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0063                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Title**         | An optional `outputAttestation` config on `core.subWorkflow` — a content checksum surfaced on the child's terminal event, plus an optional `requireApproval` gate that suspends via an `approval` interrupt (RFC 0051) _before_ `outputMapping` merges a child's outputs into the parent, so a parent can verify and approve sub-agent artifacts rather than merging them blindly                                                                                                                                                                                                             |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Created**       | 2026-05-25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Updated**       | 2026-05-25 (Active → Accepted — Milestone 2: the in-memory reference host advertises `capabilities.agents.subRunAttestation` and implements the `POST /v1/host/sample/subrun/attest` seam end-to-end — §B byte-stable JCS+SHA-256 `attestation` checksum (key-order-invariant), §C merge gate that merges only on `accept`/`edit-accept` and fails CLOSED on `reject`/absent/expired; the `subrun-merge-approval-fail-closed` invariant landed in `SECURITY/invariants.yaml` with `subrun-approval-fail-closed.test.ts` as its public test; all four conformance scenarios are live + green.) |
| **Affects**       | `spec/v1/node-packs.md` (`core.subWorkflow` config) · `schemas/capabilities.schema.json` (`agents.subRunAttestation`) · `schemas/run-event-payloads.schema.json` (additive optional `attestation` on `coreWorkflowChainEvent`, phase `output.harvested`) · `RFCS/0007` (dispatch) · `RFCS/0051` (approval gate, reused) · `RFCS/0049` (RBAC scope narrowing) · new conformance scenarios · proposed SECURITY invariant `subrun-merge-approval-fail-closed` (lands at implementation)                                                                                                          |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Summary

openwop sub-workflows (`core.subWorkflow` / RFC 0007 dispatch) already spawn isolated, tenant-scoped child runs with `inputMapping` / `outputMapping` and depth/cycle caps. What they lack is _verification before merge_: the parent applies `outputMapping` directly on the child's terminal, with no checksum and no approval gate. This RFC adds an optional `outputAttestation` block on `core.subWorkflow`: when `checksum: true` the host computes and surfaces a content hash of the child's harvested outputs on the existing `core.workflowChain.event { phase: 'output.harvested' }` (RFC 0037) via an additive optional `attestation` field — not a new event — so the parent can verify integrity; when `requireApproval: true` the host MUST suspend via an `approval` interrupt (RFC 0051) _before_ merging, so a human or policy gate accepts/rejects/edits the sub-agent's artifact. Both are additive and opt-in — existing sub-workflows are unchanged.

## Motivation

The feature set's sub-agent acceptance criterion is explicit: "each sub-agent has isolated permissions, and **parent can verify checksums and approvals before merging**." The isolation half exists (the `apps/workflow-engine` dispatcher inherits `tenantId` to prevent cross-tenant escalation). The verification half does not: `subWorkflowDispatcher.ts` copies child outputs into parent variables the instant the child reaches `completed`, with no integrity check and no gate. For autonomous fan-out — a supervisor dispatching N workers whose outputs are then merged — blind merge means a single compromised or hallucinated child artifact silently enters the parent's state.

The spec is the right place because "what exactly was merged, and was it approved" is an auditability + safety guarantee for multi-agent orchestration, and the checksum must be computed the same way across hosts for a parent to verify a child that ran on a _different_ host (RFC 0040 cross-host causation).

## Proposal

### §A — `core.subWorkflow` config extension (`node-packs.md`, additive)

```diff
   {
     "workflowId": "<child>",
     "inputMapping": { "...": "..." },
     "outputMapping": { "...": "..." },
+    "outputAttestation": {
+      "checksum": true,
+      "algorithm": "sha256",
+      "requireApproval": false,
+      "principalScope": ["report:write"]
+    }
   }
```

All fields optional; an absent `outputAttestation` is exactly today's behavior.

### §B — checksum (normative, when `checksum: true`)

After the child reaches a terminal status and its outputs are harvested but **before** `outputMapping` is applied, the host MUST:

1. Compute a canonical hash (default `sha256`) over the child's harvested output object, using the canonical-JSON serialization already defined for replay (`spec/v1/` replay rules), so the hash is host-independent.
2. Surface it as an additive optional `attestation { checksum, algorithm }` object on the existing `core.workflowChain.event { phase: 'output.harvested' }` (RFC 0037 — the event already fires at exactly this transition, carrying `harvestedKeys[]`), AND on the sub-workflow node's `node.completed` data (`outputs.attestation.checksum`). No new event type: the `output.harvested` phase _is_ the merge point.
3. Apply `outputMapping` as today. The checksum is _advisory for verification_ — the parent (or a downstream node) MAY compare it against an expected value and fail the parent if it diverges; the host does not itself reject on checksum (that is policy, expressed as a parent node).

### §C — approval gate (normative, when `requireApproval: true`)

When `requireApproval: true`, the host MUST, after harvest and **before** `outputMapping`, suspend the parent via an `approval` interrupt (RFC 0051) carrying the child's outputs as the artifact (`actions: ['accept', 'reject', 'edit', 'ask']`). The merge proceeds **only** on `accept` or `edit-accept`:

- `accept` → apply `outputMapping` with the child's outputs unchanged.
- `edit-accept` → apply `outputMapping` with the approver's `editedArtifactData`.
- `reject` → do not merge; surface per the node's `onChildFailure` policy (`fail-parent` or `absorb`).

This MUST **fail-closed**: if the run terminates or the interrupt expires without an `accept`/`edit-accept`, the outputs MUST NOT be merged. (Proposed protocol-tier SECURITY invariant `subrun-merge-approval-fail-closed`, landing with its conformance test at implementation.)

### §D — permission narrowing (optional)

`principalScope` (when present) narrows the child run's effective scopes to the named RFC 0049 scopes — a child dispatched to "write a report" can be denied "delete data" even though the parent principal holds it. Reaffirms and tightens the existing tenant-inheritance isolation.

**Positive example.** Supervisor dispatches a research worker with `{ checksum: true, requireApproval: true }`. Child completes → `core.workflowChain.event { phase: 'output.harvested', attestation: { checksum: 'sha256:ab…' } }` → parent suspends with an approval interrupt → operator `accept` → `outputMapping` merges. Audit log shows the checksum and the approver.
**Negative example.** Same, operator never responds and the run is cancelled → outputs are **not** merged (fail-closed); parent surfaces the child as unmerged.

## Compatibility

**Additive.** `outputAttestation` is an optional config block; absent ⇒ identical to today's blind merge. The `attestation` field is an additive optional property on the existing `core.workflowChain.event` `output.harvested` phase (RFC 0037; its `required` array is unchanged, consumers ignore the field). The approval gate reuses the existing RFC 0051 interrupt machinery — no new interrupt kind. No existing `core.subWorkflow` field, the `outputMapping` contract, or any `MUST` changes for workflows that don't opt in. No conformance pass invalidated.

## Conformance

- **`subrun-attestation-shape.test.ts`** — `outputAttestation` config validates. (Always runs where `core.subWorkflow` is supported.)
- **`subrun-checksum-stable.test.ts`** — a child's checksum is byte-stable for identical outputs and host-independent (matches the canonical-JSON recipe). (Gated on `agents.subRunAttestation`.)
- **`subrun-approval-gate.test.ts`** — `requireApproval: true` suspends before merge; `accept` merges, `reject` does not. (Gated.)
- **`subrun-approval-fail-closed.test.ts`** — a parent that terminates without approval does not merge the child outputs. (Gated; backs the invariant.)

The three gated scenarios drive the **sub-run attestation seam** `POST /v1/host/sample/subrun/attest` (request `{ childOutputs, outputAttestation: { checksum?, algorithm?, requireApproval?, principalScope? }, approvalAction? }` → `{ attestation, harvestedEvent, merged, mergedValues? }`), specified in [`host-sample-test-seams.md`](../spec/v1/host-sample-test-seams.md) §"Open seams". A host advertising `capabilities.agents.subRunAttestation: true` wires it to light them up; they soft-skip on `404` until then.

## Alternatives considered

1. **Tell authors to insert a separate `core.interrupt` node after the sub-workflow.** Rejected — that gates _after_ the merge already happened (the child outputs are in parent variables before the manual interrupt runs), so it can't prevent a bad artifact from entering parent state; the gate must be _intrinsic_ to the merge step.
2. **Always checksum + always require approval.** Rejected — most sub-workflows are trusted internal fan-out where a mandatory gate would break automation; opt-in keeps the common case zero-friction.
3. **A bespoke "merge approval" interrupt kind.** Rejected — RFC 0051's `approval` kind with `edit`/`reject` already models exactly this; a new kind would duplicate it.

## Unresolved questions

1. **Checksum canonicalization source.** Confirm the canonical-JSON recipe reused here is the same one RFC 0041 pins for replay cache keys, so a cross-host child's checksum verifies. Resolve before Active.
2. **Partial fan-out approval.** When a supervisor dispatches N children with `requireApproval`, is it N interrupts or one batched approval? Proposed: one interrupt per child for v1; batching is a later optimization. Decide before Active.
3. **`principalScope` vs. RFC 0049.** Is scope narrowing expressed here or purely in RFC 0049's RBAC surface? Proposed: this references RFC 0049 scopes, doesn't define new ones. Confirm.

## Phase-0 resolution (architect ruling, 2026-05-25)

Per `docs/autonomous-agent-runtime-plan.md` §8 — Unresolved questions resolved (wire shape pinned; Active-ready pending schema + prose):

1. **Checksum canonicalization** → reuse the RFC 8785 JCS recipe pinned in `replay.md §"LLM cache-key recipe" §B` (+ the no-JCS fallback) then SHA-256 — no new recipe (ruling B). Guarantees cross-host verification.
2. **Partial fan-out approval** → one `approval` interrupt per child for v1; batching is a later optional optimization.
3. **`principalScope` vs RFC 0049** → references RFC 0049 scopes only; defines no new scopes. The additive `attestation` field on `core.workflowChain.event` is confirmed non-breaking (ruling A; `additionalProperties:false` → declared in `properties`).

## Implementation notes (non-normative)

- `apps/workflow-engine`: `subWorkflowDispatcher.ts` (`outputMapping` at the harvest step) is the single insertion point — compute checksum + populate the `output.harvested` event's `attestation` field; if `requireApproval`, route through the existing suspend/interrupt path before the mapping copy. Effort: small–medium.

## Acceptance criteria

- [x] `node-packs.md` `core.subWorkflow` `outputAttestation` section.
- [x] `agents.subRunAttestation` capability + additive optional `attestation` object on `coreWorkflowChainEvent` (run-event-payloads schema). No new event type.
- [x] Conformance: shape always-on; checksum/approval/fail-closed capability-gated — all four `subrun-*.test.ts` scenarios live + green against the in-memory host.
- [x] `subrun-merge-approval-fail-closed` invariant + public test landed in `SECURITY/invariants.yaml` (protocol-tier), with `subrun-approval-fail-closed.test.ts` as its public test.
- [x] CHANGELOG entry under `[1.1.4 — unreleased]`.
- [x] **Milestone 2 — reference-host enforcement (`Active → Accepted`).** The in-memory reference host (`examples/hosts/in-memory`) advertises `capabilities.agents.subRunAttestation: true` and implements the `POST /v1/host/sample/subrun/attest` seam (`host-sample-test-seams.md`): §B surfaces a byte-stable `attestation { checksum: <JCS+SHA-256 of childOutputs>, algorithm: 'sha256' }` (key-order-invariant via the host's `stableStringify`) on the harvested-output shape; §C merges the child outputs only on `approvalAction` `accept`/`edit-accept` and fails CLOSED (`merged: false`, no `mergedValues`) on `reject`/absent/expired when `requireApproval: true`. Reuses RFC 0051 `approval` + RFC 0049 scopes — no new interrupt kind, event type, or error code.

## References

- [`RFCS/0007-dispatch.md`](./0007-dispatch.md) — sub-workflow / dispatch this extends.
- [`RFCS/0051-approval-deployment-gate-primitive.md`](./0051-approval-deployment-gate-primitive.md) — the approval interrupt reused for the merge gate.
- [`RFCS/0049`](./0049-rbac-scopes-and-authorization-decisions.md) — the scopes `principalScope` narrows to.
- [`spec/v1/interrupt.md`](../spec/v1/interrupt.md) — `approval` kind shape + resume actions.

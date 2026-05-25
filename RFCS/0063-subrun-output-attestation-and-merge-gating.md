# RFC 0063: Sub-run output attestation & merge gating (`core.subWorkflow.outputAttestation`)

| Field | Value |
|---|---|
| **RFC** | 0063 |
| **Title** | An optional `outputAttestation` config on `core.subWorkflow` — a content checksum surfaced on the child's terminal event, plus an optional `requireApproval` gate that suspends via an `approval` interrupt (RFC 0051) *before* `outputMapping` merges a child's outputs into the parent, so a parent can verify and approve sub-agent artifacts rather than merging them blindly |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `spec/v1/node-packs.md` (`core.subWorkflow` config) · `schemas/capabilities.schema.json` (`agents.subRunAttestation`) · `api/asyncapi.yaml` (`subRun.attested` event) · `RFCS/0007` (dispatch) · `RFCS/0051` (approval gate, reused) · `RFCS/0049` (RBAC scope narrowing) · new conformance scenarios · proposed SECURITY invariant `subrun-merge-approval-fail-closed` (lands at implementation) |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop sub-workflows (`core.subWorkflow` / RFC 0007 dispatch) already spawn isolated, tenant-scoped child runs with `inputMapping` / `outputMapping` and depth/cycle caps. What they lack is *verification before merge*: the parent applies `outputMapping` directly on the child's terminal, with no checksum and no approval gate. This RFC adds an optional `outputAttestation` block on `core.subWorkflow`: when `checksum: true` the host computes and surfaces a content hash of the child's harvested outputs (on the terminal event + a `subRun.attested` event) so the parent can verify integrity; when `requireApproval: true` the host MUST suspend via an `approval` interrupt (RFC 0051) *before* merging, so a human or policy gate accepts/rejects/edits the sub-agent's artifact. Both are additive and opt-in — existing sub-workflows are unchanged.

## Motivation

The feature set's sub-agent acceptance criterion is explicit: "each sub-agent has isolated permissions, and **parent can verify checksums and approvals before merging**." The isolation half exists (the `apps/workflow-engine` dispatcher inherits `tenantId` to prevent cross-tenant escalation). The verification half does not: `subWorkflowDispatcher.ts` copies child outputs into parent variables the instant the child reaches `completed`, with no integrity check and no gate. For autonomous fan-out — a supervisor dispatching N workers whose outputs are then merged — blind merge means a single compromised or hallucinated child artifact silently enters the parent's state.

The spec is the right place because "what exactly was merged, and was it approved" is an auditability + safety guarantee for multi-agent orchestration, and the checksum must be computed the same way across hosts for a parent to verify a child that ran on a *different* host (RFC 0040 cross-host causation).

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
2. Surface it on the sub-workflow node's `node.completed` data (`outputs.attestation.checksum`) and emit `subRun.attested { childRunId, checksum, algorithm }`.
3. Apply `outputMapping` as today. The checksum is *advisory for verification* — the parent (or a downstream node) MAY compare it against an expected value and fail the parent if it diverges; the host does not itself reject on checksum (that is policy, expressed as a parent node).

### §C — approval gate (normative, when `requireApproval: true`)

When `requireApproval: true`, the host MUST, after harvest and **before** `outputMapping`, suspend the parent via an `approval` interrupt (RFC 0051) carrying the child's outputs as the artifact (`actions: ['accept', 'reject', 'edit', 'ask']`). The merge proceeds **only** on `accept` or `edit-accept`:

- `accept` → apply `outputMapping` with the child's outputs unchanged.
- `edit-accept` → apply `outputMapping` with the approver's `editedArtifactData`.
- `reject` → do not merge; surface per the node's `onChildFailure` policy (`fail-parent` or `absorb`).

This MUST **fail-closed**: if the run terminates or the interrupt expires without an `accept`/`edit-accept`, the outputs MUST NOT be merged. (Proposed protocol-tier SECURITY invariant `subrun-merge-approval-fail-closed`, landing with its conformance test at implementation.)

### §D — permission narrowing (optional)

`principalScope` (when present) narrows the child run's effective scopes to the named RFC 0049 scopes — a child dispatched to "write a report" can be denied "delete data" even though the parent principal holds it. Reaffirms and tightens the existing tenant-inheritance isolation.

**Positive example.** Supervisor dispatches a research worker with `{ checksum: true, requireApproval: true }`. Child completes → `subRun.attested { checksum: 'sha256:ab…' }` → parent suspends with an approval interrupt → operator `accept` → `outputMapping` merges. Audit log shows the checksum and the approver.
**Negative example.** Same, operator never responds and the run is cancelled → outputs are **not** merged (fail-closed); parent surfaces the child as unmerged.

## Compatibility

**Additive.** `outputAttestation` is an optional config block; absent ⇒ identical to today's blind merge. `subRun.attested` is additive observability. The approval gate reuses the existing RFC 0051 interrupt machinery — no new interrupt kind. No existing `core.subWorkflow` field, the `outputMapping` contract, or any `MUST` changes for workflows that don't opt in. No conformance pass invalidated.

## Conformance

- **`subrun-attestation-shape.test.ts`** — `outputAttestation` config validates. (Always runs where `core.subWorkflow` is supported.)
- **`subrun-checksum-stable.test.ts`** — a child's checksum is byte-stable for identical outputs and host-independent (matches the canonical-JSON recipe). (Gated on `agents.subRunAttestation`.)
- **`subrun-approval-gate.test.ts`** — `requireApproval: true` suspends before merge; `accept` merges, `reject` does not. (Gated.)
- **`subrun-approval-fail-closed.test.ts`** — a parent that terminates without approval does not merge the child outputs. (Gated; backs the invariant.)

## Alternatives considered

1. **Tell authors to insert a separate `core.interrupt` node after the sub-workflow.** Rejected — that gates *after* the merge already happened (the child outputs are in parent variables before the manual interrupt runs), so it can't prevent a bad artifact from entering parent state; the gate must be *intrinsic* to the merge step.
2. **Always checksum + always require approval.** Rejected — most sub-workflows are trusted internal fan-out where a mandatory gate would break automation; opt-in keeps the common case zero-friction.
3. **A bespoke "merge approval" interrupt kind.** Rejected — RFC 0051's `approval` kind with `edit`/`reject` already models exactly this; a new kind would duplicate it.

## Unresolved questions

1. **Checksum canonicalization source.** Confirm the canonical-JSON recipe reused here is the same one RFC 0041 pins for replay cache keys, so a cross-host child's checksum verifies. Resolve before Active.
2. **Partial fan-out approval.** When a supervisor dispatches N children with `requireApproval`, is it N interrupts or one batched approval? Proposed: one interrupt per child for v1; batching is a later optimization. Decide before Active.
3. **`principalScope` vs. RFC 0049.** Is scope narrowing expressed here or purely in RFC 0049's RBAC surface? Proposed: this references RFC 0049 scopes, doesn't define new ones. Confirm.

## Implementation notes (non-normative)

- `apps/workflow-engine`: `subWorkflowDispatcher.ts` (`outputMapping` at the harvest step) is the single insertion point — compute checksum + emit `subRun.attested`; if `requireApproval`, route through the existing suspend/interrupt path before the mapping copy. Effort: small–medium.

## Acceptance criteria

- [ ] `node-packs.md` `core.subWorkflow` `outputAttestation` section.
- [ ] `agents.subRunAttestation` capability + `subRun.attested` (AsyncAPI + payload schema).
- [ ] Conformance: shape always-on; checksum/approval/fail-closed capability-gated.
- [ ] `subrun-merge-approval-fail-closed` invariant + public test land in `SECURITY/invariants.yaml` at implementation.
- [ ] CHANGELOG entry under `[1.1.4 — unreleased]`.

## References

- [`RFCS/0007-dispatch.md`](./0007-dispatch.md) — sub-workflow / dispatch this extends.
- [`RFCS/0051-approval-deployment-gate-primitive.md`](./0051-approval-deployment-gate-primitive.md) — the approval interrupt reused for the merge gate.
- [`RFCS/0049`](./0049-rbac-scopes-and-authorization-decisions.md) — the scopes `principalScope` narrows to.
- [`spec/v1/interrupt.md`](../spec/v1/interrupt.md) — `approval` kind shape + resume actions.

# OpenWOP Spec v1 — Compensation and Partial-Failure Profile

> **Status: Draft · v1.x (2026-08-16) — RFC 0151 `Accepted`, profile carried.** Normative surface for [RFC 0151 — Compensation and Partial-Failure Profile](../../RFCS/0151-compensation-and-partial-failure-profile.md): the host-ordered, persisted, retried unwind of committed business effects after a later node fails. This document covers **only what has landed on the wire** — the `compensation` capability family (§A), the node-level declaration (§B), the six `compensation.*` events and the run-level `compensationStatus` rollup (§D), and the replay rule (§F). RFC 0151's own header records that the profile is `Accepted` as text and **carried forward** as implementation; the sections still carried are named in [Open spec gaps](#open-spec-gaps) rather than implied. (2026-08-16: §B gained the workflow-level policy, `settings.compensation`.) Companion to [`capabilities.md`](./capabilities.md), [`stream-modes.md`](./stream-modes.md) (how the events surface), [`replay.md`](./replay.md), [`interrupt.md`](./interrupt.md) (RFC 0051 approvals), [`host-capabilities.md` §host.deadLetter](./host-capabilities.md#hostdeadletter) (RFC 0053), and [`host-sample-test-seams.md`](./host-sample-test-seams.md) §21. Keywords MUST, SHOULD, MAY, MUST NOT, SHOULD NOT follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

## Why this exists

A cancelled or failed run does not undo the effects it already committed — a charge
was made, an email went out, a record was written in a system the host does not own.
Before RFC 0151 the corpus had retries, replay effect suppression, and a run-level
dead-letter queue, but no portable contract for **undoing business effects after a
later node fails**: no declaration of the inverse action, no ordering rule, no
retry-stable identity for the inverse, no partial-compensation state, no event
taxonomy, and no operator recovery path. Every host that needed one reinvented it
feature-locally, and a client could not tell from the wire whether an unwind had
happened, half-happened, or been abandoned.

Compensation is **a second effect, not an undo**. It can fail, can be partially
applied, can itself be harmful, and can require approval — which is why the profile
is capability-gated and security-tier high (RFC 0147 R9), why `compensationStatus`
is a rollup with `partial` in it rather than a boolean, and why the run's own
forward `status` is never reinterpreted to carry it.

## §A — Capability

A host that orders, persists, and retries the unwind advertises
`capabilities.compensation` per
[`capabilities.schema.json`](../../schemas/capabilities.schema.json):

```json
{
  "compensation": {
    "supported": true,
    "profileVersion": "1",
    "orderingModels": ["reverse-completion"],
    "manualIntervention": true
  }
}
```

- Absent means the host offers **no generic compensation contract** — NOT that it
  never compensates. A workflow can always model an inverse action as an ordinary node;
  what the advert claims is that the *host* runs the unwind so a client can rely on it.
- A host that advertises the family MUST implement `reverse-completion` and MAY
  additionally implement `dependency-graph`; `dependency-graph` MUST be a DAG and
  preserve reverse dependency order.
- `profileVersion` participates in the inverse-action identity (§C), so a profile bump
  cannot silently collide with identities minted under the previous ordering rules.

## §B — Node declaration

A node declares its inverse action with the closed `compensation` object on the
workflow node (`workflow-definition.schema.json`):

- `nodeTypeId` MUST resolve at registration time, so an unwind cannot fail on a typo
  discovered only during a failure — the worst possible moment to learn of one.
- `inputMapping` MUST derive from **recorded facts** (node outputs and run inputs
  already in the event log). Prompt or model regeneration MUST NOT construct a
  compensation input during replay: an inverse built from a re-inferred value is not
  the inverse of what was actually done.
- `retry.maxAttempts` / `retry.backoffMs` bound the inverse action's own retries.
- `requiresApproval: true` gates the inverse effect behind the same RFC 0051 approval
  surface as a forward effect (§E, carried).
- A host MUST reject a compensation cycle.

### Workflow policy: `settings.compensation`

The node declaration says **what** the inverse action is. The workflow-level policy —
the reserved `settings.compensation` key on `WorkflowDefinition`, shape
[`compensation-policy.schema.json`](../../schemas/compensation-policy.schema.json) —
says **when** the host starts an unwind and **how** it runs one:

```json
{
  "settings": {
    "compensation": {
      "profileVersion": "1",
      "orderingModel": "reverse-completion",
      "triggers": ["node-failure", "run-cancel"],
      "retry": { "maxAttempts": 3, "backoffMs": 500 },
      "timeoutMs": 30000,
      "exhaustedDisposition": "record-outcome",
      "approvalScope": "declared",
      "onParentCancel": "continue"
    }
  }
}
```

- `triggers` is REQUIRED and closed: `node-failure` (a node reaches terminal failure after
  its own RFC 0009 retry policy), `run-cancel` (an RFC 0094 cancel accepted while committed
  effects exist), `cap-breach` (an RFC 0058 / RFC 0084 `cap.breached` hard stop),
  `operator-request` (an authorized §E request, RFC 0049-bound). **A trigger not listed
  does not start an unwind** — the run ends with its effects in place and
  `compensationStatus: none`. No generic rollback is inferred from an undeclared trigger.
- `orderingModel` and `profileVersion` MUST be ones the host advertises; a host that
  advertises `compensation` MUST validate the policy at registration and refuse a workflow
  that names an unadvertised model or version (`validation_error`), so an unwind never
  learns at failure time that its ordering rule is unimplemented.
- `retry` / `timeoutMs` are defaults for inverse actions whose node declaration carries
  none. **A node's own bounds always win.**
- `exhaustedDisposition` chooses between recording the failure and continuing
  (`record-outcome`, default) and stopping for an operator (`manual-intervention`, which
  emits `compensation.manual_intervention_required` and requires
  `capabilities.compensation.manualIntervention: true`). Either way the run MUST route to
  RFC 0053 dead-letter handling (§E) and the rollup follows the §D fold.
- `approvalScope` can only **escalate** (`declared` → `all`); there is no `none`, because
  a policy MUST NOT strip an approval a node declared for itself (RFC 0147 R9).
- `onParentCancel` — `continue` | `pause` | `manual` — is §C's rule that cancelling the
  parent MUST NOT silently abandon an active unwind, made author-selectable.
- The policy is **authored, not per-run**: there is deliberately no run-options overlay. A
  per-run caller who could lower approval scope or drop a trigger would be authorizing
  their own unwind.

**A host that does NOT advertise `capabilities.compensation` MUST refuse a workflow that
carries `settings.compensation`** with `capability_required`
(`details.requiredCapability: "compensation"`, per
[`capabilities.md`](./capabilities.md) §"Unsupported capability — refusal contract" and
[`rest-endpoints.md`](./rest-endpoints.md) §Error codes) rather than accept it silently.
Accepting a policy the host will never honour tells the author an unwind will happen when
it will not — RFC 0148 §B's advertise-and-opt-out failure with the sign flipped. Node-level
`compensation` declarations alone remain acceptable on any host: they describe an inverse
action; the policy is what requests the unwind.

## §D — Events and the run rollup

### Events

Six content-free events, all in the closed `RunEventType` enum
([`run-event.schema.json`](../../schemas/run-event.schema.json), payloads in
[`run-event-payloads.schema.json`](../../schemas/run-event-payloads.schema.json)):

| Event | Meaning |
| --- | --- |
| `compensation.requested` | The plan is persisted — before the first inverse action. |
| `compensation.started` | The first inverse action has started. |
| `compensation.completed` | **Every** inverse action in the plan succeeded. |
| `compensation.failed` | **An** inverse action exhausted its retries (carries a closed `reason`). |
| `compensation.paused` | Paused for authorized intervention (carries a closed `reason`). |
| `compensation.manual_intervention_required` | Operator action is required (carries a closed `reason`). |

Payloads carry opaque `compensationId` / `nodeId` / `effectId`, `attempt`, the
`orderingModel`, and — where present — a **closed** `reason` vocabulary
(`retries-exhausted`, `approval-denied`, `authority-denied`, `dead-lettered`,
`operator-terminated`). Provider bodies and credentials MUST NOT appear: these events
land in the durable log, the least revocable place a credential can reach (§G).

`compensation.requested` MUST precede `compensation.started` for the same plan. A host
that begins unwinding before persisting the plan cannot resume after a crash — and the
crash is precisely when resumption matters (§C).

### Run rollup: `compensationStatus`

`RunSnapshot` (`GET /v1/runs/{runId}`,
[`run-snapshot.schema.json`](../../schemas/run-snapshot.schema.json)) is the **sole
owner** of the OPTIONAL field
`compensationStatus: none | pending | running | completed | partial | failed | manual`.
Debug bundles and the AsyncAPI `run.snapshot` message reuse the snapshot by `$ref` and
therefore carry it unchanged. This resolves RFC 0151 Unresolved Question 3.

The field is kept **separate from `status`** on purpose. `status` is the *forward*
execution state and a closed union exported by the SDK; RFC 0151 forbids
reinterpreting it, so there is deliberately no `compensating` run status. A run can be
`failed` (forward) and `completed` (unwind) at the same time, and that is the normal
successful outcome of a compensation.

**Gating.**

- A host that does not advertise `capabilities.compensation` MUST omit the field.
- A host that advertises it MUST include the field on every snapshot, with `none` when
  no compensation was ever requested for that run.

Presence is therefore a wire witness of the advert: a consumer never has to decide
whether a `none` from a host that would never unwind means "unwind is monitored here".

**Fold.** The value is the deterministic fold of the §D events over the persisted plan.
A host MUST derive it as follows; a conformance witness that reads both the events and
the snapshot asserts exactly this table.

| Value | When |
| --- | --- |
| `none` | No `compensation.requested` has been recorded for the run. |
| `pending` | `compensation.requested` recorded and `compensation.started` has not. |
| `running` | `compensation.started` recorded and the plan is still active. A §E approval pause (`compensation.paused` while an RFC 0051 approval interrupt is open) does **not** change it — the run's own `status: waiting-approval` and `interrupt` already carry the wait, which is why the two fields are separate. |
| `completed` | Every inverse action in the persisted plan completed. |
| `partial` | The plan is no longer active, at least one inverse action completed, and at least one did not (failed, skipped with recorded justification, or terminated). Reported, never rounded: collapsing it to `failed` erases the refund that did go through; to `completed`, claims an unwind that half-happened. |
| `failed` | The plan is no longer active and no inverse action completed. |
| `manual` | `compensation.manual_intervention_required` recorded and not yet resolved by an authorized operator. Takes precedence over `partial` / `failed` while unresolved; on resolution the value becomes whichever of those the recorded outcomes yield. |

`completed` is the only terminal value that never moves again: re-running a completed
inverse is a double refund. `failed` is **not** terminal at the inverse-action level — a
transient failure MUST be retryable without minting a second obligation (§C identity).

## §F — Replay

Replay defaults MUST use recorded compensation outcomes and MUST NOT re-fire inverse
effects: a replay that re-executes inverse effects turns a recovery into a second
outage. A live-effect branch MAY execute compensation only after explicit authorization
and with fresh effect IDs. The `compensation-replay-no-refire` invariant
(`SECURITY/invariants.yaml`) is registered against `compensation-behavior.test.ts`.

## Conformance

- Shape (always-on, server-free): `compensation-profile.test.ts` — the §A family, the
  §B declaration, and the §B policy admit exactly the shapes above and reject the ones
  they forbid (closed triggers, escalate-only approval scope, `$ref` enforced through the
  workflow schema); the `compensationStatus` enum is closed.
- Behavior (gated on `compensation.supported`, hard-fails under
  `OPENWOP_REQUIRE_BEHAVIOR=true`): `compensation-behavior.test.ts` — plan before first
  effect, reverse-completion order, replay does not re-fire, content-free events, and the
  snapshot rollup matching the fold table above. Driven through the seams in
  [`host-sample-test-seams.md`](./host-sample-test-seams.md) §21.
- Until a host advertises the family and wires the seams, the behavioral requirements
  resolve to `blocked` per RFC 0148 §A — not to a pass.

## Open spec gaps

| # | Gap | Disposition |
| - | --- | ----------- |
| G1 | §C lifecycle prose — plan persistence shape, the inverse-action identity tuple `(tenantId, runId, forwardLogicalInvocationId, compensationOrdinal, profileVersion)`, crash-resume, and cancellation-of-parent rules | **Carried.** The identity is stated in RFC 0151 §C and composes with RFC 0150 §B `logicalInvocationId`; §C's semantic digest is not landed, so the composition cannot be specified end-to-end here yet. |
| G2 | §E approvals, dead-letter routing, and the operator recovery actions (retry / skip with justification / substitute / terminate as uncompensated) and their audit | **Carried.** The rollup table above already names the outcomes those actions produce so the field's meaning does not depend on §E landing. |
| G3 | ~~`schemas/compensation-policy.schema.json` — the policy that decides which failures qualify for automatic compensation~~ | **Closed 2026-08-16.** Landed as `settings.compensation` on `WorkflowDefinition` (§B "Workflow policy"): closed `triggers`, ordering model, retry/timeout defaults, `exhaustedDisposition`, escalate-only `approvalScope`, `onParentCancel`. Refusal rule for non-advertising hosts (`capability_required`) stated. |
| G4 | `compensationStatus` on a forked run (`POST /v1/runs/{runId}:fork`) of a partially compensated source | **Open.** RFC 0151 §F says the branch preserves source facts without claiming it changed the source system; whether the child reports the source's rollup or starts at `none` is unresolved and is deliberately not decided by this document. |
| G5 | Compensation evidence retention minimum | **Open** (RFC 0151 UQ5). |

## References

- [RFC 0151 — Compensation and Partial-Failure Profile](../../RFCS/0151-compensation-and-partial-failure-profile.md) · [RFC 0147](../../RFCS/0147-protocol-integrity-and-standards-readiness-program.md) (program, R9) · [RFC 0150](../../RFCS/0150-effect-identity-replay-and-split-brain-safety.md) (effect identity) · [RFC 0148](../../RFCS/0148-non-vacuous-conformance-certification.md) (`blocked` disposition)
- [`capabilities.md`](./capabilities.md) · [`stream-modes.md`](./stream-modes.md) · [`replay.md`](./replay.md) · [`interrupt.md`](./interrupt.md) · [`host-capabilities.md` §host.deadLetter](./host-capabilities.md#hostdeadletter) · [`host-sample-test-seams.md`](./host-sample-test-seams.md) §21
- Schemas: [`capabilities.schema.json`](../../schemas/capabilities.schema.json) (`compensation`) · [`workflow-definition.schema.json`](../../schemas/workflow-definition.schema.json) (node `compensation`, `settings.compensation`) · [`compensation-policy.schema.json`](../../schemas/compensation-policy.schema.json) · [`run-event.schema.json`](../../schemas/run-event.schema.json) · [`run-event-payloads.schema.json`](../../schemas/run-event-payloads.schema.json) · [`run-snapshot.schema.json`](../../schemas/run-snapshot.schema.json) (`compensationStatus`)

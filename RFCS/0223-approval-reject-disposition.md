# RFC 0223: a rejected approval gate fails closed, and the failure is routable

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0223                                                            |
| **Title**         | a rejected approval gate fails closed, and the failure is routable |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-28                                                      |
| **Updated**       | 2026-09-29 — gap G11 closed and `0223.replay-derives-rejection` witnessed: the v2 reference host's certified public cut on suite 2.44.6 (openwop-examples #139, build `commit:0b04cacc`, witness `188a23d56886`) records both `executed-pass`, so the falsifiability table now names both by their full requirement ids. · 2026-09-28 — **`Active → Accepted`, provisional pending the RFC 0156 §B retrospective review** (steward override of RFC 0147 §A.6, register row `not-reviewed`). Evidence tier: tier-1 — the v2 reference host's certified public cut on published suite 2.43.1 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop #1754, main `022ad5e9`; host copy openwop-examples #130; build `commit:76354246`, no relaxations, 430 pass / 0 fail / 0 blocked / 66 inapplicable / 7 skipped, all three claimed profiles certified, witness `763dd7f6a209`, signed `v2-reference-4`). It records `0223.reject-fails-run`, `reject-recorded`, `reject-fails-node`, `quorum-reject-fails-run`, `reject-routed`, `timeout-rejects` and `timeout-never-grants` `executed-pass`. Single witness (a reference example, not a production host). `0223.reject-loopback-reasks` has no witness on any host (gap G11), and the replay row has no leg yet; both are declared in the falsifiability table. · 2026-09-28 — Class 3 correction (openwop #1724): `approval.rejected` goes from SHOULD to MAY, because no one payload satisfies both majors (§A note; `docs/COMPATIBILITY-CORRECTIONS-LOG.md`). · 2026-09-28 — second acceptance box ticked: the v2 reference host's certified public cut on suite 2.43.0 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop #1727: 406 pass / 0 fail / 0 blocked, no relaxations, signed `v2-reference-4`, host build `commit:bc8cc30e`) records `0223.reject-fails-run`, `reject-recorded`, `reject-fails-node` and `quorum-reject-fails-run` `executed-pass`. Still `Active`: the timeout witness box (G2, G10) waits for a certified cut on suite 2.43.1, which needs fresh operator approval. · 2026-09-28 — Class 3 correction (openwop #1697): `key` is per visit, so a gate re-entered over a reject loop is asked again (§A note; G8 closed; row `0223.reject-loopback-reasks`). · 2026-09-28 — Class 3 correction (openwop #1696): a timeout never grants the gate, whatever `onTimeout` holds (§A timeout bullet, §C, Unresolved 2; G7 closed; `docs/COMPATIBILITY-CORRECTIONS-LOG.md`). · 2026-09-28 — conformance only (openwop #1700): the routed and timeout legs and their fixtures land (`0223.reject-routed`, `0223.timeout-rejects`); gaps G1 and G2 closed. No rule changed. · 2026-09-28 — amended in place with openwop-app evidence (evidence only, no decision changed): the `majority` threshold moves from an open question to a measured fact, and openwop-app's per-path gaps are recorded under §Compatibility. · 2026-09-28 — filed and moved `Draft → Active` in the filing PR (openwop #1692). **Comment window waived** by the steward. **STEWARD OVERRIDE of RFC 0147 §A.6**, which forbids a bootstrap waiver from shortening the window for RFCs affecting authorization and replay; an approval gate's outcome is an authorization decision (as it was for RFC 0213 §C), and §A's last rule governs replay. Logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". The evidence gate is not waived: `Accepted` waits for a certified host bundle that records the three `0223.reject-*` rows `executed-pass`, and the RFC 0156 §B retrospective review is owed. |
| **Affects**       | `spec/v2/core/interrupt.md` §Approval (new §Rejection; one sentence at `timeoutMs`) · `spec/v2/errors.json` (`approval_rejected`, `since` 2.43; the generated `schemas/v2/error-envelope.schema.json` and the `errors.md` table follow) · `schemas/v2/suspend-request.schema.json` (`ApprovalData.onTimeout` description only) · conformance: `v2-approval-reject-disposition.test.ts`, a coherence leg in `v2-error-registry-prose-parity.test.ts`, `fixtures.md` (suite 2.43.0) |
| **Compatibility** | `additive` — a new registry row and a new normative requirement on a behaviour the v2 text left undefined (`COMPATIBILITY.md` §4, §2.4). No schema shape, status or existing code changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

v2 says what an approval gate's `reject` is, but not what it does. `interrupt.md` §Approval lists `reject` as an action that exits the suspend and stops there: nothing says whether the node fails, whether the run ends, or with which code. `timeoutMs` has the same hole. All three v2 hosts already fail the run on a reject, two of them with `approval_rejected`, which the registry does not hold. This RFC states that behaviour: the gate fails closed with the newly registered `approval_rejected`, and the run continues only over an edge that explicitly admits a failed source.

## Motivation

- **The v2 text had no answer.** `interrupt.md` §Approval (before this RFC) names the five actions and the quorum fields. It says nothing about what a `reject` does to the node or the run. §Re-entry (`timeoutMs`, "the interrupt's own deadline") says nothing about what happens when the deadline passes. `schemas/v2/suspend-request.schema.json` gives `ApprovalData.onTimeout` three values and no rule for its absence.
- **The hosts agree on behaviour, and emit an unregistered code.** Measured 2026-09-28:
  - v2 reference host (openwop-examples `76d522f`), `examples/hosts/v2-reference/src/executor.ts:491-497`: `node.failed` then `run.failed { failedNodeId }`, code `approval_rejected`.
  - openwop-app (`2ac0de965`), `backend/typescript/src/routes/interrupts.ts:1314-1340` (single reject), `:1233-1255` (quorum reject), `src/executor/approvalGateTimeout.ts:122` (timeout): `run.failed`, code `approval_rejected`.
  - MyndHyve (`2fa3c03d0`), `packages/workflow-engine/src/nodes/core/approvalGate.node.ts:82,173-182`: the node fails with `APPROVAL_REJECTED`, `retryable: false`. That spelling is neither registered nor a valid vendor code (`errors.md` §The registry).
  - `spec/v2/core/overview.md` §0 says a producer MUST NOT emit an unregistered member, so all three are non-conforming today on the code alone.
- **Both production hosts also route a reject.** Each keeps a custom node (`core.chat.approvalGate`, openwop-app's reinvoke lane) that turns a reject into an output and follows conditioned edges. A rule that always ended the run would outlaw that.
- **v1 answered it for the timeout, and fail-open is already ruled out.** RFC 0093 (`spec/v1/interrupt-profiles.md:103`): a timed-out gate MUST resolve rejected with reason `timeout`, and auto-approving "fails open and is non-conformant". v1's "a reject loops the run back per the workflow's edges" (`:94`) applied to the RFC 0051 governance gate node, whose workflows carried the loop-back edge. The v1 core primitive returned the reject to the node as a value (`spec/v1/interrupt.md` §`ApprovalResume`).
- **The corpus already has the pattern.** A declined `credential` interrupt fails its node with the registered `connector_auth_declined` (RFC 0199 §C.4, `oauth.md` §The credential interrupt). A run that ends on a limit fails with a registered 422 (`run_timeout`, `runs.md` §`run` section). `WorkflowEdge.triggerRule` (`all_complete`, `any_failed`) already lets a run continue past a failed node (RFC 0125, witnessed by openwop-app #1272).

## Proposal

### §A. The rule (`spec/v2/core/interrupt.md` §Rejection)

> A `reject` exits the suspend. The host MUST record `action: "reject"` and `decision: "rejected"` on `interrupt.resolved`, and MAY also emit `approval.rejected`. The resume value is returned to the node that raised the interrupt (§Re-entry and resume values).
>
> *(Corrected 2026-09-28, Class 3, openwop #1724. This read "SHOULD also emit `approval.rejected`". On v2 that event is byte-identical to `interrupt.resolved { decision: "rejected" }`, which is already a MUST, and it descends from the deprecated legacy interrupt payloads (`openwop.deprecation.legacy-interrupt-payloads`). A dual-major host cannot satisfy both definitions with one payload: the v1 definition is closed and requires `gateId` and `principal`, and the v2 definition is the closed `interruptResolved` shape, which requires `nodeId` and `interruptId` and admits neither v1 key. The event cannot be projected per major either, because a timeout rejection has no `resolvedBy`, while v1 requires `principal`. `persistence.md` already bars serving a payload the v1 wire cannot carry. So the SHOULD could not be honoured by a host serving both majors, and it becomes a MAY.)*
>
> - A node that does not turn the rejection into an output MUST fail with `approval_rejected` and `retryable: false` on the `node.failed` error, and MUST NOT be retried.
> - A rejected gate is a failed source. It MUST NOT satisfy an `all_success`, `any_success` or `none_failed` edge. The run continues past it only over an edge whose `triggerRule` admits a failed source (`all_complete` or `any_failed`).
>
> *(Clarified 2026-09-28, Class 3, openwop #1697.) A gate re-entered over such an edge is a new invocation: `interrupt.md` §Re-entry now derives `key` per visit, so the second visit raises a new `interrupt.requested` and never replays the first rejection. Before this, the one-interrupt-per-key rule could be read as forbidding the loop this bullet permits.*
> - When no such edge exists, the run MUST terminate `failed` with `run.failed.error.code` `approval_rejected` and `failedNodeId` naming the gate.
> - The gate resolves rejected on one eligible `reject` under `single-veto`, or when rejects exceed half of `requiredApprovals` under `majority`. A vote that does not decide the gate MUST NOT emit `interrupt.resolved`.
> - When a non-zero `timeoutMs` elapses with no resolution, the host MUST resolve the gate rejected, recording `action: "timeout"`, `decision: "rejected"` and `reason: "timeout"`, whatever `onTimeout` holds, and MUST apply the rules above. A timeout MUST NOT grant a gate. A host MUST treat `onTimeout: "approve"` as `reject` and SHOULD NOT emit it. `escalate` MAY notify a host-defined target but MUST NOT extend or grant the gate. A host MUST NOT accept `timeout` on a resume request.
>
> *(Corrected 2026-09-28, Class 3, openwop #1696. This bullet read "When a non-zero `timeoutMs` elapses with no resolution and `onTimeout` is absent or `reject`, …", which left `approve` and `escalate` undefined and so re-legalised the fail-open timeout RFC 0093 ruled non-conformant.)*
> - On replay the failure MUST be derived from the recorded `interrupt.resolved`, never re-decided.

`timeoutMs` in §Re-entry now points here. Each field the rule names already exists: `action`, `decision` and `reason` on `interruptResolved` (RFC 0183 §A.1/§A.3, RFC 0186 §A.2), `failedNodeId` on `runFailed`, `retryable` on the event error object, `triggerRule` on `WorkflowEdge`. `action: "timeout"` being record-only is already stated on `interruptResolved.action`; the rule repeats it at the point a host implements the timer.

- **Why fail, not return a value.** A value the run ignores is an approval in effect: an unrouted `reject` would complete the run. Failing closed is what every host does, and RFC 0093 already chose it for the timeout.
- **Why the failure stays routable.** A workflow that wants the reject to go somewhere (back to the author, to an escalation) says so with an edge. `triggerRule` exists for exactly this, and a custom node that returns the reject as an output is still allowed. The run is never silently continued.
- **Why `none_failed` is listed.** The draft in #1692 named only `all_success` and `any_success`. `none_failed` is the third member of the `WorkflowEdge.triggerRule` enum that a failed source does not satisfy, so leaving it out would have read as permission.
- **Why `decision: "rejected"` on the timeout row.** A timeout resolves the gate rejected (RFC 0093). The rule's first sentence names `decision` for every reject, and a timeout is one.

### §B. The code (`spec/v2/errors.json`)

```json
{
  "code": "approval_rejected",
  "meaning": "An approval gate resolved rejected (a decision, a quorum or a timeout) and no edge routed the failure, so the node and the run failed.",
  "httpStatus": 422,
  "statusSource": "v2 decision",
  "retriable": false,
  "details": null,
  "since": "2.43",
  "source": "RFC 0223; spec/v2/core/interrupt.md §Rejection"
}
```

- **422, like `run_timeout`.** The code ends a run and appears on `run.failed` and the snapshot's `error`; no resolve request answers with it. The status is the registry's convention for a run-ending code.
- **`since` 2.43.** A new registry row changes the packed `@openwop/spec-artifacts` tree, which the release rules make a minor: 2.42.8 is published, so this cycle is 2.43.0 (the 2.42.0 precedent, `replay_context_summary_unavailable`).

### §C. A timeout never grants the gate

*(Corrected 2026-09-28, Class 3, openwop #1696. This section was titled "`onTimeout` absent means `reject`" and defined only that case.)* Whatever `onTimeout` holds, a timed-out gate resolves rejected. `approve` is treated as `reject` and SHOULD NOT be emitted: RFC 0093 ruled auto-approval on timeout fail-open and non-conformant, and RFC 0186 §A.3 seated the value from measured payloads without revisiting that ruling. The enum keeps `approve`, because recorded payloads carry it and removing a member is a major. `escalate` MAY notify a host-defined target but MUST NOT extend or grant the gate. The `ApprovalData.onTimeout` description says so. No JSON-Schema `default` is added: a validator that fills defaults would write a value the host never recorded.

*Measured basis (MyndHyve production, read-only, 2026-09-28): 0 of 170 stored workflow definitions set any grant-on-timeout key (`onTimeout`, `approvalTimeout`, `autoApproveOnTimeout`, `hitlConfig.timeoutAction`); none of the 101 approval nodes sets a timeout at all; 0 of 22,169 runs (all time) and 1,419 suspensions were auto-approved on timeout. The only grant path is `core.chat.approvalGate` (`src/core/workflow/nodes/chat/approvalGate.node.ts:602-606`), and it is inert in production: both production hosts use `FirestoreSuspendManager`, which ignores `timeoutResumeValue` and rejects with `SUSPEND_TIMED_OUT`, so only the in-memory fallback could grant. No conforming or production behaviour is removed in practice.*

### Examples

**Conforming.** `conformance-approval` (one gate, no edges) resolved `{ action: "reject" }`: `interrupt.resolved { action: "reject", decision: "rejected" }`, `node.failed { nodeId: "gate", error: { code: "approval_rejected", retryable: false } }`, `run.failed { error: { code: "approval_rejected" }, failedNodeId: "gate" }`, status `failed`. The same gate with an outgoing `any_failed` edge to a `notify` node: the gate fails, `notify` runs, and the run can complete.

**Non-conforming.** A reject that completes a run with no failure-admitting edge. A reject that fails the run with `APPROVAL_REJECTED` or any other unregistered code. An `interrupt.resolved` after the first of three votes under `majority`. A timeout that approves because `onTimeout` was absent.

## Compatibility

`additive` under `COMPATIBILITY.md` §4 ("a new normative requirement on a previously-undefined behavior") and §2.4 (a new registry member). No schema shape changes.

Following the RFC 0183/0186 practice, the rule codifies what hosts measurably do, and the measurement is stated rather than assumed. `COMPATIBILITY.md` P3 allows a change only when nothing conforming stops conforming. On the code alone, no host conforms today: each emits a code the registry does not hold (two of them `approval_rejected`, which this RFC registers). Measured against the full rule:

| Host | Terminal `failed` + code | `action` on `interrupt.resolved` | `node.failed` + `failedNodeId` |
| --- | --- | --- | --- |
| v2 reference host | yes | **no** (records `decision` only) | yes |
| openwop-app | yes | **no** on single reject, timeout and quorum reject (see below) | **no** (no `node.failed`; `run.failed` has no `failedNodeId`) |
| MyndHyve | **no** (`APPROVAL_REJECTED`) | not measured | not measured |

`action` on an approval-kind `interrupt.resolved` was already a MUST (`interrupt.md` §Events, RFC 0183), so that column is an existing defect, not a new one. The `node.failed` / `failedNodeId` column is new. The follow-ups are gap register rows G3–G5.

**openwop-app, per path** (measured 2026-09-28 on openwop-app `origin/main`, read-only; added in place after filing):

| Path | `interrupt.resolved` | `action` | `approval.rejected` | `node.failed` / `failedNodeId` |
| --- | --- | --- | --- | --- |
| accept / refine / edit-accept (`routes/interrupts.ts:1368-1378`, `resolvedActionFields` `:695`) | yes | yes | — | — |
| single reject (`routes/interrupts.ts` ~`:1320-1328`) | yes, `decision: "rejected"` | **no** | **never emitted** | **no** |
| timeout (`executor/approvalGateTimeout.ts:95-111`) | yes | **no** | **never emitted** | **no** |
| quorum reject (`routes/interrupts.ts:1233-1263`) | **none** — only `run.failed` | **no** | **never emitted** | **no** |
| non-deciding quorum vote | none (correct, §A) | — | — | — |

openwop-app fixes these in its own repository before the corpus release, as MyndHyve renames its code.

*Observation, not part of this change:* on a non-deciding vote openwop-app emits `interrupt.vote.recorded`, a type the event registry does not hold (overview.md §0). It is recorded here because the quorum row reads the same event log; it is neither required nor forbidden by this RFC.

## Conformance

`v2-approval-reject-disposition.test.ts` (target major 2, gated on the `interrupt` family). Each row is its own `it`, so a host fails only the row it misses:

1. `openwop.requirement.0223.reject-fails-run`: `conformance-approval` resolved `reject` terminates `failed`, with `approval_rejected` on the snapshot and on `run.failed`.
2. `openwop.requirement.0223.reject-recorded`: that run's `interrupt.resolved` carries `action: "reject"` and `decision: "rejected"`.
3. `openwop.requirement.0223.reject-fails-node`: the gate's `node.failed` carries `approval_rejected` with `retryable: false`, and `run.failed.failedNodeId` is `gate`.
4. `openwop.requirement.0223.quorum-reject-fails-run` (gated on the `conformance-interrupt-quorum` fixture, `inapplicable` when not advertised): one reject of three under `majority` leaves the run `waiting-approval` and emits no `interrupt.resolved`; the second fails the run with `approval_rejected`. The votes are distinguished by the resume value's `voter`, as in the major-1 `interrupt-quorum-resolution`; a host that counts both as one principal records `blocked`, not a failure.
5. `openwop.requirement.0223.reject-routed` (gated on `conformance-approval-reject-routed`; added 2026-09-28, gap G1): the rejected gate still fails as a node (`approval_rejected`, `retryable: false`), its `any_failed` target runs to `node.completed`, its `all_success` target never runs, and the run completes. `node.skipped` is not required: §A says the `all_success` edge is not satisfied, not how a host records that.
6. `openwop.requirement.0223.timeout-rejects` (gated on `conformance-approval-timeout`, a 1500 ms `timeoutMs` with no `onTimeout`; added 2026-09-28, gap G2): left unresolved, the gate is resolved by the host with `action: "timeout"`, `decision: "rejected"`, `reason: "timeout"`; it fails with `approval_rejected`, and `run.failed` carries the code and `failedNodeId: "gate"`.
7. `openwop.requirement.0223.timeout-never-grants` (gated on `conformance-approval-timeout-approve`, a 1500 ms `timeoutMs` with `onTimeout: "approve"`; added 2026-09-28, openwop #1696): the timed-out gate resolves rejected (`action: "timeout"`, `decision: "rejected"`), fails with `approval_rejected`, and the run fails. It never completes.
8. `openwop.requirement.0223.reject-loopback-reasks` (gated on `conformance-approval-reject-loopback`, which only a host that runs cycles advertises; added 2026-09-28, openwop #1697): rejected once, the gate is visited again, raises a second `interrupt.requested` with a different `key`, the run is `waiting-approval` again, and only one `interrupt.resolved` is recorded.

Coherence (server-free): a second leg in `v2-error-registry-prose-parity.test.ts` (`openwop.requirement.0223.code-registered`) checks the registry row, its prose home and that `onTimeout` declares no `default`.

**Committed certified witness:** the v2 reference host's certified public cut on suite 2.43.0 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop #1727: 406 pass / 0 fail / 0 blocked, no relaxations, signed `v2-reference-4`, host build `commit:bc8cc30e`) records rows 1–4 `executed-pass`. Rows 5–8 need suite 2.43.1 and a new cut.

Measured on the v2 reference host (a local copy of openwop-examples `76d522f`, `:memory:` store, against this tree's `spec-artifacts`): `reject-fails-run` `executed-pass`; `reject-recorded` and `reject-fails-node` `executed-fail` (no `action` on `interrupt.resolved`, no `retryable: false` on `node.failed`); the quorum row `inapplicable` (no quorum fixture). Positive control: adding exactly those two fields to the copy's `resolveAndResume` turned all three rows `executed-pass`. The quorum row was not run against a host that advertises the fixture.

The major-1 `interrupt-quorum-resolution` leg is **not** tightened to the code: v1 registers no `approval_rejected`, so asserting it there would fail every conforming v1 host. The major-2 leg above carries the tightening instead.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A an unrouted reject fails the run with `approval_rejected` (`openwop.requirement.0223.reject-fails-run`) | terminal snapshot and `run.failed` codes | the suite, on `conformance-approval` | witnessable — gated |
| §A the reject is recorded with `action` and `decision` (`openwop.requirement.0223.reject-recorded`) | `interrupt.resolved` payload | the suite, as above | witnessable — gated |
| §A the node fails not retryable and `failedNodeId` names it (`openwop.requirement.0223.reject-fails-node`) | `node.failed`, `run.failed` payloads | the suite, as above | witnessable — gated |
| §A the majority threshold and no resolve on a non-deciding vote (`openwop.requirement.0223.quorum-reject-fails-run`) | run status and events between votes | the suite, on `conformance-interrupt-quorum` | witnessable — gated |
| §A a failure-admitting edge continues the run | the downstream node runs | the suite, on `conformance-approval-reject-routed` (`openwop.requirement.0223.reject-routed`) | witnessable — gated |
| §A the timeout disposition | `interrupt.resolved { action: timeout }` and the failure | the host's timer, on `conformance-approval-timeout` (`openwop.requirement.0223.timeout-rejects`) | witnessable — gated |
| §A a timeout never grants, whatever `onTimeout` holds (openwop #1696) | `interrupt.resolved { action: timeout, decision: rejected }` and a failed run on `conformance-approval-timeout-approve` (`openwop.requirement.0223.timeout-never-grants`) | the host's timer | witnessable — gated |
| §A (note, openwop #1697) a gate looped back is asked again under a new `key` (`openwop.requirement.0223.reject-loopback-reasks`) | a second `interrupt.requested` with a different `key` on `conformance-approval-reject-loopback` | only a host that runs cycles (the v2 reference host since openwop-examples #137; gap G11, closed) | witnessable — gated |
| §A replay derives, never re-decides | a `replay` fork taken at the gate's recorded `interrupt.resolved` raises no new `interrupt.requested`, carries the source's `decision` / `action` / `reason`, fails the same way, and answers a resolve with `409 interrupt_already_resolved` | the suite, through `replay` (`openwop.requirement.0223.replay-derives-rejection`, openwop #1756; legs A reject and B timeout; suite 2.44.4) | witnessable — gated |
| §B the code is registered (`openwop.requirement.0223.code-registered`) | `spec/v2/errors.json` | the corpus gate | witnessable — unaided (corpus) |

## Alternatives considered

1. **Return the reject to the node as a value and let the run continue (the v1 core primitive).** Rejected: an unrouted reject then completes the run, which is an approval in effect. No v2 host does it.
2. **Always terminate the run.** Rejected: it outlaws the custom routing nodes both production hosts run, and gives authors no way to handle a reject.
3. **Register `approval_rejected` and say nothing else.** Rejected: hosts would agree on the code and still disagree on whether a `reject` may be routed or retried, and the timeout would stay undefined.

## Unresolved questions

1. ~~**The `majority` threshold.**~~ *Resolved 2026-09-28 by measurement, not by decision; this item previously read as open.* "Rejects exceed half of `requiredApprovals`" is what openwop-app does: `backend/typescript/src/host/reviewDecisionLedger.ts:209` (`evaluateQuorumTally`) sets the reject threshold under `majority` to `Math.floor(requiredApprovals / 2) + 1`, which is rejects > n/2, and it checks accept first. Its default is `any` (single veto), and the wire tokens `single-veto` / `majority` map onto it (`:111-137`). v1 had left the rule to host documentation (`interrupt-profiles.md` §openwop-interrupt-quorum). Gap G6 is closed, and openwop #1699 with it.
2. ~~**`onTimeout: "approve"`**~~ *Resolved 2026-09-28 by a Class 3 correction (openwop #1696); this item previously read as open.* A timeout never grants: `approve` is treated as `reject` (§A, §C). Gap G7 is closed.

## Implementation notes (non-normative)

- v2 reference host: record `action` (and `reason` for timeout and quorum), emit `approval.rejected`, fail through the scheduler so `triggerRule` applies, implement the timeout. A separate openwop-examples PR.
- openwop-app: record `action` on the single-reject and timeout `interrupt.resolved`; emit `interrupt.resolved` on the quorum-reject path; emit `approval.rejected`; emit `node.failed` and set `failedNodeId` on the single and quorum reject paths. This is in openwop-app's own scope, before the corpus release.
- MyndHyve: rename `APPROVAL_REJECTED` to `approval_rejected` and re-cut its bundle.

## Acceptance criteria

- [x] `Active`: the `interrupt.md` §Rejection rule, the `approval_rejected` row, the `onTimeout` description, and the scenarios (suite 2.43.0).
- [x] `0223.reject-fails-run`, `0223.reject-recorded` and `0223.reject-fails-node` `executed-pass` on a committed certified host bundle: the v2 reference host's certified public cut on suite 2.43.0 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop #1727: 406 pass / 0 fail / 0 blocked, no relaxations, signed `v2-reference-4`, host build `commit:bc8cc30e`). `0223.quorum-reject-fails-run` is `executed-pass` there too.
- [x] A witness for the timeout disposition (G2): `0223.timeout-rejects` and `0223.timeout-never-grants` `executed-pass` on the v2 reference host's certified public cut on published suite 2.43.1 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop #1754, main `022ad5e9`; host copy openwop-examples #130; build `commit:76354246`, no relaxations, 430 pass / 0 fail / 0 blocked / 66 inapplicable / 7 skipped, all three claimed profiles certified, witness `763dd7f6a209`, signed `v2-reference-4`). `0223.reject-routed` passes on the same cut.
- [x] A witness for the loop-back re-ask (G11) and for replay deriving a rejection (openwop #1756): `0223.reject-loopback-reasks` and `0223.replay-derives-rejection` `executed-pass` on the v2 reference host's certified public cut on published suite 2.44.6 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`; host copy openwop-examples #139, `d0255b4b`; build `commit:0b04cacc`, 437 pass / 0 fail / 0 blocked / 67 inapplicable / 7 skipped, all three profiles certified, witness `188a23d56886`, signed `v2-reference-4`, no relaxations, `--verify --host-key` VERIFIED).

## References

- `spec/v1/interrupt-profiles.md` §Approval gate (`:94`, the loop-back rule) and §"Approval-gate timeout and quorum override" (`:103`, RFC 0093).
- `spec/v1/interrupt.md` §`ApprovalResume`.
- RFC 0093 (timeout fails closed), RFC 0125 (`triggerRule` routes a failed node), RFC 0183 (`action`, `decision`), RFC 0186 (`reason`, `onTimeout`), RFC 0199 §C.4 (`connector_auth_declined`).
- `spec/v2/core/overview.md` §0 (a producer MUST NOT emit an unregistered member).
- openwop #1692; separate gaps #1696 (`onTimeout: approve`), #1697 (loop re-entry and the key rule), #1698 (registration scope of run-failure codes), #1699 (the `majority` threshold, closed by measurement), #1700 (the routed and timeout legs, now witnessed).

# OpenWOP Spec v1 — Compensation and Partial-Failure Profile

> **Status: Draft · v1.x (2026-08-18; §C/§E/§G prose landed 2026-08-16; SP-11a landed the `inputMapping` value grammar, the unfired-trigger registration refusal, and the healthy-run `none` rule 2026-08-18) — RFC 0151 `Accepted`.** Normative surface for [RFC 0151 — Compensation and Partial-Failure Profile](../../RFCS/0151-compensation-and-partial-failure-profile.md): the host-ordered, persisted, retried unwind of committed business effects after a later node fails. This document covers **only what has landed on the wire** — the `compensation` capability family (§A), the node-level declaration (§B), the six `compensation.*` events and the run-level `compensationStatus` rollup (§D), and the replay rule (§F). RFC 0151's own header records that the profile is `Accepted` as text and **carried forward** as implementation; the sections still carried are named in [Open spec gaps](#open-spec-gaps) rather than implied. (2026-08-16: §B gained the workflow-level policy, `settings.compensation`.) Companion to [`capabilities.md`](./capabilities.md), [`stream-modes.md`](./stream-modes.md) (how the events surface), [`replay.md`](./replay.md), [`interrupt.md`](./interrupt.md) (RFC 0051 approvals), [`host-capabilities.md` §host.deadLetter](./host-capabilities.md#hostdeadletter) (RFC 0053), and [`host-sample-test-seams.md`](./host-sample-test-seams.md) §21. Keywords MUST, SHOULD, MAY, MUST NOT, SHOULD NOT follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

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

  **Value grammar** *(added 2026-08-18 — SP-11a; the rule above said where values come
  from and never said what a value looks like, so two hosts could read the same mapping
  differently).* An `inputMapping` value is either a literal (any JSON that contains no
  reference token) or a **reference**, which MUST be one of exactly two forms:

  | Form | Resolves to |
  | --- | --- |
  | `${nodes.<nodeId>.output.<port>}` | The recorded output `<port>` of the forward node `<nodeId>` **as it was committed** — read from the event log, never recomputed. |
  | `${inputs.<name>}` | The run's recorded input `<name>`. |

  A whole-value reference (a string that is exactly one token) resolves to the **raw
  typed** recorded value; a token embedded in surrounding text does string substitution.
  This matches the `{{params.*}}` rule in
  [`workflow-chain-packs.md`](./workflow-chain-packs.md) §"Parameter substitution"
  deliberately: an author should not have to learn two substitution semantics inside one
  workflow.

  **References MUST be resolved at plan time — when the obligation is minted (§C) — and
  the resolved value MUST be persisted on the obligation.** A host MUST NOT re-evaluate
  the mapping at unwind time. Re-evaluation reintroduces exactly what the recorded-facts
  rule excludes: between commit and unwind the workflow may have been redefined, a later
  node may have overwritten the variable, and the run may be a replay — so a
  re-evaluated mapping can hand the inverse action an input that was never the input to
  the effect it is undoing.

  A reference that does not resolve at plan time — an unknown `nodeId`, a port the node
  did not emit, an input the run did not carry — MUST fail the mint and surface as the
  plan's own failure, never as an inverse action invoked with a missing or `null` input.
- `retry.maxAttempts` / `retry.backoffMs` bound the inverse action's own retries.
- `requiresApproval: true` gates the inverse effect behind the same RFC 0051 approval
  surface as a forward effect (§E).
- `waiveRequiresApproval` (OPTIONAL boolean, S36 2026-08-17) gates **abandoning** the
  inverse — the §E `skip with justification` and `terminate as uncompensated` actions —
  behind the same approval surface: if a human must authorize *running* an inverse, a
  human must authorize deciding it will *never* run. Its **default is the obligation's
  effective `requiresApproval`** (after the policy's `approvalScope` escalation), NOT
  `false`, which is what makes it purely additive: no existing document changes meaning
  and a host that already derives "high-risk" from `requiresApproval` needs no behaviour
  change. It is stamped onto the obligation at mint time exactly like `requiresApproval`
  (§C — a mid-flight redefinition cannot change who had to authorize). It does NOT apply
  to `substitute`, which is still an attempt to undo (a substitution is a new
  `planVersion`, and the substituted inverse's own `requiresApproval` governs it). It
  has NO policy-level counterpart on purpose: because the default inherits the effective
  value, an `approvalScope` escalation escalates waives with it. Declared per node; a
  richer type would put a second policy language inside this closed block.
  **Escalation is a floor (S37, 2026-08-17).** An explicit `waiveRequiresApproval: false`
  MUST NOT lower a value that policy escalation has raised: the effective value is
  `(declared ?? declared requiresApproval) OR (approvalScope === "all")` — the same
  escalate-only rule `approvalScope` itself follows ("can only turn false into true"). An
  author may still say "sign-off to *run* the inverse, but declining it is an operations
  call" on a node whose own `requiresApproval` is `true` (declared `false` wins over the
  node-level default in both directions); what an author cannot do is strip a gate the
  workspace's policy raised. A host that let a node-level `false` win over escalation
  would fail open exactly where the policy said not to.
- A host MUST reject a compensation cycle.

**Irreversible effects (`irreversibleEffect: true`, RFC 0151 UQ4 — decided 2026-08-16).** A
node MAY state that its committed effect **has no inverse** with the OPTIONAL boolean
`irreversibleEffect` on the node (and on a chain fragment node, RFC 0157). It is mutually
exclusive with `compensation`: a node declaring both is a contradiction and a host MUST reject
the workflow at registration (`validation_error`); chain expansion copies the flag onto the
expanded node unchanged. Absent or `false` says nothing — an undeclared compensator is still not
implied. What the declaration changes is the plan (§C) and the rollup (§D): a committed
irreversible effect enters the plan as an entry that can never complete, so the run's
`compensationStatus` caps at `partial` and a reader can no longer take a `completed` unwind to
mean "everything this run did was undone". This is deliberately a statement about the effect,
not a compensator: it adds no event, no reason code, and no host behaviour beyond the plan entry
and the fold — the point is that silence and "no inverse exists" stop looking the same.

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
- **A host MUST likewise refuse, at registration, a policy naming a `triggers` entry the
  host does not fire** (`validation_error`, naming the offending trigger). *(Erratum,
  2026-08-18 — SP-11a.)* The four triggers are a closed vocabulary, but implementing them
  is not all-or-nothing: a host can ship `node-failure` long before `cap-breach` or
  `operator-request`. Silently accepting a policy that lists a trigger the host never
  fires is the worst of the three possible behaviours — the author has written down a
  guarantee, the registration succeeded, and the absence only becomes observable during
  the incident the policy existed for, when the unwind that was promised does not start.
  This is the same principle as the `capability_required` refusal above and as the
  `orderingModel` rule in this bullet's predecessor: **an unimplemented obligation is
  refused when it is declared, not discovered when it is needed.**

  There is deliberately **no advertisement surface** for per-trigger support in this
  document — `capabilities.compensation` carries no `supportedTriggers`, and adding one
  is a new optional wire capability, carried in [Open spec gaps](#open-spec-gaps).
  Omitting it is a **design decision**, and the argument below is what carries it. The refusal is what a host owes in the meantime, and
  it needs no new wire surface: the host already knows which triggers it fires.

  > **⚠️ Editing this refusal changes the case for omitting the advert — read before you relax
  > it (2026-08-18).** The advert is omitted because it is *ergonomics, not safety*, and the
  > reason it is only ergonomics is **this paragraph**: the safety hole — an author writing
  > down an unwind guarantee that silently never fires — is already closed at registration
  > time by the refusal above. The advert would move discovery from registration-time to
  > authoring-time, which is ergonomics.
  >
  > **If this registration refusal is ever weakened or removed, that analysis inverts.**
  > `supportedTriggers` would then be the only thing standing between an author and a
  > silently inert policy — which would make the advert **necessary**, not merely convenient. Anyone relaxing the refusal therefore owes a re-derivation of the
  > case for omitting the advert, not just an edit here. Recorded at the point of edit so the
  > dependency is visible to whoever makes it, rather than living only in the reasoning
  > that produced it.

  **Compatibility.** Classified a **safety-fix** under `COMPATIBILITY.md` §3, not an
  additive change: it turns a registration that previously succeeded into a
  `validation_error`. The break is the point — the accepted-then-silent path is the
  defect. Hosts that fire all four triggers see no change; a host that fires a subset
  begins refusing policies that named the rest, which is the honest answer it should
  always have given.
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

## §C — Lifecycle

This section is the host-internal contract behind the events in §D. Almost none of it
is observable from a normal run's wire — which is exactly why it is written down: a
host that gets the order of these steps wrong produces a wire that looks fine until the
first crash mid-unwind, and RFC 0148 §A treats "looks fine" as `blocked`, not as a pass.

**Trigger.** An unwind starts only when a `settings.compensation.triggers` entry fires
(§B "Workflow policy") and at least one *committed* forward effect exists whose node
carries a `compensation` declaration. A trigger with nothing to unwind MUST NOT emit
`compensation.requested`; the run ends with `compensationStatus: none`. A node whose
forward effect never committed (failed before its effect, or has no `compensation`
declaration) is not in the plan — with one exception: a committed node declaring
`irreversibleEffect: true` (§B) enters the plan when a plan is created at all, as an
entry with the recorded outcome `irreversible`. It runs nothing and emits nothing; it
exists so the plan, and therefore the rollup, tells the truth about what was not undone.

**Plan.** Before executing its first inverse action the host MUST persist a
**compensation plan**: the ordered set of inverse actions with, for each, the forward
node's `logicalInvocationId` (RFC 0150 §B), the forward-completion ordinal, the resolved
`nodeTypeId`, the input **as derived from recorded facts at plan time**, and the retry
bounds in force (node bounds, else policy defaults). The plan carries a `planVersion`
that changes only through an authorized §E substitution. Persisting the plan is what
`compensation.requested` witnesses; a host MUST NOT emit it before the plan is durable.

**Ordering.** `reverse-completion` executes inverse actions by **descending durable
forward-completion sequence** — the order the host recorded the forward effects as
committed, not the order the nodes were declared or started. `dependency-graph`, when
advertised and selected, MUST be a DAG over the forward effects and MUST preserve
reverse dependency order; where the graph leaves two inverse actions unordered the
host MAY run them concurrently. Under either model an inverse action MUST NOT start
until every inverse action ordered before it has reached a recorded outcome
(completed, failed, skipped, or terminated).

**Inverse-action identity.** Each inverse action has a stable identity derived from
the tuple

```text
(tenantId, runId, forwardLogicalInvocationId, compensationOrdinal, profileVersion)
```

— the tenant, the run, the RFC 0150 identity of the forward invocation being undone,
the action's position in the plan, and the profile version whose ordering rules minted
it. This identity, not the attempt, is what a retry re-presents (§B `retry`), so a
transient failure followed by a retry is one obligation with two attempts, never two
obligations. The identity MUST be carried to the inverse effect (its idempotency key,
per [`idempotency.md`](./idempotency.md)) so the downstream system can also
deduplicate. `attempt` is recorded on the events (§D) but is **not** part of the
identity — the RFC 0150 §B rule that retired `attempt` from effect identity applies
here for the same reason: an identity that includes the attempt makes every retry a
fresh effect. How this tuple composes with RFC 0150 §C's semantic-request digest is
carried until that digest lands (gap G1).

**Retry.** An inverse action that fails retries under its own bounds with a fresh
`attempt` and the **same** identity. Exhausting the bounds records the action as failed
(`compensation.failed`, `reason: retries-exhausted`) and hands the plan to §E — it does
not stop the plan by itself unless the policy's `exhaustedDisposition` is
`manual-intervention`. `completed` is terminal for an action: a completed inverse MUST
NOT be re-executed by any later step, retry, resume, or replay (§F).

**Crash and resume.** The plan and each action's recorded outcome MUST be durable
before the host acts on them, so that a host restarted mid-unwind resumes **from the
persisted plan**: actions with a recorded `completed` outcome are not re-run, the
in-flight action is re-presented under its existing identity (the downstream system
sees a retry, not a duplicate), and the remaining actions run in plan order. A host
MUST NOT rebuild the plan from the workflow definition on resume — a definition edited
between crash and restart would silently change what is being undone. Resume does not
emit a second `compensation.requested`; the plan already exists.

**Cancellation of the parent.** An RFC 0094 cancel accepted while an unwind is active
MUST NOT silently abandon it. The policy's `onParentCancel` (§B) selects the behaviour:
`continue` (the unwind runs to its terminal rollup while the run's forward `status`
becomes `cancelled`), `pause` (`compensation.paused` with `reason` omitted — the closed
vocabulary has no code for a parent-cancel hold, gap G6 — and the plan held for an
authorized §E action), or `manual` (`compensation.manual_intervention_required`). In every case the rollup follows §D and
the plan remains inspectable — a cancelled parent with a half-run unwind reads
`partial` or `manual`, never `none`.

**Timeouts.** `timeoutMs` (node, else policy) bounds one attempt of one inverse action.
A timed-out attempt is a failed attempt: it retries under the same identity, and the
downstream system's idempotency on that identity is what makes a late-arriving success
from the timed-out attempt harmless.

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
| `none` | No `compensation.requested` has been recorded for the run, **or** the only such record was inherited by a `branch` fork whose plan was still non-terminal at `fromSeq` (see §"Forked runs" below). **This includes a run that completed successfully while declaring compensable nodes** — a healthy run has nothing to unwind, so its rollup is `none`, not `pending`. *(Stated explicitly 2026-08-18, SP-11a: the fold is over the PLAN, and no plan exists until a trigger fires. A host deriving the rollup from the existence of obligation rows — which are minted per compensable node, healthy or not — reports `pending` on every successful run that declares a compensator, and every pre-existing witness of this table drives a failure, so none of them could see it.)* |
| `pending` | `compensation.requested` recorded and `compensation.started` has not. |
| `running` | `compensation.started` recorded and the plan is still active. A §E approval pause (`compensation.paused` while an RFC 0051 approval interrupt is open) does **not** change it — the run's own `status: waiting-approval` and `interrupt` already carry the wait, which is why the two fields are separate. |
| `completed` | Every inverse action in the persisted plan completed. A plan containing an `irreversible` entry (§B/§C) can never reach this value. |
| `partial` | The plan is no longer active, at least one inverse action completed, and at least one did not (failed, skipped with recorded justification, terminated, or `irreversible`). Reported, never rounded: collapsing it to `failed` erases the refund that did go through; to `completed`, claims an unwind that half-happened. |
| `failed` | The plan is no longer active and no inverse action completed. |
| `manual` | `compensation.manual_intervention_required` recorded and not yet resolved by an authorized operator. Takes precedence over `partial` / `failed` while unresolved; on resolution the value becomes whichever of those the recorded outcomes yield. |

`completed` is the only terminal value that never moves again: re-running a completed
inverse is a double refund. `failed` is **not** terminal at the inverse-action level — a
transient failure MUST be retryable without minting a second obligation (§C identity).

### Forked runs (G4, decided 2026-08-18)

`POST /v1/runs/{runId}:fork` produces a run with its own `runId` and its own log,
seeded with the source's events `< fromSeq` as fixed history
([`replay.md`](./replay.md) §`branch` mode). Because the §D fold is defined over
*the run's* log, a fork folds over what it inherited — which decides most of this
mechanically:

| Inherited prefix contains | Child reports |
| --- | --- |
| no `compensation.requested` | `none` |
| a **terminal** compensation outcome (`completed` / `partial` / `failed` / `manual`) | that same value |
| `compensation.requested` (± `started`) with **no terminal outcome** at `fromSeq` | **`none`** |

The first two rows follow from the fold and from §F's rule that a branch
"preserves source facts without claiming it changed the source system": an
inherited terminal outcome *is* a recorded fact, and reporting it claims nothing
about the child's own execution.

**The third row is the decision this gap existed for, and it does not follow
mechanically.** Applying the table verbatim to a plan that was mid-unwind at
`fromSeq` yields `running` — whose own condition is "`compensation.started`
recorded **and the plan is still active**", and in the child it is not: the child
is not executing that plan and cannot discharge it. Falling through to `partial`
or `failed` is worse, because both assert an *outcome* ("the unwind stopped here")
that has not happened — the source may still be unwinding, and the child cannot
observe whether it is.

So a non-terminal inherited plan is **not** inherited as an in-flight obligation.
An obligation is a commitment by a particular run to perform particular inverse
actions; the fork never made it, never minted its entries, and MUST NOT report a
status implying either that it is discharging one or that one concluded. The
child reports `none` — it has no compensation outcome of its own — and **the
source retains its own rollup, unchanged**. A fork is not a transfer of custody.

A host MUST NOT infer a compensation trigger from the fork itself. If the child's
own execution later fails and its policy names a firing trigger, it mints its own
plan and folds normally from there; those are its facts, keyed to its own run.

> **Not in scope here.** Whether a `branch` fork should *re-execute* the source's
> committed effects is settled elsewhere and is not this rule:
> [`replay.md`](./replay.md) §`branch` mode says it does, by design, and SHOULD be
> surfaced in any operator-facing fork UI. §F adds the compensation-specific
> constraint that a live-effect branch MAY execute compensation only after
> explicit authorization and with fresh effect IDs.

## §E — Approvals, dead-letter routing, and operator recovery

Compensation is a second effect, so it gets the forward path's controls, not weaker
ones.

**Approval before the inverse effect.** An inverse action whose node declares
`compensation.requiresApproval: true` — or every inverse action when the policy's
`approvalScope` is `all` (§B; the scope can only escalate) — MUST create an RFC 0051
approval interrupt ([`interrupt.md`](./interrupt.md) §`kind: "approval"`) **before** the
inverse effect executes, and emit `compensation.paused` (with `reason` omitted — no closed
code names an approval hold, gap G6) while it is open. The
`artifactData` presented for approval MUST be the plan entry — the identity tuple, the
`nodeTypeId`, and the recorded-fact input — never a re-derived value, so the approver
approves what will actually run. The run's own `status: waiting-approval` and
`interrupt` carry the wait; `compensationStatus` stays `running` (§D fold). A `reject`
records the action as not completed with `reason: approval-denied` and hands the plan
to the exhausted path below — rejection is a recorded outcome, not a silent skip.

**Authorization binding.** Every approval resolution and every operator action below is
an RFC 0049 authorization decision and MUST bind **tenant, principal, action, and
`planVersion`**: a decision recorded for one plan version MUST NOT authorize an action
on a later one, and a principal's authority over a compensation plan is the authority
they hold in the plan's tenant — never authority carried in from another tenant, from
the forward run's caller, or from the workflow's author. The decision is audited through
the existing `authorization.decided` event (RFC 0049); no new event type exists for
it. An action that fails authorization records `reason: authority-denied`.

**Dead-letter routing.** When an inverse action exhausts its retries, or is rejected or
denied as above, the run MUST route to RFC 0053 dead-letter handling
([`host-capabilities.md` §host.deadLetter](./host-capabilities.md#hostdeadletter)):
`run.dead_lettered` is emitted with a redaction-safe `reason`, the run stays
fork-eligible for the retention window, and the plan stays inspectable alongside it. A
host that does not advertise `deadLetter` MUST still retain the plan and its recorded
outcomes for at least the run's own retention — a compensation that fails and is then
purged is indistinguishable from one that never ran. What happens next is the policy's
`exhaustedDisposition`: `record-outcome` records the failure and continues with the
remaining actions (the rollup lands on `partial` or `failed`); `manual-intervention`
emits `compensation.manual_intervention_required` (`reason: retries-exhausted` /
`approval-denied` / `authority-denied` / `dead-lettered`) and holds the plan for an
operator (`manual`).

**Operator recovery actions.** An authorized operator MAY perform exactly these four
actions on a held or partial plan. There is no canonical endpoint for them in v1.x —
they are host-mediated (gap G2 below) — but their **outcomes are wire-defined**, so a
consumer reading the events and the snapshot sees the same thing on every host:

| Action | Precondition | Recorded outcome | Rollup effect (§D fold) |
| --- | --- | --- | --- |
| **retry** | action not `completed` | a fresh `attempt` under the **same** identity | `manual` → `running`; then whatever the outcomes yield |
| **skip with justification** | action not `completed`; a non-empty justification is recorded; when the obligation's effective `waiveRequiresApproval` (§B) is `true`, an RFC 0051 approval whose `artifactData` is the plan entry plus the justification MUST have resolved `approved` first — the same second human that would have had to authorize running it | action marked skipped, justification in the audit record (never in the event payload) | counts as *did not complete*: `partial` if any other action completed, else `failed` |
| **substitute** | a **registered** compensation `nodeTypeId` (resolves like §B); increments `planVersion` | the plan entry's `nodeTypeId` changes under a new `planVersion`; prior approvals for that entry are void | as retry, under the new plan version |
| **terminate as uncompensated** | when any remaining obligation's effective `waiveRequiresApproval` (§B) is `true`, an RFC 0051 approval covering the termination MUST have resolved `approved` first | every remaining action marked terminated, `reason: operator-terminated` | `partial` if any action completed, else `failed`; the plan is closed and MUST NOT resume |

Every override MUST be audited (`authorization.decided` with the action named), and
none of them may re-execute a `completed` inverse action. Whether a substitute may
change the node type without changing `planVersion` (RFC 0151 UQ2) is decided **no**
here: substitution is a new plan version so that approvals and authorization decisions
bound to the old one cannot carry over.

## §F — Replay

Replay defaults MUST use recorded compensation outcomes and MUST NOT re-fire inverse
effects: a replay that re-executes inverse effects turns a recovery into a second
outage. A live-effect branch MAY execute compensation only after explicit authorization
and with fresh effect IDs. The `compensation-replay-no-refire` invariant
(`SECURITY/invariants.yaml`) is registered against `compensation-behavior.test.ts`.

**What "explicit authorization" means here, and what it does not** *(clarification,
2026-08-18 — a host implementing this asked, having found the sentence readable two
ways, and declined to pick the reading that made it conformant)*:

- It is an **RFC 0049 authorization decision** in the sense §E §"Authorization binding"
  already defines for this document: bound to **tenant, principal, action, and
  `planVersion`**, and audited through `authorization.decided`.
- It is **NOT** the workflow's authored `settings.compensation.triggers` declaration.
  A policy naming a trigger is an *author's* statement that this class of failure
  unwinds; it binds no principal, no `planVersion`, and emits no decision. §B says so
  from the other direction: the policy is "authored, not per-run", because "a per-run
  caller who could lower approval scope or drop a trigger would be **authorizing their
  own unwind**" — the document already treats the policy and the authorization as
  different acts, and a host that reads trigger-admission as authorization has
  collapsed them.

**And what the sentence is scoped to.** It governs a branch that would execute
compensation **for obligations corresponding to the source run's recorded ones** — the
replay-adjacent hazard the "fresh effect IDs" half names: an inverse action re-run
under an identity (§C) that collides with one the source already recorded, so a second
unwind is indistinguishable from the first. It does **not** reach a branch compensating
obligations it minted itself during its own live execution; those are that run's own
facts and follow §B and §E unchanged — the authored policy triggers them, and approval
is required only where `requiresApproval` says so.

A host whose forks are structurally incapable of compensating a source's obligations —
one whose compensation root resolves to the fork's own `runId`, so `collectDeclarations`
can only ever see what the fork minted — satisfies this constraint **vacuously**, and
should record it as such rather than as a passing control. That is a stronger position
than a guard, because it cannot be deleted by a later edit; it is also why such a host
needs no per-fork consent step for conformance with *this* sentence.

## §G — Security

The threat model is [`SECURITY/threat-model-compensation.md`](../../SECURITY/threat-model-compensation.md).
The rules it rests on, all stated above and restated here as MUST-NOTs:

- **Credentials.** An inverse action authenticates to the downstream system under its
  own credential, resolved through the normal BYOK / secret-store path
  ([`auth.md`](./auth.md), RFC 0074) and the normal egress policy (RFC 0076). Forward
  credentials MUST NOT be copied into the plan; the plan holds the identity tuple, the
  `nodeTypeId`, and recorded-fact inputs, nothing that authenticates. Events MUST NOT
  carry provider bodies or credentials (§D; SR-1).
- **Identity.** An inverse action's identity is the §C tuple; a retry, resume, or
  replay MUST NOT mint a second identity for the same obligation, and a `completed`
  action MUST NOT execute again (§C, §F).
- **Authority.** Every approval and operator action is bound to tenant, principal,
  action, and `planVersion` (§E); a principal MUST NOT act on a plan in a tenant where
  they hold no authority, and forward-run or authoring authority MUST NOT be inherited
  by the unwind.
- **Inputs.** Inverse inputs derive from recorded facts (§B); a host MUST NOT
  construct one from a prompt or model output during unwind or replay.

All four RFC 0151 §G invariants are **registered** (`SECURITY/invariants.yaml`, protocol
tier): `compensation-replay-no-refire` against the replay leg of
`compensation-behavior.test.ts`; `compensation-effect-id-retry-stable`,
`compensation-tenant-authority-bound`, and `compensation-input-recorded-facts-only`
against `compensation-recovery.test.ts`, which drives the §21 **recovery extension**
([`host-sample-test-seams.md`](./host-sample-test-seams.md) §21 — `unwind`
`failFirstInverseAttempts` / `hold` with `inverseActions[]`, `replay` `source[]` /
`replayed[]`, and the `operator` seam). Each is `blocked` in the ledger until a host wires
the extension — registered against a witness that exercises the threat, and honest that
no host has run it yet.

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
- Recovery (same gate; the §21 recovery extension is independently optional and
  `blocked` when absent): `compensation-recovery.test.ts` — §C retry-stable identity
  (one obligation, three attempts, one downstream key), §E operator authority bound to the
  plan's tenant (cross-tenant 404, same-tenant non-operator 403 audited, operator 200
  audited), §B/§F recorded-facts replay (`replayed` ≡ `source`, `refiredEffects: 0`).
- Until a host advertises the family and wires the seams, the behavioral requirements
  resolve to `blocked` per RFC 0148 §A — not to a pass.

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 9 row(s) this table carried are now `openwop.gap.spec.compensation.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

## References

- [RFC 0151 — Compensation and Partial-Failure Profile](../../RFCS/0151-compensation-and-partial-failure-profile.md) · [RFC 0147](../../RFCS/0147-protocol-integrity-and-standards-readiness-program.md) (program, R9) · [RFC 0150](../../RFCS/0150-effect-identity-replay-and-split-brain-safety.md) (effect identity) · [RFC 0148](../../RFCS/0148-non-vacuous-conformance-certification.md) (`blocked` disposition)
- [`capabilities.md`](./capabilities.md) · [`stream-modes.md`](./stream-modes.md) · [`replay.md`](./replay.md) · [`interrupt.md`](./interrupt.md) · [`host-capabilities.md` §host.deadLetter](./host-capabilities.md#hostdeadletter) · [`host-sample-test-seams.md`](./host-sample-test-seams.md) §21
- Schemas: [`capabilities.schema.json`](../../schemas/capabilities.schema.json) (`compensation`) · [`workflow-definition.schema.json`](../../schemas/workflow-definition.schema.json) (node `compensation`, `settings.compensation`) · [`compensation-policy.schema.json`](../../schemas/compensation-policy.schema.json) · [`run-event.schema.json`](../../schemas/run-event.schema.json) · [`run-event-payloads.schema.json`](../../schemas/run-event-payloads.schema.json) · [`run-snapshot.schema.json`](../../schemas/run-snapshot.schema.json) (`compensationStatus`)

# RFC 0254: The agent deployment transition contract at v2

| Field | Value |
| --- | --- |
| **RFC** | 0254 |
| **Title** | The agent deployment transition contract at v2 |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-10-29 |
| **Updated** | 2026-10-29 — **filed and moved `Draft` → `Active` the same day, comment window waived by the maintainer** (user instruction 2026-10-29: "proceed, and waive the comment window"). STEWARD OVERRIDE of RFC 0147 §A.6, recorded in `MAINTAINERS.md`. The rulings come from an `/architect` pass on the eight ambiguities that `v2-deployment-lifecycle` (#2060) reported, and the wire lands with this RFC. |
| **Affects** | `spec/v2/facets/agents.schema.json` §deployment (the transition rules; derived `schemas/v2/capabilities.schema.json`) · `schemas/v2/agent-deployment.schema.json` (optional `transitionRunId`) · `schemas/v2/agent-deployment-transition.schema.json` (descriptions) · `spec/v2/errors.json` (`deployment_state_conflict`) · `scripts/derive-v2-api.py` (`transitionAgentDeployment` 202 and 409 at v2) · `SECURITY/invariants.yaml` · conformance (`v2-deployment-lifecycle`) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0082 defined the agent deployment lifecycle at v1. Its transition rules lived in `spec/v1/agent-deployment.md`, which is frozen, and v2 carried them only in a schema description. The v2 suite's `v2-deployment-lifecycle` scenario found eight places where the rules gave no answer. This RFC answers them for v2:

- the error for a transition the record's state refuses;
- whether `promote` may skip a step;
- how a paused version resumes;
- what an absent `states` advertisement means;
- what `deploy:*` names;
- which version a rollback restores;
- where the `deployment.*` events can be read;
- what a gated transition returns.

## Motivation

openwop-app is about to implement `agents.deployment` (openwop-app#5393), and the white-label MyndHyve will inherit it. The legacy MyndHyve runtime, the only host that ever served the facet, retired on 2026-10-29. No host advertises the facet today, so tightening it now breaks no one. Leaving the eight questions open would let the first implementation become the de-facto rule.

Three of the gaps are also security-relevant:

- A `promote` that skips from `draft` to `active` would bypass the `test` and `staged` points where an eval gate or approval gate attaches. Invariant `deployment-promotion-fail-closed` forbids that bypass, but no rule said the skip is refused.
- The `deployment.*` events had no portable read, so invariant `deployment-event-no-content-leak` had no behavioural witness.
- `deployment-promotion-fail-closed` is protocol-tier, but its only public test ran at major 1.

## Proposal

The rules live in the `agents.deployment` facet description, which `spec/v2/declaration.json` names as the `agents` family's normative text. The core word budget is at its cap, so they do not go in a core doc. This follows RFC 0249 §F.

### §A — Transitions

The legal edges are:

| From | To | Transition |
| --- | --- | --- |
| `draft` | `test` | `promote` |
| `test` | `staged` | `promote` |
| `staged` | `active` | `promote` |
| `active` | `paused` | `pause` |
| `paused` | `active` | `promote` |
| `active` | `deprecated` | `deprecate` |
| `active` | `rolled-back` | `rollback` |

`adjust-canary` changes an `active` version's `canaryPercent` and does not change its state. A resume records `deployment.state.changed`, as `pause` and `deprecate` do; `deployment.promoted` records only a forward step.

- **`promote` moves one step.** An absent `toState` means the next state. A `toState` that is not the next state is refused.
- **Refusal.** A transition the record's current state does not allow MUST be refused `409 deployment_state_conflict`, with `details.state` (the current state) and `details.transition`, and the record MUST NOT change.
- **Order of checks.** A target state or `canaryPercent` the host does not advertise is `400 validation_error`, and is checked before the state machine. A request that can never succeed on this host is a validation error; a request the record's current state refuses is a conflict.

### §B — Advertised states

- An absent `states` means all seven.
- An advertised subset MUST include `draft` and `active`.
- Over a subset, the legal edges are §A's with the unadvertised states removed, and `promote` moves to the next advertised state in `draft → test → staged → active` order.

### §C — Rollback

- The request's `version` names the `active` version being rolled back.
- The host restores the most recent other version that was `active` on the same channel before it and is not itself `rolled-back`. Normally that is the incumbent, the same version that takes the canary remainder.
- `rollbackPointer` names the restored version, which is `active` afterwards.
- With no such version, the rollback is `409 deployment_state_conflict`.

### §D — The management run

- Every transition the host accepts runs on a deployment-management run.
- The deployment record's new optional `transitionRunId` names that run, and a host MUST set it on every record a transition created or changed.
- The run carries the transition's `authorization.decided`, any approval interrupt, and its `deployment.*` event. A caller with `runs:read` in the same tenant reads them through the ordinary run reads.
- A refused transition creates no run, and its `authorization.decided` goes only to the audit log.
- **A gated transition answers `202`** (RFC 0051): the run suspends on its approval interrupt, and the response is the record unchanged apart from `transitionRunId`.

### §E — The scope

`deploy:*` is one scope, as the v2 operation's security requirement and the OAuth2 scope list already name it. A `403` for it names `scope="deploy:*"` (`identity.md` §4). The v1 per-verb scopes (`deploy:promote`, `deploy:rollback`, `deploy:pause`) are not part of the v2 wire; a host MAY map roles to them internally.

### Wire shape

```jsonc
// schemas/v2/agent-deployment.schema.json — one new optional property
"transitionRunId": { "$ref": "ids.schema.json#/$defs/runId" }

// spec/v2/errors.json — one new code
{ "code": "deployment_state_conflict", "httpStatus": 409,
  "details": { "required": ["state", "transition"] } }

// transitionAgentDeployment at v2 — two new responses
"202": AgentDeployment   // gated: record unchanged except transitionRunId
"409": Error             // deployment_state_conflict
```

Both deployment schemas leave the v1 seed set (`scripts/derive-v2-schemas.mjs`), and this RFC owns their v2 edits.

### Examples

- `promote {version: "2.0.0", toState: "active"}` on a `draft` record → `409 deployment_state_conflict`, `details: {state: "draft", transition: "promote"}`; the record is unchanged.
- `promote {version: "2.0.0"}` on a `draft` record of a host advertising `states: ["draft", "active"]` → `200`, state `active`.
- `rollback {version: "2.0.0"}` while `1.0.0` was active on `stable` before it → `200`. `2.0.0` is `rolled-back` with `rollbackPointer: "1.0.0"`, and `1.0.0` is `active`.
- A promote through an approval gate → `202`. The record is unchanged; its `transitionRunId` names a run suspended on an `approval` interrupt.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.4):

- one new registered error code;
- one optional property on a closed v2 object;
- two responses added to an operation no host serves;
- rules for transitions the v2 corpus left unspecified.

No existing MUST is relaxed and no field changes type. The v1 wire and `spec/v1/agent-deployment.md` are unchanged.

## Conformance

`v2-deployment-lifecycle` (suite 2.46.35) carries the legs. It is gated on `agents.deployment` and the `conformance-agent-channel-dispatch` fixture. Rows that were deliberately loose in #2060 are tightened to the rulings, and new legs cover the step-skip refusal, the resume, the management-run link and its recorded event. `deployment-promotion-fail-closed` lists the scenario as its v2 public test.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A an illegal edge is a 409 with the state | the status, `error.code` and `details.state`; the record unchanged | the suite | witnessable-gated: `openwop.requirement.0082.transition-illegal-refused` |
| §A `promote` moves one step | draft→active refused 409, record unchanged | the suite | witnessable-gated: `openwop.requirement.0082.promote-skip-refused` |
| §A paused→active is `promote` | pause, then promote, returns to `active` | the suite, on a host advertising `paused` | witnessable-gated: `openwop.requirement.0082.resume-from-paused` |
| §A unadvertised state is a 400, checked first | `400 validation_error`, record unchanged | the suite, on a host advertising a subset | witnessable-gated: `openwop.requirement.0082.state-unadvertised-refused` |
| §B absent `states` means all seven | the walk runs and passes with `states` absent | the suite | witnessable-gated: `openwop.requirement.0082.transition-legal` |
| §C rollback restores the incumbent | `rollbackPointer` equals the version active before the promote, and it is `active` | the suite, on a host advertising `rollback` | witnessable-gated: `openwop.requirement.0082.rollback-pointer` |
| §D every accepted transition names its run | `transitionRunId` on each 200 record | the suite | witnessable-gated: `openwop.requirement.0082.transition-run-linked` |
| §D the run carries the `deployment.*` event | the event in the run's log, its payload valid and content-free | the suite | witnessable-gated: `openwop.requirement.0082.transition-event-recorded` |
| §D a gated transition answers 202 | `202` and a suspended run | a host policy gate only | witnessable — gated on a host fixture; none exists (G2) |
| §D a refused transition creates no run | no run exists | nobody from outside | unwitnessable: a run that does not exist cannot be listed portably |
| §E a 403 names `deploy:*` | `403 forbidden`; the `WWW-Authenticate` scope when present | the suite, with a low-scope key | witnessable-gated: `openwop.requirement.0082.scope-fail-closed` |

## Security

- **Step-skipping** would bypass the gates a host attaches to `test` and `staged`. §A refuses it, and `0082.promote-skip-refused` witnesses that.
- **The `deployment.*` events become readable** through §D. They stay content-free, as `run-event-payloads.schema.json` requires. `0082.transition-event-recorded` is the first behavioural witness of `deployment-event-no-content-leak`.
- **The management run is tenant-scoped** like every run: only a caller with `runs:read` in the same tenant reads it.

## Alternatives considered

1. **`400 validation_error` for an illegal edge.** Rejected. The request is well-formed and could succeed against a record in another state. That is a state conflict, which `run_state_conflict` and `proposal_state_conflict` already answer with 409.
2. **Let `promote` jump to any later state.** Rejected: it would skip the states where gates attach.
3. **A new `resume` transition verb.** Rejected. `promote` already means "move toward serving", and a new enum member adds a request value every host must accept without adding meaning.
4. **A `rollbackTo` request field.** Rejected for now. Restoring the previous incumbent is the recovery operators expect, and it is the version that already holds the canary remainder. A host that needs an arbitrary target can promote that version instead.
5. **Return the deployment events in the transition response.** Rejected. The events belong to a run, with its interrupts and audit trail, so linking the run reuses every existing read.
6. **Per-verb `deploy:promote` / `deploy:rollback` / `deploy:pause` scopes at v2.** Rejected for now. The v2 wire already names `deploy:*` in the operation's security requirement and the OAuth2 scope list; splitting it would change a published scope set.

## Unresolved questions

None. The eight questions from #2060 are ruled in §A–§E.

## Implementation notes (non-normative)

- openwop-app#5393 implements the facet. The fixture contract is in `conformance/fixtures.md`, in the `conformance-agent-channel-dispatch` major-2 subsection.
- The canary draw and the run-start pin are unchanged from RFC 0082 §B.

## Acceptance criteria

- [x] The rules are in the `agents.deployment` facet description; `deployment_state_conflict` is registered; `transitionRunId` is on the record; the v2 operation answers 202 and 409.
- [x] `v2-deployment-lifecycle` witnesses §A–§E, and every new or tightened leg is sabotage-proved on a scratch host.
- [x] `deployment-promotion-fail-closed` lists the v2 scenario.
- [ ] A host advertising `agents.deployment` records the `0082.*` legs `executed-pass` on a certified cut — reason: openwop-app#5393 is the first implementation (G1).

## References

- [`RFCS/0082-agent-deployment-lifecycle.md`](./0082-agent-deployment-lifecycle.md) — the v1 lifecycle this completes at v2.
- [`RFCS/0249-proposal-operations-and-install-readback.md`](./0249-proposal-operations-and-install-readback.md) — §F, rules in a facet description when the core budget is full; `proposal_state_conflict`.
- `spec/v2/core/runs.md` §Pause and resume — `run_state_conflict`.
- `spec/v2/core/identity.md` §4 — the `insufficient_scope` challenge.

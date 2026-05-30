# RFC 0082: Agent Deployment Lifecycle

| Field | Value |
|---|---|
| **RFC** | 0082 |
| **Title** | Define an agent deployment lifecycle — a named-channel + version binding (`agentId@version` / `agentId@channel` / `agentId@latest`), a deployment state machine (draft / test / staged / active / paused / deprecated / rolled-back) with canary percentage and a rollback pointer, a `deployment.*` audit-event family, and the eval-gated + RBAC-gated promotion contract — composing RFC 0051 (approval gates), RFC 0049 (RBAC), and RFC 0081 (eval), with channel→concrete-version resolution pinned at run-start for replay determinism |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-29 |
| **Updated** | 2026-05-30 (Draft → Active — wire surface landed after an `/architect` pass: `spec/v1/agent-deployment.md` + `agent-deployment.schema.json` + additive `channel` on `agent-ref.schema.json` (mutual-exclusion via `not`, propagating to `WorkflowNode.agent` which `$ref`s it) + `agents.deployment` capability + 4 content-free `deployment.*` events + additive `resolvedAgentVersion`/`resolvedChannel` on `agent.invocation.started` + always-on `agent-deployment-shape.test.ts` + `version-negotiation.md`/`node-packs.md` §sections. All 6 UQs resolved. The `POST /v1/agents/{agentId}/deployments` endpoint, SDK helpers, behavioral lifecycle scenario, and reference-host store are deferred to `Active → Accepted` per the RFC 0077 precedent.) |
| **Affects** | NEW `schemas/agent-deployment.schema.json` (the per-(agentId, version) deployment record) · `schemas/agent-ref.schema.json` (additive optional `channel` alongside the existing exact `version` pin) · `schemas/workflow-definition.schema.json` (additive optional `channel` on the `WorkflowNode.agent` binding) · `schemas/run-event.schema.json` (additive `RunEventType`: `deployment.promoted` / `deployment.rolled-back` / `deployment.canary.adjusted` / `deployment.state.changed`) · `schemas/run-event-payloads.schema.json` (the four content-free deployment payloads) · `schemas/capabilities.schema.json` (additive optional `agents.deployment` block) · `spec/v1/agent-deployment.md` (NEW normative doc) · `spec/v1/node-packs.md` (additive §"Deployment channels" — channel→version resolution) · `spec/v1/version-negotiation.md` (additive §"Channel resolution + replay") · `api/openapi.yaml` (additive `GET` + `POST /v1/agents/{agentId}/deployments`) · `api/asyncapi.yaml` · `SECURITY/invariants.yaml` · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop has packs, manifest agents (RFC 0070/0072/0074), approvals (RFC 0051), RBAC (RFC 0049), and — with RFC 0081 — eval scorecards. What it **lacks is a lifecycle**: a way to promote an agent from draft to a deployed production worker, to canary a new version against the active one, to roll back, and to bind a workflow to "the stable channel" rather than a frozen exact version. Today an `AgentRef` carries an **exact `version` pin** (RFC 0002) and the registry publishes **discrete semver tags with no channel concept** — so "use the current production support-resolver" can only be expressed by hard-coding a version that goes stale, and there is no audited record of *who promoted what, when, and on what evidence*. This RFC adds that lifecycle **additively**: a **deployment state machine** (draft → test → staged → active, plus paused / deprecated / rolled-back), a **named-channel binding** (`agentId@channel` / `agentId@latest`) that resolves to a concrete version, **canary percentage** + a **rollback pointer** on the active deployment, a content-free **`deployment.*`** audit-event family, and a **promotion contract** that composes RFC 0051's `approvalGate` (the human gate), RFC 0049's scopes (`deploy:promote` etc., fail-closed), and RFC 0081's `EvalSummary.passed` (the evidence gate). Crucially, a workflow that binds `agentId@channel` **MUST resolve the channel to a concrete `version` at `run.started` and record it** (the `version.pinned` / RFC 0077 recorded-fact precedent) — so replay/fork re-reads the pinned version and never re-resolves a since-moved channel. No existing field, event, or endpoint changes.

## Motivation

`docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0082" frames it: *the protocol has packs, agents, workflows, approvals, and registry operations, but not a clean lifecycle for promoting an agent from draft to deployed production worker.* Three concrete gaps:

1. **No lifecycle states.** An agent is either installed or not (RFC 0070). There is no draft-vs-staged-vs-active distinction, no "paused" operational state, no "deprecated" sunset, and no "rolled-back" — so "this support resolver is the current production one, that one is the canary, that older one is the rollback target" cannot be expressed or audited. Agent creation/forking is a CRUD surface, not a deployment console.
2. **No channel binding → stale pins or no pin.** `AgentRef.version` is an exact pin (good for replay determinism, RFC 0002), but a workflow author who wants "always the current stable support-resolver" must either hard-code a version (which goes stale the moment a new one is promoted) or omit the pin (losing determinism). The registry has **no channel concept** (`node-packs.md` publishes discrete semver tags) — so there is nowhere for `@stable` / `@latest` to point.
3. **No audited, evidence-backed promotion.** Promoting a new version to production should be gated (a human approval per RFC 0051, an RBAC scope per RFC 0049) and *should be able to require evidence* (the RFC 0081 eval passed). Today none of that is wired: there is no promotion event, no canary mechanism to de-risk it, and no rollback pointer to recover.

The spec is the right place because *channel resolution semantics*, *the deployment state vocabulary*, *the promotion gate composition*, and above all *the channel×replay-determinism contract* are cross-host interop concerns — a workflow authored against `@stable` on one host must mean the same thing on another, and a replayed run must be deterministic regardless of channel movement. The *deployment store* (where records live, the canary router) stays a host implementation choice; this RFC fixes the binding grammar, the state machine, the audit events, the gate composition, and the replay pin — additively.

## Proposal

### §A — Binding grammar: `agentId@version` / `agentId@channel` / `agentId@latest`

`AgentRef` (RFC 0002) keeps its exact `version` pin unchanged. This RFC adds an **alternative, mutually-exclusive optional `channel`** field (and the same on the `WorkflowNode.agent` binding): a reference resolves a concrete version by **exactly one** of `version` (exact), `channel` (a named deployment channel, e.g. `"stable"` / `"canary"`), or `@latest` (the reserved channel = highest active version). A reference with neither is the RFC 0070 default (host resolves the installed version). `version` and `channel` set together is a `400 validation_error`.

```jsonc
"agent": { "agentId": "core.openwop.agents.support-resolver", "channel": "stable" }   // resolves at run-start
"agent": { "agentId": "…support-resolver", "version": "2.3.1" }                        // exact, unchanged
```

### §B — Channel resolution + replay determinism (the load-bearing contract; `version-negotiation.md`)

When a run binds `agentId@channel` (or `@latest`), the host **MUST** resolve the channel to a concrete `version` **at `run.started`**, record the resolved version as a recorded fact, and use that pinned version for the entire run — including every replay and fork. A replay/fork **MUST** re-read the recorded resolved version and **MUST NOT** re-resolve the channel (which may have moved). This is the `ctx.getVersion` / `version.pinned` model (`version-negotiation.md` §"Pinned change versions") applied to deployment channels, and the RFC 0077 `invocationId` recorded-fact posture (`replay.md` §"Recorded-fact events"). The resolved version is carried on the `agent.invocation.started` payload (RFC 0077, an additive optional `resolvedAgentVersion` / `resolvedChannel`) so it is observable without a separate event. A channel that resolves to **no** active version at run-start fails the run at create with `400 validation_error` (`no_active_deployment`) — fail-closed, never silently falling back to an arbitrary version.

### §C — The deployment state machine (`agent-deployment.schema.json`)

A **deployment record** is per-(`agentId`, `version`). Its `state` is one of seven:

| State | Meaning | Entered by |
|---|---|---|
| `draft` | authored, not yet evaluated | create/fork |
| `test` | undergoing eval (RFC 0081) | promote(draft→test) |
| `staged` | eval-passed, awaiting production promotion | promote(test→staged) |
| `active` | serving (optionally at `canaryPercent < 100`) | promote(staged→active) |
| `paused` | temporarily withdrawn, recoverable | pause(active→paused) |
| `deprecated` | sunset; no new traffic, existing pins honored | deprecate(active→deprecated) |
| `rolled-back` | superseded; `rollbackPointer` names the version that replaced it | rollback |

Legal transitions are enumerated normatively (forward promotion draft→test→staged→active; operational active↔paused; terminal active→deprecated; recovery active→rolled-back with a `rollbackPointer` to the version restored to `active`). The record also carries `canaryPercent` (0–100, the share of channel traffic this `active` version takes; the remainder goes to the prior `active`), `rollbackPointer` (the version to restore on rollback), `channels[]` (which named channels resolve to this version), `evalRunId?` (the RFC 0081 evidence), and `approvalGateId?` (the RFC 0051 gate that authorized the last transition).

### §D — The `deployment.*` audit-event family (content-free)

Four additive `RunEventType` values (payloads in `run-event-payloads.schema.json`), emitted on the deployment-management run/operation, all carrying the acting principal (RFC 0049) and audit-logged (RFC 0009/0010):

| Event | Payload (content-free) |
|---|---|
| `deployment.promoted` | `{ agentId, fromVersion?, toVersion, toState, channel?, canaryPercent?, evalRunId?, approvalGateId? }` |
| `deployment.rolled-back` | `{ agentId, fromVersion, toVersion, rollbackPointer, reason }` |
| `deployment.canary.adjusted` | `{ agentId, version, fromPercent, toPercent }` |
| `deployment.state.changed` | `{ agentId, version, fromState, toState }` (covers pause / deprecate and any non-promotion transition) |

None carries prompt, manifest body, or credential material (SR-1).

### §E — The promotion contract (composes RFC 0051 + 0049 + 0081)

A state transition is requested via the new `POST /v1/agents/{agentId}/deployments` (a transition request: `{ version, transition: "promote"|"pause"|"deprecate"|"rollback"|"adjust-canary", toState?, channel?, canaryPercent?, evalRunId? }`). The host **MUST**:

1. **Authorize fail-closed** against an RFC 0049 scope (`deploy:promote`, `deploy:rollback`, `deploy:pause`; absent/unseeded role denies — the `authorization-fail-closed` invariant), emitting `authorization.decided`.
2. **Run the approval gate** when the target transition is gated (host policy MAY require an RFC 0051 `approvalGate` for staged→active and for rollback); the gate's `requiredRole`/`quorum`/`override` apply, and `approval.{granted,rejected,overridden}` are emitted as today.
3. **Enforce the eval evidence** when the gate requires it: an `approvalGate` MAY be configured with `requiredEval: { evalRunId, requiredPassScore? }` (the §E seam RFC 0081 reserves). The host **MUST** verify the referenced eval run is terminal and `EvalSummary.passed` (or `aggregateScore >= requiredPassScore`) **before** emitting `deployment.promoted`; an unmet eval gate denies the promotion with `eval_gate_unmet`.

A host that advertises `agents.deployment.supported` but not `agents.evalSuite` (RFC 0081) MAY support promotion without the eval gate (the eval requirement is opt-in per gate config).

### §F — Capability advertisement (`agents.deployment`)

```jsonc
"agents": { "deployment": {
  "supported": true,
  "channels": ["stable", "canary", "latest"],   // named channels the host resolves
  "canary": true,                                 // host implements traffic-split canary
  "rollback": true,                               // host implements rollback pointer
  "states": ["draft","test","staged","active","paused","deprecated","rolled-back"]
}}
```

Truthful advertisement (RFC 0031): a host that doesn't split traffic MUST advertise `canary: false` and MUST reject `canaryPercent < 100`; a host that only supports a subset of states MUST advertise that subset and MUST reject transitions outside it.

### Examples

**Positive (eval-gated canary promotion).** `POST /v1/agents/…support-resolver/deployments { version:"2.4.0", transition:"promote", toState:"active", channel:"stable", canaryPercent:10, evalRunId:"run_abc" }` on a host advertising `agents.deployment` + `agents.evalSuite`, by a principal with `deploy:promote`, through an `approvalGate` with `requiredEval` → authorize → approval granted → verify `run_abc` `EvalSummary.passed` → emit `deployment.promoted{toVersion:"2.4.0",toState:"active",channel:"stable",canaryPercent:10,evalRunId:"run_abc"}`; `stable` now resolves 10% to 2.4.0, 90% to the prior active. A workflow binding `…support-resolver@stable` started now records `resolvedAgentVersion` (2.4.0 or the prior, per the canary draw) at `run.started` and replays to that exact version.

**Negative (fail-closed authz).** Same request by a principal lacking `deploy:promote` → `authorization.decided{allowed:false}` + `403`, no `deployment.promoted`. **Negative (eval gate).** `evalRunId` points to an eval with `passed:false` → `eval_gate_unmet`, promotion denied. **Negative (replay).** A host that re-resolved `@stable` on replay (instead of re-reading the pinned `resolvedAgentVersion`) → non-conformant by §B. **Negative (schema).** An `AgentRef` with both `version` and `channel` → `400 validation_error`.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). A new deployment-record schema; an additive optional `channel` on `AgentRef` + the `WorkflowNode.agent` binding (absent ⇒ today's exact-`version`-or-host-default behavior, unchanged); a new optional `agents.deployment` capability block (absent ⇒ the deployment endpoints 501, exactly as an unsupported feature does today); four additive content-free `RunEventType` values (consumers tolerate unknowns per §2.1); two additive sibling endpoints; one additive optional `resolvedAgentVersion`/`resolvedChannel` on the RFC 0077 `agent.invocation.started` payload; additive §sections in `node-packs.md` + `version-negotiation.md`. **No existing field is moved, renamed, removed, or type-changed; the exact-`version` pin keeps its meaning; no existing event/endpoint contract changes; no `MUST` is relaxed.** A host that omits `agents.deployment` is exactly as conformant as today. The channel binding does **not** weaken replay determinism — §B *strengthens* it by pinning the resolved version as a recorded fact (a `@channel` run is as deterministic on replay as an exact-`version` run). Adding the four event types does not bump `eventLogSchemaVersion` (RFC 0008 §K / 0058 precedent).

## Conformance

- **New scenarios:**
  - **`agent-deployment-shape.test.ts`** (always-on, server-free): the deployment record + the four `deployment.*` payloads validate; the seven-state vocabulary + legal-transition table are stable; the `channel` XOR `version` rule; negatives (both set; `canaryPercent` out of 0–100; content-bearing payload).
  - **`agent-deployment-lifecycle.test.ts`** (gated on `agents.deployment.supported`): a promote transition authorizes (RFC 0049), runs the gate (RFC 0051), enforces the eval gate when configured (RFC 0081), and emits `deployment.promoted`; a fail-closed denial emits no promotion; a `@channel`-bound run records `resolvedAgentVersion` at start and a replay re-reads it (the §B determinism contract). Soft-skips when unadvertised.
- **Capability gating** per `conformance/coverage.md` (shape always-on; lifecycle gated). New deployment fixture + `fixtures.md` row.
- **SECURITY:** `deployment-promotion-fail-closed` invariant (absent/unseeded `deploy:*` scope denies; promotion never bypasses the gate) + a public test; reuses `authorization-fail-closed` (RFC 0049).
- **Reference host.** Deferred (files at `Draft`). Schemas + events + capability + the binding grammar ship at `Draft → Active`; the lifecycle scenario soft-skips until a reference host implements the deployment store + canary router.

## Alternatives considered

1. **Reuse the registry semver tags as channels (publish `2.4.0` and let clients resolve "latest").** Rejected — "latest published" ≠ "current production": a published version may be staged or rolled back. Deployment state is a host-runtime concern (which version *serves*), distinct from registry publication (which version *exists*). §C separates them.
2. **Make `@channel` resolve lazily (per dispatch, not pinned at run-start).** Rejected — it would make a replayed run resolve to a *different* version than the original if the channel moved, breaking replay determinism (the core openwop guarantee). §B's run-start pin is non-negotiable.
3. **Put deployment state on `AgentManifest` (a `state` field in the pack).** Rejected — deployment state is per-host-runtime and changes without republishing the pack (promote/pause/rollback are operations, not edits). It belongs in a host deployment record, not the immutable manifest.
4. **Fold promotion into RFC 0051 (an approval gate with a "deployment" kind).** Rejected — RFC 0051 is the *human gate mechanism*; the deployment *state machine*, *channel resolution*, *canary*, and *rollback pointer* are a distinct surface that *composes* the gate. §E wires them without conflating them.
5. **Do nothing.** Rejected — Wave 3 ("deployable") needs this; without it, agent management is toy CRUD and RFC 0081's eval evidence has nothing to gate.

## Unresolved questions

**Resolved for `Active` (2026-05-30), validated by an `/architect` pass:** #1 deployment ops ride a lightweight management run (events + approval interrupt compose with the existing machinery; the run shape + endpoint defer to Accepted). **#2 + #3 are subsumed by the architect's load-bearing refinement:** channel resolution is pinned per-`(run, agentId, channel)` at FIRST resolution and reused within the run (not merely "at run.started") — the canary draw is performed once as part of that pin, recorded as `resolvedAgentVersion`, and never re-rolled on replay; `@latest` = highest active semver. #4 a version MAY be on multiple channels (`channels[]`). #5 RFC 0081 reserves `{evalRunId, requiredPassScore?}`, this RFC enforces (§E) — settled, 0081 is Active. #6 deployment channels follow `installScope` (tenant-scoped on a `'tenant'` host). **Architect-driven change to the SECURITY plan:** `deployment-promotion-fail-closed` is behavioral, so it ships at `reference-impl` tier (graduating to protocol at Accepted, RFC 0035 precedent) rather than as a vacuous always-on test; the structural content-free guarantee ships as the protocol-tier `deployment-event-no-content-leak` (real always-on public test). Original proposals retained below for the record:

1. **Deployment ops as a run vs a synchronous endpoint.** Do `deployment.*` events ride a dedicated management *run* (with its own `runId`, replayable/auditable), or are they audit-log entries emitted by a synchronous `POST` that returns the new record? Proposed: a lightweight management run (so the events + approval interrupt + audit compose with the existing run/interrupt machinery). Confirm against `interrupt.md` (the gate is an interrupt).
2. **Canary draw determinism on replay.** A canary traffic split is a random draw at `run.started`. Is the *draw outcome* (which version a given run got) recorded as a fact and replayed (yes — it must be, for §B), and is the *percentage* itself versioned per run? Proposed: the resolved version is the recorded fact (§B); the percentage is host-runtime state read at start. Confirm no replay divergence.
3. **`@latest` semantics.** Is `@latest` "highest active semver" or "most-recently-promoted"? Proposed: highest active semver (stable, monotonic). Confirm.
4. **Multi-channel per version.** May one version be `active` on `stable` *and* `canary` simultaneously, or is a version on exactly one channel? Proposed: `channels[]` allows multiple (a promoted-to-stable version is implicitly also resolvable by `@latest`). Confirm.
5. **`requiredEval` reference shape (the RFC 0081 §E seam).** Final shape + which RFC owns it. Proposed: RFC 0081 reserves `{evalRunId, requiredPassScore?}`; this RFC owns the *enforcement* (§E-3). Confirm the split with the RFC 0081 author (it's the same person this cycle, but pin it).
6. **Tenant scoping of deployments.** Are deployment channels host-global or tenant-scoped (the RFC 0074 `installScope` precedent)? Proposed: follow `agents.manifestRuntime.installScope` — tenant-scoped channels on a `'tenant'` host. Confirm.

## Implementation notes (non-normative)

- **Sequencing.** Depends on RFC 0081 (eval evidence, §E) and composes RFC 0051 (Accepted — the gate), RFC 0049 (Accepted — the scopes), RFC 0070/0072/0074/0077 (the agent + invocation surface), RFC 0002 (`AgentRef.version` the `channel` parallels), and `version-negotiation.md` (the pin model §B reuses). Second in Wave 3, after 0081.
- **Reference host.** Wiring is: a deployment-record store keyed by (`agentId`, `version`), a channel→version resolver invoked at `run.started` stamping `resolvedAgentVersion`, a canary router, a rollback pointer, and the `POST /v1/agents/{id}/deployments` transition handler gated by RFC 0049 + 0051 + (optional) 0081. The hardest part is the canary draw + the replay-pin discipline.
- **Demo impact** (out of scope): agent creation/forking becomes a real deployment console; canary a new resolver before replacing the active one.
- **Expected effort:** M for schemas + prose + shape conformance; L for the reference deployment store + canary + replay-pin lifecycle.

## Acceptance criteria

Landed at `Active` (2026-05-30) ✅ / deferred to `Active → Accepted` ⏳:

- [x] `spec/v1/agent-deployment.md` normative doc: §A binding, §B channel×replay pin (per-run-pin refinement), §C state machine + transitions, §D events, §E promotion contract, §F capability.
- [x] `agent-deployment.schema.json`; additive `channel` on `agent-ref.schema.json` (via `not`, propagating to `WorkflowNode.agent`); additive `agents.deployment` on `capabilities.schema.json`; four `deployment.*` RunEventTypes + content-free payloads; additive `resolvedAgentVersion`/`resolvedChannel` on the RFC 0077 `agent.invocation.started` payload; `node-packs.md` §"Deployment channels"; `version-negotiation.md` §"Channel resolution + replay".
- [ ] ⏳ `GET` + `POST /v1/agents/{agentId}/deployments` in `openapi.yaml` + deployment channels in `asyncapi.yaml` (deferred — behavioral surface, RFC 0077 precedent).
- [x] SECURITY: protocol-tier `deployment-event-no-content-leak` + its always-on public test; `deployment-promotion-fail-closed` at `reference-impl` tier (graduates to protocol at Accepted); `authorization-fail-closed` (RFC 0049) covers the structural fail-closed at Active.
- [x] Conformance: `agent-deployment-shape.test.ts` (always-on) + `coverage.md` row. ⏳ `agent-deployment-lifecycle.test.ts` (gated/behavioral) + fixture + `fixtures.md` deferred.
- [x] CHANGELOG entry. ⏳ INTEROP-MATRIX row (no host advertises `deployment` yet).
- [x] All six Unresolved questions resolved (recorded in `Updated:` + above).
- [ ] ⏳ Reference host implements the deployment store + channel pin + the gated promotion + passes the scenario — the explicit `Active → Accepted` gate.

## References

- `docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0082" — the source recommendation.
- [`RFCS/0081-agent-evaluation-and-scorecards.md`](./0081-agent-evaluation-and-scorecards.md) — the eval evidence (§E) the promotion gate enforces; the `{evalRunId, requiredPassScore?}` seam.
- [`RFCS/0051-approval-deployment-gate-primitive.md`](./0051-approval-deployment-gate-primitive.md) — the `approvalGate` (the human gate §E composes).
- [`RFCS/0049-rbac-scopes-and-authorization-decisions.md`](./0049-rbac-scopes-and-authorization-decisions.md) — the `deploy:*` scopes + `authorization-fail-closed` (§E-1).
- [`spec/v1/auth.md`](../spec/v1/auth.md) — the audit log the `deployment.*` events are recorded to (§D); RFC 0009/0010 are its conformance, per the RFC 0051 precedent.
- [`RFCS/0002-agent-identity-and-reasoning-events.md`](./0002-agent-identity-and-reasoning-events.md) — `AgentRef.version` the `channel` field parallels (§A).
- [`RFCS/0070-agent-manifest-runtime.md`](./0070-agent-manifest-runtime.md) + [`RFCS/0072-agent-inventory-and-dispatch.md`](./0072-agent-inventory-and-dispatch.md) + [`RFCS/0074-tenant-scoped-agent-inventory.md`](./0074-tenant-scoped-agent-inventory.md) — the agent surface + `installScope` (UQ #6).
- [`RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md`](./0077-agent-run-lifecycle-and-live-manifest-dispatch.md) — the `agent.invocation.started` payload that carries `resolvedAgentVersion` (§B).
- [`spec/v1/version-negotiation.md`](../spec/v1/version-negotiation.md) §"Pinned change versions" — the `ctx.getVersion` pin model §B reuses; [`spec/v1/replay.md`](../spec/v1/replay.md) §"Recorded-fact events".
- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — registry semver tags (distinct from deployment channels, §C / Alt 1).
- [`COMPATIBILITY.md`](../COMPATIBILITY.md) §2.1 — additive-change discipline.

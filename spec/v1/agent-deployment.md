# openwop Spec v1 — Agent Deployment Lifecycle

> **Status: DRAFT v1.x (filed via [RFC 0082](../../RFCS/0082-agent-deployment-lifecycle.md), 2026-05-30).** Additive v1.x extension — not part of the v1.0 conformance gate. Lands the `agentId@channel` binding, the seven-state deployment machine, the channel→version replay pin (§B), the content-free `deployment.*` events, the `capabilities.agents.deployment` advertisement, and the promotion contract. The `POST /v1/agents/{agentId}/deployments` endpoint, the SDK helpers, the behavioral lifecycle scenario, and the reference-host deployment store land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

openwop has packs, manifest agents (RFC 0070/0072/0074), approvals (RFC 0051), RBAC (RFC 0049), and — with RFC 0081 — eval scorecards. What it lacks is a **lifecycle**: a way to promote an agent from draft to a deployed production worker, canary a new version against the active one, roll back, and bind a workflow to "the stable channel" rather than a frozen exact version. Today an [`AgentRef`](../../schemas/agent-ref.schema.json) carries an exact `version` pin (RFC 0002) and the registry publishes discrete semver tags with **no channel concept** — so "use the current production support-resolver" can only be a stale hard-coded version or an undeterministic omission, and there is no audited record of *who promoted what, when, and on what evidence*.

This document adds that lifecycle **additively**: a [deployment state machine](../../schemas/agent-deployment.schema.json) (draft → test → staged → active, plus paused / deprecated / rolled-back), a named-channel binding (`agentId@channel` / `@latest`) that resolves to a concrete version, canary percentage + a rollback pointer, a content-free `deployment.*` audit-event family, and a promotion contract that composes RFC 0051's `approvalGate` (the human gate), RFC 0049's `deploy:*` scopes (fail-closed), and RFC 0081's `EvalSummary.passed` (the evidence gate). Crucially (§B), a `@channel` binding **MUST resolve to a concrete version, pinned per-run, recorded as a fact** — so a replayed run is exactly as deterministic as one that pinned an exact version. Deployment *state* is host-runtime (which version *serves*), distinct from registry publication (which version *exists*).

## §A — Binding grammar: `version` / `channel` / `@latest`

`AgentRef` keeps its exact `version` pin unchanged. This document adds an **alternative, mutually-exclusive optional `channel`** field on `AgentRef` (and therefore on the `WorkflowNode.agent` binding, which `$ref`s `AgentRef`). A reference resolves a concrete version by **at most one** of:

- `version` — an exact pin (RFC 0002, unchanged);
- `channel` — a named deployment channel (e.g. `"stable"`, `"canary"`, or the reserved `"latest"` = highest active semver);
- neither — the RFC 0070 host-default resolution.

A reference that sets **both** `version` and `channel` is a `400 validation_error` (enforced by the `not: { required: ["version", "channel"] }` clause on `agent-ref.schema.json`). A host that does not advertise `capabilities.agents.deployment.supported: true` **MUST** reject a `channel`-bearing reference with `validation_error` — the channel has nowhere to resolve.

## §B — Channel resolution + replay determinism (the load-bearing contract)

When a run binds `agentId@channel` (or `@latest`), the host **MUST**:

1. **Resolve the channel to a concrete `version`** the first time that `(agentId, channel)` pair is resolved within the run.
2. **Pin it per-`(run, agentId, channel)`**: every subsequent resolution of the same pair **within the same run** **MUST** return the same version — the host **MUST NOT** re-resolve against a channel that may have moved mid-run. This is the `ctx.getVersion` / `version.pinned` model (`version-negotiation.md` §"Pinned change versions", axis 4) applied to deployment channels.
3. **Record the resolved version as a recorded fact**: it is carried on the `agent.invocation.started.resolvedAgentVersion` field (with `resolvedChannel`), an additive optional field on the RFC 0077 invocation event, which is a recorded-fact event per `replay.md` §"Recorded-fact events". On replay/fork the host **MUST** re-read the recorded `resolvedAgentVersion` and **MUST NOT** re-resolve the channel.

A channel that resolves to **no** `active` version at first resolution **MUST** fail the run with `no_active_deployment` (`400 validation_error` at run-create when the binding is static) — fail-closed, never silently falling back to an arbitrary version.

**Canary determinism.** When a channel has more than one `active` version (a canary split, §C), the choice of which version a given run receives is a single draw performed **as part of** the §B first-resolution pin — its outcome **is** `resolvedAgentVersion`. The draw **MUST NOT** be re-rolled on replay; like any §B resolution it is re-read from the recorded fact. There is no separate canary-determinism mechanism — the per-run pin subsumes it.

This is why the `@channel` binding *strengthens* rather than weakens replay determinism: a `@stable` run records and replays to one exact version, identical in determinism to an exact-`version` run.

## §C — The deployment state machine

A [deployment record](../../schemas/agent-deployment.schema.json) is per-(`agentId`, `version`). Its `state` is one of seven, with normatively-enumerated legal transitions:

| State | Meaning | Entered by |
|---|---|---|
| `draft` | authored, not yet evaluated | create / fork |
| `test` | undergoing eval (RFC 0081) | promote(draft→test) |
| `staged` | eval-passed, awaiting production promotion | promote(test→staged) |
| `active` | serving (optionally at `canaryPercent < 100`) | promote(staged→active) |
| `paused` | temporarily withdrawn, recoverable | pause(active→paused) |
| `deprecated` | sunset; no new traffic, existing pins honored | deprecate(active→deprecated) |
| `rolled-back` | superseded; `rollbackPointer` names the replacement | rollback(active→rolled-back) |

Legal transitions: forward promotion `draft→test→staged→active`; operational `active↔paused`; terminal `active→deprecated`; recovery `active→rolled-back` (with a `rollbackPointer` to the version restored to `active`). A host **MUST** reject a transition into a state it does not advertise in `capabilities.agents.deployment.states`. The record also carries `canaryPercent` (the share of channel traffic this `active` version takes; the remainder goes to the prior `active`), `rollbackPointer`, `channels[]` (the named channels resolving to this version — a version MAY be on more than one, e.g. `stable` + `latest`), and the `evalRunId` / `approvalGateId` provenance of the last transition.

## §D — The `deployment.*` audit-event family

Four additive **content-free** `RunEventType` values (payloads in [`run-event-payloads.schema.json`](../../schemas/run-event-payloads.schema.json)), emitted on the deployment-management run, each carrying the acting principal (RFC 0049) and audit-logged (`auth.md`; RFC 0009/0010 conformance):

| Event | Payload |
|---|---|
| `deployment.promoted` | `{ agentId, fromVersion?, toVersion, toState, channel?, canaryPercent?, evalRunId?, approvalGateId? }` |
| `deployment.rolled-back` | `{ agentId, fromVersion, toVersion, rollbackPointer, reason? }` |
| `deployment.canary.adjusted` | `{ agentId, version, fromPercent, toPercent }` |
| `deployment.state.changed` | `{ agentId, version, fromState, toState }` |

All four are `additionalProperties: false` and carry ids / states / scalars / content-free references **only** — never a manifest body, prompt, or credential (SECURITY invariant `deployment-event-no-content-leak`). They are recorded-fact events: re-read from the log on replay, identifiers never regenerated. Deployment-management events appear on the deployment-management run, not on consuming workflow runs — a consuming run sees only its own `agent.invocation.started.resolvedAgentVersion`.

## §E — The promotion contract

A state transition is requested via `POST /v1/agents/{agentId}/deployments` (the endpoint lands at Active → Accepted): `{ version, transition: "promote"|"pause"|"deprecate"|"rollback"|"adjust-canary", toState?, channel?, canaryPercent?, evalRunId? }`. The host **MUST**:

1. **Authorize fail-closed** against an RFC 0049 scope (`deploy:promote` / `deploy:rollback` / `deploy:pause`; absent/unseeded role denies — the `authorization-fail-closed` invariant), emitting `authorization.decided`.
2. **Run the approval gate** when the transition is gated (host policy MAY require an RFC 0051 `approvalGate` for `staged→active` and for rollback); the gate's `requiredRole` / `quorum` / `override` apply, and `approval.{granted,rejected,overridden}` are emitted as today.
3. **Enforce the eval evidence** when the gate requires it: an `approvalGate` MAY carry `requiredEval: { evalRunId, requiredPassScore? }` (the seam RFC 0081 §E reserves). The host **MUST** verify the referenced eval run is terminal and `EvalSummary.passed` (or `aggregateScore >= requiredPassScore`) **before** emitting `deployment.promoted`; an unmet eval gate denies with `eval_gate_unmet`.

A host advertising `agents.deployment.supported` but not `agents.evalSuite` (RFC 0081) MAY support promotion without the eval gate (the eval requirement is opt-in per gate config).

The promotion fail-closed guarantee is, at this stage, the existing protocol-tier `authorization-fail-closed` (RFC 0049) applied to `deploy:*`; the deployment-specific behavioral invariant `deployment-promotion-fail-closed` ships at `reference-impl` tier and **graduates to protocol tier at `Accepted`** when the behavioral lifecycle scenario lands (the RFC 0035 sandbox-invariant precedent).

## §F — Capability advertisement

```jsonc
"agents": { "deployment": {
  "supported": true,
  "channels": ["stable", "canary", "latest"],
  "canary": true,
  "rollback": true,
  "states": ["draft","test","staged","active","paused","deprecated","rolled-back"]
}}
```

Truthful advertisement (RFC 0031): a host that doesn't split traffic **MUST** advertise `canary: false` and **MUST** reject any `canaryPercent < 100`; a host that implements a subset of states **MUST** advertise that subset and **MUST** reject transitions outside it. Tenant scoping follows `agents.manifestRuntime.installScope` (RFC 0074) — deployment channels are tenant-scoped on a `'tenant'` host.

## Open spec gaps

| ID | Description |
|---|---|
| DEPLOY-1 | `GET` + `POST /v1/agents/{agentId}/deployments` + the deployment-management run shape are described here but land in `openapi.yaml` + the `OpenwopClient` SDK helper at `Active → Accepted` (RFC 0082 §Conformance; behavioral surface deferred per the RFC 0077 precedent). |
| DEPLOY-2 | The behavioral `agent-deployment-lifecycle.test.ts` (authz → gate → eval-verify → `deployment.promoted`; the §B replay re-read) is gated on `capabilities.agents.deployment.supported` and soft-skips until a reference host wires the deployment store + canary router. |
| DEPLOY-3 | `deployment-promotion-fail-closed` is `reference-impl` tier until the behavioral scenario lands, then graduates to `protocol` tier (Accepted). |
| DEPLOY-4 | A portable cross-host deployment *migration* (export/import of a deployment graph between hosts) is out of scope at v1.x — deployment records are host-runtime state. |

## References

- [`RFCS/0082-agent-deployment-lifecycle.md`](../../RFCS/0082-agent-deployment-lifecycle.md) — the filing RFC.
- [`schemas/agent-deployment.schema.json`](../../schemas/agent-deployment.schema.json) + [`schemas/agent-ref.schema.json`](../../schemas/agent-ref.schema.json) — the deployment record + the `channel` binding.
- [`version-negotiation.md`](./version-negotiation.md) §"Channel resolution + replay" + §"Pinned change versions" — the §B pin model.
- [`replay.md`](./replay.md) §"Recorded-fact events" — the determinism posture for `resolvedAgentVersion` + the `deployment.*` events.
- [`agent-evaluation.md`](./agent-evaluation.md) §E — the `{evalRunId, requiredPassScore?}` seam the promotion gate enforces (RFC 0081).
- `RFCS/0049` (`deploy:*` scopes + `authorization-fail-closed`), `RFCS/0051` (`approvalGate`), `RFCS/0077` (the `agent.invocation.started` payload that carries `resolvedAgentVersion`).
- [`node-packs.md`](./node-packs.md) §"Deployment channels" — registry semver tags (what *exists*) vs deployment channels (what *serves*).
</content>

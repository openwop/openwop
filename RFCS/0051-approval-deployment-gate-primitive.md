# RFC 0051: Approval & deployment-gate primitive

| Field | Value |
|---|---|
| **RFC** | 0051 |
| **Title** | `core.openwop.governance.approvalGate` — a first-class, role-bound, audited interrupt node for approvals and deployment promotions, composing the existing interrupt-profile machinery (quorum, auth-required) with RFC 0049 authorization and the audit log |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-24 |
| **Affects** | new `core.openwop.governance` pack (`approvalGate` node) · `schemas/run-event-payloads.schema.json` (additive `approval.*` events) · `spec/v1/interrupt-profiles.md` (composes quorum + auth-required) · RFC 0049 (role binding) · RFC 0009/0010 (audit log) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add a first-class **approval/deployment-gate** node, `core.openwop.governance.approvalGate` — an interrupt node with `requiredRole`/`requiredScope`, optional quorum, and a role-gated, audited `override` path — surfacing its request via the canonical `interrupt.requested` (`kind: 'approval'`) event plus three new outcome events `approval.granted` / `approval.rejected` / `approval.overridden`. It composes the existing interrupt-profile machinery (RFC's quorum + auth-required-resume) with RFC 0049 authorization and the RFC 0009/0010 audit log, so "approval as a governed, role-bound, audited gate" — distinct from a generic clarification interrupt — becomes portable and certifiable.

## Motivation

MyndHyve runs an **always-on CMS workflow approval gate**: a page can't publish unless its stage is `approved`/`published`, and force-publish is owner/admin-only and audit-logged. It also has generic HITL interrupt nodes. openwop already has interrupt *profiles* (multi-approver quorum, auth-required resume) but no **first-class approval/deployment gate** that binds to RBAC and emits governance events. So "this gate required an `admin` and the override was logged" is host-private semantics — an A2A peer sees a generic interrupt, and conformance can't assert that an unauthorized principal is denied at the gate or that an override is audited.

The spec is the right place because approval/deploy-promote is a governance-interop concern: the role binding (RFC 0049), the audit trail (RFC 0009/0010), and the resume contract (`interrupt.md`) are all already protocol surfaces — this RFC composes them into one certifiable node rather than letting each host stitch them privately.

## Proposal

### §A — `core.openwop.governance.approvalGate` node (normative)

An **interrupt node** (`kind: 'approval'` per `spec/v1/interrupt.md`) with config:

```json
{
  "requiredRole": "admin",
  "requiredScope": "deploy:promote",
  "quorum": 2,
  "override": { "requiredRole": "owner", "audited": true },
  "resumeSchema": { "decision": "granted | rejected", "reason": "string?" }
}
```

- `requiredRole` / `requiredScope` — at least one MUST be present; the resuming principal (RFC 0048) MUST satisfy it per the RFC 0049 decision (fail-closed: an unauthorized or unseeded principal is denied, the run stays suspended).
- `quorum` (optional) — reuses the existing `openwop-interrupt-quorum` profile: N distinct authorized principals MUST grant before the gate releases.
- `override` (optional) — a role-gated escape hatch (e.g. owner force-publish). Taking it MUST emit `approval.overridden` and MUST write an audit entry.

### §B — Events (additive, redaction-safe)

**Request.** The gate's *request* surfaces via the canonical **`interrupt.requested` with `kind: 'approval'`** (per `interrupt.md` — the modern interrupt-primitive event), carrying the gate fields (`gateId`, `requiredRole`/`requiredScope`, `quorum`) in the interrupt `data`. The gate does NOT use the legacy `approval.requested` event (which is the back-compat artifact-approval shape; `interrupt.md` already directs modern servers to `interrupt.requested`).

**Outcomes.** Add three new governance events to `run-event-payloads.schema.json`:

- `approval.granted` → `{ gateId, principal, quorumProgress? }`
- `approval.rejected` → `{ gateId, principal, reason? }`
- `approval.overridden` → `{ gateId, principal, reason }` — MUST feed the audit log.

All redaction-safe (opaque principal ids, no credential material).

### §C — Resume contract

Resume follows the engine interrupt contract (`spec/v1/interrupt.md`): the resume value is validated against the node's `resumeSchema`; a malformed resume is rejected with `400 INVALID_RESUME_VALUE` and the run stays suspended. A reject (`decision: 'rejected'`) loops the run back per the workflow's edges (it does not terminate the run by default).

## Compatibility

**Additive.** New optional pack + node; new event types consumers can ignore; composes existing interrupt profiles without changing them. No required-field change; no wire-shape change to the interrupt primitive itself. Hosts without RFC 0049 authorization can't satisfy `requiredRole`, so the node's `peerDependency` is `authorization: 'supported'` — it refuses to register otherwise (the `core.openwop.files`-against-`host.fs` pattern).

**Depends on RFC 0049** (role binding). Composes with the existing interrupt profiles and the RFC 0009/0010 audit log.

## Conformance

- **`approval-gate-grant.test.ts`** — an authorized principal (satisfying `requiredRole`/`requiredScope`) grants; the gate releases; `approval.granted` is emitted. (Gated on the `core.openwop.governance` pack + `authorization.supported`.)
- **`approval-gate-unauthorized.test.ts`** — an unauthorized principal is denied; the run stays suspended; `approval.rejected` (or an `authorization.decided { allowed:false }`) is emitted. Fail-closed. (Gated.)
- **`approval-gate-override-audited.test.ts`** — taking the `override` path emits `approval.overridden` AND writes an audit-log entry. (Gated on `authorization.supported` ∧ audit profile.)
- **`approval-gate-reject-loopback.test.ts`** — a reject loops the run back per the workflow edges rather than terminating; a malformed resume → `400 INVALID_RESUME_VALUE`. (Gated.)
- **`approval-gate-quorum.test.ts`** — N distinct authorized grants required before release. (Gated on `quorum` config + the quorum profile.)

New fixture: a minimal workflow with an `approvalGate` node + seeded roles, catalogued in `fixtures.md`.

## Alternatives considered

1. **Use a generic clarification/approval interrupt and let hosts add role checks privately.** Rejected — that is exactly today's state; the role binding and audit trail stay host-private and uncertifiable. The value is the *composed, certified* gate.
2. **Model the gate as a capability advertisement rather than a node.** Rejected — an approval gate is a point in a workflow DAG, not a host-wide capability; it belongs as a node so workflow authors can place it. The host capability it *needs* (RFC 0049) is advertised separately.
3. **Bake force-publish/deploy-promote as distinct named nodes.** Rejected — they're the same primitive (role-gated audited release) with different config; one node with `override` covers approval, force-publish, and deploy-promote without proliferating node types.

## Unresolved questions

1. **Time-boxed approvals.** Should the gate support an auto-reject (or auto-grant) on `timeoutMs` expiry, reusing `interrupt.timeoutMs`? Likely yes (auto-reject, fail-closed); pin the default before Active.
2. **Quorum + override interaction.** If a quorum is configured, can a single `override`-role principal bypass the remaining quorum? Probably yes (that's the point of override) but it MUST be audited; confirm before Active.
3. **Delegation.** Can an authorized principal delegate their approval authority? Out of scope for v1; revisit if an adopter pulls.

## Implementation notes (non-normative)

- The pack + node + events land on `Active` promotion with the conformance scenarios.
- Reference-adopter target: MyndHyve re-expresses its CMS approval gate + force-publish as this node; `cms.page.force_published` maps to `approval.overridden`; its existing approval-gate card (`WorkflowCardRenderer`) renders the protocol events.

## Acceptance criteria

- [x] Spec text merged (this file).
- [x] `core.openwop.governance.approvalGate` node contract defined in `spec/v1/interrupt-profiles.md` (config + normative requirements; the executable pack is reference-impl work).
- [x] `approval.granted` / `approval.rejected` / `approval.overridden` events in `run-event-payloads.schema.json` (+ `RunEventType` enum). The request surfaces via the canonical `interrupt.requested` (`kind: 'approval'`) event per `interrupt.md` — NOT the legacy `approval.requested`.
- [x] Composition with quorum + auth-required profiles documented in `spec/v1/interrupt-profiles.md`.
- [~] Conformance — 2 of 5 landed: `approval-gate-events.test.ts` (server-free event-shape) + `approval-gate-flow.test.ts` (unauthorized-denied + override-audited, capability-gated on `authorization.supported`, `governance/approval-gate` seam soft-skips). The grant-releases / reject-loopback / quorum scenarios are deferred until a host registers the gate.
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host registers the gate and passes the unauthorized + override-audited scenarios.

**Implementation note (2026-05-25):** The three governance events + the `approvalGate` node contract (in `interrupt-profiles.md`, composing the quorum + auth-required profiles with RFC 0049 authorization) + the two scenarios + the `governance/approval-gate` seam landed on `main`. the gate's request surfaces via the canonical `interrupt.requested` (`kind: 'approval'`) event (per `interrupt.md` modern guidance — not the legacy `approval.requested`); the three new outcome events are `granted`/`rejected`/`overridden`. No new SECURITY invariant — fail-closed denial reuses RFC 0049's `authorization-fail-closed`; override-audited is conformance-asserted. Status stays `Draft`. **Completes Tier 2** of the MyndHyve protocol-extension batch on the openwop side.

## References

- [`RFCS/0049-rbac-scopes-and-authorization-decisions.md`](./0049-rbac-scopes-and-authorization-decisions.md) — the role binding + fail-closed decision the gate enforces (hard dependency).
- [`spec/v1/interrupt-profiles.md`](../spec/v1/interrupt-profiles.md) — `openwop-interrupt-quorum` + `openwop-interrupt-auth-required`, composed here.
- [`spec/v1/interrupt.md`](../spec/v1/interrupt.md) — the resume contract + `resumeSchema` validation (`INVALID_RESUME_VALUE`).
- [`RFCS/0009-production-profile-conformance.md`](./0009-production-profile-conformance.md) · [`0010`](./0010-auth-profile-conformance.md) — the audit log the override feeds.

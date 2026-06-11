# OpenWOP Spec v1 — Interrupt Profiles

> **Status: Stable · v1.1 (2026-05-10).** Optional interrupt-profile annex for hosts that implement stronger human-in-the-loop and external-event flows than the base `interrupt.md` contract. This document is additive and does not change required v1 interrupt wire shapes. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

`interrupt.md` standardizes durable suspend/resume for approvals, clarifications, edits, and external events. Production workflows often need richer policies: more than one approver, authenticated resumes, parent/child cancellation, and correlation against external systems.

These profiles let hosts claim those behaviors without forcing every v1 implementation to support them.

---

## Profile catalog

### `openwop-interrupt-quorum`

The host can require multiple approvers before an approval interrupt resolves.

**Requirements:**

- The interrupt payload documents the required quorum count and allowed approver identities or groups.
- Each approval decision is recorded with actor, timestamp, action, and optional reason.
- The run resumes only after quorum is satisfied.
- Rejection semantics are deterministic: host documentation MUST state whether one reject vetoes the interrupt or whether quorum rules apply symmetrically.
- Duplicate decisions from the same actor are idempotent and auditable.

**Conformance gaps to close:** add `conformance-approval-quorum` with accept/duplicate/reject paths.

### `openwop-interrupt-auth-required`

The host requires authenticated resume calls and validates that the caller is authorized for the suspended run.

**Requirements:**

- Unauthenticated resume attempts return `401`.
- Authenticated but unauthorized resume attempts return `403`.
- Resume requests include the canonical `Authorization: Bearer ...` flow from `auth.md` unless the host documents a stronger auth profile from `auth-profiles.md`.
- Signed callback tokens, if supported, are scoped to one interrupt and expire.

**Conformance gaps to close:** extend approval and clarification scenarios with missing, wrong-tenant, and expired-callback-token cases.

### `openwop-interrupt-external-event`

The host can suspend until an external event arrives and can correlate that event back to the waiting run.

**Requirements:**

- The interrupt payload contains a stable `correlationId`.
- External event ingestion is idempotent by `(correlationId, eventId)` or an equivalent documented key.
- Unknown, expired, or already-resolved correlations return canonical error envelopes.
- The resumed run records the external event payload in the event log or run state with redaction applied.
- While suspended, the run's `RunSnapshot.status` is `"waiting-external"` (added to the enum in `schemas/run-snapshot.schema.json` 2026-05-20). Hosts that pre-date the enum addition MAY surface `"waiting-input"` instead — readers MUST treat both as observably-equivalent for this profile.

### `openwop-interrupt-cascade-cancel`

The host propagates cancellation between parent and child runs created through sub-workflow dispatch.

**Requirements:**

- Cancelling a parent either cancels active child runs or documents a deliberate detach policy.
- Cancelling a child surfaces a deterministic parent outcome.
- Parent/child cancellation events preserve `parentRunId` and `parentNodeId` linkage.
- A cascaded-cancel `run.cancelled` event MUST carry `payload.reason = "parent-cancelled"` AND `payload.parentRunId` set to the run id that initiated the cascade (see `run-event-payloads.schema.json $defs.runCancelled.parentRunId`). Direct cancellations MUST NOT set `parentRunId`, so consumers can distinguish "I cancelled this run" from "the parent cascaded into this run."
- Open child interrupts at cancellation time MUST be invalidated. A subsequent `POST /v1/runs/{childRunId}/interrupts/{nodeId}` (or `POST /v1/interrupts/{token}`) call against an invalidated interrupt MUST return `410 Gone` with `error: "interrupt_gone"` (preferred), or `409 Conflict` with `error: "interrupt_already_resolved"` (acceptable back-compat for hosts that don't distinguish the two states).
- Cancellation remains idempotent and terminal-state safe.

**Conformance gaps to close:** add parent/child cancellation fixtures building on `subworkflow.test.ts`.

### `core.openwop.governance.approvalGate` (RFC 0051)

A first-class, **role-gated, audited** approval/deployment-gate node — distinct from a generic clarification/approval interrupt. It is an interrupt node (`kind: 'approval'` per `interrupt.md`) that composes the `openwop-interrupt-quorum` + `openwop-interrupt-auth-required` profiles above with RFC 0049 authorization, so "approval as a governed gate" (CMS publish, force-publish, deploy-promote) is portable and certifiable. Requires a host advertising `capabilities.authorization.supported` (peerDependency `authorization: 'supported'`).

**Node config:**

```jsonc
{
  "requiredRole": "admin",          // at least one of requiredRole / requiredScope MUST be present
  "requiredScope": "deploy:promote",
  "quorum": 2,                       // optional — reuses openwop-interrupt-quorum
  "override": { "requiredRole": "owner", "audited": true },  // optional role-gated escape hatch
  "overrideBypassesQuorum": false,   // optional, default false — see §"Approval-gate timeout and quorum override" (RFC 0093)
  "timeoutSec": 86400,               // optional — see §"Approval-gate timeout and quorum override" (RFC 0093)
  "resumeSchema": { "decision": "granted | rejected", "reason": "string?" }
}
```

**Requirements (normative):**

- The gate's **request** surfaces via the canonical `interrupt.requested` event with `kind: 'approval'` (per `interrupt.md` — the modern interrupt-primitive event), carrying the gate fields (`gateId`, `requiredRole`/`requiredScope`, `quorum`) in the interrupt `data`. The gate MUST NOT use the legacy `approval.requested` event for its request.
- The resuming `principal` (RFC 0048) MUST satisfy `requiredRole` / `requiredScope` per the RFC 0049 decision. An unauthorized or unseeded principal is denied (fail-closed per RFC 0049 §C — `authorization-fail-closed`); the run stays suspended and the host SHOULD emit `authorization.decided { allowed: false }`.
- A grant emits `approval.granted`; when `quorum` is set, the gate releases only after N distinct authorized grants (each grant carries `quorumProgress`).
- A reject emits `approval.rejected` and loops the run back per the workflow's edges — it does NOT terminate the run by default.
- Taking the `override` path MUST emit `approval.overridden { principal, reason }` (reason REQUIRED) AND write an audit-log entry (RFC 0009/0010). The overriding principal MUST satisfy `override.requiredRole`.
- The resume value is validated against `resumeSchema` per the engine interrupt contract; a malformed resume MUST be rejected with `400 INVALID_RESUME_VALUE` and the run stays suspended.
- All `approval.*` events are redaction-safe — `principal` is an opaque RFC 0048 id; no credential material in `reason`.

#### Approval-gate timeout and quorum override (RFC 0093)

RFC 0051 left two gate decisions marked "pin before Active"; RFC 0093 pins both:

- **Timeout ⇒ auto-reject (fail closed).** The gate's timeout is `timeoutSec` from the node config when present; the host's default timeout when unset; no timeout when neither exists. When an approval gate reaches its timeout, the gate MUST resolve as **rejected** with resolution reason `timeout`, emitting the standard `interrupt.resolved` event with `outcome: "rejected"` and `reason: "timeout"`. Auto-approving on timeout fails open and is non-conformant — every other gate-shaped surface in the corpus (RFC 0049 authorization, RFC 0082 deployment promotion) fails closed.
- **Quorum override is opt-in.** A principal taking the `override` path MAY bypass `quorum` only when the node config explicitly sets `overrideBypassesQuorum: true`. The default is `false`: absent the flag, an override principal's grant counts as **one** quorum vote. In both cases the override path MUST still emit `approval.overridden { principal, reason }` and write the audit-log entry per the requirements above. (`overrideBypassesQuorum` is an additive optional boolean on the gate's node config, default `false`.)

**Conformance gaps to close:** `approval-gate-flow.test.ts` (capability-gated): role-gated grant releases; unauthorized principal denied (run stays suspended); override emits `approval.overridden` + an audit entry; reject loops back; quorum requires N grants. Behavioral assertions gate on the `POST /v1/host/sample/governance/approval-gate` seam and soft-skip until a governance-advertising host wires it.

---

## Discovery guidance

Interrupt-profile details MAY be advertised under `extensions.interrupts`:

```json
{
  "extensions": {
    "interrupts": {
      "profiles": ["openwop-interrupt-auth-required", "openwop-interrupt-external-event"],
      "signedCallbackTokens": true,
      "externalEventRetentionSeconds": 86400
    }
  }
}
```

The extension is advisory. Profile pass/fail status is determined by runtime conformance scenarios and host documentation, not by the presence of this extension alone.

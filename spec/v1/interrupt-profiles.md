# openwop Spec v1 — Interrupt Profiles

> **Status: FINAL v1 (2026-05-10).** Optional interrupt-profile annex for hosts that implement stronger human-in-the-loop and external-event flows than the base `interrupt.md` contract. This document is additive and does not change required v1 interrupt wire shapes. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

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
- Cancellation remains idempotent and terminal-state safe.

**Conformance gaps to close:** add parent/child cancellation fixtures building on `subworkflow.test.ts`.

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


# RFC 0044: Confidence-escalation interrupt-kind advertisement (clarification to RFC 0039 §A)

| Field | Value |
|---|---|
| **RFC** | 0044 |
| **Title** | `multiAgent.executionModel.confidenceEscalationInterruptKind` capability advertisement — supports canonical (`clarification` / `approval`) and vendor-extension (`x-host-<host>-<kind>`) interrupt-kind names without forcing cross-cutting rename on hosts with entrenched kinds |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-22 |
| **Updated** | 2026-05-22 (Draft → Active same-day: small additive clarification to RFC 0039 §A following the RFC 0034/0037/0039/0040/0041 same-day pattern. The capability flag is purely additive — no required-field changes, no normative shifts on the underlying confidence-floor escalation contract. Path to `Accepted`: a non-steward host advertises the new capability + the relaxed conformance scenario passes against the advertised kind.) |
| **Affects** | `spec/v1/multi-agent-execution.md` §"Confidence escalation (RFC 0039 Phase 2, normative)" (extends with the new capability + the host-advertised kind-routing rule) · `schemas/capabilities.schema.json` (additive `confidenceEscalationInterruptKind` field) · `conformance/src/scenarios/multi-agent-confidence-escalation.test.ts` (reads the advertised kind; accepts vendor-extension kinds when present) · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add an optional `confidenceEscalationInterruptKind` field to `capabilities.multiAgent.executionModel`. The field's value is the literal `interrupt.kind` the host emits when it escalates a below-floor `OrchestratorDecision.confidence` per RFC 0039 §A. Canonical values are `"clarification"` and `"approval"` (matching the two escalation paths RFC 0039 §A specifies). Vendor extensions follow the canonical host-extension namespace `x-host-<host>-<kind>` per `spec/v1/host-extensions.md` §"Canonical prefixes". This lets hosts with entrenched vendor kinds (e.g., MyndHyve's `low-confidence`) advertise their kind for conformance without a cross-cutting rename across already-deployed UI + storage consumers.

## Motivation

RFC 0039 §A says hosts SHALL escalate below-floor decisions via a `clarify` interrupt OR an `escalate` (approval) interrupt. The conformance scenario `multi-agent-confidence-escalation.test.ts` was originally over-strict — asserting `terminal.status === 'waiting-clarification'` only — and was relaxed in commit `f03d01d` to accept either `waiting-clarification` or `waiting-approval`.

MyndHyve's adoption pass (2026-05-22) surfaced a real gap: their workflow-runtime has an entrenched `interrupt.kind: 'low-confidence'` semantic that cross-cuts `LOW_CONFIDENCE_SUSPEND_REASON` constants, `mockAgent.node` dispatch, `escalationThreshold.ts`, downstream UI consumers, and existing in-flight runs holding `waiting-approval`-equivalent state. Renaming to `clarification` or `approval` is multi-day cross-cutting work. Namespacing as `x-host-myndhyve-low-confidence` is still a rename.

This RFC adopts the same `spec-rfc-XXXX | x-host-<host>-<key>` advertisement pattern that RFC 0041 §A introduced for `replayDeterminism.llmCacheKeyRecipe`: the host advertises the kind it emits; conformance reads the advertised value and accepts the host's specific kind. Vendor extensions pass without renaming.

## Proposal

### §A — Capability advertisement (normative)

Add `confidenceEscalationInterruptKind` to `capabilities.multiAgent.executionModel` per `schemas/capabilities.schema.json`:

```diff
   "multiAgent": {
     "executionModel": {
       ...
       "confidenceEscalationFloor": { "type": "number", "minimum": 0.5, "maximum": 1.0 },
+      "confidenceEscalationInterruptKind": {
+        "type": "string",
+        "anyOf": [
+          { "const": "clarification" },
+          { "const": "approval" },
+          { "pattern": "^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$" }
+        ],
+        "description": "RFC 0044 — the `interrupt.kind` the host emits when escalating a below-floor confidence decision per RFC 0039 §A. `clarification` and `approval` are the canonical values (matching RFC 0039 §A's clarify-OR-approval choice); vendor-extension kinds use the canonical host-extension namespace per `spec/v1/host-extensions.md` §\"Canonical prefixes\". Hosts advertising this field MUST emit an interrupt of the advertised kind on every confidence-escalation event. Absent: conformance assumes the host uses one of the two canonical kinds (the relaxed assertion in `multi-agent-confidence-escalation.test.ts` accepts either)."
+      },
       ...
     }
   }
```

When the field is **absent**, the existing relaxed conformance assertion (accepts `waiting-clarification` OR `waiting-approval`) applies. When the field is **present**, conformance reads the advertised kind and asserts the run's terminal `interrupt.kind` matches exactly, AND the run's status is non-terminal (any `waiting-*` flavor — the status-name is derived from the kind per the host's own `interrupt.md` mapping).

### §B — Conformance routing (normative)

Update `conformance/src/scenarios/multi-agent-confidence-escalation.test.ts` to:

1. Read `capabilities.multiAgent.executionModel.confidenceEscalationInterruptKind` from the host's discovery doc.
2. **If advertised**: assert the resulting run carries an open `interrupt` with `kind === advertised-value`, AND the run's status starts with `waiting-` (any waiting-suffix is permissible — the canonical mapping is host-driven via `spec/v1/interrupt.md`).
3. **If absent**: keep the existing relaxed assertion — `terminal.status` is one of `{waiting-clarification, waiting-approval}`.

The `confidence-escalated` event payload's `escalationKind` field remains normated to `{clarify, escalate}` per RFC 0039 §A; that's the wire-shape contract independent of which interrupt-kind name the host uses to surface the escalation. The new capability separates "which interrupt kind the host emits" (operator-visible) from "what kind of escalation it semantically is" (clarify vs escalate, in the event payload).

### §C — Host-extension kind documentation requirement (normative)

When a host advertises `confidenceEscalationInterruptKind: "x-host-<host>-<kind>"`, the host MUST publish a non-normative mapping document at a discoverable URL stating:

1. Which canonical RFC 0039 §A escalation kind the vendor kind semantically corresponds to (clarify OR escalate)
2. Which `waiting-*` status the host's `interrupt.md`-mapping produces for the vendor kind
3. Which downstream consumers (UI, audit log, webhook subscribers) pattern-match on the vendor kind name

The discoverability URL SHOULD be advertised under `capabilities.implementation.vendorExtensionsUrl` or equivalent. The protocol does not normate this URL field; it's an operator-side convention. The intent is that operators reading the host's discovery doc can resolve the vendor kind without trial-and-error.

### §D — Spec text amendment to `spec/v1/multi-agent-execution.md`

The §"Confidence escalation (RFC 0039 Phase 2, normative)" section gains an explicit paragraph:

> Hosts MAY advertise `multiAgent.executionModel.confidenceEscalationInterruptKind` per RFC 0044 §A to commit to a specific `interrupt.kind` for confidence-escalation events. When advertised, the host MUST emit an interrupt of the advertised kind. The two canonical values are `clarification` and `approval` (matching the clarify-or-escalate choice in §A above); vendor kinds use the canonical host-extension namespace `x-host-<host>-<kind>`. Hosts advertising a vendor kind MUST also publish a non-normative mapping document per RFC 0044 §C.

## Compatibility

**Additive.** No required-field changes. No normative shifts on the underlying confidence-floor escalation contract (RFC 0039 §A's clarify-OR-approval semantics + the 0.5 floor + the `escalationKind: clarify | escalate` event-payload field all stay exactly as specified). Hosts that don't advertise the new field continue to pass the existing relaxed conformance (accepts both canonical statuses).

Hosts that adopt the new field gain:
- Wire-advertised clarity about which interrupt kind they emit
- Conformance acceptance of their vendor kind without cross-cutting rename
- Operator-side discoverability of the vendor kind's semantics via §C documentation requirement

## Conformance

1 scenario update (no new scenario file): `conformance/src/scenarios/multi-agent-confidence-escalation.test.ts` reads the advertised kind and routes the terminal-status assertion. The scenario stays a single `it()` (capability-gated on `multiAgent.executionModel.version >= 2`); the only change is the assertion routing logic.

## Alternatives considered

1. **Force hosts to rename to `clarification` or `approval`.** Rejected — multi-day cross-cutting work on hosts with entrenched UI/storage/audit-log consumers of an existing vendor kind. The protocol's job is interop, not internal kind taxonomy.
2. **Strip the kind name from the conformance contract entirely; only assert run.status starts with `waiting-`.** Rejected — operators pattern-match on the interrupt kind name in UIs and webhook subscribers. Without an advertised kind, cross-host workflow consumers can't reliably route confidence-escalations.
3. **Add a separate `multiAgent.executionModel.confidenceEscalationInterruptStatus` field for the waiting-status.** Rejected — the status is derived from the kind per `interrupt.md`'s mapping rules. Adding both fields creates a redundancy that can drift; one field (the kind) is the single source of truth.

## Unresolved questions

1. **`vendorExtensionsUrl` capability advertisement.** §C requires hosts using vendor kinds to publish a mapping document, but the URL surface isn't normated. A future RFC may add `capabilities.implementation.vendorExtensionsUrl` to make this discoverable. Defer until adoption signals a need.
2. **Same pattern for other interrupt kinds.** RFC 0044 only addresses the confidence-escalation interrupt. Other interrupt kinds (approval, refinement, cancellation) have entrenched canonical names today; if a future host introduces vendor kinds for those too, the same advertisement pattern can be lifted to a generic `capabilities.interrupts.kinds[]` block. Defer to the host that needs it.

## Acceptance criteria

- [x] Spec text merged (this file).
- [x] `spec/v1/multi-agent-execution.md` §"Confidence escalation (RFC 0039 Phase 2, normative)" extended with the §D paragraph.
- [x] `schemas/capabilities.schema.json` extends `multiAgent.executionModel` with the `confidenceEscalationInterruptKind` field per §A.
- [x] `conformance/src/scenarios/multi-agent-confidence-escalation.test.ts` routes the terminal-status assertion via the advertised kind per §B.
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] At least one non-steward host advertises `confidenceEscalationInterruptKind` and the relaxed conformance scenario passes against the advertised kind. (Path-to-Accepted.)
- [ ] `INTEROP-MATRIX.md` updated to enumerate host advertisements of `confidenceEscalationInterruptKind`. (Will land alongside the first non-steward advertisement.)

Path to `Active → Accepted`: cross-host advertisement evidence per `RFCs/0001-rfc-process.md` §"Promotion to Accepted." Co-graduates with RFC 0039 Half A when MyndHyve (or another non-steward host) advertises `version: 2` + the vendor `confidenceEscalationInterruptKind`.

## References

- [`RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md`](./0039-multi-agent-confidence-and-memory-lifecycle.md) §A — the underlying confidence-escalation contract this RFC clarifies (no normative change; new capability is purely additive).
- [`RFCS/0041-multi-agent-replay-under-nondeterminism.md`](./0041-multi-agent-replay-under-nondeterminism.md) §A — the `spec-rfc-XXXX | x-host-<host>-<key>` advertisement pattern this RFC reuses.
- [`spec/v1/host-extensions.md`](../spec/v1/host-extensions.md) §"Canonical prefixes" — the `x-host-<host>-<key>` namespace convention.
- [`spec/v1/interrupt.md`](../spec/v1/interrupt.md) §"Interrupt kinds" — the kind→status mapping rules hosts follow.
- MyndHyve adoption-pass status update (2026-05-22) — the integration feedback that surfaced this clarification need.

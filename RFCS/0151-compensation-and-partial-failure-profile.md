# RFC 0151: Compensation and Partial-Failure Profile

| Field | Value |
| --- | --- |
| **RFC** | 0151 |
| **Title** | Compensation and Partial-Failure Profile |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** RFC text and its gap/risk registers. **Carried forward, not closed:** the entire compensation and partial-failure profile — schema, prose, conformance, and host implementation.) |
| **Affects** | NEW `spec/v1/compensation.md`, NEW `schemas/compensation-policy.schema.json`, `schemas/{workflow-definition,run-event-payloads,capabilities}.schema.json`, OpenAPI run control, AsyncAPI run events, replay/idempotency/interrupt/dead-letter specs |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

This RFC adds an optional `openwop-compensation-v1` profile for durable Saga-style recovery of external business effects. Workflows may associate an effectful node with an idempotent compensation action, and hosts persist reverse-unwind progress, partial failure, approvals, retries, dead-letter routing, and operator intervention. The profile does not promise atomic rollback; it standardizes best-effort compensating execution and evidence.

## Motivation

OpenWOP defines retries, cancellation, replay suppression, and dead-letter routing, but none reverses a payment, message, reservation, or external mutation that already committed. Multi-step workflows need a portable way to declare inverse actions, observe partial compensation, and resume safely after a crash. This is wire-level workflow behavior shared by independent hosts, not a storage or UI choice.

## Proposal

### §A — Capability

```diff
 {
+  "compensation": {
+    "supported": true,
+    "profileVersion": "1",
+    "orderingModels": ["reverse-completion", "dependency-graph"],
+    "manualIntervention": true
+  }
 }
```

Absent means no generic compensation contract. An advertising host **MUST** implement `reverse-completion`; it **MAY** additionally implement `dependency-graph`.

### §B — Workflow declaration

An effectful node MAY declare:

```diff
 {
   "id": "reserve-inventory",
   "typeId": "vendor.shop.reserve",
+  "compensation": {
+    "nodeTypeId": "vendor.shop.release",
+    "inputMapping": { "reservationId": "${nodes.reserve-inventory.output.id}" },
+    "retry": { "maxAttempts": 5, "backoffMs": 1000 },
+    "requiresApproval": false
+  }
 }
```

`compensation` is optional and closed. `nodeTypeId` **MUST** resolve at registration. Inputs **MUST** derive from recorded facts; prompt/model regeneration **MUST NOT** construct a compensation input during replay. A host **MUST** reject a compensation cycle.

### §C — Lifecycle

When a forward failure triggers unwind, the host **MUST** persist a compensation plan before executing its first inverse action. `reverse-completion` orders compensations by descending durable forward-completion sequence. `dependency-graph` **MUST** be a DAG and preserve reverse dependency order.

Each inverse action receives a stable ID derived from `(tenantId, runId, forwardLogicalInvocationId, compensationOrdinal, profileVersion)` and **MUST** be retry-stable. Crash recovery **MUST** resume from persisted state. Cancellation of the parent **MUST NOT** silently abandon an active compensation; it either continues, pauses for authorized intervention, or records manual intervention required.

### §D — Events and state

Add content-free events:

- `compensation.requested`;
- `compensation.started`;
- `compensation.completed`;
- `compensation.failed`;
- `compensation.paused`; and
- `compensation.manual_intervention_required`.

The run retains its existing terminal execution state and adds optional `compensationStatus: none|pending|running|completed|partial|failed|manual`. This avoids reinterpreting existing run-state enums. Event payloads carry opaque node/effect IDs, attempt, ordering model, and closed reason codes—never provider bodies or credentials.

### §E — Approvals, DLQ, and operator recovery

`requiresApproval:true` creates an RFC 0051 approval interrupt before the inverse effect. Approval authorization uses RFC 0049 and **MUST** bind tenant, principal, action, and plan version. Exhausted compensation retries **MUST** route to RFC 0053 dead-letter handling and set `partial`, `failed`, or `manual`. An authorized operator MAY retry, skip with recorded justification, substitute a registered compensation action, or terminate as uncompensated. Every override **MUST** be audited.

### §F — Replay and branch

Replay defaults **MUST** use recorded compensation outcomes and **MUST NOT** re-fire inverse effects. A live-effect branch MAY execute compensation only after explicit authorization and fresh effect IDs. Forking a partially compensated run **MUST** preserve source facts without claiming that the branch changed the source system.

### §G — Security

Add invariants `compensation-effect-id-retry-stable`, `compensation-tenant-authority-bound`, `compensation-replay-no-refire`, and `compensation-input-recorded-facts-only`. Compensation credentials use normal BYOK/egress policy and least privilege; forward credentials **MUST NOT** be copied into the plan. External audit scope includes double compensation, authority escalation, poisoned inverse mappings, and manual override.

## Compatibility

Additive and capability-gated. New optional workflow fields, discovery block, events, and response field are ignored by existing consumers under v1 rules. A host omitting the capability remains conformant. Existing workflows have `compensationStatus:none`. No generic rollback is inferred from an undeclared action.

## Conformance

New scenarios and fixtures:

- `compensation-shape.test.ts` and positive/negative workflow fixtures;
- `compensation-reverse-unwind.test.ts`;
- `compensation-idempotent-retry.test.ts`;
- `compensation-crash-recovery.test.ts`;
- `compensation-partial-manual.test.ts`;
- `compensation-approval-authority.test.ts`;
- `compensation-replay-no-refire.test.ts`; and
- `compensation-tenant-isolation.test.ts`.

Shape tests are always-on. Behavior gates on `compensation.supported`; an advertising host must execute all mandatory reverse-completion legs in strict certification. Reference hosts provide deterministic fake-effect fixtures plus one sandboxed real-service emulator.

## Alternatives considered

1. Treat cancellation as rollback. Rejected: committed effects remain.
2. Require application-authored repair workflows only. Rejected: no portable lifecycle or evidence.
3. Require distributed transactions. Rejected: most external services do not participate.
4. Make compensation core. Rejected: simple/read-only workflows do not need it.
5. Do nothing. Rejected: partial business failure remains operator-specific and opaque.

## Unresolved questions

1. Should dependency-graph ordering be v1 or a later profile version?
2. May an operator substitute a different node type without changing the plan version?
3. Which run response owns `compensationStatus`?
4. How are irreversible effects declared so authors cannot imply a compensator exists?
5. What minimum retention applies to compensation evidence?

## Implementation notes (non-normative)

Implement after RFC 0150's effect identities. Start with reverse-completion and a deterministic effect emulator. This RFC is SR-4 under RFC 0147.

## Acceptance criteria

- [ ] Spec, policy schema, capability, events, and API/AsyncAPI projections land.
- [ ] Reverse-unwind, retry, crash, partial/manual, approval, replay, and isolation scenarios pass.
- [ ] Effect IDs compose with RFC 0150.
- [ ] Threat models and invariants land.
- [ ] One reference host demonstrates non-vacuous recovery from a mid-unwind crash.
- [ ] SDK types, fixtures catalog, interop matrix, and CHANGELOG update.

## References

- RFCs 0051, 0053, 0140, 0150, and 0147 Workstream 4
- AWS Prescriptive Guidance, Saga patterns
- Azure Durable Functions and Temporal durable execution


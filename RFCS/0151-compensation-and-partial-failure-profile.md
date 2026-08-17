# RFC 0151: Compensation and Partial-Failure Profile

| Field | Value |
| --- | --- |
| **RFC** | 0151 |
| **Title** | Compensation and Partial-Failure Profile |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-17 (first host witness — openwop-app `d209d8009` advertises `compensation`, executes `compensation-behavior` 6/6 + `compensation-recovery` 3/3 strict on a local boot; INTEROP-MATRIX row added; four §G invariants witnessed.) 2026-08-16 (UQ4 resolved — `WorkflowNode.irreversibleEffect` + `FragmentNode.irreversibleEffect`, mutual exclusion with `compensation` in schema, plan entry `irreversible`, rollup caps at `partial`; suite `1.129.0 -> 1.130.0`.) 2026-08-16 (§21 recovery extension + `compensation-recovery.test.ts` — the three §G invariants that were named-not-registered now have a witness and are registered; suite `1.128.0 -> 1.129.0`.) 2026-08-16 (§C/§E/§G prose landed in `spec/v1/compensation.md` — plan, identity tuple with `attempt` outside it, crash-resume, `onParentCancel`; approval-before-effect on the plan entry, RFC 0049 binding to tenant/principal/action/`planVersion`, RFC 0053 routing, the four operator actions as wire-defined outcomes; UQ2 decided: substitution is a new `planVersion`. NEW `SECURITY/threat-model-compensation.md` (T1–T6, A1–A9, STRIDE per §); `compensation-replay-no-refire` re-homed to it; the other three §G invariants named-not-registered with the seam extension each needs. Doc gaps G1/G2 closed, G6/G7/G8 opened (pause reasons, operator endpoints, irreversible declaration = UQ4).) 2026-08-16 (`compensation-policy.schema.json` landed as `settings.compensation`, closing the program's last `Affects` absence; suite `1.107.0 -> 1.108.0`). 2026-08-16 (UQ3 resolved — `compensationStatus` lands on `RunSnapshot`, `spec/v1/compensation.md` opens at `Draft` covering the landed subset, and the unwind/replay seams the behavioral witness had driven since suite 1.94.0 are catalogued in `host-sample-test-seams.md` §21; suite `1.106.1 -> 1.107.0`). 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** RFC text and its gap/risk registers. **Carried forward, not closed:** the entire compensation and partial-failure profile — schema, prose, conformance, and host implementation.) |
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
2. ~~May an operator substitute a different node type without changing the plan version?~~ **Resolved 2026-08-16: no.** `spec/v1/compensation.md` §E — substitution increments `planVersion`, and approvals / authorization decisions bound to the prior version are void, so an approval recorded for one inverse action cannot carry over to a different one.
3. ~~Which run response owns `compensationStatus`?~~ **Resolved 2026-08-16:** `RunSnapshot` (`GET /v1/runs/{runId}`, `run-snapshot.schema.json`) is the sole owner; debug bundles and the AsyncAPI `run.snapshot` reuse it by `$ref`. OPTIONAL and capability-gated — a host that does not advertise `compensation` MUST omit it, an advertising host MUST carry it (`none` when idle) — and its value is the deterministic fold of the §D events, defined normatively in `spec/v1/compensation.md` §"Run rollup". A §E approval pause does not change it (the run's own `status: waiting-approval` carries the wait), which is the concrete payoff of keeping the two fields separate. What this does NOT settle: the value on a forked run of a partially compensated source (`compensation.md` G4).
4. ~~How are irreversible effects declared so authors cannot imply a compensator exists?~~ **Resolved 2026-08-16:** an OPTIONAL node-level boolean `irreversibleEffect` (sibling of `compensation`, mutually exclusive by schema; mirrored into RFC 0157 chain fragments). A committed irreversible effect enters the plan as an `irreversible` entry that never completes, so `compensationStatus` caps at `partial`. Deliberately a sibling, not a `compensation` variant, so `nodeTypeId` stays required and COMPATIBILITY §2.2 is not engaged. `spec/v1/compensation.md` §B "Irreversible effects".
5. What minimum retention applies to compensation evidence?

## Implementation notes (non-normative)

Implement after RFC 0150's effect identities. Start with reverse-completion and a deterministic effect emulator. This RFC is SR-4 under RFC 0147.

## Acceptance criteria

- [ ] Spec, policy schema, capability, events, and API/AsyncAPI projections land. (Events landed — six content-free `compensation.*` types in the closed `RunEventType` enum, payload schemas, and AsyncAPI messages; without them a host following §D would have emitted schema-invalid events. Capability family and node-level `compensation` declaration landed in `capabilities.schema.json` and `workflow-definition.schema.json`, with `compensation-profile.test.ts` — **shape only**. 2026-08-16: `compensationStatus` landed on `RunSnapshot` (UQ3), and `spec/v1/compensation.md` opened at `Draft` — **the landed subset only**: §A/§B/§D/§F, with §C lifecycle prose, §E operator recovery, `compensation-policy.schema.json`, and fork semantics named as carried in its own gap table. Later 2026-08-16: `schemas/compensation-policy.schema.json` landed as the reserved `settings.compensation` workflow key — closed `triggers`, ordering model, retry/timeout defaults, `exhaustedDisposition`, escalate-only `approvalScope`, `onParentCancel` — with the non-advertising-host refusal rule (`capability_required`); it was the program's last absent `Affects` artifact. Carried: §C/§E prose beyond what the policy names, and the OpenAPI/AsyncAPI projections beyond the snapshot `$ref`.)
- [ ] Reverse-unwind, retry, crash, partial/manual, approval, replay, and isolation scenarios pass. (**2026-08-17: they PASS on a host** — openwop-app main `d209d8009` (ADR 0554 wire flip, #3294), local boot, strict, suite 1.134.0: `compensation-behavior` 6/6 (25 asserts), `compensation-recovery` 3/3 (25), `chain-compensation-expansion` 11/11 — reverse-unwind, retry-stable identity, partial/manual via the held plan + operator triple, replay ≡ source, tenant isolation; the first host to execute every RFC 0151 normative behavioral path in strict mode (RFC 0147 §A.5). Still absent: crash-resume and approval-before-inverse legs; deployed-origin run pending deploy #2. **2026-08-16 later: retry, partial/manual, isolation, and recorded-facts replay legs now exist** — `compensation-recovery.test.ts` through the §21 recovery extension (retry-stable identity with one downstream key; a held plan + operator seam driven cross-tenant / non-operator / operator; `replayed ≡ source`). Still absent: crash-resume (needs a seam that kills the host mid-unwind — reference-host work) and approval-before-inverse (needs an RFC 0051 interrupt through the seam). **The witness now exists**: `compensation-behavior.test.ts` covers plan-before-first-effect, reverse-completion ordering, replay-no-refire, and credential exclusion, capability-gated and strict-mode-failing. 2026-08-16: a sixth leg reads the seam run's snapshot and asserts the §D rollup against the emitted events, and the seams themselves are finally catalogued (`host-sample-test-seams.md` §21) — for three suite minors the witness had driven `/v1/host/sample/test/compensation/{unwind,replay}` with no contract for a host to build against. Carried: a host that advertises `compensation.supported` and exposes the seams — until one does, these resolve to `blocked` per RFC 0148 §A.)
- [ ] Effect IDs compose with RFC 0150. (Carried, and now the one item with a concrete dependency: RFC 0150 §B landed `logicalInvocationId`, so the composition target is fixed. §C's semantic digest is not, so the composition cannot be specified end-to-end yet.)
- [x] Threat models and invariants land. (2026-08-16: threat model landed — `SECURITY/threat-model-compensation.md`, indexed in `SECURITY.md`; `compensation-replay-no-refire` registered and re-homed to it. **Later the same day:** `compensation-effect-id-retry-stable`, `compensation-tenant-authority-bound`, `compensation-input-recorded-facts-only` registered at protocol tier against `compensation-recovery.test.ts` and the §21 recovery extension it drives — all four §G invariants registered; each `blocked` in the ledger until a host wires the extension.)
- [ ] One reference host demonstrates non-vacuous recovery from a mid-unwind crash. (Carried — reference hosts live in `openwop-examples`, and there is no compensation surface for one to implement.)
- [ ] SDK types, fixtures catalog, interop matrix, and CHANGELOG update. (Carried with the spec above.)

## References

- RFCs 0051, 0053, 0140, 0150, and 0147 Workstream 4
- AWS Prescriptive Guidance, Saga patterns
- Azure Durable Functions and Temporal durable execution


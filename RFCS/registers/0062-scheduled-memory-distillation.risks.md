# RFC 0062 — Risk Register

Companion to [`RFCS/0062-scheduled-memory-distillation.md`](../0062-scheduled-memory-distillation.md). Likelihood × Impact (H/M/L).

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | (pre-reframe) A new `memory.distilled` event would split the compaction observability stream — an existing `memory.compacted` consumer misses scheduled distillations. | — | — | **Closed** | Reframed: reuse `memory.compacted` + an additive optional `distillation` sub-object. | Spec Architect | Closed |
| R2 | A host emits `trigger: "scheduled"` (not in the closed enum) → schema-invalid event. | L | M | Low | Reframe pins `trigger: "host-managed"`; the scheduled nature lives in the `distillation` sub-object + initiating `schedule` trigger. | Spec Architect | Open |
| R3 | A distillation re-exposes a secret the source memory had redacted (SR-1 break). | L | H | Med | SR-1 carry-forward inherited from RFC 0012; `distillation-secret-carryforward.test.ts` re-asserts. | Security Architect | Open |
| R4 | Token budget misconfigured → context-window failure (the exact risk the feature set warns about). | M | M | Med | Mandatory budget (§B.2) clamped to `maxTokenBudget`; un-meetable budget → `token_budget_exceeded`, atomic (no partial archive). | Spec Architect | Open |
| R5 | RFC 0059 (workspace, Draft) stalls → the memory-index has no durable home; distillation writes an archive but the next run can't discover it. | M | M | Med | `indexEmitted` is capability-gated on `host.workspace.supported`; distillation still runs + archives without the index. Gate `Accepted` on 0059's schema. | Spec Architect | Open |

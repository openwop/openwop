# Threat Model: Compensation and Partial Failure

> **Scope:** RFC 0151 — the `openwop-compensation` profile (`capabilities.compensation`), the node-level inverse-action declaration and workflow-level policy (`settings.compensation`), the persisted compensation plan and its lifecycle, the six content-free `compensation.*` events and the `compensationStatus` rollup, approvals / dead-letter / operator recovery, and replay of a compensated run. Also RFC 0157 (chain fragments carry the same declaration).
> **Last updated:** 2026-08-16
> **Companion artifacts:** `spec/v1/compensation.md` (§A–§G) · `spec/v1/replay.md` · `spec/v1/idempotency.md` · `spec/v1/interrupt.md` §approval · `spec/v1/host-capabilities.md` §host.deadLetter · `SECURITY/threat-model-secret-leakage.md` · `SECURITY/threat-model-auth-profiles.md` · `RFCS/0150-*` (effect identity) · `RFCS/0151-*` §G · `RFCS/registers/0151-*.risks.md`
> **Status of evidence:** shape, the §21 unwind/replay seams (`compensation-behavior.test.ts`) and the §21 recovery extension (`compensation-recovery.test.ts`) exist and — since 2026-08-17 — **execute non-vacuously on openwop-app main `d209d8009`** (local boot, strict: behavior 6/6, recovery 3/3). All four RFC 0151 §G invariants are registered against a scenario that exercises the threat and have now been witnessed once (§7); the deployed origin advertises the family after openwop-app's next deploy, at which point the rows become deployed-wire evidence.

## 1. Why this model

Compensation is **a second effect, not an undo**. It reaches the same downstream systems the forward path did — payment processors, mail relays, inventory ledgers — with the authority to move money or state in the other direction, and it runs at the worst moment: after something has already failed, often under an operator's hand, sometimes across a host restart. Every property that makes the forward path safe (identity, authority binding, credential hygiene, replay suppression) has a mirror here with a sharper edge, because the mirror action's failure mode is a *double* refund, a *cross-tenant* release, or a *forged* inverse. RFC 0147 R9 rates the profile security-tier high for that reason; this document says what "high" means concretely.

## 2. Trust boundaries

```text
[Workflow author]                                        ← §B declaration + policy
        │ T1  nodes[].compensation{nodeTypeId,inputMapping,retry,requiresApproval}
        │     settings.compensation{triggers,orderingModel,approvalScope,onParentCancel,…}
        ▼
[Host: registration → forward execution → recorded facts]
        │ T2  event log: forward outputs, logicalInvocationId, completion ordinals
        ▼
[Host: trigger → PLAN (persisted) → inverse actions]      ← §C
        │ T3  identity tuple · nodeTypeId · recorded-fact input · retry bounds · planVersion
        ▼
[Downstream system]  ←──── inverse effect, own credential (BYOK/egress policy) ────
        │ T4  outcome per attempt (completed / failed / timed-out)
        ▼
[Approver · operator]                                     ← §E
        │ T5  RFC 0051 approval · RFC 0049 decision bound to tenant/principal/action/planVersion
        ▼
[Events · RunSnapshot.compensationStatus · dead-letter · audit]   ← §D / §E
        T6  content-free facts only; rollup = deterministic fold
```

- **T1 Authoring.** The declaration is attacker-influenced input at registration: a `nodeTypeId` that resolves to the wrong thing, an `inputMapping` that reaches outside recorded facts, a policy that tries to lower approval scope. Registration-time validation is the boundary.
- **T2 Facts.** The plan is built from the durable log, not from live state or a re-run model. What is not in the log cannot be an inverse input.
- **T3 Plan.** The persisted plan is the source of truth for the unwind — across retries, crashes, and operator actions. Anything that lets the plan be rebuilt, reordered, or re-keyed silently is a boundary failure.
- **T4 Effect.** The inverse effect crosses to a system the host does not own; the identity tuple is the only thing that lets that system deduplicate.
- **T5 Authority.** Approvals and operator actions are decisions in the plan's tenant, bound to a plan version. Nothing carries in.
- **T6 Observation.** Events, snapshot, dead-letter, and audit describe outcomes without provider bodies, credentials, or justification text.

## 3. Adversaries

| ID | Adversary | Capability and mitigation |
| --- | --- | --- |
| A1 | Double compensator | Provokes a retry, a crash-resume, or a replay hoping the inverse effect fires twice (two refunds, two releases). Mitigation: §C identity tuple excludes `attempt`; `completed` is terminal per action; resume from the persisted plan; §F replay uses recorded outcomes (`compensation-replay-no-refire`); identity carried as the downstream idempotency key. |
| A2 | Poisoned-mapping author | Writes an `inputMapping` that resolves from a prompt, model output, or a *different* node's output so the "inverse" targets someone else's reservation. Mitigation: §B recorded-facts rule; plan input derived at plan time; the seam witness rejects a re-derived input once it exists (`compensation-input-recorded-facts-only`, named). |
| A3 | Cross-tenant operator | Holds operator authority in tenant X and acts on tenant Y's held plan (retry / skip / substitute / terminate). Mitigation: §E binding to tenant + principal + action + `planVersion`; audited via `authorization.decided`; `reason: authority-denied` on refusal (`compensation-tenant-authority-bound`, named). |
| A4 | Authority inheritor | Assumes the forward caller's or the workflow author's authority carries into the unwind, or that an approval recorded for plan version *n* covers a substituted entry in version *n+1*. Mitigation: no inherited authority (§E); substitution increments `planVersion` and voids prior approvals (UQ2 decided). |
| A5 | Credential copier | Persists the forward credential (or a token that reaches it) into the plan so the inverse "just works" — and so a plan dump is a credential dump. Mitigation: plan holds identity + `nodeTypeId` + facts only; inverse authenticates under its own credential through BYOK / egress policy (§G); events content-free (SR-1). |
| A6 | Silent abandoner | Cancels the parent run mid-unwind, or crashes it, so a half-applied unwind reads as `none` / disappears. Mitigation: `onParentCancel` closed to `continue` / `pause` / `manual`; plan durable before action; rollup `partial` / `manual`, never `none`, for a plan that ever existed. |
| A7 | Approval stripper | Uses a run-options overlay or a policy edit to drop a node-declared `requiresApproval`. Mitigation: `approvalScope` can only escalate; policy is authored, not per-run; approval presented on the plan entry, not a re-derived value. |
| A8 | Rollup launderer | A host projection that reports `completed` for a plan with a skipped action, or `failed` for one with a completed refund. Mitigation: §D fold is normative; the witness reads both events and snapshot and asserts the table. |
| A9 | Log miner | Reads `compensation.*` events, dead-letter reasons, or the debug bundle for provider responses, credentials, or the operator's justification text. Mitigation: closed content-free payloads; justification lives in the audit record; `run.dead_lettered` reason is redaction-safe; SR-1 canary in the certification-bundle scrub. |

## 4. STRIDE per surface

### 4.1 Declaration and policy (§B)

| Threat | Vector | Mitigation (normative home) |
| --- | --- | --- |
| Tampering | `nodeTypeId` resolves late (or never), unwind fails at the worst moment | MUST resolve at registration (`compensation.md` §B). |
| Tampering | Compensation cycle (A compensates B compensates A) | MUST reject a cycle (§B). |
| Elevation | Policy names an unadvertised `orderingModel` / `profileVersion` | Refuse at registration, `validation_error` (§B). |
| Elevation | Policy tries `approvalScope: none` or a per-run overlay | Escalate-only enum; no run-options overlay (§B; A7). |
| Spoofing | Non-advertising host accepts `settings.compensation` and implies an unwind it will never run | MUST refuse with `capability_required` (§B). |
| Information disclosure | Author reads a compensator into a node that has none | Gap G8 (irreversible declaration) — **open**. |

### 4.2 Plan and lifecycle (§C)

| Threat | Vector | Mitigation (normative home) |
| --- | --- | --- |
| Tampering | Unwind starts before the plan is durable; crash loses the plan | Plan MUST be persisted before the first inverse; `compensation.requested` witnesses it (§C/§D; behavior leg). |
| Tampering | Resume rebuilds the plan from an edited definition | MUST resume from the persisted plan, MUST NOT rebuild (§C). |
| Repudiation / duplication | Retry mints a new identity → downstream sees two obligations | Identity tuple excludes `attempt`; same identity on retry/resume; idempotency key = identity (§C; `compensation-effect-id-retry-stable`, named). |
| Tampering | Inverse actions run out of order and release a dependency | Descending forward-completion; DAG reverse order; no start until predecessors have outcomes (§C; behavior leg). |
| Denial of service | Parent cancel abandons an active unwind | `onParentCancel` closed set; rollup stays honest (§C; A6). |
| Tampering | Late success from a timed-out attempt races a retry | Same identity on both; downstream idempotency (§C). |

### 4.3 Approvals, dead-letter, operator recovery (§E)

| Threat | Vector | Mitigation (normative home) |
| --- | --- | --- |
| Elevation | Approver approves a re-derived value, not what will run | `artifactData` MUST be the plan entry (§E). |
| Elevation | Decision for plan version *n* reused for *n+1* | Bind to `planVersion`; substitution increments it (§E; A4). |
| Elevation | Operator acts across tenants / with forward-run authority | Bind to tenant + principal + action; no inheritance; `authority-denied` (§E; A3, `compensation-tenant-authority-bound`, named). |
| Repudiation | Override not audited; justification lost | Every override MUST be audited via `authorization.decided`; justification in the audit record (§E). |
| Tampering | Skip / terminate re-runs a `completed` action | None of the four actions may re-execute a completed inverse (§E). |
| Denial of service | Exhausted retries vanish (no dead-letter, purged plan) | RFC 0053 routing; plan retained ≥ run retention even without `deadLetter` advert (§E). |

### 4.4 Events, rollup, replay (§D / §F)

| Threat | Vector | Mitigation (normative home) |
| --- | --- | --- |
| Information disclosure | Provider body / credential in a `compensation.*` payload | Closed content-free payloads; behavior leg rejects credential markers (§D; SR-1). |
| Tampering | Rollup disagrees with events (A8) | Normative fold table; witness asserts events ⇄ snapshot (§D). |
| Spoofing | Non-advertising host emits `compensationStatus`, or advertising host omits it | Gating rule: omit / MUST carry (§D). |
| Duplication | Replay re-fires an inverse effect | MUST use recorded outcomes; live-effect branch only with explicit authorization + fresh IDs (§F; `compensation-replay-no-refire`, registered). |
| Tampering | Fork of a partially compensated run claims it changed the source | Branch preserves source facts without claiming source change (§F); child rollup semantics — gap G4, open. |

### 4.5 Concurrent execution of one run (`layer2-invocation-claim-atomic`)

Every threat above assumes one executor. Two executors of the **same** run reaching the
same effect seam at the same time is a different shape, and it defeats the §C identity
mitigations rather than evading them: both executors re-execute the node from its start,
both mint the **same** `logicalInvocationId`, and a stable identity is exactly what should
have deduplicated them. It does not, if the thing that consumes the identity cannot report
a conflict.

| Threat | Vector | Mitigation (normative home) |
| --- | --- | --- |
| Duplication | Orphan sweeper re-dispatches a run whose owner is stalled but still alive; both executors read the invocation log, both miss, both fire | The persist guarding the effect **MUST** be an atomic claim — compare-and-set / insert-if-absent that at most one executor can win (`spec/v1/idempotency.md` §"Concurrent duplicates (Layer 2)", RFC 0150 §B; `layer2-invocation-claim-atomic`, registered). |
| Duplication | The same accepted work delivered twice, no sweeper involved | Same claim; asserted per effect identity rather than by end state (RFC 0158 §Conformance `durability/duplicate-delivery`). |

Why it belongs in *this* model: the inverse of a duplicated effect is a duplicated
**inverse**. A run that charged twice and is then unwound produces two refunds against one
charge, and §C's per-ordinal "one obligation" property is computed over a plan that already
contains the duplicate — so the compensation layer faithfully reverses a history that was
wrong before it saw it. No compensation-side check can recover from this; it has to be
prevented at the claim.

Three ways to get this wrong, all observed or explicitly named by the normative text:

- **`INSERT OR REPLACE` / upsert.** The precise inverse of a claim: it always wins and never
  reports a conflict, so the *"and the other observes the hit"* half of the rule cannot
  happen. Reported 2026-09-01 by a tier-1 host with exactly this verb.
- **Read-then-write.** Both executors miss the read before either writes. Named in the
  clause itself.
- **A lease standing in for the claim.** A lease is liveness-dependent — a throttled or
  stalled instance renews nothing — so it fences only while the loser is healthy enough to
  notice, which is the case that does not need fencing. The atomic claim is
  liveness-independent: the loser need not be alive, scheduled, or aware, because it loses
  at the moment it attempts the write. A host whose lease merely exceeds its maximum run
  length has the outcome protected by an unrelated constant, not by the mitigation.

**Not currently witnessed.** Driving this needs two executors of one run concurrently
reaching one seam, which the black-box suite cannot cause without a host seam; a wire probe
asserting it would pass either way (RFC 0148 §A). The row that would cover it,
`durability/duplicate-delivery`, is not implemented and is not required evidence for any
RFC 0158 rung — `durable-single-instance` names only `kill-after-accept` and
`kill-during-execution` — so a host can hold that rung honestly while violating this MUST.
Gap **G17**.

## 5. Relationship to other models

- **`threat-model-secret-leakage.md`** owns SR-1; the plan and the events are shaped so there is nothing to redact (A5, A9).
- **`threat-model-auth-profiles.md`** / **`threat-model-workload-identity.md`** own *who* the operator is; this model starts once a principal is verified and asks what they may do to a plan — and answers "only what they hold in the plan's tenant, for this plan version".
- **RFC 0150 (`threat-model-*` rows on effect identity)** — the inverse-action identity is RFC 0150 §B's `logicalInvocationId` composed with the compensation ordinal and profile version; `attempt` is outside it for the same reason RFC 0150 §B retired it.
- **`threat-model-prompt-injection.md`** — a model output is `untrusted`; it can no more construct an inverse input than it can advance an approval gate (A2).

## 6. Residual risks

- **Downstream systems without idempotency.** The identity tuple only prevents a double effect if the downstream honours it as an idempotency key; a system that does not can still be double-charged by a retry the host cannot distinguish from a first attempt. The profile bounds this (retry bounds, `completed` terminal) but cannot remove it.
- **Operator endpoints are host-mediated.** Until gap G7 lands a canonical endpoint family, the four §E actions are reachable only through host-specific surfaces, so A3/A4 are witnessed only where a host exposes a seam.
- **`reason` vocabulary is closed and incomplete** (gap G6): an approval hold and a parent-cancel hold both surface as `compensation.paused` with no reason, which is honest but coarse.
- **No deployed advertiser.** Every behavioural row above is untested against a production origin; the seams and witness exist so the first advertiser is tested non-vacuously, and RFC 0148 §A keeps the status honest until then.

## 7. Verification

- **Shape:** `compensation-profile.test.ts` — the §A family, the §B declaration and policy (closed triggers, escalate-only `approvalScope`, `onParentCancel`), the closed `compensationStatus` enum.
- **Behaviour (gated on `compensation.supported`, hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`):** `compensation-behavior.test.ts` via `POST /v1/host/sample/test/compensation/{unwind,replay}` (`host-sample-test-seams.md` §21) — plan before first effect, reverse-completion order, replay no-refire, content-free events, snapshot rollup ⇄ events; `compensation-recovery.test.ts` via the §21 recovery extension — retry-stable identity, tenant-bound operator authority (404 / 403-audited / 200), recorded-facts replay equality.
- **Unwitnessed invariant:** `layer2-invocation-claim-atomic` (§4.5, reference-impl tier, gap G17) — registered with an empty `tests` list because no black-box witness exists; stated rather than covered by a probe that would pass either way.
- **Registered invariants:** `compensation-replay-no-refire`, and — since 2026-08-16, via `compensation-recovery.test.ts` and the §21 recovery extension (`unwind` `failFirstInverseAttempts` / `hold` + `inverseActions[]`, `replay` `source[]`/`replayed[]`, NEW `operator` seam) — `compensation-effect-id-retry-stable`, `compensation-tenant-authority-bound`, `compensation-input-recorded-facts-only` (`SECURITY/invariants.yaml`, protocol tier; each `blocked` until a host wires the extension, and named as such in the ledger).
- **How each is exercised** (the seam extension that was named here as missing, now specified):
  - `compensation-effect-id-retry-stable` — an `unwind` request option that fails the first inverse attempt on cue, with the response reporting per-action `{ ordinal, effectId, attempts }` so the scenario asserts one identity across attempts and one obligation per ordinal.
  - `compensation-tenant-authority-bound` — an operator seam that presents a secondary-tenant principal (the suite already boots one, `OPENWOP_TEST_SECONDARY_API_KEY`) against a held plan and expects `authority-denied` + an `authorization.decided` record.
  - `compensation-input-recorded-facts-only` — an `unwind` response that echoes each inverse action's input alongside the recorded forward output it was derived from, so the scenario asserts equality and rejects a host that re-derives.
  None of these is registered against `compensation-behavior.test.ts`, which does not exercise them; each points at `compensation-recovery.test.ts`, which does.
- **External audit scope** (RFC 0151 §G, unscheduled): double compensation, authority escalation, poisoned inverse mappings, manual override — the rows above are its checklist.

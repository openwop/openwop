# openwop Spec v1 — Budget, Quota, and Cost Policy

> **Status: DRAFT v1.x (filed via [RFC 0084](../../RFCS/0084-budget-quota-and-cost-policy.md), 2026-05-30).** Additive v1.x extension — not part of the v1.0 conformance gate. Lands the reserved `budget` run-options key, the content-free `budget.{reserved,consumed,threshold.crossed,exhausted}` events, the four `cap.breached{budget-*}` kinds, and the `budget` capability + `limits` ceilings. The behavioral enforcement scenario, the `budget_exhausted`/`budget_model_denied` OpenAPI error codes, and the reference-host accounting land at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

openwop *observes* spend — RFC 0026 emits per-call `provider.usage` (tokens + optional cost) and `observability.md` projects `openwop.cost.*` — but it cannot **enforce** a budget. A user cannot say "do not spend more than $1 on this research run"; a host cannot cap tool-call count, retry count, or restrict which models a run may use; and there is no event telling a consumer "you've crossed 80% of budget" or "budget exhausted." RFC 0058 caps *execution* (wall-clock, agent-loop iterations) — runaway-execution safety — but says nothing about *cost*. This document adds the **cost-governance** layer, additively and orthogonally to RFC 0058.

## §A — The `budget` policy

An additive reserved `budget` key on `RunOptions.configurable` ([`budget-policy.schema.json`](../../schemas/budget-policy.schema.json), `additionalProperties: false`): `maxTokens`, `maxCostUsd`, `maxToolCalls`, `maxRetries`, `modelAllow[]`/`modelDeny[]`, `thresholdPercent`, `onExhaustion ∈ {fail, interrupt}`. Every dimension is optional; an absent dimension is unbounded (host default). **Wall-time and loop-iterations are deliberately NOT here** — they are RFC 0058's `runTimeoutMs` / `maxLoopIterations` (§E); a `budget` policy attempting a wall-time field fails validation (`additionalProperties: false`).

## §B — Scopes + resolution

A budget MAY be declared at four scopes (run / workflow / agent / project). The **effective budget for a run is the minimum across all applicable scopes**, then clamped to the host ceiling (`Capabilities.limits.maxBudgetTokens` / `maxBudgetCostUsd`) — the RFC 0058 §A `min(requested, hostCeiling)` model. Project/agent/workflow budgets are host-configured (a `tenant` host, RFC 0074, scopes them to the owner triple); the run-level `budget` is the per-request overlay. Resolution is deterministic and **recorded at `budget.reserved`**, so a replay re-reads the same effective budget (a recorded fact, not re-resolved). Non-run-scoped budgets are host-config only at v1.x — there is no `GET /v1/budgets` wire surface (the RFC 0080 `GET /v1/memory` decision, applied to budgets); the run-level overlay is the only wire surface.

## §C — The `budget.*` event family (content-free)

| Event | Emitted | Payload (content-free) |
|---|---|---|
| `budget.reserved` | once, at run start | `{ effectiveBudget, scope }` |
| `budget.consumed` | on each `provider.usage` / tool call / retry (host MAY coalesce) | `{ dimension, consumed, limit, remaining? }` |
| `budget.threshold.crossed` | once per dimension, at `thresholdPercent` | `{ dimension, consumed, limit, percent }` |
| `budget.exhausted` | when a dimension hits its limit | `{ dimension, consumed, limit }` |

Consumption is **derived from the existing events** — `maxTokens`/`maxCostUsd` from RFC 0026 `provider.usage` (no double-counting; `budget.consumed` is a running projection, not a new measurement), `maxToolCalls` from `agent.toolCalled`, `maxRetries` from the RFC 0009 retry events. The host MAY coalesce `budget.consumed`; it MUST emit at least `reserved` + `threshold.crossed` + `exhausted`. None of the four carries pricing breakdowns, rate cards, provider credentials, or model prose (SR-1; the §F invariant) — only the dimension name, integers/numbers, and the scope. Consumed values are recorded facts: on replay the exhaustion point is deterministic even if the host's live pricing changed (`replay.md` §"Recorded-fact events").

## §D — Enforcement

On `budget.exhausted` for a hard dimension, the host enforces per `onExhaustion`:

- **`"fail"`** (default): emit `cap.breached` with a `kind ∈ {budget-tokens, budget-cost, budget-tool-calls, budget-retries}` (the RFC 0058 precedent — budget enforcement REUSES the unified cap-overflow event, no new failure event) → `run.failed` with error code `budget_exhausted`.
- **`"interrupt"`**: raise an RFC 0051 approval interrupt ("budget exhausted, approve continuation?"). A resume carries an additive budget delta, audited via a second `budget.reserved`.

**Model allow/deny** is enforced at model selection: a run whose resolved model violates `modelAllow`/`modelDeny` (`modelDeny` wins on conflict, fail-closed) is refused with `budget_model_denied` **before** the call — composing the RFC 0031 model-gate dispatch point + the RFC 0067 `provider_policy_denied` precedent. This is a *budget*-scoped allowlist (per-run spend control), distinct from RFC 0031 *capability* gating and RFC 0067 *provider* policy; all three compose at the same dispatch seam. `budget.maxRetries` is a **ceiling over** the RFC 0009 retry count (the run fails when cumulative retries hit it), not a separate retry mechanism.

## §E — Capability + orthogonality with RFC 0058 (the load-bearing seam)

A host advertises `capabilities.budget` (`supported` + `dimensions[]` truthful + `enforce ∈ {hard, advisory}` + `scopes[]`) and the additive `limits.maxBudget{Tokens,CostUsd}` ceilings. An `advisory` host MUST emit the four events but MUST NOT stop the run (honest advertisement of observe-only).

**RFC 0058 owns** `runTimeoutMs` (wall-clock) + `maxLoopIterations` (agent-loop), emitting `cap.breached{kind:"run-duration"|"loop-iterations"}`. **RFC 0084 owns** token/cost/tool-call/retry *spend* + model *policy*, emitting `cap.breached{kind:"budget-*"}`. They share only the `cap.breached` event (by design — the unified overflow primitive) and the `min(requested, ceiling)` resolution pattern. **No dimension is defined in both** — `budget` has no wall-time/iteration field (§A), and 0058 has no token/cost/tool-call field. A run MAY set both a `runTimeoutMs` (0058) and a `budget.maxCostUsd` (0084); whichever binds first fires its own `cap.breached` kind. This seam is normative so the two never drift into overlap.

## §F — Security

The new protocol-tier invariant **`budget-no-pricing-leak`**: the four `budget.*` events + `cap.breached{budget-*}` MUST NOT carry pricing breakdowns, rate cards, per-token prices, provider credentials, or model prose — content-free (dimension name + integers/numbers + scope only), mirroring `provider-usage-no-credential-leak`. Verified always-on by `budget-policy-shape.test.ts` (the content-free negatives are its public test). The host's pricing *model* (how it computes `costEstimateUsd`) stays a host choice (RFC 0026); this RFC fixes only the policy shape, the events, and the enforcement seam.

## Open spec gaps

- The behavioral enforcement scenario (accrue → threshold → exhaust → `cap.breached{budget-cost}` → `run.failed{budget_exhausted}`; `budget_model_denied`; the advisory no-stop path), the `budget_exhausted`/`budget_model_denied` OpenAPI error codes, and the reference-host budget accumulator land at `Active → Accepted`; the always-on `budget-policy-shape.test.ts` + the schema + events + `cap.breached` kinds + capability ship now.
